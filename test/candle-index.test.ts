/**
 * The candle index (src/core/candle-index.ts): candles are derived from the
 * ledger and the result blobs, keyed by (project, key), with the operator's
 * and the sources' lines on top.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectCandles, candleOpenings, CLEAN_RUNS, foreignFixes, foreignFixLine, type Candle, type CandleOpening } from "../src/core/candle-index.ts";
import { appendLine, readLedger, type LedgerLineInput } from "../src/core/ledger.ts";
import type { Severity } from "../src/core/result.ts";
import { Seeder, type Item } from "./helpers/finding-seed.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-candle-index-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");

/** A flagged item that asks the operator for a decision. */
function candle(key: string, severity: Severity = "high", more: Item = {}): Item {
  return { key, title: `Candle ${key}`, severity, state: "needs-decision", candle: true, ...more };
}

class CandleSeeder extends Seeder {
  /** A `candle.lit` line, the way a script or a person reports. */
  light(key: string, severity: Severity = "high", more: Partial<LedgerLineInput> = {}): void {
    appendLine(this.project, {
      who: "script",
      type: "candle.lit",
      key,
      title: `Candle ${key}`,
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
    this.operator("candle.answered", key, { note: "looked at it", severity });
  }

  accept(key: string, severity: Severity = "high"): void {
    this.operator("candle.accepted", key, { severity });
  }

  candles(): Candle[] {
    return collectCandles(this.project, readLedger(this.project));
  }

  candle(key: string): Candle {
    const found = this.candles().find((entry) => entry.key === key);
    assert.ok(found !== undefined, `no candle ${key}`);
    return found;
  }

  openings(): CandleOpening[] {
    return candleOpenings(this.project, readLedger(this.project));
  }
}

test("a flagged item in a run opens a candle with the ritual and the run", () => {
  const seed = new CandleSeeder("fl-open");
  const run = seed.run("audit", [candle("cve-1", "critical", { target: "package a", detail: "not kept" })]);
  const [only] = seed.candles();
  assert.equal(seed.candles().length, 1);
  assert.equal(only?.key, "cve-1");
  assert.equal(only?.status, "lit");
  assert.equal(only?.severity, "critical");
  assert.equal(only?.title, "Candle cve-1");
  assert.equal(only?.target, "package a");
  assert.equal(only?.ritual, "audit");
  assert.equal(only?.run, run);
  assert.equal(only?.source, "ritual:audit");
  assert.equal(only?.reports, 1);
  assert.equal(only?.stillReported, false);
  assert.equal(only?.firstSeen.run, run);
  assert.deepEqual(only?.history.map((step) => step.kind), ["lit"]);
  assert.deepEqual(seed.openings().map((entry) => entry.candles.map((opened) => [opened.key, opened.kind])), [[["cve-1", "opened"]]]);
});

test("a candle.lit line opens a candle from outside, with its channels and no ritual", () => {
  const seed = new CandleSeeder("fl-script");
  seed.light("scan-1", "medium", { target: "host a", body_sha: "abc", deliver: ["push", "email"] });
  const found = seed.candle("scan-1");
  assert.equal(found.status, "lit");
  assert.equal(found.source, "ci:nightly");
  assert.equal(found.ritual, undefined);
  assert.equal(found.run, undefined);
  assert.equal(found.bodySha, "abc");
  assert.deepEqual(found.deliver, ["push", "email"]);
  assert.equal(found.target, "host a");
});

test("a report while lit counts and moves lastSeen, and opens nothing", () => {
  const seed = new CandleSeeder("fl-seen");
  const first = seed.run("audit", [candle("k", "high")]);
  const second = seed.run("audit", [candle("k", "high")]);
  seed.light("k", "high");
  const found = seed.candle("k");
  assert.equal(found.status, "lit");
  assert.equal(found.reports, 3);
  assert.equal(found.firstSeen.run, first);
  assert.notEqual(found.lastSeen.run, second, "the script report is the newest");
  assert.deepEqual(found.history.map((step) => step.kind), ["lit", "report", "report"]);
  assert.equal(seed.openings().length, 1, "only the first report opened it");
});

test("a higher severity while lit is an opening of kind raised", () => {
  const seed = new CandleSeeder("fl-raise-lit");
  seed.run("audit", [candle("k", "medium")]);
  seed.run("audit", [candle("k", "critical")]);
  seed.run("audit", [candle("k", "low")]);
  assert.deepEqual(seed.openings().map((entry) => entry.candles.map((opened) => opened.kind)), [["opened"], ["raised"]]);
  assert.equal(seed.candle("k").severity, "low", "the newest report names the severity");
});

test("a severity that moves down and up again is not a second raise", () => {
  const seed = new CandleSeeder("fl-yoyo");
  seed.run("audit", [candle("k", "high")]);
  seed.run("audit", [candle("k", "low")]);
  seed.run("audit", [candle("k", "high")]);
  seed.run("audit", [candle("k", "low")]);
  seed.run("audit", [candle("k", "critical")]);
  assert.deepEqual(seed.openings().map((entry) => entry.candles[0]?.kind), ["opened", "raised"]);
});

test("one line that opens two candles is one opening", () => {
  const seed = new CandleSeeder("fl-two");
  seed.run("audit", [candle("a"), candle("b"), { key: "c", title: "plain", severity: "low", state: "open" }]);
  const openings = seed.openings();
  assert.equal(openings.length, 1);
  assert.equal(openings[0]?.line.type, "run.completed");
  assert.deepEqual(openings[0]?.candles.map((opened) => opened.key), ["a", "b"]);
});

test("an answer closes the candle at its severity; the same or a lower report stays closed", () => {
  const seed = new CandleSeeder("fl-answer");
  seed.run("audit", [candle("k", "high")]);
  seed.answer("k", "high");
  const closed = seed.candle("k");
  assert.equal(closed.status, "answered");
  assert.equal(closed.answered?.note, "looked at it");
  assert.equal(closed.answered?.who, "op");
  assert.equal(closed.stillReported, false);
  seed.run("audit", [candle("k", "high")]);
  seed.run("audit", [candle("k", "low")]);
  const again = seed.candle("k");
  assert.equal(again.status, "answered", "the same and a lower severity stay closed");
  assert.equal(again.stillReported, true);
  assert.equal(again.severity, "high", "the closed severity stays");
  assert.equal(again.reports, 3);
  assert.equal(seed.openings().length, 1, "a closed candle that is seen again opens nothing");
});

test("an accept closes the candle at its severity too, and a higher severity relights it", () => {
  const seed = new CandleSeeder("fl-accept");
  seed.run("audit", [candle("k", "medium")]);
  seed.accept("k", "medium");
  assert.equal(seed.candle("k").status, "accepted");
  assert.equal(seed.candle("k").accepted?.severity, "medium");
  seed.run("audit", [candle("k", "medium")]);
  assert.equal(seed.candle("k").status, "accepted");
  seed.run("audit", [candle("k", "high")]);
  const lit = seed.candle("k");
  assert.equal(lit.status, "lit");
  assert.equal(lit.severity, "high");
  assert.equal(lit.accepted, undefined, "the accept is gone");
  assert.equal(lit.stillReported, false);
  assert.deepEqual(seed.openings().map((entry) => entry.candles[0]?.kind), ["opened", "raised"]);
});

test("a relight after an answer shows in the history", () => {
  const seed = new CandleSeeder("fl-relight");
  seed.light("k", "low");
  seed.answer("k", "low");
  seed.light("k", "critical");
  const found = seed.candle("k");
  assert.equal(found.status, "lit");
  assert.equal(found.answered, undefined);
  assert.deepEqual(found.history.map((step) => step.kind), ["lit", "answered", "raised"]);
});

test("candle.relit takes back an answer or an accept, and does nothing to a lit candle", () => {
  const seed = new CandleSeeder("fl-relight-line");
  seed.light("a", "high");
  seed.light("b", "high");
  seed.answer("a");
  seed.accept("b");
  seed.operator("candle.relit", "a", { note: "not done" });
  seed.operator("candle.relit", "b");
  seed.operator("candle.relit", "b");
  assert.equal(seed.candle("a").status, "lit");
  assert.equal(seed.candle("a").answered, undefined);
  assert.equal(seed.candle("b").status, "lit");
  assert.deepEqual(seed.candle("a").history.map((step) => step.kind), ["lit", "answered", "relit"]);
  assert.equal(seed.candle("a").history[2]?.note, "not done");
  assert.deepEqual(seed.candle("b").history.map((step) => step.kind), ["lit", "accepted", "relit"], "the second relight finds a lit candle");
  assert.equal(seed.openings().length, 2, "a relight is not an opening");
});

test("a flagged item in state fixed puts the candle out, as a source blow-out", () => {
  const seed = new CandleSeeder("fl-fixed");
  seed.run("audit", [candle("k", "high")]);
  const fixing = seed.run("audit", [candle("k", "high", { state: "fixed" })]);
  const found = seed.candle("k");
  assert.equal(found.status, "out");
  assert.equal(found.blownOut?.who, "t");
  assert.equal(found.reports, 1, "a blow-out is not a report");
  const last = found.history.at(-1);
  assert.equal(last?.kind, "blown-out");
  assert.equal(last?.run, fixing);
});

test("a fixed report from another ritual, or for a candle from outside, does not put it out and is named", () => {
  const seed = new CandleSeeder("fl-foreign-fixed");
  seed.run("audit", [candle("k", "high")]);
  seed.light("ext", "high");
  const fixed = [candle("k", "high", { state: "fixed" }), candle("ext", "high", { state: "fixed" })];
  const foreign = foreignFixes(seed.candles(), "other", { v: 1, status: "ok", summary: "s", items: fixed });
  assert.deepEqual(foreign, [{ key: "k", ritual: "audit" }, { key: "ext" }]);
  assert.match(foreignFixLine({ key: "k", ritual: "audit" }, "other"), /candle 'k' belongs to ritual audit; a fixed report from ritual other does not put it out/u);
  seed.run("other", fixed);
  assert.equal(seed.candle("k").status, "lit");
  assert.equal(seed.candle("ext").status, "lit");
  seed.run("audit", fixed);
  assert.equal(seed.candle("k").status, "out", "the candle's own ritual still puts it out");
  assert.equal(seed.candle("ext").status, "lit", "a candle from outside is blown out by hand");
  assert.deepEqual(foreignFixes(seed.candles(), "audit", { v: 1, status: "ok", summary: "s", items: fixed }), [{ key: "ext" }]);
});

test("a fixed report in a failed run does not put the candle out", () => {
  const seed = new CandleSeeder("fl-failed-fixed");
  seed.run("audit", [candle("k")]);
  seed.run("audit", [candle("k", "high", { state: "fixed" })], { outcome: "failed" });
  assert.equal(seed.candle("k").status, "lit");
});

test("a follow-up run may put a candle out with a fixed report", () => {
  const seed = new CandleSeeder("fl-fixed-follow");
  const parent = seed.run("audit", [candle("k", "high")]);
  seed.answer("k");
  seed.run("audit", [candle("k", "high", { state: "fixed" })], { followUpOf: parent });
  assert.equal(seed.candle("k").status, "out");
  assert.equal(seed.candle("k").answered, undefined);
});

test("a fixed report for a candle that is not there, or already out, changes nothing", () => {
  const seed = new CandleSeeder("fl-fixed-none");
  seed.run("audit", [candle("k", "high", { state: "fixed" })]);
  assert.deepEqual(seed.candles(), []);
  seed.run("audit", [candle("k")]);
  seed.run("audit", [candle("k", "high", { state: "fixed" })]);
  const before = seed.candle("k");
  seed.run("audit", [candle("k", "high", { state: "fixed" })]);
  assert.deepEqual(seed.candle("k"), before);
});

test("candle.blown-out ends a candle, and a later report lights it again as a new opening", () => {
  const seed = new CandleSeeder("fl-blown-out");
  seed.light("k", "high");
  seed.operator("candle.blown-out", "k", { note: "patched" });
  const out = seed.candle("k");
  assert.equal(out.status, "out");
  assert.equal(out.blownOut?.note, "patched");
  seed.answer("k");
  seed.operator("candle.relit", "k");
  assert.equal(seed.candle("k").status, "out", "an answer or a relight of a candle that is out does nothing");
  seed.light("k", "low");
  const lit = seed.candle("k");
  assert.equal(lit.status, "lit");
  assert.equal(lit.blownOut, undefined);
  assert.equal(lit.reports, 2);
  assert.deepEqual(seed.openings().map((entry) => entry.candles[0]?.kind), ["opened", "opened"]);
});

test("two clean runs of the ritual put the candle out; one does not", () => {
  const seed = new CandleSeeder("fl-clean");
  seed.run("audit", [candle("k")]);
  seed.run("audit", []);
  assert.equal(seed.candle("k").status, "lit", "one clean run is not enough");
  seed.run("audit", []);
  const out = seed.candle("k");
  assert.equal(CLEAN_RUNS, 2);
  assert.equal(out.status, "out");
  assert.equal(out.blownOut, undefined, "out by runs is no blow-out");
  assert.equal(out.history.at(-1)?.kind, "out");
});

test("a report between two clean runs starts the count again", () => {
  const seed = new CandleSeeder("fl-clean-reset");
  seed.run("audit", [candle("k")]);
  seed.run("audit", []);
  seed.run("audit", [candle("k")]);
  seed.run("audit", []);
  assert.equal(seed.candle("k").status, "lit");
  seed.run("audit", []);
  assert.equal(seed.candle("k").status, "out");
});

test("a closed candle goes out after two clean runs, and a report after that lights it again", () => {
  const seed = new CandleSeeder("fl-clean-closed");
  seed.run("audit", [candle("k")]);
  seed.accept("k");
  seed.run("audit", []);
  seed.run("audit", []);
  const out = seed.candle("k");
  assert.equal(out.status, "out");
  assert.equal(out.accepted, undefined);
  seed.run("audit", [candle("k")]);
  assert.equal(seed.candle("k").status, "lit");
  assert.equal(seed.openings().length, 2);
});

test("a failed run is never clean; a run without a result and a follow-up run are not either", () => {
  const seed = new CandleSeeder("fl-not-clean");
  const parent = seed.run("audit", [candle("k")]);
  seed.run("audit", [], { outcome: "failed" });
  seed.run("audit", [], { outcome: "failed" });
  seed.run("audit", [], { followUpOf: parent });
  seed.run("audit", [], { followUpOf: parent });
  seed.run("audit", [], { raw: "not a result" });
  seed.run("audit", [], { raw: "not a result" });
  assert.equal(seed.candle("k").status, "lit");
  seed.run("audit", []);
  assert.equal(seed.candle("k").status, "lit");
  seed.run("audit", []);
  assert.equal(seed.candle("k").status, "out", "two full clean runs");
});

test("a clean run of another ritual does not count", () => {
  const seed = new CandleSeeder("fl-other-ritual");
  seed.run("audit", [candle("k")]);
  seed.run("other", []);
  seed.run("other", []);
  seed.run("other", []);
  assert.equal(seed.candle("k").status, "lit");
});

test("the ritual of the newest report counts, and a candle from outside never goes out alone", () => {
  const seed = new CandleSeeder("fl-outside");
  seed.light("k", "high");
  for (let index = 0; index < 4; index += 1) seed.run("audit", []);
  assert.equal(seed.candle("k").status, "lit", "a script candle has no clean run");
  seed.run("audit", [candle("k")]);
  seed.light("k", "high");
  seed.run("audit", []);
  seed.run("audit", []);
  assert.equal(seed.candle("k").status, "lit", "the newest report came from a script");
  seed.run("audit", [candle("k")]);
  seed.run("audit", []);
  seed.run("audit", []);
  assert.equal(seed.candle("k").status, "out", "the newest report came from a ritual again");
});

test("an item without the flag is not a candle, and a candle ignores finding.reset", () => {
  const seed = new CandleSeeder("fl-reset");
  seed.run("audit", [{ key: "plain", severity: "high", state: "needs-decision" }, candle("k")]);
  assert.deepEqual(seed.candles().map((entry) => entry.key), ["k"]);
  seed.reset();
  seed.reset("audit");
  assert.equal(seed.candle("k").status, "lit");
  assert.equal(seed.candle("k").reports, 1);
});

test("a malformed candle line, or one about an unknown candle, is skipped", () => {
  const seed = new CandleSeeder("fl-bad");
  seed.light("good", "high");
  seed.light("no-severity", "high", { severity: "dire" });
  seed.light("no-source", "high", { source: "  " });
  seed.light("no-title", "high", { title: 5 });
  seed.answer("unknown");
  seed.operator("candle.answered", "good", {});
  assert.deepEqual(seed.candles().map((entry) => [entry.key, entry.status]), [["good", "lit"]], "an answer needs a note");
});

test("candles sort lit first, worst first, newest first", () => {
  const seed = new CandleSeeder("fl-sort");
  seed.light("old-low", "low");
  seed.light("answered", "critical");
  seed.answer("answered", "critical");
  seed.light("new-low", "low");
  seed.light("high", "high");
  assert.deepEqual(seed.candles().map((entry) => entry.key), ["high", "new-low", "old-low", "answered"]);
});

test("the same ledger gives the same candles", () => {
  const seed = new CandleSeeder("fl-same");
  seed.run("audit", [candle("a"), candle("b", "low")]);
  seed.answer("a");
  seed.run("audit", [candle("a")]);
  assert.deepEqual(seed.candles(), seed.candles());
  assert.deepEqual(seed.openings().map((entry) => entry.line.id), seed.openings().map((entry) => entry.line.id));
});

test("collectCandles reads the ledger itself when none is given", () => {
  const seed = new CandleSeeder("fl-default");
  seed.light("k");
  assert.deepEqual(collectCandles(seed.project), seed.candles());
});

test("the history keeps the newest steps", () => {
  const seed = new CandleSeeder("fl-history");
  for (let index = 0; index < 40; index += 1) seed.light("k");
  const found = seed.candle("k");
  assert.equal(found.reports, 40);
  assert.equal(found.history.length, 30);
});

test("ledger lines of the old feature name are unknown types: ignored, with no throw and no candle", () => {
  const seed = new CandleSeeder("fl-old-names");
  const stale = ["flare.lit", "flare.answered", "flare.accepted", "flare.cleared", "flare.reopened"];
  for (const type of stale) seed.operator(type, "old", { title: "Old", severity: "high", source: "ci:nightly", note: "n" });
  assert.deepEqual(seed.candles(), []);
  assert.deepEqual(seed.openings(), []);
  seed.light("new", "low");
  seed.operator("flare.cleared", "new");
  assert.equal(seed.candle("new").status, "lit", "an old clear line does not touch a candle");
  assert.equal(seed.candles().length, 1);
});
