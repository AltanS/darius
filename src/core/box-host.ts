/**
 * The host side of the box plan (src/core/box.ts): the facts a plan is built
 * from, read on this host, and the files the plan says to make before a run.
 * The plan itself stays pure; this file is all of its filesystem access.
 */

import { chmodSync, closeSync, constants, copyFileSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, type Dirent, type Stats } from "node:fs";
import { homedir, userInfo } from "node:os";
import { basename, dirname, join, normalize } from "node:path";

import { secretPaths } from "../harness/gate.ts";
import { errorMessage } from "../runtime.ts";
import { BoxError, hiddenHomeDirs, type BoxEntry, type BoxEnv, type BoxFacts, type BoxPlan, type SocketScan, type WorkScan } from "./box.ts";
import { loadConfigIfPresent } from "./config.ts";
import { appDir, configDir, stateDir } from "./paths.ts";
import { maskedPaths } from "./sandbox.ts";

function kindOf(stat: Stats): BoxEntry["kind"] {
  if (stat.isFile()) return "file";
  if (stat.isDirectory()) return "dir";
  return "other";
}

/** What is at `path` on this host, symlinks followed; undefined when nothing is there or a link points nowhere. */
export function boxEntry(path: string): BoxEntry | undefined {
  try {
    const own = lstatSync(path);
    const real = realpathSync(path);
    const entry: BoxEntry = { real, kind: kindOf(statSync(real)) };
    if (own.isSymbolicLink()) entry.link = readlinkSync(path);
    return entry;
  } catch {
    return undefined;
  }
}

/** The runner's environment as plain strings. */
function plainEnv(): BoxEnv {
  const env: BoxEnv = {};
  for (const [name, value] of Object.entries(process.env)) if (value !== undefined) env[name] = value;
  return env;
}

/** How long the socket scan of home and the work dir may take, together (coordinator ruling 2026-11-02). */
export const SOCKET_SCAN_CAP_MS = 30_000;
/** Folders the work dir scan never enters, for speed: a package tree holds no live socket. Its `.git` and `.claude` are not guarded (docs/concept.md, "What the box does not stop"). */
const WORK_PRUNED_NAMES: ReadonlySet<string> = new Set(["node_modules"]);

/** What the socket scan reads and skips. */
export interface SocketScanInput {
  home: string;
  /** Folders left out: the hidden folders and the work dir, as written or real. */
  prune: readonly string[];
  /** More folders the box empties, such as XDG_RUNTIME_DIR. */
  tmpfs?: readonly string[];
  capMs: number;
  /** The `/proc/net/unix` text, for a test. */
  procNetUnix?: string;
}

/** The entries of `dir`, or none when it cannot be read. */
function entriesOf(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** The lstat of `path`, or undefined when it is gone. */
function lstatOf(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

interface WalkInput {
  root: string;
  /** Folder names never entered. */
  prunedNames: ReadonlySet<string>;
  deadline: number;
  now: () => number;
  /** Lists sockets too: the launch scan does, the post-run check does not. */
  hasSockets: boolean;
}

/** The guarded entries one walk found below the top. */
interface WorkGuards {
  gits: string[];
  gitLinks: string[];
  claudes: string[];
  claudeLinks: string[];
  bares: string[];
  isBareTop: boolean;
}

/** What one walk found, and whether it ran out of time first. */
interface Walked {
  sockets: string[];
  guards: WorkGuards;
  timedOut: boolean;
}

/** The top entries the box guards itself: one mount each, so the walk looks for no guard inside. */
const TOP_GUARDS: ReadonlySet<string> = new Set([".git", ".claude"]);

/**
 * True when git takes a folder with these entries for a bare repo: a `HEAD`
 * entry, and `objects` and `refs`, or a `commondir` that points at them
 * elsewhere. Each of any type: git asks `access`, which follows links.
 */
function looksBare(entries: readonly Dirent[]): boolean {
  const names = new Set(entries.map((entry) => entry.name));
  return names.has("HEAD") && (names.has("commondir") || (names.has("objects") && names.has("refs")));
}

/** The guard list a `.git` or `.claude` below the top goes in, or undefined. A `.claude` file holds no settings. */
function guardKind(name: string, entry: { isLink: boolean; isDir: boolean }): keyof Omit<WorkGuards, "isBareTop"> | undefined {
  if (name === ".git") return entry.isLink ? "gitLinks" : "gits";
  if (name !== ".claude") return undefined;
  if (entry.isLink) return "claudeLinks";
  return entry.isDir ? "claudes" : undefined;
}

/**
 * One walk of the work dir: `readdirSync` and `lstat`, no shell, no link
 * followed, one filesystem only (as `find -xdev`). It finds the sockets (when
 * asked) and the guards: every `.git`, `.claude` folder and bare repo below
 * the top. It still enters a guard for sockets, but looks for no guard inside
 * one, nor inside the top's own `.git` and `.claude`. `timedOut` when the walk
 * did not finish before the deadline.
 */
function walkWork(input: WalkInput): Walked {
  const root = normalize(input.root);
  const device = lstatOf(root)?.dev;
  const sockets: string[] = [];
  const guards: WorkGuards = { gits: [], gitLinks: [], claudes: [], claudeLinks: [], bares: [], isBareTop: false };
  const pending = [{ dir: root, isGuarded: false }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (input.now() > input.deadline) return { sockets, guards, timedOut: true };
    const { dir } = next;
    const isTop = dir === root;
    const entries = entriesOf(dir);
    const isBare = !next.isGuarded && looksBare(entries);
    if (isBare && isTop) guards.isBareTop = true;
    if (isBare && !isTop) guards.bares.push(dir);
    const isGuarded = next.isGuarded || (isBare && !isTop);
    for (const entry of entries) {
      const path = join(dir, entry.name);
      const isLink = entry.isSymbolicLink();
      // Some filesystems give no type in the listing; lstat says what it is.
      const stat = isLink || entry.isDirectory() || entry.isFile() || entry.isSocket() ? undefined : lstatOf(path);
      const isDir = entry.isDirectory() || stat?.isDirectory() === true;
      const kind = isGuarded || isTop ? undefined : guardKind(entry.name, { isLink, isDir });
      if (kind !== undefined) guards[kind].push(path);
      if (isLink) continue;
      if (entry.isSocket() || stat?.isSocket() === true) {
        if (input.hasSockets) sockets.push(path);
        continue;
      }
      if (!isDir || input.prunedNames.has(entry.name)) continue;
      if (lstatOf(path)?.dev !== device) continue;
      pending.push({ dir: path, isGuarded: isGuarded || kind !== undefined || (isTop && TOP_GUARDS.has(entry.name)) });
    }
  }
  return { sockets, guards, timedOut: false };
}

/** The kernel's list of bound Unix sockets in this network namespace. */
const PROC_NET_UNIX = "/proc/net/unix";
/** Where the box puts a tmpfs: a socket there is gone in the box already. */
const TMPFS_ROOTS: readonly string[] = ["/tmp", "/var/tmp", "/run", "/dev", "/proc", "/sys"];

function isUnder(path: string, dir: string): boolean {
  return path === dir || path.startsWith(dir.endsWith("/") ? dir : `${dir}/`);
}

/**
 * The paths of the bound Unix sockets in a `/proc/net/unix` text: the eighth
 * field, when it is absolute. An abstract socket (`@name`) is left out: it
 * belongs to the network namespace, and the box has its own.
 */
export function procUnixPaths(text: string): string[] {
  const paths = new Set<string>();
  for (const line of text.split("\n").slice(1)) {
    const fields = line.trim().split(/\s+/u);
    const path = fields.slice(7).join(" ");
    if (fields.length >= 8 && path.startsWith("/")) paths.add(normalize(path));
  }
  return [...paths];
}

/**
 * Every bound Unix socket on this host that the box would still show: from
 * the kernel's list (`/proc/net/unix`), not a walk, so a big home takes no
 * time. It leaves out the tmpfs roots of the box, the pruned folders (the
 * hidden folders, and the work dir, which `scanWork` covers) and paths that
 * are not a socket now. A socket bound in another network namespace (a
 * container) is not in the list; the containers' folders are hidden.
 */
export function scanSockets(input: SocketScanInput): SocketScan {
  let text: string;
  try {
    text = input.procNetUnix ?? readFileSync(PROC_NET_UNIX, "utf8");
  } catch {
    // Without the kernel's list the box cannot know the sockets: refuse the run.
    return { found: [], timedOut: true, capMs: input.capMs };
  }
  const home = normalize(input.home);
  const pruned = [...input.prune, ...(input.tmpfs ?? [])].map((path) => normalize(path));
  const found = procUnixPaths(text).filter((path) => {
    // A home under a tmpfs root (a throwaway test home) is bound back into the box.
    if (!isUnder(path, home) && TMPFS_ROOTS.some((dir) => isUnder(path, dir))) return false;
    if (pruned.some((dir) => isUnder(path, dir))) return false;
    return lstatOf(path)?.isSocket() === true;
  });
  return { found, timedOut: false, capMs: input.capMs };
}

/** What the work dir scan walks. */
export interface WorkScanInput {
  /** The work dir's real path. */
  workDir: string;
  capMs: number;
  now?: () => number;
}

/**
 * The work dir's sockets (a devenv postgres socket, a `tmux -S` socket) and
 * its guards in one walk: every `.git`, `.claude` folder and bare repo below
 * its top. It enters `.git` folders for sockets, but never `node_modules`. A
 * `.git` or `.claude` that is a link is listed apart.
 */
export function scanWork(input: WorkScanInput): WorkScan {
  const now = input.now ?? Date.now;
  const walked = walkWork({ root: input.workDir, prunedNames: WORK_PRUNED_NAMES, deadline: now() + input.capMs, now, hasSockets: true });
  return { sockets: walked.sockets, ...walked.guards, timedOut: walked.timedOut, capMs: input.capMs };
}

/** How long the post-run walk of the work dir may take. */
export const PLANT_CHECK_CAP_MS = 30_000;
/** What a neutralized plant's name gets. */
export const BLOCKED_SUFFIX = ".darius-blocked";

/** What the post-run check walks, and what the launch scan found there. */
export interface PlantCheckInput {
  /** The work dir as the run was given it. */
  workDir: string;
  /** The launch's scan: what is in it was there before the run. */
  launch: WorkScan;
  /** The run id, for a second name when the first is taken. */
  run: string;
  capMs: number;
  now?: () => number;
}

/** What the post-run check did. */
export interface PlantCheck {
  /** One line per plant: its path, what it is, and what was done. */
  blocked: string[];
  /** The walk hit its cap: a plant it did not reach stays. */
  isUnfinished: boolean;
}

type PlantKind = "git" | "claude" | "bare";

const PLANT_WHAT = {
  git: "a .git made in the run",
  claude: "a .claude made in the run",
  bare: "a bare repo made in the run",
} as const satisfies Record<PlantKind, string>;

/** The first free name for a blocked entry: `<name>.darius-blocked`, then with `-<run>`; undefined when both are taken. */
function blockedName(path: string, run: string): string | undefined {
  return [`${path}${BLOCKED_SUFFIX}`, `${path}${BLOCKED_SUFFIX}-${run}`].find((candidate) => lstatOf(candidate) === undefined);
}

/**
 * Neutralizes one plant, reversibly: a `.git` or `.claude` is renamed, a bare
 * repo's `HEAD` is renamed, so git no longer sees a repo there. `renameSync`
 * moves the entry itself, a link too, and never follows it.
 */
function blockPlant(plant: { path: string; kind: PlantKind }, run: string): string {
  const target = plant.kind === "bare" ? join(plant.path, "HEAD") : plant.path;
  const head = `${plant.path}, ${PLANT_WHAT[plant.kind]}`;
  const to = blockedName(target, run);
  if (to === undefined) return `${head}, not renamed: ${basename(target)}${BLOCKED_SUFFIX} and ${basename(target)}${BLOCKED_SUFFIX}-${run} are both taken`;
  try {
    renameSync(target, to);
  } catch (cause) {
    return `${head}, not renamed: ${errorMessage(cause)}`;
  }
  return `${head}, ${basename(target)} renamed to ${basename(to)}`;
}

/** The guards of `after` that the launch scan did not find: each one was made in the run. */
function newPlants(launch: WorkScan, after: WorkGuards, root: string): { path: string; kind: PlantKind }[] {
  const known = new Set([...launch.gits, ...launch.gitLinks, ...launch.claudes, ...launch.claudeLinks, ...launch.bares]);
  const found: { path: string; kind: PlantKind }[] = [
    ...[...after.gits, ...after.gitLinks].map((path) => ({ path, kind: "git" as const })),
    ...[...after.claudes, ...after.claudeLinks].map((path) => ({ path, kind: "claude" as const })),
    ...after.bares.map((path) => ({ path, kind: "bare" as const })),
  ];
  // With an empty .git at the top, git takes the work dir itself for a bare repo when it looks like one.
  if (after.isBareTop && !launch.isBareTop) found.push({ path: root, kind: "bare" });
  return found.filter((plant) => !known.has(plant.path));
}

/**
 * The post-run check (run after the box is closed, so no process of the run
 * is left to race it). It walks the work dir again with the launch scan's
 * rules and renames each `.git`, `.claude` folder or link, and bare repo that
 * the launch scan did not find. A later unboxed git or Claude Code session
 * would trust it. Never throws for one plant: a rename that fails is a line
 * that says so.
 */
export function checkPlants(input: PlantCheckInput): PlantCheck {
  const now = input.now ?? Date.now;
  const root = normalize(realOr(input.workDir));
  const walked = walkWork({ root, prunedNames: WORK_PRUNED_NAMES, deadline: now() + input.capMs, now, hasSockets: false });
  const blocked = newPlants(input.launch, walked.guards, root).map((plant) => blockPlant(plant, input.run));
  return { blocked, isUnfinished: walked.timedOut };
}

/** The real path of `path`, or `path` when it is not there. */
function realOr(path: string): string {
  return boxEntry(path)?.real ?? path;
}

/**
 * The facts of this host for a box plan, with the socket scan of home and the
 * scan of the work dir, which share one time cap. Throws a BoxError when
 * XDG_RUNTIME_DIR is not an absolute path.
 */
export function hostBoxFacts(at: { workDir: string }): BoxFacts {
  const runtimeDir = process.env.XDG_RUNTIME_DIR ?? "";
  if (!runtimeDir.startsWith("/")) throw new BoxError("the box needs XDG_RUNTIME_DIR, an absolute path; a systemd user unit sets it");
  const user = userInfo();
  const home = homedir();
  const prune = [...hiddenHomeDirs(home), at.workDir].flatMap((path) => [path, realOr(path)]);
  const started = Date.now();
  const sockets = scanSockets({ home, prune, tmpfs: [runtimeDir], capMs: SOCKET_SCAN_CAP_MS });
  const work = scanWork({ workDir: realOr(at.workDir), capMs: Math.max(0, SOCKET_SCAN_CAP_MS - (Date.now() - started)) });
  return {
    sockets,
    work,
    home,
    user: process.env.USER ?? user.username,
    uid: user.uid,
    runtimeDir,
    store: stateDir(),
    config: configDir(),
    app: appDir(),
    env: plainEnv(),
    masked: maskedPaths(loadConfigIfPresent()),
    secrets: secretPaths(),
    entry: boxEntry,
  };
}

/** True when `path` is a plain file or folder of `kind`, not a link. */
function isPlain(path: string, kind: "file" | "dir"): boolean {
  const stat = lstatSync(path);
  return kind === "file" ? stat.isFile() : stat.isDirectory();
}

/**
 * Makes what the plan names, before the launch: the box dir (mode 0700, new),
 * the empty `gate.jsonl` and `scratch/` in the run dir, and the per-run
 * copies (mode 0600). Throws a BoxError when the box dir is there already, or
 * when a file to make appears as a link or as the wrong type. On a throw it
 * removes the box dir only when it made it: a box dir that was there belongs
 * to a live launch.
 */
export function prepareBox(plan: BoxPlan): void {
  mkdirSync(dirname(plan.boxDir), { recursive: true, mode: 0o700 });
  let isMade = false;
  try {
    makeBox(plan, () => {
      isMade = true;
    });
  } catch (cause) {
    if (isMade) removeBox(plan);
    throw cause;
  }
}

function makeBox(plan: BoxPlan, onBoxDir: () => void): void {
  for (const create of plan.creates) {
    try {
      if (create.kind === "dir") mkdirSync(create.path, { mode: create.mode });
      else closeSync(openSync(create.path, "wx", create.mode));
    } catch (cause) {
      const isThere = cause instanceof Error && "code" in cause && cause.code === "EEXIST";
      if (!isThere) throw cause;
      if (create.path === plan.boxDir) throw new BoxError(`the box dir ${plan.boxDir} is there already`);
      if (!isPlain(create.path, create.kind)) throw new BoxError(`${create.path} must be a plain ${create.kind === "file" ? "file" : "folder"}`);
    }
    if (create.path === plan.boxDir) onBoxDir();
    chmodSync(create.path, create.mode);
  }
  if (plan.copies.length === 0) return;
  mkdirSync(join(plan.boxDir, "copies"), { mode: 0o700 });
  for (const copy of plan.copies) {
    copyFileSync(copy.from, copy.to, constants.COPYFILE_EXCL);
    chmodSync(copy.to, 0o600);
  }
}

/** Removes the box dir after the run. Best effort: a run must not fail on its cleanup. */
export function removeBox(plan: BoxPlan): void {
  try {
    rmSync(plan.boxDir, { recursive: true, force: true });
  } catch {
    // Under the runtime dir, which the session clears at logout.
  }
}
