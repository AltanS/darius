/**
 * The host side of the box plan (src/core/box.ts): the facts a plan is built
 * from, read on this host, and the files the plan says to make before a run.
 * The plan itself stays pure; this file is all of its filesystem access.
 */

import { chmodSync, closeSync, constants, copyFileSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, type Dirent, type Stats } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join, normalize } from "node:path";

import { secretPaths } from "../harness/gate.ts";
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
/** Folders the work dir scan never enters, for speed: a package tree holds no live socket. */
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
  /** Folders never entered, by path. */
  prune: ReadonlySet<string>;
  deadline: number;
  now: () => number;
  /** Called for each entry named `.git` below the root, with whether it is a link. */
  onGit?: (path: string, isLink: boolean) => void;
}

/** The sockets one walk found, and whether it ran out of time first. */
interface Walked {
  found: string[];
  timedOut: boolean;
}

/**
 * Every Unix socket under `root`: `readdirSync` and `lstat`, no shell, no link
 * followed, one filesystem only (as `find -xdev`). `timedOut` when the walk
 * did not finish before the deadline.
 */
function walkSockets(input: WalkInput): Walked {
  const root = normalize(input.root);
  const device = lstatOf(root)?.dev;
  const found: string[] = [];
  const pending = [root];
  for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
    if (input.now() > input.deadline) return { found, timedOut: true };
    for (const entry of entriesOf(dir)) {
      const path = join(dir, entry.name);
      if (entry.name === ".git" && dir !== root) input.onGit?.(path, entry.isSymbolicLink());
      if (entry.isSymbolicLink()) continue;
      if (entry.isSocket()) {
        found.push(path);
        continue;
      }
      // Some filesystems give no type in the listing; lstat says what it is.
      const stat = entry.isDirectory() || entry.isFile() ? undefined : lstatOf(path);
      if (stat?.isSocket() === true) found.push(path);
      const isDir = entry.isDirectory() || stat?.isDirectory() === true;
      if (!isDir || input.prunedNames.has(entry.name) || input.prune.has(path)) continue;
      if (lstatOf(path)?.dev !== device) continue;
      pending.push(path);
    }
  }
  return { found, timedOut: false };
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
 * every `.git` below its top, in one walk. It enters `.git` folders, but never
 * `node_modules`. A `.git` that is a link is listed in `gitLinks`.
 */
export function scanWork(input: WorkScanInput): WorkScan {
  const now = input.now ?? Date.now;
  const gits: string[] = [];
  const gitLinks: string[] = [];
  const walked = walkSockets({
    root: input.workDir,
    prunedNames: WORK_PRUNED_NAMES,
    prune: new Set(),
    deadline: now() + input.capMs,
    now,
    onGit: (path, isLink) => {
      if (isLink) gitLinks.push(path);
      else gits.push(path);
    },
  });
  return { sockets: walked.found, gits, gitLinks, timedOut: walked.timedOut, capMs: input.capMs };
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
