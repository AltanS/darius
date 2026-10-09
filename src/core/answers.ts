/**
 * Per-question answers on `run.acknowledged` (docs/concept.md, "Answers
 * carried until used (0.80.0)"). The ack line carries `answers: [{n, text}]`,
 * one entry per question the operator answered. This file holds what the
 * writers (`darius run ack --answer`, the web) and the reader
 * (src/core/handoff.ts) share: the limits, the checks and the note that old
 * versions read.
 */

import { UsageError } from "./model.ts";
import type { JsonValue } from "./model.ts";

/** One answer to one question of a run, the question numbered from 1. */
export interface QuestionAnswer {
  n: number;
  text: string;
}

/** The longest answer, and the longest note built from answers. */
export const ANSWER_MAX = 500;

// \p{Cc} is every control character: the codes below a space, DEL, and the C1 range.
const CONTROL = /\p{Cc}/u;

/** One answer text: trimmed, one line, 1 to ANSWER_MAX characters. Returns the problem, or null. */
export function answerProblem(text: string): string | null {
  if (text === "") return "is empty";
  if (CONTROL.test(text)) return "must be one line with no control characters";
  if (text.length > ANSWER_MAX) return `is ${String(text.length)} characters; at most ${String(ANSWER_MAX)} fit`;
  return null;
}

/**
 * The answers of `--answer N=TEXT` flags. Splits at the first `=`. A bad or
 * repeated number, or a bad text, is a usage error. The range of `n` is
 * checked where the question count is known (src/runner/hold.ts).
 */
export function parseAnswerFlags(values: readonly string[]): QuestionAnswer[] {
  const answers: QuestionAnswer[] = [];
  for (const value of values) {
    const at = value.indexOf("=");
    if (at < 0) throw new UsageError(`--answer needs N=TEXT, got '${value}'`);
    const nText = value.slice(0, at).trim();
    const n = Number.parseInt(nText, 10);
    if (!/^[1-9]\d*$/u.test(nText) || !Number.isSafeInteger(n)) throw new UsageError(`--answer ${value}: N must be a positive whole number`);
    if (answers.some((answer) => answer.n === n)) throw new UsageError(`--answer: question ${nText} is answered twice`);
    const text = value.slice(at + 1).trim();
    const problem = answerProblem(text);
    if (problem !== null) throw new UsageError(`--answer ${nText}: the text ${problem}`);
    answers.push({ n, text });
  }
  return answers;
}

/** "Q1: <text>; Q2: <text>", clipped to ANSWER_MAX. What 0.79.x reads as a note. */
export function noteFromAnswers(answers: readonly QuestionAnswer[]): string {
  const note = answers.map((answer) => `Q${String(answer.n)}: ${answer.text}`).join("; ");
  return note.length > ANSWER_MAX ? `${note.slice(0, ANSWER_MAX - 1)}…` : note;
}

function isList(value: JsonValue | undefined): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function isRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

/** The `answers` field of a ledger line, or an empty list when it is missing or malformed. Bad entries are skipped. */
export function readAnswers(value: JsonValue | undefined): QuestionAnswer[] {
  if (!isList(value)) return [];
  const answers: QuestionAnswer[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const { n, text } = entry;
    if (!isCount(n) || !isText(text) || text.trim() === "") continue;
    if (answers.some((answer) => answer.n === n)) continue;
    answers.push({ n, text: text.trim() });
  }
  return answers;
}
