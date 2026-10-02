/**
 * The rows of the Workspaces list on the all-workspaces Overview
 * (workspaceRows in web/app/lib/home.ts): one row per workspace, the ones that
 * need you first, then by name; an unreadable workspace says so; a workspace
 * with nothing dated has no next item. Pure data in, plain data out.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import type { HostStatus, ProjectStatus, RitualRow, VigilRow } from "../src/web/api.ts";
import { workspaceRows } from "../web/app/lib/home.ts";

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
  return { name, checkout: null, maxMode: null, lastSync: null, rituals, runs: [], vigils, milestones: [], milestonesArchived: 0, findings: { needsYou: 0, open: 0 }, error: null, ...extra };
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
