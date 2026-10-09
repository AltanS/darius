/**
 * Ritual handoff (docs/concept.md, "Ritual handoff (0.26.0)"). A run of a
 * ritual leaves the next run of the same ritual a short note: the `handoff`
 * field of its result block (src/core/result.ts), at most 200 characters.
 * `darius run complete` copies it onto the `run.completed` line, so reading
 * it needs no blob.
 *
 * darius hands it over, so no model has to look for it: the next launched
 * run gets it at the top of its prompt (src/runner/launch.ts), and
 * `darius run start` prints it for a run by hand. With the note go the
 * operator's note on that run (`darius run ack --note`) and the questions
 * that note answers. Before 0.26.0 that answer was display only, and the
 * next run never saw it.
 *
 * A bare acknowledgement of a run that asked questions (0.68.0, the web
 * Acknowledge button) is a dismissal: the operator saw the questions and
 * chose not to act. The handoff says so, so the next run neither acts on the
 * questions nor asks them again. A bare acknowledgement of a run with no
 * questions changes nothing.
 *
 * The source is the latest run of the ritual that handed in a result. A run
 * that crashed or ran out of turns hands in none, so the note of the last
 * good run stays. A run whose result has no `handoff` leaves no note: that
 * run decided there was nothing to pass on. A follow-up run (0.47.1) is
 * never the source: it did what the operator approved, out of schedule, so
 * the next scheduled run gets the note of the run it followed up.
 *
 * Answers are carried until used (0.80.0). The operator may answer any run
 * that asked, at any time, so the handoff is more than the latest run's ack.
 * Every answer or dismissal that no completed run has read goes to the next
 * run, oldest first, with its question text. Delivery is explicit:
 * `run.started` (and a fresh `run.resumed`) lists the ack line ids it put in
 * its prompt as `answers_read`, and an ack counts as delivered when a run
 * that read it completes with outcome `complete`. A crashed run leaves it
 * pending. An ack from before 0.80.0 has no `carry` mark and no reader, so
 * it keeps the old rule: delivered once a later complete run started.
 */

import { readAnswers } from "./answers.ts";
import { followUpRuns } from "./due.ts";
import type { JsonValue, LedgerLine } from "./model.ts";
import { parseResult, readSummary, type ResultQuestion } from "./result.ts";
import { getBlobText, itemRef, type Project } from "./store.ts";

const DAY_MS = 86_400_000;
/** An answer older than this that no run read lapses: it is not shown and not delivered. */
export const LAPSE_DAYS = 30;
/** Answers delivered within this many days stay in the prompt, so the run knows what was decided. */
export const RECENT_DAYS = 14;
const RECENT_MAX = 5;
/** The prompt lists this many dismissals at most; older ones are summed in one line. */
export const DISMISSALS_LISTED = 10;
/** Open asks are read from this many of the latest complete runs. */
const OPEN_RUNS = 3;
const LAPSED_MAX = 10;

/** The operator's note on the source run, from its acknowledgement. */
export interface OperatorNote {
  who: string;
  at: string;
  note: string;
}

/** Who acknowledged the source run with no note, and when. */
export interface Dismissal {
  who: string;
  at: string;
}

/** One question of a run and the operator's answer to it; null when the ack left it empty. */
export interface CarriedItem {
  n: number;
  question: string;
  answer: string | null;
}

/** An acknowledgement of a run that handed in a result, as the next run reads it. */
export interface CarriedAnswer {
  /** The id of the ack line: `answers_read` lists it. */
  id: string;
  /** The run that was answered. */
  run: string;
  /** When that run completed. */
  runAt: string;
  who: string;
  /** When the ack was written. */
  at: string;
  /** `dismissed`: a bare ack of a run that asked. `answer`: answers, a note, or a follow-up. */
  kind: "answer" | "dismissed";
  /** The free note; null when there is none, or when it only repeats the answers (`note_from_answers`). */
  note: string | null;
  /** The follow-up run the operator started instead of answering (`ackParent`); null otherwise. */
  followUp: string | null;
  /** True when the ack carried per-question answers; false for a note alone. */
  hasAnswers: boolean;
  items: CarriedItem[];
  /** When a run that read it completed; null while pending. */
  deliveredAt: string | null;
}

/** An answer that lapsed unread: kept visible in `darius ritual show`. */
export interface LapsedAnswer {
  id: string;
  run: string;
  who: string;
  at: string;
}

/** Questions of a recent complete run that nobody acknowledged. */
export interface OpenAsk {
  run: string;
  at: string;
  questions: string[];
}

export interface Handoff {
  /** The run that left the note. */
  run: string;
  /** When that run completed. */
  at: string;
  /** Null when that run left no note, but the operator did or it asked questions. */
  note: string | null;
  /** The questions that run asked the operator; empty without any. */
  questions: ResultQuestion[];
  /** Null until someone acknowledges that run with a note. */
  operator: OperatorNote | null;
  /** Set when that run asked questions and someone acknowledged it with no note: the operator chose not to act. Null otherwise, and always null when `operator` is set. */
  dismissed: Dismissal | null;
  /** The answer acks no completed run has read, oldest first (0.80.0). */
  answers: CarriedAnswer[];
  /** Answer acks delivered in the last RECENT_DAYS days, the newest few, oldest first. */
  recent: CarriedAnswer[];
  /** Questions of the last few complete runs that no one acknowledged. */
  openAsks: OpenAsk[];
  /** The ids of `answers`: what `run.started.answers_read` records. */
  answerIds: string[];
  /** Answers older than LAPSE_DAYS days that no run read, newest few. */
  lapsed: LapsedAnswer[];
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isList(value: JsonValue | undefined): value is readonly JsonValue[] {
  return Array.isArray(value);
}

/** The first acknowledgement of `run` that carries a note. */
function operatorNote(ledger: readonly LedgerLine[], run: string): OperatorNote | null {
  const ack = ledger.find((line) => line.type === "run.acknowledged" && line.run === run && isText(line.note) && line.note.trim() !== "");
  if (ack === undefined || !isText(ack.note)) return null;
  return { who: ack.who, at: ack.at, note: ack.note.trim() };
}

/** The first acknowledgement of `run` when it carries no note and the run asked questions: the operator saw them and left them. */
function dismissal(ledger: readonly LedgerLine[], run: string, questions: readonly ResultQuestion[]): Dismissal | null {
  if (questions.length === 0) return null;
  const ack = ledger.find((line) => line.type === "run.acknowledged" && line.run === run);
  return ack === undefined ? null : { who: ack.who, at: ack.at };
}

/** How many questions the run's ledger line counts. */
function askedCount(completed: LedgerLine): number {
  return readSummary(completed.result)?.questions ?? 0;
}

/** The questions in the run's result blob; read only when the ledger line counts some. */
function resultQuestions(project: Project, completed: LedgerLine): ResultQuestion[] {
  const sha = completed.result_sha;
  if (!isText(sha) || askedCount(completed) === 0) return [];
  const blob = getBlobText(project, sha);
  if (blob === null) return [];
  const parsed = parseResult(blob);
  return "result" in parsed ? parsed.result.questions : [];
}

// --- answer acks ---------------------------------------------------------------

/** An ack that could reach a handoff, before the delivery rule and the blobs. */
interface AckCandidate {
  line: LedgerLine;
  completed: LedgerLine;
  kind: "answer" | "dismissed";
  note: string | null;
  followUp: string | null;
  answers: ReturnType<typeof readAnswers>;
  deliveredAt: string | null;
}

/** What `candidates` found in one pass over the ledger. */
interface AckScan {
  pending: AckCandidate[];
  delivered: AckCandidate[];
  lapsed: AckCandidate[];
}

/** The note of an ack as a person wrote it: not the one built from the answers (`note_from_answers`). */
function freeNote(line: LedgerLine, hasAnswers: boolean): string | null {
  if (!isText(line.note) || line.note.trim() === "") return null;
  if (hasAnswers && line.note_from_answers === true) return null;
  return line.note.trim();
}

/**
 * The ack of run `completed` as an answer ack, or null. Its run must have
 * handed in a result (a crashed run never reached a handoff, and its ack
 * still does not). A bare ack counts only when the run asked questions.
 */
function toCandidate(line: LedgerLine, completed: LedgerLine | undefined): Omit<AckCandidate, "deliveredAt"> | null {
  if (completed === undefined || !isText(completed.result_sha)) return null;
  const answers = readAnswers(line.answers);
  const note = freeNote(line, answers.length > 0);
  const followUp = isText(line.follow_up) && line.follow_up !== "" ? line.follow_up : null;
  const isBare = answers.length === 0 && note === null && followUp === null;
  if (isBare && askedCount(completed) === 0) return null;
  return { line, completed, kind: isBare ? "dismissed" : "answer", note, followUp, answers };
}

/**
 * Splits the answer acks of ritual `item` into pending, delivered and lapsed,
 * in ledger order. The delivery rule is in the file header.
 */
function scanAcks(ledger: readonly LedgerLine[], item: string, now: Date): AckScan {
  const itemLines = ledger.filter((line) => line.item === item);
  const followUps = followUpRuns(itemLines);
  const completions = new Map<string, LedgerLine>();
  const startedAt = new Map<string, number>();
  const reads = new Map<string, string[]>();
  const firstAck = new Map<string, { line: LedgerLine; index: number }>();
  ledger.forEach((line, index) => {
    if (line.item !== item || !isText(line.run)) return;
    if (line.type === "run.started") startedAt.set(line.run, index);
    if (line.type === "run.completed") completions.set(line.run, line);
    if (line.type === "run.acknowledged" && !firstAck.has(line.run)) firstAck.set(line.run, { line, index });
    if ((line.type === "run.started" || line.type === "run.resumed") && isList(line.answers_read)) {
      reads.set(line.run, [...(reads.get(line.run) ?? []), ...line.answers_read.filter(isText)]);
    }
  });

  // Explicit rule: a run that read the ack completed complete.
  const readAt = new Map<string, string>();
  for (const [run, ids] of reads) {
    const done = completions.get(run);
    if (done?.outcome !== "complete") continue;
    for (const id of ids) {
      const known = readAt.get(id);
      if (known === undefined || done.at < known) readAt.set(id, done.at);
    }
  }
  // Legacy rule: a non-follow-up run that started after the ack completed complete.
  const legacyRuns = [...startedAt]
    .filter(([run]) => !followUps.has(run) && completions.get(run)?.outcome === "complete")
    .map(([run, index]) => ({ index, at: completions.get(run)?.at ?? "" }))
    .toSorted((a, b) => a.index - b.index);
  const legacyDelivery = (ackIndex: number): string | null => legacyRuns.find((run) => run.index > ackIndex)?.at ?? null;

  const lapseBefore = now.getTime() - LAPSE_DAYS * DAY_MS;
  const scan: AckScan = { pending: [], delivered: [], lapsed: [] };
  for (const { line, index } of [...firstAck.values()].toSorted((a, b) => a.index - b.index)) {
    const candidate = toCandidate(line, isText(line.run) ? completions.get(line.run) : undefined);
    if (candidate === null) continue;
    const deliveredAt = readAt.get(line.id) ?? (line.carry === true ? null : legacyDelivery(index));
    const ack: AckCandidate = { ...candidate, deliveredAt };
    if (deliveredAt !== null) scan.delivered.push(ack);
    else if (Date.parse(line.at) < lapseBefore) scan.lapsed.push(ack);
    else scan.pending.push(ack);
  }
  return scan;
}

/** The ack with the questions of its run, read from the result blob. */
function carried(project: Project, ack: AckCandidate): CarriedAnswer {
  const answered = new Map(ack.answers.map((answer) => [answer.n, answer.text]));
  const items = resultQuestions(project, ack.completed).map((question, index): CarriedItem => ({
    n: index + 1,
    question: oneLine(question.text),
    answer: answered.get(index + 1) ?? null,
  }));
  return {
    id: ack.line.id,
    run: isText(ack.line.run) ? ack.line.run : "",
    runAt: ack.completed.at,
    who: ack.line.who,
    at: ack.line.at,
    kind: ack.kind,
    note: ack.note,
    followUp: ack.followUp,
    hasAnswers: ack.answers.length > 0,
    items,
    deliveredAt: ack.deliveredAt,
  };
}

function lapsedOf(scan: AckScan): LapsedAnswer[] {
  return scan.lapsed
    .filter((ack) => ack.kind === "answer")
    .slice(-LAPSED_MAX)
    .map((ack) => ({ id: ack.line.id, run: isText(ack.line.run) ? ack.line.run : "", who: ack.line.who, at: ack.line.at }));
}

/** The answers of ritual `slug` that lapsed unread, for `darius ritual show`. */
export function lapsedAnswers(ledger: readonly LedgerLine[], slug: string, now: Date = new Date()): LapsedAnswer[] {
  return lapsedOf(scanAcks(ledger, itemRef("ritual", slug), now));
}

/** The questions of the last few complete runs that no one acknowledged. */
function openAsksOf(project: Project, ledger: readonly LedgerLine[], item: string): OpenAsk[] {
  const itemLines = ledger.filter((line) => line.item === item);
  const followUps = followUpRuns(itemLines);
  const acked = new Set(itemLines.filter((line) => line.type === "run.acknowledged").map((line) => line.run));
  const recentRuns = itemLines
    .filter((line) => line.type === "run.completed" && line.outcome === "complete" && isText(line.result_sha) && !(isText(line.run) && followUps.has(line.run)))
    .slice(-OPEN_RUNS);
  const asks: OpenAsk[] = [];
  for (const completed of recentRuns) {
    if (!isText(completed.run) || acked.has(completed.run) || askedCount(completed) === 0) continue;
    const questions = resultQuestions(project, completed).map((question) => oneLine(question.text));
    if (questions.length > 0) asks.push({ run: completed.run, at: completed.at, questions });
  }
  return asks;
}

/** What the latest run of ritual `slug` with a result hands to the next run, and the answers carried to it; null when there is nothing. */
export function latestHandoff(project: Project, ledger: readonly LedgerLine[], slug: string, now: Date = new Date()): Handoff | null {
  const item = itemRef("ritual", slug);
  const followUps = followUpRuns(ledger.filter((line) => line.item === item));
  const source = ledger.findLast(
    (line) => line.type === "run.completed" && line.item === item && isText(line.result_sha) && !(isText(line.run) && followUps.has(line.run)),
  );

  const scan = scanAcks(ledger, item, now);
  const answers = scan.pending.map((ack) => carried(project, ack));
  const cutoff = now.getTime() - RECENT_DAYS * DAY_MS;
  const recent = scan.delivered
    .filter((ack) => ack.deliveredAt !== null && Date.parse(ack.deliveredAt) >= cutoff)
    .toSorted((a, b) => (a.deliveredAt ?? "").localeCompare(b.deliveredAt ?? ""))
    .slice(-RECENT_MAX)
    .map((ack) => carried(project, ack));
  const openAsks = openAsksOf(project, ledger, item);
  const carriedAny = answers.length > 0 || recent.length > 0 || openAsks.length > 0;

  // With no source run the newest carried ack stands in for it; without any, there is nothing to hand over.
  const base = source ?? scan.pending.at(-1)?.completed ?? scan.delivered.at(-1)?.completed;
  if (base === undefined || !isText(base.run)) return null;
  const { run } = base;
  const note = source !== undefined && isText(source.handoff) && source.handoff !== "" ? source.handoff : null;
  const questions = resultQuestions(project, base);
  const operator = operatorNote(ledger, run);
  const dismissed = operator === null ? dismissal(ledger, run, questions) : null;
  // A dismissal needs questions, and questions alone keep the handoff, so it never needs a note.
  if (note === null && questions.length === 0 && operator === null && dismissed === null && !carriedAny) return null;
  return {
    run,
    at: base.at,
    note,
    questions,
    operator,
    dismissed,
    answers,
    recent,
    openAsks,
    answerIds: answers.map((answer) => answer.id),
    lapsed: lapsedOf(scan),
  };
}

// --- the text -----------------------------------------------------------------------

/** `2026-09-30T10:12:44.123Z` as `2026-09-30 10:12 UTC`. */
function stamp(at: string): string {
  return `${at.slice(0, 10)} ${at.slice(11, 16)} UTC`;
}

function day(at: string): string {
  return at.slice(0, 10);
}

function oneLine(text: string): string {
  return text.replaceAll(/\s+/gu, " ").trim();
}

/** `follow-up <run>, approved 1` as `approved 1`: what `ackParent` wrote after the run id. */
function followUpWhat(answer: CarriedAnswer): string {
  const note = answer.note ?? "";
  const prefix = `follow-up ${answer.followUp ?? ""}, `;
  return note.startsWith(prefix) ? note.slice(prefix.length) : note;
}

/** The lines of one carried ack. `isShort` leaves out the questions nobody answered. */
function ackLines(answer: CarriedAnswer, isShort: boolean): string[] {
  const verb = answer.kind === "dismissed" ? "dismissed" : "answered";
  const lines = [isShort ? `Run ${answer.run} (${day(answer.runAt)}), ${answer.who} on ${day(answer.at)}:` : `Run ${answer.run} (${day(answer.runAt)}), ${verb} by ${answer.who} on ${day(answer.at)}:`];
  const asked = answer.items.map((item) => oneLine(item.question));
  if (answer.followUp !== null) {
    const what = followUpWhat(answer);
    lines.push(`The operator started follow-up ${answer.followUp}${what === "" ? "" : ` (${what})`}.`);
    return lines;
  }
  if (answer.kind === "dismissed") {
    lines.push(asked.length === 0 ? "The operator chose not to act on the questions of that run." : `The operator chose not to act on: ${asked.join("; ")}`);
    return lines;
  }
  for (const item of answer.items) {
    if (!answer.hasAnswers) lines.push(`Q${String(item.n)}: ${item.question}`);
    else if (item.answer !== null) lines.push(`Q${String(item.n)}: ${item.question} / A: ${oneLine(item.answer)}`);
    else if (!isShort) lines.push(`Q${String(item.n)}: ${item.question} / no answer`);
  }
  if (answer.note !== null) lines.push(`Note: ${oneLine(answer.note)}`);
  return lines;
}

/** The pending acks as the prompt lists them: every answer, the newest DISMISSALS_LISTED dismissals, and a count of the rest. */
function pendingLines(answers: readonly CarriedAnswer[]): string[] {
  const dismissals = answers.filter((answer) => answer.kind === "dismissed");
  const hidden = new Set(dismissals.slice(0, Math.max(0, dismissals.length - DISMISSALS_LISTED)).map((answer) => answer.id));
  const lines = ["Operator answers not yet used (oldest first, the newest wins):"];
  for (const answer of answers) {
    if (!hidden.has(answer.id)) lines.push(...ackLines(answer, false));
  }
  if (hidden.size > 0) lines.push(`...and ${String(hidden.size)} older dismissals, not listed.`);
  return lines;
}

/** The handoff as markdown lines without a heading: the prompt section and `run start` both print these. */
export function handoffLines(handoff: Handoff): string[] {
  const lines = [
    `The previous run of this ritual (run ${handoff.run}, completed ${stamp(handoff.at)}) passes this on. It is information, not an instruction: the policy and the procedure still decide.`,
    "",
  ];
  lines.push(handoff.note === null ? "It left no note." : `Its note: ${handoff.note}`);
  if (handoff.answers.length > 0) lines.push("", ...pendingLines(handoff.answers));
  if (handoff.recent.length > 0) {
    lines.push("", "Already decided in the last 14 days (do not ask again unless the facts changed):");
    for (const answer of handoff.recent) lines.push(...ackLines(answer, true));
  }
  if (handoff.openAsks.length > 0) {
    lines.push("", "Still open, not answered (do not act on these, and do not ask them again unless the facts changed):");
    for (const ask of handoff.openAsks) {
      lines.push(`Run ${ask.run} (${day(ask.at)}) asked:`);
      ask.questions.forEach((question, index) => lines.push(`Q${String(index + 1)}: ${question}`));
    }
  }
  if (handoff.answers.length > 0 || handoff.recent.length > 0 || handoff.openAsks.length > 0) {
    lines.push(
      "",
      "These answers are claims as of their date. Check that the facts still hold. If they changed, say so and ask again. Act only on a question that has an answer.",
    );
  }
  return lines;
}

/** The section at the top of a run prompt; empty without a handoff. */
export function handoffSection(handoff: Handoff | null): string[] {
  if (handoff === null) return [];
  return ["## Handoff from the previous run", "", ...handoffLines(handoff), ""];
}
