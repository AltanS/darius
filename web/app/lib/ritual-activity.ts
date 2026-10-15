/**
 * The ritual page's trail (0.91.0): the timeline of a ritual's events grouped
 * by day, the "Last decision" line, and the notes History puts on a run: a
 * follow-up under its parent, and a run that read an answer. Pure: the loader
 * passes the activity entries and the run rows, and the file reads nothing.
 */

import type { ActivityEntry, RunRow } from "../../../src/web/api.ts";
import { clockTime, dayName, hostDate } from "./format.ts";
import { answerBefore, readerOf, readsAnswers, receiptText, type ReceiptClock, type ReceiptFacts } from "./receipt.ts";

/** One day of the timeline: its date, a label ("Today", "Wed 14 Oct") and its entries, newest first. */
export interface TimelineDay {
  date: string;
  label: string;
  entries: ActivityEntry[];
}

/** Entries grouped by the host's calendar day, newest day first. `entries` are newest first, as `WebContext.activity` gives them. */
export function timelineDays(entries: readonly ActivityEntry[], today: string, offset: number): TimelineDay[] {
  const days: TimelineDay[] = [];
  for (const entry of entries) {
    const date = hostDate(entry.at, offset);
    const last = days.at(-1);
    if (last !== undefined && last.date === date) {
      last.entries.push(entry);
      continue;
    }
    days.push({ date, label: date === today ? "Today" : dayName(`${date}T12:00:00.000Z`, 0), entries: [entry] });
  }
  return days;
}

/** The kinds a person decides with: these make the "Last decision". */
const DECISIONS: ReadonlySet<string> = new Set(["ack-answered", "ack-dismissed", "ack-note", "follow-up-started"]);

/** "approved Q2" out of "Follow-up of X started by web:altan: approved Q2; note: y": what the follow-up was told to do. */
function followWhat(entry: ActivityEntry): string | null {
  const marker = `started by ${entry.who}: `;
  const at = entry.text.indexOf(marker);
  if (at < 0) return null;
  const tail = entry.text.slice(at + marker.length);
  const cut = tail.indexOf("; note:");
  const what = (cut < 0 ? tail : tail.slice(0, cut)).trim();
  return what === "" ? null : what;
}

/** How a follow-up run is doing, for the receipt words. */
function followFacts(run: RunRow | undefined): ReceiptFacts["follow"] {
  if (run === undefined) return null;
  if (run.phase === "running") return { state: "running", host: null, changed: 0 };
  if (run.phase === "held") return { state: "held", host: null, changed: 0 };
  return run.outcome === "complete" ? { state: "done", host: null, changed: run.result?.fixed ?? 0 } : { state: "failed", host: null, changed: 0 };
}

/**
 * The newest decision of a ritual as one sentence: an answer, a dismissal, a
 * note, or a follow-up the operator started. "Answered by web:altan at 09:12,
 * 2 answers wait for the next run, Thu 05:00", or "Follow-up X started by
 * web:altan at 09:12: approved Q2, done". Null when nothing was decided.
 */
export function lastDecision(entries: readonly ActivityEntry[], runs: readonly RunRow[], nextRun: string | null, clock: ReceiptClock): string | null {
  const entry = entries.find((candidate) => DECISIONS.has(candidate.kind));
  if (entry === undefined) return null;
  const facts: ReceiptFacts = {
    nextRun: nextRun === "on demand" ? null : nextRun,
    follow: entry.kind === "follow-up-started" ? followFacts(runs.find((run) => run.run === entry.run)) : null,
    readBy: entry.kind === "ack-answered" ? readerOf(entry, entries) : null,
  };
  return receiptText(entry, facts, clock);
}

/** The note under a run in History, by run id: "follow-up by web:altan, approved Q2" and "read your answer of 09:12". */
export function runNotes(entries: readonly ActivityEntry[], clock: ReceiptClock): Map<string, string> {
  const notes = new Map<string, string>();
  for (const entry of entries) {
    if (entry.run === undefined) continue;
    if (entry.kind === "follow-up-started") {
      const what = followWhat(entry);
      notes.set(entry.run, `follow-up by ${entry.who}${what === null ? "" : `, ${what}`}`);
      continue;
    }
    if (entry.kind !== "run-started" || !readsAnswers(entry)) continue;
    const answer = answerBefore(entry, entries);
    notes.set(entry.run, answer === null ? "read an answer" : `read your answer of ${clockTime(answer.at, clock.offset)}`);
  }
  return notes;
}

/** A run with the follow-ups that sit under it. */
export interface NestedRun<T extends { run: string; followUpOf: string | null }> {
  row: T;
  /** Every follow-up of `row` that is in the list, a follow-up of a follow-up too, in list order. */
  children: T[];
}

/**
 * Nests a follow-up under its parent when the parent is in the list. A
 * follow-up of a follow-up goes under the first run of the chain, so the
 * list is two levels deep at most. `runs` is newest first, and so is the
 * result. A follow-up whose parent is not in the list stays on top level,
 * and so does a run in a loop of follow-ups, so no run disappears.
 */
export function nestRuns<T extends { run: string; followUpOf: string | null }>(runs: readonly T[]): Array<NestedRun<T>> {
  const byId = new Map(runs.map((run) => [run.run, run]));
  /** The first run of the chain `run` follows up, or `run` itself when the chain leaves the list or loops. */
  const rootOf = (run: T): T => {
    const seen = new Set([run.run]);
    let current = run;
    while (current.followUpOf !== null) {
      const parent = byId.get(current.followUpOf);
      if (parent === undefined) return current;
      if (seen.has(parent.run)) return run;
      seen.add(parent.run);
      current = parent;
    }
    return current;
  };
  const children = new Map<string, T[]>();
  const tops: T[] = [];
  for (const run of runs) {
    const root = rootOf(run);
    if (root === run) {
      tops.push(run);
      continue;
    }
    children.set(root.run, [...(children.get(root.run) ?? []), run]);
  }
  return tops.map((row) => ({ row, children: children.get(row.run) ?? [] }));
}
