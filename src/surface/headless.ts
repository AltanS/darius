/**
 * The headless surface: the harness as a background child process
 * (docs/concept.md, "Harnesses, profiles and surfaces" > "Surfaces"). It runs
 * in its own process group; on timeout the group gets SIGTERM, then SIGKILL
 * 5 s later. Nothing here knows which harness it runs.
 *
 * A masked launch (src/core/sandbox.ts) puts bwrap in front. bwrap stays as the
 * group leader and the harness shares its group, so the group signal still
 * reaches every process. bwrap dies of the SIGTERM, and `--die-with-parent`
 * then kills the harness with SIGKILL, so the harness gets no grace time. Its
 * children get the SIGTERM, and the SIGKILL 5 s later. An exit code passes
 * through; a harness killed by a signal reads as exit 128 + the signal.
 */

import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

import { errorMessage } from "../runtime.ts";

/** The environment handed to the harness child: every variable a plain string. */
export interface ChildEnv {
  [name: string]: string;
}

export interface LaunchPlan {
  bin: string;
  argv: string[];
  cwd: string;
  env: ChildEnv;
  timeoutMs: number;
  /** The argv of the sandbox to run the harness in (src/core/sandbox.ts), when it is masked. */
  sandbox?: readonly string[] | undefined;
}

export interface LaunchResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderrTail: string;
  spawnError?: string;
}

const KILL_GRACE_MS = 5_000;
const GROUP_POLL_MS = 100;
const STDOUT_CAP = 1_048_576;
const STDERR_TAIL = 8_192;

function signalGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch {
    // The group is already gone.
  }
}

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Waits for what is left of a timed-out group until `deadline`, then kills it.
 * The leader can end long before the grace time: a child that ignores SIGTERM
 * and holds no pipe lets "close" fire, and darius may exit right after, so the
 * timer's SIGKILL alone would never come.
 */
async function endGroup(pid: number | undefined, deadline: number): Promise<void> {
  if (pid === undefined) return;
  while (groupAlive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => {
      setTimeout(resolve, GROUP_POLL_MS);
    });
  }
  signalGroup(pid, "SIGKILL");
}

/** The spawn failure as one line that names the fix when the program is missing. */
export function spawnFailure(bin: string, cause: unknown): string {
  const message = errorMessage(cause);
  if (!message.includes("ENOENT")) return message;
  const name = bin.split("/").pop() ?? bin;
  return `${name} is not on PATH: install ${name === "claude" ? "Claude Code" : name} or set the profile's command`;
}

interface ChildEnd {
  code: number | null;
  signal: string | null;
}

function isProgram(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** True when the program would start with this env. bwrap would hide a missing one behind its own exit code. */
function canStart(bin: string, env: ChildEnv): boolean {
  if (bin.includes("/")) return isProgram(bin);
  return (env.PATH ?? "").split(delimiter).some((dir) => isProgram(join(dir, bin)));
}

/** The program and its arguments, program first. A harness that cannot start spawns bare, so the failure reads as it always did. */
function launchLine(plan: LaunchPlan): string[] {
  if (plan.sandbox === undefined || !canStart(plan.bin, plan.env)) return [plan.bin, ...plan.argv];
  return [...plan.sandbox, plan.bin, ...plan.argv];
}

/** Runs the harness to exit or timeout. Never throws: a spawn failure comes back as `spawnError`. */
export async function launchHeadless(plan: LaunchPlan): Promise<LaunchResult> {
  const started = Date.now();
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let spawnError: string | undefined;
  const [program = plan.bin, ...args] = launchLine(plan);
  const child = spawn(program, args, {
    cwd: plan.cwd,
    env: plan.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    if (stdout.length < STDOUT_CAP) stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-STDERR_TAIL);
  });
  const killTimer = setTimeout(() => {
    timedOut = true;
    signalGroup(child.pid, "SIGTERM");
    setTimeout(() => signalGroup(child.pid, "SIGKILL"), KILL_GRACE_MS).unref();
  }, plan.timeoutMs);
  const closed = new Promise<ChildEnd>((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  // No pid: the process never started, and "close" is not guaranteed to follow.
  const failedToStart = new Promise<ChildEnd>((resolve) => {
    child.on("error", (cause) => {
      spawnError = spawnFailure(plan.bin, cause);
      if (child.pid === undefined) resolve({ code: null, signal: null });
    });
  });
  const end = await Promise.race([closed, failedToStart]);
  clearTimeout(killTimer);
  if (timedOut) await endGroup(child.pid, started + plan.timeoutMs + KILL_GRACE_MS);
  const result: LaunchResult = {
    exitCode: end.code,
    signal: end.signal,
    timedOut,
    durationMs: Date.now() - started,
    stdout,
    stderrTail: stderr,
  };
  if (spawnError !== undefined) result.spawnError = spawnError;
  return result;
}
