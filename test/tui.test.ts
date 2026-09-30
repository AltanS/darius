/**
 * The TUI (src/tui/): the text layer (control characters stripped, width,
 * wrap), the key decoder, the Due list read from a throwaway store, both
 * screens, the key reducer, and the whole path from keys to the store: open
 * a held run, answer it, resume it. The resume goes to a FAKE spawner; no
 * test starts a process, opens a terminal, or reads the operator's store.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { appendLine, readLedger, type LedgerLineInput } from "../src/core/ledger.ts";
import type { Policy, Profile, Ritual } from "../src/core/model.ts";
import { summarizeResult, type RunResult } from "../src/core/result.ts";
import { GLOBAL_PROJECT, openProject, putBlob } from "../src/core/store.ts";
import { addVigil, closeVigil } from "../src/core/sweep.ts";
import { ulid } from "../src/core/ulid.ts";
import { dariusBin } from "../src/runner/launch.ts";
import { acknowledgeRun } from "../src/runner/hold.ts";
import { loadView, performEffect, pressKeys, rerunLog, resumeLog, type Pressed, type TuiDeps } from "../src/tui/app.ts";
import { dueScreen } from "../src/tui/due.ts";
import { runScreen } from "../src/tui/run.ts";
import { readDue, readRun, type DueRow, type DueSnapshot, type RunSnapshot } from "../src/tui/snapshot.ts";
import { initialState, reduce, render, type Effect, type TuiState, type View } from "../src/tui/state.ts";
import { colourAllowed, decodeKeys, frame, type Key, type Size } from "../src/tui/term.ts";
import { cells, clean, line, paint, part, plain, truncate, wrap, type Line } from "../src/tui/text.ts";
import { VERSION } from "../src/version.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-tui-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
process.env.DARIUS_HERDR = join(SANDBOX, "no-herdr");
process.env.DARIUS_TAILSCALE = join(SANDBOX, "no-tailscale");

const BIN = join(import.meta.dirname, "..", "bin", "darius");
const SIZE: Size = { cols: 100, rows: 30 };
const DAY_MS = 86_400_000;
const ESC = "\u001b";

/** readDue lists every project in the store, so each test that reads one gets its own store. */
function freshStore(name: string): string {
  const dir = join(SANDBOX, name);
  process.env.DARIUS_STATE_DIR = dir;
  return dir;
}

// --- seeding, through the real core functions ------------------------------------------

function seedRitual(project: string, slug: string, mode: Policy["mode"] = "report"): void {
  const now = new Date().toISOString();
  const header: Ritual = {
    id: ulid(),
    kind: "ritual",
    slug,
    title: `Title of ${slug}`,
    created: now,
    updated: now,
    tags: [],
    cadence: "1d",
    anchor: "due",
    policy: { mode, may: [], hold: [] },
  };
  openProject(project, { create: true }).writeItem({ header, body: "Do the thing.\n" }, { who: "test" });
}

function startRun(project: string, slug: string, at?: string): string {
  const run = ulid();
  const started: LedgerLineInput = { who: "test", type: "run.started", item: `ritual/${slug}`, run };
  if (at !== undefined) started.at = at;
  appendLine(openProject(project), started);
  return run;
}

function holdRun(project: string, slug: string, run: string, questions: string[]): void {
  appendLine(openProject(project), { who: "test", type: "run.held", item: `ritual/${slug}`, run, questions });
}

function completeRun(project: string, slug: string, run: string, outcome: string, findings: string | null = null, at?: string): void {
  const store = openProject(project);
  const findingsSha = findings === null ? null : putBlob(store, findings);
  const input: LedgerLineInput = {
    who: "test",
    type: "run.completed",
    item: `ritual/${slug}`,
    run,
    outcome,
    findings_sha: findingsSha,
  };
  if (at !== undefined) input.at = at;
  appendLine(store, input);
}

/** Completes a run with findings and a result block, the way `darius run complete` stores them. */
function completeWithResult(project: string, slug: string, run: string, result: RunResult): void {
  const store = openProject(project);
  const summary = summarizeResult(result);
  const { open } = summary;
  appendLine(store, {
    who: "test",
    type: "run.completed",
    item: `ritual/${slug}`,
    run,
    outcome: "complete",
    findings_sha: putBlob(store, "# Report\nThe check ran.\n"),
    result_sha: putBlob(store, `${JSON.stringify(result, null, 2)}\n`),
    result: { status: summary.status, questions: summary.questions, open: { critical: open.critical, high: open.high, medium: open.medium, low: open.low, info: open.info }, fixed: summary.fixed },
  });
}

function answer(project: string, slug: string, run: string, n: number, text: string): void {
  appendLine(openProject(project), { who: "test", type: "run.answered", item: `ritual/${slug}`, run, n, text });
}

function localDate(ms: number): string {
  const at = new Date(ms);
  return `${String(at.getFullYear())}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

// --- helpers ---------------------------------------------------------------------------

/** Code points that are control characters: every C0 but newline, DEL, every C1. */
function controlChars(text: string): string[] {
  return [...text].filter((symbol) => {
    const code = symbol.codePointAt(0) ?? 0;
    return (code < 0x20 && symbol !== "\n") || (code >= 0x7f && code <= 0x9f);
  });
}

/** `text` without the SGR sequences paint() adds (ESC [ digits and semicolons m). */
function withoutSgr(text: string): string {
  let out = "";
  let index = 0;
  while (index < text.length) {
    if (text.startsWith(`${ESC}[`, index)) {
      let end = index + 2;
      while (end < text.length && "0123456789;".includes(text.charAt(end))) end += 1;
      if (text.charAt(end) === "m") {
        index = end + 1;
        continue;
      }
    }
    out += text.charAt(index);
    index += 1;
  }
  return out;
}

function texts(lines: readonly Line[]): string[] {
  return lines.map((row) => plain(row));
}

function key(kind: Exclude<Key["kind"], "char">): Key {
  return { kind };
}

function char(value: string): Key {
  return { kind: "char", char: value };
}

function dueView(rows: DueRow[]): View {
  const due: DueSnapshot = { host: "testhost", version: VERSION, readAt: new Date().toISOString(), rows, errors: [] };
  return { size: SIZE, due, run: null, error: null };
}

function runSnap(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    project: "p",
    run: "01RUN",
    item: "ritual/sweep",
    title: "Sweep",
    phase: "held",
    outcome: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    findings: null,
    questions: ["May I push?", "May I delete the branch?"],
    answers: new Map(),
    isAnswered: false,
    acknowledged: null,
    isEndedToday: false,
    summary: null,
    result: null,
    ...overrides,
  };
}

function runView(run: RunSnapshot | null, size: Size = SIZE): View {
  return { size, due: null, run, error: null };
}

function onRun(run: RunSnapshot): TuiState {
  return { ...initialState(), screen: "run", target: { project: run.project, run: run.run } };
}

interface Fed {
  state: TuiState;
  effects: Effect[];
}

/** Feeds keys to the reducer; returns the last state and every effect. */
function feed(start: TuiState, keys: readonly Key[], view: View): Fed {
  let state = start;
  const effects: Effect[] = [];
  for (const pressed of keys) {
    const step = reduce(state, pressed, view);
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
}

interface Spawned {
  program: string;
  args: readonly string[];
  log: string;
}

function fakeDeps(spawned: Spawned[]): TuiDeps {
  return { spawn: (program, args, log) => spawned.push({ program, args, log }), who: () => "tester" };
}

// --- text --------------------------------------------------------------------------------

const HOSTILE = `a${ESC}[2Jb${ESC}]0;pwned\u0007c\u009b31md\u0000e\u007ff\r\ng\th\u202eij`;

test("clean() strips every C0 and C1 control character, ESC included, and keeps newline", () => {
  const cleaned = clean(HOSTILE);
  assert.deepEqual(controlChars(cleaned), []);
  assert.equal(cleaned, "a[2Jb]0;pwnedc31mdef\ng  hij");
});

test("paint() prints untrusted text with no escape but its own SGR codes", () => {
  for (const hasColour of [true, false]) {
    const painted = paint({ parts: [part(HOSTILE, "needs"), part(` ${ESC}[31mred`, "plain")], isSelected: true }, 200, hasColour);
    assert.deepEqual(controlChars(withoutSgr(painted)), [], JSON.stringify(painted));
    assert.ok(!withoutSgr(painted).includes(ESC));
  }
});

test("NO_COLOR drops the colours and keeps emphasis", () => {
  assert.equal(colourAllowed({ NO_COLOR: "1" }), false);
  assert.equal(colourAllowed({ NO_COLOR: "" }), true);
  assert.equal(colourAllowed({}), true);
  const coloured = paint(line(part("wait", "needs"), part("bad", "failed")), 20, true);
  const plainOnly = paint(line(part("wait", "needs"), part("bad", "failed")), 20, false);
  assert.ok(coloured.includes(`${ESC}[33m`) && coloured.includes(`${ESC}[31m`));
  assert.ok(!plainOnly.includes(`${ESC}[33m`) && !plainOnly.includes(`${ESC}[31m`));
  assert.ok(plainOnly.includes(`${ESC}[1m`));
});

test("truncate, wrap and cells count terminal cells", () => {
  assert.equal(truncate("hello world", 5), "hell…");
  assert.equal(truncate("hello", 5), "hello");
  assert.equal(cells("日本語"), 6);
  assert.equal(truncate("日本語", 5), "日本…");
  assert.deepEqual(wrap("one two three", 7), ["one two", "three"]);
  assert.deepEqual(wrap("abcdefghij", 4), ["abcd", "efgh", "ij"]);
  assert.deepEqual(wrap("first\n    indented", 20), ["first", "    indented"]);
  for (const row of wrap("a sentence long enough to wrap several times at twelve", 12)) assert.ok(cells(row) <= 12, row);
});

test("paint() cuts every row to the width", () => {
  const painted = paint(line(part("x".repeat(50)), part("y".repeat(50), "dim")), 30, true);
  assert.equal(cells(withoutSgr(painted)), 30);
  const rows = frame([line(part("z".repeat(200)))], { cols: 10, rows: 3 }, false);
  assert.equal(rows.split(`${ESC}[2K`).length - 1, 3, "one erase per row");
  const full = frame([line(part("f".repeat(10)))], { cols: 10, rows: 1 }, false);
  assert.ok(full.endsWith("f".repeat(10)), "a row that fills the width is not erased after it is drawn");
  assert.ok(!rows.includes("z".repeat(11)));
});

// --- keys --------------------------------------------------------------------------------

test("decodeKeys reads arrows, pages, Enter, Backspace, Esc, Ctrl-C, paste markers and utf8", () => {
  assert.deepEqual(decodeKeys(`${ESC}[A${ESC}[B${ESC}[5~${ESC}[6~`), [key("up"), key("down"), key("pageup"), key("pagedown")]);
  assert.deepEqual(decodeKeys(`${ESC}OA${ESC}[1;5B`), [key("up"), key("down")]);
  assert.deepEqual(decodeKeys(ESC), [key("esc")]);
  assert.deepEqual(decodeKeys(`${ESC}${ESC}`), [key("esc"), key("esc")]);
  assert.deepEqual(decodeKeys("\r\n\r"), [key("enter"), key("enter")]);
  assert.deepEqual(decodeKeys("\u007f\b\u0003"), [key("backspace"), key("backspace"), key("ctrl-c")]);
  assert.deepEqual(decodeKeys(`${ESC}[200~a\rb${ESC}[201~`), [key("paste-start"), char("a"), key("enter"), char("b"), key("paste-end")]);
  assert.deepEqual(decodeKeys("jü😀"), [char("j"), char("ü"), char("😀")]);
});

test("decodeKeys drops unknown sequences whole, Alt combinations and stray control bytes", () => {
  assert.deepEqual(decodeKeys(`${ESC}[99Zq`), [char("q")]);
  assert.deepEqual(decodeKeys(`${ESC}xq`), [char("q")]);
  assert.deepEqual(decodeKeys("\u0000\u0007\u001a\u0085"), []);
  assert.deepEqual(decodeKeys(`${ESC}[2`), [], "a cut sequence is dropped");
});

// --- the Due list, from a store ----------------------------------------------------------

test("readDue lists held runs, then due rituals, then vigils, then failed runs, and leaves _global out", () => {
  freshStore("due-order");
  const project = "alpha";
  const yesterday = localDate(Date.now() - DAY_MS);

  seedRitual(project, "sweep");
  const held = startRun(project, "sweep");
  holdRun(project, "sweep", held, ["May I push?", "May I delete the branch?"]);
  answer(project, "sweep", held, 1, "yes");

  seedRitual(project, "heartbeat", "off");

  seedRitual(project, "late");
  const fiveDaysAgo = new Date(Date.now() - 5 * DAY_MS).toISOString();
  const old = startRun(project, "late", fiveDaysAgo);
  completeRun(project, "late", old, "complete", null, fiveDaysAgo);

  seedRitual(project, "broken");
  completeRun(project, "broken", startRun(project, "broken"), "failed", "it broke");

  seedRitual(project, "fresh");
  completeRun(project, "fresh", startRun(project, "fresh"), "complete");

  const store = openProject(project);
  addVigil(store, { slug: "date-due", title: "Date due", body: "", due: yesterday, heavy: false, who: "test" });
  addVigil(store, { slug: "event", title: "Event gated", body: "", until: "first real batch", heavy: false, who: "test" });
  addVigil(store, { slug: "red", title: "Flagged", body: "", until: "never", heavy: false, who: "test" });
  appendLine(store, { who: "test", type: "vigil.swept", item: "vigil/red", outcome: "failed" });
  addVigil(store, { slug: "done", title: "Closed", body: "", due: yesterday, heavy: false, who: "test" });
  closeVigil(store, { slug: "done", verdict: "held", by: "test", who: "test" });
  addVigil(store, { slug: "later", title: "Not yet", body: "", due: "2999-01-01", heavy: false, who: "test" });

  const now = new Date().toISOString();
  const profile: Profile = { id: ulid(), kind: "profile", slug: "fast", title: "fast", created: now, updated: now, tags: [], model: "haiku" };
  openProject(GLOBAL_PROJECT, { create: true }).writeItem({ header: profile, body: "" }, { who: "test" });

  const snapshot = readDue();
  // `broken` stays due after its failed run, but it is listed once, under "Failed today".
  assert.deepEqual(
    snapshot.rows.map((row) => `${row.kind}:${row.slug}`),
    ["held:sweep", "ritual:heartbeat", "ritual:late", "vigil:date-due", "vigil:event", "vigil:red", "failed:broken"],
  );
  assert.ok(snapshot.rows.every((row) => row.project === project), "no _global row");
  const [heldRow] = snapshot.rows;
  assert.ok(heldRow?.kind === "held");
  assert.equal(heldRow.run, held);
  assert.equal(heldRow.questions, 2);
  assert.equal(heldRow.answered, 1);

  const lines = texts(dueScreen(snapshot, initialState(), SIZE, null));
  assert.match(lines[0] ?? "", new RegExp(`^darius ${VERSION.replaceAll(".", "\\.")}  \\S+  read \\d\\d:\\d\\d:\\d\\d$`, "u"));
  const body = lines.join("\n");
  const order = ["Held, waiting for you", "Due", "Vigils", "Failed today"].map((heading) => lines.indexOf(heading));
  assert.ok(order.every((at, index) => at > 0 && (index === 0 || at > (order[index - 1] ?? 0))), JSON.stringify(order));
  assert.match(body, /> 1 {2}alpha {2}sweep {2}held, 2 questions, 1 answered/u);
  assert.match(body, /2 {2}alpha {2}heartbeat {2}due today {2}mode off/u);
  assert.match(body, /3 {2}alpha {2}late {2}overdue 4 days/u);
  assert.match(body, /5 {2}alpha {2}event {2}armed, waiting on: first real batch/u);
  assert.match(body, /6 {2}alpha {2}red {2}flagged: a check failed/u);
  assert.match(body, /7 {2}alpha {2}broken {2}failed at \d\d:\d\d:\d\d/u);
});

test("an empty store says so in one line", () => {
  freshStore("due-empty");
  seedRitual("quiet", "fresh");
  completeRun("quiet", "fresh", startRun("quiet", "fresh"), "complete");
  const snapshot = readDue();
  assert.deepEqual(snapshot.rows, []);
  const lines = texts(dueScreen(snapshot, initialState(), SIZE, null)).filter((row) => row !== "");
  assert.equal(lines.length, 3, lines.join("\n"));
  assert.equal(lines[1], "Nothing is due and no run waits for you.");
});

// --- the Run screen ----------------------------------------------------------------------

test("the Run screen shows the facts, wrapped findings without control bytes, then numbered questions and answers", () => {
  freshStore("run-screen");
  seedRitual("beta", "sweep");
  const run = startRun("beta", "sweep");
  holdRun("beta", "sweep", run, ["May I push the fix to main now?", "May I delete the branch?"]);
  answer("beta", "sweep", run, 1, "yes, push it");
  const findings = `# Report\nThe title is ${ESC}]0;owned${ESC}\\ and ${ESC}[2J${ESC}[Hcleared${ESC}[8mhidden\n${"word ".repeat(30)}`;
  completeRun("beta", "sweep", run, "failed", findings);

  const snapshot = readRun({ project: "beta", run });
  assert.ok(snapshot !== null);
  assert.equal(snapshot.findings, findings, "the raw markdown, not parsed");
  const size: Size = { cols: 40, rows: 60 };
  const screen = runScreen(snapshot, onRun(snapshot), size, null);
  const lines = texts(screen);
  assert.equal(lines[0], "Title of sweep  ritual/sweep  beta");
  assert.equal(lines[1], `run ${run}`);
  assert.equal(lines[2], "closed, failed");
  assert.equal(lines[3], "not retried today. n runs it now, a marks it seen");
  assert.match(lines[4] ?? "", /^started \d{4}-\d\d-\d\d \d\d:\d\d {2}ended \d{4}-\d\d-\d\d \d\d:\d\d$/u);
  assert.ok(lines.includes("Findings"));
  assert.ok(lines.includes("# Report"));
  assert.ok(lines.some((row) => row.includes("[2J[Hcleared[8mhidden")), "the escapes print as plain text");
  assert.ok(lines.includes("Questions"));
  assert.ok(lines.includes("1. May I push the fix to main now?"));
  assert.ok(lines.includes("   answer: yes, push it"));
  assert.ok(lines.includes("2. May I delete the branch?"));
  assert.ok(lines.includes("   no answer yet"));
  for (const row of screen) {
    const painted = paint(row, size.cols, true);
    assert.ok(cells(withoutSgr(painted)) <= size.cols, plain(row));
    assert.deepEqual(controlChars(withoutSgr(painted)), []);
  }
});

test("the Run screen of an unknown run says so", () => {
  const lines = texts(render({ ...initialState(), screen: "run", target: { project: "nope", run: "01X" } }, runView(null)));
  assert.equal(lines[0], "Run not found");
});

// --- the reducer ---------------------------------------------------------------------------

const ROWS: DueRow[] = [
  { kind: "held", project: "p", slug: "sweep", run: "01HELD", questions: 2, answered: 0 },
  { kind: "ritual", project: "p", slug: "heartbeat", title: "Heartbeat", nextDue: null, overdueDays: 0, isOff: false, isRunning: false, isAcknowledgedFailure: false, host: null, latestRun: null },
  { kind: "vigil", project: "p", slug: "soak", title: "Soak", gate: "armed", due: null, until: "batch" },
  { kind: "failed", project: "p", slug: "broken", run: "01FAIL", endedAt: new Date().toISOString() },
];

test("Due keys: j/k and arrows move, a digit picks a row, Enter opens it, q quits", () => {
  const view = dueView(ROWS);
  assert.equal(feed(initialState(), [char("j"), key("down"), char("k")], view).state.selected, 1);
  assert.equal(feed(initialState(), [key("up"), char("k")], view).state.selected, 0, "the top stops");
  assert.equal(feed(initialState(), [char("j"), char("j"), char("j"), char("j"), char("j")], view).state.selected, 3, "the bottom stops");

  const opened = feed(initialState(), [char("4"), key("enter")], view).state;
  assert.equal(opened.screen, "run");
  assert.deepEqual(opened.target, { project: "p", run: "01FAIL" });

  const noRow = feed(initialState(), [char("9")], view).state;
  assert.equal(noRow.notice?.text, "there is no row 9");
  assert.equal(noRow.selected, 0);

  const vigil = feed(initialState(), [char("3"), key("enter")], view).state;
  assert.equal(vigil.screen, "due");
  assert.equal(vigil.notice?.text, "a vigil has no run screen; run: darius vigil show soak --project p");

  const neverRan = feed(initialState(), [char("2"), key("enter")], view).state;
  assert.equal(neverRan.notice?.text, "ritual heartbeat has no runs yet");

  assert.equal(feed(initialState(), [char("q")], view).state.isDone, true);
  assert.equal(feed(initialState(), [key("ctrl-c")], view).state.isDone, true);
});

test("Due keys: two digits pick row 10 and up; a digit that does not fit starts over", () => {
  const rows: DueRow[] = Array.from({ length: 12 }, (_, index) => ({ kind: "failed", project: "p", slug: `r${String(index)}`, run: `01R${String(index)}`, endedAt: "2026-09-29T10:00:00Z" }));
  const view = dueView(rows);
  const twelve = feed(initialState(), [char("1"), char("2")], view).state;
  assert.equal(twelve.selected, 11);
  assert.equal(twelve.typed, "12");
  const three = feed(initialState(), [char("1"), char("3")], view).state;
  assert.equal(three.selected, 2, "13 does not exist, so 3 alone");
  assert.equal(feed(twelve, [key("enter")], view).state.target?.run, "01R11");
});

test("Run keys: Esc and Backspace go back, j/k and pages scroll within the body", () => {
  const findings = Array.from({ length: 100 }, (_, index) => `line ${String(index + 1)}`).join("\n");
  const run = runSnap({ phase: "closed", outcome: "complete", findings, questions: [] });
  const view = runView(run, { cols: 60, rows: 20 });
  const state = onRun(run);
  const paged = feed(state, [char(" ")], view).state;
  assert.ok(paged.scroll > 5, String(paged.scroll));
  assert.equal(feed(paged, [char("k")], view).state.scroll, paged.scroll - 1);
  assert.equal(feed(state, [key("pageup"), char("k")], view).state.scroll, 0);
  const bottom = feed(state, Array.from({ length: 30 }, () => key("pagedown")), view).state;
  const lines = texts(render(bottom, view));
  assert.ok(lines.includes("line 100"));
  assert.match(lines.at(-1) ?? "", /lines \d+-101 of 101$/u);
  assert.equal(feed(state, [key("esc")], view).state.screen, "due");
  assert.equal(feed(state, [key("backspace")], view).state.screen, "due");
});

test("the answer prompt: a digit opens it, text echoes, Backspace deletes, Enter saves, Esc cancels", () => {
  const run = runSnap();
  const view = runView(run);
  const typing = feed(onRun(run), [char("2"), char("n"), char("o"), char("p"), key("backspace"), char("!")], view).state;
  assert.deepEqual(typing.prompt, { kind: "answer", n: 2, text: "no!" });
  const lines = texts(render(typing, view));
  assert.ok(lines.includes("Answer question 2: May I delete the branch?"));
  assert.ok(lines.includes("> no! "));
  assert.equal(feed(typing, [char("q")], view).state.isDone, false, "q is text inside the prompt");

  const saved = feed(typing, [key("enter")], view);
  assert.equal(saved.state.prompt, null);
  assert.deepEqual(saved.effects, [{ kind: "answer", target: { project: "p", run: "01RUN" }, n: 2, text: "no!" }]);

  const cancelled = feed(typing, [key("esc")], view);
  assert.equal(cancelled.state.prompt, null);
  assert.equal(cancelled.state.screen, "run", "Esc closes the prompt, not the screen");
  assert.deepEqual(cancelled.effects, []);

  const empty = feed(onRun(run), [char("1"), char(" "), key("enter")], view);
  assert.deepEqual(empty.effects, []);
  assert.equal(empty.state.notice?.text, "type an answer, or press Esc to cancel");
  assert.equal(feed(typing, [key("ctrl-c")], view).state.isDone, true);
});

test("the answer prompt refuses a closed run and a question that does not exist", () => {
  const closed = runSnap({ phase: "closed", outcome: "complete" });
  assert.equal(feed(onRun(closed), [char("1")], runView(closed)).state.notice?.text, "the run is closed; only a held run takes answers");
  const held = runSnap();
  const three = feed(onRun(held), [char("3")], runView(held)).state;
  assert.equal(three.prompt, null);
  assert.equal(three.notice?.text, "there is no question 3; the run has 2 questions");
});

test("a paste lands in the prompt as one line and is ignored outside it", () => {
  const run = runSnap();
  const view = runView(run);
  const pasted = feed(onRun(run), [char("1"), ...decodeKeys(`${ESC}[200~first line\r\nsecond${ESC}[201~`)], view);
  assert.deepEqual(pasted.state.prompt, { kind: "answer", n: 1, text: "first line second" });
  assert.deepEqual(pasted.effects, []);

  const outside = feed(onRun(run), decodeKeys(`${ESC}[200~r1q${ESC}[201~`), view);
  assert.equal(outside.state.isDone, false);
  assert.equal(outside.state.prompt, null);
  assert.deepEqual(outside.effects, []);
});

test("r resumes only a held run with an answer, and only once per hold", () => {
  const unanswered = runSnap();
  const refused = feed(onRun(unanswered), [char("r")], runView(unanswered));
  assert.deepEqual(refused.effects, []);
  assert.equal(refused.state.notice?.text, "answer a question first");

  const running = runSnap({ phase: "running" });
  assert.equal(feed(onRun(running), [char("r")], runView(running)).state.notice?.text, "the run is running; only a held run can resume");

  const answered = runSnap({ answers: new Map([[1, "yes"]]), isAnswered: true });
  const first = feed(onRun(answered), [char("r")], runView(answered));
  assert.deepEqual(first.effects, [{ kind: "resume", target: { project: "p", run: "01RUN" } }]);
  const second = feed(first.state, [char("r")], runView(answered));
  assert.deepEqual(second.effects, []);
  assert.match(second.state.notice?.text ?? "", /already started/u);

  const heldAgain = runSnap({ questions: ["May I push?", "May I delete the branch?", "And tag it?"], answers: new Map([[3, "yes"]]), isAnswered: true });
  assert.equal(feed(second.state, [char("r")], runView(heldAgain)).effects.length, 1, "a second hold resumes again");
});

// --- effects and the whole path ----------------------------------------------------------------

test("keys to store: open the held run, answer question 1, resume through the fake spawner", () => {
  const store = freshStore("flow");
  seedRitual("flow", "sweep");
  const run = startRun("flow", "sweep");
  holdRun("flow", "sweep", run, ["May I push?", "May I delete the branch?"]);
  const spawned: Spawned[] = [];
  const deps = fakeDeps(spawned);

  let pressed: Pressed = { state: initialState(), view: loadView(initialState(), SIZE) };
  pressed = pressKeys(pressed, "1\r", deps);
  assert.equal(pressed.state.screen, "run");
  assert.equal(pressed.view.run?.run, run);

  pressed = pressKeys(pressed, "r", deps);
  assert.equal(pressed.state.notice?.text, "answer a question first");
  assert.deepEqual(spawned, []);

  pressed = pressKeys(pressed, "1yes, push it\r", deps);
  assert.equal(pressed.state.notice?.text, "saved the answer to question 1");
  const answered = readLedger(openProject("flow")).filter((entry) => entry.type === "run.answered");
  assert.equal(answered.length, 1);
  assert.equal(answered[0]?.run, run);
  assert.equal(answered[0]?.n, 1);
  assert.equal(answered[0]?.text, "yes, push it");
  assert.equal(answered[0]?.who, "tester");
  assert.equal(pressed.view.run?.answers.get(1), "yes, push it", "the screen reads the answer back");
  assert.ok(texts(render(pressed.state, pressed.view)).includes("   answer: yes, push it"));

  pressed = pressKeys(pressed, "r", deps);
  const log = join(store, "flow", "runs", run, "resume.log");
  assert.equal(resumeLog({ project: "flow", run }), log);
  assert.deepEqual(spawned, [{ program: dariusBin(), args: ["run", "resume", run, "--project", "flow"], log }]);
  assert.ok(existsSync(dirname(log)));
  assert.match(readFileSync(log, "utf8"), /darius tui: darius run resume \S+ --project flow\n$/u);
  assert.equal(pressed.state.notice?.text, `resuming in the background; the report goes to the webhook, or to the log without one: ${log}`);
  assert.ok(texts(render(pressed.state, pressed.view)).includes(log), "the notice wraps, so the log path shows whole");

  pressed = pressKeys(pressed, "r", deps);
  assert.equal(spawned.length, 1, "a second r does not start another resume");

  pressed = pressKeys(pressed, `${ESC}`, deps);
  assert.equal(pressed.state.screen, "due");
  assert.equal(pressKeys(pressed, "q", deps).state.isDone, true);
});

test("an answer the store refuses shows the refusal", () => {
  freshStore("refused");
  seedRitual("gone", "sweep");
  const run = startRun("gone", "sweep");
  holdRun("gone", "sweep", run, ["May I?"]);
  completeRun("gone", "sweep", run, "abandoned");
  const notice = performEffect({ kind: "answer", target: { project: "gone", run }, n: 1, text: "yes" }, fakeDeps([]));
  assert.equal(notice.isError, true);
  assert.match(notice.text, /is not held \(phase: closed\)/u);
  const missing = performEffect({ kind: "answer", target: { project: "no-such-project", run }, n: 1, text: "yes" }, fakeDeps([]));
  assert.equal(missing.isError, true);
});

// --- acknowledge and run now (0.18.0) ---------------------------------------------------------

test("an acknowledged failure leaves Failed today and shows under Due, dimmed", () => {
  freshStore("due-ack");
  seedRitual("gamma", "broken");
  const run = startRun("gamma", "broken");
  completeRun("gamma", "broken", run, "failed", "it broke");
  assert.deepEqual(readDue().rows.map((row) => `${row.kind}:${row.slug}`), ["failed:broken"]);

  assert.equal(acknowledgeRun(openProject("gamma"), { run, who: "tester" }).ok, true);
  const snapshot = readDue();
  assert.deepEqual(snapshot.rows.map((row) => `${row.kind}:${row.slug}`), ["ritual:broken"]);
  const [row] = snapshot.rows;
  assert.ok(row?.kind === "ritual");
  assert.equal(row.isAcknowledgedFailure, true);
  assert.equal(row.latestRun, run, "Enter still opens the failed run");
  const screen = dueScreen(snapshot, initialState(), SIZE, null);
  const rowLine = screen.find((entry) => plain(entry).includes("broken"));
  assert.match(plain(rowLine ?? line()), /1 {2}gamma {2}broken {2}due today {2}failed today, acknowledged/u);
  assert.ok(rowLine?.parts.some((entry) => entry.text.includes("failed today, acknowledged") && entry.tone === "dim"));
  assert.equal(texts(screen).includes("Failed today"), false);
});

test("a Due row names the host pin, dimmed", () => {
  const pinned: DueRow = { kind: "ritual", project: "p", slug: "sweep", title: "Sweep", nextDue: null, overdueDays: 0, isOff: false, isRunning: false, isAcknowledgedFailure: false, host: "host-b", latestRun: null };
  const screen = dueScreen(dueView([pinned]).due, initialState(), SIZE, null);
  const row = screen.find((entry) => plain(entry).includes("sweep"));
  assert.match(plain(row ?? line()), /sweep {2}due today {2}pinned to host-b {2}Sweep$/u);
  assert.ok(row?.parts.some((entry) => entry.text === "  pinned to host-b" && entry.tone === "dim"));
});

test("the Run screen of a failed run: the next-step line, then who saw it; a and n keys in the hints", () => {
  const failed = runSnap({ phase: "closed", outcome: "failed", questions: [], endedAt: new Date().toISOString(), isEndedToday: true });
  const screen = render(onRun(failed), runView(failed));
  const lines = texts(screen);
  assert.equal(lines[2], "closed, failed");
  assert.equal(screen[2]?.parts[0]?.tone, "failed");
  assert.equal(lines[3], "not retried today. n runs it now, a marks it seen");
  assert.equal(lines.at(-1), "a acknowledge  n run now  j/k scroll  Space page  Esc back  q quit");
  const older = texts(render(onRun({ ...failed, isEndedToday: false }), runView({ ...failed, isEndedToday: false })));
  assert.equal(older[3], "n runs it now, a marks it seen");

  const seen = { ...failed, acknowledged: { at: "2026-09-29T10:00:00.000Z", who: "tester", note: `known${ESC}[2J outage` } };
  const seenScreen = render(onRun(seen), runView(seen));
  assert.equal(seenScreen[2]?.parts[0]?.tone, "plain", "an acknowledged failure is not red");
  const seenLines = texts(seenScreen);
  assert.match(seenLines[3] ?? "", /^acknowledged by tester at \d{4}-\d\d-\d\d \d\d:\d\d: known\[2J outage$/u);
  assert.equal(seenLines.at(-1), "n run now  j/k scroll  Space page  Esc back  q quit");

  const complete = runSnap({ phase: "closed", outcome: "complete", questions: [] });
  const plainLines = texts(render(onRun(complete), runView(complete)));
  assert.match(plainLines[3] ?? "", /^started /u, "no extra line for a complete run");
  assert.equal(plainLines.at(-1), "j/k scroll  Space page  Esc back  q quit");
});

test("a and n do nothing on a held, running or complete run", () => {
  for (const run of [runSnap(), runSnap({ phase: "running" }), runSnap({ phase: "closed", outcome: "complete" })]) {
    const fed = feed(onRun(run), [char("a"), char("n")], runView(run));
    assert.deepEqual(fed.effects, [], run.phase);
    assert.equal(fed.state.notice, null, run.phase);
    assert.deepEqual(fed.state.rerun, []);
  }
  const vigil = runSnap({ phase: "closed", outcome: "failed", item: "vigil/soak" });
  assert.deepEqual(feed(onRun(vigil), [char("a"), char("n")], runView(vigil)).effects, [], "a vigil check is no ritual");
});

test("keys to store: a acknowledges the failed run, n starts run now once through the fake spawner", () => {
  const store = freshStore("ack-flow");
  seedRitual("delta", "broken");
  const run = startRun("delta", "broken");
  completeRun("delta", "broken", run, "failed", "it broke");
  const spawned: Spawned[] = [];
  const deps = fakeDeps(spawned);

  let pressed: Pressed = { state: initialState(), view: loadView(initialState(), SIZE) };
  pressed = pressKeys(pressed, "1\r", deps);
  assert.equal(pressed.view.run?.run, run);
  assert.equal(pressed.view.run?.isEndedToday, true);

  pressed = pressKeys(pressed, "a", deps);
  assert.equal(pressed.state.notice?.text, "acknowledged the run; the timer still does not retry it today");
  const acked = readLedger(openProject("delta")).filter((entry) => entry.type === "run.acknowledged");
  assert.deepEqual(acked.map((entry) => [entry.run, entry.who, entry.note]), [[run, "tester", undefined]]);
  assert.match(texts(render(pressed.state, pressed.view))[3] ?? "", /^acknowledged by tester at /u, "the screen reads it back");
  pressed = pressKeys(pressed, "a", deps);
  assert.equal(pressed.state.notice?.text, "the run is already acknowledged by tester");

  pressed = pressKeys(pressed, "n", deps);
  const log = join(store, "delta", "runs", run, "rerun.log");
  assert.equal(rerunLog({ project: "delta", run }), log);
  assert.deepEqual(spawned, [{ program: dariusBin(), args: ["run", "now", "broken", "--project", "delta"], log }]);
  assert.match(readFileSync(log, "utf8"), /darius tui: darius run now broken --project delta\n$/u);
  assert.equal(pressed.state.notice?.text, `running broken now in the background; the report goes to the webhook, or to the log without one: ${log}`);
  pressed = pressKeys(pressed, "n", deps);
  assert.equal(spawned.length, 1, "a second n does not start another run");
  assert.match(pressed.state.notice?.text ?? "", /already started/u);
});

// --- run results (0.22.0) --------------------------------------------------------------------

const ASKING: RunResult = {
  v: 1,
  status: "attention",
  summary: "37 posts checked; 1 critical fixed, 1 question.",
  metrics: [{ label: "Posts checked", value: 37 }],
  items: [
    { title: "Broken link on the pricing page", severity: "critical", state: "fixed", group: "site-a" },
    { title: "Wrong opening hours", severity: "high", state: "open", group: "site-a" },
  ],
  questions: [{ text: "Delete the two old landing pages on site-c now?", recommendation: "Yes, delete them." }],
  actions: [],
};

const CLEAN: RunResult = { v: 1, status: "ok", summary: "All fine.", metrics: [], items: [], questions: [], actions: [] };

test("readDue lists a complete run that asks under Asks you, after the held runs, until someone decides", () => {
  freshStore("due-asks");
  seedRitual("omega", "sweep");
  const held = startRun("omega", "sweep");
  holdRun("omega", "sweep", held, ["May I push?"]);
  seedRitual("omega", "check");
  const asks = startRun("omega", "check");
  completeWithResult("omega", "check", asks, ASKING);
  seedRitual("omega", "calm");
  completeWithResult("omega", "calm", startRun("omega", "calm"), CLEAN);

  const snapshot = readDue();
  assert.deepEqual(snapshot.rows.map((row) => `${row.kind}:${row.slug}`), ["held:sweep", "asks:check"], "a result without questions is not listed");
  const lines = texts(dueScreen(snapshot, initialState(), SIZE, null));
  const heldAt = lines.indexOf("Held, waiting for you");
  const asksAt = lines.indexOf("Asks you");
  assert.ok(heldAt > 0 && asksAt > heldAt, JSON.stringify(lines));
  assert.match(lines.join("\n"), /2 {2}omega {2}check {2}complete, 1 question for you/u);
  const screen = dueScreen(snapshot, initialState(), SIZE, null);
  assert.equal(screen[asksAt]?.parts[0]?.tone, "needs", "the heading in the waiting tone");

  const opened = feed(initialState(), [char("2"), key("enter")], dueView(snapshot.rows)).state;
  assert.deepEqual(opened.target, { project: "omega", run: asks }, "Enter opens the run");

  assert.equal(acknowledgeRun(openProject("omega"), { run: asks, who: "tester", note: "yes, delete them" }).ok, true);
  assert.deepEqual(readDue().rows.map((row) => `${row.kind}:${row.slug}`), ["held:sweep"], "a decision takes it off the list");
});

test("the Run screen shows the result: status, summary, open counts, the questions with recommendations, and the a key", () => {
  freshStore("run-result");
  seedRitual("sigma", "check");
  const run = startRun("sigma", "check");
  completeWithResult("sigma", "check", run, { ...ASKING, summary: `37 posts${ESC}[2J checked` });
  const snapshot = readRun({ project: "sigma", run });
  assert.ok(snapshot !== null);
  assert.deepEqual(snapshot.summary, { status: "attention", questions: 1, open: { critical: 0, high: 1, medium: 0, low: 0, info: 0 }, fixed: 1 });
  assert.equal(snapshot.result?.questions[0]?.recommendation, "Yes, delete them.");

  const size: Size = { cols: 60, rows: 60 };
  const screen = runScreen(snapshot, onRun(snapshot), size, null);
  const lines = texts(screen);
  assert.equal(lines[2], "closed, complete");
  assert.equal(lines[3], "asks you 1 question. a records your decision");
  assert.equal(screen[3]?.parts[0]?.tone, "needs");
  const result = lines.indexOf("Result");
  const findings = lines.indexOf("Findings");
  assert.ok(result > 0 && findings > result, "the result comes before the findings");
  assert.equal(lines[result + 1], "result needs attention");
  assert.ok(lines.includes("open: 1 high; 1 fixed"));
  assert.ok(lines.includes("Questions for you"));
  assert.ok(lines.includes("1. Delete the two old landing pages on site-c now?"));
  assert.ok(lines.includes("   recommended: Yes, delete them."));
  assert.ok(lines.some((row) => row.startsWith("Press a to record your decision.")));
  assert.equal(lines.at(-1), "a decide  j/k scroll  Space page  Esc back  q quit");
  for (const row of screen) {
    const painted = paint(row, size.cols, true);
    assert.ok(cells(withoutSgr(painted)) <= size.cols, plain(row));
    assert.deepEqual(controlChars(withoutSgr(painted)), []);
  }

  const bare = runSnap({ phase: "closed", outcome: "complete", questions: [], summary: { status: "ok", questions: 0, open: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }, fixed: 0 } });
  const bareLines = texts(render(onRun(bare), runView(bare)));
  assert.ok(bareLines.includes("result ok") && bareLines.includes("The full result is not on this host.") && bareLines.includes("nothing open"), "the counts without the blob");
  assert.deepEqual(feed(onRun(bare), [char("a")], runView(bare)).effects, [], "nothing to decide");
});

test("the decision prompt: a opens it, Esc cancels, an empty Enter is refused", () => {
  const asks = runSnap({ phase: "closed", outcome: "complete", questions: [], summary: { status: "attention", questions: 2, open: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }, fixed: 0 } });
  const view = runView(asks);
  const typing = feed(onRun(asks), [char("a"), char("n"), char("o")], view).state;
  assert.deepEqual(typing.prompt, { kind: "decision", text: "no" });
  assert.ok(texts(render(typing, view)).includes("Your decision on 2 questions:"));
  assert.equal(feed(typing, [key("esc")], view).state.notice?.text, "the decision was not saved");
  const empty = feed(onRun(asks), [char("a"), key("enter")], view);
  assert.deepEqual(empty.effects, []);
  assert.equal(empty.state.notice?.text, "type your decision, or press Esc to cancel");
  const saved = feed(typing, [key("enter")], view);
  assert.deepEqual(saved.effects, [{ kind: "ack", target: { project: "p", run: "01RUN" }, note: "no" }]);

  const answered = { ...asks, acknowledged: { at: "2026-09-30T10:00:00.000Z", who: "tester", note: "no" } };
  const again = feed(onRun(answered), [char("a")], runView(answered));
  assert.deepEqual(again.effects, []);
  assert.equal(again.state.notice?.text, "the run is already answered by tester");
});

test("keys to store: a on a run that asks saves the decision as the acknowledgement note", () => {
  freshStore("decide-flow");
  seedRitual("tau", "check");
  const run = startRun("tau", "check");
  completeWithResult("tau", "check", run, ASKING);
  const deps = fakeDeps([]);

  let pressed: Pressed = { state: initialState(), view: loadView(initialState(), SIZE) };
  pressed = pressKeys(pressed, "1\r", deps);
  assert.equal(pressed.view.run?.run, run);
  pressed = pressKeys(pressed, "ayes, delete them\r", deps);
  assert.equal(pressed.state.notice?.text, "saved your decision as the run's acknowledgement");
  const acked = readLedger(openProject("tau")).filter((entry) => entry.type === "run.acknowledged");
  assert.deepEqual(acked.map((entry) => [entry.run, entry.who, entry.note]), [[run, "tester", "yes, delete them"]]);
  const lines = texts(render(pressed.state, pressed.view));
  assert.match(lines[3] ?? "", /^answered by tester at \d{4}-\d\d-\d\d \d\d:\d\d: yes, delete them$/u, "the screen reads the decision back");
  assert.equal(lines.at(-1), "j/k scroll  Space page  Esc back  q quit");
  assert.equal(lines.some((row) => row.startsWith("Press a")), false, "no key left to press");
  pressed = pressKeys(pressed, "a", deps);
  assert.equal(pressed.state.notice?.text, "the run is already answered by tester");
});

// --- the command -----------------------------------------------------------------------------

test("darius tui refuses without a terminal; bare darius in a pipe still prints help", () => {
  const tui = spawnSync(BIN, ["tui"], { encoding: "utf8" });
  assert.equal(tui.status, 2);
  assert.match(tui.stderr, /tui needs a terminal/u);
  const bare = spawnSync(BIN, [], { encoding: "utf8" });
  assert.equal(bare.status, 0);
  assert.match(bare.stdout, /darius tui\s+the Due and Run screens/u);
});
