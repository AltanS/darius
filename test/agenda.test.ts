/**
 * The agenda of the web app (web/app/lib/agenda.ts): every active ritual once
 * at its next date, dated vigils among them, event vigils apart. Pure data in,
 * plain data out, so no handler and no build is needed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import type { ProjectStatus, RitualRow, RunRow, VigilRow } from "../src/web/api.ts";
import { buildAgenda, nextLine, phoneHidden, type Agenda } from "../web/app/lib/agenda.ts";
import { cadenceText } from "../web/app/lib/view.ts";

const TODAY = "2026-09-30";

function ritual(slug: string, extra: Partial<RitualRow> = {}): RitualRow {
  return {
    slug,
    title: slug,
    lifecycle: "active",
    mode: "off",
    cadence: "7d",
    nextDue: null,
    isDue: false,
    overdueDays: 0,
    skill: null,
    profile: null,
    host: null,
    lastCompleted: null,
    heldRun: null,
    openRun: null,
    failedToday: null,
    source: null,
    defCommit: null,
    defHost: null,
    defAt: null,
    defDirty: false,
    at: null,
    zone: null,
    timeout: null,
    nextDueAt: null,
    warnings: [],
    ...extra,
  };
}

function vigil(slug: string, extra: Partial<VigilRow> = {}): VigilRow {
  return { slug, title: slug, state: "armed", verdict: null, flagged: false, lastOutcome: null, due: null, until: null, ...extra };
}

function project(name: string, rituals: RitualRow[], vigils: VigilRow[] = [], runs: RunRow[] = []): ProjectStatus {
  return { name, checkout: null, maxMode: null, lastSync: null, rituals, runs, vigils, milestones: [], milestonesArchived: 0, error: null };
}

function build(projects: ProjectStatus[]): Agenda {
  return buildAgenda({ projects, today: TODAY });
}

function labels(agenda: Agenda): string[] {
  return agenda.groups.map((group) => group.label);
}

function titles(agenda: Agenda, label: string): string[] {
  return agenda.groups.find((group) => group.label === label)?.rows.map((row) => row.title) ?? [];
}

const SAMPLE = project(
  "shop",
  [
    ritual("late-most", { nextDue: "2026-09-17", overdueDays: 13 }),
    ritual("late-less", { nextDue: "2026-09-25", overdueDays: 5 }),
    ritual("due-hand", { nextDue: TODAY, isDue: true }),
    ritual("due-djinn", { mode: "report", skill: "due-djinn", nextDue: TODAY, isDue: true }),
    ritual("next-day", { nextDue: "2026-10-01" }),
    ritual("in-six", { nextDue: "2026-10-06" }),
    ritual("in-forty", { nextDue: "2026-11-09", cadence: "180d" }),
    ritual("loose", { cadence: null }),
    ritual("gone", { lifecycle: "retired", nextDue: "2026-10-02" }),
  ],
  [
    vigil("dated-late", { due: "2026-09-29", flagged: true, lastOutcome: "failed" }),
    vigil("dated-today", { due: TODAY, until: "the batch" }),
    vigil("dated-far", { due: "2027-02-26" }),
    vigil("event-a", { until: "the first real batch" }),
    vigil("event-flagged", { flagged: true, until: "the next deploy" }),
    vigil("closed-one", { state: "closed", due: "2026-10-03" }),
  ],
);

test("every active ritual appears exactly once, retired ones never", () => {
  const agenda = build([SAMPLE]);
  const rows = agenda.groups.flatMap((group) => group.rows).filter((row) => row.kind !== "vigil");
  const slugs = rows.map((row) => row.slug).toSorted();
  assert.deepEqual(slugs, ["due-djinn", "due-hand", "in-forty", "in-six", "late-less", "late-most", "loose", "next-day"]);
});

test("the groups run from Overdue through the days to Later and No schedule", () => {
  const agenda = build([SAMPLE]);
  assert.deepEqual(labels(agenda), ["Overdue", "Today", "Tomorrow", "Tue 6 Oct", "Later", "No schedule"]);
  assert.deepEqual(agenda.groups.map((group) => group.kind), ["overdue", "today", "tomorrow", "day", "later", "none"]);
});

test("Overdue runs from the most overdue; other groups put rituals darius runs first, then the title", () => {
  const agenda = build([SAMPLE]);
  assert.deepEqual(titles(agenda, "Overdue"), ["late-most", "late-less", "dated-late"]);
  assert.deepEqual(titles(agenda, "Today"), ["due-djinn", "dated-today", "due-hand"], "the ritual darius runs first, then by title");
  assert.equal(agenda.groups[1]?.rows[0]?.kind, "ritual", "the ritual darius runs leads Today");
});

test("vigils: dated ones join the agenda, event ones wait apart, closed ones vanish", () => {
  const agenda = build([SAMPLE]);
  const dated = agenda.groups.flatMap((group) => group.rows).filter((row) => row.kind === "vigil").map((row) => row.slug);
  assert.deepEqual(dated.toSorted(), ["dated-far", "dated-late", "dated-today"]);
  assert.deepEqual(agenda.waiting.map((row) => row.slug), ["event-flagged", "event-a"], "flagged first");
  assert.equal(agenda.armed, 5);
  const late = agenda.groups[0]?.rows.find((row) => row.slug === "dated-late");
  assert.equal(late?.note, "last check failed, 1 day late");
  assert.equal(late?.state?.label, "Flagged");
  assert.equal(late?.rail, "bad");
  assert.equal(late?.overdueDays, 1);
});

test("the counts and the Next line: overdue first, then the first thing that is not overdue", () => {
  const agenda = build([SAMPLE]);
  assert.equal(agenda.overdue, 3, "two rituals and one dated vigil");
  assert.equal(agenda.dueToday, 3);
  assert.equal(agenda.next?.title, "due-djinn");
  assert.deepEqual(nextLine(agenda, TODAY), { title: "due-djinn", href: "/p/shop/rituals/due-djinn", kind: "ritual", manual: false, when: "today", isToday: true });
  const quiet = build([project("shop", [ritual("only", { nextDue: "2026-10-01" })])]);
  const tomorrow = nextLine(quiet, TODAY);
  assert.equal(tomorrow?.when, "tomorrow");
  assert.equal(tomorrow?.isToday, false);
  assert.equal(tomorrow?.manual, true, "a ritual in mode off is manual: the Next line shows the ritual icon, the manual modifier is on the row");
  assert.equal(nextLine(build([project("shop", [])]), TODAY), null);
  const long = build([project("shop", [ritual("long", { title: "Partner App of the Month booking ends (no date window exists)", nextDue: "2026-10-01" })])]);
  assert.equal(nextLine(long, TODAY)?.title, "Partner App of the Month booking ends (no date window exists)", "the title is whole: the page wraps it");
  assert.equal(nextLine(build([project("shop", [ritual("far", { nextDue: "2026-11-15" })])]), TODAY)?.when, "15 Nov");
});

test("running and held djinns sit in Today with their state word; a failure today waits until tomorrow", () => {
  const agenda = build([
    project("shop", [
      ritual("runs", { mode: "report", skill: "runs", nextDue: TODAY, openRun: "r1" }),
      ritual("holds", { mode: "report", skill: "holds", nextDue: "2026-09-20", overdueDays: 10, heldRun: "r2" }),
      ritual("broke", { mode: "report", skill: "broke", nextDue: TODAY, isDue: true, failedToday: { run: "r3", acknowledged: null } }),
    ]),
  ]);
  assert.deepEqual(titles(agenda, "Today"), ["holds", "runs"]);
  assert.deepEqual(agenda.groups.find((group) => group.label === "Today")?.rows.map((row) => row.state?.label), ["Waiting for you", "Running"]);
  assert.deepEqual(titles(agenda, "Tomorrow"), ["broke"]);
  assert.equal(agenda.groups.find((group) => group.label === "Tomorrow")?.rows[0]?.state?.label, "Failed");
  assert.equal(agenda.overdue, 0, "a held djinn is not overdue");
  assert.equal(agenda.dueToday, 0, "running and held rows are not due today");
});

test("a complete run that asks the operator something shows as Asks you", () => {
  const asks: RunRow = {
    run: "01ASK",
    item: "ritual/report",
    phase: "closed",
    outcome: "complete",
    startedAt: "2026-09-30T05:00:00.000Z",
    endedAt: "2026-09-30T05:04:00.000Z",
    who: "timer",
    questions: [],
    findingsSha: "x",
    result: { status: "attention", questions: 1, open: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }, fixed: 0 },
    acknowledged: null,
  };
  const agenda = build([project("shop", [ritual("report", { mode: "report", skill: "report", nextDue: "2026-10-01" })], [], [asks])]);
  assert.equal(agenda.groups[0]?.rows[0]?.state?.label, "Asks you");
});

test("the project name shows only when more than one project contributes", () => {
  assert.equal(build([SAMPLE]).showProject, false);
  const other = project("docs", [ritual("x", { nextDue: "2026-10-01" })]);
  assert.equal(build([SAMPLE, other]).showProject, true);
  assert.equal(build([SAMPLE, project("empty", [])]).showProject, false, "a project without rows does not count");
});

test("cadence and last done are in words", () => {
  const row = build([project("shop", [ritual("a", { cadence: "1d", nextDue: "2026-10-01", lastCompleted: "2026-09-14" })])]).groups[0]?.rows[0];
  assert.equal(row?.facts, "every day, last done 14 Sep");
  assert.equal(cadenceText("7d"), "every 7 days");
  assert.equal(cadenceText("1w"), "every week");
  assert.equal(cadenceText("3m"), "every 3 months");
  assert.equal(cadenceText("180d"), "every 180 days");
  assert.equal(cadenceText(null), null);
  const never = build([project("shop", [ritual("b", { cadence: null })])]).groups[0]?.rows[0];
  assert.equal(never?.facts, "not done yet");
});

test("the horizon: day 14 has its own group, day 15 is Later", () => {
  const agenda = build([project("shop", [ritual("edge", { nextDue: "2026-10-14" }), ritual("past", { nextDue: "2026-10-15" })])]);
  assert.deepEqual(labels(agenda), ["Wed 14 Oct", "Later"]);
});

test("a phone shows Overdue, Today and Tomorrow in full, then six more rows", () => {
  const many = Array.from({ length: 10 }, (_, index) => ritual(`later-${String(index).padStart(2, "0")}`, { nextDue: `2026-10-${String(3 + index).padStart(2, "0")}` }));
  const agenda = build([project("shop", [ritual("late", { nextDue: "2026-09-20", overdueDays: 10 }), ritual("soon", { nextDue: "2026-10-01" }), ...many])]);
  const hidden = phoneHidden(agenda);
  assert.equal(hidden.size, 4);
  assert.equal(hidden.has("shop/ritual/later-09"), true);
  assert.equal(hidden.has("shop/ritual/late"), false);
  assert.equal(hidden.has("shop/ritual/soon"), false);
});
