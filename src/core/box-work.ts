/**
 * The work dir walks of the box (docs/concept.md, "The work dir's guarded
 * files"). Two walks share one set of rules:
 *
 *   - `scanWork`, before the launch, finds the sockets to mask and the guards
 *     to bind read-only: every `.git`, `.claude` folder, `.darius.toml` and
 *     bare repo below the top. It records each guard's (dev, ino), and the top
 *     `.darius.toml`'s. It looks for no guard inside one it found.
 *   - `checkPlants`, after the launch, with the box reaped, walks again and
 *     renames each guard whose (dev, ino) the launch did not record: the run
 *     made it. It keeps looking inside a new guard, and renames the deepest
 *     first, so every path stays valid.
 *
 * Both use `readdirSync` and `lstat` only: no shell, no link followed. They
 * never enter `node_modules`, nor a mount point (from /proc/self/mountinfo,
 * read at walk time). A btrfs subvolume is not a mount point, so it is walked.
 * A folder that cannot be listed, or a name that is not UTF-8, is a problem:
 * the scan refuses the launch, the check taints the work dir.
 */

import { randomBytes } from "node:crypto";
import { accessSync, chmodSync, constants, lstatSync, readdirSync, readFileSync, realpathSync, renameSync, type Dirent, type Stats } from "node:fs";
import { userInfo } from "node:os";
import { basename, dirname, join, normalize } from "node:path";

import type { WorkScan } from "./box.ts";
import { errorMessage } from "../runtime.ts";

/** Folders neither walk enters, for speed: a package tree holds no live socket. Its guards are not guarded (docs/concept.md, "What the box does not stop"). */
const WORK_PRUNED_NAMES: ReadonlySet<string> = new Set(["node_modules"]);
/** The top entries the box guards itself, one mount each: neither walk looks for a guard inside. */
const TOP_GUARDS: ReadonlySet<string> = new Set([".git", ".claude"]);
/** The darius marker. At the top it is a mount; below the top a guard. */
const MARKER = ".darius.toml";
/** The mount table of this process's mount namespace. */
const MOUNTINFO = "/proc/self/mountinfo";

/** What a guard is. */
export type GuardKind = "git" | "claude" | "marker" | "bare";

/** One guard a walk found: its path, kind, `dev:ino` and whether it is a link. */
interface Found {
  path: string;
  kind: GuardKind;
  id: string;
  isLink: boolean;
}

interface WalkInput {
  root: string;
  deadline: number;
  now: () => number;
  /** Lists sockets too: the launch scan does, the post-run check does not. */
  hasSockets: boolean;
  /** Mount points: never entered. */
  mounts: ReadonlySet<string>;
  /**
   * The post-run check: the `dev:ino` of each guard the launch found. A known
   * guard is not entered for guards; a new one is. Undefined at launch: no
   * guard is entered for guards.
   */
  known?: ReadonlySet<string>;
}

/** What one walk found, and whether it ran out of time first. */
interface Walked {
  sockets: string[];
  found: Found[];
  isBareTop: boolean;
  /** The `dev:ino` of the top `.darius.toml`, when there is one. */
  topMarker?: Found;
  problems: string[];
  /** Folders the post-run check made readable to list them. */
  repaired: string[];
  timedOut: boolean;
}

function lstatOf(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

function idOf(stat: Stats): string {
  return `${String(stat.dev)}:${String(stat.ino)}`;
}

/** The error codes a walk or a rename can meet, by name. */
const ERRNOS = ["EACCES", "EPERM", "ENOENT", "ENOTDIR", "EBUSY", "EROFS", "EEXIST", "ENOTEMPTY", "EXDEV", "EINVAL", "ELOOP", "EIO"] as const;

function errnoOf(cause: unknown): string | undefined {
  if (!(cause instanceof Error) || !("code" in cause)) return undefined;
  return ERRNOS.find((code) => cause.code === code);
}

/** A mount point field of /proc/self/mountinfo: `\040` and the other octal escapes undone. */
function unescapeMount(text: string): string {
  return text.replaceAll(/\\([0-7]{3})/gu, (_match, octal: string) => String.fromCodePoint(Number.parseInt(octal, 8)));
}

/** The mount points in a /proc/self/mountinfo text: the fifth field of each line. */
export function mountPoints(text: string): Set<string> {
  const points = new Set<string>();
  for (const line of text.split("\n")) {
    const field = line.split(" ")[4];
    if (field !== undefined && field.startsWith("/")) points.add(normalize(unescapeMount(field)));
  }
  return points;
}

/** This mount namespace's mount points now; none when the table cannot be read, so the walk enters more, not less. */
function readMounts(): Set<string> {
  try {
    return mountPoints(readFileSync(MOUNTINFO, "utf8"));
  } catch {
    return new Set();
  }
}

/**
 * True when git takes a folder with these names for a bare repo: a `HEAD`
 * entry, and `objects` and `refs`, or a `commondir` that points at them
 * elsewhere. Each of any type: git asks `access`, which follows links.
 */
function looksBare(names: ReadonlySet<string>): boolean {
  return names.has("HEAD") && (names.has("commondir") || (names.has("objects") && names.has("refs")));
}

/** The guard kind of an entry below the top, or undefined. A `.claude` file holds no settings; a `.darius.toml` folder is no marker. */
function guardKind(name: string, entry: { isLink: boolean; isDir: boolean }): GuardKind | undefined {
  if (name === ".git") return "git";
  if (name === ".claude") return entry.isLink || entry.isDir ? "claude" : undefined;
  if (name === MARKER) return entry.isLink || !entry.isDir ? "marker" : undefined;
  return undefined;
}

/** One listed entry, its name checked as UTF-8. */
interface Entry {
  name: string;
  dirent: Dirent;
}

/** The listing of one folder, or the problem that stopped it. */
type Listing = { entries: Entry[]; problems: string[]; repaired?: true } | { skip: true } | { problem: string };

function readNames(dir: string): Dirent[] {
  return readdirSync(dir, { withFileTypes: true });
}

/**
 * The names in `dir` that are valid UTF-8, as text. A name that is not shows
 * up with U+FFFD in a text listing, so only then is the folder listed again
 * as bytes (Bun gives no Dirent for a byte listing).
 */
function validNames(dir: string): Set<string> {
  const names = new Set<string>();
  for (const raw of readdirSync(dir, { encoding: "buffer" })) {
    const text = raw.toString("utf8");
    if (Buffer.from(text, "utf8").equals(raw)) names.add(text);
  }
  return names;
}

/** True when this user owns `stat`. */
function isOwn(stat: Stats | undefined): boolean {
  return stat !== undefined && stat.uid === userInfo().uid;
}

function canEnter(dir: string): boolean {
  try {
    accessSync(dir, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lists `dir`. A folder that is gone is empty. One this user cannot list is
 * skipped when this user neither owns it nor can enter it: a run, the same
 * user, cannot reach into it either. Otherwise it is a problem, but in the
 * post-run check (`isRepairing`) a folder of this user's first gets
 * `chmod u+rwx` and one more try.
 */
function listDir(dir: string, isRepairing: boolean): Listing {
  let dirents: Dirent[];
  let repaired = false;
  try {
    dirents = readNames(dir);
  } catch (cause) {
    const code = errnoOf(cause);
    if (code !== "EACCES" && code !== "EPERM") return { entries: [], problems: [] };
    const stat = lstatOf(dir);
    if (!isOwn(stat) && !canEnter(dir)) return { skip: true };
    if (!isRepairing || !isOwn(stat) || stat === undefined) return { problem: `${dir} cannot be read (${code})` };
    try {
      chmodSync(dir, (stat.mode & 0o7777) | 0o700);
      dirents = readNames(dir);
      repaired = true;
    } catch (again) {
      return { problem: `${dir} cannot be read, also after chmod u+rwx (${errnoOf(again) ?? errorMessage(again)})` };
    }
  }
  const entries: Entry[] = [];
  const problems: string[] = [];
  const valid = dirents.some((dirent) => dirent.name.includes("\uFFFD")) ? validNames(dir) : undefined;
  for (const dirent of dirents) {
    if (valid !== undefined && dirent.name.includes("\uFFFD") && !valid.has(dirent.name)) {
      if (problems.length === 0) problems.push(`${dir} holds a name that is not valid UTF-8`);
      continue;
    }
    entries.push({ name: dirent.name, dirent });
  }
  return repaired ? { entries, problems, repaired: true } : { entries, problems };
}

/** A pending folder: whether the walk looks for guards in it. */
interface Pending {
  dir: string;
  isGuarded: boolean;
}

/** One walk of the work dir (see the file comment). `timedOut` when it did not finish before the deadline. */
function walkWork(input: WalkInput): Walked {
  const root = normalize(input.root);
  const walked: Walked = { sockets: [], found: [], isBareTop: false, problems: [], repaired: [], timedOut: false };
  const isKnown = (id: string): boolean => input.known === undefined || input.known.has(id);
  const pending: Pending[] = [{ dir: root, isGuarded: false }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (input.now() > input.deadline) return { ...walked, timedOut: true };
    const { dir } = next;
    const isTop = dir === root;
    const listing = listDir(dir, input.known !== undefined);
    if ("skip" in listing) continue;
    if ("problem" in listing) {
      if (!next.isGuarded) walked.problems.push(listing.problem);
      continue;
    }
    // Inside a guard only sockets count, and a read-only mount cannot be made readable by the run.
    if (!next.isGuarded) walked.problems.push(...listing.problems);
    if (listing.repaired === true) walked.repaired.push(dir);
    let isGuarded = next.isGuarded;
    // A .git folder is a guard by its name already; its HEAD, objects and refs make no second one.
    if (!isGuarded && basename(dir) !== ".git" && looksBare(new Set(listing.entries.map((entry) => entry.name)))) {
      const stat = lstatOf(dir);
      if (isTop) walked.isBareTop = true;
      if (!isTop && stat !== undefined) {
        walked.found.push({ path: dir, kind: "bare", id: idOf(stat), isLink: false });
        isGuarded = isKnown(idOf(stat));
      }
    }
    for (const { name, dirent } of listing.entries) {
      const path = join(dir, name);
      const isLink = dirent.isSymbolicLink();
      // Some filesystems give no type in the listing; lstat says what it is.
      const typed = isLink || dirent.isDirectory() || dirent.isFile() || dirent.isSocket();
      const stat = typed ? undefined : lstatOf(path);
      const isDir = dirent.isDirectory() || stat?.isDirectory() === true;
      const kind = isGuarded ? undefined : guardKind(name, { isLink, isDir });
      let isChildGuarded = isGuarded || (isTop && TOP_GUARDS.has(name));
      if (kind !== undefined && isTop && name === MARKER) {
        const own = lstatOf(path);
        if (own !== undefined) walked.topMarker = { path, kind, id: idOf(own), isLink };
      } else if (kind !== undefined && !(isTop && TOP_GUARDS.has(name))) {
        const own = lstatOf(path);
        if (own !== undefined) {
          walked.found.push({ path, kind, id: idOf(own), isLink });
          isChildGuarded = isKnown(idOf(own));
        }
      }
      if (isLink) continue;
      if (dirent.isSocket() || stat?.isSocket() === true) {
        if (input.hasSockets) walked.sockets.push(path);
        continue;
      }
      if (!isDir || WORK_PRUNED_NAMES.has(name) || input.mounts.has(path)) continue;
      // The post-run check needs no sockets: a known guard was read-only, so it is not walked at all.
      if (isChildGuarded && !input.hasSockets) continue;
      pending.push({ dir: path, isGuarded: isChildGuarded });
    }
  }
  return walked;
}

/** What the work dir scan walks. */
export interface WorkScanInput {
  /** The work dir's real path. */
  workDir: string;
  capMs: number;
  now?: () => number;
  /** The mount table text, for a test. */
  mountinfo?: string;
}

function pathsOf(found: readonly Found[], kind: GuardKind, isLink: boolean): string[] {
  return found.filter((entry) => entry.kind === kind && entry.isLink === isLink).map((entry) => entry.path);
}

/**
 * The work dir's sockets (a devenv postgres socket, a `tmux -S` socket) and
 * its guards, in one walk before the launch. It enters a guard for sockets,
 * but looks for no guard inside it.
 */
export function scanWork(input: WorkScanInput): WorkScan {
  const now = input.now ?? Date.now;
  const mounts = input.mountinfo === undefined ? readMounts() : mountPoints(input.mountinfo);
  const walked = walkWork({ root: input.workDir, deadline: now() + input.capMs, now, hasSockets: true, mounts });
  const { found } = walked;
  return {
    sockets: walked.sockets,
    gits: pathsOf(found, "git", false),
    gitLinks: pathsOf(found, "git", true),
    claudes: pathsOf(found, "claude", false),
    claudeLinks: pathsOf(found, "claude", true),
    markers: pathsOf(found, "marker", false),
    markerLinks: pathsOf(found, "marker", true),
    bares: pathsOf(found, "bare", false),
    isBareTop: walked.isBareTop,
    ids: [...found.map((entry) => entry.id), ...(walked.topMarker === undefined ? [] : [walked.topMarker.id])],
    problems: walked.problems,
    timedOut: walked.timedOut,
    capMs: input.capMs,
  };
}

/** The ledger type of the post-run check's record on a run: what it blocked, what it could not settle, whether it finished. */
export const RUN_BOX_BLOCKED = "run.box-blocked";

/** How long the post-run walk of the work dir may take. */
export const PLANT_CHECK_CAP_MS = 30_000;
/** What a neutralized plant's name gets, then `-<8 hex>`. */
export const BLOCKED_SUFFIX = ".darius-blocked";
/** How many fresh names a rename tries. */
const NAME_TRIES = 3;

/** What the post-run check walks, and what the launch scan found there. */
export interface PlantCheckInput {
  /** The work dir as the run was given it. */
  workDir: string;
  /** The launch's scan: a guard whose `dev:ino` it holds was there before the run. */
  launch: Pick<WorkScan, "ids" | "isBareTop">;
  capMs: number;
  now?: () => number;
  /** The mount table text, for a test. */
  mountinfo?: string;
}

/** What the post-run check did. */
export interface PlantCheck {
  /** One line per plant it renamed: its path, what it is, and the new name. */
  blocked: string[];
  /** What it could not settle: a rename that failed, a folder it could not read, a name that is not UTF-8, the cap. Each one taints the work dir. */
  unresolved: string[];
  /** The walk hit its cap. */
  isUnfinished: boolean;
}

const PLANT_WHAT = {
  git: "a .git made in the run",
  claude: "a .claude made in the run",
  marker: "a .darius.toml made in the run",
  bare: "a bare repo made in the run",
} as const satisfies Record<GuardKind, string>;

/** A fresh name next to `target`: `<name>.darius-blocked-<8 hex>`, one nothing holds now. */
function freshName(target: string): string | undefined {
  for (let tries = 0; tries < NAME_TRIES; tries += 1) {
    const candidate = `${target}${BLOCKED_SUFFIX}-${randomBytes(4).toString("hex")}`;
    if (lstatOf(candidate) === undefined) return candidate;
  }
  return undefined;
}

/** `rename`, and when the folder refuses it, `chmod u+rwx` on the folder and one more try. Returns the chmod note, or throws. */
function renameWithRepair(target: string, to: string): string {
  try {
    renameSync(target, to);
    return "";
  } catch (cause) {
    const code = errnoOf(cause);
    const parent = dirname(target);
    const stat = lstatOf(parent);
    if ((code !== "EACCES" && code !== "EPERM") || !isOwn(stat) || stat?.isDirectory() !== true) throw cause;
    chmodSync(parent, (stat.mode & 0o7777) | 0o700);
    renameSync(target, to);
    return `, after chmod u+rwx on ${parent}`;
  }
}

/**
 * Neutralizes one plant, reversibly: a `.git`, `.claude` or `.darius.toml` is
 * renamed, a bare repo's `HEAD` is renamed, so git no longer sees a repo
 * there. `renameSync` moves the entry itself, a link too, and never follows
 * it. Gives the line for run.log, or the reason it failed.
 */
function blockPlant(plant: Found): { line: string } | { unresolved: string } {
  const target = plant.kind === "bare" ? join(plant.path, "HEAD") : plant.path;
  const head = `${plant.path}, ${PLANT_WHAT[plant.kind]}`;
  // The walk saw plain folders on the way; one that is a link now would send the rename elsewhere.
  if (realOr(dirname(target)) !== dirname(target)) return { unresolved: `${head}, not renamed: a folder on its path is a link now` };
  const to = freshName(target);
  if (to === undefined) return { unresolved: `${head}, not renamed: no free ${basename(target)}${BLOCKED_SUFFIX}-<random> name` };
  try {
    const note = renameWithRepair(target, to);
    return { line: `${head}, ${basename(target)} renamed to ${basename(to)}${note}` };
  } catch (cause) {
    return { unresolved: `${head}, not renamed: ${errnoOf(cause) ?? errorMessage(cause)}` };
  }
}

/** Path depth: the deepest plant is renamed first, so the paths of the others stay valid. */
function depth(path: string): number {
  return path.split("/").length;
}

/**
 * The post-run check. Run it only when no process of the run is left (the
 * runner reaps the box first), so nothing races the walk or the renames.
 * Never throws for one plant: a rename that fails is an unresolved reason.
 */
export function checkPlants(input: PlantCheckInput): PlantCheck {
  const now = input.now ?? Date.now;
  const root = normalize(realOr(input.workDir));
  const known = new Set(input.launch.ids);
  const mounts = input.mountinfo === undefined ? readMounts() : mountPoints(input.mountinfo);
  const walked = walkWork({ root, deadline: now() + input.capMs, now, hasSockets: false, mounts, known });
  const plants = walked.found.filter((entry) => !known.has(entry.id));
  if (walked.topMarker !== undefined && !known.has(walked.topMarker.id)) plants.push(walked.topMarker);
  // With an empty .git at the top, git takes the work dir itself for a bare repo when it looks like one.
  if (walked.isBareTop && !input.launch.isBareTop) plants.push({ path: root, kind: "bare", id: "", isLink: false });
  const blocked: string[] = [];
  const unresolved = [...walked.problems];
  for (const plant of plants.toSorted((a, b) => depth(b.path) - depth(a.path))) {
    const done = blockPlant(plant);
    if ("line" in done) blocked.push(done.line);
    else unresolved.push(done.unresolved);
  }
  if (walked.timedOut) unresolved.push(`the check did not finish within ${String(Math.round(input.capMs / 1000))} s`);
  return { blocked, unresolved, isUnfinished: walked.timedOut };
}

/** The real path of `path`, or `path` when it is not there. */
export function realOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
