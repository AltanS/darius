/**
 * The state vocabulary of the web app (web/app/lib/state-words.ts): one table
 * of words and tones, used by every row, chip, page head and strip.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import type { RitualRow, RunRow, VigilRow } from "../src/web/api.ts";
import { datePhrase, dateState, lateWord, railOf, ritualWord, runWord, vigilWord } from "../web/app/lib/state-words.ts";

const TODAY = "2026-09-30";

function run(extra: Partial<RunRow> = {}): RunRow {
  return { run: "r1", item: "ritual/a", phase: "closed", outcome: "complete", startedAt: "2026-09-30T01:00:00Z", endedAt: "2026-09-30T01:04:00Z", who: "timer", questions: [], findingsSha: null, result: null, acknowledged: null, ...extra };
}

function ritual(extra: Partial<RitualRow> = {}): RitualRow {
  return { slug: "a", title: "A", lifecycle: "active", mode: "report", cadence: "7d", nextDue: null, isDue: false, overdueDays: 0, skill: null, profile: null, host: null, lastCompleted: null, heldRun: null, openRun: null, failedToday: null, source: null, defCommit: null, defHost: null, defAt: null, defDirty: false, at: null, zone: null, timeout: null, nextDueAt: null, warnings: [], ...extra };
}

test("a run has one word and one tone for each state", () => {
  assert.deepEqual(runWord(run({ phase: "running", outcome: null }), false), { tone: "run", label: "Running" });
  assert.deepEqual(runWord(run({ phase: "held", outcome: null }), false), { tone: "wait", label: "Waiting for you" });
  assert.deepEqual(runWord(run(), true), { tone: "wait", label: "Asks you" });
  assert.deepEqual(runWord(run(), false), { tone: "ok", label: "Complete" });
  assert.deepEqual(runWord(run({ outcome: "failed" }), false), { tone: "bad", label: "Failed" });
  assert.deepEqual(runWord(run({ outcome: "failed", acknowledged: { who: "me", at: "2026-09-30T02:00:00Z", note: null } }), false), { tone: "idle", label: "Failed, seen" });
  assert.deepEqual(runWord(run({ outcome: "abandoned" }), false), { tone: "idle", label: "Abandoned" });
});

test("late is a count of days in words, never an abbreviation", () => {
  assert.equal(lateWord(1).label, "1 day late");
  assert.equal(lateWord(13).label, "13 days late");
  assert.equal(lateWord(13).tone, "late");
});

test("a date is late, due today, or a date phrase in the quiet tone", () => {
  assert.deepEqual(dateState(TODAY, "2026-09-17"), { tone: "late", label: "13 days late" });
  assert.deepEqual(dateState(TODAY, TODAY), { tone: "gold", label: "Due today" });
  assert.deepEqual(dateState(TODAY, "2026-10-01"), { tone: "idle", label: "tomorrow" });
  assert.deepEqual(dateState(TODAY, "2026-10-02"), { tone: "idle", label: "Fri 2 Oct" });
  assert.deepEqual(dateState(TODAY, "2026-11-15"), { tone: "idle", label: "15 Nov" });
  assert.equal(dateState(TODAY, null), null);
  assert.equal(datePhrase(TODAY, TODAY), "today");
});

test("a ritual reads as waiting, running, late, due today or its next date", () => {
  assert.equal(ritualWord(ritual({ heldRun: "r" }), TODAY).label, "Waiting for you");
  assert.equal(ritualWord(ritual({ openRun: "r" }), TODAY).label, "Running");
  assert.equal(ritualWord(ritual({ nextDue: "2026-09-17", overdueDays: 13 }), TODAY).label, "13 days late");
  assert.equal(ritualWord(ritual({ nextDue: TODAY, isDue: true }), TODAY).label, "Due today");
  assert.equal(ritualWord(ritual({ nextDue: "2026-10-01" }), TODAY).label, "tomorrow");
  assert.equal(ritualWord(ritual(), TODAY).label, "No schedule");
});

test("a vigil is flagged, or shows its verdict once closed; an armed one has no word", () => {
  const vigil: VigilRow = { slug: "v", title: "V", state: "armed", verdict: null, due: null, until: null, flagged: false, lastOutcome: null };
  assert.equal(vigilWord(vigil), null);
  assert.deepEqual(vigilWord({ ...vigil, flagged: true }), { tone: "bad", label: "Flagged" });
  assert.deepEqual(vigilWord({ ...vigil, state: "closed", verdict: "held" }), { tone: "ok", label: "Held" });
  assert.deepEqual(vigilWord({ ...vigil, state: "closed", verdict: "failed" }), { tone: "bad", label: "Failed" });
});

test("only a state that needs attention draws a rail", () => {
  assert.equal(railOf(lateWord(2)), "late");
  assert.equal(railOf({ tone: "run", label: "Running" }), "run");
  assert.equal(railOf({ tone: "wait", label: "Asks you" }), "wait");
  assert.equal(railOf({ tone: "bad", label: "Failed" }), "bad");
  assert.equal(railOf({ tone: "idle", label: "Failed, seen" }), null);
  assert.equal(railOf({ tone: "ok", label: "Complete" }), null);
  assert.equal(railOf({ tone: "gold", label: "Due today" }), null);
  assert.equal(railOf(null), null);
});
