/**
 * The tracker tree in the store: when a project's marker lists `milestone`,
 * the whole tracker tree (milestones, specs, worklogs, the archive) lives in
 * the darius store, byte for byte. Since 0.78.0 a checkout holds no
 * `.tracker` path at all: readers resolve the tree from the marker
 * (src/core/tracker-root.ts).
 *
 *   <stateDir>/<project>/tracker/            the working copy on this host
 *   <stateDir>/<project>/tracker-index.json  host-local index, never synced
 *
 * The store is the source of truth across hosts. Every file version is a
 * blob, every change is a ledger line (no `item`):
 *
 *   tree.put     { path, body_sha, size, exec?: true, prev_sha }
 *   tree.removed { path, prev_sha }
 *
 * `path` is relative to the tree root, with `/` separators. `prev_sha` is the
 * sha this host had for the path before the change (null for a new file).
 * Both `_sha` keys are real blob shas, so sync carries the blobs with the
 * chunk (src/core/sync.ts, "Blob references").
 *
 * The working copy is captured from and applied to:
 *
 *   captureTree  walk the working copy, compare with the index, write blobs
 *                and ledger lines for the changes, update the index.
 *   applyTree    fold every `tree.*` line (all hosts, id order; the latest
 *                line per path wins) and bring the working copy to it.
 *   syncTree     capture, then apply. Capture runs first, so a local edit is
 *                a line before another host's version is considered.
 *
 * Apply never deletes or overwrites a local file the index does not vouch
 * for: such a path is skipped with a problem until capture records it.
 *
 * A concurrent edit (the winning line, or the run of its host's lines that
 * ends in it, was not written on top of the line before, and that line came
 * from another host; `concurrentWith`) is last-writer-wins,
 * except for the files `mergeFor` names: a `.jsonl` file (append-only, the
 * union of the lines), a worklog (by thread), a spec whose versions differ
 * only in checklist ticks, and the claims file (per spec). For those apply
 * writes the merge of both versions when both blobs are here. The index
 * keeps the winner's sha for it, so the next capture records the merged file
 * as a normal `tree.put`; `syncTree` runs that capture at once. Each merge is
 * deterministic, so every host that merges the same two versions writes the
 * same bytes, and the line after the merge is no concurrent edit.
 *
 * When no merge applies, the other version is lost from the working copy but
 * stays a blob, and apply records a `tree.conflict` line once
 * (src/core/tree-conflicts.ts), which `darius doctor` and `darius due` show
 * until the operator restores or resolves it.
 *
 * The index (`tracker-index.json`, `{v: 1, files: {path: {sha, size,
 * mtimeMs, exec}}}`) lets capture skip hashing a file whose size, mtime and
 * exec bit match. A file whose mtime was within RACY_MS of the moment it was
 * seen is stored with `mtimeMs: -1`, so the next capture hashes it again (the
 * "racily clean" rule of git). A missing or unreadable index means: hash
 * everything, then compare with the ledger. It is never an error.
 *
 * Host-local and derived files are never captured, written or removed:
 * `LOCAL_TREE_PATHS` and `isLocalTreePath`.
 */

import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { dirname, join } from "node:path";

import { isClaimsPath, mergeClaims } from "./claims-merge.ts";
import { appendLines, defaultWho, readLedger, type LedgerLineInput } from "./ledger.ts";
import type { JsonValue, LedgerLine } from "./model.ts";
import { isSpecPath, mergeSpecTicks } from "./spec-merge.ts";
import { getBlob, putBlob, sha256Hex, type Project } from "./store.ts";
import { conflictKey, readTreeConflicts, TREE_CONFLICT } from "./tree-conflicts.ts";
import { isWorklogPath, mergeWorklog } from "./worklog-merge.ts";
import { errorMessage } from "../runtime.ts";

/** The ledger line types of the tree. */
export const TREE_PUT = "tree.put";
export const TREE_REMOVED = "tree.removed";

/**
 * Paths in the tree that are host-local or derived. They are never captured,
 * and apply never writes or removes them.
 *
 *   files     exact paths
 *   dirs      every path under these folders (`vigils/` is a projection of
 *             the store's vigil items; `.enrich/` is scratch)
 *   suffixes  lock files
 *   temp      the temp files of the legacy atomic writer
 *             (`<name>.tmp.<pid>.<hex>`, src/legacy/lib/atomic.ts); apply
 *             writes its own temp files with the same pattern
 */
export const LOCAL_TREE_PATHS = {
  files: [
    "00-INDEX.md",
    "worklog/00-INDEX.md",
    ".pending-sync",
    ".loop-bounces.json",
    ".fc-vigil-sweep-latest.json",
  ],
  dirs: ["vigils", ".enrich"],
  suffixes: [".lock"],
  temp: /\.tmp\.\d+\.[0-9a-f]+$/u,
} as const;

const LOCAL_FILES: ReadonlySet<string> = new Set(LOCAL_TREE_PATHS.files);

/** True when `path` (relative to the tree root, `/` separators) is host-local or derived. */
export function isLocalTreePath(path: string): boolean {
  if (LOCAL_FILES.has(path)) return true;
  if (LOCAL_TREE_PATHS.dirs.some((dir) => path === dir || path.startsWith(`${dir}/`))) return true;
  if (LOCAL_TREE_PATHS.suffixes.some((suffix) => path.endsWith(suffix))) return true;
  return LOCAL_TREE_PATHS.temp.test(path);
}

/** What `captureTree` did. */
export interface TreeCapture {
  /** Regular files in the working copy that capture tracks. */
  files: number;
  /** `tree.put` lines written. */
  put: number;
  /** `tree.removed` lines written. */
  removed: number;
  /** The paths of those lines, sorted. */
  changed: string[];
  /** Skipped entries (symlinks, other non-regular files), one line each. */
  problems: string[];
}

/** What `applyTree` did. */
export interface TreeApply {
  /** Files written from a blob, merged files included. */
  written: number;
  /** Files written as the merge of two concurrent versions (`mergeFor`); a capture must record them. */
  merged: number;
  /** Files deleted. */
  removed: number;
  /** The paths written or deleted, sorted. */
  changed: string[];
  /** Paths left alone, and concurrent edits, one line each. */
  problems: string[];
}

/** The derived index the legacy CLI keeps at the tree root. */
export const TREE_INDEX_FILE = "00-INDEX.md";

/**
 * True when the working copy holds tracked files but no `00-INDEX.md`. That
 * file is derived and never synced, so a host that got the tree by sync has
 * none, and the legacy `doctor --quick` would then read the tree as "no
 * tracker". The caller rebuilds it (`rebuildTrackerIndex`).
 */
export function isIndexMissing(project: Project): boolean {
  if (existsSync(join(treeDir(project), TREE_INDEX_FILE))) return false;
  return readIndex(project).files.size > 0;
}

/** What `pendingTreeChanges` finds: what a capture would record now, without writing. */
export interface TreePending {
  changed: string[];
  problems: string[];
}

interface IndexEntry {
  sha: string;
  size: number;
  mtimeMs: number;
  exec: boolean;
}

interface TreeIndex {
  files: Map<string, IndexEntry>;
}

/** One `tree.*` line, decoded. */
export interface TreeLine {
  id: string;
  /** The line's time (ISO). */
  at: string;
  host: string;
  who: string;
  type: "tree.put" | "tree.removed";
  path: string;
  /** The content after the line: the blob for a put, null for a removal. */
  after: string | null;
  /** The size of a put's blob; null for a removal or a line without one. */
  size: number | null;
  exec: boolean;
  prev: string | null;
}

/** One regular file found in the working copy. */
interface WalkedFile {
  path: string;
  stats: Stats;
}

const INDEX_FILE = "tracker-index.json";
const TREE_DIR = "tracker";
/** A file whose mtime is this close to the index write is hashed again next time. */
const RACY_MS = 2000;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const EXEC_BITS = 0o111;
/** The `mtimeMs` of an entry that must be hashed again: it was racily clean when seen. */
const RACY_MTIME = -1;

// --- paths -------------------------------------------------------------------

/**
 * `<stateDir>/<project>/tracker`: the working copy of the tree on this host.
 * The one definition of that path; it needs only the store root, so a reader
 * that has a project name and no open store passes `{ root: projectDir(name) }`.
 */
export function treeDir(project: Pick<Project, "root">): string {
  return join(project.root, TREE_DIR);
}

function indexPath(project: Project): string {
  return join(project.root, INDEX_FILE);
}

/** True when `path` is a safe relative tree path: `/` separated, no empty, `.` or `..` segment. */
export function isTreePath(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\0")) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function isExec(stats: Stats): boolean {
  return (stats.mode & EXEC_BITS) !== 0;
}

function randomHex(): string {
  return Math.floor(Math.random() * 0xfffffff).toString(16);
}

/** Writes `path` through a temp file of the legacy pattern (skipped by capture) and a rename. */
function writeFileAtomic(path: string, content: Uint8Array, mode: number): void {
  const temp = `${path}.tmp.${String(process.pid)}.${randomHex()}`;
  writeFileSync(temp, content, { mode });
  try {
    chmodSync(temp, mode);
    renameSync(temp, path);
  } catch (cause) {
    rmSync(temp, { force: true });
    throw cause;
  }
}

// --- the index ---------------------------------------------------------------

function isRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isBoolean(value: JsonValue | undefined): value is boolean {
  return typeof value === "boolean";
}

function decodeEntry(value: JsonValue | undefined): IndexEntry | null {
  if (!isRecord(value)) return null;
  const { sha, size, mtimeMs, exec } = value;
  if (!isText(sha) || !SHA256_HEX.test(sha) || !isFiniteNumber(size) || !isFiniteNumber(mtimeMs) || !isBoolean(exec)) return null;
  return { sha, size, mtimeMs, exec };
}

/** The index, or an empty one when it is missing or does not parse (then capture hashes everything). */
function readIndex(project: Project): TreeIndex {
  const empty: TreeIndex = { files: new Map() };
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(readFileSync(indexPath(project), "utf8"));
  } catch {
    return empty;
  }
  if (!isRecord(parsed) || parsed.v !== 1 || !isRecord(parsed.files)) return empty;
  const files = new Map<string, IndexEntry>();
  for (const [path, value] of Object.entries(parsed.files)) {
    const entry = decodeEntry(value);
    if (entry === null || !isTreePath(path)) return empty;
    files.set(path, entry);
  }
  return { files };
}

function writeIndex(project: Project, index: TreeIndex): void {
  const files = Object.fromEntries([...index.files.entries()].toSorted(([a], [b]) => (a < b ? -1 : 1)));
  const text = `${JSON.stringify({ v: 1, files })}\n`;
  writeFileAtomic(indexPath(project), new TextEncoder().encode(text), 0o644);
}

/** True when the index entry vouches for `stats` without hashing: same size, mtime and exec bit. */
function isFastClean(entry: IndexEntry, stats: Stats): boolean {
  return entry.size === stats.size && entry.mtimeMs === stats.mtimeMs && entry.exec === isExec(stats);
}

/** The index entry for a file with content `sha`, seen now. A file changed within RACY_MS gets RACY_MTIME. */
function entryFor(sha: string, stats: Stats): IndexEntry {
  const mtimeMs = stats.mtimeMs + RACY_MS > Date.now() ? RACY_MTIME : stats.mtimeMs;
  return { sha, size: stats.size, mtimeMs, exec: isExec(stats) };
}

// --- the walk ----------------------------------------------------------------

/** Every regular file under `root` that the tree tracks; symlinks and other non-regular files go to `problems`. */
function walkTree(root: string, problems: string[]): WalkedFile[] {
  const files: WalkedFile[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).toSorted()) {
      const path = prefix === "" ? name : `${prefix}/${name}`;
      if (isLocalTreePath(path)) continue;
      const full = join(dir, name);
      const stats = lstatSync(full);
      if (stats.isDirectory()) walk(full, path);
      else if (stats.isFile()) files.push({ path, stats });
      else problems.push(`skipped ${path}: ${stats.isSymbolicLink() ? "a symlink" : "not a regular file"}, the tree keeps regular files only`);
    }
  };
  walk(root, "");
  return files;
}

// --- the ledger fold ---------------------------------------------------------

function textField(line: LedgerLine, key: string): string | undefined {
  const value = line[key];
  return isText(value) ? value : undefined;
}

function shaField(line: LedgerLine, key: string): string | null | undefined {
  const value = line[key];
  if (value === null) return null;
  return isText(value) && SHA256_HEX.test(value) ? value : undefined;
}

/** A `tree.*` ledger line, decoded; null with a problem for a malformed one. */
function decodeTreeLine(line: LedgerLine, problems: string[]): TreeLine | null {
  if (line.type !== TREE_PUT && line.type !== TREE_REMOVED) return null;
  const path = textField(line, "path");
  const prev = shaField(line, "prev_sha") ?? null;
  if (path === undefined || !isTreePath(path)) {
    problems.push(`ledger line ${line.id} (${line.type}) has no valid path; skipped`);
    return null;
  }
  const base = { id: line.id, at: line.at, host: line.host, who: line.who, path, prev };
  if (line.type === TREE_REMOVED) return { ...base, type: TREE_REMOVED, after: null, size: null, exec: false };
  const body = shaField(line, "body_sha");
  if (body === undefined || body === null) {
    problems.push(`ledger line ${line.id} (tree.put ${path}) has no valid body_sha; skipped`);
    return null;
  }
  const size = isFiniteNumber(line.size) ? line.size : null;
  return { ...base, type: TREE_PUT, after: body, size, exec: line.exec === true };
}

/** Every `tree.*` line by path, each list in ledger id order. Malformed lines go to `problems`. */
export function foldTree(project: Project, problems: string[]): Map<string, TreeLine[]> {
  return foldLines(readLedger(project), problems);
}

function foldLines(lines: readonly LedgerLine[], problems: string[]): Map<string, TreeLine[]> {
  const byPath = new Map<string, TreeLine[]>();
  for (const line of lines) {
    const tree = decodeTreeLine(line, problems);
    if (tree === null) continue;
    const list = byPath.get(tree.path);
    if (list === undefined) byPath.set(tree.path, [tree]);
    else list.push(tree);
  }
  return byPath;
}

/** True when the store has a working copy or a `tree.*` ledger line for `project`. */
export function hasTree(project: Project): boolean {
  if (existsSync(treeDir(project))) return true;
  return readLedger(project).some((line) => line.type === TREE_PUT || line.type === TREE_REMOVED);
}

/** The content sha and exec bit the index holds per path: what this host last captured or applied. */
export function indexedFiles(project: Project): ReadonlyMap<string, { sha: string; exec: boolean }> {
  const files = new Map<string, { sha: string; exec: boolean }>();
  for (const [path, entry] of readIndex(project).files) files.set(path, { sha: entry.sha, exec: entry.exec });
  return files;
}

// --- capture -----------------------------------------------------------------

/** `prev_sha` must name a blob this host has: sync pushes every blob a line names. */
export function localSha(project: Project, sha: string | undefined): string | null {
  if (sha === undefined) return null;
  return getBlob(project, sha) === null ? null : sha;
}

interface CapturePlan {
  lines: LedgerLineInput[];
  next: TreeIndex;
  /** The new index differs from the one on disk. */
  dirty: boolean;
  files: number;
  changed: string[];
  problems: string[];
}

/** True when the latest `tree.*` line for `path` already holds `sha` with this exec bit. */
function isFolded(fold: ReadonlyMap<string, TreeLine[]>, path: string, sha: string, exec: boolean): boolean {
  const winner = fold.get(path)?.at(-1);
  return winner !== undefined && winner.after === sha && winner.exec === exec;
}

/**
 * What a capture would write: the ledger lines and the new index. Blobs are
 * written only when `write` is set. A file the index does not know is first
 * compared with the ledger fold: after a lost index, or a file apply wrote
 * and a crash kept out of the index, the same content needs no new line.
 */
function planCapture(project: Project, who: string, write: boolean): CapturePlan {
  const root = treeDir(project);
  const index = readIndex(project);
  const plan: CapturePlan = { lines: [], next: { files: new Map() }, dirty: false, files: 0, changed: [], problems: [] };
  if (!existsSync(root)) {
    // No working copy is not "everything was deleted": record nothing.
    if (index.files.size > 0) plan.problems.push(`${root} is missing; nothing captured`);
    plan.next = index;
    return plan;
  }
  let fold: Map<string, TreeLine[]> | undefined;
  const seen = new Set<string>();
  for (const { path, stats } of walkTree(root, plan.problems)) {
    seen.add(path);
    plan.files += 1;
    const entry = index.files.get(path);
    if (entry !== undefined && isFastClean(entry, stats)) {
      plan.next.files.set(path, entry);
      continue;
    }
    const bytes = readFileSync(join(root, path));
    const sha = sha256Hex(bytes);
    const exec = isExec(stats);
    plan.next.files.set(path, entryFor(sha, stats));
    plan.dirty = true;
    if (entry !== undefined && entry.sha === sha && entry.exec === exec) continue;
    if (entry === undefined) {
      fold ??= foldTree(project, []);
      if (isFolded(fold, path, sha, exec)) {
        if (write) putBlob(project, bytes);
        continue;
      }
    }
    if (write) putBlob(project, bytes);
    const line: LedgerLineInput = { who, type: TREE_PUT, path, body_sha: sha, size: bytes.length, prev_sha: localSha(project, entry?.sha) };
    if (exec) line.exec = true;
    plan.lines.push(line);
    plan.changed.push(path);
  }
  for (const [path, entry] of index.files) {
    if (seen.has(path) || isLocalTreePath(path)) continue;
    plan.lines.push({ who, type: TREE_REMOVED, path, prev_sha: localSha(project, entry.sha) });
    plan.changed.push(path);
  }
  if (plan.next.files.size !== index.files.size) plan.dirty = true;
  // One time for every line of a capture: a deleted folder is one set of
  // lines, which `darius tree restore` undoes as one (src/core/tree-history.ts).
  const at = new Date().toISOString();
  for (const line of plan.lines) line.at = at;
  plan.changed.sort();
  return plan;
}

/**
 * Records the changes in the working copy: a blob and a `tree.put` line per
 * new or changed file, a `tree.removed` line per file the index has and the
 * working copy lost. Then the index. Under the project lock.
 */
export function captureTree(project: Project, options: { who?: string } = {}): TreeCapture {
  return project.withLock(() => {
    const plan = planCapture(project, options.who ?? defaultWho(), true);
    // Lines before the index: a crash between the two only means the next
    // capture writes the same put again, which apply folds to the same file.
    appendLines(project, plan.lines);
    if (plan.dirty || plan.lines.length > 0) writeIndex(project, plan.next);
    const put = plan.lines.filter((line) => line.type === TREE_PUT).length;
    return { files: plan.files, put, removed: plan.lines.length - put, changed: plan.changed, problems: plan.problems };
  });
}

/** What a capture would record now. Writes nothing (`darius onboard scan`). */
export function pendingTreeChanges(project: Project): TreePending {
  const plan = planCapture(project, defaultWho(), false);
  return { changed: plan.changed, problems: plan.problems };
}

// --- apply -------------------------------------------------------------------

/** The local file at `path` as the index knows it: true when it may be replaced. */
function isVouched(full: string, entry: IndexEntry | undefined): boolean {
  const stats = lstatSync(full, { throwIfNoEntry: false });
  if (entry === undefined) return stats === undefined;
  if (stats === undefined || !stats.isFile()) return false;
  if (isFastClean(entry, stats)) return true;
  return entry.exec === isExec(stats) && sha256Hex(readFileSync(full)) === entry.sha;
}

/**
 * The line the winner competed with, or null. The winner's run is the
 * winner and the lines of its host right before it, each written on top of
 * the one before (a host that captured twice before it synced). A concurrent
 * edit is a run whose first line was not written on top of the line before
 * the run, and that line came from another host.
 */
function concurrentWith(lines: readonly TreeLine[]): TreeLine | null {
  const winner = lines.at(-1);
  if (winner === undefined) return null;
  let first = lines.length - 1;
  while (first > 0) {
    const line = lines[first];
    const prior = lines[first - 1];
    if (line === undefined || prior === undefined || prior.host !== winner.host || line.prev !== prior.after) break;
    first -= 1;
  }
  const start = lines[first];
  const before = lines[first - 1];
  if (start === undefined || before === undefined) return null;
  if (before.host === winner.host || start.prev === before.after) return null;
  return before;
}

function concurrentProblem(winner: TreeLine, before: TreeLine): string {
  const other = before.after === null ? `the other host (${before.host}) removed it` : `the other version is blob ${before.after}`;
  return `concurrent edit of ${winner.path}: kept the version of ${winner.host}, ${other}`;
}

/**
 * How the concurrent versions of `path` are merged, or null for
 * last-writer-wins. A merge returns the winner's own bytes when the other
 * version adds nothing, and null when the two cannot be joined safely.
 *
 *   `.jsonl`                append-only lines: `mergeLines`
 *   `worklog/<name>.md`     by thread (src/core/worklog-merge.ts, 0.75.0)
 *   `M<n>-*\/<NN>-*.md`     checklist ticks only (src/core/spec-merge.ts, 0.75.0)
 *   `.session-claims.json`  per spec, newest wins (src/core/claims-merge.ts, 0.75.0)
 */
function mergeFor(path: string): ((winner: Uint8Array, other: Uint8Array) => Uint8Array | null) | null {
  if (path.endsWith(".jsonl")) return mergeLines;
  if (isWorklogPath(path)) return mergeWorklog;
  if (isSpecPath(path)) return mergeSpecTicks;
  if (isClaimsPath(path)) return mergeClaims;
  return null;
}

/** True for a file whose concurrent versions are merged instead of last-writer-wins (see `mergeFor`). */
export function isMergeablePath(path: string): boolean {
  return mergeFor(path) !== null;
}

function linesOf(bytes: Uint8Array): string[] {
  // latin1 maps each byte to one char and back, so the merge is byte exact.
  const text = Buffer.from(bytes).toString("latin1");
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body === "" ? [] : body.split("\n");
}

/**
 * The union of two versions of a line file: every line of `winner` in order,
 * then every line of `other` that `winner` lacks (exact match), in its order.
 * Ends with one newline (empty when both are empty).
 */
export function mergeLines(winner: Uint8Array, other: Uint8Array): Uint8Array {
  const kept = linesOf(winner);
  const seen = new Set(kept);
  const all = [...kept, ...linesOf(other).filter((line) => !seen.has(line))];
  return Buffer.from(all.length === 0 ? "" : `${all.join("\n")}\n`, "latin1");
}

/**
 * What a concurrent edit comes to:
 *
 *   none      not concurrent, or the other version is the same file
 *   merged    both versions joined into `bytes`
 *   subsumed  the winner already holds everything the other version has
 *   lost      last-writer-wins: the other version is lost from the working copy
 */
type Outcome = { kind: "none" } | { kind: "merged"; bytes: Uint8Array } | { kind: "subsumed" } | { kind: "lost" };

function concurrentOutcome(ctx: ApplyContext, winner: TreeLine, before: TreeLine | null, blob: Uint8Array | null): Outcome {
  if (before === null || before.after === winner.after) return { kind: "none" };
  if (before.after === null || blob === null) return { kind: "lost" };
  const merge = mergeFor(winner.path);
  const other = getBlob(ctx.project, before.after);
  if (merge === null || other === null) return { kind: "lost" };
  const merged = merge(blob, other);
  if (merged === null) return { kind: "lost" };
  return sha256Hex(merged) === sha256Hex(blob) ? { kind: "subsumed" } : { kind: "merged", bytes: merged };
}

/** Records a lost version as a `tree.conflict` line, once per (path, winner, loser). Needs the loser's blob here. */
function recordConflict(ctx: ApplyContext, winner: TreeLine, before: TreeLine): void {
  const loser = before.after;
  if (loser === null || getBlob(ctx.project, loser) === null) return;
  const key = conflictKey(winner.path, winner.after, loser);
  if (ctx.conflicts.has(key)) return;
  ctx.conflicts.add(key);
  appendLines(ctx.project, [
    { who: defaultWho(), type: TREE_CONFLICT, path: winner.path, winner_sha: winner.after, loser_sha: loser, winner_host: winner.host, loser_host: before.host },
  ]);
}

/** Removes empty dirs from `dir` up to, never including, `root`. */
function pruneEmptyDirs(dir: string, root: string): void {
  let at = dir;
  while (at !== root && at.startsWith(`${root}/`)) {
    if (readdirSync(at).length > 0) return;
    rmdirSync(at);
    at = dirname(at);
  }
}

/** The mode for a file written by apply: keep the read/write bits of a file that is there, set or clear exec. */
function modeFor(full: string, exec: boolean): number {
  const stats = lstatSync(full, { throwIfNoEntry: false });
  const base = stats?.isFile() === true ? stats.mode & 0o666 : 0o644;
  return exec ? base | ((base & 0o444) >> 2) : base;
}

interface ApplyContext {
  project: Project;
  root: string;
  index: TreeIndex;
  result: TreeApply;
  /** The index changed and must be written. */
  dirty: boolean;
  /** Every conflict the ledger records (`conflictKey`), so each is written once. */
  conflicts: Set<string>;
}

/** Brings one path to its winning line. Returns without a change when the index already matches. */
function applyPath(ctx: ApplyContext, lines: readonly TreeLine[]): void {
  const winner = lines.at(-1);
  if (winner === undefined) return;
  const { path } = winner;
  if (isLocalTreePath(path)) return;
  const entry = ctx.index.files.get(path);
  const inSync = winner.after === null ? entry === undefined : entry?.sha === winner.after && entry.exec === winner.exec;
  if (inSync) return;
  const full = join(ctx.root, path);
  if (!isVouched(full, entry)) {
    const stats = lstatSync(full, { throwIfNoEntry: false });
    // A local file that already holds the winning content only needs the index.
    if (entry === undefined && winner.after !== null && stats?.isFile() === true && isExec(stats) === winner.exec && sha256Hex(readFileSync(full)) === winner.after) {
      ctx.index.files.set(path, entryFor(winner.after, stats));
      ctx.dirty = true;
      return;
    }
    ctx.result.problems.push(`local change not captured yet: ${path}; left as it is (run the verb again or darius sync)`);
    return;
  }
  const before = concurrentWith(lines);
  let problem = before === null ? null : concurrentProblem(winner, before);
  let lost = false;
  if (winner.after === null) {
    if (existsSync(full)) {
      unlinkSync(full);
      pruneEmptyDirs(dirname(full), ctx.root);
    }
    ctx.index.files.delete(path);
    ctx.result.removed += 1;
    lost = concurrentOutcome(ctx, winner, before, null).kind === "lost";
  } else {
    const blob = getBlob(ctx.project, winner.after);
    if (blob === null) {
      ctx.result.problems.push(`blob not synced yet: ${path}`);
      return;
    }
    mkdirSync(dirname(full), { recursive: true });
    const outcome = concurrentOutcome(ctx, winner, before, blob);
    const merged = outcome.kind === "merged" ? outcome.bytes : null;
    writeFileAtomic(full, merged ?? blob, modeFor(full, winner.exec));
    if (merged === null) {
      ctx.index.files.set(path, entryFor(winner.after, lstatSync(full)));
    } else {
      // The index names the winner, and size -1 never matches: the next
      // capture hashes the file and records the merged version.
      ctx.index.files.set(path, { sha: winner.after, size: -1, mtimeMs: RACY_MTIME, exec: winner.exec });
      ctx.result.merged += 1;
      problem = `concurrent edit of ${path}: merged the lines of both versions (${winner.host} and ${before?.host ?? "?"}) into one file`;
    }
    if (outcome.kind === "subsumed" || outcome.kind === "none") problem = null;
    lost = outcome.kind === "lost";
    ctx.result.written += 1;
  }
  if (lost && before !== null) recordConflict(ctx, winner, before);
  ctx.dirty = true;
  ctx.result.changed.push(path);
  if (problem !== null) ctx.result.problems.push(problem);
}

/**
 * Brings the working copy to the fold of every `tree.*` line: per path the
 * latest line by id wins. A path whose local file the index does not vouch
 * for is left alone with a problem; so is a put whose blob is not here yet.
 * Under the project lock.
 */
export function applyTree(project: Project): TreeApply {
  return project.withLock(() => {
    const result: TreeApply = { written: 0, merged: 0, removed: 0, changed: [], problems: [] };
    const ledger = readLedger(project);
    const byPath = foldLines(ledger, result.problems);
    if (byPath.size === 0) return result;
    const root = treeDir(project);
    mkdirSync(root, { recursive: true });
    const conflicts = new Set(readTreeConflicts(ledger).all);
    const ctx: ApplyContext = { project, root, index: readIndex(project), result, dirty: false, conflicts };
    for (const lines of byPath.values()) {
      try {
        applyPath(ctx, lines);
      } catch (cause) {
        const path = lines.at(-1)?.path ?? "?";
        result.problems.push(`cannot apply ${path}: ${errorMessage(cause)}`);
      }
    }
    if (ctx.dirty) writeIndex(project, ctx.index);
    result.changed.sort();
    return result;
  });
}

/**
 * Capture, then apply: a local edit becomes a line before another host's
 * version is considered. When apply merged a file, a second capture
 * records the merged file at once; its counts join the first capture's.
 */
export function syncTree(project: Project, options: { who?: string } = {}): { capture: TreeCapture; apply: TreeApply } {
  return project.withLock(() => {
    const capture = captureTree(project, options);
    const apply = applyTree(project);
    if (apply.merged > 0) {
      const merged = captureTree(project, options);
      capture.put += merged.put;
      capture.removed += merged.removed;
      capture.changed = [...new Set([...capture.changed, ...merged.changed])].toSorted();
    }
    return { capture, apply };
  });
}

// --- the working copy --------------------------------------------------------

/**
 * Makes sure the working copy of `project` exists. Since 0.78.0 a checkout
 * holds no `.tracker` link: every reader resolves the tree from the marker
 * (src/core/tracker-root.ts), so nothing is created in the checkout.
 */
export function ensureTreeDir(project: Pick<Project, "root">): string {
  const dir = treeDir(project);
  mkdirSync(dir, { recursive: true });
  return dir;
}
