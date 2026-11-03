/**
 * Tainted work dirs (docs/concept.md, "The work dir's guarded files"). When
 * the post-run check cannot settle what a boxed run left in its work dir (a
 * rename that failed, a folder it could not read, a name that is not UTF-8,
 * its time cap, or a box that would not die), the work dir is tainted on this
 * host. While it is, every launch there skips as `box-broken`, boxed or not
 * (src/runner/box-launch.ts), until the operator looks and runs
 * `darius box clear <work dir>`.
 *
 * The record is host-local: `<state dir>/box/tainted.json`, outside every
 * project, so sync never carries it. A run in the box cannot write it: the
 * store is read-only there.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

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

/** `<state dir>/box/tainted.json`. */
export function taintFile(): string {
  return join(stateDir(), "box", "tainted.json");
}

type JsonRecord = { readonly [key: string]: JsonValue };

function isRecord(value: JsonValue | undefined): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

/** One taint from the file, or null when the entry is not one. */
function taintOf(value: JsonValue): Taint | null {
  if (!isRecord(value)) return null;
  const { workDir, run, project, at, reasons } = value;
  if (!isText(workDir) || !isText(run) || !isText(project) || !isText(at) || !Array.isArray(reasons)) return null;
  const texts = reasons.filter((reason) => isText(reason));
  if (texts.length !== reasons.length) return null;
  return { workDir, run, project, at, reasons: texts };
}

/**
 * Every taint on this host. A file that does not parse counts as one taint
 * on `/`, so every launch skips until the operator looks: a damaged record
 * must not clear a taint.
 */
export function readTaints(file: string = taintFile()): Taint[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const damaged: Taint = { workDir: "/", run: "?", project: "?", at: "?", reasons: [`${file} does not parse; fix it, or run darius box clear /`] };
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [damaged];
  }
  const list = isRecord(parsed) ? parsed.tainted : undefined;
  if (!Array.isArray(list)) return [damaged];
  const taints = list.map((entry) => taintOf(entry));
  return taints.every((entry) => entry !== null) ? taints : [damaged];
}

function writeTaints(taints: readonly Taint[], file: string): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${String(process.pid)}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ v: 1, tainted: taints }, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, file);
}

/** Adds a taint. A damaged record becomes its taint on `/`, so it is not lost: `darius box clear /` ends it. */
export function addTaint(taint: Taint, file: string = taintFile()): void {
  writeTaints([...readTaints(file), taint], file);
}

/** Removes every taint of `workDir` (a real path) and gives what it removed. */
export function clearTaint(workDir: string, file: string = taintFile()): Taint[] {
  const all = readTaints(file);
  const cleared = all.filter((entry) => entry.workDir === normalize(workDir));
  if (cleared.length > 0) writeTaints(all.filter((entry) => entry.workDir !== normalize(workDir)), file);
  return cleared;
}

function isWithin(path: string, dir: string): boolean {
  return path === dir || path.startsWith(dir === "/" ? "/" : `${dir}/`);
}

/** The taints that block a launch in `workDir` (a real path): one on it, on a folder above it, or on a folder in it. */
export function taintsOn(workDir: string, file: string = taintFile()): Taint[] {
  const dir = normalize(workDir);
  return readTaints(file).filter((entry) => isWithin(dir, entry.workDir) || isWithin(entry.workDir, dir));
}

/** The `box-broken` reason for a launch a taint blocks: it names the run and the fix. */
export function taintReason(taint: Taint): string {
  return `the work dir ${taint.workDir} is tainted: the box could not settle what run ${taint.run} (${taint.project}) left there (${taint.reasons.join("; ")}); look at it, then run darius box clear ${taint.workDir}`;
}
