/**
 * `ritualState()` and `rollCadence()`: ritual status computed from ledger
 * facts (docs/plan-tonight.md, "Due computation"; docs/concept.md, "Domain
 * model"). The semantics each test pins are listed in src/core/due.ts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ritualState, rollCadence } from "../src/core/due.ts";
import type { Document, JsonValue, LedgerLine, Ritual } from "../src/core/model.ts";

const SLUG = "heartbeat";

function ritualDoc(overrides: Partial<Ritual> = {}): Document<Ritual> {
  const header: Ritual = {
    id: "01JRITUAL0000000000000000",
    kind: "ritual",
    slug: SLUG,
    title: "Heartbeat",
    created: "2026-09-01",
    updated: "2026-09-01",
    tags: [],
    cadence: "7d",
    anchor: "due",
    policy: { mode: "off", may: [], hold: [] },
    ...overrides,
  };
  return { header, body: "" };
}

interface LedgerBuilder {
  lines: LedgerLine[];
  add: (date: string, type: string, payload?: Record<string, JsonValue>) => LedgerLine;
}

/**
 * A ledger that hands out ids in call order. The instant is local noon on
 * the given date, so its local calendar date is that date in every timezone.
 */
function ledgerBuilder(): LedgerBuilder {
  const lines: LedgerLine[] = [];
  const add = (date: string, type: string, payload: Record<string, JsonValue> = {}): LedgerLine => {
    const [year, month, day] = date.split("-").map(Number);
    const at = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, 12).toISOString();
    const line: LedgerLine = {
      ...payload,
      v: 1,
      id: `01J${String(lines.length).padStart(23, "0")}`,
      at,
      host: "host-a",
      who: "owner",
      project: "test",
      type,
      item: `ritual/${SLUG}`,
    };
    lines.push(line);
    return line;
  };
  return { lines, add };
}

function completeRun(
  ledger: LedgerBuilder,
  context: { run: string; date: string; outcome?: string },
): void {
  ledger.add(context.date, "run.started", { run: context.run });
  ledger.add(context.date, "run.completed", { run: context.run, outcome: context.outcome ?? "complete" });
}

// rollCadence

test("rollCadence rolls every supported cadence across a month boundary", () => {
  const cases: [string, string][] = [
    ["1d", "2026-10-01"],
    ["2d", "2026-10-02"],
    ["7d", "2026-10-07"],
    ["1w", "2026-10-07"],
    ["2w", "2026-10-14"],
    ["1m", "2026-10-30"],
  ];
  for (const [cadence, expected] of cases) {
    assert.equal(rollCadence("2026-09-30", cadence), expected, `2026-09-30 + ${cadence}`);
  }
});

test("rollCadence rolls over a year boundary", () => {
  assert.equal(rollCadence("2026-12-31", "1d"), "2027-01-01");
  assert.equal(rollCadence("2026-12-15", "1m"), "2027-01-15");
});

test("rollCadence clamps a month step to the last day of the target month", () => {
  assert.equal(rollCadence("2026-01-31", "1m"), "2026-02-28");
  assert.equal(rollCadence("2028-01-31", "1m"), "2028-02-29");
  assert.equal(rollCadence("2026-03-31", "1m"), "2026-04-30");
});

test("rollCadence accepts other legacy cadences and a bare day count", () => {
  assert.equal(rollCadence("2026-09-20", "3d"), "2026-09-23");
  assert.equal(rollCadence("2026-09-01", "180d"), "2027-02-28");
  assert.equal(rollCadence("2026-09-20", "5"), "2026-09-25");
});

test("rollCadence rejects a malformed cadence or date", () => {
  assert.throws(() => rollCadence("2026-09-20", "0d"), /invalid cadence/);
  assert.throws(() => rollCadence("2026-09-20", "1y"), /invalid cadence/);
  assert.throws(() => rollCadence("2026-02-30", "1d"), /no such calendar day/);
  assert.throws(() => rollCadence("20260920", "1d"), /invalid date/);
});

// ritualState: never completed, dormant

test("a never-completed active ritual with a cadence is due today, 0 days overdue", () => {
  const state = ritualState(ritualDoc(), [], "2026-09-28");
  assert.equal(state.isDue, true);
  assert.equal(state.nextDue, "2026-09-28");
  assert.equal(state.overdueDays, 0);
  assert.equal(state.lastCompleted, undefined);
});

test("a never-completed ritual without a cadence is not due", () => {
  const state = ritualState(ritualDoc({ cadence: undefined }), [], "2026-09-28");
  assert.equal(state.isDue, false);
  assert.equal(state.nextDue, undefined);
});

test("a ritual without a cadence is dormant after its first completion", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-14" });
  const state = ritualState(ritualDoc({ cadence: undefined }), ledger.lines, "2026-12-01");
  assert.equal(state.isDue, false);
  assert.equal(state.nextDue, undefined);
  assert.equal(state.lastCompleted, "2026-09-14");
});

// ritualState: anchor due

test("anchor due: a late completion keeps the schedule date, not the completion date", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-01" }); // grid: 09-08, 09-15, ...
  completeRun(ledger, { run: "r2", date: "2026-09-10" }); // two days late for 09-08
  const state = ritualState(ritualDoc(), ledger.lines, "2026-09-12");
  assert.equal(state.nextDue, "2026-09-15");
  assert.equal(state.isDue, false);
  assert.equal(state.lastCompleted, "2026-09-10");
});

test("anchor completion: the same late completion rolls from the completion date", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-01" });
  completeRun(ledger, { run: "r2", date: "2026-09-10" });
  const state = ritualState(ritualDoc({ anchor: "completion" }), ledger.lines, "2026-09-12");
  assert.equal(state.nextDue, "2026-09-17");
});

test("anchor due: several missed periods are due once, overdue from the oldest missed date", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-01" }); // missed 09-08, 09-15, 09-22
  const state = ritualState(ritualDoc(), ledger.lines, "2026-09-28");
  assert.equal(state.isDue, true);
  assert.equal(state.nextDue, "2026-09-08");
  assert.equal(state.overdueDays, 20);
});

test("anchor due: one completion after several missed periods satisfies all of them", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-01" });
  completeRun(ledger, { run: "r2", date: "2026-09-24" }); // covers 09-08, 09-15, 09-22
  const state = ritualState(ritualDoc(), ledger.lines, "2026-09-28");
  assert.equal(state.nextDue, "2026-09-29");
  assert.equal(state.isDue, false);
});

test("anchor due: a completion before the pending due is an extra run and moves nothing", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-27" }); // daily: next 09-28
  completeRun(ledger, { run: "r2", date: "2026-09-27" }); // second run the same day
  const state = ritualState(ritualDoc({ cadence: "1d" }), ledger.lines, "2026-09-28");
  assert.equal(state.nextDue, "2026-09-28");
  assert.equal(state.isDue, true);
});

test("anchor due: monthly steps count from the origin, so clamping does not drift", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-01-31" }); // grid: 02-28, 03-31, 04-30
  completeRun(ledger, { run: "r2", date: "2026-02-28" });
  const state = ritualState(ritualDoc({ cadence: "1m" }), ledger.lines, "2026-03-01");
  assert.equal(state.nextDue, "2026-03-31");
});

// ritualState: completions that do not count

test("a failed or abandoned run does not move the schedule", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-20" });
  completeRun(ledger, { run: "r2", date: "2026-09-27", outcome: "failed" });
  completeRun(ledger, { run: "r3", date: "2026-09-28", outcome: "abandoned" });
  const state = ritualState(ritualDoc(), ledger.lines, "2026-09-28");
  assert.equal(state.lastCompleted, "2026-09-20");
  assert.equal(state.nextDue, "2026-09-27");
  assert.equal(state.isDue, true);
  assert.equal(state.openRun, undefined);
});

test("lines for another item are ignored", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-27" });
  for (const line of ledger.lines) line.item = "ritual/other";
  const state = ritualState(ritualDoc(), ledger.lines, "2026-09-28");
  assert.equal(state.lastCompleted, undefined);
  assert.equal(state.nextDue, "2026-09-28");
});

test("the completion date is the LOCAL date of the ledger instant", () => {
  const ledger = ledgerBuilder();
  const line = ledger.add("2026-09-20", "run.completed", { run: "r1", outcome: "complete" });
  line.at = new Date(2026, 8, 20, 23, 59).toISOString(); // late evening local time
  const state = ritualState(ritualDoc({ cadence: "1d" }), ledger.lines, "2026-09-20");
  assert.equal(state.lastCompleted, "2026-09-20");
  assert.equal(state.nextDue, "2026-09-21");
});

test("lines are ordered by id, not by array position", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-01" });
  completeRun(ledger, { run: "r2", date: "2026-09-10" });
  const state = ritualState(ritualDoc({ anchor: "completion" }), ledger.lines.toReversed(), "2026-09-12");
  assert.equal(state.lastCompleted, "2026-09-10");
});

// ritualState: reschedule

test("a rescheduled line after the last completion wins over the rolled date", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-20" }); // rolled: 09-27
  ledger.add("2026-09-21", "ritual.rescheduled", { due: "2026-10-03" });
  const state = ritualState(ritualDoc(), ledger.lines, "2026-09-28");
  assert.equal(state.nextDue, "2026-10-03");
  assert.equal(state.isDue, false);
});

test("the latest rescheduled line wins over an earlier one", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-20" });
  ledger.add("2026-09-21", "ritual.rescheduled", { due: "2026-10-10" });
  ledger.add("2026-09-22", "ritual.rescheduled", { due: "2026-10-03" });
  const state = ritualState(ritualDoc(), ledger.lines, "2026-09-28");
  assert.equal(state.nextDue, "2026-10-03");
});

test("a rescheduled line cannot pull the due date before the rolled date", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-20" });
  ledger.add("2026-09-21", "ritual.rescheduled", { due: "2026-09-22" });
  const state = ritualState(ritualDoc(), ledger.lines, "2026-09-24");
  assert.equal(state.nextDue, "2026-09-27");
});

test("a rescheduled line before the last completion no longer counts", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-13" });
  ledger.add("2026-09-14", "ritual.rescheduled", { due: "2026-09-25" });
  completeRun(ledger, { run: "r2", date: "2026-09-25" }); // satisfies it, grid moves to 09-25
  const state = ritualState(ritualDoc(), ledger.lines, "2026-09-28");
  assert.equal(state.nextDue, "2026-10-02");
});

test("a rescheduled line makes a never-completed ritual due on that date, even without a cadence", () => {
  const ledger = ledgerBuilder();
  ledger.add("2026-09-01", "ritual.rescheduled", { due: "2026-09-20" });
  const state = ritualState(ritualDoc({ cadence: undefined }), ledger.lines, "2026-09-28");
  assert.equal(state.nextDue, "2026-09-20");
  assert.equal(state.isDue, true);
  assert.equal(state.overdueDays, 8);
});

// ritualState: lifecycle

test("a retired ritual is never due, and a later lifecycle line cannot revive it", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-01" });
  ledger.add("2026-09-02", "ritual.lifecycle", { state: "retired" });
  ledger.add("2026-09-03", "ritual.lifecycle", { state: "active" });
  const state = ritualState(ritualDoc({ cadence: "1d" }), ledger.lines, "2026-09-28");
  assert.equal(state.lifecycle, "retired");
  assert.equal(state.isDue, false);
  assert.equal(state.nextDue, undefined);
  assert.equal(state.overdueDays, 0);
});

test("a paused ritual is not due, and resuming it makes it due again", () => {
  const ledger = ledgerBuilder();
  ledger.add("2026-09-02", "ritual.lifecycle", { state: "paused" });
  const paused = ritualState(ritualDoc(), ledger.lines, "2026-09-28");
  assert.equal(paused.lifecycle, "paused");
  assert.equal(paused.isDue, false);
  ledger.add("2026-09-03", "ritual.lifecycle", { state: "active" });
  assert.equal(ritualState(ritualDoc(), ledger.lines, "2026-09-28").isDue, true);
});

test("an unknown lifecycle state is an error, not a silent default", () => {
  const ledger = ledgerBuilder();
  ledger.add("2026-09-02", "ritual.lifecycle", { state: "sleeping" });
  assert.throws(() => ritualState(ritualDoc(), ledger.lines, "2026-09-28"), /invalid state/);
});

// ritualState: runs

test("a held latest run suppresses isDue and is reported as heldRun", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-01" });
  ledger.add("2026-09-10", "run.started", { run: "r2" });
  ledger.add("2026-09-10", "run.held", { run: "r2", questions: ["push?"] });
  const state = ritualState(ritualDoc(), ledger.lines, "2026-09-28");
  assert.equal(state.heldRun, "r2");
  assert.equal(state.isDue, false);
  assert.equal(state.nextDue, "2026-09-08");
  assert.equal(state.overdueDays, 20);
  assert.equal(state.openRun, undefined);
});

test("a resumed run is open again, not held", () => {
  const ledger = ledgerBuilder();
  ledger.add("2026-09-28", "run.started", { run: "r1" });
  ledger.add("2026-09-28", "run.held", { run: "r1", questions: ["push?"] });
  ledger.add("2026-09-28", "run.answered", { run: "r1", n: 1, text: "no" });
  ledger.add("2026-09-28", "run.resumed", { run: "r1" });
  const state = ritualState(ritualDoc(), ledger.lines, "2026-09-28");
  assert.equal(state.heldRun, undefined);
  assert.equal(state.openRun, "r1");
  assert.equal(state.isDue, true);
});

test("a started run without a completion is the open run", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-01" });
  ledger.add("2026-09-28", "run.started", { run: "r2" });
  const state = ritualState(ritualDoc(), ledger.lines, "2026-09-28");
  assert.equal(state.openRun, "r2");
  assert.equal(state.heldRun, undefined);
});

test("a run line without its run id is an error", () => {
  const ledger = ledgerBuilder();
  ledger.add("2026-09-28", "run.started");
  assert.throws(() => ritualState(ritualDoc(), ledger.lines, "2026-09-28"), /missing text field "run"/);
});

test("a malformed today is an error", () => {
  assert.throws(() => ritualState(ritualDoc(), [], "2026-9-28"), /invalid date/);
});
