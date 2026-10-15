/**
 * The words of the run page's links (0.92.0): where a run came from, what came
 * of it, and the trail of its own events. Pure: the loader passes the run
 * detail and the activity entries, and the file reads nothing. A sentence
 * keeps its run apart (`RunSentence`), so the page can turn it into a link.
 */

import type { ActivityEntry, FollowUpChild, RunDetail, RunOrigin } from "../../../src/web/api.ts";
import { clockTime, dayGap, dayName, hostDate, momentText, shortRun } from "./format.ts";
import { shortRuns } from "./receipt.ts";
import type { Tone } from "./tone.ts";

/** The host clock the words read: today's date and the UTC offset in minutes. */
export interface HostMoment {
  today: string;
  offset: number;
}

/** A sentence in three pieces: the words before the run, the link text (the run), and the words after. */
export interface RunSentence {
  before: string;
  /** The run the link opens; null when the sentence has no link. */
  run: string | null;
  linkText: string;
  after: string;
}

/** What the header of a run says about its start. Every part is optional: an empty view draws nothing. */
export interface OriginView {
  /** One sentence for each source: the parent of a follow-up, or each run whose answer this run read. */
  leads: RunSentence[];
  /** "Q2, item seo-3": what a follow-up was told to do. Null when it was told nothing by number or key. */
  approved: string | null;
  /** The command lines a follow-up was granted: shown folded. */
  grants: string[];
  /** The operator's note to a follow-up. */
  note: string | null;
}

const NONE: OriginView = { leads: [], approved: null, grants: [], note: null };

/** "Q2, item seo-3" out of the approved question numbers and item keys. */
function approvedText(questions: readonly number[], items: readonly string[]): string | null {
  const parts = [...questions.map((n) => `Q${String(n)}`), ...items.map((key) => `item ${key}`)];
  return parts.length === 0 ? null : parts.join(", ");
}

/** The newest answer of each run an origin read, in the order the runs first appear. */
function answerRuns(answers: NonNullable<RunOrigin["answersRead"]>): Array<{ run: string; at: string }> {
  const newest = new Map<string, string>();
  for (const answer of answers) {
    const known = newest.get(answer.run);
    if (known === undefined || answer.at > known) newest.set(answer.run, answer.at);
  }
  return [...newest].map(([run, at]) => ({ run, at }));
}

/**
 * The header of a run: "Follow-up of <parent>, started by web:altan at 09:12.",
 * what it was approved to do, the lines it was granted and the note. A run
 * that read an answer says which: "Started after your answer of 08:50 on run
 * <run>." (read when it started) or "Resumed with your answer of 08:50 on run
 * <run>." (read when it was resumed). A run the timer or a hand started, with
 * no answer read, has nothing to say here.
 */
export function originView(origin: RunOrigin, startedAt: string, clock: HostMoment): OriginView {
  const when = momentText(startedAt, clock.today, clock.offset);
  if (origin.kind === "follow-up" && origin.run !== undefined) {
    const approved = origin.approved;
    return {
      leads: [{ before: "Follow-up of ", run: origin.run, linkText: shortRun(origin.run), after: `, started by ${origin.who} at ${when}.` }],
      approved: approved === undefined ? null : approvedText(approved.questions, approved.items),
      grants: approved?.grants ?? [],
      note: approved?.note ?? null,
    };
  }
  const answered = origin.kind === "follow-up" ? [] : answerRuns(origin.answersRead ?? []);
  if (answered.length > 0) {
    const opening = origin.kind === "after-answer" ? "Started after" : "Resumed with";
    const leads = answered.map(({ run, at }): RunSentence => ({ before: `${opening} your answer of ${momentText(at, clock.today, clock.offset)} on run `, run, linkText: shortRun(run), after: "." }));
    return { ...NONE, leads };
  }
  if (origin.kind === "resume") return { ...NONE, leads: [{ before: `Resumed by ${origin.who} at ${when}.`, run: null, linkText: "", after: "" }] };
  return NONE;
}

/** "done 09:40, 2 changed": how a follow-up ended, with the count of what it changed. */
function childTail(child: FollowUpChild, clock: HostMoment): string {
  const { row } = child;
  if (row.phase === "running") return ", running";
  if (row.phase === "held") return ", waiting for you";
  const end = row.endedAt === null ? "" : ` ${momentText(row.endedAt, clock.today, clock.offset)}`;
  if (row.outcome !== "complete") return `, ${row.outcome ?? "closed"}${end}`;
  const changed = row.result?.fixed ?? 0;
  return `, done${end}${changed > 0 ? `, ${String(changed)} changed` : ""}`;
}

/** A moment as the page says it: the time today, "Thu 05:00" within the last week, the date and time otherwise. */
function recent(iso: string, clock: HostMoment): string {
  const days = dayGap(hostDate(iso, clock.offset), clock.today);
  if (days === 0) return clockTime(iso, clock.offset);
  if (days > 0 && days < 7) return `${dayName(iso, clock.offset).split(" ")[0] ?? ""} ${clockTime(iso, clock.offset)}`;
  return momentText(iso, clock.today, clock.offset);
}

/**
 * What came of a run: "Then: follow-up <run>, done 09:40, 2 changed" for each
 * follow-up, and "Your answer was read by the run of Thu 05:00" for each run
 * that took one of its answers.
 */
export function thenLines(children: readonly FollowUpChild[], readBy: RunDetail["readBy"], clock: HostMoment): RunSentence[] {
  const lines: RunSentence[] = children.map((child) => ({ before: "Then: ", run: child.row.run, linkText: `follow-up ${shortRun(child.row.run)}`, after: childTail(child, clock) }));
  for (const reader of readBy) {
    lines.push({ before: "Your answer was read by ", run: reader.run, linkText: `the run of ${recent(reader.at, clock)}`, after: "" });
  }
  return lines;
}

// --- the trail of the run's own events ----------------------------------------------------

/** One event of the run: the sentence, the lines that belong under it, and the lines to fold. */
export interface TrailLine {
  at: string;
  text: string;
  tone: Tone;
  /** Lines shown in full under the sentence: the answers of an ack. */
  inline: string[];
  /** Lines behind a fold: the questions of a hold, the lines a follow-up was granted. */
  folded: string[];
}

const DISMISSED = /^Dismissed by (.+?) as older than run (\S+)$/u;
const CHOSEN = /^Follow-up (\S+) chosen by (.+?)((?:; note: .*)?)$/u;

/** The sentence of an event on the run page: an ack says what it did, and every run id is cut to its last eight characters. */
function trailText(entry: ActivityEntry): string {
  const dismissed = DISMISSED.exec(entry.text);
  if (dismissed !== null) return `Dismissed by ${dismissed[1] ?? entry.who} (earlier than ${shortRun(dismissed[2] ?? "")})`;
  const chosen = CHOSEN.exec(entry.text);
  if (chosen !== null) return `Follow-up ${shortRun(chosen[1] ?? "")} started instead of answering, by ${chosen[2] ?? entry.who}${chosen[3] ?? ""}`;
  return shortRuns(entry.text);
}

/** The events of one run as lines, oldest first (`entries` come newest first, as `WebContext.activity` gives them). */
export function trailLines(entries: readonly ActivityEntry[]): TrailLine[] {
  return entries
    .toReversed()
    .map((entry): TrailLine => {
      const detail = entry.detail ?? [];
      const isAnswer = entry.kind === "ack-answered";
      return { at: entry.at, text: trailText(entry), tone: entry.tone, inline: isAnswer ? detail : [], folded: isAnswer ? [] : detail };
    });
}
