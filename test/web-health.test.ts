/**
 * The health word of a workspace (0.140.0, src/web/health.ts) and the
 * ledger facts it reads (src/web/workspaces.ts): one test per rule, the
 * run streaks, the placement, and which lines count as activity.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { healthOf, type HealthFacts } from "../src/web/health.ts";
import { newestActivity, placesFromLedger, ritualRuns } from "../src/web/workspaces.ts";
import type { LedgerLine } from "../src/core/model.ts";

const NOW = Date.parse("2026-11-25T10:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function iso(ago: number): string {
  return new Date(NOW - ago).toISOString();
}

/** A workspace with nothing wrong and recent activity: OK. */
function facts(extra: Partial<HealthFacts> = {}): HealthFacts {
  return {
    error: null,
    candlesHigh: 0,
    candlesLow: 0,
    vigilsFlagged: 0,
    vigilsDue: 0,
    ritualsFailing: 0,
    ritualsFailedOnce: 0,
    ritualsLate: 0,
    runsHeld: 0,
    findingsNeedYou: 0,
    activeRituals: 1,
    openVigils: 0,
    lastActivity: iso(HOUR),
    treeConflicts: 0,
    cannotStart: [],
    ...extra,
  };
}

test("OK: nothing wrong and something active", () => {
  assert.deepEqual(healthOf(facts(), NOW), { health: "ok", reasons: [] });
});

test("Unreadable wins over everything", () => {
  assert.deepEqual(healthOf(facts({ error: "bad marker", candlesHigh: 2, vigilsFlagged: 1 }), NOW), { health: "unreadable", reasons: ["store unreadable"] });
});

test("Failing: a high or critical candle, a flagged vigil, or a ritual that failed twice in a row; the reasons are counted", () => {
  assert.deepEqual(healthOf(facts({ candlesHigh: 2 }), NOW), { health: "failing", reasons: ["2 high candles lit"] });
  assert.deepEqual(healthOf(facts({ vigilsFlagged: 1 }), NOW), { health: "failing", reasons: ["1 vigil flagged"] });
  assert.deepEqual(healthOf(facts({ ritualsFailing: 1 }), NOW), { health: "failing", reasons: ["1 ritual failed twice"] });
  assert.deepEqual(healthOf(facts({ candlesHigh: 1, vigilsFlagged: 2, candlesLow: 3 }), NOW).reasons, ["1 high candle lit", "2 vigils flagged", "3 candles lit"], "the needs-you reasons follow the failing ones");
});

test("one failed run is Needs you, two in a row is Failing", () => {
  assert.deepEqual(healthOf(facts({ ritualsFailedOnce: 1 }), NOW), { health: "needs-you", reasons: ["1 run failed"] });
  assert.equal(healthOf(facts({ ritualsFailing: 1 }), NOW).health, "failing");
});

test("Needs you: each of its rules alone", () => {
  const cases: ReadonlyArray<readonly [Partial<HealthFacts>, string]> = [
    [{ candlesLow: 2 }, "2 candles lit"],
    [{ findingsNeedYou: 1 }, "1 open finding"],
    [{ runsHeld: 1 }, "1 run held"],
    [{ ritualsLate: 3 }, "3 rituals late"],
    [{ vigilsDue: 1 }, "1 vigil due"],
    [{ treeConflicts: 2 }, "2 tree conflicts"],
    [{ cannotStart: ["box-broken"] }, "box broken here"],
    [{ cannotStart: ["checkout-behind", "checkout-behind"] }, "checkout behind"],
    [{ copySyncedAt: iso(46 * 60_000) }, "copy not synced in 45 min"],
    [{ copySyncedAt: null }, "copy not synced in 45 min"],
  ];
  for (const [extra, reason] of cases) assert.deepEqual(healthOf(facts(extra), NOW), { health: "needs-you", reasons: [reason] }, reason);
});

test("a copy synced within 45 min is not stale; a checkout has no copy rule", () => {
  assert.equal(healthOf(facts({ copySyncedAt: iso(44 * 60_000) }), NOW).health, "ok");
  assert.equal(healthOf(facts({ lastActivity: iso(HOUR) }), NOW).health, "ok");
});

test("Quiet: no activity in 14 days and nothing active; an active ritual or an open vigil keeps it OK", () => {
  assert.deepEqual(healthOf(facts({ activeRituals: 0, lastActivity: iso(15 * DAY) }), NOW), { health: "quiet", reasons: ["no activity in 14 days"] });
  assert.deepEqual(healthOf(facts({ activeRituals: 0, lastActivity: null }), NOW), { health: "quiet", reasons: ["no activity yet"] });
  assert.equal(healthOf(facts({ activeRituals: 1, lastActivity: iso(15 * DAY) }), NOW).health, "ok");
  assert.equal(healthOf(facts({ activeRituals: 0, openVigils: 1, lastActivity: iso(15 * DAY) }), NOW).health, "ok");
  assert.equal(healthOf(facts({ activeRituals: 0, lastActivity: iso(13 * DAY) }), NOW).health, "ok");
});

let serial = 0;

function line(type: string, at: number, extra: Partial<LedgerLine> = {}): LedgerLine {
  serial += 1;
  return { id: `01LINE${String(serial).padStart(20, "0")}`, at: iso(at), host: "host-a", who: "timer", type, ...extra };
}

function runLines(run: string, slug: string, at: number, outcome: string | null): LedgerLine[] {
  const started = line("run.started", at, { run, item: `ritual/${slug}` });
  return outcome === null ? [started] : [started, line("run.completed", at - 60_000, { run, outcome })];
}

test("ritual runs: the failed streak counts from the newest closed run, per ritual, beyond the newest 20 of the project", () => {
  const lines = [
    ...runLines("r1", "scan", 5 * DAY, "complete"),
    ...runLines("r2", "scan", 4 * DAY, "failed"),
    ...runLines("r3", "scan", 3 * DAY, "failed"),
    ...runLines("r4", "once", 3 * DAY, "complete"),
    ...runLines("r5", "once", 2 * DAY, "failed"),
    ...Array.from({ length: 25 }, (_, index) => runLines(`n${String(index)}`, "noisy", DAY - index * 60_000, "complete")).flat(),
    ...runLines("r6", "busy", HOUR, null),
  ];
  const bySlug = new Map(ritualRuns(lines).map((entry) => [entry.slug, entry]));
  assert.equal(bySlug.get("scan")?.failedStreak, 2);
  assert.equal(bySlug.get("scan")?.last?.outcome, "failed");
  assert.equal(bySlug.get("once")?.failedStreak, 1);
  assert.equal(bySlug.get("noisy")?.failedStreak, 0);
  assert.deepEqual(bySlug.get("busy")?.last, { run: "r6", outcome: "running", at: iso(HOUR) });
});

test("placement: a host that linked holds a checkout, a host that only wrote lines a copy, this host by its own link", () => {
  const lines = [line("project.linked", DAY, { host: "host-b", path: "/srv/one" }), line("host.version", HOUR, { host: "host-c", version: "1.0.0" }), line("vigil.swept", HOUR, { host: "host-a" })];
  assert.deepEqual(placesFromLedger(lines, "host-a", false), [
    { host: "host-a", kind: "copy" },
    { host: "host-b", kind: "checkout" },
    { host: "host-c", kind: "copy" },
  ]);
  assert.deepEqual(placesFromLedger(lines, "host-a", true)[0], { host: "host-a", kind: "checkout" });
});

test("Quiet ignores host.version, alert and sync lines: they are not activity", () => {
  const work = line("vigil.swept", 20 * DAY);
  const noise = [line("host.version", HOUR, { version: "1.0.0" }), line("alert.sent", 2 * HOUR), line("alert.failed", 3 * HOUR), line("tree.captured", 4 * HOUR, { who: "sync" })];
  assert.equal(newestActivity([work, ...noise]), iso(20 * DAY));
  assert.equal(newestActivity(noise), null);
  assert.equal(healthOf(facts({ activeRituals: 0, lastActivity: newestActivity([work, ...noise]) }), NOW).health, "quiet");
});
