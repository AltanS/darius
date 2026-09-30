/**
 * Loop check — deterministic verdict on "is a Work Loop mid-flight?".
 *
 * Decision engine behind the SubagentStop exit gate (lib/loop-gate.sh).
 * A thread is STUCK iff it is open and its stage is pre-terminal
 * (planned | dispatched | verified). `committed` is terminal for gating;
 * stage-less threads (legacy / non-loop) and closed threads are exempt.
 *
 * Every legal mid-loop pause (commit_first, counsel blocked/needs_ack/
 * exhausted) occurs in work-plan BEFORE the worklog thread is opened, so
 * "open thread in pre-terminal stage" ⇒ drift, not a legal pause.
 *
 * Bounce budget: the gate may block a stop at most `maxBounces` times per
 * agent invocation (keyed on the SubagentStop `agent_id`). After that the
 * stop is allowed (status `exhausted`) so a confused session never
 * ping-pongs forever. State lives in .tracker/.loop-bounces.json and
 * self-prunes after 24h.
 *
 * The gate FAILS OPEN: any internal error yields `clean`.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { listThreads, type WorklogStage } from "./worklog.ts";
import { atomicWriteFileSync } from "./atomic.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LoopCheckStatus = "clean" | "stuck" | "exhausted";

export type StuckThread = {
  threadId: string;
  stage: WorklogStage;
  specPath?: string;
  next: string;
};

export type LoopCheckResult = {
  status: LoopCheckStatus;
  threads: StuckThread[];
  /** Bounce count for the given agent id, present only when bounceId was supplied. */
  bounces?: number;
  maxBounces?: number;
};

export type LoopCheckOpts = {
  trackerRoot: string;
  /** SubagentStop agent_id — enables the bounce budget. Omit for pure query mode. */
  bounceId?: string;
  /** Blocks allowed before the gate gives up (default 2). */
  maxBounces?: number;
  /** Injectable clock for tests. */
  now?: Date;
};

const DEFAULT_MAX_BOUNCES = 2;
const BOUNCE_TTL_MS = 24 * 60 * 60 * 1000;
const PRE_TERMINAL_STAGES: readonly WorklogStage[] = ["planned", "dispatched", "verified"];

type BounceFile = Record<string, { count: number; updatedAt: string }>;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function runLoopCheck(opts: LoopCheckOpts): LoopCheckResult {
  const { trackerRoot, bounceId } = opts;
  const maxBounces = opts.maxBounces ?? DEFAULT_MAX_BOUNCES;
  const now = opts.now ?? new Date();

  let stuck: StuckThread[];
  try {
    stuck = findStuckThreads(trackerRoot);
  } catch {
    // Unreadable worklog dir — fail open.
    return { status: "clean", threads: [] };
  }

  if (!bounceId) {
    return {
      status: stuck.length > 0 ? "stuck" : "clean",
      threads: stuck,
    };
  }

  const bouncePath = join(trackerRoot, ".loop-bounces.json");
  let bounces = readBounceFile(bouncePath);
  bounces = pruneBounces(bounces, now);

  if (stuck.length === 0) {
    // Loop completed — clear this invocation's entry so the file self-cleans.
    delete bounces[bounceId];
    writeBounceFile(bouncePath, bounces);
    return { status: "clean", threads: [] };
  }

  const count = (bounces[bounceId]?.count ?? 0) + 1;
  bounces[bounceId] = { count, updatedAt: now.toISOString() };
  writeBounceFile(bouncePath, bounces);

  if (count > maxBounces) {
    return { status: "exhausted", threads: stuck, bounces: count, maxBounces };
  }

  return { status: "stuck", threads: stuck, bounces: count, maxBounces };
}

/**
 * Render the human-readable report. The NEXT lines double as the block
 * reason fed back to darius — they must be self-explanatory instructions.
 */
export function formatLoopCheckReport(result: LoopCheckResult): string {
  const lines: string[] = [`STATUS: ${result.status}`];

  if (result.bounces !== undefined) {
    lines.push(`BOUNCES: ${result.bounces}/${result.maxBounces}`);
  }

  if (result.threads.length > 0) {
    lines.push("THREADS:");
    for (const t of result.threads) {
      const spec = t.specPath ? `  SPEC: ${t.specPath}` : "";
      lines.push(`  - THREAD: ${t.threadId}  STAGE: ${t.stage}${spec}`);
      lines.push(`    NEXT: ${t.next}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function findStuckThreads(trackerRoot: string): StuckThread[] {
  const threads = listThreads({ trackerRoot, activeOnly: true });
  const stuck: StuckThread[] = [];

  for (const t of threads) {
    if (t.stage === undefined) continue;
    if (!PRE_TERMINAL_STAGES.includes(t.stage as WorklogStage)) continue;

    stuck.push({
      threadId: t.threadId,
      stage: t.stage as WorklogStage,
      specPath: t.specPath,
      next: nextAction(t.threadId, t.stage as WorklogStage),
    });
  }

  return stuck;
}

function nextAction(threadId: string, stage: WorklogStage): string {
  switch (stage) {
    case "planned":
      return (
        `Stage 2 — dispatch: \`tracker worklog dispatch ${threadId} --agent <invocable> --reason "…"\` ` +
        `then Task-delegate per the Delegation Envelope; or park: \`tracker worklog park ${threadId} --reason "…"\``
      );
    case "dispatched":
      return (
        `Stage 3 — collect the Task result and run /tracker:work-verify for thread ${threadId}; ` +
        `or park: \`tracker worklog park ${threadId} --reason "…"\``
      );
    case "verified":
      return `Stage 4 — run /tracker:commit — verified work is a debt; close it before stopping`;
    case "committed":
      // Not reachable (committed is terminal for gating); exhaustive for the type.
      return "";
  }
}

function readBounceFile(path: string): BounceFile {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const result: BounceFile = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        typeof value === "object" &&
        value !== null &&
        typeof (value as { count?: unknown }).count === "number" &&
        typeof (value as { updatedAt?: unknown }).updatedAt === "string"
      ) {
        result[key] = value as { count: number; updatedAt: string };
      }
    }
    return result;
  } catch {
    // Corrupt state — fail open with a fresh ledger.
    return {};
  }
}

function pruneBounces(bounces: BounceFile, now: Date): BounceFile {
  const pruned: BounceFile = {};
  for (const [key, value] of Object.entries(bounces)) {
    const age = now.getTime() - Date.parse(value.updatedAt);
    if (Number.isFinite(age) && age < BOUNCE_TTL_MS) {
      pruned[key] = value;
    }
  }
  return pruned;
}

function writeBounceFile(path: string, bounces: BounceFile): void {
  try {
    atomicWriteFileSync(path, JSON.stringify(bounces, null, 2) + "\n");
  } catch {
    // Unwritable state file must not break the gate.
  }
}
