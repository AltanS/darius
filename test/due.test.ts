/**
 * `ritualState()` and `rollCadence()`: ritual status computed from ledger
 * facts (docs/plan-tonight.md, "Due computation"; docs/concept.md, "Domain
 * model"). The semantics each test pins are listed in src/core/due.ts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { occurrenceAt, ritualState, rollCadence, type Clock, type Schedule } from "../src/core/due.ts";
import type { Document, JsonValue, LedgerLine, Ritual } from "../src/core/model.ts";

const SLUG = "heartbeat";

function ritualDoc(overrides: Partial<Ritual & Schedule> = {}): Document<Ritual & Schedule> {
  const header: Ritual & Schedule = {
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

/** A clock at local noon on `date`: its local calendar date is `date` in every timezone. */
function on(date: string): Clock {
  const [year, month, day] = date.split("-").map(Number);
  return { now: new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, 12) };
}

interface LedgerBuilder {
  lines: LedgerLine[];
  add: (date: string, type: string, payload?: Record<string, JsonValue>) => LedgerLine;
}

/**
 * A ledger that hands out ids in call order. A YYYY-MM-DD date becomes local
 * noon on that date, so its local calendar date is that date in every
 * timezone. A full ISO instant (it has a "T") is used as it is.
 */
function ledgerBuilder(): LedgerBuilder {
  const lines: LedgerLine[] = [];
  const add = (date: string, type: string, payload: Record<string, JsonValue> = {}): LedgerLine => {
    const [year, month, day] = date.split("-").map(Number);
    const at = date.includes("T") ? date : new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, 12).toISOString();
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
  const state = ritualState(ritualDoc(), [], on("2026-09-28"));
  assert.equal(state.isDue, true);
  assert.equal(state.nextDue, "2026-09-28");
  assert.equal(state.overdueDays, 0);
  assert.equal(state.lastCompleted, undefined);
});

test("a never-completed ritual without a cadence is not due", () => {
  const state = ritualState(ritualDoc({ cadence: undefined }), [], on("2026-09-28"));
  assert.equal(state.isDue, false);
  assert.equal(state.nextDue, undefined);
});

test("a ritual without a cadence is dormant after its first completion", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-14" });
  const state = ritualState(ritualDoc({ cadence: undefined }), ledger.lines, on("2026-12-01"));
  assert.equal(state.isDue, false);
  assert.equal(state.nextDue, undefined);
  assert.equal(state.lastCompleted, "2026-09-14");
});

// ritualState: anchor due

test("anchor due: a late completion keeps the schedule date, not the completion date", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-01" }); // grid: 09-08, 09-15, ...
  completeRun(ledger, { run: "r2", date: "2026-09-10" }); // two days late for 09-08
  const state = ritualState(ritualDoc(), ledger.lines, on("2026-09-12"));
  assert.equal(state.nextDue, "2026-09-15");
  assert.equal(state.isDue, false);
  assert.equal(state.lastCompleted, "2026-09-10");
});

test("anchor completion: the same late completion rolls from the completion date", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-01" });
  completeRun(ledger, { run: "r2", date: "2026-09-10" });
  const state = ritualState(ritualDoc({ anchor: "completion" }), ledger.lines, on("2026-09-12"));
  assert.equal(state.nextDue, "2026-09-17");
});

test("anchor due: several missed periods are due once, overdue from the oldest missed date", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-01" }); // missed 09-08, 09-15, 09-22
  const state = ritualState(ritualDoc(), ledger.lines, on("2026-09-28"));
  assert.equal(state.isDue, true);
  assert.equal(state.nextDue, "2026-09-08");
  assert.equal(state.overdueDays, 20);
});

test("anchor due: one completion after several missed periods satisfies all of them", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-01" });
  completeRun(ledger, { run: "r2", date: "2026-09-24" }); // covers 09-08, 09-15, 09-22
  const state = ritualState(ritualDoc(), ledger.lines, on("2026-09-28"));
  assert.equal(state.nextDue, "2026-09-29");
  assert.equal(state.isDue, false);
});

test("anchor due: a completion before the pending due is an extra run and moves nothing", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-27" }); // daily: next 09-28
  completeRun(ledger, { run: "r2", date: "2026-09-27" }); // second run the same day
  const state = ritualState(ritualDoc({ cadence: "1d" }), ledger.lines, on("2026-09-28"));
  assert.equal(state.nextDue, "2026-09-28");
  assert.equal(state.isDue, true);
});

test("anchor due: monthly steps count from the origin, so clamping does not drift", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-01-31" }); // grid: 02-28, 03-31, 04-30
  completeRun(ledger, { run: "r2", date: "2026-02-28" });
  const state = ritualState(ritualDoc({ cadence: "1m" }), ledger.lines, on("2026-03-01"));
  assert.equal(state.nextDue, "2026-03-31");
});

// ritualState: completions that do not count

test("a failed or abandoned run does not move the schedule", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-20" });
  completeRun(ledger, { run: "r2", date: "2026-09-27", outcome: "failed" });
  completeRun(ledger, { run: "r3", date: "2026-09-28", outcome: "abandoned" });
  const state = ritualState(ritualDoc(), ledger.lines, on("2026-09-28"));
  assert.equal(state.lastCompleted, "2026-09-20");
  assert.equal(state.nextDue, "2026-09-27");
  assert.equal(state.isDue, true);
  assert.equal(state.openRun, undefined);
});

test("lines for another item are ignored", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-27" });
  for (const line of ledger.lines) line.item = "ritual/other";
  const state = ritualState(ritualDoc(), ledger.lines, on("2026-09-28"));
  assert.equal(state.lastCompleted, undefined);
  assert.equal(state.nextDue, "2026-09-28");
});

test("the completion date is the LOCAL date of the ledger instant", () => {
  const ledger = ledgerBuilder();
  const line = ledger.add("2026-09-20", "run.completed", { run: "r1", outcome: "complete" });
  line.at = new Date(2026, 8, 20, 23, 59).toISOString(); // late evening local time
  const state = ritualState(ritualDoc({ cadence: "1d" }), ledger.lines, on("2026-09-20"));
  assert.equal(state.lastCompleted, "2026-09-20");
  assert.equal(state.nextDue, "2026-09-21");
});

test("lines are ordered by id, not by array position", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-01" });
  completeRun(ledger, { run: "r2", date: "2026-09-10" });
  const state = ritualState(ritualDoc({ anchor: "completion" }), ledger.lines.toReversed(), on("2026-09-12"));
  assert.equal(state.lastCompleted, "2026-09-10");
});

// ritualState: reschedule

test("a rescheduled line after the last completion wins over the rolled date", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-20" }); // rolled: 09-27
  ledger.add("2026-09-21", "ritual.rescheduled", { due: "2026-10-03" });
  const state = ritualState(ritualDoc(), ledger.lines, on("2026-09-28"));
  assert.equal(state.nextDue, "2026-10-03");
  assert.equal(state.isDue, false);
});

test("the latest rescheduled line wins over an earlier one", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-20" });
  ledger.add("2026-09-21", "ritual.rescheduled", { due: "2026-10-10" });
  ledger.add("2026-09-22", "ritual.rescheduled", { due: "2026-10-03" });
  const state = ritualState(ritualDoc(), ledger.lines, on("2026-09-28"));
  assert.equal(state.nextDue, "2026-10-03");
});

test("a rescheduled line cannot pull the due date before the rolled date", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-20" });
  ledger.add("2026-09-21", "ritual.rescheduled", { due: "2026-09-22" });
  const state = ritualState(ritualDoc(), ledger.lines, on("2026-09-24"));
  assert.equal(state.nextDue, "2026-09-27");
});

test("a rescheduled line before the last completion no longer counts", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-13" });
  ledger.add("2026-09-14", "ritual.rescheduled", { due: "2026-09-25" });
  completeRun(ledger, { run: "r2", date: "2026-09-25" }); // satisfies it, grid moves to 09-25
  const state = ritualState(ritualDoc(), ledger.lines, on("2026-09-28"));
  assert.equal(state.nextDue, "2026-10-02");
});

test("a rescheduled line makes a never-completed ritual due on that date, even without a cadence", () => {
  const ledger = ledgerBuilder();
  ledger.add("2026-09-01", "ritual.rescheduled", { due: "2026-09-20" });
  const state = ritualState(ritualDoc({ cadence: undefined }), ledger.lines, on("2026-09-28"));
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
  const state = ritualState(ritualDoc({ cadence: "1d" }), ledger.lines, on("2026-09-28"));
  assert.equal(state.lifecycle, "retired");
  assert.equal(state.isDue, false);
  assert.equal(state.nextDue, undefined);
  assert.equal(state.overdueDays, 0);
});

test("a paused ritual is not due, and resuming it makes it due again", () => {
  const ledger = ledgerBuilder();
  ledger.add("2026-09-02", "ritual.lifecycle", { state: "paused" });
  const paused = ritualState(ritualDoc(), ledger.lines, on("2026-09-28"));
  assert.equal(paused.lifecycle, "paused");
  assert.equal(paused.isDue, false);
  ledger.add("2026-09-03", "ritual.lifecycle", { state: "active" });
  assert.equal(ritualState(ritualDoc(), ledger.lines, on("2026-09-28")).isDue, true);
});

test("an unknown lifecycle state is an error, not a silent default", () => {
  const ledger = ledgerBuilder();
  ledger.add("2026-09-02", "ritual.lifecycle", { state: "sleeping" });
  assert.throws(() => ritualState(ritualDoc(), ledger.lines, on("2026-09-28")), /invalid state/);
});

// ritualState: runs

test("a held latest run suppresses isDue and is reported as heldRun", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-01" });
  ledger.add("2026-09-10", "run.started", { run: "r2" });
  ledger.add("2026-09-10", "run.held", { run: "r2", questions: ["push?"] });
  const state = ritualState(ritualDoc(), ledger.lines, on("2026-09-28"));
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
  const state = ritualState(ritualDoc(), ledger.lines, on("2026-09-28"));
  assert.equal(state.heldRun, undefined);
  assert.equal(state.openRun, "r1");
  assert.equal(state.isDue, true);
});

test("a started run without a completion is the open run", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-01" });
  ledger.add("2026-09-28", "run.started", { run: "r2" });
  const state = ritualState(ritualDoc(), ledger.lines, on("2026-09-28"));
  assert.equal(state.openRun, "r2");
  assert.equal(state.heldRun, undefined);
});

test("a run line without its run id is an error", () => {
  const ledger = ledgerBuilder();
  ledger.add("2026-09-28", "run.started");
  assert.throws(() => ritualState(ritualDoc(), ledger.lines, on("2026-09-28")), /missing text field "run"/);
});

test("an invalid clock is an error", () => {
  assert.throws(() => ritualState(ritualDoc(), [], { now: new Date("2026-9-28x") }), /invalid clock/);
});

test("a follow-up's completion moves no due date (0.47.1)", () => {
  const { lines, add } = ledgerBuilder();
  add("2026-09-01", "run.started", { run: "r1" });
  add("2026-09-01", "run.completed", { run: "r1", outcome: "complete" });
  add("2026-09-10", "run.started", { run: "r2", follow_up_of: "r1" });
  add("2026-09-10", "run.completed", { run: "r2", outcome: "complete" });
  const state = ritualState(ritualDoc(), lines, on("2026-09-10"));
  assert.equal(state.nextDue, "2026-09-08", "still due from the scheduled run");
  assert.equal(state.lastCompleted, "2026-09-01");
  assert.equal(state.isDue, true);
  add("2026-09-10", "run.started", { run: "r3" });
  add("2026-09-10", "run.completed", { run: "r3", outcome: "complete" });
  assert.equal(ritualState(ritualDoc(), lines, on("2026-09-10")).nextDue, "2026-09-15", "a scheduled run moves it");
});

test("an open follow-up still blocks a new run", () => {
  const { lines, add } = ledgerBuilder();
  add("2026-09-10", "run.started", { run: "r2", follow_up_of: "r1" });
  assert.equal(ritualState(ritualDoc(), lines, on("2026-09-10")).openRun, "r2");
});

// ritualState: occurrence instants (`at`, `tz`, `from`; docs/architecture/marker-v3.md, section 3)

/** A clock at a fixed UTC instant. */
function instant(iso: string): Clock {
  return { now: new Date(iso) };
}

const BERLIN = { tz: "Europe/Berlin", at: "09:05", cadence: "1d" } as const;

test("a never-completed timed ritual is due today at its time in its zone, not before", () => {
  const doc = ritualDoc(BERLIN);
  const before = ritualState(doc, [], instant("2026-10-01T07:04:00Z"));
  assert.deepEqual(
    [before.nextDue, before.nextDueAt, before.zone, before.isDue, before.overdueDays],
    ["2026-10-01", "2026-10-01T07:05:00.000Z", "Europe/Berlin", false, 0],
  );
  assert.equal(ritualState(doc, [], instant("2026-10-01T07:05:00Z")).isDue, true);
});

test("the midnight hazard: a 23:00 ritual completed at 00:10 satisfies the 23:00 before it only", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-10T23:05:00Z" });
  completeRun(ledger, { run: "r2", date: "2026-09-12T00:10:00Z" });
  const doc = ritualDoc({ tz: "UTC", at: "23:00", cadence: "1d" });
  const noon = ritualState(doc, ledger.lines, instant("2026-09-12T12:00:00Z"));
  assert.deepEqual(
    [noon.nextDue, noon.nextDueAt, noon.isDue, noon.lastCompleted],
    ["2026-09-12", "2026-09-12T23:00:00.000Z", false, "2026-09-12"],
  );
  assert.equal(ritualState(doc, ledger.lines, instant("2026-09-12T23:00:00Z")).isDue, true, "the next day's 23:00 stays due");
});

test("a first completion before today's time leaves today's occurrence due", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-10-01T06:00:00Z" });
  const state = ritualState(ritualDoc(BERLIN), ledger.lines, instant("2026-10-01T07:05:00Z"));
  assert.deepEqual([state.nextDue, state.isDue], ["2026-10-01", true]);
});

test("a timed completion before the pending occurrence is an extra run and moves nothing", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-10-01T07:30:00Z" });
  const doc = ritualDoc(BERLIN);
  assert.equal(ritualState(doc, ledger.lines, instant("2026-10-02T06:00:00Z")).nextDue, "2026-10-02");
  completeRun(ledger, { run: "r2", date: "2026-10-02T06:00:00Z" });
  const state = ritualState(doc, ledger.lines, instant("2026-10-02T07:05:00Z"));
  assert.deepEqual([state.nextDue, state.nextDueAt, state.isDue], ["2026-10-02", "2026-10-02T07:05:00.000Z", true]);
});

test("from is the grid origin: due on from at its time, an earlier run is extra", () => {
  const doc = ritualDoc({ ...BERLIN, cadence: "1w", from: "2026-10-05" });
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-10-02T10:00:00Z" });
  const early = ritualState(doc, ledger.lines, instant("2026-10-05T07:04:00Z"));
  assert.deepEqual([early.nextDue, early.nextDueAt, early.isDue], ["2026-10-05", "2026-10-05T07:05:00.000Z", false]);
  assert.equal(ritualState(doc, ledger.lines, instant("2026-10-05T07:05:00Z")).isDue, true);
  completeRun(ledger, { run: "r2", date: "2026-10-06T08:00:00Z" });
  const after = ritualState(doc, ledger.lines, instant("2026-10-06T09:00:00Z"));
  assert.deepEqual([after.nextDue, after.isDue], ["2026-10-12", false], "a late run keeps the grid of from");
});

test("from with several missed periods is due once, overdue from from", () => {
  const doc = ritualDoc({ ...BERLIN, from: "2026-09-20" });
  const state = ritualState(doc, [], instant("2026-09-23T12:00:00Z"));
  assert.deepEqual([state.nextDue, state.isDue, state.overdueDays], ["2026-09-20", true, 3]);
});

test("anchor completion: from is the first due, then the completion date in the zone plus the cadence", () => {
  const doc = ritualDoc({ ...BERLIN, anchor: "completion", cadence: "2d", from: "2026-10-05" });
  assert.equal(ritualState(doc, [], instant("2026-10-01T12:00:00Z")).nextDue, "2026-10-05");
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-10-06T22:30:00Z" });
  const state = ritualState(doc, ledger.lines, instant("2026-10-07T12:00:00Z"));
  assert.deepEqual(
    [state.lastCompleted, state.nextDue, state.nextDueAt],
    ["2026-10-07", "2026-10-09", "2026-10-09T07:05:00.000Z"],
    "22:30 UTC is 00:30 on the next day in Berlin",
  );
});

test("dates follow the ritual's zone: completion date, today and overdue days", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-30T22:30:00Z" });
  const doc = ritualDoc({ tz: "Europe/Berlin", cadence: "1d" });
  const state = ritualState(doc, ledger.lines, instant("2026-10-03T22:30:00Z"));
  assert.deepEqual(
    [state.lastCompleted, state.nextDue, state.nextDueAt, state.overdueDays],
    ["2026-10-01", "2026-10-02", "2026-10-01T22:00:00.000Z", 2],
  );
});

test("a reschedule sets the pending occurrence to its date at the ritual's time", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-10-01T08:00:00Z" });
  ledger.add("2026-10-01T09:00:00Z", "ritual.rescheduled", { due: "2026-10-04" });
  const state = ritualState(ritualDoc(BERLIN), ledger.lines, instant("2026-10-04T07:00:00Z"));
  assert.deepEqual([state.nextDue, state.nextDueAt, state.isDue], ["2026-10-04", "2026-10-04T07:05:00.000Z", false]);
});

test("a timed occurrence inside the spring-forward gap runs one hour later on the wall clock", () => {
  const doc = ritualDoc({ tz: "Europe/Berlin", at: "02:30", cadence: "1d", from: "2026-03-29" });
  assert.equal(ritualState(doc, [], instant("2026-03-29T00:00:00Z")).nextDueAt, "2026-03-29T01:30:00.000Z");
});

test("a date-only ritual without tz uses the clock's host zone and reports zone local", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-10T20:00:00Z" });
  const doc = ritualDoc({ cadence: "1d" });
  const utc = ritualState(doc, ledger.lines, { now: new Date("2026-09-11T00:00:00Z"), hostTz: "UTC" });
  assert.deepEqual(
    [utc.zone, utc.lastCompleted, utc.nextDue, utc.nextDueAt, utc.isDue],
    ["local", "2026-09-10", "2026-09-11", "2026-09-11T00:00:00.000Z", true],
  );
  const kolkata = ritualState(doc, ledger.lines, { now: new Date("2026-09-11T00:00:00Z"), hostTz: "Asia/Kolkata" });
  assert.deepEqual(
    [kolkata.lastCompleted, kolkata.nextDue, kolkata.nextDueAt, kolkata.isDue],
    ["2026-09-11", "2026-09-12", "2026-09-11T18:30:00.000Z", false],
  );
});

test("a date-only ritual is due from local midnight, exactly the date rule", () => {
  const ledger = ledgerBuilder();
  completeRun(ledger, { run: "r1", date: "2026-09-10" });
  const doc = ritualDoc({ cadence: "1d" });
  const state = ritualState(doc, ledger.lines, { now: new Date(2026, 8, 11, 0, 0) });
  assert.deepEqual([state.nextDue, state.nextDueAt, state.isDue], ["2026-09-11", new Date(2026, 8, 11).toISOString(), true]);
  assert.equal(ritualState(doc, ledger.lines, { now: new Date(2026, 8, 10, 23, 59) }).isDue, false);
});

test("occurrenceAt: 00:00 when at is absent, host local when tz is absent", () => {
  assert.equal(occurrenceAt("2026-10-02", undefined, "UTC").toISOString(), "2026-10-02T00:00:00.000Z");
  assert.equal(occurrenceAt("2026-10-02", "09:05", "Europe/Berlin").toISOString(), "2026-10-02T07:05:00.000Z");
  assert.equal(occurrenceAt("2026-10-02", "09:05", undefined).getTime(), new Date(2026, 9, 2, 9, 5).getTime());
});

test("a malformed at, from or tz is an error", () => {
  assert.throws(() => ritualState(ritualDoc({ at: "9:05" }), [], instant("2026-10-01T00:00:00Z")), /invalid time/);
  assert.throws(() => ritualState(ritualDoc({ at: "24:00" }), [], instant("2026-10-01T00:00:00Z")), /invalid time/);
  assert.throws(() => ritualState(ritualDoc({ from: "2026-02-30" }), [], instant("2026-10-01T00:00:00Z")), /invalid date/);
  assert.throws(() => ritualState(ritualDoc({ tz: "Mars/Olympus" }), [], instant("2026-10-01T00:00:00Z")), /invalid time zone/);
});
