/**
 * The tracker tree in the store: when a project's marker lists `milestone`,
 * the whole tracker tree (milestones, specs, worklogs, the archive) lives in
 * the darius store, byte for byte, and each checkout holds only a symlink
 * `.tracker` to it.
 *
 *   <stateDir>/<project>/tracker/            the working copy on this host
 *   <stateDir>/<project>/tracker-index.json  host-local index, never synced
 *   <checkout>/.tracker -> <stateDir>/<project>/tracker
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
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { appendLines, defaultWho, readLedger, type LedgerLineInput } from "./ledger.ts";
import type { JsonValue, LedgerLine } from "./model.ts";
import { getBlob, putBlob, sha256Hex, type Project } from "./store.ts";
import { errorMessage } from "../runtime.ts";

/** The ledger line types of the tree. */
export const TREE_PUT = "tree.put";
export const TREE_REMOVED = "tree.removed";

/** The folder in each checkout that links to the tree. */
export const TRACKER_LINK = ".tracker";

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
    ".session-claims.json",
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
  /** Files written from a blob. */
  written: number;
  /** Files deleted. */
  removed: number;
  /** The paths written or deleted, sorted. */
  changed: string[];
  /** Paths left alone, and concurrent edits, one line each. */
  problems: string[];
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
interface TreeLine {
  id: string;
  host: string;
  type: "tree.put" | "tree.removed";
  path: string;
  /** The content after the line: the blob for a put, null for a removal. */
  after: string | null;
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
function isTreePath(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\0")) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function hasErrnoCode(cause: unknown, code: string): boolean {
  return cause instanceof Error && "code" in cause && cause.code === code;
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
  if (line.type === TREE_REMOVED) return { id: line.id, host: line.host, type: TREE_REMOVED, path, after: null, exec: false, prev };
  const body = shaField(line, "body_sha");
  if (body === undefined || body === null) {
    problems.push(`ledger line ${line.id} (tree.put ${path}) has no valid body_sha; skipped`);
    return null;
  }
  return { id: line.id, host: line.host, type: TREE_PUT, path, after: body, exec: line.exec === true, prev };
}

/** Every `tree.*` line by path, each list in ledger id order. */
function foldTree(project: Project, problems: string[]): Map<string, TreeLine[]> {
  const byPath = new Map<string, TreeLine[]>();
  for (const line of readLedger(project)) {
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

// --- capture -----------------------------------------------------------------

/** `prev_sha` must name a blob this host has: sync pushes every blob a line names. */
function localSha(project: Project, sha: string | undefined): string | null {
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

/** The problem line for a concurrent edit, or null: the winner was not written on top of the line before it, from another host. */
function concurrentEdit(lines: readonly TreeLine[]): string | null {
  const winner = lines.at(-1);
  const before = lines.at(-2);
  if (winner === undefined || before === undefined) return null;
  if (before.host === winner.host || winner.prev === before.after) return null;
  const other = before.after === null ? `the other host (${before.host}) removed it` : `the other version is blob ${before.after}`;
  return `concurrent edit of ${winner.path}: kept the version of ${winner.host}, ${other}`;
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
  const concurrent = concurrentEdit(lines);
  if (winner.after === null) {
    if (existsSync(full)) {
      unlinkSync(full);
      pruneEmptyDirs(dirname(full), ctx.root);
    }
    ctx.index.files.delete(path);
    ctx.result.removed += 1;
  } else {
    const blob = getBlob(ctx.project, winner.after);
    if (blob === null) {
      ctx.result.problems.push(`blob not synced yet: ${path}`);
      return;
    }
    mkdirSync(dirname(full), { recursive: true });
    writeFileAtomic(full, blob, modeFor(full, winner.exec));
    ctx.index.files.set(path, entryFor(winner.after, lstatSync(full)));
    ctx.result.written += 1;
  }
  ctx.dirty = true;
  ctx.result.changed.push(path);
  if (concurrent !== null) ctx.result.problems.push(concurrent);
}

/**
 * Brings the working copy to the fold of every `tree.*` line: per path the
 * latest line by id wins. A path whose local file the index does not vouch
 * for is left alone with a problem; so is a put whose blob is not here yet.
 * Under the project lock.
 */
export function applyTree(project: Project): TreeApply {
  return project.withLock(() => {
    const result: TreeApply = { written: 0, removed: 0, changed: [], problems: [] };
    const byPath = foldTree(project, result.problems);
    if (byPath.size === 0) return result;
    const root = treeDir(project);
    mkdirSync(root, { recursive: true });
    const ctx: ApplyContext = { project, root, index: readIndex(project), result, dirty: false };
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

/** Capture, then apply: a local edit becomes a line before another host's version is considered. */
export function syncTree(project: Project, options: { who?: string } = {}): { capture: TreeCapture; apply: TreeApply } {
  return project.withLock(() => {
    const capture = captureTree(project, options);
    const apply = applyTree(project);
    return { capture, apply };
  });
}

// --- the checkout link -------------------------------------------------------

/** The entries under a folder: regular files, and anything that is neither a file nor a dir. */
interface FolderListing {
  files: string[];
  odd: string[];
}

/** Every file under `dir` (relative paths), and every entry that is not a regular file or a dir. */
function listFiles(dir: string): FolderListing {
  const files: string[] = [];
  const odd: string[] = [];
  const walk = (at: string, prefix: string): void => {
    for (const name of readdirSync(at).toSorted()) {
      const path = prefix === "" ? name : `${prefix}/${name}`;
      const stats = lstatSync(join(at, name));
      if (stats.isDirectory()) walk(join(at, name), path);
      else if (stats.isFile()) files.push(path);
      else odd.push(path);
    }
  };
  walk(dir, "");
  return { files, odd };
}

/** Moves `from` to `to`; across file systems as a copy that keeps mode and mtime, then a delete. */
function moveFile(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch (cause) {
    if (!hasErrnoCode(cause, "EXDEV")) throw cause;
    const stats = lstatSync(from);
    copyFileSync(from, to);
    chmodSync(to, stats.mode & 0o7777);
    utimesSync(to, stats.atime, stats.mtime);
    unlinkSync(from);
  }
}

function realOrResolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * Makes `<checkout>/.tracker` a symlink to the tree of `project`:
 *
 *   missing                 create the tree dir and the link
 *   a link to the tree      fine
 *   a link elsewhere        refuse, naming both paths
 *   a folder of local files move them into the tree where it lacks them,
 *                           remove the folder, create the link (what
 *                           `git pull` of the cutover commit leaves behind)
 *   any other folder        refuse
 *
 * Throws an Error with the operator message on a refusal.
 */
export function ensureTreeLink(checkout: string, project: Project): void {
  const link = join(checkout, TRACKER_LINK);
  const target = treeDir(project);
  const stats = lstatSync(link, { throwIfNoEntry: false });
  if (stats === undefined) {
    mkdirSync(target, { recursive: true });
    symlinkSync(target, link);
    return;
  }
  if (stats.isSymbolicLink()) {
    const points = resolve(dirname(link), readlinkSync(link));
    if (points === target || realOrResolved(link) === realOrResolved(target)) {
      mkdirSync(target, { recursive: true });
      return;
    }
    throw new Error(`${link} links to ${points}, but the darius store keeps the tracker of ${project.name} in ${target}. Remove the link and run darius again.`);
  }
  const refusal = `the darius store owns the tracker of ${project.name}, but a .tracker/ folder is in this checkout. Remove it from git (git rm -r .tracker) or merge the commit that did.`;
  if (!stats.isDirectory()) throw new Error(refusal);
  const { files, odd } = listFiles(link);
  if (odd.length > 0 || files.some((path) => !isLocalTreePath(path))) throw new Error(refusal);
  mkdirSync(target, { recursive: true });
  for (const path of files) {
    const to = join(target, path);
    if (existsSync(to)) continue;
    mkdirSync(dirname(to), { recursive: true });
    moveFile(join(link, path), to);
  }
  rmSync(link, { recursive: true, force: true });
  symlinkSync(target, link);
}

/** The `.gitignore` line that keeps the `.tracker` link out of git. */
export const TRACKER_IGNORE = "/.tracker";

/** Makes sure `<checkout>/.gitignore` has the line `/.tracker`: appends it, or creates the file. */
export function ignoreTrackerLink(checkout: string): "added" | "present" {
  const file = join(checkout, ".gitignore");
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (text.split(/\r?\n/u).some((line) => line.trim() === TRACKER_IGNORE)) return "present";
  const gap = text === "" || text.endsWith("\n") ? "" : "\n";
  writeFileSync(file, `${text}${gap}${TRACKER_IGNORE}\n`);
  return "added";
}
