/**
 * The vigil side of the web status (src/web/status.ts): the fields a vigil
 * row gains in 0.85.0 (lastFailure, failKind, the pause) and the vigil detail
 * (`WebContext.vigil`). The store is a throwaway directory; ledger lines are
 * written by hand, in the shape the sweep writes them.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-web-vigil-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");

const { appendLine } = await import("../src/core/ledger.ts");
const { itemRef, openProject, putBlob } = await import("../src/core/store.ts");
const { addVigil, pauseVigil } = await import("../src/core/sweep.ts");
const { webContext } = await import("../src/web/context.ts");
const { collectStatus, vigilDetail } = await import("../src/web/status.ts");

const PROJECT = "web-vigil";
const BODY = "# checks\n\n## Verification Checklist\n\n- [ ] the page loads\n  - Command: `curl -sf http://localhost/`\n  - Expected: `exit 0`\n- [ ] the queue is empty\n  - Command: `test -z \"$(ls queue)\"`\n  - Expected: `exit 0`\n";
const OUTPUT = "<script>alert(1)</script>\n\u001b[31mred\u001b[0m\u0007 bell\nlast line\n";

function project() {
  return openProject(PROJECT, { create: true });
}

function addOne(slug: string): void {
  addVigil(project(), { slug, title: `Title of ${slug}`, body: BODY, due: "2026-10-01", heavy: false, who: "test" });
}

/** The lines of a failed sweep: one evidence line for check `index`, then the `vigil.swept` line. */
function failSweep(slug: string, index: number, extra: { recorded: boolean; exit: number; failKind?: string; output?: string }): void {
  const item = itemRef("vigil", slug);
  const evidence = {
    who: "sweep",
    type: "evidence",
    item,
    check: `${item}#${index}`,
    exit: extra.exit,
    outcome: "fail",
    output_sha: extra.output === undefined ? putBlob(project(), OUTPUT) : extra.output,
    duration_ms: 12,
  };
  appendLine(project(), extra.recorded ? { ...evidence, command: "curl -sf http://localhost/", expected: "exit 0" } : evidence);
  appendLine(project(), {
    who: "sweep",
    type: "vigil.swept",
    item,
    outcome: "failed",
    fail_kind: extra.failKind,
    gate: "n/a",
    checks: [{ index, outcome: "fail", exit: extra.exit, fail_kind: extra.failKind }],
  });
}

function rowOf(slug: string) {
  const row = collectStatus().projects.find((entry) => entry.name === PROJECT)?.vigils.find((vigil) => vigil.slug === slug);
  assert.ok(row, `no row for ${slug}`);
  return row;
}

test("a vigil row carries the failure, its kind and no pause while flagged and running", () => {
  addOne("plain");
  const plain = rowOf("plain");
  assert.deepEqual([plain.flagged, plain.lastFailure, plain.failKind, plain.paused, plain.pausedUntil], [false, null, null, false, null]);

  addOne("soak");
  failSweep("soak", 0, { recorded: true, exit: 1, failKind: "pending" });
  const row = rowOf("soak");
  assert.equal(row.flagged, true);
  assert.equal(row.failKind, "pending");
  assert.deepEqual({ ...row.lastFailure, at: "" }, { index: 0, text: "the page loads", exit: 1, outcome: "fail", at: "", failKind: "pending" });
  assert.match(row.lastFailure?.at ?? "", /^\d{4}-\d{2}-\d{2}T/u);
});

test("a line from before fail_kind reads unknown", () => {
  addOne("old-kind");
  failSweep("old-kind", 1, { recorded: false, exit: 22 });
  const row = rowOf("old-kind");
  assert.equal(row.failKind, "unknown");
  assert.equal(row.lastFailure?.text, "the queue is empty");
});

test("a paused vigil says so and when the snooze ends; a pause without a date has none", () => {
  addOne("snoozed");
  pauseVigil(project(), { slug: "snoozed", reason: "waiting on the vendor", until: "2999-01-01", who: "test" });
  const snoozed = rowOf("snoozed");
  assert.deepEqual([snoozed.paused, snoozed.pausedUntil], [true, "2999-01-01"]);
  addOne("held-off");
  pauseVigil(project(), { slug: "held-off", reason: "until resumed", who: "test" });
  assert.deepEqual([rowOf("held-off").paused, rowOf("held-off").pausedUntil], [true, null]);
  assert.equal(vigilDetail(PROJECT, "snoozed")?.pausedReason, "waiting on the vendor");
});

test("the vigil detail has the failure block, the output as plain text and the sweeps newest first", () => {
  addOne("detail");
  for (let count = 0; count < 12; count += 1) failSweep("detail", 0, { recorded: true, exit: count, failKind: "broken" });
  const detail = vigilDetail(PROJECT, "detail");
  assert.ok(detail);
  const { failure } = detail;
  assert.ok(failure);
  assert.deepEqual([failure.source, failure.command, failure.expected, failure.exit, failure.failKind], ["evidence", "curl -sf http://localhost/", "exit 0", 11, "broken"]);
  assert.ok(failure.host.length > 0);
  assert.equal(failure.outputTail, "<script>alert(1)</script>\n[31mred[0m bell\nlast line", "kept as text; the escape and bell characters are dropped");
  assert.equal(detail.sweeps.length, 10, "the last 10 sweeps");
  assert.deepEqual(detail.sweeps.slice(0, 2).map((sweep) => sweep.checks[0]?.exit), [11, 10], "newest first");
  assert.deepEqual([detail.sweeps[0]?.outcome, detail.sweeps[0]?.failKind], ["failed", "broken"]);
  assert.equal(detail.row.title, "Title of detail");
  assert.equal(detail.body.length > 0, true);
});

test("an older evidence line shows the current body and says where it came from; a missing blob has no output", () => {
  addOne("no-command");
  failSweep("no-command", 0, { recorded: false, exit: 22, output: "f".repeat(64) });
  const failure = vigilDetail(PROJECT, "no-command")?.failure;
  assert.deepEqual([failure?.source, failure?.command, failure?.outputTail], ["body", "curl -sf http://localhost/", null]);
});

test("a vigil that is not flagged has no failure block; an unknown project or vigil is null", () => {
  assert.equal(vigilDetail(PROJECT, "plain")?.failure, null);
  assert.equal(vigilDetail(PROJECT, "plain")?.sweeps.length, 0);
  assert.equal(vigilDetail(PROJECT, "ghost"), null);
  assert.equal(vigilDetail("no-such-project", "plain"), null);
});

test("the web context hands the vigil detail to the app", () => {
  assert.equal(webContext("owner on phone").vigil(PROJECT, "soak")?.row.failKind, "pending");
});
