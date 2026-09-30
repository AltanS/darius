/**
 * The TUI's state and its one key reducer: `reduce(state, key, view)` gives
 * the next state and the effects to run. Pure: the reducer never reads the
 * store or writes it. src/tui/app.ts reads the view before a key, runs the
 * effects (an answer, an acknowledgement, a resume, a run now) and reads
 * again. `render()` draws a state.
 *
 * KEYS (docs/concept.md, "App design" > "TUI"):
 *
 *   Due    Up/Down or j/k move, a digit picks a row by number (two digits
 *          for row 10 and up), Enter opens the row.
 *   Run    Up/Down or j/k scroll a line, PageUp/PageDown or Space a page.
 *          1 to 9 on a held run opens the answer prompt for that question;
 *          `r` resumes a held run once a question is answered. On a closed
 *          failed or abandoned ritual run, `a` acknowledges it and `n`
 *          starts the ritual now (`darius run now`), once per run per
 *          session. On a complete run whose result asks questions, `a`
 *          opens the decision prompt: the decision is saved as the note of
 *          the acknowledgement (`darius run ack --note`). `a` and `n` do
 *          nothing on any other run.
 *   Prompt Typed text echoes, Backspace deletes, Enter saves, Esc cancels.
 *   Always Esc or Backspace goes back, q quits (outside the prompt), Ctrl-C
 *          quits.
 *
 * A paste arrives between two markers (src/tui/term.ts). Inside the prompt
 * its newlines become spaces; outside the prompt a paste is ignored whole,
 * so pasted text never acts as keys.
 */

import { dueScreen } from "./due.ts";
import { asksDecision, isFailure, runLayout, runScreen } from "./run.ts";
import type { DueRow, DueSnapshot, RunSnapshot, RunTarget } from "./snapshot.ts";
import type { Key, Size } from "./term.ts";
import { count, type Line, type Notice } from "./text.ts";

/** The answer to question `n` (from 1) of a held run, or the decision on the questions of a run's result. */
export type Prompt = { kind: "answer"; n: number; text: string } | { kind: "decision"; text: string };

export interface TuiState {
  screen: "due" | "run";
  /** The selected Due row, from 0. */
  selected: number;
  /** Digits typed on the Due screen since the last move. */
  typed: string;
  /** The run the Run screen shows. */
  target: RunTarget | null;
  /** The first body line the Run screen shows. */
  scroll: number;
  prompt: Prompt | null;
  notice: Notice | null;
  isPasting: boolean;
  /** The holds (run and question count) this session started a resume for; a second `r` does not start another. */
  resumed: readonly string[];
  /** The failed runs this session started a `run now` for; a second `n` does not start another. */
  rerun: readonly string[];
  isDone: boolean;
}

/** What the store looks like right now, as far as the current screen needs it. */
export interface View {
  size: Size;
  due: DueSnapshot | null;
  run: RunSnapshot | null;
  /** Set when the read failed. */
  error: string | null;
}

export type Effect =
  | { kind: "answer"; target: RunTarget; n: number; text: string }
  | { kind: "resume"; target: RunTarget }
  /** `note` is the operator's decision on a result's questions; null for a failed run. */
  | { kind: "ack"; target: RunTarget; note: string | null }
  /** `darius run now <slug>` for the ritual of the failed run `target`. */
  | { kind: "run-now"; target: RunTarget; slug: string };

export interface Step {
  state: TuiState;
  effects: Effect[];
}

export function initialState(): TuiState {
  return { screen: "due", selected: 0, typed: "", target: null, scroll: 0, prompt: null, notice: null, isPasting: false, resumed: [], rerun: [], isDone: false };
}

function stay(state: TuiState): Step {
  return { state, effects: [] };
}

function tell(state: TuiState, text: string, isError = false): Step {
  return stay({ ...state, notice: { text, isError } });
}

function isChar(key: Key, char: string): boolean {
  return key.kind === "char" && key.char === char;
}

function digitOf(key: Key): number | null {
  if (key.kind !== "char" || key.char < "0" || key.char > "9") return null;
  return Number(key.char);
}

// --- Due --------------------------------------------------------------------------

function openRun(state: TuiState, target: RunTarget): Step {
  return stay({ ...state, screen: "run", target, scroll: 0, prompt: null });
}

function openRow(state: TuiState, row: DueRow | undefined): Step {
  if (row === undefined) return stay(state);
  if (row.kind === "held" || row.kind === "asks" || row.kind === "failed") return openRun(state, { project: row.project, run: row.run });
  if (row.kind === "vigil") return tell(state, `a vigil has no run screen; run: darius vigil show ${row.slug} --project ${row.project}`);
  if (row.latestRun === null) return tell(state, `ritual ${row.slug} has no runs yet`);
  return openRun(state, { project: row.project, run: row.latestRun });
}

/** A digit on the Due screen: pick row `typed + digit`, else row `digit` alone. */
function pickRow(state: TuiState, digit: number, rows: number): Step {
  for (const typed of [`${state.typed}${String(digit)}`, String(digit)]) {
    const n = Number(typed);
    if (n >= 1 && n <= rows) return stay({ ...state, typed, selected: n - 1 });
  }
  return tell({ ...state, typed: "" }, `there is no row ${String(digit)}`, true);
}

function dueKey(state: TuiState, key: Key, view: View): Step {
  const rows = view.due?.rows ?? [];
  const selected = Math.max(0, Math.min(state.selected, rows.length - 1));
  if (key.kind === "up" || isChar(key, "k")) return stay({ ...state, selected: Math.max(0, selected - 1), typed: "" });
  if (key.kind === "down" || isChar(key, "j")) return stay({ ...state, selected: Math.max(0, Math.min(rows.length - 1, selected + 1)), typed: "" });
  if (key.kind === "enter") return openRow({ ...state, selected, typed: "" }, rows[selected]);
  if (key.kind === "esc" || key.kind === "backspace") return stay({ ...state, typed: "" });
  if (isChar(key, "q")) return stay({ ...state, isDone: true });
  const digit = digitOf(key);
  if (digit !== null) return pickRow({ ...state, selected }, digit, rows.length);
  return stay(state);
}

// --- Run --------------------------------------------------------------------------

/** The new scroll offset for a scroll key, or null when `key` does not scroll. */
function scrolled(state: TuiState, key: Key, view: View): number | null {
  const layout = runLayout(view.run, state, view.size, state.notice);
  const page = Math.max(1, layout.room - 1);
  const current = Math.min(state.scroll, layout.maxScroll);
  let next: number;
  if (key.kind === "up" || isChar(key, "k")) next = current - 1;
  else if (key.kind === "down" || isChar(key, "j")) next = current + 1;
  else if (key.kind === "pageup") next = current - page;
  else if (key.kind === "pagedown" || isChar(key, " ")) next = current + page;
  else return null;
  return Math.max(0, Math.min(layout.maxScroll, next));
}

function askQuestion(state: TuiState, run: RunSnapshot, n: number): Step {
  if (run.phase !== "held") return tell(state, `the run is ${run.phase}; only a held run takes answers`, true);
  if (n > run.questions.length) return tell(state, `there is no question ${String(n)}; the run has ${count(run.questions.length, "question")}`, true);
  return stay({ ...state, prompt: { kind: "answer", n, text: "" } });
}

/** One hold of one run: a run held again after a resume asks more questions, so its key changes. */
function holdKey(run: RunSnapshot): string {
  return `${run.run}#${String(run.questions.length)}`;
}

function resume(state: TuiState, run: RunSnapshot): Step {
  if (run.phase !== "held") return tell(state, `the run is ${run.phase}; only a held run can resume`, true);
  if (!run.isAnswered) return tell(state, "answer a question first", true);
  if (state.resumed.includes(holdKey(run))) return tell(state, "a resume for this hold already started; see resume.log in the run's directory");
  const target = { project: run.project, run: run.run };
  return { state: { ...state, resumed: [...state.resumed, holdKey(run)] }, effects: [{ kind: "resume", target }] };
}

/**
 * `a`: mark a failed or abandoned run as seen (the timer still does not
 * retry it today), or open the prompt for the decision on the questions of
 * a complete run's result.
 */
function acknowledge(state: TuiState, run: RunSnapshot): Step {
  if (asksDecision(run)) {
    if (run.acknowledged !== null) return tell(state, `the run is already answered by ${run.acknowledged.who}`);
    return stay({ ...state, prompt: { kind: "decision", text: "" } });
  }
  if (!isFailure(run)) return stay(state);
  if (run.acknowledged !== null) return tell(state, `the run is already acknowledged by ${run.acknowledged.who}`);
  return { state, effects: [{ kind: "ack", target: { project: run.project, run: run.run }, note: null }] };
}

/** `n`: start the failed run's ritual now, once per run per session. */
function runNow(state: TuiState, run: RunSnapshot): Step {
  if (!isFailure(run)) return stay(state);
  if (state.rerun.includes(run.run)) return tell(state, "a run now for this run already started; see rerun.log in the run's directory");
  const slug = run.item.slice(run.item.indexOf("/") + 1);
  const target = { project: run.project, run: run.run };
  return { state: { ...state, rerun: [...state.rerun, run.run] }, effects: [{ kind: "run-now", target, slug }] };
}

function runKey(state: TuiState, key: Key, view: View): Step {
  if (key.kind === "esc" || key.kind === "backspace") return stay({ ...state, screen: "due", target: null, scroll: 0 });
  if (isChar(key, "q")) return stay({ ...state, isDone: true });
  const scroll = scrolled(state, key, view);
  if (scroll !== null) return stay({ ...state, scroll });
  const run = view.run;
  if (key.kind !== "char" || run === null) return stay(state);
  if (key.char === "r") return resume(state, run);
  if (key.char === "a") return acknowledge(state, run);
  if (key.char === "n") return runNow(state, run);
  const digit = digitOf(key);
  if (digit !== null && digit >= 1) return askQuestion(state, run, digit);
  return stay(state);
}

// --- Prompt -----------------------------------------------------------------------

function promptKey(state: TuiState, prompt: Prompt, key: Key): Step {
  const what = prompt.kind === "answer" ? "answer" : "decision";
  if (key.kind === "esc") return tell({ ...state, prompt: null }, `the ${what} was not saved`);
  if (key.kind === "backspace") return stay({ ...state, prompt: { ...prompt, text: [...prompt.text].slice(0, -1).join("") } });
  if (key.kind === "char") return stay({ ...state, prompt: { ...prompt, text: prompt.text + (key.char === "\t" ? " " : key.char) } });
  if (key.kind !== "enter") return stay(state);
  if (state.isPasting) return stay({ ...state, prompt: { ...prompt, text: `${prompt.text} ` } });
  const text = prompt.text.trim();
  if (text === "") return tell(state, `type ${prompt.kind === "answer" ? "an answer" : "your decision"}, or press Esc to cancel`, true);
  if (state.target === null) return stay({ ...state, prompt: null });
  const effect: Effect = prompt.kind === "answer" ? { kind: "answer", target: state.target, n: prompt.n, text } : { kind: "ack", target: state.target, note: text };
  return { state: { ...state, prompt: null }, effects: [effect] };
}

// --- the reducer --------------------------------------------------------------------

/** One key: the next state and what to do. The notice of the last key clears on the next one. */
export function reduce(state: TuiState, key: Key, view: View): Step {
  if (key.kind === "ctrl-c") return stay({ ...state, isDone: true });
  if (key.kind === "paste-start") return stay({ ...state, isPasting: true });
  if (key.kind === "paste-end") return stay({ ...state, isPasting: false });
  const fresh: TuiState = { ...state, notice: null };
  if (state.prompt !== null) return promptKey(fresh, state.prompt, key);
  if (state.isPasting) return stay(state);
  return state.screen === "due" ? dueKey(fresh, key, view) : runKey(fresh, key, view);
}

/** The current screen, one line per terminal row. A failed read shows in the notice line. */
export function render(state: TuiState, view: View): Line[] {
  const notice = state.notice ?? (view.error === null ? null : { text: view.error, isError: true });
  if (state.screen === "run") return runScreen(view.run, state, view.size, notice);
  return dueScreen(view.due, state, view.size, notice);
}
