/**
 * The sentence of a receipt (0.90.0): what was done, by whom, when and what
 * happens next, written from the activity entry (`src/web/activity.ts`) or
 * the pending start (`src/web/pending.ts`) alone. Nothing here reads client
 * state, so a reload shows the same words. Pure: the Overview builds the
 * facts, this file builds the text.
 */

import type { ActivityEntry, PendingStart } from "../../../src/web/api.ts";
import { refusedStartText } from "./ask.ts";
import { lostText } from "./check-poll.ts";
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

/** An activity entry that may name its project: the Overview's list does, a ritual's own list does not. */
type Entry = ActivityEntry & { project?: string };

/** A run forwarded to another host (`--on <host>`) writes its start line with that host's clock: allow this much before an answer, as the pending registry does (`CLOCK_SKEW_MS` in src/web/pending.ts). */
const CLOCK_SKEW_MS = 2 * 60 * 1000;
/** A run that starts this soon after an answer, by the same hand, is "Send and run now". */
const RUN_NOW_MS = 5 * 60 * 1000;

/** True for the detail line a run start carries when it read answers: "Read 2 answers". */
export function readsAnswers(entry: ActivityEntry): boolean {
  return entry.detail?.some((line) => line.startsWith("Read ")) ?? false;
}

function sameRitual(left: Entry, right: Entry): boolean {
  return left.project === right.project && left.links.ritual === right.links.ritual;
}

/** The run that took an answer: the first run of the same ritual after it that read answers. `isNow` when the same hand started it right after ("Send and run now"). */
export function readerOf(answer: Entry, entries: readonly Entry[]): ReceiptFacts["readBy"] {
  const at = Date.parse(answer.at);
  const reader = entries
    .filter((entry) => entry.kind === "run-started" && entry.run !== undefined && sameRitual(entry, answer) && Date.parse(entry.at) >= at - CLOCK_SKEW_MS && readsAnswers(entry))
    .toSorted((left, right) => left.at.localeCompare(right.at))[0];
  if (reader?.run === undefined) return null;
  return { run: reader.run, isNow: reader.who === answer.who && Math.abs(Date.parse(reader.at) - at) <= RUN_NOW_MS };
}

/** The answer a run that read answers took: the newest answer of the same ritual that came before the run started. */
export function answerBefore(start: Entry, entries: readonly Entry[]): Entry | null {
  const answers = entries.filter((entry) => entry.kind === "ack-answered" && sameRitual(entry, start) && Date.parse(entry.at) <= Date.parse(start.at) + CLOCK_SKEW_MS).toSorted((left, right) => right.at.localeCompare(left.at));
  return answers[0] ?? null;
}

export const NO_FACTS: ReceiptFacts = { nextRun: null, follow: null, readBy: null };

/** A sentence with each run id (26 characters) cut to its last eight, as the run list shows it. */
export function shortRuns(sentence: string): string {
  return sentence.replaceAll(/\b[0-9A-Z]{26}\b/gu, (run) => shortRun(run));
}

/** "Answered by web:altan" -> "Answered by web:altan at 09:12": the time goes after the name. */
function withTime(entry: ActivityEntry, time: string): string {
  const text = shortRuns(entry.text);
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

const WHAT = { "follow-up": "a follow-up", "run-now": "a run", resume: "a resume" } satisfies Record<Exclude<PendingStart["kind"], "vigil-check">, string>;

/** "asked 04:49 from the web" when the web asked, else "asked 04:49". The raw `who` never shows. */
export function askedText(start: Pick<PendingStart, "at" | "from">, clock: ReceiptClock): string {
  return `asked ${clockTime(start.at, clock.offset)}${start.from === "web" ? " from the web" : ""}`;
}

/** The sentence of a start the web asked for and that shows no run yet. */
export function pendingText(start: PendingStart, clock: ReceiptClock): string {
  if (start.state === "refused") return refusedStartText(start.sentence ?? "the command refused it", start.host);
  if (start.state === "lost") return lostText(start.host, start.kind === "vigil-check" ? "check" : "run");
  const tail = `on ${start.host}, ${askedText(start, clock)}`;
  return start.kind === "vigil-check" ? `Checking ${tail}` : `Starting ${WHAT[start.kind]} ${tail}`;
}
