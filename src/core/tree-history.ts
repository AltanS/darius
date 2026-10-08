/**
 * The history of the tracker tree in the store (0.73.0): read it, and bring a
 * past file version back.
 *
 * Every change to the tree is a `tree.put` or `tree.removed` ledger line and
 * every version is an immutable blob (src/core/tree.ts), so a deleted file is
 * never gone from the store. These functions give that history a verb:
 *
 *   treeLog          the `tree.*` lines for a file or a folder, newest first
 *   planRestore      which version each path would get back, and whether the
 *                    working copy is in the way
 *   restoreTree      write the plan as `tree.put` lines, then apply them
 *   removeTreeFolder write a `tree.removed` line per file under a folder,
 *                    then apply them (`darius milestone archive`)
 *
 * The two writers record first and then call `applyTree`, the one native path
 * that writes the working copy. So a restore or a removal is the same kind of
 * line another host's change is, sync carries it, and every host applies it.
 * Both run under the project lock, after a `syncTree`, like a tracker verb.
 */

import { existsSync, lstatSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { appendLines, defaultWho, type LedgerLineInput } from "./ledger.ts";
import { UsageError } from "./model.ts";
import { getBlob, sha256Hex, type Project } from "./store.ts";
import {
  applyTree,
  foldTree,
  indexedFiles,
  isLocalTreePath,
  isTreePath,
  localSha,
  syncTree,
  TREE_PUT,
  TREE_REMOVED,
  treeDir,
  type TreeLine,
} from "./tree.ts";

/** A file or a folder of the tree. `prefix` is "" for the whole tree. */
export interface TreeTarget {
  prefix: string;
  folder: boolean;
}

/** Removal lines of one host this close in time to the newest one belong to the same delete. */
const BATCH_MS = 100;
const SHA_ARG = /^[0-9a-f]{7,64}$/u;
/** A ledger id: a ULID, 26 Crockford base32 characters. */
const ULID_ARG = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

/**
 * Turns what the operator typed into a tree target: `.tracker/M1-x/`, an
 * absolute path through the link or into the working copy, or a bare tree
 * path. A trailing `/` (or the tree root) names a folder; otherwise the
 * history decides: a path with lines of its own is a file.
 */
export function treeTarget(project: Project, input: string, checkout: string, history: ReadonlyMap<string, TreeLine[]>): TreeTarget {
  let path = input.trim();
  const roots = [join(checkout, ".tracker"), treeDir(project)];
  for (const root of roots) {
    if (path === root) path = "";
    else if (path.startsWith(`${root}/`)) path = path.slice(root.length + 1);
  }
  while (path.startsWith("./")) path = path.slice(2);
  if (path === ".tracker") path = "";
  else if (path.startsWith(".tracker/")) path = path.slice(".tracker/".length);
  const trailing = path.endsWith("/");
  path = path.replace(/\/+$/u, "");
  if (path === "") return { prefix: "", folder: true };
  if (!isTreePath(path)) throw new UsageError(`not a path in the tracker tree: ${input}`);
  if (trailing) return { prefix: path, folder: true };
  return { prefix: path, folder: !history.has(path) };
}

function matches(target: TreeTarget, path: string): boolean {
  if (target.prefix === "") return true;
  return target.folder ? path.startsWith(`${target.prefix}/`) : path === target.prefix;
}

/** One `tree.*` line as `tree log` shows it. */
export interface TreeLogEntry {
  id: string;
  at: string;
  host: string;
  who: string;
  type: "tree.put" | "tree.removed";
  path: string;
  /** The blob after a put; the blob a removal took away. */
  sha: string | null;
  size: number | null;
}

/** The `tree.*` lines of a file or a folder, newest first. */
export function treeLog(history: ReadonlyMap<string, TreeLine[]>, target: TreeTarget): TreeLogEntry[] {
  const entries: TreeLogEntry[] = [];
  for (const [path, lines] of history) {
    if (!matches(target, path)) continue;
    for (const line of lines) {
      entries.push({ id: line.id, at: line.at, host: line.host, who: line.who, type: line.type, path, sha: line.after ?? line.prev, size: line.size });
    }
  }
  return entries.toSorted((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/** One path of a restore plan. */
export interface RestoreStep {
  path: string;
  /** The version to bring back. */
  sha: string;
  size: number;
  exec: boolean;
  /** The ledger id of the `tree.put` that wrote this version. */
  from: string;
  /**
   *   restore   the working copy lacks it: it is written
   *   same      the working copy already holds this version: nothing to do
   *   differs   another version is in the working copy: written only with force
   *   no-blob   the blob is not on this host yet: run darius sync
   */
  state: "restore" | "same" | "differs" | "no-blob";
}

export interface RestorePlan {
  /** What the plan undoes or goes back to, in words. */
  basis: string;
  steps: RestoreStep[];
}

/** The newest put before index `end` of `lines`, or null. */
function putBefore(lines: readonly TreeLine[], end: number): TreeLine | null {
  for (let at = end - 1; at >= 0; at -= 1) {
    const line = lines[at];
    if (line?.type === TREE_PUT) return line;
  }
  return null;
}

/** The versions a restore brings back, and what they undo. */
interface UndoSet {
  basis: string;
  versions: TreeLine[];
}

/**
 * For each path: the version before its latest removal. A folder takes the
 * paths of the newest delete only: the removal lines of one host whose time
 * is within BATCH_MS of the newest one. A capture gives all its lines one
 * time, so one delete is one time (older captures differ by a few ms).
 */
function undoVersions(history: ReadonlyMap<string, TreeLine[]>, target: TreeTarget): UndoSet {
  const label = target.prefix === "" ? "the tree" : target.prefix;
  const removals: { index: number; line: TreeLine }[] = [];
  for (const [path, lines] of history) {
    if (!matches(target, path)) continue;
    const index = lines.findLastIndex((line) => line.type === TREE_REMOVED);
    const line = lines[index];
    if (line !== undefined) removals.push({ index, line });
  }
  const latest = removals.reduce<TreeLine | null>((best, { line }) => (best === null || line.id > best.id ? line : best), null);
  if (latest === null) throw new Error(`nothing was removed under ${label}; name a version with --at <sha|ledger-id> (see darius tree log ${label})`);
  const latestMs = Date.parse(latest.at);
  const versions: TreeLine[] = [];
  for (const { index, line } of removals) {
    if (line.host !== latest.host || Math.abs(Date.parse(line.at) - latestMs) > BATCH_MS) continue;
    const version = putBefore(history.get(line.path) ?? [], index);
    if (version !== null) versions.push(version);
  }
  if (versions.length === 0) throw new Error(`the removal ${latest.id} under ${label} left no earlier version to restore`);
  return { basis: `undo the removal ${latest.id} (${latest.at}, ${latest.host})`, versions };
}

/** For each path: the version it had at ledger id `id` (paths absent then are left alone). */
function versionsAt(history: ReadonlyMap<string, TreeLine[]>, target: TreeTarget, id: string): TreeLine[] {
  const versions: TreeLine[] = [];
  for (const [path, lines] of history) {
    if (!matches(target, path)) continue;
    const upTo = lines.findLast((line) => line.id <= id);
    if (upTo?.type === TREE_PUT) versions.push(upTo);
  }
  if (versions.length === 0) throw new Error(`no file under ${target.prefix === "" ? "the tree" : target.prefix} existed at ${id}`);
  return versions;
}

/** The put of a file whose blob sha starts with `sha`; one version only. */
function versionWithSha(history: ReadonlyMap<string, TreeLine[]>, target: TreeTarget, sha: string): TreeLine {
  if (target.folder) throw new UsageError("--at <sha> names one file version; for a folder use --at <ledger-id>");
  const puts = (history.get(target.prefix) ?? []).filter((line) => line.type === TREE_PUT && line.after?.startsWith(sha) === true);
  const shas = new Set(puts.map((line) => line.after));
  if (shas.size === 0) throw new Error(`${target.prefix} never had a version ${sha} (see darius tree log ${target.prefix})`);
  if (shas.size > 1) throw new UsageError(`${sha} matches more than one version of ${target.prefix}; give more of the sha`);
  const newest = puts.at(-1);
  if (newest === undefined) throw new Error(`${target.prefix} never had a version ${sha}`);
  return newest;
}

function stepFor(project: Project, version: TreeLine): RestoreStep {
  const sha = version.after ?? "";
  const blob = getBlob(project, sha);
  const base = { path: version.path, sha, exec: version.exec, from: version.id };
  if (blob === null) return { ...base, size: version.size ?? 0, state: "no-blob" };
  const full = join(treeDir(project), version.path);
  const stats = lstatSync(full, { throwIfNoEntry: false });
  let state: RestoreStep["state"] = "restore";
  if (stats !== undefined) state = stats.isFile() && sha256Hex(readFileSync(full)) === sha ? "same" : "differs";
  return { ...base, size: blob.length, state };
}

/**
 * What a restore of `target` would do. Without `at` it undoes the latest
 * removal: a file gets its version before that removal; a folder gets every
 * file that removal took (lines of one host within BATCH_MS of the newest
 * one), each at its version before it. `at` is a blob sha (a file only) or a
 * ledger id (every path under the target at that point). Reads only.
 */
export function planRestore(project: Project, history: ReadonlyMap<string, TreeLine[]>, target: TreeTarget, at?: string): RestorePlan {
  let basis: string;
  let versions: TreeLine[];
  if (at === undefined) {
    ({ basis, versions } = undoVersions(history, target));
  } else if (SHA_ARG.test(at)) {
    const version = versionWithSha(history, target, at);
    basis = `restore version ${(version.after ?? at).slice(0, 12)}`;
    versions = [version];
  } else if (ULID_ARG.test(at)) {
    basis = `the tree as of ${at}`;
    versions = versionsAt(history, target, at);
  } else {
    throw new UsageError(`--at takes a blob sha (7 to 64 hex characters) or a ledger id, not '${at}'`);
  }
  const steps = versions.map((version) => stepFor(project, version)).toSorted((a, b) => (a.path < b.path ? -1 : 1));
  // The removal is already undone when every file is back in the working copy (a later put, or an
  // earlier restore): "undo the removal" would be wrong. The plan then goes back to a version.
  const live = steps.length > 0 && steps.every((step) => step.state === "same" || step.state === "differs");
  if (at === undefined && live) {
    const [only] = steps;
    basis = steps.length === 1 && only !== undefined ? `restore version ${only.sha.slice(0, 12)}` : `restore ${String(steps.length)} versions from before a removal that is already undone`;
  }
  return { basis, steps };
}

/** What a restore wrote. */
export interface RestoreResult {
  plan: RestorePlan;
  /** Paths written back. */
  restored: string[];
  problems: string[];
}

/** The refusal for a plan, or null when it may be written. */
export function restoreRefusal(plan: RestorePlan, force: boolean): string | null {
  const missing = plan.steps.filter((step) => step.state === "no-blob");
  if (missing.length > 0) return `the blob of ${missing.map((step) => step.path).join(", ")} is not on this host yet; run darius sync first`;
  const differs = plan.steps.filter((step) => step.state === "differs");
  if (differs.length > 0 && !force) return `another version is in the working copy: ${differs.map((step) => step.path).join(", ")}; pass --force to replace it`;
  return null;
}

/**
 * Brings `target` back (see `planRestore`). Under the project lock: a sync
 * first, so the working copy and the index are current; then one `tree.put`
 * line per path that needs it, then `applyTree` writes the files. Throws the
 * refusal of `restoreRefusal`.
 */
export function restoreTree(project: Project, target: TreeTarget, options: { at?: string; force?: boolean; who?: string } = {}): RestoreResult {
  return project.withLock(() => {
    const synced = syncTree(project, { who: options.who });
    const problems = [...synced.capture.problems, ...synced.apply.problems];
    const plan = planRestore(project, foldTree(project, problems), target, options.at);
    const refusal = restoreRefusal(plan, options.force === true);
    if (refusal !== null) throw new Error(refusal);
    const index = indexedFiles(project);
    const who = options.who ?? defaultWho();
    const todo = plan.steps.filter((step) => step.state === "restore" || step.state === "differs");
    const lines: LedgerLineInput[] = todo.map((step) => {
      const line: LedgerLineInput = { who, type: TREE_PUT, path: step.path, body_sha: step.sha, size: step.size, prev_sha: localSha(project, index.get(step.path)?.sha) };
      if (step.exec) line.exec = true;
      return line;
    });
    appendLines(project, lines);
    const applied = applyTree(project);
    problems.push(...applied.problems);
    const restored = todo.filter((step) => {
      const full = join(treeDir(project), step.path);
      return existsSync(full) && sha256Hex(readFileSync(full)) === step.sha;
    });
    for (const step of todo) {
      if (!restored.includes(step)) problems.push(`${step.path} was recorded but not written; run darius sync and check it`);
    }
    return { plan, restored: restored.map((step) => step.path), problems };
  });
}

/** Every regular file under `folder` of the working copy, tree-relative, sorted. Reads only. */
export function filesUnder(project: Project, folder: string): string[] {
  const root = treeDir(project);
  const files: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).toSorted()) {
      const path = `${prefix}/${name}`;
      const stats = lstatSync(join(dir, name));
      if (stats.isDirectory()) walk(join(dir, name), path);
      else if (!isLocalTreePath(path)) files.push(path);
    }
  };
  if (existsSync(join(root, folder))) walk(join(root, folder), folder);
  return files;
}

/** What `removeTreeFolder` did. */
export interface TreeRemoval {
  removed: string[];
  problems: string[];
}

/**
 * Removes `folder` from the tree as one delete. Under the project lock: a
 * sync first, so every file is in the index; then one `tree.removed` line per
 * file under it, all with one time, then `applyTree` deletes them. Host-local
 * files left in the folder (lock and temp files) go with it. `note` rides on
 * every removal line (the reason of an archive that was not complete).
 */
export function removeTreeFolder(project: Project, folder: string, options: { who?: string; note?: string } = {}): TreeRemoval {
  if (!isTreePath(folder)) throw new UsageError(`not a folder of the tracker tree: ${folder}`);
  return project.withLock(() => {
    const synced = syncTree(project, { who: options.who });
    const problems = [...synced.capture.problems, ...synced.apply.problems];
    const who = options.who ?? defaultWho();
    const at = new Date().toISOString();
    const files = [...indexedFiles(project)].filter(([path]) => path.startsWith(`${folder}/`)).toSorted(([a], [b]) => (a < b ? -1 : 1));
    appendLines(
      project,
      files.map(([path, entry]) => {
        const line: LedgerLineInput = { who, at, type: TREE_REMOVED, path, prev_sha: localSha(project, entry.sha) };
        if (options.note !== undefined) line.note = options.note;
        return line;
      }),
    );
    const applied = applyTree(project);
    problems.push(...applied.problems);
    const full = join(treeDir(project), folder);
    if (existsSync(full)) {
      const left = filesUnderAll(full);
      if (left.every((path) => isLocalTreePath(`${folder}/${path}`))) rmSync(full, { recursive: true, force: true });
      else problems.push(`${folder} still holds files the tree does not track: ${left.join(", ")}; left as they are`);
    }
    const removed = files.map(([path]) => path).filter((path) => !existsSync(join(treeDir(project), path)));
    return { removed, problems };
  });
}

/** Every entry under `dir` that is not a folder, relative to it. */
function filesUnderAll(dir: string): string[] {
  const found: string[] = [];
  const walk = (at: string, prefix: string): void => {
    for (const name of readdirSync(at).toSorted()) {
      const path = prefix === "" ? name : `${prefix}/${name}`;
      if (lstatSync(join(at, name)).isDirectory()) walk(join(at, name), path);
      else found.push(path);
    }
  };
  walk(dir, "");
  return found;
}
