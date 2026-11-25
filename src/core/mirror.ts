/**
 * Mirror sync (0.140.0): a host with `[sync] mirror = true` keeps a copy of
 * every project in the bucket, not only the ones it started with. The loop is
 * in src/cli/sync.ts (`darius sync --all-projects`); this file holds what the
 * loop and the rest of darius share.
 *
 * A mirrored copy is a normal synced project: it pulls and it pushes. What it
 * is not is a place to run work. The mirror made the project here without a
 * checkout, so src/core/workdir.ts never resolves it to the store dir or to an
 * import path. Run-due and the vigil sweep skip it as `no-workdir` until
 * `darius link` names a checkout on this host.
 *
 *   project.mirrored   A ledger line the mirror appends once per host, before
 *                      the first sync of the new project. It carries the host,
 *                      so "mirrored here" is the line from this host's id.
 *   mirror-failures.json  In the darius state dir, never synced: the prefixes
 *                      that failed, with the scrubbed error and the time. A
 *                      failed prefix is skipped for MIRROR_RETRY_MS, then tried
 *                      again. A success removes its entry.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { appendLine, defaultWho, hostId, readLedger } from "./ledger.ts";
import type { JsonValue, LedgerLine } from "./model.ts";
import { stateDir } from "./paths.ts";
import { isProjectName, type Project } from "./store.ts";

/** The ledger line that marks a project as a mirrored copy on the host that wrote it. */
export const MIRRORED_LINE = "project.mirrored";

/** A failed prefix is not tried again for this long. */
export const MIRROR_RETRY_MS = 24 * 60 * 60 * 1000;

/** One prefix the mirror could not sync. */
export interface MirrorFailure {
  project: string;
  /** A scrubbed one-line message. */
  error: string;
  /** ISO time of the failure. */
  at: string;
}

/** True when the ledger holds a `project.mirrored` line from this host. */
export function isMirroredHere(ledger: readonly LedgerLine[]): boolean {
  const here = hostId();
  return ledger.some((line) => line.type === MIRRORED_LINE && line.host === here);
}

/** Appends the `project.mirrored` line unless this host wrote one already. Returns true when it wrote one. */
export function markMirrored(project: Project): boolean {
  if (isMirroredHere(readLedger(project))) return false;
  appendLine(project, { who: defaultWho(), type: MIRRORED_LINE });
  return true;
}

function failuresFile(): string {
  return join(stateDir(), "mirror-failures.json");
}

function isJsonRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function decodeFailure(value: JsonValue): MirrorFailure | null {
  if (!isJsonRecord(value)) return null;
  const { project, error, at } = value;
  if (!isJsonText(project) || !isJsonText(error) || !isJsonText(at)) return null;
  return { project, error, at };
}

/** The recorded failures, oldest first. Empty when the file is missing or broken. */
export function readMirrorFailures(): MirrorFailure[] {
  const file = failuresFile();
  if (!existsSync(file)) return [];
  try {
    const parsed: JsonValue = JSON.parse(readFileSync(file, "utf8"));
    const failures = isJsonRecord(parsed) ? parsed.failures : undefined;
    if (!Array.isArray(failures)) return [];
    return failures.flatMap((one) => decodeFailure(one) ?? []);
  } catch {
    // A broken file is no record: the prefix is tried again, which is the safe way to be wrong.
    return [];
  }
}

function writeMirrorFailures(failures: readonly MirrorFailure[]): void {
  const file = failuresFile();
  mkdirSync(stateDir(), { recursive: true });
  const temp = `${file}.${String(process.pid)}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ v: 1, failures }, null, 2)}\n`);
  renameSync(temp, file);
}

/** Records one failure, replacing an older entry of the same project. */
export function recordMirrorFailure(failure: MirrorFailure): void {
  writeMirrorFailures([...readMirrorFailures().filter((one) => one.project !== failure.project), failure]);
}

/** Removes the entry of `project`, when there is one. */
export function clearMirrorFailure(project: string): void {
  const failures = readMirrorFailures();
  if (!failures.some((one) => one.project === project)) return;
  writeMirrorFailures(failures.filter((one) => one.project !== project));
}

/** True while `project` failed less than MIRROR_RETRY_MS before `now` (epoch ms). */
export function isInBackoff(failures: readonly MirrorFailure[], project: string, now: number): boolean {
  const failure = failures.find((one) => one.project === project);
  if (failure === undefined) return false;
  const failedAt = Date.parse(failure.at);
  // An unreadable time is no backoff: the prefix is tried again.
  return Number.isFinite(failedAt) && now - failedAt < MIRROR_RETRY_MS;
}

/** What the mirror needs to choose its prefixes. */
export interface MirrorChoice {
  /** The prefixes the bucket listing returned, each ending with `/`. */
  prefixes: readonly string[];
  /** `[sync] mirror_exclude`. */
  exclude: readonly string[];
  /** The projects this host has (listProjects). */
  local: readonly string[];
  failures: readonly MirrorFailure[];
  /** Epoch ms. */
  now: number;
}

/** The projects to mirror in this run: valid names, not excluded, not here, not in backoff. Sorted. */
export function chooseMirrorProjects(choice: MirrorChoice): string[] {
  const names = choice.prefixes.map((prefix) => prefix.replace(/\/$/u, ""));
  return names
    .filter((name) => isProjectName(name))
    .filter((name) => !choice.exclude.includes(name) && !choice.local.includes(name))
    .filter((name) => !isInBackoff(choice.failures, name, choice.now))
    .toSorted();
}
