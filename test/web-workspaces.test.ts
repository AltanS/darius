/**
 * The rows of the Workspaces list on the all-workspaces Overview
 * (workspaceRows in web/app/lib/home.ts): one row per workspace, the ones that
 * need you first, then by name; an unreadable workspace says so; a workspace
 * with nothing dated has no next item. Pure data in, plain data out.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import type { HostStatus, ProjectStatus, RitualRow, RunRow, VigilRow } from "../src/web/api.ts";
import { homeView, needCounts, workspaceRows } from "../web/app/lib/home.ts";

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
    args: null,
    timeout: null,
    nextDueAt: null,
    warnings: [],
    ...extra,
  };
}

function vigil(slug: string, extra: Partial<VigilRow> = {}): VigilRow {
  return { slug, title: slug, state: "armed", verdict: null, flagged: false, lastOutcome: null, due: null, until: null, ...extra };
}

function project(name: string, rituals: RitualRow[] = [], vigils: VigilRow[] = [], extra: Partial<ProjectStatus> = {}): ProjectStatus {
  return { name, icon: null, checkout: null, maxMode: null, lastSync: null, rituals, runs: [], vigils, milestones: [], milestonesArchived: 0, findings: { needsYou: 0, open: 0 }, error: null, ...extra };
}

function status(projects: ProjectStatus[]): HostStatus {
  return { host: "testhost", version: "9.9.9", generatedAt: `${TODAY}T09:00:00.000Z`, today: TODAY, utcOffset: 0, profiles: [], projects };
}

const FLAGGED = (slug: string): VigilRow => vigil(slug, { flagged: true, lastOutcome: "failed", due: "2026-09-29" });

test("rows run by needs, most first, then by name", () => {
  const rows = workspaceRows(status([project("zeta"), project("alpha"), project("busy", [], [FLAGGED("a"), FLAGGED("b")]), project("one", [], [FLAGGED("c")])]));
  assert.deepEqual(
    rows.map((row) => [row.name, row.needs]),
    [["busy", 2], ["one", 1], ["alpha", 0], ["zeta", 0]],
  );
});

test("a row links to the Overview of its workspace, with the name encoded", () => {
  const rows = workspaceRows(status([project("demo"), project("my shop")]));
  assert.deepEqual(rows.map((row) => row.href), ["/w/demo", "/w/my%20shop"]);
});

test("an unreadable workspace says so, counts as one need, and has no next item", () => {
  const broken = project("broken", [ritual("daily", { nextDue: "2026-10-01" })], [], { error: "cannot read the store" });
  const [row] = workspaceRows(status([broken]));
  assert.equal(row?.unreadable, true);
  assert.equal(row?.needs, 1);
  assert.equal(row?.next, null);
});

test("the next item is the first dated one that is not late, with its date and its day in words", () => {
  const shop = project("shop", [ritual("late", { nextDue: "2026-09-25", overdueDays: 5 }), ritual("soon", { title: "Soon ritual", nextDue: "2026-10-01" }), ritual("far", { nextDue: "2026-10-20" })]);
  const [row] = workspaceRows(status([shop]));
  assert.deepEqual(row?.next, { title: "Soon ritual", date: "2026-10-01", when: "tomorrow" });
  assert.equal(row?.unreadable, false);
});

test("a workspace with nothing dated has no next item", () => {
  const quiet = project("quiet", [ritual("loose", { cadence: null }), ritual("gone", { lifecycle: "retired", nextDue: "2026-10-02" })], [vigil("event", { until: "the next deploy" })]);
  const [row] = workspaceRows(status([quiet]));
  assert.equal(row?.next, null);
  assert.equal(row?.needs, 0);
});

test("the self-test workspace is left out unless the scope shows it", () => {
  const all = status([project("demo"), project("darius-selftest")]);
  assert.deepEqual(workspaceRows(all).map((row) => row.name), ["demo"]);
  assert.deepEqual(workspaceRows(all, { workspace: null, includeSelftest: true }).map((row) => row.name), ["darius-selftest", "demo"]);
});

test("no workspace, no rows", () => {
  assert.deepEqual(workspaceRows(status([])), []);
});

// --- the Overview counts: vigils due, rituals that cannot run, superseded questions -----------

const stripOf = (projects: ProjectStatus[]) => homeView(status(projects), () => null).strip;
const countOf = (projects: ProjectStatus[], key: string) => stripOf(projects).find((segment) => segment.key === key)?.count ?? null;

test("the vigils tile counts the vigils that are late or due today, the number of the Vigils badge", () => {
  const vigils = [vigil("late", { due: "2026-09-29" }), vigil("today", { due: TODAY }), vigil("far", { due: "2027-01-01" }), vigil("event", { until: "a batch" })];
  const segment = stripOf([project("shop", [], vigils)]).find((entry) => entry.key === "vigils");
  assert.equal(segment?.count, 2);
  assert.equal(segment?.label, "vigils due");
  assert.equal(segment?.href, "/vigils#coming-up");
  assert.equal(countOf([project("shop", [], [vigil("event", { until: "a batch" }), vigil("far", { due: "2027-01-01" })])], "vigils"), null, "armed vigils that need nothing leave no tile");
});

test("a late ritual with mode off adds nothing to the late tile", () => {
  const hand = ritual("hand", { nextDue: "2026-09-20", overdueDays: 10 });
  const djinn = ritual("djinn", { mode: "report", skill: "djinn", nextDue: "2026-09-25", overdueDays: 5 });
  assert.equal(countOf([project("shop", [hand])], "late"), null);
  assert.equal(countOf([project("shop", [hand, djinn])], "late"), 1);
});

const RESULT = { status: "attention" as const, questions: 2, open: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }, fixed: 0 };

function run(id: string, item: string, startedAt: string, extra: Partial<RunRow> = {}): RunRow {
  return { run: id, item, phase: "closed", outcome: "complete", startedAt, endedAt: startedAt, who: "timer", questions: [], findingsSha: null, result: RESULT, acknowledged: null, ...extra };
}

const REPORT = ritual("report", { mode: "report", skill: "report", nextDue: "2026-10-05" });
const OTHER = ritual("other", { mode: "report", skill: "other", nextDue: "2026-10-05" });
const OLD = run("01OLD", "ritual/report", "2026-09-28T05:00:00.000Z");
const NEWER = (extra: Partial<RunRow> = {}): RunRow => run("01NEW", "ritual/report", "2026-09-29T05:00:00.000Z", { result: null, ...extra });

/** The asks cards, the need-you tile and the needs count of a workspace, for the runs given. */
function asksOf(runs: RunRow[], projectName = "shop") {
  const shop = project(projectName, [REPORT, OTHER], [], { runs });
  const view = homeView(status([shop]), () => null);
  return { cards: view.needs.filter((card) => card.kind === "asks").length, tile: view.strip.find((segment) => segment.key === "need")?.count ?? null, needs: needCounts(status([shop])).total };
}

test("a question card shows for a complete run with open questions", () => {
  assert.deepEqual(asksOf([OLD]), { cards: 1, tile: 1, needs: 1 });
});

test("a newer complete run of the same ritual takes the card away, in the cards, the tile and the count", () => {
  assert.deepEqual(asksOf([NEWER(), OLD]), { cards: 0, tile: null, needs: 0 });
});

test("a newer run that failed, is held or is of another ritual leaves the question card", () => {
  assert.equal(asksOf([NEWER({ outcome: "failed" }), OLD]).cards, 1, "failed");
  assert.equal(asksOf([NEWER({ phase: "held", outcome: null }), OLD]).cards, 1, "held (and the held card shows too)");
  assert.equal(asksOf([NEWER({ item: "ritual/other" }), OLD]).cards, 1, "another ritual");
  assert.equal(asksOf([NEWER({ item: "ritual/other" }), OLD]).needs, 1);
});

test("a newer complete run of another project does not hide the question", () => {
  const shop = project("shop", [REPORT], [], { runs: [OLD] });
  const docs = project("docs", [REPORT], [], { runs: [NEWER()] });
  const view = homeView(status([shop, docs]), () => null);
  assert.equal(view.needs.filter((card) => card.kind === "asks").length, 1);
});
