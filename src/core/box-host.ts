/**
 * The host side of the box plan (src/core/box.ts): the facts a plan is built
 * from, read on this host, and the files the plan says to make before a run.
 * The plan itself stays pure; this file is all of its filesystem access.
 */

import { chmodSync, closeSync, constants, copyFileSync, lstatSync, mkdirSync, openSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync, type Dirent, type Stats } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join, normalize } from "node:path";

import { secretPaths } from "../harness/gate.ts";
import { BoxError, hiddenHomeDirs, type BoxEntry, type BoxEnv, type BoxFacts, type BoxPlan, type SocketScan } from "./box.ts";
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

/** How long the socket scan of home may take (coordinator ruling 2026-11-02). */
export const SOCKET_SCAN_CAP_MS = 30_000;
/** Folder names the socket scan never enters, wherever they are. */
const PRUNED_NAMES: ReadonlySet<string> = new Set(["node_modules", ".git"]);

/** What the socket scan walks and skips. */
export interface SocketScanInput {
  home: string;
  /** Folders not entered: the hidden folders and the work dir, as written or real. */
  prune: readonly string[];
  capMs: number;
  /** The clock, so a test can run out of time. */
  now?: () => number;
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

/**
 * Every Unix socket under home: `readdirSync` and `lstat`, no shell, no link
 * followed, one filesystem only (as `find -xdev`). It never enters a pruned
 * folder, `node_modules` or `.git`. It stops at the time cap and says so; the
 * hidden folders are a tmpfs in the box in any case.
 */
export function scanSockets(input: SocketScanInput): SocketScan {
  const now = input.now ?? Date.now;
  const deadline = now() + input.capMs;
  const prune = new Set(input.prune.map((path) => normalize(path)));
  const device = lstatOf(input.home)?.dev;
  const found: string[] = [];
  const pending = [normalize(input.home)];
  for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
    if (now() > deadline) return { found, timedOut: true, capMs: input.capMs };
    for (const entry of entriesOf(dir)) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isSocket()) {
        found.push(path);
        continue;
      }
      // Some filesystems give no type in the listing; lstat says what it is.
      const stat = entry.isDirectory() || entry.isFile() ? undefined : lstatOf(path);
      if (stat?.isSocket() === true) found.push(path);
      const isDir = entry.isDirectory() || stat?.isDirectory() === true;
      if (!isDir || PRUNED_NAMES.has(entry.name) || prune.has(path)) continue;
      if (lstatOf(path)?.dev !== device) continue;
      pending.push(path);
    }
  }
  return { found, timedOut: false, capMs: input.capMs };
}

/** The real path of `path`, or `path` when it is not there. */
function realOr(path: string): string {
  return boxEntry(path)?.real ?? path;
}

/**
 * The facts of this host for a box plan, with the socket scan of home.
 * `workDir`'s tree is not scanned. Throws a BoxError when XDG_RUNTIME_DIR is
 * not an absolute path.
 */
export function hostBoxFacts(at: { workDir: string }): BoxFacts {
  const runtimeDir = process.env.XDG_RUNTIME_DIR ?? "";
  if (!runtimeDir.startsWith("/")) throw new BoxError("the box needs XDG_RUNTIME_DIR, an absolute path; a systemd user unit sets it");
  const user = userInfo();
  const home = homedir();
  const prune = [...hiddenHomeDirs(home), at.workDir].flatMap((path) => [path, realOr(path)]);
  return {
    sockets: scanSockets({ home, prune, capMs: SOCKET_SCAN_CAP_MS }),
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
 * when a file to make appears as a link or as the wrong type.
 */
export function prepareBox(plan: BoxPlan): void {
  mkdirSync(dirname(plan.boxDir), { recursive: true, mode: 0o700 });
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
