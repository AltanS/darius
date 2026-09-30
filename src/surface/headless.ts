/**
 * The headless surface: the harness as a background child process
 * (docs/concept.md, "Harnesses, profiles and surfaces" > "Surfaces"). It runs
 * in its own process group; on timeout the group gets SIGTERM, then SIGKILL
 * 5 s later. Nothing here knows which harness it runs.
 */

import { spawn } from "node:child_process";

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

interface ChildEnd {
  code: number | null;
  signal: string | null;
}

/** Runs the harness to exit or timeout. Never throws: a spawn failure comes back as `spawnError`. */
export async function launchHeadless(plan: LaunchPlan): Promise<LaunchResult> {
  const started = Date.now();
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let spawnError: string | undefined;
  const child = spawn(plan.bin, plan.argv, {
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
      spawnError = errorMessage(cause);
      if (child.pid === undefined) resolve({ code: null, signal: null });
    });
  });
  const end = await Promise.race([closed, failedToStart]);
  clearTimeout(killTimer);
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
