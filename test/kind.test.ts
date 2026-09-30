/**
 * The three kinds of the web app (web/app/lib/kind.ts): a ritual darius runs,
 * a ritual done by hand, and a vigil. Pure functions, no handler and no build.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import type { ProjectStatus, RitualRow, RunRow } from "../src/web/api.ts";
import { itemKind, kindWord, ritualKind, type Kind } from "../web/app/lib/kind.ts";
import { activity } from "../web/app/lib/view.ts";

function ritual(slug: string, extra: Partial<RitualRow> = {}): RitualRow {
  return { slug, title: slug, lifecycle: "active", mode: "report", cadence: "1d", nextDue: null, isDue: false, overdueDays: 0, skill: null, profile: null, host: null, lastCompleted: null, heldRun: null, openRun: null, failedToday: null, ...extra };
}

function run(item: string, startedAt: string): RunRow {
  return { run: `01${startedAt}`, item, phase: "closed", outcome: "complete", startedAt, endedAt: startedAt, who: "timer", questions: [], findingsSha: null, result: null, acknowledged: null };
}

test("a ritual darius runs is a ritual, a ritual in mode off is manual", () => {
  assert.equal(ritualKind(ritual("a", { mode: "report" })), "ritual");
  assert.equal(ritualKind(ritual("b", { mode: "act" })), "ritual");
  assert.equal(ritualKind(ritual("c", { mode: "off" })), "manual");
});

test("a retired ritual is not started by darius, so it counts as manual", () => {
  assert.equal(ritualKind(ritual("d", { mode: "report", lifecycle: "retired" })), "manual");
});

test("the kind of a run item follows its prefix and its ritual", () => {
  assert.equal(itemKind("vigil/soak"), "vigil");
  assert.equal(itemKind("vigil/soak", ritual("soak", { mode: "off" })), "vigil", "a vigil is never a ritual, even when a ritual shares its slug");
  assert.equal(itemKind("ritual/a", ritual("a", { mode: "off" })), "manual");
  assert.equal(itemKind("ritual/a", ritual("a", { mode: "report" })), "ritual");
  assert.equal(itemKind("ritual/gone"), "ritual", "an unknown ritual has no row to ask, so it is one darius ran");
});

test("each kind has its own word", () => {
  const kinds: Kind[] = ["ritual", "manual", "vigil"];
  assert.deepEqual(kinds.map((kind) => kindWord(kind)), ["ritual", "manual", "vigil"]);
});

test("the activity rows carry the kind of their item", () => {
  const runs = [run("ritual/auto", "2026-09-30T01:00:00Z"), run("ritual/hand", "2026-09-30T02:00:00Z"), run("vigil/soak", "2026-09-30T03:00:00Z")];
  const project: ProjectStatus = { name: "p", checkout: null, maxMode: null, lastSync: null, rituals: [ritual("auto"), ritual("hand", { mode: "off" })], runs, vigils: [], error: null };
  const kinds = Object.fromEntries(activity([project], { withImported: true }).map((row) => [row.slug, row.kind]));
  assert.deepEqual(kinds, { auto: "ritual", hand: "manual", soak: "vigil" });
});
