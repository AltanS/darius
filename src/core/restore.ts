/**
 * `darius restore`: bring a host's store back from a snapshot
 * (docs/backups.md, "Restore"; docs/concept.md, "Backup").
 *
 * Two modes:
 *
 *   full        the whole store. The archive is unpacked next to the store
 *               (`<state dir>.restoring-<stamp>`, same filesystem), checked,
 *               then the live store is renamed to
 *               `<state dir>.before-restore-<stamp>` and the new one renamed
 *               into place. The old store is never deleted.
 *   runs-only   only `<project>/runs/<run>` folders, into the live store. A
 *               run folder that exists is skipped, a project the live store
 *               lacks is skipped, and nothing outside `runs/` is written.
 *               This is the lost-host path: sync already pulled the rest.
 *
 * Before anything is written, every check runs: the manifest sits beside the
 * archive, the archive's SHA-256 equals the manifest's, the snapshot is of
 * this host (or `--from-host` names its host), no darius unit is active, no
 * snapshot run and no project lock is held, and every archive entry is a
 * plain file or folder with a relative path and no `..`. The archive is read
 * by src/core/tar-read.ts, not the system `tar`, so a bad path never reaches
 * the disk.
 *
 * Tar may cut a file that is appended while it reads it. Items and closed
 * ledger chunks are written by rename and cannot be cut; `open.jsonl` and a
 * run's `gate.jsonl` can. Each of those may lose one cut trailing line (no
 * closing newline, not valid JSON): it is trimmed and reported. Any other bad
 * line in a ledger file means a damaged archive (exit 1). A bad line inside
 * a `gate.jsonl` is only a warning, since it is a run log.
 *
 * `sync.json` is kept when it parses: the next sync pulls every chunk the
 * bucket got since the snapshot, and pushes only chunks the bucket has not
 * seen. A restored `open.jsonl` closes into a chunk with a fresh name, so it
 * never collides with a chunk in the bucket; lines already there come back
 * with the same text, which the ledger read accepts. A `sync.json` that does
 * not parse is removed with a notice (the next sync pulls everything again).
 * The `.lock` files of the snapshot belong to dead processes and are dropped.
 *
 * The verb never runs `sync`. After a full restore it prints the next steps.
 */

import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, join, resolve as resolvePath } from "node:path";

import { errorMessage } from "../runtime.ts";
import { appendLine, defaultWho, parseLedgerText } from "./ledger.ts";
import type { JsonValue } from "./model.ts";
import { runningSnapshot } from "./snapshot.ts";
import { GLOBAL_PROJECT, openProject } from "./store.ts";
import { readTarGz, type TarEntry, type TarSink } from "./tar-read.ts";

/**
 * Every unit that touches the store. A full restore refuses while any is
 * active. A timer starts a oneshot service that keeps running after its timer
 * stops (run-due runs agent batches for a long time), so the services count too.
 */
export const RESTORE_UNITS: readonly string[] = [
  "darius-web.service",
  "darius-sync.timer",
  "darius-run-due.timer",
  "darius-vigil-sweep.timer",
  "darius-snapshot.timer",
  "darius-sync.service",
  "darius-run-due.service",
  "darius-vigil-sweep.service",
  "darius-snapshot.service",
];
/** run-due reads `runs/`, so `--runs-only` refuses while its timer or its service is active. */
export const RUNS_ONLY_UNITS: readonly string[] = ["darius-run-due.timer", "darius-run-due.service"];

const unitWord = (unit: string): string => (unit === "darius-web.service" ? "darius-web" : unit);
export const STOP_LINE = `systemctl --user stop ${RESTORE_UNITS.map(unitWord).join(" ")}`;
/** Only the web service and the timers start again: a started oneshot service would run at once. */
export const START_LINE = `systemctl --user start ${RESTORE_UNITS.filter((unit) => !unit.endsWith(".service") || unit === "darius-web.service")
  .map(unitWord)
  .join(" ")}`;

const CHUNK_FILE = /^[0-9A-HJKMNP-TV-Z]{26}\.jsonl$/u;
const LOCK_STALE_MS = 30_000;

export type RestoreMode = "full" | "runs-only";

export interface RestoreCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface RestoreProjectCount {
  name: string;
  files: number;
  bytes: number;
  runs: number;
}

export interface RestoreReport {
  code: 0 | 1;
  ok: boolean;
  mode: RestoreMode;
  dry_run: boolean;
  archive: string;
  name: string;
  host: string | null;
  snapshot_at: string | null;
  checks: RestoreCheck[];
  projects: RestoreProjectCount[];
  /** Files that lost one cut trailing line. */
  trimmed: string[];
  /** Files that only lacked their closing newline: it is added. */
  newline_added: string[];
  notices: string[];
  /** Full: where the old store went, or null when there was none. */
  moved_to: string | null;
  /** Runs-only: run folders restored and skipped. */
  restored: number;
  skipped: number;
  skipped_runs: string[];
  next: string[];
  error: string | null;
}

export interface RestoreDeps {
  /** True when the user unit is active or busy. Throws when systemd cannot be asked. */
  unitActive(unit: string): boolean;
  stdinIsTTY(): boolean;
  /** Asks one question on the terminal and returns the answer. */
  ask(question: string): Promise<string>;
  now(): Date;
  /** For a test: the rename of the store folders. Default renameSync. */
  renameDir?: (from: string, to: string) => void;
}

export interface RestoreOptions {
  /** A path to the archive, or a snapshot name in `snapshotDir`. */
  target: string;
  mode: RestoreMode;
  fromHost?: string;
  dryRun: boolean;
  yes: boolean;
  stateDir: string;
  snapshotDir: string;
  host: string;
  /** The ritual run this process belongs to (`DARIUS_RUN`), if any. A run never restores. */
  run?: string;
}

interface Manifest {
  name: string;
  host: string;
  at: string;
  bytes: number;
  sha256: string;
}

/** A file of the archive whose text the checks read: ledger files, run logs, sync.json. */
interface Captured {
  path: string;
  chunks: Buffer[];
}

interface Scan {
  projects: Map<string, RestoreProjectCount>;
  /** `<project>/runs/<run>` for every run folder (or file) in the archive. */
  runs: Set<string>;
  captured: Map<string, string>;
}

/** What the checks decided to change in the unpacked files. */
interface Fixes {
  rewrite: Map<string, string>;
  remove: Set<string>;
  trimmed: string[];
  newlineAdded: string[];
  notices: string[];
}

// --- small helpers -------------------------------------------------------------------------

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}/u, "");
}

function isRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isCount(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const keepAll = (): boolean => true;

function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => {
        resolve(hash.digest("hex"));
      });
  });
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return cause instanceof Error && "code" in cause && cause.code === "EPERM";
  }
}

/**
 * The archive path relative to the store, or a reason it is refused. An
 * empty string is the store's root (`./`).
 */
export function safeEntryPath(raw: string): { ok: true; path: string } | { ok: false; error: string } {
  if (raw.startsWith("/")) return { ok: false, error: `${raw}: an absolute path` };
  const parts = raw.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.includes("..")) return { ok: false, error: `${raw}: a path with ..` };
  return { ok: true, path: parts.join("/") };
}

/** `<project>/runs/<run>` for a path inside a run folder, else null. */
function runKey(path: string): string | null {
  const [project, runs, run] = path.split("/");
  return project !== undefined && runs === "runs" && run !== undefined ? `${project}/runs/${run}` : null;
}

function isLedgerFile(path: string): boolean {
  const parts = path.split("/");
  const file = parts[3];
  return parts.length === 4 && parts[1] === "ledger" && file !== undefined && (file === "open.jsonl" || CHUNK_FILE.test(file));
}

function isGateLog(path: string): boolean {
  const parts = path.split("/");
  return parts.length === 4 && parts[1] === "runs" && parts[3] === "gate.jsonl";
}

function isSyncState(path: string): boolean {
  const parts = path.split("/");
  return parts.length === 2 && parts[1] === "sync.json";
}

// --- resolve the archive and its manifest --------------------------------------------------------

function resolveArchive(target: string, snapshotDir: string): string {
  if (target.includes("/")) return target;
  const named = join(snapshotDir, target);
  return existsSync(named) || !existsSync(target) ? named : target;
}

function readManifest(path: string): { ok: true; manifest: Manifest } | { ok: false; error: string } {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    return { ok: false, error: `${path}: ${errorMessage(cause)}` };
  }
  if (!isRecord(parsed)) return { ok: false, error: `${path}: not a manifest` };
  const { name, host, at, bytes, sha256 } = parsed;
  if (!isText(host) || !isText(sha256) || !/^[0-9a-f]{64}$/u.test(sha256) || !isCount(bytes)) {
    return { ok: false, error: `${path}: the manifest lacks host, bytes or sha256` };
  }
  return { ok: true, manifest: { name: isText(name) ? name : basename(path, ".json"), host, at: isText(at) ? at : "", bytes, sha256 } };
}

// --- the checks before any write ------------------------------------------------------------------

function unitCheck(units: readonly string[], deps: RestoreDeps): RestoreCheck {
  const active: string[] = [];
  try {
    for (const unit of units) if (deps.unitActive(unit)) active.push(unit);
  } catch (cause) {
    return { name: "units", ok: false, detail: `cannot ask systemd (${errorMessage(cause)}); stop the units by hand: ${STOP_LINE}` };
  }
  if (active.length === 0) return { name: "units", ok: true, detail: `none active (${units.join(", ")})` };
  return { name: "units", ok: false, detail: `active: ${active.join(", ")}; stop them first: ${STOP_LINE}` };
}

/** Projects whose `.lock` a live process holds. A lock of a dead process here, or over 30 s old, does not count. */
export function heldStoreLocks(stateDir: string, now: number = Date.now()): string[] {
  if (!existsSync(stateDir)) return [];
  const held: string[] = [];
  const here = hostname();
  for (const entry of readdirSync(stateDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const lock = join(stateDir, entry.name, ".lock");
    const stats = lstatSync(lock, { throwIfNoEntry: false });
    if (stats === undefined) continue;
    let text = "";
    try {
      text = readFileSync(lock, "utf8");
    } catch {
      text = "";
    }
    const [pidText, lockHost] = text.trim().split(" ");
    const pid = Number.parseInt(pidText ?? "", 10);
    const alive = lockHost === here && Number.isInteger(pid) && pid > 0 ? pidAlive(pid) : now - stats.mtimeMs < LOCK_STALE_MS;
    if (alive) held.push(entry.name);
  }
  return held;
}

/** Reads every entry once: counts per project, refuses bad entries, keeps the text of the files the checks read. */
async function scanArchive(archive: string): Promise<Scan> {
  const scan: Scan = { projects: new Map(), runs: new Set(), captured: new Map() };
  const problems: string[] = [];
  await readTarGz(archive, (entry: TarEntry): TarSink | null => {
    const safe = safeEntryPath(entry.rawPath);
    if (!safe.ok) {
      problems.push(safe.error);
      return null;
    }
    const { path } = safe;
    if (entry.type !== "file" && entry.type !== "dir") {
      problems.push(`${entry.rawPath}: a ${entry.type === "other" ? `type ${entry.flag || "?"}` : entry.type} entry`);
      return null;
    }
    if (path === "") return null;
    const top = path.includes("/") ? (path.split("/")[0] ?? path) : entry.type === "dir" ? path : "(top level)";
    const count = scan.projects.get(top) ?? { name: top, files: 0, bytes: 0, runs: 0 };
    scan.projects.set(top, count);
    const run = runKey(path);
    if (run !== null && !scan.runs.has(run)) {
      scan.runs.add(run);
      count.runs += 1;
    }
    if (entry.type === "dir") return null;
    count.files += 1;
    count.bytes += entry.size;
    if (!isLedgerFile(path) && !isGateLog(path) && !isSyncState(path)) return null;
    const captured: Captured = { path, chunks: [] };
    return {
      data: (chunk) => captured.chunks.push(Buffer.from(chunk)),
      end: () => {
        scan.captured.set(captured.path, Buffer.concat(captured.chunks).toString("utf8"));
      },
    };
  });
  if (problems.length > 0) {
    const shown = problems.slice(0, 5).join("; ");
    throw new RefusedArchive(`the archive holds entries restore refuses (${shown}${problems.length > 5 ? `; ${String(problems.length - 5)} more` : ""}); restore it by hand if you trust it`);
  }
  return scan;
}

class RefusedArchive extends Error {}

type LineCheck = (row: string, where: string) => void;

const ledgerLine: LineCheck = (row, where) => {
  parseLedgerText(row, where);
};

const jsonLine: LineCheck = (row, where) => {
  try {
    JSON.parse(row);
  } catch (cause) {
    throw new Error(`${where}: not valid JSON`, { cause });
  }
};

/**
 * The tail rule for an appended file: a last line without its newline is
 * trimmed when it does not parse, and gets its newline when it does. Returns
 * the fixed text, or null when nothing changes. The rest is not checked here.
 */
export function fixTail(text: string, path: string, check: LineCheck): { text: string; trimmed: boolean } | null {
  if (text === "" || text.endsWith("\n")) return null;
  const cut = text.lastIndexOf("\n");
  const last = text.slice(cut + 1);
  try {
    check(last, `${path}:last`);
    return { text: `${text}\n`, trimmed: false };
  } catch {
    return { text: text.slice(0, cut + 1), trimmed: true };
  }
}

function checkCaptured(scan: Scan, mode: RestoreMode, runsKept: ReadonlySet<string>): Fixes {
  const fixes: Fixes = { rewrite: new Map(), remove: new Set(), trimmed: [], newlineAdded: [], notices: [] };
  const byProject = new Map<string, Map<string, { text: string; where: string }>>();
  for (const [path, original] of [...scan.captured].toSorted(([a], [b]) => a.localeCompare(b))) {
    if (isSyncState(path)) {
      if (mode === "full" && !syncStateParses(original)) {
        fixes.remove.add(path);
        fixes.notices.push(`${path} does not parse; it is removed, so the next sync pulls everything again`);
      }
      continue;
    }
    if (isGateLog(path)) {
      const run = runKey(path);
      if (mode === "runs-only" && (run === null || !runsKept.has(run))) continue;
      let text = original;
      const tail = fixTail(text, path, jsonLine);
      if (tail !== null) {
        text = tail.text;
        fixes.rewrite.set(path, text);
        (tail.trimmed ? fixes.trimmed : fixes.newlineAdded).push(path);
      }
      for (const [index, row] of text.split("\n").entries()) {
        if (row.trim() === "") continue;
        try {
          JSON.parse(row);
        } catch {
          fixes.notices.push(`${path}:${String(index + 1)} is not valid JSON; the run log is kept as it is`);
        }
      }
      continue;
    }
    if (mode !== "full") continue;
    // A ledger file. Only open.jsonl is appended, so only it may lose a cut line.
    let text = original;
    if (path.endsWith("/open.jsonl")) {
      const tail = fixTail(text, path, ledgerLine);
      if (tail !== null) {
        text = tail.text;
        fixes.rewrite.set(path, text);
        (tail.trimmed ? fixes.trimmed : fixes.newlineAdded).push(path);
      }
    }
    const lines = parseLedgerText(text, path);
    const project = path.split("/")[0] ?? "";
    const seen = byProject.get(project) ?? new Map<string, { text: string; where: string }>();
    byProject.set(project, seen);
    for (const line of lines) {
      const lineText = JSON.stringify(line);
      const before = seen.get(line.id);
      if (before === undefined) seen.set(line.id, { text: lineText, where: path });
      else if (before.text !== lineText) throw new Error(`${path}: line ${line.id} differs from the line with the same id in ${before.where}`);
    }
  }
  return fixes;
}

function syncStateParses(text: string): boolean {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  if (!isRecord(parsed)) return false;
  const { seen, base } = parsed;
  if (seen !== undefined && !(Array.isArray(seen) && seen.every(isText))) return false;
  return base === undefined || isRecord(base);
}

// --- writing ----------------------------------------------------------------------------------------

/** Refuses to write through a symlink anywhere between `root` and `path`. */
function assertNoLink(root: string, relative: string): void {
  let at = root;
  for (const part of relative.split("/").slice(0, -1)) {
    at = join(at, part);
    if (lstatSync(at, { throwIfNoEntry: false })?.isSymbolicLink() === true) throw new Error(`${at}: a symlink in the way; nothing is written through it`);
  }
}

/** Unpacks the entries `keep` accepts into `root`. Files are created new (`wx`), never overwritten. */
async function extract(archive: string, root: string, keep: (path: string) => boolean): Promise<void> {
  const times: { path: string; mtime: number }[] = [];
  await readTarGz(archive, (entry): TarSink | null => {
    const safe = safeEntryPath(entry.rawPath);
    if (!safe.ok) throw new RefusedArchive(safe.error);
    const { path } = safe;
    if (path === "" || !keep(path)) return null;
    if (entry.type !== "file" && entry.type !== "dir") throw new RefusedArchive(`${entry.rawPath}: not a file or a folder`);
    assertNoLink(root, path);
    const target = join(root, path);
    if (entry.type === "dir") {
      mkdirSync(target, { recursive: true, mode: 0o700 });
      return null;
    }
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    const fd = openSync(target, "wx", entry.mode & 0o777 || 0o600);
    times.push({ path: target, mtime: entry.mtime });
    return {
      data: (chunk) => {
        let written = 0;
        while (written < chunk.length) written += writeSync(fd, chunk, written);
      },
      end: () => {
        closeSync(fd);
      },
    };
  });
  for (const { path, mtime } of times) utimesSync(path, mtime, mtime);
}

function applyFixes(root: string, fixes: Fixes, keep: (path: string) => boolean): void {
  for (const [path, text] of fixes.rewrite) if (keep(path)) writeFileSync(join(root, path), text);
  for (const path of fixes.remove) if (keep(path)) rmSync(join(root, path), { force: true });
}

/** Drops the snapshot's `.lock` files: they belong to processes of the past. */
function dropLocks(root: string): number {
  let dropped = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const name of [".lock", ".lock.takeover"]) {
      const lock = join(root, entry.name, name);
      if (lstatSync(lock, { throwIfNoEntry: false }) === undefined) continue;
      rmSync(lock, { force: true });
      dropped += 1;
    }
  }
  return dropped;
}

// --- the verb ---------------------------------------------------------------------------------------

function emptyReport(options: RestoreOptions, archive: string): RestoreReport {
  return {
    code: 1,
    ok: false,
    mode: options.mode,
    dry_run: options.dryRun,
    archive,
    name: basename(archive),
    host: null,
    snapshot_at: null,
    checks: [],
    projects: [],
    trimmed: [],
    newline_added: [],
    notices: [],
    moved_to: null,
    restored: 0,
    skipped: 0,
    skipped_runs: [],
    next: [],
    error: null,
  };
}

function refuse(report: RestoreReport, error: string): RestoreReport {
  report.code = 1;
  report.ok = false;
  report.error = error;
  return report;
}

function firstFailure(checks: readonly RestoreCheck[]): RestoreCheck | undefined {
  return checks.find((check) => !check.ok);
}

/** The checks that can change while restore reads the archive or waits for an answer: units, the snapshot lock, store locks. */
function guardChecks(options: RestoreOptions, deps: RestoreDeps): RestoreCheck[] {
  const checks = [unitCheck(options.mode === "full" ? RESTORE_UNITS : RUNS_ONLY_UNITS, deps)];
  const running = runningSnapshot(options.snapshotDir);
  checks.push(
    running === null
      ? { name: "snapshot run", ok: true, detail: "none running" }
      : { name: "snapshot run", ok: false, detail: `a snapshot run holds the lock (pid ${String(running.pid)}, since ${running.startedAt}); wait for it` },
  );
  const held = heldStoreLocks(options.stateDir);
  checks.push(
    held.length === 0
      ? { name: "store locks", ok: true, detail: "none held" }
      : { name: "store locks", ok: false, detail: `a live process holds the lock of ${held.join(", ")}; wait for it to end` },
  );
  return checks;
}

const BY_HAND = "restore it by hand: docs/backups.md, Restore, By hand";

/**
 * Why a full restore cannot rename the live store, or null. A symlink would
 * be renamed instead of the folder it points to, and a mount point cannot be
 * renamed at all.
 */
export function liveStoreProblem(stateDir: string): string | null {
  const live = resolvePath(stateDir);
  const stats = lstatSync(live, { throwIfNoEntry: false });
  if (stats === undefined) return null;
  if (stats.isSymbolicLink()) return `${live} is a symlink; restore does not rename it. Point DARIUS_STATE_DIR at the real folder, or ${BY_HAND}`;
  if (!stats.isDirectory()) return `${live} is not a folder`;
  const parent = statSync(dirname(live));
  if (parent.dev !== stats.dev) return `${live} is a mount point; restore cannot rename it. ${BY_HAND}`;
  return null;
}

/** Every check that needs no archive read: manifest, host, units, locks. */
function preflight(options: RestoreOptions, archive: string, deps: RestoreDeps, report: RestoreReport): Manifest | null {
  if (options.run !== undefined && options.run !== "") {
    report.checks.push({ name: "caller", ok: false, detail: `this is ritual run ${options.run}; only a person restores, never a run` });
    return null;
  }
  const manifestPath = `${archive}.json`;
  const size = statSync(archive, { throwIfNoEntry: false });
  if (size === undefined || !size.isFile()) {
    report.checks.push({ name: "archive", ok: false, detail: `${archive}: no such file; fetch it first: darius snapshot fetch <name>` });
    return null;
  }
  if (!existsSync(manifestPath)) {
    report.checks.push({ name: "manifest", ok: false, detail: `${manifestPath} is missing; fetch both files: darius snapshot fetch ${basename(archive)}` });
    return null;
  }
  const read = readManifest(manifestPath);
  if (!read.ok) {
    report.checks.push({ name: "manifest", ok: false, detail: read.error });
    return null;
  }
  const { manifest } = read;
  report.host = manifest.host;
  report.snapshot_at = manifest.at;
  report.name = manifest.name;
  report.checks.push({
    name: "size",
    ok: size.size === manifest.bytes,
    detail: size.size === manifest.bytes ? `${String(size.size)} bytes` : `the file has ${String(size.size)} bytes, the manifest says ${String(manifest.bytes)}`,
  });

  const fromHost = options.fromHost;
  if (manifest.host === options.host) report.checks.push({ name: "host", ok: true, detail: `a snapshot of this host (${options.host})` });
  else if (fromHost === manifest.host) report.checks.push({ name: "host", ok: true, detail: `a snapshot of ${manifest.host}, restored on ${options.host} (--from-host)` });
  else {
    report.checks.push({
      name: "host",
      ok: false,
      detail: `a snapshot of ${manifest.host}, not of this host (${options.host}); its ledger stays under ${manifest.host} and is never pushed from here. If you mean it: --from-host ${manifest.host}`,
    });
  }

  if (options.mode === "full") {
    const where = liveStoreProblem(options.stateDir);
    if (where !== null) report.checks.push({ name: "store", ok: false, detail: where });
  }
  report.checks.push(...guardChecks(options, deps));
  if (options.mode === "runs-only" && !existsSync(options.stateDir)) {
    report.checks.push({ name: "store", ok: false, detail: `${options.stateDir}: no store; sync first (darius sync --all-projects), then restore the runs` });
  }
  return manifest;
}

async function confirm(options: RestoreOptions, deps: RestoreDeps, report: RestoreReport): Promise<boolean> {
  if (options.yes) return true;
  if (!deps.stdinIsTTY()) {
    report.checks.push({ name: "confirmation", ok: false, detail: "no --yes, and stdin is not a terminal; run it again with --yes" });
    return false;
  }
  const what = options.mode === "full" ? `replace the store ${options.stateDir} with ${report.name}` : `add the run folders of ${report.name} to ${options.stateDir}`;
  const answer = await deps.ask(`This will ${what}. Type yes to go on: `);
  const ok = answer.trim() === "yes";
  report.checks.push({ name: "confirmation", ok, detail: ok ? "yes" : "not confirmed" });
  return ok;
}

/** Runs every check, then (unless `dryRun` or a check fails) the restore. Never throws. */
export async function runRestore(options: RestoreOptions, deps: RestoreDeps): Promise<RestoreReport> {
  const archive = resolveArchive(options.target, options.snapshotDir);
  const report = emptyReport(options, archive);
  try {
    return await restoreChecked(options, deps, archive, report);
  } catch (cause) {
    return refuse(report, errorMessage(cause));
  }
}

async function restoreChecked(options: RestoreOptions, deps: RestoreDeps, archive: string, report: RestoreReport): Promise<RestoreReport> {
  const manifest = preflight(options, archive, deps, report);
  const early = firstFailure(report.checks);
  if (manifest === null || early !== undefined) return refuse(report, early?.detail ?? "refused");

  const sha = await hashFile(archive);
  if (sha !== manifest.sha256) {
    report.checks.push({ name: "sha256", ok: false, detail: `the archive's SHA-256 is ${sha}, the manifest says ${manifest.sha256}; nothing was touched` });
    return refuse(report, "the SHA-256 does not match the manifest; nothing was touched");
  }
  report.checks.push({ name: "sha256", ok: true, detail: sha });

  let scan: Scan;
  try {
    scan = await scanArchive(archive);
  } catch (cause) {
    report.checks.push({ name: "entries", ok: false, detail: errorMessage(cause) });
    return refuse(report, errorMessage(cause));
  }
  report.checks.push({ name: "entries", ok: true, detail: "every entry is a file or a folder inside the store" });
  report.projects = [...scan.projects.values()].toSorted((a, b) => a.name.localeCompare(b.name));

  // Runs-only: which run folders go in, and which are skipped.
  const runsKept = new Set<string>();
  if (options.mode === "runs-only") {
    for (const run of [...scan.runs].toSorted()) {
      const project = run.split("/")[0] ?? "";
      if (!existsSync(join(options.stateDir, project))) report.skipped_runs.push(`${run} (no project ${project} here; sync it first)`);
      else if (lstatSync(join(options.stateDir, run), { throwIfNoEntry: false }) !== undefined) report.skipped_runs.push(`${run} (exists)`);
      else runsKept.add(run);
    }
    report.restored = runsKept.size;
    report.skipped = report.skipped_runs.length;
  }

  let fixes: Fixes;
  try {
    fixes = checkCaptured(scan, options.mode, runsKept);
  } catch (cause) {
    report.checks.push({ name: "ledger", ok: false, detail: `${errorMessage(cause)}; the archive is damaged` });
    return refuse(report, `the archive is damaged: ${errorMessage(cause)}`);
  }
  report.checks.push({ name: "ledger", ok: true, detail: options.mode === "full" ? "every ledger file parses" : "not read (runs only)" });
  report.trimmed = fixes.trimmed;
  report.newline_added = fixes.newlineAdded;
  report.notices.push(...fixes.notices);

  if (options.dryRun) {
    report.code = 0;
    report.ok = true;
    return report;
  }
  if (!(await confirm(options, deps, report))) return refuse(report, firstFailure(report.checks)?.detail ?? "not confirmed");
  // The hash, the scan and the question take time: a timer may have fired or a lock been taken since.
  const late = firstFailure(guardChecks(options, deps));
  if (late !== undefined) {
    report.checks.push({ ...late, name: `${late.name} (after confirmation)` });
    return refuse(report, `${late.detail}; nothing was touched`);
  }

  const now = deps.now();
  return options.mode === "full" ? await restoreFull(options, archive, fixes, report, now, deps) : await restoreRuns(options, archive, fixes, runsKept, report, now);
}

async function restoreFull(options: RestoreOptions, archive: string, fixes: Fixes, report: RestoreReport, now: Date, deps: RestoreDeps): Promise<RestoreReport> {
  // resolvePath() drops a trailing slash, so the sibling paths never land inside the store.
  const live = resolvePath(options.stateDir);
  const staging = `${live}.restoring-${stamp(now)}`;
  const aside = `${live}.before-restore-${stamp(now)}`;
  const rename = deps.renameDir ?? renameSync;
  if (existsSync(staging) || existsSync(aside)) return refuse(report, `${existsSync(staging) ? staging : aside} exists; wait a second and run it again`);
  mkdirSync(dirname(live), { recursive: true });
  mkdirSync(staging, { mode: 0o700 });
  try {
    await extract(archive, staging, keepAll);
    applyFixes(staging, fixes, keepAll);
  } catch (cause) {
    // The staging folder is this run's own, half written: removing it touches nothing of the store.
    rmSync(staging, { recursive: true, force: true });
    return refuse(report, `the archive did not unpack: ${errorMessage(cause)}; the store is untouched`);
  }
  const locks = dropLocks(staging);
  if (locks > 0) report.notices.push(`dropped ${String(locks)} lock file(s) of the snapshot`);

  const hadStore = existsSync(live);
  if (hadStore) {
    try {
      rename(live, aside);
    } catch (cause) {
      rmSync(staging, { recursive: true, force: true });
      return refuse(report, `the store could not be moved aside to ${aside}: ${errorMessage(cause)}; the store is untouched, and the unpacked copy in ${staging} was removed`);
    }
  }
  try {
    rename(staging, live);
  } catch (cause) {
    if (!hadStore) return refuse(report, `the new store could not be moved into place: ${errorMessage(cause)}; the unpacked one is in ${staging}`);
    try {
      rename(aside, live);
    } catch (back) {
      return refuse(
        report,
        `the new store could not be moved into place: ${errorMessage(cause)}; then the old store could not be moved back: ${errorMessage(back)}. There is no store at ${live} now. The old store is in ${aside}, the unpacked one in ${staging}; move one of them to ${live} by hand`,
      );
    }
    return refuse(report, `the new store could not be moved into place: ${errorMessage(cause)}; the old store is back, the unpacked one is in ${staging}`);
  }
  report.moved_to = hadStore ? aside : null;
  recordRestore(report, { mode: "full", trimmed: report.trimmed });
  report.next = [
    "darius sync --all-projects   (pulls what the bucket got since the snapshot)",
    "  if the sync bucket was lost and recreated: darius sync --reseed --all-projects",
    START_LINE,
    "darius snapshot status --hosts",
    hadStore ? `the old store is in ${aside}; delete it by hand once you are sure` : "there was no store before; nothing was moved aside",
  ];
  report.code = 0;
  report.ok = true;
  return report;
}

async function restoreRuns(options: RestoreOptions, archive: string, fixes: Fixes, runsKept: ReadonlySet<string>, report: RestoreReport, now: Date): Promise<RestoreReport> {
  const live = resolvePath(options.stateDir);
  if (runsKept.size > 0) {
    const staging = `${live}.restoring-${stamp(now)}`;
    if (existsSync(staging)) return refuse(report, `${staging} exists; wait a second and run it again`);
    mkdirSync(staging, { mode: 0o700 });
    const keep = (path: string): boolean => {
      const run = runKey(path);
      return run !== null && runsKept.has(run);
    };
    try {
      await extract(archive, staging, keep);
      applyFixes(staging, fixes, keep);
      let moved = 0;
      for (const run of [...runsKept].toSorted()) {
        const target = join(live, run);
        mkdirSync(dirname(target), { recursive: true });
        if (lstatSync(target, { throwIfNoEntry: false }) !== undefined) {
          report.skipped_runs.push(`${run} (appeared during the restore)`);
          continue;
        }
        renameSync(join(staging, run), target);
        moved += 1;
      }
      report.restored = moved;
      report.skipped = report.skipped_runs.length;
    } finally {
      // Only this run's own staging folder; it holds nothing of the live store.
      rmSync(staging, { recursive: true, force: true });
    }
  }
  recordRestore(report, { mode: "runs-only", restored: report.restored, skipped: report.skipped });
  report.next = [`restored ${String(report.restored)} run folder(s), skipped ${String(report.skipped)}`, "darius init in each checkout, then start the units"];
  report.code = 0;
  report.ok = true;
  return report;
}

/** `store.restored` in `_global`, so every host sees the event. A failure here is a notice: the restore itself is done. */
function recordRestore(report: RestoreReport, extra: { [key: string]: JsonValue }): void {
  try {
    appendLine(openProject(GLOBAL_PROJECT, { create: true }), {
      who: defaultWho(),
      type: "store.restored",
      name: report.name,
      snapshot_at: report.snapshot_at ?? "",
      snapshot_host: report.host ?? "",
      ...extra,
    });
  } catch (cause) {
    report.notices.push(`the store.restored line could not be written: ${errorMessage(cause)}`);
  }
}
