/**
 * Tainted work dirs (docs/concept.md, "The work dir's guarded files"). When
 * the post-run check cannot settle what a boxed run left in its work dir (a
 * rename that failed, a folder it could not read, its time cap, or a box
 * that would not die), the work dir is tainted on this host. While it is,
 * every launch there, or in a folder above or below, skips as `box-broken`,
 * boxed or not
 * (src/runner/box-launch.ts), until the operator looks and runs
 * `darius box clear <work dir>`.
 *
 * The record is host-local: one file per taint in `<state dir>/box/taints/`,
 * outside every project, so sync never carries it. One file each, so two
 * runners that taint at once lose neither. A run in the box cannot write
 * there: the state dir is read-only in the box.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, normalize } from "node:path";

import type { JsonValue } from "./model.ts";
import { stateDir } from "./paths.ts";

/** One taint: the work dir's real path, the run that left it, when, and why. */
export interface Taint {
  workDir: string;
  run: string;
  project: string;
  at: string;
  reasons: string[];
}

/** `<state dir>/box/taints`: one `<hash of the work dir>-<run>.json` per taint. */
export function taintDir(): string {
  return join(stateDir(), "box", "taints");
}

type JsonRecord = { readonly [key: string]: JsonValue };

function isRecord(value: JsonValue | undefined): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

/** One taint from a file's JSON, or null when it is not one. */
function taintOf(value: JsonValue): Taint | null {
  if (!isRecord(value)) return null;
  const { workDir, run, project, at, reasons } = value;
  if (!isText(workDir) || !isText(run) || !isText(project) || !isText(at) || !Array.isArray(reasons)) return null;
  const texts = reasons.filter((reason) => isText(reason));
  if (texts.length !== reasons.length) return null;
  return { workDir, run, project, at, reasons: texts };
}

function isMissing(cause: unknown): boolean {
  return cause instanceof Error && "code" in cause && cause.code === "ENOENT";
}

/** A taint file and what it holds: a taint, or null when it is damaged. */
interface TaintEntry {
  file: string;
  taint: Taint | null;
}

function damaged(what: string): Taint {
  return { workDir: "/", run: "?", project: "?", at: "?", reasons: [`${what}; fix it, or run darius box clear /`] };
}

/** Each taint file, read. Throws when the folder cannot be listed for another reason than that it is not there. */
function taintEntries(dir: string): TaintEntry[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (cause) {
    if (isMissing(cause)) return [];
    throw cause;
  }
  const entries: TaintEntry[] = [];
  for (const name of names.filter((entry) => entry.endsWith(".json")).toSorted()) {
    const file = join(dir, name);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (cause) {
      // Cleared between the listing and the read.
      if (isMissing(cause)) continue;
      entries.push({ file, taint: null });
      continue;
    }
    let parsed: JsonValue;
    try {
      parsed = JSON.parse(text);
    } catch {
      entries.push({ file, taint: null });
      continue;
    }
    entries.push({ file, taint: taintOf(parsed) });
  }
  return entries;
}

/**
 * Every taint on this host. A taint file that cannot be read or does not
 * parse, and a folder that cannot be listed, count as a taint on `/`, so
 * every launch skips until the operator looks: a damaged record must not
 * clear a taint.
 */
export function readTaints(dir: string = taintDir()): Taint[] {
  let entries: TaintEntry[];
  try {
    entries = taintEntries(dir);
  } catch (cause) {
    return [damaged(`${dir} cannot be listed (${cause instanceof Error ? cause.message : String(cause)})`)];
  }
  return entries.map((entry) => entry.taint ?? damaged(`${entry.file} cannot be read or does not parse`));
}

function hashOf(workDir: string): string {
  return createHash("sha256").update(normalize(workDir)).digest("hex").slice(0, 24);
}

/** Adds a taint, in a file of its own. */
export function addTaint(taint: Taint, dir: string = taintDir()): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${hashOf(taint.workDir)}-${taint.run.replaceAll(/[^\w.-]/gu, "_")}.json`);
  const temp = `${file}.${String(process.pid)}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ v: 1, ...taint }, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, file);
}

/** Removes every taint of `workDir` (a real path) and gives what it removed. `/` removes the damaged files too. */
export function clearTaint(workDir: string, dir: string = taintDir()): Taint[] {
  const target = normalize(workDir);
  const cleared: Taint[] = [];
  for (const entry of taintEntries(dir)) {
    const taint = entry.taint ?? (target === "/" ? damaged(`${entry.file} cannot be read or does not parse`) : null);
    if (taint === null || normalize(taint.workDir) !== target) continue;
    unlinkSync(entry.file);
    cleared.push(taint);
  }
  return cleared;
}

function isWithin(path: string, dir: string): boolean {
  return path === dir || path.startsWith(dir === "/" ? "/" : `${dir}/`);
}

/** The taints that block a launch in `workDir` (a real path): one on it, on a folder above it, or on a folder in it. */
export function taintsOn(workDir: string, dir: string = taintDir()): Taint[] {
  const target = normalize(workDir);
  return readTaints(dir).filter((entry) => isWithin(target, entry.workDir) || isWithin(entry.workDir, target));
}

/** The `box-broken` reason for a launch a taint blocks: it names the run and the fix. */
export function taintReason(taint: Taint): string {
  return `the work dir ${taint.workDir} is tainted: the box could not settle what run ${taint.run} (${taint.project}) left there (${taint.reasons.join("; ")}); look at it, then run darius box clear ${taint.workDir}`;
}
