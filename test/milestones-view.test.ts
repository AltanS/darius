/**
 * The Milestones page as data (web/app/lib/milestones.ts): groups, order,
 * the tick rule, past targets and the counts text.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import type { MilestoneRow, SpecRow } from "../src/web/api.ts";
import { checksText, dateText, groupMilestones, groupOf, isTicked, specChecksText, specWord, targetPast } from "../web/app/lib/milestones.ts";

const TODAY = "2026-09-30";

function spec(extra: Partial<SpecRow> = {}): SpecRow {
  return { source: "legacy", slug: "m1-01-a", label: "M1/01", number: 1, title: "A", status: "Not Started", done: 0, total: 0, verified: false, verifiedAt: null, dependsOn: [], ...extra };
}

function milestone(id: string, extra: Partial<MilestoneRow> = {}): MilestoneRow {
  return { source: "legacy", id, label: id, slug: id.toLowerCase(), title: `Title ${id}`, started: null, target: null, status: "In Progress", done: 0, total: 0, specs: [], ...extra };
}

test("a spec is ticked when all its checks are done and it has some, whatever the verified flag says", () => {
  assert.equal(isTicked(6, 6), true);
  assert.equal(isTicked(5, 6), false);
  assert.equal(isTicked(0, 0), false);
  const [group] = groupMilestones([milestone("M1", { specs: [spec({ done: 3, total: 3, verified: false }), spec({ slug: "b", label: "M1/02", number: 2, done: 0, total: 0, verified: true })] })], TODAY);
  assert.deepEqual(group?.rows[0]?.specs.map((row) => row.ticked), [true, false]);
});

test("the counts text", () => {
  assert.equal(checksText(103, 143), "103 of 143 checks done");
  assert.equal(checksText(1, 1), "1 of 1 check done");
  assert.equal(checksText(0, 0), "No checks yet");
  assert.equal(specChecksText(4, 6), "4 of 6 checks");
  assert.equal(specChecksText(0, 0), "no checks");
});

test("a target before today is past, unless the milestone is complete or the date is not a date", () => {
  assert.equal(targetPast("2026-09-29", TODAY, false), true);
  assert.equal(targetPast("2026-09-30", TODAY, false), false);
  assert.equal(targetPast("2026-10-15", TODAY, false), false);
  assert.equal(targetPast("2026-09-01", TODAY, true), false);
  assert.equal(targetPast(null, TODAY, false), false);
  assert.equal(targetPast("TBD", TODAY, false), false);
});

test("dates: short in this year, with the year in another, as written when not a date", () => {
  assert.equal(dateText("2026-10-15", TODAY), "15 Oct");
  assert.equal(dateText("2025-11-03", TODAY), "3 Nov 2025");
  assert.equal(dateText("TBD", TODAY), "TBD");
});

test("statuses fall into four groups, and the spec words are Blocked, Waiting and Skipped", () => {
  assert.deepEqual(["In Progress", "Not Started", "Complete", "Skipped", "Deferred", "Closed"].map(groupOf), ["progress", "notstarted", "complete", "closed", "closed", "closed"]);
  assert.equal(specWord("Blocked")?.tone, "bad");
  assert.equal(specWord("Waiting")?.tone, "wait");
  assert.equal(specWord("Skipped")?.tone, "idle");
  assert.equal(specWord("In Progress"), null);
});

test("groups come in order, empty ones are left out, in progress shows the newest start first then the lower number", () => {
  const rows = [
    milestone("M5", { started: "2026-09-01" }),
    milestone("M9", { started: "2026-09-20" }),
    milestone("M3", { started: "2026-09-20" }),
    milestone("M2", { started: null }),
    milestone("M8", { status: "Not Started" }),
    milestone("M6", { status: "Not Started" }),
    milestone("M1", { status: "Complete", done: 2, total: 2 }),
    milestone("M4", { status: "Closed" }),
  ];
  const groups = groupMilestones(rows, TODAY);
  assert.deepEqual(groups.map((group) => [group.key, group.title, group.rows.map((row) => row.id)]), [
    ["progress", "In progress", ["M3", "M9", "M5", "M2"]],
    ["notstarted", "Not started", ["M6", "M8"]],
    ["complete", "Complete", ["M1"]],
    ["closed", "Closed", ["M4"]],
  ]);
  assert.deepEqual(groupMilestones([milestone("M1", { status: "Complete" })], TODAY).map((group) => group.key), ["complete"]);
  assert.deepEqual(groupMilestones([], TODAY), []);
});

test("a milestone row carries its counts, its target and its specs with dependencies by label", () => {
  const specs = [
    spec({ slug: "m1-02-b", label: "M1/02", number: 2, title: "B", status: "Waiting", done: 1, total: 4, dependsOn: ["m1-01-a", "m9-03-z"] }),
    spec({ slug: "m1-01-a", label: "M1/01", number: 1, status: "Complete", done: 2, total: 2 }),
  ];
  const [group] = groupMilestones([milestone("M1", { done: 3, total: 6, started: "2026-09-02", target: "2026-09-10", specs })], TODAY);
  const row = group?.rows[0];
  assert.equal(row?.checks, "3 of 6 checks done");
  assert.equal(row?.started, "2 Sep");
  assert.deepEqual(row?.target, { text: "10 Sep", past: true });
  assert.deepEqual(row?.specs.map((one) => one.label), ["M1/01", "M1/02"]);
  assert.deepEqual(row?.specs[1]?.dependsOn, ["M1/01", "M9/03"]);
  assert.equal(row?.specs[1]?.word?.label, "Waiting");
});
