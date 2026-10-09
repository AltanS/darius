/**
 * What the answer form does, apart from drawing it (0.80.0): the answers it
 * collects, the fill of "Use recommendation", the body each button posts and
 * the sentence for what "Send and run now" did. Pure, so a test can hold each
 * rule without a browser. The server checks every body again
 * (src/web/action-api.ts).
 */

import type { ResultQuestion } from "../../../src/web/api.ts";
import { shortRun } from "./format.ts";
import type { PostBody, PostOk } from "./post.ts";

/** The longest answer the server takes (ANSWER_MAX in src/core/answers.ts). */
export const ANSWER_LIMIT = 500;

/** A recommendation as an answer: one line, at most ANSWER_LIMIT characters. Empty when the question has none. */
export function recommendedText(question: ResultQuestion): string {
  return (question.recommendation ?? "").replaceAll(/\s+/gu, " ").trim().slice(0, ANSWER_LIMIT);
}

/** The boxes with box `index` set to `text` and every other box as it was. */
export function withText(texts: readonly string[], index: number, text: string): string[] {
  return texts.map((old, at) => (at === index ? text : old));
}

/** The answers in the boxes: the filled ones, numbered from 1 by their question. */
export function answersOf(texts: readonly string[]): Array<{ n: number; text: string }> {
  return texts.flatMap((text, index) => (text.trim() === "" ? [] : [{ n: index + 1, text: text.trim() }]));
}

/** The three buttons of the form. */
export type AskAction = "send" | "now" | "dismiss";

/** The body a button posts to `/api/run/ack`. "Dismiss" sends no answers, whatever is typed. */
export function askBody(action: AskAction, at: { project: string; run: string }, texts: readonly string[]): PostBody {
  if (action === "dismiss") return { project: at.project, run: at.run };
  const body = { project: at.project, run: at.run, answers: answersOf(texts) };
  return action === "now" ? { ...body, runNow: true } : body;
}

/** The body of "Dismiss all earlier asks": the ids of the asks shown, never more. */
export function earlierBody(at: { project: string; run: string }, shown: readonly string[]): PostBody {
  return { project: at.project, run: at.run, runs: [...shown] };
}

export interface RunNowNotice {
  tone: "ok" | "bad";
  text: string;
  /** The new run, when one started. */
  child?: string;
}

/** What to tell the operator after "Send and run now" was accepted: the answer is saved in every case. */
export function runNowNotice(result: PostOk): RunNowNotice {
  if (result.runNowError !== null) return { tone: "bad", text: `Your answer is saved, but the run did not start: ${result.runNowError}. The next run reads it.` };
  if (result.run === null) return { tone: "ok", text: result.message ?? "Your answer is saved. The run is starting." };
  return { tone: "ok", text: `Your answer is saved. Started run ${shortRun(result.run)}.`, child: result.run };
}

/** The questions of a held run's current hold, with their numbers: the held card asks these, not the questions of earlier holds. */
export function currentHold(row: { questions: readonly string[]; holdFrom?: number | undefined }): Array<{ n: number; text: string }> {
  const from = row.holdFrom ?? 0;
  return row.questions.slice(from).map((text, index) => ({ n: from + index + 1, text }));
}

/** The body of "Answer and resume": the filled boxes, each numbered by its question, and `resume: true`. */
export function heldBody(at: { project: string; run: string }, hold: ReadonlyArray<{ n: number }>, texts: readonly string[]): PostBody {
  const answers = texts.flatMap((text, index) => {
    const n = hold[index]?.n;
    return n === undefined || text.trim() === "" ? [] : [{ n, text: text.trim() }];
  });
  return { project: at.project, run: at.run, answers, resume: true };
}

/** What to tell the operator after "Answer and resume" was accepted: the answers are saved in every case. */
export function resumeNotice(result: PostOk): RunNowNotice {
  if (result.resumeError !== null) return { tone: "bad", text: `Your answers are saved, but the run did not go on: ${result.resumeError}.` };
  if (result.resumed) {
    const notice: RunNowNotice = { tone: "ok", text: "Your answers are saved. The run goes on." };
    if (result.run !== null) notice.child = result.run;
    return notice;
  }
  return { tone: "ok", text: result.message ?? "Your answers are saved. The run is starting." };
}

/** The React key of a held run's form: a second hold of the same run gets a fresh form, with empty boxes. */
export function heldKey(row: { run: string; holdFrom?: number | undefined }): string {
  return `${row.run}:${row.holdFrom ?? 0}`;
}

/** The most the server reads of a request body (MAX_BODY in src/web/push-api.ts); the app may not import it at run time. */
export const BODY_LIMIT = 4096;

/** What the form says when the answers together would not fit the request. */
export const ANSWERS_TOO_LONG = "The answers are too long together. Shorten them.";

/** True when this body would be refused as too large: the form turns its buttons off and says so. */
export function isTooLong(body: PostBody): boolean {
  return JSON.stringify(body).length > BODY_LIMIT;
}
