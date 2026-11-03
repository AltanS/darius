/**
 * The work dir walks of the box (docs/concept.md, "The work dir's guarded
 * files"). Two walks share one set of rules:
 *
 *   - `scanWork`, before the launch, finds the sockets to mask and the guards
 *     to bind read-only: every `.git`, `.claude` folder, `.darius.toml`,
 *     `.mcp.json` and bare repo below the top. It records each guard's
 *     (dev, ino), and those of the top `.darius.toml` and `.mcp.json`. It
 *     looks for no guard inside one it found.
 *   - `checkPlants`, after the launch, with the box reaped, walks again and
 *     renames each guard whose (dev, ino) the launch did not record: the run
 *     made it. It keeps looking inside a new guard, and renames the deepest
 *     first, so every path stays valid.
 *
 * `scanExtra` walks a writable extra with the same rules, its top included:
 * a guard there would be writable in the box, so the plan refuses it.
 *
 * Every walk uses `readdirSync` and `lstat` only: no shell, no link followed.
 * They never enter `node_modules`, nor a mount point (from
 * /proc/self/mountinfo, read at walk time). A btrfs subvolume is not a mount
 * point, so it is walked. A name that is not valid UTF-8 is walked by its
 * bytes (a Buffer path; Bun and Node take one for lstat, readdir, open and
 * rename). Only the launch cannot hand such a path to bwrap: a guard or a
 * socket under one refuses the launch. A folder that cannot be listed is a
 * problem: the scan refuses the launch, the check makes a folder of this user
 * readable (`chmod u+rwx` through a handle that does not follow a link) and
 * tries once more, and taints the work dir when that fails.
 */

import { randomBytes } from "node:crypto";
import { accessSync, chmodSync, closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, type Dirent, type Stats } from "node:fs";
import { userInfo } from "node:os";
import { normalize } from "node:path";

import type { WorkScan } from "./box.ts";
import { errorMessage } from "../runtime.ts";

/** Folders no walk enters, for speed: a package tree holds no live socket. Its guards are not guarded (docs/concept.md, "What the box does not stop"). */
const WORK_PRUNED_NAMES: ReadonlySet<string> = new Set(["node_modules"]);
/** The top entries the box guards itself, one mount each: no walk of the work dir looks for a guard inside. */
const TOP_GUARDS: ReadonlySet<string> = new Set([".git", ".claude"]);
/** Files a later unboxed tool runs from: the darius marker and Claude Code's project MCP servers. A mount at the top when they are there; below the top, guards. */
const TOP_FILES: ReadonlySet<string> = new Set([".darius.toml", ".mcp.json"]);
/** The mount table of this process's mount namespace. */
const MOUNTINFO = "/proc/self/mountinfo";
/** Linux `O_PATH`: Node and Bun take it but do not name it. A handle for chmod through /proc/self/fd, no read right needed. */
const O_PATH = 0o10_000_000;

/** What a guard is. */
export type GuardKind = "git" | "claude" | "marker" | "mcp" | "bare";

/** A path as text, or as bytes when a name in it is not valid UTF-8. */
type FsPath = string | Buffer;

const SLASH = Buffer.from("/");
/** What a text listing shows for bytes that are not UTF-8. */
const REPLACEMENT = "\uFFFD";

function asBytes(path: FsPath): Buffer {
  return Buffer.isBuffer(path) ? path : Buffer.from(path, "utf8");
}

function childOf(dir: FsPath, name: FsPath): FsPath {
  if (!Buffer.isBuffer(dir) && !Buffer.isBuffer(name)) return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
  return Buffer.concat([asBytes(dir), SLASH, asBytes(name)]);
}

/** A path for a line: bytes that are not UTF-8 show as U+FFFD. */
function shown(path: FsPath): string {
  return Buffer.isBuffer(path) ? path.toString("utf8") : path;
}

function parentOf(path: FsPath): FsPath {
  if (!Buffer.isBuffer(path)) return path.slice(0, Math.max(1, path.lastIndexOf("/")));
  return path.subarray(0, Math.max(1, path.lastIndexOf(0x2f)));
}

function baseOf(path: FsPath): string {
  const text = shown(path);
  return text.slice(text.lastIndexOf("/") + 1);
}

/** One guard a walk found: its path, kind, `dev:ino`, whether it is a link, and the `dev:ino` of its folder. */
interface Found {
  path: FsPath;
  kind: GuardKind;
  id: string;
  isLink: boolean;
  parentId: string;
}

interface WalkInput {
  root: string;
  deadline: number;
  now: () => number;
  /** Lists sockets too: the launch scan does, the post-run check does not. */
  hasSockets: boolean;
  /** Mount points: never entered. */
  mounts: ReadonlySet<string>;
  /** A walk of the work dir: its top `.git`, `.claude`, `.darius.toml` and `.mcp.json` are the plan's own mounts. A writable extra has no such top. */
  isWorkDir: boolean;
  /** Folders not entered at all, by real path: a writable extra's walk leaves the work dir to the work dir's walk. */
  pruned?: ReadonlySet<string>;
  /**
   * The post-run check: the `dev:ino` of each guard the launch found. A known
   * guard is not entered; a new one is, and it repairs what it cannot list.
   * Undefined at launch: no guard is entered for guards.
   */
  known?: ReadonlySet<string>;
}

/** What one walk found, and whether it ran out of time first. */
interface Walked {
  sockets: FsPath[];
  found: Found[];
  isBareTop: boolean;
  /** The top `.darius.toml` and `.mcp.json` of the work dir, when there. */
  topFiles: Found[];
  problems: string[];
  /** Folders the post-run check made readable to list them, as lines. */
  repaired: string[];
  timedOut: boolean;
}

function lstatOf(path: FsPath): Stats | undefined {
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
const ERRNOS = ["EACCES", "EPERM", "ENOENT", "ENOTDIR", "EBUSY", "EROFS", "EEXIST", "ENOTEMPTY", "EXDEV", "EINVAL", "ELOOP", "EIO", "ENAMETOOLONG", "EMFILE", "ENFILE", "ENOMEM"] as const;

function errnoOf(cause: unknown): string | undefined {
  if (!(cause instanceof Error) || !("code" in cause)) return undefined;
  return ERRNOS.find((code) => cause.code === code);
}

/** Only these mean "nothing is there": every other listing error is a problem (L2). */
function isGone(cause: unknown): boolean {
  const code = errnoOf(cause);
  return code === "ENOENT" || code === "ENOTDIR";
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

/** The guard kind of an entry by its name, or undefined. A `.claude` file holds no settings; a `.darius.toml` or `.mcp.json` folder is no file a tool reads. */
function guardKind(name: string, entry: { isLink: boolean; isDir: boolean }): GuardKind | undefined {
  if (name === ".git") return "git";
  if (name === ".claude") return entry.isLink || entry.isDir ? "claude" : undefined;
  if (name === ".darius.toml") return entry.isLink || !entry.isDir ? "marker" : undefined;
  if (name === ".mcp.json") return entry.isLink || !entry.isDir ? "mcp" : undefined;
  return undefined;
}

/** One listed entry: its name as text (U+FFFD for bytes that are not UTF-8), its path, and its type. */
interface Entry {
  name: string;
  path: FsPath;
  isLink: boolean;
  isDir: boolean;
  isSocket: boolean;
}

/** The listing of one folder, or why it has none. */
type Listing = { entries: Entry[]; id: string; repaired?: string } | { skip: true } | { problem: string };

function access(path: FsPath, mode: number): boolean {
  try {
    accessSync(path, mode);
    return true;
  } catch {
    return false;
  }
}

/**
 * `chmod u+rwx` on the folder `path` through an `O_PATH | O_NOFOLLOW |
 * O_DIRECTORY` handle: a link is refused, and the handle's (dev, ino) must
 * be the one the walk saw, so the mode goes to that folder and no other.
 */
function repairDir(path: FsPath, seen: Stats): void {
  const fd = openSync(path, O_PATH | constants.O_NOFOLLOW | constants.O_DIRECTORY);
  try {
    const now = fstatSync(fd);
    if (idOf(now) !== idOf(seen)) throw new Error(`${shown(path)} changed while the check looked at it`);
    chmodSync(`/proc/self/fd/${String(fd)}`, (now.mode & 0o7777) | 0o700);
  } finally {
    closeSync(fd);
  }
}

/** An entry of a text listing. Some filesystems give no type in the listing; lstat says what it is. */
function textEntry(dir: string, dirent: Dirent): Entry {
  const path = childOf(dir, dirent.name);
  const isLink = dirent.isSymbolicLink();
  const known = isLink || dirent.isDirectory() || dirent.isFile() || dirent.isSocket();
  const stat = known ? undefined : lstatOf(path);
  return { name: dirent.name, path, isLink, isDir: dirent.isDirectory() || stat?.isDirectory() === true, isSocket: dirent.isSocket() || stat?.isSocket() === true };
}

/**
 * The entries of `dir`. A text path lists fast with types; a name that is not
 * UTF-8 shows as U+FFFD there, so only then is the folder listed again as
 * bytes, and those names go on as Buffer paths (Bun gives no Dirent for a
 * byte listing, so each is lstat'ed). Under a Buffer path every listing is by
 * bytes.
 */
function readEntries(dir: FsPath): Entry[] {
  if (Buffer.isBuffer(dir)) return readdirSync(dir, { encoding: "buffer" }).map((raw) => entryOfBytes(dir, raw));
  const dirents = readdirSync(dir, { withFileTypes: true });
  if (!dirents.some((dirent) => dirent.name.includes(REPLACEMENT))) return dirents.map((dirent) => textEntry(dir, dirent));
  const entries: Entry[] = dirents.filter((dirent) => !dirent.name.includes(REPLACEMENT)).map((dirent) => textEntry(dir, dirent));
  for (const raw of readdirSync(dir, { encoding: "buffer" })) {
    const text = raw.toString("utf8");
    if (text.includes(REPLACEMENT)) entries.push(entryOfBytes(dir, raw));
  }
  return entries;
}

function entryOfBytes(dir: FsPath, raw: Buffer): Entry {
  const text = raw.toString("utf8");
  const isText = Buffer.from(text, "utf8").equals(raw);
  const path = childOf(dir, isText ? text : raw);
  const stat = lstatOf(path);
  return { name: text, path, isLink: stat?.isSymbolicLink() === true, isDir: stat?.isDirectory() === true, isSocket: stat?.isSocket() === true };
}

/**
 * Lists `dir`. A folder that is gone (ENOENT, ENOTDIR) is empty; any other
 * error is a problem. A folder of another user that this user cannot enter
 * is skipped: a run, the same user, cannot reach into it either. A folder of
 * this user that it cannot read or enter is a problem at launch; the post-run
 * check (`isRepairing`) first gives it `chmod u+rwx` and lists it once more.
 * A folder whose lstat fails (its parent lost its x bit) is never taken for
 * another user's: it is a problem (M1).
 */
function listDir(dir: FsPath, isRepairing: boolean): Listing {
  let stat: Stats;
  try {
    stat = lstatSync(dir);
  } catch (cause) {
    if (isGone(cause)) return { entries: [], id: "" };
    return { problem: `${shown(dir)} cannot be looked at (${errnoOf(cause) ?? errorMessage(cause)})` };
  }
  if (!stat.isDirectory()) return { entries: [], id: "" };
  const canEnter = access(dir, constants.X_OK);
  const canRead = access(dir, constants.R_OK);
  let repaired: string | undefined;
  if (stat.uid !== userInfo().uid) {
    if (!canEnter) return { skip: true };
    if (!canRead) return { problem: `${shown(dir)} cannot be read, and it is another user's` };
  } else if (!canEnter || !canRead) {
    if (!isRepairing) return { problem: `${shown(dir)} cannot be read or entered; make it readable, or remove it` };
    try {
      repairDir(dir, stat);
      repaired = `made ${shown(dir)} readable (chmod u+rwx) to look in it`;
    } catch (cause) {
      return { problem: `${shown(dir)} cannot be read, and chmod u+rwx failed (${errnoOf(cause) ?? errorMessage(cause)})` };
    }
  }
  try {
    const entries = readEntries(dir);
    return repaired === undefined ? { entries, id: idOf(stat) } : { entries, id: idOf(stat), repaired };
  } catch (cause) {
    if (isGone(cause)) return { entries: [], id: idOf(stat) };
    return { problem: `${shown(dir)} cannot be listed (${errnoOf(cause) ?? errorMessage(cause)})` };
  }
}

/** A pending folder: whether the walk looks for guards in it. */
interface Pending {
  dir: FsPath;
  isGuarded: boolean;
}

/** One walk (see the file comment). `timedOut` when it did not finish before the deadline. */
function walkWork(input: WalkInput): Walked {
  const root = normalize(input.root);
  const walked: Walked = { sockets: [], found: [], isBareTop: false, topFiles: [], problems: [], repaired: [], timedOut: false };
  const isKnown = (id: string): boolean => input.known === undefined || input.known.has(id);
  const pending: Pending[] = [{ dir: root, isGuarded: false }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (input.now() > input.deadline) return { ...walked, timedOut: true };
    const { dir } = next;
    const isTop = dir === root;
    const listing = listDir(dir, input.known !== undefined);
    if ("skip" in listing) continue;
    if ("problem" in listing) {
      // Inside a known guard only sockets count, and a read-only mount cannot be made unreadable by the run.
      if (!next.isGuarded) walked.problems.push(listing.problem);
      continue;
    }
    if (listing.repaired !== undefined) walked.repaired.push(listing.repaired);
    let isGuarded = next.isGuarded;
    // A .git folder is a guard by its name already; its HEAD, objects and refs make no second one.
    if (!isGuarded && baseOf(dir) !== ".git" && looksBare(new Set(listing.entries.map((entry) => entry.name)))) {
      const stat = lstatOf(dir);
      if (isTop && input.isWorkDir) walked.isBareTop = true;
      if ((!isTop || !input.isWorkDir) && stat !== undefined) {
        walked.found.push({ path: dir, kind: "bare", id: idOf(stat), isLink: false, parentId: idOf(lstatOf(parentOf(dir)) ?? stat) });
        isGuarded = isKnown(idOf(stat));
      }
    }
    for (const entry of listing.entries) {
      const { name, path } = entry;
      const kind = isGuarded ? undefined : guardKind(name, entry);
      const isOwnTop = isTop && input.isWorkDir;
      let isChildGuarded = isGuarded || (isOwnTop && TOP_GUARDS.has(name));
      if (kind !== undefined && !(isOwnTop && TOP_GUARDS.has(name))) {
        const own = lstatOf(path);
        if (own === undefined) {
          walked.problems.push(`${shown(path)} cannot be looked at`);
        } else {
          const found = { path, kind, id: idOf(own), isLink: entry.isLink, parentId: listing.id };
          if (isOwnTop && TOP_FILES.has(name)) walked.topFiles.push(found);
          else walked.found.push(found);
          isChildGuarded = isKnown(idOf(own));
        }
      }
      if (entry.isLink) continue;
      if (entry.isSocket) {
        if (input.hasSockets) walked.sockets.push(path);
        continue;
      }
      if (!entry.isDir || WORK_PRUNED_NAMES.has(name)) continue;
      if (!Buffer.isBuffer(path) && (input.mounts.has(path) || input.pruned?.has(path) === true)) continue;
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

/** The text paths of one kind; a Buffer path cannot be handed to bwrap, so it is a problem instead. */
function pathsOf(found: readonly Found[], kind: GuardKind, isLink: boolean): string[] {
  return found.filter((entry) => entry.kind === kind && entry.isLink === isLink && !Buffer.isBuffer(entry.path)).map((entry) => shown(entry.path));
}

/**
 * The work dir's sockets (a devenv postgres socket, a `tmux -S` socket) and
 * its guards, in one walk before the launch. It enters a guard for sockets,
 * but looks for no guard inside it.
 */
export function scanWork(input: WorkScanInput): WorkScan {
  const now = input.now ?? Date.now;
  const mounts = input.mountinfo === undefined ? readMounts() : mountPoints(input.mountinfo);
  const walked = walkWork({ root: input.workDir, deadline: now() + input.capMs, now, hasSockets: true, mounts, isWorkDir: true });
  const { found } = walked;
  const unnamed = [...found.map((entry) => entry.path), ...walked.sockets].filter((path) => Buffer.isBuffer(path));
  const problems = [...walked.problems, ...unnamed.map((path) => `${shown(path)} has a name that is not valid UTF-8, and the box cannot mount or mask it`)];
  return {
    sockets: walked.sockets.filter((path) => !Buffer.isBuffer(path)).map((path) => shown(path)),
    gits: pathsOf(found, "git", false),
    gitLinks: pathsOf(found, "git", true),
    claudes: pathsOf(found, "claude", false),
    claudeLinks: pathsOf(found, "claude", true),
    markers: pathsOf(found, "marker", false),
    markerLinks: pathsOf(found, "marker", true),
    mcps: pathsOf(found, "mcp", false),
    mcpLinks: pathsOf(found, "mcp", true),
    bares: pathsOf(found, "bare", false),
    isBareTop: walked.isBareTop,
    ids: [...found, ...walked.topFiles].map((entry) => entry.id),
    problems,
    timedOut: walked.timedOut,
    capMs: input.capMs,
  };
}

/** What a writable extra holds that a later unboxed tool trusts, or why the walk could not tell. */
export interface ExtraScan {
  guards: string[];
  problems: string[];
  timedOut: boolean;
}

/**
 * Walks a writable extra (`[box] writable`, a ritual's `writable`) with the
 * work dir's rules, its top included, and leaves out the folders in `pruned`
 * (the work dir). Every guard it finds would be writable in the box.
 */
export function scanExtra(input: { path: string; pruned: readonly string[]; deadline: number; now?: () => number; mountinfo?: string }): ExtraScan {
  const now = input.now ?? Date.now;
  const mounts = input.mountinfo === undefined ? readMounts() : mountPoints(input.mountinfo);
  const walked = walkWork({ root: input.path, deadline: input.deadline, now, hasSockets: false, mounts, isWorkDir: false, pruned: new Set(input.pruned.map((path) => normalize(path))) });
  return { guards: walked.found.map((entry) => shown(entry.path)), problems: walked.problems, timedOut: walked.timedOut };
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
  /** What it could not settle: a rename that failed, a folder it could not read, the cap. Each one taints the work dir. */
  unresolved: string[];
  /** The folders it made readable to look in them, as lines for run.log. */
  repaired: string[];
  /** The walk hit its cap. */
  isUnfinished: boolean;
}

const PLANT_WHAT = {
  git: "a .git made in the run",
  claude: "a .claude made in the run",
  marker: "a .darius.toml made in the run",
  mcp: "a .mcp.json made in the run",
  bare: "a bare repo made in the run",
} as const satisfies Record<GuardKind, string>;

/** A fresh name next to `target`: `<name>.darius-blocked-<8 hex>`, one nothing holds now. */
function freshName(target: FsPath): FsPath | undefined {
  for (let tries = 0; tries < NAME_TRIES; tries += 1) {
    const suffix = `${BLOCKED_SUFFIX}-${randomBytes(4).toString("hex")}`;
    const candidate = Buffer.isBuffer(target) ? Buffer.concat([target, Buffer.from(suffix)]) : `${target}${suffix}`;
    if (lstatOf(candidate) === undefined) return candidate;
  }
  return undefined;
}

/** Throws when the folder at `parent` is not the one the walk listed: the rename would go elsewhere. */
function checkParent(parent: FsPath, parentId: string): Stats {
  const stat = lstatOf(parent);
  if (stat === undefined || !stat.isDirectory() || idOf(stat) !== parentId) throw new Error("its folder changed since the walk");
  // A folder on the way that is a link now would send the rename elsewhere. Only a text path can be resolved here.
  if (!Buffer.isBuffer(parent) && realOr(parent) !== parent) throw new Error("a folder on its path is a link now");
  return stat;
}

/**
 * `rename`, after checking the folder is the one the walk listed; when the
 * folder refuses it, `chmod u+rwx` on the folder (through a handle that does
 * not follow a link) and one more try. Returns the chmod note, or throws.
 */
function renameWithRepair(target: FsPath, to: FsPath, parentId: string): string {
  const parent = parentOf(target);
  const stat = checkParent(parent, parentId);
  try {
    renameSync(target, to);
    return "";
  } catch (cause) {
    const code = errnoOf(cause);
    if ((code !== "EACCES" && code !== "EPERM") || stat.uid !== userInfo().uid) throw cause;
    repairDir(parent, stat);
    checkParent(parent, parentId);
    renameSync(target, to);
    return `, after chmod u+rwx on ${shown(parent)}`;
  }
}

/**
 * Neutralizes one plant, reversibly: a `.git`, `.claude`, `.darius.toml` or
 * `.mcp.json` is renamed, a bare repo's `HEAD` is renamed, so git no longer
 * sees a repo there. `renameSync` moves the entry itself, a link too, and
 * never follows it. Gives the line for run.log, or the reason it failed.
 */
function blockPlant(plant: Found): { line: string } | { unresolved: string } {
  const isBare = plant.kind === "bare";
  const target = isBare ? childOf(plant.path, "HEAD") : plant.path;
  const parentId = isBare ? plant.id : plant.parentId;
  const head = `${shown(plant.path)}, ${PLANT_WHAT[plant.kind]}`;
  const to = freshName(target);
  if (to === undefined) return { unresolved: `${head}, not renamed: no free ${baseOf(target)}${BLOCKED_SUFFIX}-<random> name` };
  try {
    const note = renameWithRepair(target, to, parentId);
    return { line: `${head}, ${baseOf(target)} renamed to ${baseOf(to)}${note}` };
  } catch (cause) {
    return { unresolved: `${head}, not renamed: ${errnoOf(cause) ?? errorMessage(cause)}` };
  }
}

/** Path depth: the deepest plant is renamed first, so the paths of the others stay valid. */
function depth(path: FsPath): number {
  return asBytes(path).filter((byte) => byte === 0x2f).length;
}

/**
 * The post-run check. Run it only when no process of the run is left (the
 * runner reaps the box first, and holds the work dir's lock), so nothing
 * races the walk or the renames. Never throws for one plant: a rename that
 * fails is an unresolved reason.
 */
export function checkPlants(input: PlantCheckInput): PlantCheck {
  const now = input.now ?? Date.now;
  const root = normalize(realOr(input.workDir));
  const known = new Set(input.launch.ids);
  const mounts = input.mountinfo === undefined ? readMounts() : mountPoints(input.mountinfo);
  const walked = walkWork({ root, deadline: now() + input.capMs, now, hasSockets: false, mounts, isWorkDir: true, known });
  const plants = [...walked.found, ...walked.topFiles].filter((entry) => !known.has(entry.id));
  // With an empty .git at the top, git takes the work dir itself for a bare repo when it looks like one.
  const rootStat = lstatOf(root);
  if (walked.isBareTop && !input.launch.isBareTop && rootStat !== undefined) plants.push({ path: root, kind: "bare", id: idOf(rootStat), isLink: false, parentId: "" });
  const blocked: string[] = [];
  const unresolved = [...walked.problems];
  for (const plant of plants.toSorted((a, b) => depth(b.path) - depth(a.path))) {
    const done = blockPlant(plant);
    if ("line" in done) blocked.push(done.line);
    else unresolved.push(done.unresolved);
  }
  if (walked.timedOut) unresolved.push(`the check did not finish within ${String(Math.round(input.capMs / 1000))} s`);
  return { blocked, unresolved, repaired: walked.repaired, isUnfinished: walked.timedOut };
}

/** The real path of `path`, or `path` when it is not there. */
export function realOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
