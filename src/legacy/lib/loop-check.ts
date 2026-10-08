/**
 * Loop check — deterministic verdict on "is a Work Loop mid-flight?".
 *
 * Decision engine behind the Stop / SubagentStop exit gate (`darius hook-stop`).
 * A thread is PRE-TERMINAL iff it is open and its stage is planned,
 * dispatched, verified, or committed with a 0.72.0 stamp. `reviewed`,
 * closed and parked threads are terminal; so is a `committed` thread with no
 * stamp (written before 0.72.0). Stage-less threads are exempt.
 *
 * Every legal mid-loop pause (commit_first, counsel blocked/needs_ack/
 * exhausted) occurs in work-plan BEFORE the worklog thread is opened, so
 * "open thread in pre-terminal stage" ⇒ drift, not a legal pause.
 *
 * Gate mode (since 0.72.0): given the stopping session, the gate blocks only
 * on pre-terminal threads that session owns. Threads owned by another session
 * or by none go to `others`, a notice that never blocks. The bounce budget is
 * per thread: each thread may block at most `maxBounces` times per 24 h. A
 * thread over budget goes to `exhausted` (a notice); the others still block.
 * State lives in .tracker/.loop-bounces.json as `thread:<id>` keys; entries of
 * the old per-session shape are ignored and dropped.
 *
 * Query mode (no session): every pre-terminal thread is listed, no state.
 *
 * The gate FAILS OPEN: any internal error yields `clean`.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { latestStamp, listThreads, type ThreadSummary, type WorklogStage } from "./worklog.ts";
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
  /** Owning session, when the thread records one (0.72.0). */
  session?: string;
  /** Times this thread has blocked a stop in the last 24 h (gate mode, 0.72.0). */
  bounces?: number;
};

export type LoopCheckResult = {
  status: LoopCheckStatus;
  /** Gate mode: the threads that block (or, when exhausted, the ones over budget). Query mode: all pre-terminal threads. */
  threads: StuckThread[];
  /** Highest bounce count among `threads`, present only in gate mode. */
  bounces?: number;
  maxBounces?: number;
  /** Gate mode: pre-terminal threads owned by another session or by none (0.72.0). */
  others?: StuckThread[];
  /** Gate mode: own threads over their bounce budget, when others still block (0.72.0). */
  exhausted?: StuckThread[];
};

export type LoopCheckOpts = {
  trackerRoot: string;
  /** The stopping session: enables gate mode (owner filter and budget). */
  session?: string;
  /**
   * Older name for `session`, from the `--bounce <id>` flag. Used only when
   * `session` is absent.
   */
  bounceId?: string;
  /** Blocks allowed per thread before the gate gives up on it (default 2). */
  maxBounces?: number;
  /** Injectable clock for tests. */
  now?: Date;
};

const DEFAULT_MAX_BOUNCES = 2;
const BOUNCE_TTL_MS = 24 * 60 * 60 * 1000;
const BOUNCE_KEY_PREFIX = "thread:";

type BounceFile = Record<string, { count: number; updatedAt: string }>;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Is this open thread still mid-loop? Exported for tests and other gates. */
export function isPreTerminal(t: Pick<ThreadSummary, "stage" | "closedAt" | "stamps">): boolean {
  if (t.closedAt) return false;
  switch (t.stage) {
    case "planned":
    case "dispatched":
    case "verified":
      return true;
    case "committed":
      // A committed stamp means 0.72.0 wrote it: the review is still owed.
      // No stamp: written before 0.72.0, terminal as it was then.
      return latestStamp(t, "committed") !== undefined;
    case "reviewed":
    case undefined:
      return false;
  }
}

export function runLoopCheck(opts: LoopCheckOpts): LoopCheckResult {
  const { trackerRoot } = opts;
  const session = opts.session ?? opts.bounceId;
  const maxBounces = opts.maxBounces ?? DEFAULT_MAX_BOUNCES;
  const now = opts.now ?? new Date();

  let stuck: StuckThread[];
  try {
    stuck = findStuckThreads(trackerRoot);
  } catch {
    // Unreadable worklog dir — fail open.
    return { status: "clean", threads: [] };
  }

  if (session === undefined || session === "") {
    return {
      status: stuck.length > 0 ? "stuck" : "clean",
      threads: stuck,
    };
  }

  const own = stuck.filter((t) => t.session === session);
  const others = stuck.filter((t) => t.session !== session);

  const bouncePath = join(trackerRoot, ".loop-bounces.json");
  const stuckIds = new Set(stuck.map((t) => t.threadId));
  const bounces: BounceFile = {};
  for (const [key, value] of Object.entries(pruneBounces(readBounceFile(bouncePath), now))) {
    // Old per-session keys are dropped; a thread that left the loop resets.
    if (key.startsWith(BOUNCE_KEY_PREFIX) && stuckIds.has(key.slice(BOUNCE_KEY_PREFIX.length))) {
      bounces[key] = value;
    }
  }

  const blocking: StuckThread[] = [];
  const exhausted: StuckThread[] = [];
  for (const t of own) {
    const key = `${BOUNCE_KEY_PREFIX}${t.threadId}`;
    const prev = bounces[key]?.count ?? 0;
    if (prev >= maxBounces) {
      exhausted.push({ ...t, bounces: prev });
      continue;
    }
    bounces[key] = { count: prev + 1, updatedAt: now.toISOString() };
    blocking.push({ ...t, bounces: prev + 1 });
  }
  writeBounceFile(bouncePath, bounces);

  const extras: Pick<LoopCheckResult, "others" | "exhausted"> = {};
  if (others.length > 0) extras.others = others;

  if (blocking.length > 0) {
    if (exhausted.length > 0) extras.exhausted = exhausted;
    const top = Math.max(...blocking.map((t) => t.bounces ?? 0));
    return { status: "stuck", threads: blocking, bounces: top, maxBounces, ...extras };
  }
  if (exhausted.length > 0) {
    const top = Math.max(...exhausted.map((t) => t.bounces ?? 0));
    return { status: "exhausted", threads: exhausted, bounces: top, maxBounces, ...extras };
  }
  return { status: "clean", threads: [], ...extras };
}

function formatThread(lines: string[], t: StuckThread, withNext: boolean): void {
  const spec = t.specPath ? `  SPEC: ${t.specPath}` : "";
  const owner = t.session ? `  SESSION: ${t.session}` : "";
  const bounces = t.bounces !== undefined ? `  BOUNCES: ${String(t.bounces)}` : "";
  lines.push(`  - THREAD: ${t.threadId}  STAGE: ${t.stage}${spec}${owner}${bounces}`);
  if (withNext) lines.push(`    NEXT: ${t.next}`);
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
    for (const t of result.threads) formatThread(lines, t, true);
  }

  if (result.exhausted && result.exhausted.length > 0) {
    lines.push("OVER BUDGET (not blocking):");
    for (const t of result.exhausted) formatThread(lines, t, true);
  }

  const notice = formatOthersNotice(result);
  if (notice !== null) lines.push(notice);

  return lines.join("\n");
}

/** One line naming the pre-terminal threads this session does not own, or null. */
export function formatOthersNotice(result: LoopCheckResult): string | null {
  const others = result.others ?? [];
  if (others.length === 0) return null;
  const items = others.map((t) => `${t.threadId} (${t.stage}, ${t.session ? `session ${t.session}` : "no session"})`);
  return `NOTICE: open threads of other sessions, not blocking: ${items.join(", ")}`;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function findStuckThreads(trackerRoot: string): StuckThread[] {
  const threads = listThreads({ trackerRoot, activeOnly: true });
  const stuck: StuckThread[] = [];

  for (const t of threads) {
    if (t.stage === undefined || !isPreTerminal(t)) continue;
    const entry: StuckThread = {
      threadId: t.threadId,
      stage: t.stage,
      specPath: t.specPath,
      next: nextAction(t.threadId, t.stage),
    };
    if (t.session) entry.session = t.session;
    stuck.push(entry);
  }

  return stuck;
}

function nextAction(threadId: string, stage: WorklogStage): string {
  const park = `or park: \`darius worklog park ${threadId} --reason "…"\``;
  switch (stage) {
    case "planned":
      return (
        `Stage 2 (dispatch): \`darius worklog dispatch ${threadId} --agent <invocable> --reason "…"\` ` +
        `then Task-delegate per the Delegation Envelope; ${park}`
      );
    case "dispatched":
      return `Stage 3 (verify): collect the Task result and run /darius-work-verify for thread ${threadId}; ${park}`;
    case "verified":
      return `Stage 4 (commit): run /darius-commit. Verified work is a debt; close it before stopping`;
    case "committed":
      return (
        `Stage 5 (review): review the commit, write a note that starts with "Review:" ` +
        `(\`darius worklog append ${threadId} --section note --message "Review: …"\`), ` +
        `then \`darius worklog set-stage ${threadId} reviewed\`; ${park}`
      );
    case "reviewed":
      // Not reachable (reviewed is terminal); exhaustive for the type.
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
