/**
 * Where the tracker tree of a checkout is, and the one place that answers it
 * for native code (0.78.0, docs/concept.md, "No .tracker link").
 *
 *   store  the nearest `.darius.toml` lists `milestone` in `kinds`: the tree is
 *          `<state dir>/<project>/tracker` (`treeDir`). The checkout holds no
 *          `.tracker` path at all; darius never creates one and never reads one.
 *   git    a real `.tracker/` folder in the checkout, kept in git (deprecated).
 *   none   neither.
 *
 * The router hands the store tree to the vendored engine in two env vars
 * (`TRACKER_ROOT_ENV`, `CHECKOUT_ROOT_ENV`); src/legacy/lib/tracker-root.ts
 * reads them.
 *
 * Migration: a checkout from before 0.78.0 has a `.tracker` symlink into the
 * store. `removeOwnTreeLink` removes it, and only it: never a real folder,
 * never a link that points anywhere else.
 */

import { lstatSync, readFileSync, readlinkSync, realpathSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { findMarker } from "./marker.ts";
import { findTrackerDir, projectDir } from "./paths.ts";
import { treeDir } from "./tree.ts";

/** The env var that names the store tree for the legacy engine. */
export const TRACKER_ROOT_ENV = "DARIUS_TRACKER_ROOT";
/** The env var that names the checkout for the legacy engine. */
export const CHECKOUT_ROOT_ENV = "DARIUS_CHECKOUT_ROOT";

/** The old name of the tree in a checkout: a git-mode folder, or the pre-0.78.0 link. */
export const TRACKER_FOLDER = ".tracker";

/** The `.gitignore` line that kept the old link out of git. darius no longer writes it. */
export const TRACKER_IGNORE = "/.tracker";

/** Where the tracker tree of a checkout is. */
export type TrackerWhere =
  | { mode: "store"; trackerRoot: string; checkout: string; project: string }
  | { mode: "git"; trackerRoot: string; checkout: string; project: string | null }
  | { mode: "none"; trackerRoot: null; checkout: null; project: string | null };

/** The store tree of `project` on this host: `<state dir>/<project>/tracker`. */
export function storeTreeOf(project: string): string {
  return treeDir({ root: projectDir(project) });
}

/**
 * The tracker tree for `cwd`. The nearest marker decides store mode; else
 * the nearest `.tracker/` folder is git mode. Reads only. A marker that does
 * not parse throws, as `findMarker` does.
 */
export function resolveTrackerRoot(cwd: string): TrackerWhere {
  const marker = findMarker(cwd);
  if (marker !== null && marker.kinds.includes("milestone")) {
    return { mode: "store", trackerRoot: storeTreeOf(marker.project), checkout: marker.dir, project: marker.project };
  }
  const project = marker === null ? null : marker.project;
  const folder = findTrackerDir(cwd);
  if (folder === null) return { mode: "none", trackerRoot: null, checkout: null, project };
  return { mode: "git", trackerRoot: folder, checkout: dirname(folder), project };
}

/**
 * Sets (store mode) or clears (otherwise) the engine env in this process, so
 * a value inherited from a parent darius never points the engine at another
 * project's tree.
 */
export function applyEngineEnv(where: TrackerWhere | null): void {
  delete process.env[TRACKER_ROOT_ENV];
  delete process.env[CHECKOUT_ROOT_ENV];
  if (where === null || where.mode !== "store") return;
  process.env[TRACKER_ROOT_ENV] = where.trackerRoot;
  process.env[CHECKOUT_ROOT_ENV] = where.checkout;
}

function realOrResolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** `path` relative to `root` with `/` separators when it lies inside it (`""` for the root), else null. */
function inside(root: string, path: string): string | null {
  const rel = relative(root, path);
  if (rel === "") return "";
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

/** What `<checkout>/.tracker` is, seen from store mode. */
export type TreeLinkState =
  | { kind: "missing" }
  /** The pre-0.78.0 link into this project's store tree: safe to remove. */
  | { kind: "own-link"; path: string; target: string }
  /** A link to anywhere else: never touched. */
  | { kind: "foreign-link"; path: string; target: string }
  /** A real folder or file: never touched. */
  | { kind: "real"; path: string };

/** Classifies `<checkout>/.tracker` against the store tree `tree`. Reads only. */
export function treeLinkState(checkout: string, tree: string): TreeLinkState {
  const path = join(checkout, TRACKER_FOLDER);
  const stats = lstatSync(path, { throwIfNoEntry: false });
  if (stats === undefined) return { kind: "missing" };
  if (!stats.isSymbolicLink()) return { kind: "real", path };
  const target = resolve(dirname(path), readlinkSync(path));
  const same = target === resolve(tree) || realOrResolved(path) === realOrResolved(tree);
  return same ? { kind: "own-link", path, target } : { kind: "foreign-link", path, target };
}

/**
 * Removes the pre-0.78.0 `.tracker` link of a store-mode checkout when it
 * points into this project's store tree. Returns the one notice line to
 * print on stderr, or null when nothing was removed (no store mode, no link,
 * a real folder, a foreign link, or an error: migration never stops a verb).
 */
export function removeOwnTreeLink(cwd: string): string | null {
  try {
    const where = resolveTrackerRoot(cwd);
    if (where.mode !== "store") return null;
    const state = treeLinkState(where.checkout, where.trackerRoot);
    if (state.kind !== "own-link") return null;
    unlinkSync(state.path);
    return `darius: removed the old .tracker link in ${where.checkout}; the tracker tree is in ${where.trackerRoot} (darius root)`;
  } catch {
    return null;
  }
}

/** True when `<checkout>/.gitignore` still has the `/.tracker` line the old link needed. */
export function hasStaleIgnoreLine(checkout: string): boolean {
  try {
    const text = readFileSync(join(checkout, ".gitignore"), "utf8");
    return text.split(/\r?\n/u).some((line) => line.trim() === TRACKER_IGNORE);
  } catch {
    return false;
  }
}

/** The part after the last `.tracker` segment of a path (`../.tracker/M1/x` gives `M1/x`), or null. */
function afterTrackerSegment(path: string): string | null {
  const parts = path.split(/[\\/]+/u);
  const at = parts.lastIndexOf(TRACKER_FOLDER);
  if (at < 0) return null;
  return parts.slice(at + 1).filter((part) => part !== "").join("/");
}

/**
 * The tracker-relative path (`M1-x/01-y.md`, `""` for the root) a path
 * argument names in store mode, or null when it names nothing in the tree.
 * Accepts the tracker-relative form, the old `.tracker/...` form (also with
 * `./`, `../` or an absolute checkout path before it), and an absolute path
 * into the store tree.
 */
export function treeRelative(input: string, where: { trackerRoot: string; checkout: string }): string | null {
  const trimmed = input.trim();
  if (isAbsolute(trimmed)) {
    const direct = inside(resolve(where.trackerRoot), resolve(trimmed));
    if (direct !== null) return direct;
    const real = inside(realOrResolved(where.trackerRoot), realOrResolved(trimmed));
    if (real !== null) return real;
    const inCheckout = inside(resolve(where.checkout), resolve(trimmed));
    return inCheckout === null ? null : afterTrackerSegment(inCheckout);
  }
  const after = afterTrackerSegment(trimmed);
  if (after !== null) return after;
  const rel = trimmed.replace(/^(?:\.\/)+/u, "");
  return rel === "." ? "" : rel;
}

/**
 * The absolute file a path argument names. Store mode: through
 * `treeRelative`, unless the path exists from `cwd` and has no `.tracker`
 * segment. Git and none mode: relative to `cwd`, as always.
 */
export function resolveTreeArg(input: string, cwd: string, where: TrackerWhere = resolveTrackerRoot(cwd)): string {
  if (where.mode !== "store") return resolve(cwd, input);
  const trimmed = input.trim();
  if (!isAbsolute(trimmed) && afterTrackerSegment(trimmed) === null) {
    const fromCwd = resolve(cwd, trimmed);
    if (lstatSync(fromCwd, { throwIfNoEntry: false }) !== undefined) return fromCwd;
  }
  const rel = treeRelative(trimmed, where);
  if (rel === null) return resolve(cwd, trimmed);
  return rel === "" ? where.trackerRoot : join(where.trackerRoot, rel);
}

/**
 * The notes the full `doctor` adds about where the tree is (0.78.0). They go
 * to stdout after the report, or to stderr with `--json`. A note never
 * changes the exit code.
 *
 *   store mode  a `/.tracker` line left in `.gitignore` (the old link needed
 *               it; darius does not edit `.gitignore`), and a `.tracker` path
 *               left in the checkout (never read, never removed by darius)
 *   git mode    the mode is deprecated: `darius onboard` moves the tree
 */
export function doctorNotes(cwd: string): string[] {
  let where: TrackerWhere;
  try {
    where = resolveTrackerRoot(cwd);
  } catch {
    return [];
  }
  const notes: string[] = [];
  if (where.mode === "store") {
    if (hasStaleIgnoreLine(where.checkout)) {
      notes.push(`NOTE: .gitignore has a ${TRACKER_IGNORE} line. darius no longer makes a .tracker link, so you can remove the line.`);
    }
    const state = treeLinkState(where.checkout, where.trackerRoot);
    if (state.kind === "real") notes.push(`NOTE: ${state.path} is in this checkout. darius does not read it; the tracker tree is in ${where.trackerRoot}.`);
    if (state.kind === "foreign-link") notes.push(`NOTE: ${state.path} links to ${state.target}. darius does not read it; the tracker tree is in ${where.trackerRoot}.`);
  } else if (where.mode === "git") {
    notes.push("NOTE: this tracker is in git (.tracker/). Git mode is deprecated. Run darius onboard scan, then darius onboard, to move it into the darius store.");
  }
  return notes;
}

/**
 * The tracker tree of a checkout dir: the store tree when the checkout's
 * marker lists `milestone`, else `<checkout>/.tracker` (git mode). A marker
 * that does not parse counts as git mode here: the readers that use this only read.
 */
export function trackerDirOfCheckout(checkout: string): string {
  try {
    const where = resolveTrackerRoot(checkout);
    if (where.mode === "store" && resolve(where.checkout) === resolve(checkout)) return where.trackerRoot;
  } catch {
    // Fall through to the folder.
  }
  return join(checkout, TRACKER_FOLDER);
}
