/**
 * The row grammar of the lists (0.142.0): the state word and the order of
 * the djinns, the "Next" text, the runs by day, the Time cell, the mark of a
 * run that did not start the default way, and the run host and the recent
 * runs per host of the fleet view. Pure: web/app/lib/lists.ts, and
 * src/web/status.ts with src/web/fleet.ts over a throwaway store.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FleetDjinn } from "../src/web/api.ts";
import type { LedgerLine } from "../src/core/model.ts";
import type { PlacedDjinn } from "../web/app/lib/lists.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-web-lists-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");

const lists = await import("../web/app/lib/lists.ts");
const { runRows, runRowsShared } = await import("../src/web/status.ts");
const { recentRunsByHost } = await import("../src/web/fleet.ts");

function djinn(slug: string, state: FleetDjinn["state"], change: Partial<FleetDjinn> = {}): FleetDjinn {
  return { slug, title: slug, state, nextDueAt: null, nextDue: null, host: "host-b", why: "checkout", lastOutcome: null, lastAt: null, lastRun: null, ...change };
}

function placed(one: FleetDjinn, asks = false, workspace = "shop"): PlacedDjinn {
  return { workspace, djinn: one, asks };
}

// 2026-11-26 10:00 UTC, the host one hour east of UTC: 11:00 on its clock.
const CLOCK = { now: Date.parse("2026-11-26T10:00:00.000Z"), today: "2026-11-26", offset: 60 };

test("the state word of a djinn: its own state only; any other djinn is a muted ok, never the outcome of its last run again", () => {
  const word = (one: FleetDjinn, asks = false): string => lists.djinnStateWord(placed(one, asks)).label;
  assert.equal(word(djinn("a", "running")), "running");
  assert.equal(word(djinn("a", "held")), "held");
  assert.equal(word(djinn("a", "late")), "late");
  assert.equal(word(djinn("a", "due")), "due today");
  assert.equal(word(djinn("a", "idle", { lastOutcome: "complete" }), true), "asks you");
  assert.equal(word(djinn("a", "idle", { lastOutcome: "failed" })), "failed");
  assert.equal(word(djinn("a", "due", { lastOutcome: "failed" })), "failed", "a failure outranks due today");
  assert.deepEqual(lists.djinnStateWord(placed(djinn("a", "idle", { lastOutcome: "complete" }))), { tone: "idle", label: "ok" });
  assert.equal(word(djinn("a", "idle", { lastOutcome: "abandoned" })), "ok");
  assert.equal(word(djinn("a", "idle")), "ok", "a djinn that never ran");
});

test("the order of a djinn list: the ones that need a look by due date, oldest first; the rest by the last run, newest first; never by title", () => {
  const djinns = [
    placed(djinn("z-quiet-old", "idle", { title: "A first by title", lastOutcome: "complete", lastAt: "2026-11-01T08:00:00.000Z" })),
    placed(djinn("y-quiet-new", "idle", { title: "B", lastOutcome: "complete", lastAt: "2026-11-25T08:00:00.000Z" })),
    placed(djinn("x-never", "idle", { title: "C" })),
    placed(djinn("w-due", "due", { nextDue: "2026-11-26", nextDueAt: "2026-11-26T06:00:00.000Z" })),
    placed(djinn("v-late", "late", { nextDue: "2026-11-24", nextDueAt: "2026-11-24T06:00:00.000Z" })),
    placed(djinn("u-failed", "idle", { lastOutcome: "failed", lastAt: "2026-11-26T05:00:00.000Z", nextDueAt: "2026-11-27T06:00:00.000Z" })),
    placed(djinn("t-asks", "idle", { lastOutcome: "complete", lastAt: "2026-11-26T04:00:00.000Z", nextDueAt: "2026-11-27T05:00:00.000Z" }), true),
    placed(djinn("s-running", "running", { nextDueAt: "2026-11-26T09:00:00.000Z" })),
  ];
  assert.deepEqual(
    lists.sortDjinns(djinns).map((one) => one.djinn.slug),
    ["v-late", "w-due", "s-running", "t-asks", "u-failed", "y-quiet-new", "z-quiet-old", "x-never"],
  );
  assert.equal(lists.needsLook(djinns[0]!), false);
  assert.equal(lists.needsLook(djinns[6]!), true, "an open question needs a look");
});

test("the Next text: late by, due now, in 3 h, tomorrow 07:00, a weekday, a date; a dash when there is no schedule", () => {
  const next = (change: Partial<FleetDjinn>, state: FleetDjinn["state"] = "idle"): string | null => lists.nextText(djinn("a", state, change), CLOCK)?.text ?? null;
  assert.equal(next({}), null);
  assert.deepEqual(lists.nextText(djinn("a", "late", { nextDue: "2026-11-25", nextDueAt: "2026-11-25T06:00:00.000Z" }), CLOCK), { text: "late by 28 h", late: true });
  assert.equal(next({ nextDue: "2026-11-23", nextDueAt: "2026-11-23T06:00:00.000Z" }, "late"), "late by 3 d");
  assert.equal(next({ nextDue: "2026-11-26", nextDueAt: "2026-11-26T09:00:00.000Z" }, "due"), "due now");
  assert.equal(next({ nextDue: "2026-11-26", nextDueAt: "2026-11-26T13:00:00.000Z" }), "in 3 h");
  assert.equal(next({ nextDue: "2026-11-27", nextDueAt: "2026-11-27T06:00:00.000Z" }), "tomorrow 07:00", "on the host's clock");
  assert.equal(next({ nextDue: "2026-11-30", nextDueAt: "2026-11-30T06:00:00.000Z" }), "Mon 07:00");
  assert.equal(next({ nextDue: "2026-12-07", nextDueAt: "2026-12-07T06:00:00.000Z" }), "Mon 7 Dec");
  assert.equal(next({ nextDue: "2026-11-27" }), "tomorrow", "a due day without a time");
  assert.equal(next({ nextDue: "2026-11-24" }, "late"), "late by 2 d");
});

test("the runs by day: Today, Yesterday, then the weekday and date; the newest day first, the newest run first", () => {
  const runs = ["2026-11-26T09:00:00.000Z", "2026-11-23T10:00:00.000Z", "2026-11-25T22:30:00.000Z", "2026-11-26T07:00:00.000Z", "2026-11-25T23:30:00.000Z"].map((startedAt) => ({ startedAt }));
  const groups = lists.groupByDay(runs, CLOCK);
  assert.deepEqual(
    groups.map((group) => [group.label, group.runs.map((run) => run.startedAt.slice(5, 16))]),
    [
      ["Today", ["11-26T09:00", "11-26T07:00", "11-25T23:30"]],
      ["Yesterday", ["11-25T22:30"]],
      ["Mon 23 Nov", ["11-23T10:00"]],
    ],
    "23:30 UTC is already the next day one hour east",
  );
  assert.equal(lists.dayLabel("2026-11-26", "2026-11-26"), "Today");
  assert.equal(lists.dayLabel("2026-11-24", "2026-11-26"), "Tue 24 Nov");
});

test("the Time cell: HH:MM on the host's clock; a recent list adds the weekday when the run is not from today", () => {
  assert.equal(lists.runClock("2026-11-26T06:00:00.000Z", CLOCK, true), "07:00");
  assert.equal(lists.runClock("2026-11-24T06:00:00.000Z", CLOCK, true), "Tue 07:00");
  assert.equal(lists.runClock("2026-11-24T06:00:00.000Z", CLOCK, false), "07:00", "a day group has its own heading");
  assert.equal(lists.fullMoment("2026-11-24T06:00:00.000Z", 60), "Tue 24 Nov 07:00");
});

test("the mark of a run: none for a scheduled ritual run that the timer started; else what is not the default", () => {
  type MarkInput = Parameters<typeof lists.runMarks>[0];
  const base: MarkInput = { who: "timer", startedBy: "timer", followUpOf: null, kind: "ritual", manual: false };
  const marks = (change: Partial<MarkInput>): string[] => lists.runMarks({ ...base, ...change }).map((mark) => mark.text);
  assert.deepEqual(marks({}), []);
  assert.deepEqual(marks({ who: "web:owner", startedBy: "web" }), ["from the web"]);
  assert.deepEqual(marks({ who: "owner@laptop", startedBy: "cli" }), ["by owner@laptop"]);
  assert.deepEqual(marks({ manual: true, who: "owner", startedBy: "cli" }), ["manual", "by owner"]);
  assert.deepEqual(marks({ kind: "vigil" }), ["vigil"]);
  assert.deepEqual(lists.runMarks({ ...base, followUpOf: "01PARENT", who: "web:owner", startedBy: "web" }), [{ text: "follow-up of", run: "01PARENT" }, { text: "from the web" }]);
  assert.deepEqual(marks({ who: "import", startedBy: "cli" }), [], "an imported run has its own chip");
});

test("the Machine column shows only when more than one machine has runs in the list", () => {
  assert.equal(lists.showsMachines([{ host: "a" }, { host: "a" }]), false);
  assert.equal(lists.showsMachines([{ host: "a" }, { host: "b" }]), true);
  assert.equal(lists.showsMachines([]), false);
});

function line(id: string, type: string, run: string, host: string, at: string, extra: Partial<LedgerLine> = {}): LedgerLine {
  return { v: 1, id, type, run, host, at, who: "timer", project: "shop", item: "ritual/report", ...extra };
}

test("a run row names the machine of its newest start or resume, and the fleet view keeps the newest runs per machine", () => {
  const ledger: LedgerLine[] = [
    line("01", "run.started", "R1", "host-a", "2026-11-26T08:00:00.000Z"),
    line("02", "run.held", "R1", "host-a", "2026-11-26T08:01:00.000Z"),
    line("03", "run.resumed", "R1", "host-b", "2026-11-26T09:00:00.000Z"),
    line("04", "run.completed", "R1", "host-b", "2026-11-26T09:05:00.000Z", { outcome: "complete" }),
    line("05", "run.started", "R2", "host-a", "2026-11-26T10:00:00.000Z"),
    line("06", "run.started", "R3", "host-a", "2026-11-26T11:00:00.000Z", { who: "import" }),
  ];
  assert.deepEqual(
    runRows(ledger).map((row) => [row.run, row.host]),
    [
      ["R3", "host-a"],
      ["R2", "host-a"],
      ["R1", "host-b"],
    ],
  );
  assert.equal(runRowsShared(ledger), runRowsShared(ledger), "one scan per state of a ledger");
  const recent = recentRunsByHost([{ name: "shop", lines: ledger }], 1);
  assert.deepEqual(
    recent.map((run) => [run.project, run.run, run.host]),
    [
      ["shop", "R2", "host-a"],
      ["shop", "R1", "host-b"],
    ],
    "at most one per machine here, newest first, the imported run left out",
  );
});
