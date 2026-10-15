/**
 * The ritual page's History and trail (0.91.0, web/app/lib/ritual-activity.ts):
 * a follow-up nests under its parent, a run that read an answer says so, the
 * timeline groups by day, and "Last decision" names the newest decision.
 * The Runs list filters (0.93.0, web/app/lib/runs-filter.ts) and the words of
 * the result chip are here too. Pure data in, plain data out.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import type { ActivityEntry, RunRow } from "../src/web/api.ts";
import { ANY_RUNS, type RunsFilter } from "../web/app/lib/paths.ts";
import { ackKindOf, summaryTags } from "../web/app/lib/result.ts";
import { lastDecision, nestRuns, runNotes, timelineDays } from "../web/app/lib/ritual-activity.ts";
import { filterSentence, runMatches } from "../web/app/lib/runs-filter.ts";

function run(id: string, startedAt: string, extra: Partial<RunRow> = {}): RunRow {
  return { run: id, item: "ritual/report", phase: "closed", outcome: "complete", startedAt, endedAt: startedAt, who: "timer", questions: [], findingsSha: null, result: null, acknowledged: null, followUpOf: null, startedBy: "timer", ackKind: null, ...extra };
}

function entry(kind: ActivityEntry["kind"], at: string, extra: Partial<ActivityEntry> = {}): ActivityEntry {
  return { at, who: "web:altan", actor: "web", kind, item: { type: "run", id: extra.run ?? "01RUN", title: "Report" }, text: "", links: { ritual: "report", run: extra.run ?? "01RUN" }, tone: "ok", ...extra };
}

const CLOCK = { offset: 0 };

test("a follow-up nests under its parent, newest first, and nothing disappears", () => {
  const rows = [run("C2", "2026-10-15T10:00:00.000Z", { followUpOf: "P" }), run("X", "2026-10-15T09:30:00.000Z"), run("C1", "2026-10-15T09:00:00.000Z", { followUpOf: "P" }), run("P", "2026-10-15T08:00:00.000Z"), run("ORPHAN", "2026-10-14T08:00:00.000Z", { followUpOf: "GONE" })];
  const nested = nestRuns(rows);
  assert.deepEqual(nested.map((one) => one.row.run), ["X", "P", "ORPHAN"]);
  assert.deepEqual(nested[1]?.children.map((child) => child.run), ["C2", "C1"]);
  assert.equal(nested.reduce((sum, one) => sum + 1 + one.children.length, 0), rows.length);
});

test("a follow-up of a follow-up goes under the first run of the chain, and a loop of follow-ups stays on top", () => {
  const chain = [run("G", "2026-10-15T11:00:00.000Z", { followUpOf: "C" }), run("C", "2026-10-15T10:00:00.000Z", { followUpOf: "P" }), run("P", "2026-10-15T09:00:00.000Z")];
  const nested = nestRuns(chain);
  assert.deepEqual(nested.map((one) => [one.row.run, one.children.map((child) => child.run)]), [["P", ["G", "C"]]]);
  const loop = [run("A", "2026-10-15T11:00:00.000Z", { followUpOf: "B" }), run("B", "2026-10-15T10:00:00.000Z", { followUpOf: "A" })];
  assert.deepEqual(nestRuns(loop).map((one) => [one.row.run, one.children.length]), [["A", 0], ["B", 0]]);
});

test("a run that follows itself stays on top level", () => {
  const loop = run("L", "2026-10-15T08:00:00.000Z", { followUpOf: "L" });
  assert.deepEqual(nestRuns([loop]).map((one) => one.row.run), ["L"]);
});

test("History notes: who started a follow-up and what it was told, and which answer a run read", () => {
  const entries = [
    entry("run-started", "2026-10-15T09:13:00.000Z", { run: "R1", text: "Run started by timer", who: "timer", actor: "timer", detail: ["Read 1 answer"] }),
    entry("follow-up-started", "2026-10-15T09:20:00.000Z", { run: "F1", text: "Follow-up of P started by web:altan: approved Q2; note: be careful" }),
    entry("follow-up-started", "2026-10-15T09:25:00.000Z", { run: "F2", text: "Follow-up of P started by web:altan" }),
    entry("ack-answered", "2026-10-15T09:12:00.000Z", { run: "P", text: "Answered by web:altan", detail: ["Q1: y"] }),
  ];
  const notes = runNotes(entries, CLOCK);
  assert.equal(notes.get("F1"), "follow-up by web:altan, approved Q2");
  assert.equal(notes.get("F2"), "follow-up by web:altan");
  assert.equal(notes.get("R1"), "read your answer of 09:12");
  assert.equal(notes.has("P"), false);
});

test("the timeline groups by the host's day, newest first", () => {
  const entries = [entry("ack-note", "2026-10-15T23:30:00.000Z"), entry("ack-note", "2026-10-15T08:00:00.000Z"), entry("ack-note", "2026-10-14T22:00:00.000Z")];
  const days = timelineDays(entries, "2026-10-15", 0);
  assert.deepEqual(days.map((day) => [day.label, day.entries.length]), [["Today", 2], ["Wed 14 Oct", 1]]);
  assert.deepEqual(timelineDays(entries, "2026-10-16", 120).map((day) => [day.date, day.label]), [["2026-10-16", "Today"], ["2026-10-15", "Thu 15 Oct"]], "the host clock moves the day");
  assert.deepEqual(timelineDays([], "2026-10-15", 0), []);
});

test("Last decision: an answer says how many answers wait and when the next run is; a read answer names its run", () => {
  const answered = entry("ack-answered", "2026-10-15T09:12:00.000Z", { run: "P", text: "Answered by web:altan", detail: ["Q1: y", "Q2: n"] });
  assert.equal(lastDecision([answered], [], "Fri 16 Oct 05:00 Europe/Berlin", CLOCK), "Answered by web:altan at 09:12, 2 answers wait for the next run, Fri 16 Oct 05:00 Europe/Berlin");
  const read = entry("run-started", "2026-10-15T10:00:00.000Z", { run: "R9ABCDEFGH", text: "Run started by timer", who: "timer", actor: "timer", detail: ["Read 2 answers"] });
  assert.equal(lastDecision([read, answered], [], null, CLOCK), "Answered by web:altan at 09:12, read by run R9ABCDEFGH");
});

test("Last decision: a follow-up the operator started says where it stands", () => {
  const started = entry("follow-up-started", "2026-10-15T09:12:00.000Z", { run: "F1", text: "Follow-up of P started by web:altan: approved Q2" });
  const done = run("F1", "2026-10-15T09:12:00.000Z", { followUpOf: "P", result: { status: "ok", questions: 0, open: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }, fixed: 1 } });
  assert.equal(lastDecision([started], [done], null, CLOCK), "Follow-up of P started by web:altan at 09:12: approved Q2, done, 1 changed");
});

test("Last decision: nothing decided, nothing said; the starts and sweeps of other kinds do not count", () => {
  assert.equal(lastDecision([], [], null, CLOCK), null);
  assert.equal(lastDecision([entry("run-completed", "2026-10-15T09:12:00.000Z", { text: "Run completed" })], [], null, CLOCK), null);
});

// --- the Runs list filters (0.93.0) ----------------------------------------------------------

const ASKS = { status: "attention", questions: 2, open: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }, fixed: 0 } as const;

function find(filter: Partial<RunsFilter>, rows: readonly RunRow[]): string[] {
  return rows.filter((one) => runMatches(one, { ...ANY_RUNS, ...filter })).map((one) => one.run);
}

const LIST: RunRow[] = [
  run("TIMER", "2026-10-15T05:00:00.000Z"),
  run("HAND", "2026-10-15T06:00:00.000Z", { who: "altan@host", startedBy: "cli" }),
  run("WEB", "2026-10-15T07:00:00.000Z", { who: "web:altan", startedBy: "web" }),
  run("FOLLOW", "2026-10-15T08:00:00.000Z", { who: "web:altan", startedBy: "web", followUpOf: "TIMER" }),
  run("FOLLOW-TIMER", "2026-10-15T08:30:00.000Z", { followUpOf: "HAND" }),
  run("ANSWERED", "2026-10-14T05:00:00.000Z", { result: ASKS, acknowledged: { at: "x", who: "web:altan", note: null }, ackKind: "answered" }),
  run("DISMISSED", "2026-10-13T05:00:00.000Z", { result: ASKS, acknowledged: { at: "x", who: "web:altan", note: null }, ackKind: "dismissed" }),
  run("OPEN", "2026-10-12T05:00:00.000Z", { result: ASKS }),
  run("RUNNING", "2026-10-15T09:00:00.000Z", { phase: "running", outcome: null, endedAt: null }),
  run("FAILED", "2026-10-11T05:00:00.000Z", { outcome: "failed" }),
];

test("the kind filter: a follow-up has a parent, scheduled is the timer's, manual is a hand's", () => {
  assert.deepEqual(find({ kind: "follow-up" }, LIST), ["FOLLOW", "FOLLOW-TIMER"]);
  assert.deepEqual(find({ kind: "scheduled" }, LIST), ["TIMER", "ANSWERED", "DISMISSED", "OPEN", "RUNNING", "FAILED"]);
  assert.deepEqual(find({ kind: "manual" }, LIST), ["HAND", "WEB"]);
  assert.deepEqual(find({}, LIST), LIST.map((one) => one.run), "no filter keeps every run");
});

test("the by filter reads who started the run, and it combines with the kind", () => {
  assert.deepEqual(find({ by: "web" }, LIST), ["WEB", "FOLLOW"]);
  assert.deepEqual(find({ by: "cli" }, LIST), ["HAND"]);
  assert.deepEqual(find({ by: "timer", kind: "follow-up" }, LIST), ["FOLLOW-TIMER"]);
  assert.deepEqual(find({ by: "web", kind: "scheduled" }, LIST), [], "no match is an empty list, not an error");
});

test("the ack filter: answered and dismissed read the first acknowledgement, open is an ask nobody decided on", () => {
  assert.deepEqual(find({ ack: "answered" }, LIST), ["ANSWERED"]);
  assert.deepEqual(find({ ack: "dismissed" }, LIST), ["DISMISSED"]);
  assert.deepEqual(find({ ack: "open" }, LIST), ["OPEN"]);
  const seen = run("SEEN", "2026-10-10T05:00:00.000Z", { outcome: "failed", acknowledged: { at: "x", who: "web:altan", note: null }, ackKind: "dismissed" });
  assert.deepEqual(find({ ack: "dismissed" }, [...LIST, seen]), ["DISMISSED"], "the seen-it ack of a failed run asked no question, so it is no dismissal");
  const older = run("OLDER", "2026-10-09T05:00:00.000Z", { result: ASKS, acknowledged: { at: "x", who: "web:altan", note: null } });
  assert.deepEqual(find({ ack: "answered" }, [older]), ["OLDER"], "a row that was acknowledged with no kind reads as answered, as its chip does");
  const superseded = [run("NEW", "2026-10-15T10:00:00.000Z"), run("OLD", "2026-10-14T10:00:00.000Z", { result: ASKS })];
  assert.deepEqual(find({ ack: "open" }, superseded), ["OLD"], "an ask a newer run replaced is still one nobody decided on");
});

test("the state filter keeps its rules: a phase, or the outcome of a closed run", () => {
  assert.deepEqual(find({ state: "running" }, LIST), ["RUNNING"]);
  assert.deepEqual(find({ state: "failed" }, LIST), ["FAILED"]);
  assert.deepEqual(find({ state: "complete", kind: "manual" }, LIST), ["HAND", "WEB"]);
});

test("the result chip says how the questions were decided: a dismissal is not an answer", () => {
  const words = (ack: RunRow["ackKind"]): string[] => summaryTags(ASKS, ack === null ? null : { answered: "answered", dismissed: "dismissed", "follow-up": "follow-up started", note: "noted" }[ack]).map((tag) => tag.text);
  assert.deepEqual(words(null), ["2 questions"]);
  assert.deepEqual(words("answered"), ["2 questions, answered"]);
  assert.deepEqual(words("dismissed"), ["2 questions, dismissed"]);
  assert.deepEqual(words("follow-up"), ["2 questions, follow-up started"]);
  assert.equal(summaryTags(ASKS, null)[0]?.tone, "wait");
  assert.equal(summaryTags(ASKS, "answered")[0]?.tone, null, "a decided ask is quiet");
});

test("ackKindOf: a row that was acknowledged and carries no kind reads as answered", () => {
  assert.equal(ackKindOf(run("A", "2026-10-15T05:00:00.000Z", { acknowledged: { at: "x", who: "w", note: null } })), "answered");
  assert.equal(ackKindOf(run("B", "2026-10-15T05:00:00.000Z", { ackKind: "dismissed", acknowledged: { at: "x", who: "w", note: null } })), "dismissed");
  assert.equal(ackKindOf(run("C", "2026-10-15T05:00:00.000Z")), null);
});

test("the filter in words", () => {
  assert.equal(filterSentence(ANY_RUNS, "demo"), "All runs in demo, newest first.");
  assert.equal(filterSentence({ ...ANY_RUNS, state: "held", kind: "follow-up" }, ""), "Held follow-up runs of every workspace, newest first.");
  assert.equal(filterSentence({ ...ANY_RUNS, kind: "scheduled", by: "timer", ack: "dismissed" }, "demo"), "Scheduled runs in demo, started by the timer, dismissed, newest first.");
  assert.equal(filterSentence({ ...ANY_RUNS, state: "running", by: "web", ack: "open", imported: true }, ""), "Runs still running of every workspace, started from the web, still open, imported runs included, newest first.");
  assert.equal(filterSentence({ ...ANY_RUNS, state: "weird" }, "demo"), "Runs that ended weird in demo, newest first.");
});
