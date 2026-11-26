/**
 * The row grammar of the lists (0.142.0, 0.143.0): which rituals need a look
 * and the order of the ones on schedule, the "Next" text, the word of a last
 * run, the runs by day, the Time cell, the mark of a
 * run that did not start the default way, and the run host and the recent
 * runs per host of the fleet view. Pure: web/app/lib/lists.ts, and
 * src/web/status.ts with src/web/fleet.ts over a throwaway store.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FleetDjinn, FleetWorkspace } from "../src/web/api.ts";
import type { LedgerLine } from "../src/core/model.ts";
import type { OpenAsk, PlacedRitual } from "../web/app/lib/lists.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-web-lists-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");

const lists = await import("../web/app/lib/lists.ts");
const { runRows, runRowsShared } = await import("../src/web/status.ts");
const { recentRunsByHost } = await import("../src/web/fleet.ts");

function djinn(slug: string, state: FleetDjinn["state"], change: Partial<FleetDjinn> = {}): FleetDjinn {
  return { slug, title: slug, state, nextDueAt: null, nextDue: null, host: "host-b", why: "checkout", lastOutcome: null, lastAt: null, lastRun: null, ...change };
}

const ASK: OpenAsk = { questions: 1, at: "2026-11-26T04:00:00.000Z" };

function placed(one: FleetDjinn, ask: OpenAsk | null = null, workspace = "shop"): PlacedRitual {
  return { workspace, ritual: one, ask };
}

// 2026-11-26 10:00 UTC, the host one hour east of UTC: 11:00 on its clock.
const CLOCK = { now: Date.parse("2026-11-26T10:00:00.000Z"), today: "2026-11-26", offset: 60 };

test("a ritual needs a look when it waits for your answer, failed its last run, or is late; running and due today are on schedule", () => {
  const problem = (one: FleetDjinn, ask: OpenAsk | null = null): string | null => lists.ritualProblem(placed(one, ask));
  assert.equal(problem(djinn("a", "held")), "waits", "a held run waits for your answer");
  assert.equal(problem(djinn("a", "idle", { lastOutcome: "complete" }), ASK), "waits", "an open question waits for your answer");
  assert.equal(problem(djinn("a", "idle", { lastOutcome: "failed" })), "failed");
  assert.equal(problem(djinn("a", "late", { lastOutcome: "failed" })), "failed", "a failure outranks late");
  assert.equal(problem(djinn("a", "late")), "late");
  assert.equal(problem(djinn("a", "running")), null);
  assert.equal(problem(djinn("a", "due")), null);
  assert.equal(problem(djinn("a", "idle", { lastOutcome: "abandoned" })), null);
  assert.equal(problem(djinn("a", "idle")), null, "a ritual that never ran");
});

test("the rituals on schedule: next due first, one with no schedule last; the ones that need a look by kind, then the oldest due first", () => {
  const rituals = [
    placed(djinn("z-later", "idle", { title: "A first by title", nextDueAt: "2026-11-30T08:00:00.000Z" })),
    placed(djinn("y-soon", "idle", { nextDueAt: "2026-11-26T12:00:00.000Z" })),
    placed(djinn("x-never", "idle")),
    placed(djinn("w-day", "due", { nextDue: "2026-11-26" })),
    placed(djinn("v-late", "late", { nextDue: "2026-11-24", nextDueAt: "2026-11-24T06:00:00.000Z" })),
    placed(djinn("u-failed", "idle", { lastOutcome: "failed", nextDueAt: "2026-11-27T06:00:00.000Z" })),
    placed(djinn("t-asks", "idle", { lastOutcome: "complete", nextDueAt: "2026-11-27T05:00:00.000Z" }), ASK),
    placed(djinn("s-held", "held", { nextDueAt: "2026-11-28T05:00:00.000Z" })),
    placed(djinn("r-late", "late", { nextDue: "2026-11-20", nextDueAt: "2026-11-20T06:00:00.000Z" })),
  ];
  assert.deepEqual(
    lists.onSchedule(rituals).map((one) => one.ritual.slug),
    ["w-day", "y-soon", "z-later", "x-never"],
  );
  assert.deepEqual(
    lists.withProblems(rituals).map((one) => [one.problem, one.ritual.slug]),
    [
      ["waits", "t-asks"],
      ["waits", "s-held"],
      ["failed", "u-failed"],
      ["late", "r-late"],
      ["late", "v-late"],
    ],
  );
});

test("the On schedule heading: the rituals on schedule of all that darius starts there", () => {
  assert.equal(lists.onScheduleTitle(9, 11), "On schedule (9 of 11)");
  assert.equal(lists.onScheduleTitle(11, 11), "On schedule (11)");
});

test("the Next text: the future is always a day word and a time, with the full local moment for the title; late by, due now; null with no schedule", () => {
  const next = (change: Partial<FleetDjinn>, state: FleetDjinn["state"] = "idle"): string | null => lists.nextText(djinn("a", state, change), CLOCK)?.text ?? null;
  assert.equal(next({}), null);
  assert.deepEqual(lists.nextText(djinn("a", "late", { nextDue: "2026-11-25", nextDueAt: "2026-11-25T06:00:00.000Z" }), CLOCK), { text: "late by 28 h", late: true, title: "Wed 25 Nov 07:00" });
  assert.equal(next({ nextDue: "2026-11-23", nextDueAt: "2026-11-23T06:00:00.000Z" }, "late"), "late by 3 d");
  assert.equal(next({ nextDue: "2026-11-26", nextDueAt: "2026-11-26T09:00:00.000Z" }, "due"), "due now");
  assert.deepEqual(lists.nextText(djinn("a", "idle", { nextDue: "2026-11-26", nextDueAt: "2026-11-26T13:00:00.000Z" }), CLOCK), { text: "today 14:00", late: false, title: "Thu 26 Nov 14:00" }, "later today: today and the time, never in 3 h");
  assert.equal(next({ nextDue: "2026-11-27", nextDueAt: "2026-11-27T06:00:00.000Z" }), "tomorrow 07:00", "on the host's clock");
  assert.equal(next({ nextDue: "2026-11-30", nextDueAt: "2026-11-30T06:00:00.000Z" }), "Mon 07:00");
  assert.equal(next({ nextDue: "2026-12-07", nextDueAt: "2026-12-07T06:00:00.000Z" }), "Mon 7 Dec 07:00", "a later day keeps its time");
  assert.equal(next({ nextDue: "2026-11-27" }), "tomorrow", "a due day without a time");
  assert.equal(next({ nextDue: "2026-11-30" }), "Mon 30 Nov");
  assert.equal(next({ nextDue: "2026-11-24" }, "late"), "late by 2 d");
});

test("the word of a last run is the same in every machine list: running, waits for your answer, or the outcome", () => {
  assert.deepEqual(lists.lastRunWord(null, "held"), { tone: "wait", label: "waits for your answer" }, "a held run never reads running");
  assert.deepEqual(lists.lastRunWord(null, "running"), { tone: "run", label: "running" });
  assert.deepEqual(lists.lastRunWord(null), { tone: "run", label: "running" }, "an open run with no phase");
  assert.deepEqual(lists.lastRunWord("held"), { tone: "wait", label: "waits for your answer" });
  assert.deepEqual(lists.lastRunWord("complete", null, true), { tone: "wait", label: "waits for your answer" }, "a complete run with an open question");
  assert.deepEqual(lists.lastRunWord("complete"), { tone: "ok", label: "complete" });
  assert.deepEqual(lists.lastRunWord("failed"), { tone: "bad", label: "failed" });
});

test("the Workspaces table: a held last run says waits for your answer, from the phase the fleet view keeps", () => {
  const ws: FleetWorkspace = {
    name: "shop",
    icon: null,
    health: "needs-you",
    reasons: ["1 run waits for your answer", "1 ritual late"],
    places: [{ host: "host-b", kind: "checkout", pinned: 0 }],
    here: "checkout",
    lastSync: null,
    counts: { djinns: 1, djinnsLate: 0, rituals: 1, ritualsLate: 0, vigilsOpen: 0, vigilsFlagged: 0, candlesLit: 0, findingsOpen: 0, findingsNeedYou: 0 },
    lastActivity: null,
    djinns: [djinn("report", "held")],
  };
  const held = { project: "shop", item: "ritual/report", host: "host-b", at: "2026-11-26T08:00:00.000Z", outcome: null, run: "R1", phase: "held" as const };
  const [row] = lists.runsHereRows("host-b", [ws], [held], [{ project: "shop" }]);
  assert.equal(row?.lastWord?.label, "waits for your answer");
  assert.deepEqual(row?.reasons, ["1 run waits for your answer", "1 ritual late"]);
  assert.equal(row?.rituals, 1);
  assert.equal(row?.needs, 0, "no need-you count given: none");
  const given = lists.runsHereRows("host-b", [ws], [held], [], new Map(), { shop: [{ kind: "answer", count: 1 }, { kind: "vigil", count: 3 }] })[0];
  assert.equal(given?.needs, 4, "the need-you count is the sum of the parts given, the badge's");
  assert.deepEqual(given?.needParts, [{ kind: "answer", count: 1 }, { kind: "vigil", count: 3 }]);
  const asked = { project: "shop", item: "ritual/report", host: "host-b", at: "2026-11-26T08:00:00.000Z", outcome: "complete", run: "R2" };
  assert.equal(lists.runsHereRows("host-b", [ws], [asked], [], new Map([["shop/R2", ASK]]))[0]?.lastWord?.label, "waits for your answer", "a run with an open question, from the same map as the ritual lists");
  assert.equal(lists.runsHereRows("host-b", [{ ...ws, health: "ok", reasons: [] }], [asked], [])[0]?.lastWord?.label, "complete");
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
