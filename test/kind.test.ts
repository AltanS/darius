/**
 * The kinds of the web app (web/app/lib/kind.ts): a ritual and a vigil, with
 * manual as a modifier of a ritual (mode off). Pure functions, no handler and no build.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import type { ProjectStatus, RitualRow, RunRow } from "../src/web/api.ts";
import { isManual, itemKind, itemManual, kindWord, type Kind } from "../web/app/lib/kind.ts";
import { activity } from "../web/app/lib/view.ts";

function ritual(slug: string, extra: Partial<RitualRow> = {}): RitualRow {
  return { slug, title: slug, lifecycle: "active", mode: "report", cadence: "1d", nextDue: null, isDue: false, overdueDays: 0, skill: null, profile: null, host: null, lastCompleted: null, heldRun: null, openRun: null, failedToday: null, ...extra };
}

function run(item: string, startedAt: string): RunRow {
  return { run: `01${startedAt}`, item, phase: "closed", outcome: "complete", startedAt, endedAt: startedAt, who: "timer", questions: [], findingsSha: null, result: null, acknowledged: null };
}

test("a ritual in mode off is manual; one darius runs is not", () => {
  assert.equal(isManual(ritual("a", { mode: "report" })), false);
  assert.equal(isManual(ritual("b", { mode: "act" })), false);
  assert.equal(isManual(ritual("c", { mode: "off" })), true);
});

test("a retired ritual is not started by darius, so it counts as manual", () => {
  assert.equal(isManual(ritual("d", { mode: "report", lifecycle: "retired" })), true);
});

test("the kind of a run item follows its prefix; manual is a modifier of a ritual only", () => {
  assert.equal(itemKind("vigil/soak"), "vigil");
  assert.equal(itemKind("ritual/a"), "ritual");
  assert.equal(itemManual("vigil/soak", ritual("soak", { mode: "off" })), false, "a vigil is never manual, even when a ritual shares its slug");
  assert.equal(itemManual("ritual/a", ritual("a", { mode: "off" })), true);
  assert.equal(itemManual("ritual/a", ritual("a", { mode: "report" })), false);
  assert.equal(itemManual("ritual/gone"), false, "an unknown ritual has no row to ask, so it is one darius ran");
});

test("each kind has its own word", () => {
  const kinds: Kind[] = ["ritual", "vigil"];
  assert.deepEqual(kinds.map((kind) => kindWord(kind)), ["ritual", "vigil"]);
});

test("the activity rows carry the kind of their item", () => {
  const runs = [run("ritual/auto", "2026-09-30T01:00:00Z"), run("ritual/hand", "2026-09-30T02:00:00Z"), run("vigil/soak", "2026-09-30T03:00:00Z")];
  const project: ProjectStatus = { name: "p", checkout: null, maxMode: null, lastSync: null, rituals: [ritual("auto"), ritual("hand", { mode: "off" })], runs, vigils: [], error: null };
  const kinds = Object.fromEntries(activity([project], { withImported: true }).map((row) => [row.slug, [row.kind, row.manual]]));
  assert.deepEqual(kinds, { auto: ["ritual", false], hand: ["ritual", true], soak: ["vigil", false] });
});
