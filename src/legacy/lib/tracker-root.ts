/**
 * Where the tracker tree is, for every verb of the engine (0.78.0).
 *
 * Git mode: a real `.tracker/` folder in the checkout, found by walking up
 * from the cwd. The checkout is its parent.
 *
 * Store mode: the darius router resolves the tree from the `.darius.toml`
 * marker and hands it over in two env vars, because the checkout has no
 * `.tracker` path at all:
 *
 *   DARIUS_TRACKER_ROOT   the tree, `<state dir>/<project>/tracker`
 *   DARIUS_CHECKOUT_ROOT  the checkout (the dir of the marker)
 *
 * The override wins over the walk. Where it is set, "project root = parent
 * of `.tracker`" no longer holds: `projectRootOf` gives the checkout instead,
 * and paths shown to the user are relative to the tree (`M1-x/01-y.md`), not
 * to the checkout (`.tracker/M1-x/01-y.md`).
 */

import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const TRACKER_ROOT_ENV = "DARIUS_TRACKER_ROOT";
export const CHECKOUT_ROOT_ENV = "DARIUS_CHECKOUT_ROOT";

/** The folder name of a git-mode tracker, and the old prefix of a store path. */
const TRACKER_DIR = ".tracker";

function envPath(name: string): string | null {
  const value = process.env[name];
  return value === undefined || value === "" ? null : resolve(value);
}

/** The store tree the router handed over, or null in git mode. */
export function storeTreeOverride(): { trackerRoot: string; checkoutRoot: string | null } | null {
  const trackerRoot = envPath(TRACKER_ROOT_ENV);
  if (trackerRoot === null) return null;
  return { trackerRoot, checkoutRoot: envPath(CHECKOUT_ROOT_ENV) };
}

/**
 * The tracker tree for a verb run in `startDir`: the store tree the router
 * handed over, else the nearest `.tracker/` at or above `startDir`, else null.
 */
export function findTrackerRoot(startDir: string): string | null {
  const override = storeTreeOverride();
  if (override !== null) return override.trackerRoot;
  let dir = resolve(startDir);
  for (let depth = 0; depth < 50; depth++) {
    const candidate = join(dir, TRACKER_DIR);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function realOrResolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** True when `trackerRoot` is the store tree the router handed over. */
export function isStoreTree(trackerRoot: string): boolean {
  const override = storeTreeOverride();
  if (override === null) return false;
  const at = resolve(trackerRoot);
  return at === override.trackerRoot || realOrResolved(at) === realOrResolved(override.trackerRoot);
}

/**
 * The checkout a tracker belongs to: the checkout the router named for the
 * store tree (the cwd when it named none), else the parent of `.tracker/`.
 */
export function projectRootOf(trackerRoot: string): string {
  if (isStoreTree(trackerRoot)) return storeTreeOverride()?.checkoutRoot ?? process.cwd();
  return dirname(resolve(trackerRoot));
}

/** `path` relative to `root` with `/` separators when it lies inside it, else null. */
function inside(root: string, path: string): string | null {
  const rel = relative(root, path);
  if (rel === "") return "";
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

/**
 * How a file of the tree is shown: tracker-relative in store mode
 * (`M1-x/01-y.md`), relative to the checkout in git mode
 * (`.tracker/M1-x/01-y.md`), as before.
 */
export function displayPath(trackerRoot: string, absolutePath: string): string {
  if (isStoreTree(trackerRoot)) return inside(resolve(trackerRoot), resolve(absolutePath)) ?? absolutePath;
  return relative(dirname(resolve(trackerRoot)), absolutePath);
}

/**
 * The stable repo-style key of a tree file: `.tracker/M1-x/01-y.md` in both
 * modes. The verification ledger and other stored keys keep this form, so a
 * project that moved to the store still finds its old lines.
 */
export function repoStylePath(trackerRoot: string, absolutePath: string): string {
  if (isStoreTree(trackerRoot)) {
    const rel = inside(resolve(trackerRoot), resolve(absolutePath));
    if (rel !== null) return rel === "" ? TRACKER_DIR : `${TRACKER_DIR}/${rel}`;
  }
  return relative(dirname(resolve(trackerRoot)), resolve(absolutePath));
}

/** The part after a `.tracker` segment of a relative path (`../.tracker/M1/x` gives `M1/x`), or null. */
function afterTrackerSegment(path: string): string | null {
  const parts = path.split(/[\\/]+/u);
  const at = parts.lastIndexOf(TRACKER_DIR);
  if (at < 0) return null;
  return parts.slice(at + 1).filter((part) => part !== "").join("/");
}

/**
 * The absolute file a path argument names. Git mode: relative to `cwd`, as
 * always. Store mode accepts three forms:
 *
 *   M1-x/01-y.md               tracker-relative
 *   .tracker/M1-x/01-y.md      the old link form (also `./`, `../.tracker/`,
 *                              or absolute through the checkout): the prefix is stripped
 *   /abs/store/tracker/M1-x/…  an absolute store path, as is
 *
 * A relative path with no `.tracker` segment that exists from `cwd` keeps
 * that meaning; else it is read from the tree.
 */
export function resolvePathArg(arg: string, cwd: string = process.cwd()): string {
  const override = storeTreeOverride();
  if (override === null) return resolve(cwd, arg);
  const tree = override.trackerRoot;
  const trimmed = arg.trim();
  if (isAbsolute(trimmed)) {
    if (inside(tree, resolve(trimmed)) !== null) return resolve(trimmed);
    const checkout = override.checkoutRoot;
    const rel = checkout === null ? null : inside(checkout, resolve(trimmed));
    const after = rel === null ? null : afterTrackerSegment(rel);
    return after === null ? resolve(trimmed) : join(tree, after);
  }
  const after = afterTrackerSegment(trimmed);
  if (after !== null) return join(tree, after);
  const fromCwd = resolve(cwd, trimmed);
  if (existsSync(fromCwd)) return fromCwd;
  return join(tree, trimmed.replace(/^(?:\.\/)+/u, ""));
}

/**
 * The absolute file a stored reference names (a thread's `spec:`, a
 * `depends_on` entry): relative to the checkout in git mode, as before; in
 * store mode any of the forms `resolvePathArg` takes, read from the checkout.
 */
export function resolveTreeRef(trackerRoot: string, ref: string): string {
  if (isStoreTree(trackerRoot)) return resolvePathArg(ref, projectRootOf(trackerRoot));
  return isAbsolute(ref) ? ref : resolve(dirname(resolve(trackerRoot)), ref);
}
