/**
 * The Run screen (docs/concept.md, "App design" > "TUI"): one run's facts,
 * its findings, then its questions with their answers. Pure: a snapshot and
 * the state in, rows out.
 *
 *   Heartbeat  ritual/heartbeat  acme             fixed head
 *   run 01K6...
 *   held, 2 questions, 1 answered
 *   started 2026-09-29 14:32  not ended
 *
 *   Findings                                       the body scrolls
 *   <the raw markdown, word-wrapped>
 *
 *   Questions
 *   1. May I push the fix?
 *      answer: yes, push it
 *   2. ...
 *                                                  fixed foot
 *   Answer question 2: May I delete the branch?    while a prompt is open
 *   > no, keep it_
 *   1-9 answer  r resume  j/k scroll  Space page  Esc back  q quit
 *
 * A closed failed or abandoned ritual run gets one more head line after the
 * phase: "not retried today. n runs it now, a marks it seen", or who
 * acknowledged it. Its hints start with `a acknowledge  n run now`.
 *
 * A run with a result (0.22.0) shows it first in the body: the status, the
 * summary, its note for the next run (0.26.0), the open items per severity,
 * and the questions for the operator with their recommendations. A complete
 * run whose result asks questions gets a head line, "asks you 2 questions.
 * a records your decision", or who
 * answered and how; `a` opens the decision prompt, and the decision is
 * saved as the note of the acknowledgement.
 *
 * The findings are shown as written, not rendered: the text is cleaned of
 * control characters (src/tui/text.ts) and wrapped, nothing more.
 */

import { SEVERITIES, summarizeResult } from "../core/result.ts";
import type { ResultStatus, RunResultSummary } from "../web/api.ts";
import type { RunSnapshot } from "./snapshot.ts";
import type { TuiState } from "./state.ts";
import type { Size } from "./term.ts";
import { BLANK, blanks, clean, count, line, noticeLines, oneLine, part, stamp, tail, wrap, type Line, type Notice, type Part, type Tone } from "./text.ts";

const HELD_HINTS = "1-9 answer  r resume  j/k scroll  Space page  Esc back  q quit";
const FAILED_HINTS = "a acknowledge  n run now  j/k scroll  Space page  Esc back  q quit";
const SEEN_HINTS = "n run now  j/k scroll  Space page  Esc back  q quit";
const ASKS_HINTS = "a decide  j/k scroll  Space page  Esc back  q quit";
const PLAIN_HINTS = "j/k scroll  Space page  Esc back  q quit";
const PROMPT_HINTS = "Enter save  Esc cancel";
const ANSWER_INDENT = "   ";

export interface RunLayout {
  head: Line[];
  body: Line[];
  foot: Line[];
  /** Rows the body gets on screen. */
  room: number;
  /** The largest useful scroll offset into the body. */
  maxScroll: number;
}

function answeredCount(snapshot: RunSnapshot): number {
  return [...snapshot.answers.keys()].filter((n) => n <= snapshot.questions.length).length;
}

function phasePart(snapshot: RunSnapshot): Part {
  if (snapshot.phase === "held") {
    return part(`held, ${count(snapshot.questions.length, "question")}, ${String(answeredCount(snapshot))} answered`, "needs");
  }
  if (snapshot.phase === "running") return part("running");
  const outcome = snapshot.outcome ?? "no outcome";
  // An acknowledged failure is quiet: the line under it says who saw it.
  return part(`closed, ${oneLine(outcome)}`, outcome === "failed" && snapshot.acknowledged === null ? "failed" : "plain");
}

/** A closed ritual run that failed or was abandoned: `a` acknowledges it and `n` starts the ritual again. */
export function isFailure(snapshot: RunSnapshot): boolean {
  const { phase, outcome, item } = snapshot;
  return phase === "closed" && (outcome === "failed" || outcome === "abandoned") && item.startsWith("ritual/");
}

/** The number of questions the run's result asks; 0 without a result. */
function resultQuestionCount(snapshot: RunSnapshot): number {
  return snapshot.summary?.questions ?? snapshot.result?.questions.length ?? 0;
}

/** A complete run whose result asks questions: `a` records the operator's decision on them. */
export function asksDecision(snapshot: RunSnapshot): boolean {
  return snapshot.phase === "closed" && snapshot.outcome === "complete" && resultQuestionCount(snapshot) > 0;
}

/** For a run that asks: the key that answers, or who answered and how. */
function decisionLines(snapshot: RunSnapshot): Line[] {
  if (!asksDecision(snapshot)) return [];
  const seen = snapshot.acknowledged;
  if (seen !== null) {
    const note = seen.note === null ? ", without a note" : `: ${oneLine(seen.note)}`;
    return [line(part(`answered by ${oneLine(seen.who)} at ${stamp(seen.at)}${note}`, "dim"))];
  }
  return [line(part(`asks you ${count(resultQuestionCount(snapshot), "question")}. a records your decision`, "needs"))];
}

/** What comes next for a failed run: who saw it, or the two keys. */
function failureLines(snapshot: RunSnapshot): Line[] {
  if (!isFailure(snapshot)) return [];
  const seen = snapshot.acknowledged;
  if (seen !== null) {
    const note = seen.note === null ? "" : `: ${oneLine(seen.note)}`;
    return [line(part(`acknowledged by ${oneLine(seen.who)} at ${stamp(seen.at)}${note}`, "dim"))];
  }
  return [line(part(snapshot.isEndedToday ? "not retried today. n runs it now, a marks it seen" : "n runs it now, a marks it seen"))];
}

function headLines(snapshot: RunSnapshot | null, state: TuiState): Line[] {
  if (snapshot === null) {
    const target = state.target === null ? "" : `${state.target.project}: ${state.target.run}`;
    return [line(part("Run not found", "failed")), line(part(`The store has no such run. ${oneLine(target)}`, "dim")), BLANK];
  }
  return [
    line(part(oneLine(snapshot.title ?? snapshot.item), "bold"), part(`  ${oneLine(snapshot.item)}  ${oneLine(snapshot.project)}`, "dim")),
    line(part(`run ${snapshot.run}`)),
    line(phasePart(snapshot)),
    ...failureLines(snapshot),
    ...decisionLines(snapshot),
    line(part(`started ${stamp(snapshot.startedAt)}`), part(snapshot.endedAt === null ? "  not ended" : `  ended ${stamp(snapshot.endedAt)}`)),
    BLANK,
  ];
}

function hintsFor(snapshot: RunSnapshot | null): string {
  if (snapshot === null) return PLAIN_HINTS;
  if (snapshot.phase === "held") return HELD_HINTS;
  if (asksDecision(snapshot)) return snapshot.acknowledged === null ? ASKS_HINTS : PLAIN_HINTS;
  if (!isFailure(snapshot)) return PLAIN_HINTS;
  return snapshot.acknowledged === null ? FAILED_HINTS : SEEN_HINTS;
}

/** `text` wrapped to `width` after `lead` on the first row and under it on the rest. */
function hanging(text: string, lead: string, width: number): string[] {
  const rows = wrap(clean(text), Math.max(1, width - lead.length));
  const indent = " ".repeat(lead.length);
  return rows.map((row, index) => (index === 0 ? lead : indent) + row);
}

function questionLines(snapshot: RunSnapshot, width: number): Line[] {
  const lines: Line[] = [BLANK, line(part("Questions", "bold"))];
  const isHeld = snapshot.phase === "held";
  snapshot.questions.forEach((question, index) => {
    const n = index + 1;
    for (const row of hanging(question, `${String(n)}. `, width)) lines.push(line(part(row)));
    const answer = snapshot.answers.get(n);
    if (answer === undefined) {
      lines.push(line(part(`${ANSWER_INDENT}no answer yet`, isHeld ? "needs" : "dim")));
      return;
    }
    for (const row of hanging(answer, `${ANSWER_INDENT}answer: `, width)) lines.push(line(part(row)));
  });
  return lines;
}

const STATUS_WORDS = { ok: "result ok", attention: "result needs attention", failed: "result failed" } as const satisfies Record<ResultStatus, string>;

function statusTone(status: ResultStatus): Tone {
  if (status === "ok") return "plain";
  return status === "attention" ? "needs" : "failed";
}

/** "open: 1 critical, 2 high; 3 fixed", or "nothing open". */
function openText(counts: RunResultSummary): string {
  const open = SEVERITIES.flatMap((severity) => (counts.open[severity] > 0 ? [`${String(counts.open[severity])} ${severity}`] : []));
  const head = open.length === 0 ? "nothing open" : `open: ${open.join(", ")}`;
  return counts.fixed > 0 ? `${head}; ${String(counts.fixed)} fixed` : head;
}

/** The result block: status, summary, open counts, then the questions for the operator. Empty without a result. */
function resultLines(snapshot: RunSnapshot, width: number): Line[] {
  const { result } = snapshot;
  const counts = snapshot.summary ?? (result === null ? null : summarizeResult(result));
  if (counts === null) return [];
  const lines: Line[] = [line(part("Result", "bold")), line(part(STATUS_WORDS[counts.status], statusTone(counts.status)))];
  if (result === null) lines.push(line(part("The full result is not on this host.", "dim")));
  else for (const row of wrap(clean(result.summary), width)) lines.push(line(part(row)));
  if (result?.handoff !== undefined) for (const row of wrap(clean(`Note for the next run: ${result.handoff}`), width)) lines.push(line(part(row, "dim")));
  lines.push(line(part(openText(counts))));
  if (result === null || result.questions.length === 0) return [...lines, BLANK];
  lines.push(BLANK, line(part("Questions for you", "bold")));
  result.questions.forEach((question, index) => {
    for (const row of hanging(question.text, `${String(index + 1)}. `, width)) lines.push(line(part(row)));
    if (question.recommendation === undefined) return;
    for (const row of hanging(question.recommendation, `${ANSWER_INDENT}recommended: `, width)) lines.push(line(part(row, "dim")));
  });
  if (asksDecision(snapshot) && snapshot.acknowledged === null) {
    for (const row of wrap("Press a to record your decision. darius saves it as the note of the acknowledgement.", width)) lines.push(line(part(row, "needs")));
  }
  return [...lines, BLANK];
}

function bodyLines(snapshot: RunSnapshot | null, width: number): Line[] {
  if (snapshot === null) return [];
  const lines: Line[] = [...resultLines(snapshot, width), line(part("Findings", "bold"))];
  if (snapshot.findings === null) lines.push(line(part(snapshot.phase === "closed" ? "No findings." : "No findings yet.", "dim")));
  else for (const row of wrap(clean(snapshot.findings).trimEnd(), width)) lines.push(line(part(row)));
  if (snapshot.questions.length > 0) lines.push(...questionLines(snapshot, width));
  return lines;
}

function footLines(snapshot: RunSnapshot | null, state: TuiState, notice: Notice | null, width: number): Line[] {
  const lines: Line[] = [];
  const { prompt } = state;
  if (prompt !== null) {
    if (prompt.kind === "answer") {
      const question = snapshot?.questions[prompt.n - 1] ?? "";
      lines.push(line(part(`Answer question ${String(prompt.n)}: `, "needs"), part(oneLine(question))));
    } else {
      const asked = snapshot === null ? 0 : resultQuestionCount(snapshot);
      lines.push(line(part(`Your decision on ${count(asked, "question")}:`, "needs")));
    }
    lines.push(line(part("> "), part(tail(prompt.text, width - 3)), part(" ", "cursor")));
  }
  if (notice !== null) lines.push(...noticeLines(notice, width));
  const hints = prompt !== null ? PROMPT_HINTS : hintsFor(snapshot);
  lines.push(line(part(hints, "dim")));
  return lines;
}

/** The Run screen cut into its fixed head, scrolling body and fixed foot. */
export function runLayout(snapshot: RunSnapshot | null, state: TuiState, size: Size, notice: Notice | null): RunLayout {
  const head = headLines(snapshot, state);
  const body = bodyLines(snapshot, size.cols);
  const foot = footLines(snapshot, state, notice, size.cols);
  const room = Math.max(0, size.rows - head.length - foot.length);
  return { head, body, foot, room, maxScroll: Math.max(0, body.length - room) };
}

/** The whole Run screen, `size.rows` lines. */
export function runScreen(snapshot: RunSnapshot | null, state: TuiState, size: Size, notice: Notice | null): Line[] {
  const layout = runLayout(snapshot, state, size, notice);
  const scroll = Math.min(state.scroll, layout.maxScroll);
  const shown = layout.body.slice(scroll, scroll + layout.room);
  const hints = layout.foot.at(-1);
  if (hints !== undefined && layout.maxScroll > 0) {
    const last = Math.min(layout.body.length, scroll + layout.room);
    hints.parts.push(part(`  lines ${String(scroll + 1)}-${String(last)} of ${String(layout.body.length)}`, "dim"));
  }
  return [...layout.head, ...shown, ...blanks(layout.room - shown.length), ...layout.foot];
}
