/**
 * What the two attended surfaces share (0.133.0): the herdr tab
 * (src/surface/herdr.ts) and the hc terminal (src/surface/hc.ts). The agent
 * name of a launch, the gate log sign that a prompt landed, and the rule that
 * removes a finished run's tab or terminal. herdr's behaviour is unchanged:
 * these lines moved here from herdr.ts as they were.
 */

import { existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

/** How often an attended surface looks at the ledger and the agent. */
export const DEFAULT_POLL_MS = 3_000;
/** How long an agent may wait for input before the run is held with a question. */
export const DEFAULT_WAIT_GRACE_MS = 10 * 60_000;
/** How long one sent prompt is watched for a sign that it landed. */
export const DEFAULT_CONFIRM_MS = 30_000;
/** An agent that stays idle this long after a send, with no other sign, did not get the prompt. */
export const DEFAULT_IDLE_RESEND_MS = 20_000;
/** A prompt that did not land is sent again at most this many times. */
export const MAX_RESENDS = 2;

/** The longest herdr agent name, and the longest hc terminal name (1-32 of a-z 0-9 - _). */
const AGENT_NAME_MAX = 32;

/**
 * An agent name for one launch of a run: lowercase, starts with a letter, at
 * most 32 characters. The first launch is `d-<run>`; a later one adds
 * `-r<launch>`, and the run part is cut to make room, never the suffix. A
 * run id is a ULID (letters and digits), so the name fits hc's rule too.
 */
export function agentName(run: string, launch = 1): string {
  const suffix = launch <= 1 ? "" : `-r${String(launch)}`;
  return `d-${run.toLowerCase()}`.slice(0, AGENT_NAME_MAX - suffix.length) + suffix;
}

/** The size of the run's gate log; it grows when a tool call reaches the hook, so the agent got its prompt. */
export function gateLogSize(runDir: string): number {
  const file = join(runDir, "gate.jsonl");
  return existsSync(file) ? statSync(file).size : 0;
}

export function showMs(ms: number): string {
  return ms >= 1_000 ? `${String(Math.round(ms / 1_000))} s` : `${String(ms)} ms`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** How long a finished run's tab stays when its ritual does not run again. */
export const TAB_KEEP_MS = 48 * 60 * 60 * 1000;

/** What the cleanup needs to know about one run, read from the ledger. */
export interface TabRun {
  run: string;
  /** The ledger item, `ritual/<slug>`: runs of one ritual share it. */
  item: string;
  phase: "running" | "held" | "closed";
  /** ISO time of the run.started line. */
  startedAt: string;
  /** ISO time of the run.completed line; a closed run without it counts as old. */
  endedAt?: string;
}

/** True when the finished run's tab is due to close: a newer run of its ritual exists, or it ended over 48 hours ago. */
export function isTabDue(run: TabRun, all: readonly TabRun[], now: number): boolean {
  if (run.phase !== "closed") return false;
  if (all.some((other) => other.item === run.item && other.run !== run.run && other.startedAt > run.startedAt)) return true;
  const endedMs = run.endedAt === undefined ? Number.NaN : Date.parse(run.endedAt);
  return Number.isNaN(endedMs) || now - endedMs > TAB_KEEP_MS;
}

/** One surface's record of a run's tabs or terminals, and how to close them. */
export interface DueCleanup {
  /** The record's file name in the run dir: `herdr.json`, `hc.json`. */
  file: string;
  /** Closes what the record in `runDir` names; returns how many closed. Best effort, never throws. */
  close(runDir: string): Promise<number>;
}

/**
 * Closes what every finished run in `runsDir` that isTabDue recorded, and
 * removes the record. A running or held run keeps its tab or terminal.
 */
export async function closeDueRuns(runsDir: string, runs: readonly TabRun[], now: number, cleanup: DueCleanup): Promise<number> {
  let closed = 0;
  for (const run of runs) {
    const runDir = join(runsDir, run.run);
    const file = join(runDir, cleanup.file);
    if (!existsSync(file) || !isTabDue(run, runs, now)) continue;
    closed += await cleanup.close(runDir);
    rmSync(file, { force: true });
  }
  return closed;
}
