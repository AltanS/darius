/**
 * Holding a run, answering it, and acknowledging a failed one. A running run
 * is held from outside the model by the gate when it denies a call
 * (src/cli/policy-check.ts), and by the herdr surface when the agent waits
 * for input too long (src/surface/herdr.ts); the model itself holds through
 * `darius run hold`. A held run is answered by `darius run answer` and by
 * the TUI. A failed or abandoned run is acknowledged by `darius run ack` and
 * by the TUI.
 */

import { answerProblem, noteFromAnswers, type QuestionAnswer } from "../core/answers.ts";
import { appendLine, readLedger, type LedgerLineInput } from "../core/ledger.ts";
import type { JsonValue } from "../core/model.ts";
import { openProject, type Project } from "../core/store.ts";
import { viewRun, type RunView } from "./run-due.ts";

/** Appends run.held once per start or resume, only while the run is running. Returns true when it wrote. */
export function recordHold(target: { project: string; run: string }, hold: { question: string; who: string }): boolean {
  const project = openProject(target.project);
  return project.withLock((): boolean => {
    const view = viewRun(readLedger(project), target.run);
    if (view.phase !== "running" || view.hasHeld) return false;
    appendLine(project, {
      who: hold.who,
      type: "run.held",
      item: view.item,
      run: target.run,
      questions: [hold.question],
    });
    return true;
  });
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

export interface Answer {
  run: string;
  /** The question's number, from 1, over every question the run was held with. */
  n: number;
  text: string;
  who: string;
}

/** Appends run.answered while the run is held. Returns why not, or undefined when it wrote. */
export function answerRun(project: Project, answer: Answer): string | undefined {
  return project.withLock((): string | undefined => {
    const view = viewRun(readLedger(project), answer.run);
    if (view.item === undefined) return `no run '${answer.run}' in ${project.name}`;
    if (view.phase !== "held") return `run '${answer.run}' is not held (phase: ${view.phase ?? "unknown"})`;
    if (answer.n > view.questions.length) {
      return `run '${answer.run}' has ${String(view.questions.length)} question(s); there is no question ${String(answer.n)}`;
    }
    appendLine(project, { who: answer.who, type: "run.answered", item: view.item, run: answer.run, n: answer.n, text: answer.text });
    return undefined;
  });
}

export interface Acknowledge {
  run: string;
  who: string;
  /** Why the failure is fine, or what the operator did about it. Empty means none. */
  note?: string | undefined;
  /** One answer per question the operator answered (0.80.0). Needs a run that asked. */
  answers?: readonly QuestionAnswer[] | undefined;
  /** The follow-up run the operator started instead of answering (`ackParent`, 0.80.0). */
  followUp?: string | undefined;
  /** The run whose `run ack-earlier` wrote this ack (0.80.0). */
  earlierThan?: string | undefined;
}

/**
 * How an acknowledgement went. `isUnknown` means the run does not exist, and
 * `isUsage` that the answers do not fit the run: a usage error, not a refusal.
 */
export type AckResult = { ok: true; outcome: string } | { ok: false; error: string; isUnknown: boolean; isUsage?: boolean };

/** The outcome of a run that may be acknowledged, or why it may not. */
function ackable(run: string, view: RunView): { outcome: string } | { error: string } {
  if (view.phase === "held") return { error: `run '${run}' is held: answer and resume it` };
  if (view.phase !== "closed") return { error: `run '${run}' is ${view.phase ?? "unknown"}; only a failed or abandoned run can be acknowledged` };
  const { outcome, acknowledged } = view;
  // A complete run that asks the operator something waits for them too (0.22.0).
  const asks = outcome === "complete" && (view.result?.questions ?? 0) > 0;
  if (outcome !== "failed" && outcome !== "abandoned" && !asks) {
    return {
      error: `run '${run}' is closed (${outcome ?? "no outcome"}); only a failed or abandoned run, or a complete one with questions, can be acknowledged`,
    };
  }
  if (acknowledged !== undefined) return { error: `run '${run}' is already acknowledged by ${acknowledged.who} at ${acknowledged.at}` };
  return { outcome };
}

/** Why the answers do not fit a run with `count` questions, or null when they do. */
function answersProblem(run: string, answers: readonly QuestionAnswer[], count: number): string | null {
  if (answers.length > 0 && count === 0) return `run '${run}' asked no questions; there is nothing to answer`;
  const seen = new Set<number>();
  for (const answer of answers) {
    if (!Number.isInteger(answer.n) || answer.n < 1 || answer.n > count) {
      return `run '${run}' has ${String(count)} question(s); there is no question ${String(answer.n)}`;
    }
    if (seen.has(answer.n)) return `question ${String(answer.n)} is answered twice`;
    seen.add(answer.n);
    const problem = answerProblem(answer.text);
    if (problem !== null) return `answer ${String(answer.n)} ${problem}`;
  }
  return null;
}

/**
 * Appends run.acknowledged: a person saw a failed or abandoned run, or
 * answered the questions of a complete one (the note says how). It is
 * display only. The timer still does not retry the ritual today
 * (`failedToday()` in src/runner/run-due.ts); a retry is `darius run now`.
 * Refuses every other run, and a second acknowledgement.
 */
export function acknowledgeRun(project: Project, ack: Acknowledge): AckResult {
  return project.withLock((): AckResult => {
    const view = viewRun(readLedger(project), ack.run);
    if (view.item === undefined) return { ok: false, error: `no run '${ack.run}' in ${project.name}`, isUnknown: true };
    const answers = ack.answers ?? [];
    // The answers are checked first on a closed run: answers on one that asked nothing are a caller mistake, whatever else is wrong with the ack.
    const unfit = view.phase === "closed" ? answersProblem(ack.run, answers, view.result?.questions ?? 0) : null;
    if (unfit !== null) return { ok: false, error: unfit, isUnknown: false, isUsage: true };
    const checked = ackable(ack.run, view);
    if ("error" in checked) return { ok: false, error: checked.error, isUnknown: false };
    appendLine(project, ackLine(view.item, ack, answers));
    return { ok: true, outcome: checked.outcome };
  });
}

/**
 * The ack line. Every ack written since 0.80.0 carries `carry: true`: it is
 * delivered by the explicit rule (src/core/handoff.ts). Answers without a
 * note also write a note built from them, marked `note_from_answers`, so a
 * 0.79.x reader sees an answer and not a dismissal.
 */
function ackLine(item: string, ack: Acknowledge, answers: readonly QuestionAnswer[]): LedgerLineInput {
  const line: LedgerLineInput = { who: ack.who, type: "run.acknowledged", item, run: ack.run, carry: true };
  if (answers.length > 0) line.answers = answers.map(({ n, text }) => ({ n, text }));
  if (ack.note !== undefined && ack.note !== "") line.note = ack.note;
  else if (answers.length > 0) {
    line.note = noteFromAnswers(answers);
    line.note_from_answers = true;
  }
  if (ack.followUp !== undefined) line.follow_up = ack.followUp;
  if (ack.earlierThan !== undefined) line.earlier_than = ack.earlierThan;
  return line;
}

export interface AckEarlier {
  run: string;
  who: string;
}

/** How `run ack-earlier` went: the runs it acknowledged, or why it could not start. */
export type AckEarlierResult = { ok: true; acknowledged: string[] } | { ok: false; error: string };

/**
 * Acknowledges, bare, every run of the same ritual as `earlier.run` that is
 * complete, asked questions, has no ack, and started before it (0.80.0).
 * One line per run, each with `earlier_than`. Under one lock, so a run that
 * is answered in the meantime is never dismissed over its answer.
 */
export function acknowledgeEarlier(project: Project, earlier: AckEarlier): AckEarlierResult {
  return project.withLock((): AckEarlierResult => {
    const ledger = readLedger(project);
    const view = viewRun(ledger, earlier.run);
    if (view.item === undefined) return { ok: false, error: `no run '${earlier.run}' in ${project.name}` };
    const starts = ledger.flatMap((line) => (line.type === "run.started" && line.item === view.item && isText(line.run) ? [line.run] : []));
    const here = starts.indexOf(earlier.run);
    const acknowledged: string[] = [];
    for (const run of here < 0 ? [] : starts.slice(0, here)) {
      const candidate = viewRun(ledger, run);
      if (candidate.phase !== "closed" || candidate.outcome !== "complete" || (candidate.result?.questions ?? 0) === 0) continue;
      if (candidate.acknowledged !== undefined) continue;
      appendLine(project, ackLine(view.item, { run, who: earlier.who, earlierThan: earlier.run }, []));
      acknowledged.push(run);
    }
    return { ok: true, acknowledged };
  });
}
