/**
 * Holding a run, answering it, and acknowledging a failed one. A running run
 * is held from outside the model by the gate when it denies a call
 * (src/cli/policy-check.ts), and by the herdr surface when the agent waits
 * for input too long (src/surface/herdr.ts); the model itself holds through
 * `darius run hold`. A held run is answered by `darius run answer` and by
 * the TUI. A failed or abandoned run is acknowledged by `darius run ack` and
 * by the TUI.
 */

import { appendLine, readLedger, type LedgerLineInput } from "../core/ledger.ts";
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
}

/** How an acknowledgement went. `isUnknown` means the run does not exist: a usage error, not a refusal. */
export type AckResult = { ok: true; outcome: string } | { ok: false; error: string; isUnknown: boolean };

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
    const checked = ackable(ack.run, view);
    if ("error" in checked) return { ok: false, error: checked.error, isUnknown: false };
    const line: LedgerLineInput = { who: ack.who, type: "run.acknowledged", item: view.item, run: ack.run };
    if (ack.note !== undefined && ack.note !== "") line.note = ack.note;
    appendLine(project, line);
    return { ok: true, outcome: checked.outcome };
  });
}
