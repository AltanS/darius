/**
 * The state vocabulary: one table of words and tones, used by every row, chip,
 * page head and strip. A state says HOW an item is doing; its colour is one
 * of the state tones (ok, wait, bad, run, late, idle, gold), never a kind
 * colour. A date in the future is the date phrase, in the quiet tone.
 */

import type { RitualRow, RunRow, VigilRow } from "../../../src/web/api.ts";
import { dayGap, dayName, shortDate } from "./format.ts";
import type { Badge, Tone } from "./tone.ts";

/** Days ahead that read as a weekday date ("Fri 2 Oct"); a later date reads "15 Nov". */
const WEEKDAY_DAYS = 14;

export const RUNNING: Badge = { tone: "run", label: "Running" };
export const WAITING_FOR_YOU: Badge = { tone: "wait", label: "Waiting for you" };
export const ASKS_YOU: Badge = { tone: "wait", label: "Asks you" };
export const FAILED: Badge = { tone: "bad", label: "Failed" };
export const FAILED_SEEN: Badge = { tone: "idle", label: "Failed, seen" };
export const ABANDONED: Badge = { tone: "idle", label: "Abandoned" };
export const COMPLETE: Badge = { tone: "ok", label: "Complete" };
export const DUE_TODAY: Badge = { tone: "gold", label: "Due today" };
export const FLAGGED: Badge = { tone: "bad", label: "Flagged" };

/** "1 day late", "13 days late". */
export function lateWord(days: number): Badge {
  return { tone: "late", label: `${days} day${days === 1 ? "" : "s"} late` };
}

/** "tomorrow", "Fri 2 Oct" within two weeks, "15 Nov" later; "today" for today. */
export function datePhrase(today: string, date: string): string {
  const gap = dayGap(today, date);
  if (gap <= 0) return "today";
  if (gap === 1) return "tomorrow";
  return gap <= WEEKDAY_DAYS ? dayName(`${date}T00:00:00Z`, 0) : shortDate(date);
}

/** The state of a ritual or vigil by its date: late, due today, or the date phrase. Null without a date. */
export function dateState(today: string, date: string | null): Badge | null {
  if (date === null) return null;
  const gap = dayGap(today, date);
  if (gap < 0) return lateWord(-gap);
  if (gap === 0) return DUE_TODAY;
  return { tone: "idle", label: datePhrase(today, date) };
}

/** A closed run's state from its outcome; other outcomes are the outcome in words, quiet. */
function closedWord(outcome: string | null): Badge {
  if (outcome === "failed") return FAILED;
  if (outcome === "abandoned") return ABANDONED;
  if (outcome === null) return { tone: "idle", label: "Closed" };
  return { tone: "idle", label: outcome.charAt(0).toUpperCase() + outcome.slice(1) };
}

/**
 * How a run ended, in words and a tone. A failure a person acknowledged
 * (`darius run ack`) is quiet everywhere: "Failed, seen" in grey. A complete
 * run that asks a question is not "Complete" until someone answered it.
 */
export function runWord(run: RunRow, asksYou: boolean): Badge {
  if (run.phase === "held") return WAITING_FOR_YOU;
  if (run.phase === "running") return RUNNING;
  if (asksYou) return ASKS_YOU;
  if (run.outcome === "complete") return COMPLETE;
  const word = closedWord(run.outcome);
  return run.acknowledged !== null && word === FAILED ? FAILED_SEEN : word;
}

/** The state of a ritual: waiting, running, late, due today, or when it is next due. */
export function ritualWord(ritual: RitualRow, today: string): Badge {
  if (ritual.heldRun !== null) return WAITING_FOR_YOU;
  if (ritual.openRun !== null) return RUNNING;
  if (ritual.lifecycle !== "active") return { tone: "idle", label: ritual.lifecycle.charAt(0).toUpperCase() + ritual.lifecycle.slice(1) };
  if (ritual.overdueDays > 0) return lateWord(ritual.overdueDays);
  if (ritual.nextDue === null) return { tone: "idle", label: "No schedule" };
  return dateState(today, ritual.nextDue) ?? { tone: "idle", label: "No schedule" };
}

/** The state of a vigil: its verdict when closed, flagged, or nothing (an armed vigil is just armed). */
export function vigilWord(vigil: VigilRow): Badge | null {
  if (vigil.state === "closed") return vigil.verdict === "failed" ? FAILED : { tone: "ok", label: vigil.verdict === null ? "Closed" : vigil.verdict.charAt(0).toUpperCase() + vigil.verdict.slice(1) };
  return vigil.flagged ? FLAGGED : null;
}

/** The tones a rail at a row's left edge can have; a plain row has none. */
export type Rail = Exclude<Tone, "ok" | "idle" | "gold">;

/** The rail of a state: only a state that needs attention draws one (late, running, waiting, asks, failed, flagged). */
export function railOf(state: Badge | null): Rail | null {
  return state === null || state.tone === "idle" || state.tone === "ok" || state.tone === "gold" ? null : state.tone;
}
