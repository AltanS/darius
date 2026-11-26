/**
 * One health word per workspace (0.140.0), from facts the status and the
 * ledger already hold. Pure: no store, no clock. The first rule that
 * matches wins:
 *
 *   Unreadable  the store or the marker cannot be read.
 *   Failing     a lit candle of severity high or critical, a flagged vigil,
 *               or an active ritual whose last two runs failed.
 *   Needs you   a lit candle below high, a finding that needs a decision, a
 *               held run, a ritual late, a vigil due or late, an active
 *               ritual whose last run failed once, a stale copy (this host
 *               last synced it over 45 min ago), a tree conflict, or a
 *               ritual that cannot start here (box broken, checkout behind).
 *   Quiet       no ledger line in 14 days (version, alert and sync lines do
 *               not count) and nothing active: no active ritual, no open vigil.
 *   OK          none of the above.
 *
 * The reasons are short counted phrases, worst first, so the word never
 * stands alone.
 */

import type { WorkspaceHealth } from "./api.ts";

export const QUIET_AFTER_MS = 14 * 24 * 3_600_000;
export const STALE_COPY_MS = 45 * 60_000;

/** The run outcomes that count as a failure: the same words the web app colours red. */
export const FAILED_OUTCOMES: ReadonlySet<string> = new Set(["failed", "refused", "error", "box-broken", "gate-broken", "harness-unchecked", "profile-invalid", "subagents-unproven", "tool-missing"]);

export function isFailedOutcome(outcome: string | null): boolean {
  return outcome !== null && FAILED_OUTCOMES.has(outcome);
}

export interface HealthFacts {
  /** Why the store or the marker could not be read; null when it reads. */
  error: string | null;
  candlesHigh: number;
  candlesLow: number;
  vigilsFlagged: number;
  vigilsDue: number;
  /** Active rituals whose last two closed runs failed. */
  ritualsFailing: number;
  /** Active rituals whose last closed run failed, and the one before did not. */
  ritualsFailedOnce: number;
  ritualsLate: number;
  runsHeld: number;
  findingsNeedYou: number;
  activeRituals: number;
  openVigils: number;
  /** The newest ledger line that is not a version, alert or sync line. */
  lastActivity: string | null;
  /** This host holds only a copy: its last sync of it, for the stale copy rule. Undefined for a checkout. */
  copySyncedAt?: string | null;
  treeConflicts: number;
  /** Why a ritual cannot start here: `box-broken`, `checkout-behind`. */
  cannotStart: readonly string[];
}

export interface HealthVerdict {
  health: WorkspaceHealth;
  reasons: string[];
}

function counted(count: number, one: string, many: string): string[] {
  if (count <= 0) return [];
  return [`${String(count)} ${count === 1 ? one : many}`];
}

function isStaleCopy(facts: HealthFacts, now: number): boolean {
  if (facts.copySyncedAt === undefined) return false;
  if (facts.copySyncedAt === null) return true;
  const at = Date.parse(facts.copySyncedAt);
  return Number.isNaN(at) || now - at > STALE_COPY_MS;
}

function failingReasons(facts: HealthFacts): string[] {
  return [
    ...counted(facts.candlesHigh, "high candle lit", "high candles lit"),
    ...counted(facts.vigilsFlagged, "vigil flagged", "vigils flagged"),
    ...counted(facts.ritualsFailing, "ritual failed twice", "rituals failed twice"),
  ];
}

const CANNOT_START_WORDS = new Map([
  ["box-broken", "box broken here"],
  ["checkout-behind", "checkout behind"],
]);

function needsReasons(facts: HealthFacts, now: number): string[] {
  return [
    ...counted(facts.ritualsFailedOnce, "run failed", "runs failed"),
    ...counted(facts.runsHeld, "run waits for your answer", "runs wait for your answer"),
    ...counted(facts.candlesLow, "candle lit", "candles lit"),
    ...counted(facts.findingsNeedYou, "open finding", "open findings"),
    ...counted(facts.ritualsLate, "ritual late", "rituals late"),
    ...counted(facts.vigilsDue, "vigil due", "vigils due"),
    ...counted(facts.treeConflicts, "tree conflict", "tree conflicts"),
    ...[...new Set(facts.cannotStart)].map((reason) => CANNOT_START_WORDS.get(reason) ?? reason),
    ...(isStaleCopy(facts, now) ? ["copy not synced in 45 min"] : []),
  ];
}

/** The health word of a workspace and its reasons. `now` is the time of the read. */
export function healthOf(facts: HealthFacts, now: number): HealthVerdict {
  if (facts.error !== null) return { health: "unreadable", reasons: ["store unreadable"] };
  const failing = failingReasons(facts);
  const needs = needsReasons(facts, now);
  if (failing.length > 0) return { health: "failing", reasons: [...failing, ...needs] };
  if (needs.length > 0) return { health: "needs-you", reasons: needs };
  const last = facts.lastActivity === null ? Number.NaN : Date.parse(facts.lastActivity);
  const idle = Number.isNaN(last) || now - last > QUIET_AFTER_MS;
  if (idle && facts.activeRituals === 0 && facts.openVigils === 0) return { health: "quiet", reasons: [facts.lastActivity === null ? "no activity yet" : "no activity in 14 days"] };
  return { health: "ok", reasons: [] };
}

/** The order of the fleet table: the rule order, Quiet last. */
export const HEALTH_ORDER = { unreadable: 0, failing: 1, "needs-you": 2, ok: 3, quiet: 4 } as const satisfies Record<WorkspaceHealth, number>;
