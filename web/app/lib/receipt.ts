/**
 * The sentence of a receipt (0.90.0): what was done, by whom, when and what
 * happens next, written from the activity entry (`src/web/activity.ts`) or
 * the pending start (`src/web/pending.ts`) alone. Nothing here reads client
 * state, so a reload shows the same words. Pure: the Overview builds the
 * facts, this file builds the text.
 */

import type { ActivityEntry, PendingStart } from "../../../src/web/api.ts";
import { clockTime, shortRun } from "./format.ts";

/** The host clock a receipt reads its times on. */
export interface ReceiptClock {
  offset: number;
}

/** What the Overview knows around an entry. Every field is optional by being null. */
export interface ReceiptFacts {
  /** When the next run of the ritual starts, in words; null for a ritual with no cadence. */
  nextRun: string | null;
  /** How the run of a follow-up is doing now, and where. */
  follow: { state: "running" | "held" | "done" | "failed"; host: string | null; changed: number } | null;
  /** The run that took the answers: `isNow` when it started by the same hand right after the answer. */
  readBy: { run: string; isNow: boolean } | null;
}

export const NO_FACTS: ReceiptFacts = { nextRun: null, follow: null, readBy: null };

/** "Answered by web:altan" -> "Answered by web:altan at 09:12": the time goes after the name. */
function withTime(entry: ActivityEntry, time: string): string {
  // A run id is 26 characters: a phone shows the last eight, as the run list does.
  const text = entry.text.replaceAll(/\b[0-9A-Z]{26}\b/gu, (run) => shortRun(run));
  const marker = `by ${entry.who}`;
  const at = text.indexOf(marker);
  if (at < 0) return `${text} at ${time}`;
  const end = at + marker.length;
  return `${text.slice(0, end)} at ${time}${text.slice(end)}`;
}

function answersWait(count: number, nextRun: string | null): string {
  const noun = count === 1 ? "1 answer waits" : `${count} answers wait`;
  return `${noun} for the next run${nextRun === null ? "" : `, ${nextRun}`}`;
}

function answeredTail(entry: ActivityEntry, facts: ReceiptFacts): string {
  const count = entry.detail?.length ?? 0;
  if (facts.readBy !== null) return facts.readBy.isNow ? `, run ${shortRun(facts.readBy.run)} started with ${count === 1 ? "it" : "them"}` : `, read by run ${shortRun(facts.readBy.run)}`;
  return count === 0 ? "" : `, ${answersWait(count, facts.nextRun)}`;
}

function followTail(facts: ReceiptFacts): string {
  const follow = facts.follow;
  if (follow === null) return "";
  if (follow.state === "running") return `, running${follow.host === null ? "" : ` on ${follow.host}`}`;
  if (follow.state === "held") return ", waiting for you";
  if (follow.state === "failed") return ", failed";
  return follow.changed > 0 ? `, done, ${follow.changed} changed` : ", done";
}

/** The sentence of one activity entry as a receipt. */
export function receiptText(entry: ActivityEntry, facts: ReceiptFacts, clock: ReceiptClock): string {
  const text = withTime(entry, clockTime(entry.at, clock.offset));
  if (entry.kind === "ack-answered") return `${text}${answeredTail(entry, facts)}`;
  if (entry.kind === "follow-up-started") return `${text}${followTail(facts)}`;
  if (entry.kind === "run-started" && entry.detail?.some((line) => line.startsWith("Read ")) === true) return `${text}, after your answer`;
  return text;
}

const WHAT = { "follow-up": "a follow-up", "run-now": "a run", resume: "a resume", "vigil-check": "a check" } satisfies Record<PendingStart["kind"], string>;

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The sentence of a start the web asked for and that shows no run yet. */
export function pendingText(start: PendingStart, clock: ReceiptClock): string {
  const time = clockTime(start.at, clock.offset);
  const what = WHAT[start.kind];
  const asked = `asked ${time} by ${start.who}`;
  if (start.state === "refused") return `${capital(what)} was not started: ${(start.sentence ?? "the command refused it").replace(/[.\s]+$/u, "")}. ${capital(asked)}.`;
  if (start.state === "lost") return `${capital(what)} on ${start.host}, ${asked}, shows no start after 15 minutes${start.sentence === undefined ? "" : `. Last line: ${start.sentence}`}`;
  return `Starting ${what} on ${start.host}, ${asked}`;
}
