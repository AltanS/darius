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

import { existsSync, readdirSync, realpathSync } from "node:fs";
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
 * The tracker-relative path (`M1-x/01-y.md`, `""` for the root) a path
 * argument names, or null when it is an absolute path outside the tree.
 * Takes the tracker-relative form, the `.tracker/` form (also with `./`,
 * `../` or an absolute checkout path before it) and an absolute tree path.
 */
export function trackerRelative(arg: string, trackerRoot: string, checkoutRoot: string | null): string | null {
  const trimmed = arg.trim();
  if (isAbsolute(trimmed)) {
    const direct = inside(resolve(trackerRoot), resolve(trimmed));
    if (direct !== null) return direct;
    const real = inside(realOrResolved(trackerRoot), realOrResolved(trimmed));
    if (real !== null) return real;
    const rel = checkoutRoot === null ? null : inside(checkoutRoot, resolve(trimmed));
    return rel === null ? null : afterTrackerSegment(rel);
  }
  const after = afterTrackerSegment(trimmed);
  if (after !== null) return after;
  const rel = trimmed.replace(/^(?:\.\/)+/u, "").replace(/\/+$/u, "");
  return rel === "." ? "" : rel;
}

/** Folders of the tree that hold no specs. */
const NON_SPEC_DIRS: ReadonlySet<string> = new Set(["archive", "worklog"]);

/**
 * The specs a bare file name (`01-y.md`) names: one tracker-relative path
 * per milestone folder that holds it, sorted. Empty for a name with a `/`
 * or without `.md`.
 */
export function bareSpecMatches(trackerRoot: string, name: string): string[] {
  if (name === "" || name.includes("/") || !name.endsWith(".md")) return [];
  const found: string[] = [];
  try {
    for (const entry of readdirSync(trackerRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.startsWith("_") || NON_SPEC_DIRS.has(entry.name)) continue;
      if (existsSync(join(trackerRoot, entry.name, name))) found.push(`${entry.name}/${name}`);
    }
  } catch {
    return [];
  }
  return found.sort();
}

/** The file of tracker-relative `rel` when it exists, or the one spec a bare name names; else null. */
function findInTree(trackerRoot: string, rel: string): string | null {
  if (rel === "") return trackerRoot;
  const joined = join(trackerRoot, rel);
  if (existsSync(joined)) return joined;
  const bare = bareSpecMatches(trackerRoot, rel);
  return bare.length === 1 ? join(trackerRoot, bare[0] ?? rel) : null;
}

/**
 * The absolute file a path argument names. Every verb that takes a spec,
 * milestone or tree path comes here (0.101.0). The forms:
 *
 *   M1-x/01-y.md               tracker-relative
 *   01-y.md                    a bare name, when exactly one milestone holds it
 *   .tracker/M1-x/01-y.md      the old form (also `./`, `../.tracker/`,
 *                              or absolute through the checkout): the prefix is stripped
 *   /abs/…/M1-x/01-y.md        an absolute path inside the tree
 *
 * A relative path with no `.tracker` segment that exists from `cwd` keeps
 * that meaning (a repo file, for `scan`). Else it is read from the tree: the
 * store tree in store mode, the nearest `.tracker/` in git mode. A path that
 * names nothing comes back as a path that does not exist; the verb then
 * says so with {@link missingPathMessage}.
 */
export function resolvePathArg(arg: string, cwd: string = process.cwd()): string {
  const override = storeTreeOverride();
  const trimmed = arg.trim();
  if (override === null) {
    const direct = resolve(cwd, trimmed);
    if (existsSync(direct)) return direct;
    const folder = findTrackerRoot(cwd);
    if (folder === null) return direct;
    const rel = trackerRelative(trimmed, folder, dirname(folder));
    return (rel === null ? null : findInTree(folder, rel)) ?? direct;
  }
  const tree = override.trackerRoot;
  if (isAbsolute(trimmed)) {
    if (inside(tree, resolve(trimmed)) !== null) return resolve(trimmed);
    const checkout = override.checkoutRoot;
    const rel = checkout === null ? null : inside(checkout, resolve(trimmed));
    const after = rel === null ? null : afterTrackerSegment(rel);
    return after === null ? resolve(trimmed) : join(tree, after);
  }
  const after = afterTrackerSegment(trimmed);
  if (after !== null) return findInTree(tree, after) ?? join(tree, after);
  const fromCwd = resolve(cwd, trimmed);
  if (existsSync(fromCwd)) return fromCwd;
  const rel = trimmed.replace(/^(?:\.\/)+/u, "");
  return findInTree(tree, rel) ?? join(tree, rel);
}

/**
 * The text after `<verb>: ` when a path argument names nothing. `kind` is
 * the noun (`file`, `spec`). The text names the tracker-relative form it
 * looked for, the tracker root, and the next command. A bare name that
 * several milestones hold lists them all.
 */
export function missingPathMessage(arg: string, kind: string, cwd: string = process.cwd()): string {
  const tree = findTrackerRoot(cwd);
  if (tree === null) return `${kind} not found: ${arg.trim()} (no .tracker/ here or above)`;
  const rel = trackerRelative(arg, tree, isStoreTree(tree) ? projectRootOf(tree) : dirname(tree)) ?? arg.trim();
  const same = bareSpecMatches(tree, rel);
  if (same.length > 1) {
    return `${kind} name is ambiguous: ${rel} matches ${same.join(", ")} (tracker root ${tree})\n  next: run the same command with one of those paths`;
  }
  return `${kind} not found: ${rel} (tracker root ${tree}; paths are tracker-relative, e.g. M1-x/01-y.md)\n  next: darius list specs`;
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
