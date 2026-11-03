/**
 * What outlives a runner that dies mid-run (docs/concept.md, "The work dir's
 * guarded files"). Two host-local records in `<state dir>/box/`, outside
 * every project, so sync never carries them, and read-only in the box:
 *
 *   - `pending/<run>.json`: one boxed launch whose post-run check has not
 *     finished. Written before anything of the run starts in the box, removed
 *     after the check settled the work dir or tainted it. It holds what the
 *     check needs (the work dir, the guard ids of the launch scan, the box
 *     dir) and the runner's pid and start time. The next launch in that work
 *     dir, or in a folder above or below, finds a record whose runner is dead
 *     (OOM, Ctrl-C, a reboot), reaps that box and runs its check.
 *   - `locks/<hash of the work dir>.lock`: one launch from its first step to
 *     the end of its check. A launch in the same work dir, or in a folder
 *     above or below, does not start while it is held.
 *
 * A process is the same one when its pid and its start time (field 22 of
 * /proc/<pid>/stat, in clock ticks since boot) both match: a pid alone can
 * be reused, after a reboot too.
 */

import { createHash } from "node:crypto";
import { linkSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, normalize } from "node:path";

import type { JsonValue } from "./model.ts";
import { stateDir } from "./paths.ts";

/** One process: its pid and its start time. */
export interface ProcId {
  pid: number;
  start: string;
}

/** A lock or a takeover file this old with a holder that cannot be read is stale: a writer takes milliseconds. */
const DAMAGED_STALE_MS = 60_000;
/** Rounds of create, read, take over. */
const LOCK_TRIES = 3;

/** The start time of `pid`, or undefined when no such process is there. */
export function procStart(pid: number): string | undefined {
  try {
    const text = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
    // The name in field 2 may hold spaces and parentheses; the fields after it follow its last ") ".
    const rest = text.slice(text.lastIndexOf(") ") + 2).split(" ");
    return rest[19];
  } catch {
    return undefined;
  }
}

/** This process. */
export function selfProc(): ProcId {
  return { pid: process.pid, start: procStart(process.pid) ?? "?" };
}

/** True when the process is still the one that wrote the record. */
export function isAlive(proc: ProcId): boolean {
  const start = procStart(proc.pid);
  return start !== undefined && start === proc.start;
}

function isWithin(path: string, dir: string): boolean {
  return path === dir || path.startsWith(dir === "/" ? "/" : `${dir}/`);
}

/** True when one of two real paths is the other or holds it. */
export function overlaps(a: string, b: string): boolean {
  return isWithin(normalize(a), normalize(b)) || isWithin(normalize(b), normalize(a));
}

type JsonRecord = { readonly [key: string]: JsonValue };

function isRecord(value: JsonValue | undefined): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isCount(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isFlag(value: JsonValue | undefined): value is boolean {
  return typeof value === "boolean";
}

function codeOf(cause: unknown): string | undefined {
  if (!(cause instanceof Error) || !("code" in cause)) return undefined;
  return cause.code === "ENOENT" ? "ENOENT" : cause.code === "EEXIST" ? "EEXIST" : "other";
}

function safeName(run: string): string {
  return run.replaceAll(/[^\w.-]/gu, "_");
}

// --- pending records ----------------------------------------------------------------

/** One boxed launch whose post-run check has not finished. */
export interface PendingBox {
  run: string;
  project: string;
  /** The run dir in the store: the check writes its lines to run.log there. */
  runDir: string;
  /** The work dir's real path. */
  workDir: string;
  /** The guard ids of the launch scan (`WorkScan.ids`). */
  ids: string[];
  isBareTop: boolean;
  /** The box dir the outer bwrap names: the reap finds the box by it. */
  boxDir: string;
  isWorkReadOnly: boolean;
  /** The runner. */
  pid: number;
  start: string;
  at: string;
}

/** `<state dir>/box/pending`. */
export function pendingDir(): string {
  return join(stateDir(), "box", "pending");
}

/** Writes a pending record whole: a reader sees the old file or the new one. Throws when it cannot. */
export function writePending(record: PendingBox, dir: string = pendingDir()): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${safeName(record.run)}.json`);
  const temp = `${file}.${String(process.pid)}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ v: 1, ...record }, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, file);
  return file;
}

/** Removes a pending record; one that is gone already is fine. */
export function removePending(file: string): void {
  try {
    unlinkSync(file);
  } catch (cause) {
    if (codeOf(cause) !== "ENOENT") throw cause;
  }
}

function pendingOf(value: JsonValue): PendingBox | undefined {
  if (!isRecord(value)) return undefined;
  const { run, project, runDir, workDir, ids, isBareTop, boxDir, isWorkReadOnly, pid, start, at } = value;
  if (!isText(run) || !isText(project) || !isText(runDir) || !isText(workDir) || !isText(boxDir) || !isText(start) || !isText(at)) return undefined;
  if (!isFlag(isBareTop) || !isFlag(isWorkReadOnly) || !isCount(pid) || !Array.isArray(ids)) return undefined;
  const texts = ids.filter((id) => isText(id));
  if (texts.length !== ids.length) return undefined;
  return { run, project, runDir, workDir, ids: texts, isBareTop, boxDir, isWorkReadOnly, pid, start, at };
}

/** One pending file: its record, or `damaged` when it cannot be read or does not parse. */
export type PendingEntry = { file: string; record: PendingBox } | { file: string; damaged: string };

/** Every pending record on this host. A folder that cannot be listed (not missing) throws. */
export function readPending(dir: string = pendingDir()): PendingEntry[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (cause) {
    if (codeOf(cause) === "ENOENT") return [];
    throw cause;
  }
  const entries: PendingEntry[] = [];
  for (const name of names.filter((entry) => entry.endsWith(".json")).toSorted()) {
    const file = join(dir, name);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (cause) {
      if (codeOf(cause) === "ENOENT") continue;
      entries.push({ file, damaged: `${file} cannot be read` });
      continue;
    }
    let parsed: JsonValue;
    try {
      parsed = JSON.parse(text);
    } catch {
      entries.push({ file, damaged: `${file} does not parse` });
      continue;
    }
    const record = pendingOf(parsed);
    entries.push(record === undefined ? { file, damaged: `${file} is not a pending record` } : { file, record });
  }
  return entries;
}

// --- the work dir lock --------------------------------------------------------------

/** The holder of a lock. */
interface Holder extends ProcId {
  workDir: string;
  run: string;
}

/** A lock this launch holds. `release` is safe to call twice. */
export interface WorkLock {
  file: string;
  release(): void;
}

/** `<state dir>/box/locks`. */
export function lockDir(): string {
  return join(stateDir(), "box", "locks");
}

function holderOf(file: string): Holder | "gone" | "damaged" {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (cause) {
    return codeOf(cause) === "ENOENT" ? "gone" : "damaged";
  }
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "damaged";
  }
  if (!isRecord(parsed)) return "damaged";
  const { pid, start, workDir, run } = parsed;
  if (!isCount(pid) || !isText(start) || !isText(workDir) || !isText(run)) return "damaged";
  return { pid, start, workDir, run };
}

function isOld(file: string): boolean {
  try {
    return Date.now() - statSync(file).mtimeMs > DAMAGED_STALE_MS;
  } catch {
    return true;
  }
}

function isSame(a: Holder, b: Holder): boolean {
  return a.pid === b.pid && a.start === b.start && a.run === b.run;
}

/** Makes `file` hold `holder`, whole, or returns false when it is there: a link of a full temp file, never a half-written one. */
function createWhole(file: string, holder: Holder): boolean {
  const temp = `${file}.${String(process.pid)}.${String(Date.now())}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ v: 1, ...holder, at: new Date().toISOString() })}\n`, { mode: 0o600 });
  try {
    linkSync(temp, file);
    return true;
  } catch (cause) {
    if (codeOf(cause) === "EEXIST") return false;
    throw cause;
  } finally {
    unlinkSync(temp);
  }
}

function unlinkQuietly(file: string): void {
  try {
    unlinkSync(file);
  } catch {
    // Gone already.
  }
}

function busyReason(workDir: string, holder: Holder): string {
  return `the work dir ${workDir} is in use: run ${holder.run} (pid ${String(holder.pid)}) holds the box lock on ${holder.workDir}, and a launch there or in a folder above or below waits until it ends`;
}

/** True when a holder is gone for good: dead, or a damaged file left long ago. */
function isStale(file: string, holder: Holder | "damaged"): boolean {
  return holder === "damaged" ? isOld(file) : !isAlive(holder);
}

/**
 * Removes the stale lock `file` (its holder dead) under a takeover file, so
 * two launches that both saw it stale cannot both remove it: only one holds
 * the takeover, and the other then sees the new lock. Gives a busy reason
 * when another launch is taking it over now.
 */
function takeOver(file: string, stale: Holder | "damaged", me: Holder): string | undefined {
  const takeover = `${file}.takeover`;
  if (!createWhole(takeover, me)) {
    const other = holderOf(takeover);
    if (other !== "gone" && !isStale(takeover, other)) return `the work dir ${me.workDir} is in use: another launch takes over its box lock now`;
    // A taker that died midway: its file goes, and the next round tries again.
    unlinkQuietly(takeover);
    return undefined;
  }
  try {
    const now = holderOf(file);
    const isStill = now === "damaged" ? stale === "damaged" && isOld(file) : now !== "gone" && stale !== "damaged" && isSame(now, stale);
    if (isStill) unlinkQuietly(file);
  } finally {
    unlinkQuietly(takeover);
  }
  return undefined;
}

/** The lock of another live launch in a folder above or below `workDir`, or undefined. */
function overlapping(dir: string, own: string, workDir: string): Holder | undefined {
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".lock") || join(dir, name) === own) continue;
    const holder = holderOf(join(dir, name));
    if (holder === "gone" || holder === "damaged") continue;
    if (overlaps(holder.workDir, workDir) && isAlive(holder)) return holder;
  }
  return undefined;
}

/**
 * Takes the lock of `workDir` (a real path) for `run`. Gives `busy` with the
 * reason when another live launch holds it, or holds the lock of a folder
 * above or below. A lock whose holder is dead is taken over; what that
 * holder's launch left is the pending record's to settle, which the caller
 * does next, under this lock.
 */
export function takeLock(input: { workDir: string; run: string; dir?: string }): { lock: WorkLock } | { busy: string } {
  const dir = input.dir ?? lockDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const workDir = normalize(input.workDir);
  const file = join(dir, `${createHash("sha256").update(workDir).digest("hex").slice(0, 24)}.lock`);
  const me: Holder = { ...selfProc(), workDir, run: input.run };
  let isTaken = false;
  for (let tries = 0; tries < LOCK_TRIES && !isTaken; tries += 1) {
    if (createWhole(file, me)) {
      isTaken = true;
      continue;
    }
    const holder = holderOf(file);
    if (holder === "gone") continue;
    if (!isStale(file, holder)) return { busy: holder === "damaged" ? `the work dir ${workDir} is in use: its box lock ${file} is being written` : busyReason(workDir, holder) };
    const busy = takeOver(file, holder, me);
    if (busy !== undefined) return { busy };
  }
  if (!isTaken) return { busy: `the work dir ${workDir} is in use: its box lock ${file} could not be taken` };
  let isReleased = false;
  const lock: WorkLock = {
    file,
    release: () => {
      if (isReleased) return;
      isReleased = true;
      const now = holderOf(file);
      if (now !== "gone" && now !== "damaged" && isSame(now, me)) unlinkQuietly(file);
    },
  };
  // Made first, then checked: of two launches that overlap, at least the later one sees the other.
  const other = overlapping(dir, file, workDir);
  if (other !== undefined) {
    lock.release();
    return { busy: busyReason(workDir, other) };
  }
  return { lock };
}
