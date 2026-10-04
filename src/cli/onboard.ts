/**
 * `darius onboard [scan] [--dry-run] [--only vigil] [--json]`: move a repo's
 * legacy `.tracker/` folder into the darius store (src/core/tree.ts).
 *
 * Run it in a linked checkout with a v3 marker. The checkout root is the dir
 * of the nearest `.darius.toml`.
 *
 *   scan        read-only report: the marker kinds, what `.tracker` is here,
 *               its files and bytes, whether git tracks it and whether it is
 *               clean, the vigil files, what the store already holds, and
 *               the blockers. Exit 0 nothing blocks, 1 something blocks, 3
 *               nothing to do (no `.tracker` folder here).
 *   --dry-run   the scan, the vigil import dry run, and the files that would
 *               be copied. Writes nothing.
 *   (none)      the move, in five steps, the only destructive one last:
 *                 1. vigils: import `.tracker/vigils/*.md` into the store
 *                    (a dry run first; any problem stops here)
 *                 2. copy every file except `vigils/` into the tree dir,
 *                    keeping mode and mtime; check the sha256 of each copy
 *                 3. capture the tree into the ledger, then one
 *                    `project.cutover` line
 *                 4. `.darius.toml`: kinds = ["ritual", "vigil", "milestone"]
 *                 5. check that every file left in `.tracker/` has an
 *                    identical copy in the tree dir or in git HEAD, `git rm
 *                    -r --cached .tracker`, remove the folder, link
 *                    `.tracker` to the tree dir, add `/.tracker` to
 *                    `.gitignore`, then write the store's vigils as files
 *                    under `.tracker/vigils/` (src/core/vigil-projection.ts)
 *               Nothing is committed: the operator commits the marker, the
 *               `.gitignore` and the staged removal. Imported open vigils
 *               are heavy, so the daily sweep skips them; the summary says
 *               so, and `darius vigil set <slug> --no-heavy` allows one.
 *   --only vigil  step 1, kinds = ["ritual", "vigil"], `git rm -r -q
 *               .tracker/vigils`. No copy and no link.
 *
 * Preconditions, each a refusal with exit 1: a v3 marker that names a
 * project linked to this checkout; `.tracker` is a real folder; every file
 * in it is committed and unmodified (host-local and derived files and
 * git-ignored files aside, but never under `vigils/`); the marker does not
 * list `milestone` yet (`vigil` for `--only vigil`); the store holds no tree
 * for the project yet.
 *
 * `--json` prints one object in every mode.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { OwnedKind } from "../core/kinds.ts";
import type { Vigil } from "../core/model.ts";
import { appendLine, defaultWho, readLedger } from "../core/ledger.ts";
import { readLegacyVigils } from "../core/legacy-vigils.ts";
import { linkedDir } from "../core/links.ts";
import { decodeMarker, findMarker, MARKER_FILE, readMarker, type Marker } from "../core/marker.ts";
import { projectDir } from "../core/paths.ts";
import { openProject, type Project } from "../core/store.ts";
import { parseToml } from "../core/toml.ts";
import {
  captureTree,
  ensureTreeLink,
  ignoreTrackerLink,
  isLocalTreePath,
  pendingTreeChanges,
  TRACKER_IGNORE,
  TRACKER_LINK,
  TREE_PUT,
  TREE_REMOVED,
  treeDir,
  type TreeCapture,
} from "../core/tree.ts";
import { importLegacyVigils, type VigilImportResult } from "../core/vigil-import.ts";
import { projectVigils } from "../core/vigil-projection.ts";
import { errorMessage } from "../runtime.ts";
import { UsageError, type Command, type ParsedArgs } from "./registry.ts";

const USAGE = "usage: darius onboard [scan] [--dry-run] [--only vigil] [--json]";
const EXIT_OK = 0;
const EXIT_REFUSED = 1;
const EXIT_NOTHING = 3;
/** The kinds line onboard writes, by mode. */
const FULL_KINDS: readonly OwnedKind[] = ["ritual", "vigil", "milestone"];
const VIGIL_KINDS: readonly OwnedKind[] = ["ritual", "vigil"];
const CUTOVER_LINE = "project.cutover";
const VIGILS = "vigils";
const COMMIT_MESSAGE = "chore(darius): the darius store owns the tracker";

type Mode = "scan" | "dry-run" | "move";
type Scope = "all" | "vigil";

/** What `.tracker` is in this checkout. */
type TrackerKind = "missing" | "folder" | "link" | "other";

interface GitState {
  /** The checkout is in a git work tree. */
  repo: boolean;
  /** git tracks at least one file under `.tracker/`. */
  tracked: boolean;
  /** Changed or untracked paths that block the move (relative to the checkout). */
  dirty: string[];
}

/** What the scan finds. */
interface Survey {
  root: string;
  project: string;
  version: number;
  kinds: readonly OwnedKind[];
  linked: boolean;
  tracker: TrackerKind;
  files: number;
  bytes: number;
  git: GitState;
  vigils: { files: number; open: number; closed: number };
  store: { exists: boolean; tree: boolean; vigils: number };
  /** Paths a capture would record now, when the store already owns the tree. */
  pending: string[];
  problems: string[];
  blockers: string[];
  /** Nothing to do here: no `.tracker` folder. */
  nothing: boolean;
}

/** One file of `.tracker/` that onboard copies. */
interface SourceFile {
  path: string;
  size: number;
}

/** What git printed, and whether it exited 0. */
interface GitRun {
  ok: boolean;
  out: string;
  err: string;
}

/** Everything under a folder: files with sizes, dirs, and entries that are neither. */
interface Listing {
  files: SourceFile[];
  dirs: string[];
  odd: string[];
}

/** What step 2 copies. */
interface CopyPlan {
  files: SourceFile[];
  dirs: string[];
}

/** What step 2 copied. */
interface CopyCount {
  files: number;
  bytes: number;
}

/** What step 1 did, or would do. */
interface VigilStep {
  summary: string;
  result: VigilImportResult | null;
  /** The imported vigils that are heavy now: the open ones. The daily sweep skips them. */
  heavy: string[];
}

interface StepReport {
  step: number;
  name: string;
  summary: string;
}

/** Thrown by a step: the message, and the step it stopped at. */
class StepFailure extends Error {
  override name = "StepFailure";
  readonly step: number;

  constructor(step: number, message: string) {
    super(message);
    this.step = step;
  }
}

// --- small helpers -----------------------------------------------------------

function git(root: string, args: readonly string[]): GitRun {
  // No optional locks: a scan must not even refresh the git index.
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
  const result = spawnSync("git", args, { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
  return { ok: result.status === 0, out: result.stdout, err: result.stderr.trim() };
}

function realOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** The git object id of a file's content: sha1 or sha256 of `blob <size>\0<bytes>`, by the repo's id length. */
function gitBlobId(path: string, length: number): string {
  const bytes = readFileSync(path);
  return createHash(length === 64 ? "sha256" : "sha1")
    .update(`blob ${String(bytes.length)}\0`)
    .update(bytes)
    .digest("hex");
}

function trackerKind(root: string): TrackerKind {
  const stats = lstatSync(join(root, TRACKER_LINK), { throwIfNoEntry: false });
  if (stats === undefined) return "missing";
  if (stats.isSymbolicLink()) return "link";
  return stats.isDirectory() ? "folder" : "other";
}

/** Every file under `dir`, relative, with its size; non-regular entries go to `odd`. Dirs come in `dirs`. */
function walk(dir: string): Listing {
  const files: SourceFile[] = [];
  const dirs: string[] = [];
  const odd: string[] = [];
  const visit = (at: string, prefix: string): void => {
    for (const name of readdirSync(at).toSorted()) {
      const path = prefix === "" ? name : `${prefix}/${name}`;
      const stats = lstatSync(join(at, name));
      if (stats.isDirectory()) {
        dirs.push(path);
        visit(join(at, name), path);
      } else if (stats.isFile()) files.push({ path, size: stats.size });
      else odd.push(path);
    }
  };
  visit(dir, "");
  return { files, dirs, odd };
}

function isUnderVigils(path: string): boolean {
  return path === VIGILS || path.startsWith(`${VIGILS}/`);
}

/** A path that may be dirty without blocking: host-local or derived, but never a vigil file (the import reads those). */
function mayBeDirty(path: string): boolean {
  return isLocalTreePath(path) && !isUnderVigils(path);
}

function vigilFiles(root: string): string[] {
  const dir = join(root, TRACKER_LINK, VIGILS);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith(".md"));
}

function hasTreeLines(project: Project): boolean {
  return readLedger(project).some((line) => line.type === TREE_PUT || line.type === TREE_REMOVED);
}

function isNonEmptyDir(path: string): boolean {
  return existsSync(path) && readdirSync(path).length > 0;
}

function kindsText(kinds: readonly OwnedKind[]): string {
  return `[${kinds.map((kind) => `"${kind}"`).join(", ")}]`;
}

// --- git state ---------------------------------------------------------------

/** The changed and untracked paths under `pathspec` that block the move. */
function gitState(root: string, pathspec: string): GitState {
  const inside = git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.out.trim() !== "true") return { repo: false, tracked: false, dirty: [] };
  const tracked = git(root, ["ls-files", "-z", "--", pathspec]);
  const status = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", pathspec]);
  const dirty: string[] = [];
  const tokens = status.out.split("\0");
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (token.length < 4) continue;
    const code = token.slice(0, 2);
    const path = token.slice(3);
    // A rename or copy has its old path in the next token.
    if (code.startsWith("R") || code.startsWith("C")) index += 1;
    const inTracker = path.startsWith(`${TRACKER_LINK}/`) ? path.slice(TRACKER_LINK.length + 1) : path;
    if (!mayBeDirty(inTracker)) dirty.push(`${code.trim()} ${path}`);
  }
  if (!status.ok) dirty.push(`git status failed: ${status.err}`);
  return { repo: true, tracked: tracked.ok && tracked.out !== "", dirty };
}

/** `path -> object id` of every file under `.tracker/` in HEAD. */
function headBlobs(root: string): Map<string, string> {
  const listed = git(root, ["ls-tree", "-r", "-z", "HEAD", "--", TRACKER_LINK]);
  const blobs = new Map<string, string>();
  if (!listed.ok) return blobs;
  for (const entry of listed.out.split("\0")) {
    const tab = entry.indexOf("\t");
    if (tab === -1) continue;
    const [, type, id] = entry.slice(0, tab).split(" ");
    if (type === "blob" && id !== undefined) blobs.set(entry.slice(tab + 1), id);
  }
  return blobs;
}

// --- the survey --------------------------------------------------------------

function surveyStore(project: string): Survey["store"] & { handle: Project | null } {
  if (!existsSync(projectDir(project))) return { exists: false, tree: false, vigils: 0, handle: null };
  const handle = openProject(project);
  return { exists: true, tree: hasTreeLines(handle) || isNonEmptyDir(treeDir(handle)), vigils: handle.listItems("vigil").length, handle };
}

function surveyMarker(cwd: string): Marker {
  const marker = findMarker(cwd);
  if (marker === null) throw new Error(`no ${MARKER_FILE} in ${cwd} or above it. Run darius init in the repo root first.`);
  return marker;
}

/** The scan: read-only. */
function survey(marker: Marker, scope: Scope): Survey {
  const root = marker.dir;
  const linked = linkedDir(marker.project);
  const tracker = trackerKind(root);
  const result: Survey = {
    root,
    project: marker.project,
    version: marker.version,
    kinds: marker.kinds,
    linked: linked !== undefined && realOr(linked) === realOr(root),
    tracker,
    files: 0,
    bytes: 0,
    git: { repo: false, tracked: false, dirty: [] },
    vigils: { files: 0, open: 0, closed: 0 },
    store: { exists: false, tree: false, vigils: 0 },
    pending: [],
    problems: [],
    blockers: [],
    nothing: false,
  };
  const { handle, ...store } = surveyStore(marker.project);
  result.store = store;
  const isTree = marker.kinds.includes("milestone");
  if (tracker === "folder") {
    const listing = walk(join(root, TRACKER_LINK));
    result.files = listing.files.length;
    result.bytes = listing.files.reduce((sum, file) => sum + file.size, 0);
    for (const path of listing.odd) result.blockers.push(`.tracker/${path} is not a regular file; the tree keeps regular files only. Remove it or replace it with a file.`);
    result.git = gitState(root, scope === "vigil" ? `${TRACKER_LINK}/${VIGILS}` : TRACKER_LINK);
    const legacy = readLegacyVigils(root);
    result.vigils = { files: vigilFiles(root).length, open: legacy.filter((vigil) => vigil.resolved === null).length, closed: legacy.filter((vigil) => vigil.resolved !== null).length };
    if (scope === "all") {
      const blobs = headBlobs(root);
      for (const file of listing.files) {
        if (isUnderVigils(file.path) && !blobs.has(`${TRACKER_LINK}/${file.path}`)) {
          result.blockers.push(`.tracker/${file.path} is not committed; the move keeps vigils/ only in git and the store. Commit it or remove it.`);
        }
      }
    }
  }
  if (isTree && tracker === "link" && handle !== null) {
    const pending = pendingTreeChanges(handle);
    result.pending = pending.changed;
    result.problems.push(...pending.problems);
  }
  addBlockers(result, scope);
  return result;
}

function addBlockers(result: Survey, scope: Scope): void {
  const blockers = result.blockers;
  const ownedAlready = scope === "vigil" ? result.kinds.includes("vigil") : result.kinds.includes("milestone");
  const noVigils = scope === "vigil" && result.tracker === "folder" && !existsSync(join(result.root, TRACKER_LINK, VIGILS));
  if ((result.tracker !== "folder" && result.tracker !== "other") || noVigils) {
    // No `.tracker/` folder (or no `.tracker/vigils/` for --only vigil) here: nothing to move.
    result.nothing = true;
    return;
  }
  if (result.version !== 3) blockers.unshift(`${MARKER_FILE} is v = ${String(result.version)}; darius onboard needs v = 3`);
  if (!result.linked) blockers.push(`this checkout is not linked to ${result.project} on this host: run darius link here`);
  if (result.tracker === "other") blockers.push(".tracker is neither a folder nor a link: move it away");
  if (ownedAlready) {
    blockers.push(`${MARKER_FILE} already lists ${scope === "vigil" ? "vigil" : "milestone"} in kinds, but .tracker/ is a folder. Remove it from git (git rm -r .tracker) or merge the commit that did.`);
  }
  if (!result.git.repo) blockers.push("this checkout is not in git: the move needs .tracker/ committed");
  else if (!result.git.tracked) blockers.push(`git tracks no file under .tracker/${scope === "vigil" ? VIGILS : ""}: commit it first`);
  if (result.git.dirty.length > 0) {
    const shown = result.git.dirty.slice(0, 10).join(", ");
    const more = result.git.dirty.length > 10 ? ` and ${String(result.git.dirty.length - 10)} more` : "";
    blockers.push(`.tracker/ has uncommitted changes: ${shown}${more}. Commit or remove them first.`);
  }
  if (scope === "all" && result.store.tree) blockers.push("already onboarded: pull the marker commit and run darius sync");
}

// --- output ------------------------------------------------------------------

function surveyJson(result: Survey) {
  return {
    project: result.project,
    dir: result.root,
    kinds: result.kinds,
    linked: result.linked,
    tracker: result.tracker,
    files: result.files,
    bytes: result.bytes,
    git: { repo: result.git.repo, tracked: result.git.tracked, clean: result.git.dirty.length === 0, dirty: result.git.dirty },
    vigils: result.vigils,
    store: result.store,
    pending: result.pending,
    problems: result.problems,
    blockers: result.blockers,
  };
}

function surveyLines(result: Survey): string[] {
  const lines = [
    `project ${result.project} at ${result.root}, kinds ${kindsText(result.kinds)}${result.linked ? "" : " (not linked here)"}`,
    `.tracker: ${result.tracker}${result.tracker === "folder" ? `, ${String(result.files)} files, ${String(result.bytes)} bytes` : ""}`,
  ];
  if (result.tracker === "folder") {
    const clean = result.git.dirty.length === 0 ? "clean" : `${String(result.git.dirty.length)} uncommitted changes`;
    lines.push(`git: ${result.git.repo ? (result.git.tracked ? `tracked, ${clean}` : "not tracked") : "not a git checkout"}`);
    lines.push(`vigil files: ${String(result.vigils.files)} (${String(result.vigils.open)} open, ${String(result.vigils.closed)} closed)`);
  }
  lines.push(`store: ${result.store.exists ? `${result.store.tree ? "holds a tree" : "no tree"}, ${String(result.store.vigils)} vigil items` : "none on this host"}`);
  if (result.tracker === "link") lines.push(`pending tree changes: ${result.pending.length === 0 ? "none" : result.pending.join(", ")}`);
  lines.push(...result.problems.map((problem) => `! ${problem}`));
  if (result.nothing) lines.push("· nothing to do: there is no .tracker/ folder here");
  else if (result.blockers.length === 0) lines.push("✓ nothing blocks the move");
  else lines.push(...result.blockers.map((blocker) => `✗ ${blocker}`));
  return lines;
}

// --- the steps ---------------------------------------------------------------

/** Step 1: the vigil import, a dry run first. Skipped when there are no vigil files or the marker already lists vigil. */
function importVigils(project: Project, root: string, kinds: readonly OwnedKind[], dryRun: boolean): VigilStep {
  if (kinds.includes("vigil")) return { summary: "skipped: the marker already lists vigil", result: null, heavy: [] };
  if (vigilFiles(root).length === 0) return { summary: "none in .tracker/vigils", result: null, heavy: [] };
  const source = join(root, TRACKER_LINK);
  const trial = importLegacyVigils(project, source, { dryRun: true, who: defaultWho() });
  if (trial.problems.length > 0) throw new StepFailure(1, `the vigil import dry run found problems:\n  ${trial.problems.join("\n  ")}`);
  if (dryRun) {
    const summary = `would import ${String(trial.imported.length)}, ${String(trial.unchanged.length)} unchanged, ${String(trial.closed)} closed; open ones come in heavy`;
    return { summary, result: trial, heavy: [] };
  }
  const done = importLegacyVigils(project, source, { dryRun: false, who: defaultWho() });
  if (done.problems.length > 0) throw new StepFailure(1, `the vigil import found problems:\n  ${done.problems.join("\n  ")}`);
  const heavy = done.imported.filter((slug) => project.readItem<Vigil>("vigil", slug)?.header.heavy === true);
  return { summary: `imported ${String(done.imported.length)}, ${String(done.unchanged.length)} unchanged, ${String(done.closed)} closed`, result: done, heavy };
}

/** The one line about imported open vigils, or null when there are none. */
function heavyLine(heavy: readonly string[]): string | null {
  if (heavy.length === 0) return null;
  const count = heavy.length === 1 ? "1 open vigil was" : `${String(heavy.length)} open vigils were`;
  return `${count} imported as heavy: the daily sweep skips them. Allow one with: darius vigil set <slug> --no-heavy`;
}

/** The files and dirs step 2 copies: everything under `.tracker/` except `vigils/`. */
function copyPlan(root: string): CopyPlan {
  const listing = walk(join(root, TRACKER_LINK));
  return { files: listing.files.filter((file) => !isUnderVigils(file.path)), dirs: listing.dirs.filter((dir) => !isUnderVigils(dir)) };
}

/** Copies one file keeping mode and mtime, then checks the copy's sha256. */
function copyChecked(from: string, to: string): void {
  const stats = lstatSync(from);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to, constants.COPYFILE_EXCL);
  chmodSync(to, stats.mode & 0o7777);
  utimesSync(to, stats.atime, stats.mtime);
  if (sha256File(to) !== sha256File(from)) throw new Error(`the copy of ${from} differs from its source`);
}

/** Step 2: copy into the tree dir. Any failure removes the copy again: the dir was empty before. */
function copyTree(project: Project, root: string): CopyCount {
  const target = treeDir(project);
  const plan = copyPlan(root);
  try {
    mkdirSync(target, { recursive: true });
    for (const dir of plan.dirs) mkdirSync(join(target, dir), { recursive: true });
    for (const file of plan.files) copyChecked(join(root, TRACKER_LINK, file.path), join(target, file.path));
  } catch (cause) {
    rmSync(target, { recursive: true, force: true });
    throw new StepFailure(2, `${errorMessage(cause)}. The copy was removed again; nothing else changed.`);
  }
  return { files: plan.files.length, bytes: plan.files.reduce((sum, file) => sum + file.size, 0) };
}

/** The index of the first `#` outside a quoted or literal string, or -1. */
function commentStart(text: string): number {
  let at = 0;
  while (at < text.length) {
    const ch = text[at];
    if (ch === "#") return at;
    if (ch === '"') {
      at += 1;
      while (at < text.length && text[at] !== '"') at += text[at] === "\\" ? 2 : 1;
    } else if (ch === "'") {
      at += 1;
      while (at < text.length && text[at] !== "'") at += 1;
    }
    at += 1;
  }
  return -1;
}

/**
 * The marker text with the root `kinds` set to `kinds`. An existing key is
 * replaced in place (a comment after it on its line stays); a missing one
 * goes after the last root key, before the first table. Every other byte stays.
 */
export function withKinds(text: string, file: string, kinds: readonly OwnedKind[]): string {
  const { layout } = parseToml(text, file);
  const lines = text.split("\n");
  const cr = text.includes("\r\n") ? "\r" : "";
  const line = `kinds = ${kindsText(kinds)}`;
  const existing = layout.find((entry) => entry.kind === "key" && entry.section === "" && entry.key === "kinds");
  if (existing !== undefined) {
    const last = (lines[existing.end - 1] ?? "").replace(/\r$/u, "");
    const comment = existing.start === existing.end ? commentStart(last) : -1;
    const tail = comment === -1 ? "" : `  ${last.slice(comment)}`;
    lines.splice(existing.start - 1, existing.end - existing.start + 1, `${line}${tail}${cr}`);
    return lines.join("\n");
  }
  const rootKeys = layout.filter((entry) => entry.kind === "key" && entry.section === "");
  const after = Math.max(0, ...rootKeys.map((entry) => entry.end));
  lines.splice(after, 0, `${line}${cr}`);
  return lines.join("\n");
}

/** Step 4 (and the `--only vigil` marker step): set the kinds, prove it with the parser, write, read back. */
function writeKinds(marker: Marker, kinds: readonly OwnedKind[], step: number): void {
  const text = readFileSync(marker.file, "utf8");
  const proposed = withKinds(text, marker.file, kinds);
  const parsed = decodeMarker(proposed, marker.file);
  if (kindsText(parsed.kinds) !== kindsText(kinds) || parsed.project !== marker.project) {
    throw new StepFailure(step, `the edited ${MARKER_FILE} reads back as kinds ${kindsText(parsed.kinds)}; it was not written`);
  }
  const temp = `${marker.file}.tmp.${String(process.pid)}`;
  writeFileSync(temp, proposed);
  renameSync(temp, marker.file);
  const reread = readMarker(marker.dir);
  if (reread === null || kindsText(reread.kinds) !== kindsText(kinds)) throw new StepFailure(step, `${MARKER_FILE} does not read back as kinds ${kindsText(kinds)}`);
}

/**
 * Step 5, first part: every file still in `.tracker/` must have an identical
 * copy, in the tree dir or in git HEAD, before the folder goes. Host-local
 * files are copied again first: a hook may have touched one since step 2.
 */
function checkLeftovers(project: Project, root: string): void {
  const source = join(root, TRACKER_LINK);
  const target = treeDir(project);
  const blobs = headBlobs(root);
  const listing = walk(source);
  const missing: string[] = [...listing.odd];
  for (const file of listing.files) {
    const from = join(source, file.path);
    const to = join(target, file.path);
    if (mayBeDirty(file.path)) {
      rmSync(to, { force: true });
      copyChecked(from, to);
      continue;
    }
    if (existsSync(to) && sha256File(to) === sha256File(from)) continue;
    const id = blobs.get(`${TRACKER_LINK}/${file.path}`);
    if (id !== undefined && gitBlobId(from, id.length) === id) continue;
    missing.push(file.path);
  }
  if (missing.length > 0) {
    throw new StepFailure(5, `these files in .tracker/ changed after the copy, or have no copy in the store or in git HEAD: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? " ..." : ""}`);
  }
}

/** Step 5: remove `.tracker/` from git and the checkout, then link it to the tree dir and ignore the link. */
function replaceFolder(project: Project, root: string): void {
  checkLeftovers(project, root);
  const removed = git(root, ["rm", "-r", "-q", "--cached", "--", TRACKER_LINK]);
  if (!removed.ok) throw new StepFailure(5, `git rm -r --cached .tracker failed: ${removed.err}`);
  rmSync(join(root, TRACKER_LINK), { recursive: true, force: true });
  ensureTreeLink(root, project);
  ignoreTrackerLink(root);
}

/** What to tell the operator when a step after 2 failed. */
function recovery(step: number, root: string): string[] {
  const back = [
    `cd ${root}`,
    "if [ -L .tracker ]; then rm .tracker; fi",
    "git checkout HEAD -- .tracker .darius.toml",
  ];
  const state = new Map([
    [3, "The tree copy is in the store, and the store may already hold tree lines. The checkout is unchanged."],
    [4, "The store holds the tree and the cutover line. .darius.toml may be unchanged."],
    [5, "The store holds the tree, and .darius.toml lists milestone. .tracker/ may be removed from the git index or from disk, and the link may exist."],
  ]);
  return [
    state.get(step) ?? "",
    "To get back to the old .tracker/ folder (remove the link first, so git does not write into the store):",
    ...back.map((line) => `  ${line}`),
    "The store keeps its tree lines, so a new darius onboard refuses. To finish instead, do the remaining steps by hand: set kinds in .darius.toml, git rm -r --cached .tracker, remove the folder, run any tracker verb (it creates the link), add /.tracker to .gitignore.",
  ].filter((line) => line !== "");
}

// --- the runs ----------------------------------------------------------------

function printSteps(steps: readonly StepReport[]): void {
  for (const step of steps) console.log(`✓ ${String(step.step)} ${step.name}: ${step.summary}`);
}

function nextCommands(scope: Scope): string[] {
  const add = scope === "vigil" ? `git add ${MARKER_FILE}` : `git add ${MARKER_FILE} .gitignore`;
  const message = scope === "vigil" ? "chore(darius): the darius store owns the vigils" : COMMIT_MESSAGE;
  return [add, `git commit -m "${message}"`];
}

async function runScan(marker: Marker, scope: Scope, json: boolean): Promise<number> {
  const result = survey(marker, scope);
  if (json) console.log(JSON.stringify({ mode: "scan", ...surveyJson(result) }));
  else for (const line of surveyLines(result)) console.log(line);
  if (result.nothing) return EXIT_NOTHING;
  return result.blockers.length === 0 ? EXIT_OK : EXIT_REFUSED;
}

async function runDry(marker: Marker, scope: Scope, json: boolean): Promise<number> {
  const result = survey(marker, scope);
  const project = result.store.exists ? openProject(marker.project) : null;
  let vigils: VigilStep | { error: string } = { summary: "not run: no store for the project on this host", result: null, heavy: [] };
  if (project !== null && result.tracker === "folder") {
    try {
      vigils = importVigils(project, marker.dir, marker.kinds, true);
    } catch (cause) {
      vigils = { error: errorMessage(cause) };
      result.blockers.push(`vigils: ${errorMessage(cause)}`);
    }
  }
  const copy = result.tracker === "folder" && scope === "all" ? copyPlan(marker.dir).files : [];
  if (json) {
    console.log(JSON.stringify({ mode: "dry-run", ...surveyJson(result), vigil_import: vigils, copy: copy.map((file) => file.path), target: project === null ? null : treeDir(project) }));
  } else {
    for (const line of surveyLines(result)) console.log(line);
    // A failed import is already a blocker line above.
    if (!("error" in vigils)) console.log(`· vigils: ${vigils.summary}`);
    if (scope === "all") {
      console.log(`· would copy ${String(copy.length)} files${project === null ? "" : ` into ${treeDir(project)}`}:`);
      for (const file of copy) console.log(`  ${file.path}`);
    }
  }
  if (result.nothing) return EXIT_NOTHING;
  return result.blockers.length === 0 ? EXIT_OK : EXIT_REFUSED;
}

function refuse(result: Survey, json: boolean): number {
  const done = result.tracker === "link" && result.kinds.includes("milestone");
  const nothing = done ? "already onboarded: the store owns the tracker here. darius sync brings it up to date." : "nothing to do: there is no .tracker/ folder here";
  const blockers = result.nothing ? [nothing] : result.blockers;
  if (json) console.log(JSON.stringify({ mode: "move", ok: false, ...surveyJson(result), blockers }));
  else for (const blocker of blockers) console.error(`darius onboard: ${blocker}`);
  return EXIT_REFUSED;
}

/** The move itself, `--only vigil` or all of it. Refuses before step 1 when anything blocks. */
async function runMove(marker: Marker, scope: Scope, json: boolean): Promise<number> {
  const result = survey(marker, scope);
  if (result.nothing || result.blockers.length > 0) return refuse(result, json);
  const root = marker.dir;
  const project = openProject(marker.project);
  const steps: StepReport[] = [];
  const warnings: string[] = [];
  let heavy: string[] = [];
  try {
    const vigils = importVigils(project, root, marker.kinds, false);
    heavy = vigils.heavy;
    steps.push({ step: 1, name: "vigils", summary: vigils.summary });
    if (scope === "vigil") {
      writeKinds(marker, VIGIL_KINDS, 2);
      steps.push({ step: 2, name: MARKER_FILE, summary: `kinds = ${kindsText(VIGIL_KINDS)}` });
      const removed = git(root, ["rm", "-r", "-q", "--", `${TRACKER_LINK}/${VIGILS}`]);
      if (!removed.ok) throw new StepFailure(3, `git rm -r .tracker/vigils failed: ${removed.err}`);
      steps.push({ step: 3, name: "git", summary: "git rm -r .tracker/vigils (staged, not committed)" });
    } else {
      const copied = copyTree(project, root);
      steps.push({ step: 2, name: "copy", summary: `${String(copied.files)} files, ${String(copied.bytes)} bytes into ${treeDir(project)}, every sha256 checked` });
      const commit = git(root, ["rev-parse", "HEAD"]);
      if (!commit.ok) throw new StepFailure(3, `git rev-parse HEAD failed: ${commit.err}`);
      let captured: TreeCapture;
      try {
        captured = captureTree(project);
        appendLine(project, { who: defaultWho(), type: CUTOVER_LINE, kinds: ["vigil", "milestone"], source_commit: commit.out.trim(), files: copied.files, bytes: copied.bytes });
      } catch (cause) {
        throw new StepFailure(3, errorMessage(cause));
      }
      steps.push({ step: 3, name: "capture", summary: `${String(captured.put)} files into the store ledger, then the ${CUTOVER_LINE} line` });
      writeKinds(marker, FULL_KINDS, 4);
      steps.push({ step: 4, name: MARKER_FILE, summary: `kinds = ${kindsText(FULL_KINDS)}` });
      try {
        replaceFolder(project, root);
      } catch (cause) {
        throw cause instanceof StepFailure ? cause : new StepFailure(5, errorMessage(cause));
      }
      steps.push({ step: 5, name: "link", summary: `.tracker removed from git (staged) and linked to ${treeDir(project)}, ${TRACKER_IGNORE} in .gitignore` });
      try {
        // .tracker/vigils/ shows the store's vigils at once, not after the next verb.
        projectVigils(project, treeDir(project));
      } catch (cause) {
        warnings.push(`the vigil files under .tracker/vigils/ are not written yet (${errorMessage(cause)}); the next tracker verb writes them`);
      }
    }
  } catch (cause) {
    const step = cause instanceof StepFailure ? cause.step : steps.length + 1;
    const help = step >= 3 && scope === "all" ? recovery(step, root) : [];
    if (json) {
      console.log(JSON.stringify({ mode: "move", ok: false, project: marker.project, steps, failed_step: step, error: errorMessage(cause), recover: help }));
    } else {
      printSteps(steps);
      console.error(`✗ ${String(step)}: ${errorMessage(cause)}`);
      for (const line of help) console.error(line);
    }
    return EXIT_REFUSED;
  }
  const next = nextCommands(scope);
  const after = "Then, on every other host: update darius first, pull, and run darius sync.";
  const heavyText = heavyLine(heavy);
  if (json) {
    console.log(JSON.stringify({ mode: "move", ok: true, project: marker.project, steps, heavy_vigils: heavy, heavy_note: heavyText, warnings, next, after }));
    return EXIT_OK;
  }
  printSteps(steps);
  if (heavyText !== null) console.log(heavyText);
  for (const warning of warnings) console.log(`! ${warning}`);
  console.log("Next, commit the change:");
  for (const command of next) console.log(`  ${command}`);
  console.log(after);
  return EXIT_OK;
}

function scopeOf(args: ParsedArgs): Scope {
  const only = args.flags.only;
  if (only === undefined) return "all";
  if (only === "vigil") return "vigil";
  throw new UsageError(`--only takes vigil. ${USAGE}`);
}

function modeOf(args: ParsedArgs): Mode {
  const [first, ...rest] = args.positional;
  if (rest.length > 0 || (first !== undefined && first !== "scan")) throw new UsageError(USAGE);
  if (first === "scan") return "scan";
  return args.flags["dry-run"] === true ? "dry-run" : "move";
}

async function run(args: ParsedArgs): Promise<number> {
  const mode = modeOf(args);
  const scope = scopeOf(args);
  const marker = surveyMarker(process.cwd());
  if (mode === "scan") return runScan(marker, scope, args.json);
  if (mode === "dry-run") return runDry(marker, scope, args.json);
  return runMove(marker, scope, args.json);
}

export const onboardCommand: Command = {
  name: "onboard",
  summary: "move this repo's .tracker/ into the darius store: scan, --dry-run, --only vigil",
  usage: "onboard [scan] [--dry-run] [--only vigil]",
  run,
};
