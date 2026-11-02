/**
 * The flare index (src/core/flare-index.ts): flares are derived from the
 * ledger and the result blobs, keyed by (project, key), with the operator's
 * and the sources' lines on top.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectFlares, flareOpenings, CLEAN_RUNS, type Flare, type FlareOpening } from "../src/core/flare-index.ts";
import { appendLine, readLedger, type LedgerLineInput } from "../src/core/ledger.ts";
import type { Severity } from "../src/core/result.ts";
import { Seeder, type Item } from "./helpers/finding-seed.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-flare-index-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");

/** A flagged item that asks the operator for a decision. */
function flare(key: string, severity: Severity = "high", more: Item = {}): Item {
  return { key, title: `Flare ${key}`, severity, state: "needs-decision", flare: true, ...more };
}

class FlareSeeder extends Seeder {
  /** A `flare.lit` line, the way a script or a person reports. */
  light(key: string, severity: Severity = "high", more: Partial<LedgerLineInput> = {}): void {
    appendLine(this.project, {
      who: "script",
      type: "flare.lit",
      key,
      title: `Flare ${key}`,
      severity,
      source: "ci:nightly",
      deliver: ["push"],
      at: this.tick(),
      ...more,
    });
  }

  operator(type: string, key: string, more: Partial<LedgerLineInput> = {}): void {
    appendLine(this.project, { who: "op", type, key, at: this.tick(), ...more });
  }

  answer(key: string, severity: Severity = "high"): void {
    this.operator("flare.answered", key, { note: "looked at it", severity });
  }

  accept(key: string, severity: Severity = "high"): void {
    this.operator("flare.accepted", key, { severity });
  }

  flares(): Flare[] {
    return collectFlares(this.project, readLedger(this.project));
  }

  flare(key: string): Flare {
    const found = this.flares().find((entry) => entry.key === key);
    assert.ok(found !== undefined, `no flare ${key}`);
    return found;
  }

  openings(): FlareOpening[] {
    return flareOpenings(this.project, readLedger(this.project));
  }
}

test("a flagged item in a run opens a flare with the ritual and the run", () => {
  const seed = new FlareSeeder("fl-open");
  const run = seed.run("audit", [flare("cve-1", "critical", { target: "package a", detail: "not kept" })]);
  const [only] = seed.flares();
  assert.equal(seed.flares().length, 1);
  assert.equal(only?.key, "cve-1");
  assert.equal(only?.status, "lit");
  assert.equal(only?.severity, "critical");
  assert.equal(only?.title, "Flare cve-1");
  assert.equal(only?.target, "package a");
  assert.equal(only?.ritual, "audit");
  assert.equal(only?.run, run);
  assert.equal(only?.source, "ritual:audit");
  assert.equal(only?.reports, 1);
  assert.equal(only?.stillReported, false);
  assert.equal(only?.firstSeen.run, run);
  assert.deepEqual(only?.history.map((step) => step.kind), ["lit"]);
  assert.deepEqual(seed.openings().map((entry) => entry.flares.map((opened) => [opened.key, opened.kind])), [[["cve-1", "opened"]]]);
});

test("a flare.lit line opens a flare from outside, with its channels and no ritual", () => {
  const seed = new FlareSeeder("fl-script");
  seed.light("scan-1", "medium", { target: "host a", body_sha: "abc", deliver: ["push", "email"] });
  const found = seed.flare("scan-1");
  assert.equal(found.status, "lit");
  assert.equal(found.source, "ci:nightly");
  assert.equal(found.ritual, undefined);
  assert.equal(found.run, undefined);
  assert.equal(found.bodySha, "abc");
  assert.deepEqual(found.deliver, ["push", "email"]);
  assert.equal(found.target, "host a");
});

test("a report while lit counts and moves lastSeen, and opens nothing", () => {
  const seed = new FlareSeeder("fl-seen");
  const first = seed.run("audit", [flare("k", "high")]);
  const second = seed.run("audit", [flare("k", "high")]);
  seed.light("k", "high");
  const found = seed.flare("k");
  assert.equal(found.status, "lit");
  assert.equal(found.reports, 3);
  assert.equal(found.firstSeen.run, first);
  assert.notEqual(found.lastSeen.run, second, "the script report is the newest");
  assert.deepEqual(found.history.map((step) => step.kind), ["lit", "report", "report"]);
  assert.equal(seed.openings().length, 1, "only the first report opened it");
});

test("a higher severity while lit is an opening of kind raised", () => {
  const seed = new FlareSeeder("fl-raise-lit");
  seed.run("audit", [flare("k", "medium")]);
  seed.run("audit", [flare("k", "critical")]);
  seed.run("audit", [flare("k", "low")]);
  assert.deepEqual(seed.openings().map((entry) => entry.flares.map((opened) => opened.kind)), [["opened"], ["raised"]]);
  assert.equal(seed.flare("k").severity, "low", "the newest report names the severity");
});

test("a severity that moves down and up again is not a second raise", () => {
  const seed = new FlareSeeder("fl-yoyo");
  seed.run("audit", [flare("k", "high")]);
  seed.run("audit", [flare("k", "low")]);
  seed.run("audit", [flare("k", "high")]);
  seed.run("audit", [flare("k", "low")]);
  seed.run("audit", [flare("k", "critical")]);
  assert.deepEqual(seed.openings().map((entry) => entry.flares[0]?.kind), ["opened", "raised"]);
});

test("one line that opens two flares is one opening", () => {
  const seed = new FlareSeeder("fl-two");
  seed.run("audit", [flare("a"), flare("b"), { key: "c", title: "plain", severity: "low", state: "open" }]);
  const openings = seed.openings();
  assert.equal(openings.length, 1);
  assert.equal(openings[0]?.line.type, "run.completed");
  assert.deepEqual(openings[0]?.flares.map((opened) => opened.key), ["a", "b"]);
});

test("an answer closes the flare at its severity; the same or a lower report stays closed", () => {
  const seed = new FlareSeeder("fl-answer");
  seed.run("audit", [flare("k", "high")]);
  seed.answer("k", "high");
  const closed = seed.flare("k");
  assert.equal(closed.status, "answered");
  assert.equal(closed.answered?.note, "looked at it");
  assert.equal(closed.answered?.who, "op");
  assert.equal(closed.stillReported, false);
  seed.run("audit", [flare("k", "high")]);
  seed.run("audit", [flare("k", "low")]);
  const again = seed.flare("k");
  assert.equal(again.status, "answered", "the same and a lower severity stay closed");
  assert.equal(again.stillReported, true);
  assert.equal(again.severity, "high", "the closed severity stays");
  assert.equal(again.reports, 3);
  assert.equal(seed.openings().length, 1, "a closed flare that is seen again opens nothing");
});

test("an accept closes the flare at its severity too, and a higher severity relights it", () => {
  const seed = new FlareSeeder("fl-accept");
  seed.run("audit", [flare("k", "medium")]);
  seed.accept("k", "medium");
  assert.equal(seed.flare("k").status, "accepted");
  assert.equal(seed.flare("k").accepted?.severity, "medium");
  seed.run("audit", [flare("k", "medium")]);
  assert.equal(seed.flare("k").status, "accepted");
  seed.run("audit", [flare("k", "high")]);
  const lit = seed.flare("k");
  assert.equal(lit.status, "lit");
  assert.equal(lit.severity, "high");
  assert.equal(lit.accepted, undefined, "the accept is gone");
  assert.equal(lit.stillReported, false);
  assert.deepEqual(seed.openings().map((entry) => entry.flares[0]?.kind), ["opened", "raised"]);
});

test("a relight after an answer shows in the history", () => {
  const seed = new FlareSeeder("fl-relight");
  seed.light("k", "low");
  seed.answer("k", "low");
  seed.light("k", "critical");
  const found = seed.flare("k");
  assert.equal(found.status, "lit");
  assert.equal(found.answered, undefined);
  assert.deepEqual(found.history.map((step) => step.kind), ["lit", "answered", "raised"]);
});

test("flare.reopened takes back an answer or an accept, and does nothing to a lit flare", () => {
  const seed = new FlareSeeder("fl-reopen");
  seed.light("a", "high");
  seed.light("b", "high");
  seed.answer("a");
  seed.accept("b");
  seed.operator("flare.reopened", "a", { note: "not done" });
  seed.operator("flare.reopened", "b");
  seed.operator("flare.reopened", "b");
  assert.equal(seed.flare("a").status, "lit");
  assert.equal(seed.flare("a").answered, undefined);
  assert.equal(seed.flare("b").status, "lit");
  assert.deepEqual(seed.flare("a").history.map((step) => step.kind), ["lit", "answered", "reopened"]);
  assert.equal(seed.flare("a").history[2]?.note, "not done");
  assert.deepEqual(seed.flare("b").history.map((step) => step.kind), ["lit", "accepted", "reopened"], "the second reopen finds a lit flare");
  assert.equal(seed.openings().length, 2, "a reopen is not an opening");
});

test("a flagged item in state fixed clears the flare, as a source clear", () => {
  const seed = new FlareSeeder("fl-fixed");
  seed.run("audit", [flare("k", "high")]);
  const fixing = seed.run("audit", [flare("k", "high", { state: "fixed" })]);
  const found = seed.flare("k");
  assert.equal(found.status, "gone");
  assert.equal(found.cleared?.who, "t");
  assert.equal(found.reports, 1, "a clear is not a report");
  const last = found.history.at(-1);
  assert.equal(last?.kind, "cleared");
  assert.equal(last?.run, fixing);
});

test("a fixed report in a failed run does not clear the flare", () => {
  const seed = new FlareSeeder("fl-failed-fixed");
  seed.run("audit", [flare("k")]);
  seed.run("audit", [flare("k", "high", { state: "fixed" })], { outcome: "failed" });
  assert.equal(seed.flare("k").status, "lit");
});

test("a follow-up run may clear a flare with a fixed report", () => {
  const seed = new FlareSeeder("fl-fixed-follow");
  const parent = seed.run("audit", [flare("k", "high")]);
  seed.answer("k");
  seed.run("audit", [flare("k", "high", { state: "fixed" })], { followUpOf: parent });
  assert.equal(seed.flare("k").status, "gone");
  assert.equal(seed.flare("k").answered, undefined);
});

test("a fixed report for a flare that is not there, or already gone, changes nothing", () => {
  const seed = new FlareSeeder("fl-fixed-none");
  seed.run("audit", [flare("k", "high", { state: "fixed" })]);
  assert.deepEqual(seed.flares(), []);
  seed.run("audit", [flare("k")]);
  seed.run("audit", [flare("k", "high", { state: "fixed" })]);
  const before = seed.flare("k");
  seed.run("audit", [flare("k", "high", { state: "fixed" })]);
  assert.deepEqual(seed.flare("k"), before);
});

test("flare.cleared ends a flare, and a later report lights it again as a new opening", () => {
  const seed = new FlareSeeder("fl-cleared");
  seed.light("k", "high");
  seed.operator("flare.cleared", "k", { note: "patched" });
  const gone = seed.flare("k");
  assert.equal(gone.status, "gone");
  assert.equal(gone.cleared?.note, "patched");
  seed.answer("k");
  seed.operator("flare.reopened", "k");
  assert.equal(seed.flare("k").status, "gone", "an answer or a reopen of a gone flare does nothing");
  seed.light("k", "low");
  const lit = seed.flare("k");
  assert.equal(lit.status, "lit");
  assert.equal(lit.cleared, undefined);
  assert.equal(lit.reports, 2);
  assert.deepEqual(seed.openings().map((entry) => entry.flares[0]?.kind), ["opened", "opened"]);
});

test("two clean runs of the ritual make the flare gone; one does not", () => {
  const seed = new FlareSeeder("fl-clean");
  seed.run("audit", [flare("k")]);
  seed.run("audit", []);
  assert.equal(seed.flare("k").status, "lit", "one clean run is not enough");
  seed.run("audit", []);
  const gone = seed.flare("k");
  assert.equal(CLEAN_RUNS, 2);
  assert.equal(gone.status, "gone");
  assert.equal(gone.cleared, undefined, "gone by runs is no clear");
  assert.equal(gone.history.at(-1)?.kind, "gone");
});

test("a report between two clean runs starts the count again", () => {
  const seed = new FlareSeeder("fl-clean-reset");
  seed.run("audit", [flare("k")]);
  seed.run("audit", []);
  seed.run("audit", [flare("k")]);
  seed.run("audit", []);
  assert.equal(seed.flare("k").status, "lit");
  seed.run("audit", []);
  assert.equal(seed.flare("k").status, "gone");
});

test("a closed flare goes gone after two clean runs, and a report after that lights it again", () => {
  const seed = new FlareSeeder("fl-clean-closed");
  seed.run("audit", [flare("k")]);
  seed.accept("k");
  seed.run("audit", []);
  seed.run("audit", []);
  const gone = seed.flare("k");
  assert.equal(gone.status, "gone");
  assert.equal(gone.accepted, undefined);
  seed.run("audit", [flare("k")]);
  assert.equal(seed.flare("k").status, "lit");
  assert.equal(seed.openings().length, 2);
});

test("a failed run is never clean; a run without a result and a follow-up run are not either", () => {
  const seed = new FlareSeeder("fl-not-clean");
  const parent = seed.run("audit", [flare("k")]);
  seed.run("audit", [], { outcome: "failed" });
  seed.run("audit", [], { outcome: "failed" });
  seed.run("audit", [], { followUpOf: parent });
  seed.run("audit", [], { followUpOf: parent });
  seed.run("audit", [], { raw: "not a result" });
  seed.run("audit", [], { raw: "not a result" });
  assert.equal(seed.flare("k").status, "lit");
  seed.run("audit", []);
  assert.equal(seed.flare("k").status, "lit");
  seed.run("audit", []);
  assert.equal(seed.flare("k").status, "gone", "two full clean runs");
});

test("a clean run of another ritual does not count", () => {
  const seed = new FlareSeeder("fl-other-ritual");
  seed.run("audit", [flare("k")]);
  seed.run("other", []);
  seed.run("other", []);
  seed.run("other", []);
  assert.equal(seed.flare("k").status, "lit");
});

test("the ritual of the newest report counts, and a flare from outside never goes gone alone", () => {
  const seed = new FlareSeeder("fl-outside");
  seed.light("k", "high");
  for (let index = 0; index < 4; index += 1) seed.run("audit", []);
  assert.equal(seed.flare("k").status, "lit", "a script flare has no clean run");
  seed.run("audit", [flare("k")]);
  seed.light("k", "high");
  seed.run("audit", []);
  seed.run("audit", []);
  assert.equal(seed.flare("k").status, "lit", "the newest report came from a script");
  seed.run("audit", [flare("k")]);
  seed.run("audit", []);
  seed.run("audit", []);
  assert.equal(seed.flare("k").status, "gone", "the newest report came from a ritual again");
});

test("an item without the flag is not a flare, and a flare ignores finding.reset", () => {
  const seed = new FlareSeeder("fl-reset");
  seed.run("audit", [{ key: "plain", severity: "high", state: "needs-decision" }, flare("k")]);
  assert.deepEqual(seed.flares().map((entry) => entry.key), ["k"]);
  seed.reset();
  seed.reset("audit");
  assert.equal(seed.flare("k").status, "lit");
  assert.equal(seed.flare("k").reports, 1);
});

test("a malformed flare line, or one about an unknown flare, is skipped", () => {
  const seed = new FlareSeeder("fl-bad");
  seed.light("good", "high");
  seed.light("no-severity", "high", { severity: "dire" });
  seed.light("no-source", "high", { source: "  " });
  seed.light("no-title", "high", { title: 5 });
  seed.answer("unknown");
  seed.operator("flare.answered", "good", {});
  assert.deepEqual(seed.flares().map((entry) => [entry.key, entry.status]), [["good", "lit"]], "an answer needs a note");
});

test("flares sort lit first, worst first, newest first", () => {
  const seed = new FlareSeeder("fl-sort");
  seed.light("old-low", "low");
  seed.light("answered", "critical");
  seed.answer("answered", "critical");
  seed.light("new-low", "low");
  seed.light("high", "high");
  assert.deepEqual(seed.flares().map((entry) => entry.key), ["high", "new-low", "old-low", "answered"]);
});

test("the same ledger gives the same flares", () => {
  const seed = new FlareSeeder("fl-same");
  seed.run("audit", [flare("a"), flare("b", "low")]);
  seed.answer("a");
  seed.run("audit", [flare("a")]);
  assert.deepEqual(seed.flares(), seed.flares());
  assert.deepEqual(seed.openings().map((entry) => entry.line.id), seed.openings().map((entry) => entry.line.id));
});

test("collectFlares reads the ledger itself when none is given", () => {
  const seed = new FlareSeeder("fl-default");
  seed.light("k");
  assert.deepEqual(collectFlares(seed.project), seed.flares());
});

test("the history keeps the newest steps", () => {
  const seed = new FlareSeeder("fl-history");
  for (let index = 0; index < 40; index += 1) seed.light("k");
  const found = seed.flare("k");
  assert.equal(found.reports, 40);
  assert.equal(found.history.length, 30);
});
