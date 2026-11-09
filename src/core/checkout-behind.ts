/**
 * Is a checkout behind its upstream (0.126.0)? A host with a stale checkout
 * runs old ritual definitions from an old `.darius.toml`, so run-due asks
 * this once per checkout per pass, before the first due ritual there runs
 * (src/runner/run-due.ts). `[run] behind = "warn" | "refuse"` in config.toml
 * says what a behind checkout does; the default is "warn".
 *
 * The check, in the checkout dir:
 *
 *   1. It must be a git work tree, on a branch (not a detached HEAD), whose
 *      branch has an upstream (`@{upstream}`).
 *   2. `git fetch --quiet --no-tags <remote> <merge ref>` for that upstream,
 *      with a hard timeout (10 s), no prompt (`GIT_TERMINAL_PROMPT=0`, an
 *      empty `GIT_ASKPASS`, ssh `BatchMode=yes` unless the host has its own
 *      ssh command for git), no auto gc and no submodules. An upstream on
 *      remote `.` (a local branch) needs no fetch.
 *   3. `git rev-list --count HEAD..@{upstream}` is how far behind it is.
 *      `@{upstream}..HEAD` is how far ahead. Ahead only is not behind; a
 *      diverged branch is behind by the commits it lacks.
 *
 * It fails open: no git, not a work tree, a bare repo, a detached HEAD, no
 * upstream, a fetch that fails or times out. Each is `unchecked` with the
 * reason, and never blocks a run. It never pulls or merges: the work tree
 * and the index are never touched. The fetch writes only in `.git` (the
 * remote-tracking ref and `FETCH_HEAD`). It runs in its own process group;
 * on timeout the group gets SIGTERM, which git answers by removing its lock
 * files, and SIGKILL only 2 s later. run-due calls this from the host,
 * never from inside a run's box, where `.git` is read-only.
 *
 * run-due writes the result to `<store>/<project>/behind.json` (local, never
 * synced), and `darius doctor` prints it without a fetch of its own.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { JsonValue } from "./model.ts";
import type { Project } from "./store.ts";

/** The fetch's hard limit. */
export const BEHIND_FETCH_TIMEOUT_MS = 10_000;
/** How long a fetch has after SIGTERM before SIGKILL. */
const KILL_GRACE_MS = 2_000;
/** Each local git call (rev-parse, rev-list, config). */
const LOCAL_TIMEOUT_MS = 10_000;
const STDERR_MAX = 2_000;
const RECORD_FILE = "behind.json";

/** The values `[run] behind` takes. */
export const RUN_BEHIND = ["warn", "refuse"] as const;
export type RunBehind = (typeof RUN_BEHIND)[number];

export type BehindCheck =
  | { state: "checked"; upstream: string; behind: number; ahead: number }
  | { state: "unchecked"; reason: string };

export interface BehindOptions {
  /** The fetch's limit; tests make it short. */
  timeoutMs?: number;
}

type Env = NodeJS.ProcessEnv;

type GitResult = { ok: true; out: string } | { ok: false; error: string };

function firstLine(text: string): string {
  return text.trim().split("\n")[0]?.trim() ?? "";
}

/** One local git call. Fails, never throws. */
function gitLocal(dir: string, args: readonly string[], env: Env): GitResult {
  const result = spawnSync("git", args, { cwd: dir, env, encoding: "utf8", timeout: LOCAL_TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"] });
  if (result.error !== undefined) {
    const code = "code" in result.error ? result.error.code : undefined;
    return { ok: false, error: code === "ENOENT" ? "git is not installed" : result.error.message };
  }
  if (result.status !== 0) return { ok: false, error: firstLine(result.stderr) || `git ${args[0] ?? ""} exited ${String(result.status)}` };
  return { ok: true, out: result.stdout.trim() };
}

/** No prompt of any kind. ssh gets BatchMode unless the host set its own ssh command for git. */
function quietEnv(dir: string): Env {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS_REQUIRE: "never", GCM_INTERACTIVE: "never" } satisfies Env;
  const hasOwnSsh = process.env.GIT_SSH_COMMAND !== undefined || process.env.GIT_SSH !== undefined || gitLocal(dir, ["config", "--get", "core.sshCommand"], env).ok;
  return hasOwnSsh ? env : { ...env, GIT_SSH_COMMAND: "ssh -o BatchMode=yes" };
}

/** The env of the local git calls: the process env, no prompt. */
function plainEnv(): Env {
  return { ...process.env, GIT_TERMINAL_PROMPT: "0" } satisfies Env;
}

/** How a fetch that exited ends: null when it worked, else the error text. */
function fetchOutcome(target: { remote: string }, exit: { code: number | null; timedOut: boolean; stderr: string; timeoutMs: number }): string | null {
  if (exit.timedOut) return `the fetch of ${target.remote} timed out after ${String(Math.round(exit.timeoutMs / 100) / 10)} s`;
  if (exit.code === 0) return null;
  return `the fetch of ${target.remote} failed: ${firstLine(exit.stderr) || `exit ${String(exit.code)}`}`;
}

/** Sends `signal` to the fetch's whole process group (git and its ssh). */
function killGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch {
    // The group is gone already.
  }
}

/** How the fetch process ended: its exit code, or the spawn error's text. */
type FetchExit = { code: number | null } | { spawnError: string };

/** `git fetch` for one upstream, in its own process group, bounded by `timeoutMs`. Resolves with an error text, or null when it worked. */
async function fetchUpstream(dir: string, target: { remote: string; ref: string }, env: Env, timeoutMs: number): Promise<string | null> {
  const args = ["-c", "gc.auto=0", "-c", "maintenance.auto=false", "fetch", "--quiet", "--no-tags", "--no-recurse-submodules", target.remote, target.ref];
  const child = spawn("git", args, { cwd: dir, env, detached: true, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  let timedOut = false;
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    if (stderr.length < STDERR_MAX) stderr += chunk;
  });
  const term = setTimeout(() => {
    timedOut = true;
    killGroup(child.pid, "SIGTERM");
  }, timeoutMs);
  const kill = setTimeout(() => {
    killGroup(child.pid, "SIGKILL");
  }, timeoutMs + KILL_GRACE_MS);
  const exit = await new Promise<FetchExit>((resolve) => {
    child.once("error", (cause) => {
      resolve({ spawnError: "code" in cause && cause.code === "ENOENT" ? "git is not installed" : cause.message });
    });
    // The ssh child may hold stderr open, so the exit is the end, not the close of the pipes.
    child.once("exit", (code) => {
      resolve({ code });
    });
  });
  clearTimeout(term);
  clearTimeout(kill);
  child.stderr.destroy();
  if ("spawnError" in exit) return exit.spawnError;
  return fetchOutcome(target, { code: exit.code, timedOut, stderr, timeoutMs });
}

function count(dir: string, range: string, env: Env): { n: number } | { error: string } {
  const result = gitLocal(dir, ["rev-list", "--count", range], env);
  if (!result.ok) return { error: result.error };
  const n = Number(result.out);
  return Number.isSafeInteger(n) && n >= 0 ? { n } : { error: `git rev-list --count ${range} printed '${result.out}'` };
}

/** How far the checkout `dir` is behind its upstream, after a bounded fetch. Never throws, never blocks. */
export async function checkBehind(dir: string, opts: BehindOptions = {}): Promise<BehindCheck> {
  const plain = plainEnv();
  const inside = gitLocal(dir, ["rev-parse", "--is-inside-work-tree"], plain);
  if (!inside.ok) return { state: "unchecked", reason: inside.error === "git is not installed" ? inside.error : `not a git work tree: ${inside.error}` };
  if (inside.out !== "true") return { state: "unchecked", reason: "not a git work tree (a bare repo or a .git dir)" };
  const branch = gitLocal(dir, ["symbolic-ref", "--quiet", "--short", "HEAD"], plain);
  if (!branch.ok || branch.out === "") return { state: "unchecked", reason: "detached HEAD: no branch to compare" };
  const upstream = gitLocal(dir, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], plain);
  if (!upstream.ok || upstream.out === "") return { state: "unchecked", reason: `branch ${branch.out} has no upstream` };
  const remote = gitLocal(dir, ["config", "--get", `branch.${branch.out}.remote`], plain);
  const ref = gitLocal(dir, ["config", "--get", `branch.${branch.out}.merge`], plain);
  if (!remote.ok || !ref.ok) return { state: "unchecked", reason: `branch ${branch.out} has no remote or merge ref in its git config` };
  if (remote.out !== ".") {
    const failed = await fetchUpstream(dir, { remote: remote.out, ref: ref.out }, quietEnv(dir), opts.timeoutMs ?? BEHIND_FETCH_TIMEOUT_MS);
    if (failed !== null) return { state: "unchecked", reason: failed };
  }
  const behind = count(dir, "HEAD..@{upstream}", plain);
  if ("error" in behind) return { state: "unchecked", reason: behind.error };
  const ahead = count(dir, "@{upstream}..HEAD", plain);
  return { state: "checked", upstream: upstream.out, behind: behind.n, ahead: "n" in ahead ? ahead.n : 0 };
}

function plural(n: number, noun: string): string {
  return `${String(n)} ${noun}${n === 1 ? "" : "s"}`;
}

/** `checkout of acme is 3 commits behind origin/main`, with the ahead count when diverged. Null when not behind. */
export function behindLine(project: string, check: BehindCheck): string | null {
  if (check.state !== "checked" || check.behind === 0) return null;
  const ahead = check.ahead > 0 ? `, and ${String(check.ahead)} ahead` : "";
  return `checkout of ${project} is ${plural(check.behind, "commit")} behind ${check.upstream}${ahead}`;
}

// --- the record run-due leaves for doctor ------------------------------------------

/** What run-due recorded about one project's checkout, the last time a due ritual made it check. */
export interface BehindRecord {
  at: string;
  checkout: string;
  check: BehindCheck;
}

function recordFile(project: Project): string {
  return join(project.root, RECORD_FILE);
}

/** Writes `behind.json` in the project's local store dir. Never synced. */
export function writeBehindRecord(project: Project, record: BehindRecord): void {
  const file = recordFile(project);
  const temp = `${file}.tmp-${String(process.pid)}`;
  writeFileSync(temp, `${JSON.stringify({ v: 1, ...record })}\n`);
  renameSync(temp, file);
}

function isJsonRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isJsonCount(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function decodeCheck(value: JsonValue | undefined): BehindCheck | null {
  if (!isJsonRecord(value)) return null;
  if (value.state === "unchecked" && isJsonText(value.reason)) return { state: "unchecked", reason: value.reason };
  const { upstream, behind, ahead } = value;
  if (value.state !== "checked" || !isJsonText(upstream) || !isJsonCount(behind) || !isJsonCount(ahead)) return null;
  return { state: "checked", upstream, behind, ahead };
}

/** The last record, or null when there is none or it does not read. */
export function readBehindRecord(project: Project): BehindRecord | null {
  const file = recordFile(project);
  if (!existsSync(file)) return null;
  try {
    const parsed: JsonValue = JSON.parse(readFileSync(file, "utf8"));
    if (!isJsonRecord(parsed) || !isJsonText(parsed.at) || !isJsonText(parsed.checkout)) return null;
    const check = decodeCheck(parsed.check);
    return check === null ? null : { at: parsed.at, checkout: parsed.checkout, check };
  } catch {
    return null;
  }
}

/** What `darius doctor` says about the record: one line, or none without a record. */
export function behindDoctorLine(project: string, record: BehindRecord | null): string | null {
  if (record === null) return null;
  const when = `(run-due, ${record.at})`;
  const { check } = record;
  if (check.state === "unchecked") return `NOTE: run-due could not check whether the checkout of ${project} is behind: ${check.reason} ${when}`;
  const line = behindLine(project, check);
  if (line !== null) return `WARN: ${line} ${when}. Pull it, so the timer runs the current .darius.toml.`;
  return `checkout of ${project} was up to date with ${check.upstream} ${when}`;
}
