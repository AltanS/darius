/**
 * The findings index (src/core/finding-index.ts): findings are derived from
 * the ledger and the result blobs, keyed by (ritual, key), with the
 * operator's close and reopen lines on top.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  autoKey,
  findingCounts,
  findingPromptLines,
  findingsSection,
  PROMPT_CLOSED_MAX,
  PROMPT_OPEN_MAX,
} from "../src/core/finding-index.ts";
import { writeRemoteChunk } from "../src/core/ledger.ts";
import { ulid } from "../src/core/ulid.ts";
import { Seeder } from "./helpers/finding-seed.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-finding-index-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");

test("the same key over two runs merges into one finding with history", () => {
  const seed = new Seeder("fi-merge");
  const first = seed.run("check", [{ key: "link-1", severity: "medium", state: "open", detail: "old detail" }]);
  const second = seed.run("check", [{ key: "link-1", severity: "high", state: "needs-code", title: "Link 1 is broken", target: "page 1" }]);
  const all = seed.findings();
  assert.equal(all.length, 1);
  const [finding] = all;
  assert.equal(finding?.ritual, "check");
  assert.equal(finding?.auto, false);
  assert.equal(finding?.title, "Link 1 is broken", "the newest report wins");
  assert.equal(finding?.target, "page 1");
  assert.equal(finding?.detail, undefined, "a field the newest report lacks is gone");
  assert.equal(finding?.runs, 2);
  assert.equal(finding?.firstSeen.run, first);
  assert.equal(finding?.lastSeen.run, second);
  assert.deepEqual(
    finding?.history.map((step) => [step.run, step.state, step.severity]),
    [[first, "open", "medium"], [second, "needs-code", "high"]],
  );
  assert.equal(finding?.stale, false);
  assert.equal(finding?.reopened, false);
});

test("two items with the same key in one result: the later wins and the run counts once", () => {
  const seed = new Seeder("fi-dup");
  seed.run("check", [{ key: "k", title: "First" }, { key: "k", title: "Second", severity: "low" }]);
  const finding = seed.find("check", "k");
  assert.equal(finding.title, "Second");
  assert.equal(finding.runs, 1);
  assert.equal(finding.history.length, 1);
});

test("an item without a key gets an auto key from group, target and title", () => {
  const seed = new Seeder("fi-auto");
  seed.run("check", [{ title: "Broken  Link", group: "Site-A", target: "Page 1" }]);
  seed.run("check", [{ title: "broken link", group: "site-a", target: "page 1", severity: "high" }]);
  const [finding] = seed.findings();
  assert.equal(seed.findings().length, 1, "case and spacing do not split it");
  assert.equal(finding?.key, "auto:site-a|page 1|broken link");
  assert.equal(finding?.auto, true);
  assert.equal(finding?.runs, 2);
  assert.equal(autoKey({ title: "T" }), "auto:||t");
});

test("keys are scoped per ritual", () => {
  const seed = new Seeder("fi-scope");
  seed.run("one", [{ key: "same", title: "In one" }]);
  seed.run("two", [{ key: "same", title: "In two" }]);
  assert.equal(seed.findings().length, 2);
  assert.equal(seed.find("one", "same").title, "In one");
  assert.equal(seed.find("two", "same").title, "In two");
  seed.close("one", "same");
  assert.equal(seed.find("one", "same").status, "closed");
  assert.equal(seed.find("two", "same").status, "open", "the close names one ritual");
});

test("a finding is stale after a newer complete run that did not report it", () => {
  const seed = new Seeder("fi-stale");
  seed.run("check", [{ key: "a" }, { key: "b" }]);
  assert.equal(seed.find("check", "a").stale, false);
  seed.run("check", [{ key: "b" }]);
  assert.equal(seed.find("check", "a").stale, true);
  assert.equal(seed.find("check", "b").stale, false);
});

test("a failed run, a blob that does not parse and another ritual do not make a finding stale", () => {
  const seed = new Seeder("fi-stale-not");
  seed.run("check", [{ key: "a" }]);
  seed.run("check", [], { outcome: "failed" });
  seed.run("check", [], { raw: '{"v": 2}' });
  seed.run("other", []);
  assert.equal(seed.find("check", "a").stale, false);
});

test("a follow-up run never makes a finding stale", () => {
  const seed = new Seeder("fi-followup");
  const parent = seed.run("check", [{ key: "a" }, { key: "b" }]);
  seed.run("check", [{ key: "b", state: "fixed" }], { followUpOf: parent });
  assert.equal(seed.find("check", "a").stale, false, "the follow-up reported only what it changed");
  assert.equal(seed.find("check", "b").state, "fixed");
  seed.run("check", [{ key: "b" }]);
  assert.equal(seed.find("check", "a").stale, true, "a later full run does");
});

test("fixed, then open again, sets reopened", () => {
  const seed = new Seeder("fi-reopened");
  seed.run("check", [{ key: "a" }, { key: "b" }]);
  seed.run("check", [{ key: "a", state: "fixed" }, { key: "b" }]);
  assert.equal(seed.find("check", "a").status, "fixed");
  assert.equal(seed.find("check", "a").reopened, false, "fixed now is not reopened");
  seed.run("check", [{ key: "a" }, { key: "b" }]);
  assert.equal(seed.find("check", "a").reopened, true);
  assert.equal(seed.find("check", "b").reopened, false);
});

test("reopened survives a history clipped to ten steps", () => {
  const seed = new Seeder("fi-long");
  seed.run("check", [{ key: "a", state: "fixed" }]);
  for (let index = 0; index < 12; index += 1) seed.run("check", [{ key: "a" }]);
  const finding = seed.find("check", "a");
  assert.equal(finding.history.length, 10);
  assert.equal(finding.runs, 13);
  assert.equal(finding.reopened, true);
});

test("a close holds at the same or a lower severity and ends at a higher one", () => {
  const seed = new Seeder("fi-close");
  seed.run("check", [{ key: "a", severity: "medium" }]);
  seed.close("check", "a", "known, tracked elsewhere");
  const closed = seed.find("check", "a");
  assert.equal(closed.status, "closed");
  assert.equal(closed.closed?.who, "op");
  assert.equal(closed.closed?.note, "known, tracked elsewhere");
  assert.equal(closed.closed?.severity, "medium");

  seed.run("check", [{ key: "a", severity: "low" }]);
  assert.equal(seed.find("check", "a").status, "closed", "lower severity: the close holds");
  seed.run("check", [{ key: "a", severity: "medium" }]);
  assert.equal(seed.find("check", "a").status, "closed", "same severity: the close holds");
  assert.equal(seed.find("check", "a").reopened, false);

  seed.run("check", [{ key: "a", severity: "high" }]);
  const worse = seed.find("check", "a");
  assert.equal(worse.status, "needs-you", "high ends the close");
  assert.equal(worse.closed, undefined);
  assert.equal(worse.reopened, true);

  seed.run("check", [{ key: "a", severity: "medium" }]);
  assert.equal(seed.find("check", "a").status, "open", "the ended close does not come back");
});

test("a close is made at the severity of the newest report at that time", () => {
  const seed = new Seeder("fi-close-sev");
  seed.run("check", [{ key: "a", severity: "low" }]);
  seed.close("check", "a");
  seed.run("check", [{ key: "a", severity: "medium" }]);
  assert.equal(seed.find("check", "a").status, "open", "medium is worse than the low it was closed at");
});

test("finding.reopened ends a close at once; a close on an unknown finding is ignored", () => {
  const seed = new Seeder("fi-reopen-line");
  seed.run("check", [{ key: "a", severity: "low" }]);
  seed.close("check", "a");
  seed.close("check", "ghost");
  assert.equal(seed.find("check", "a").status, "closed");
  seed.reopen("check", "a");
  const finding = seed.find("check", "a");
  assert.equal(finding.status, "open");
  assert.equal(finding.closed, undefined);
  assert.equal(seed.findings().length, 1);
});

test("fixed beats closed, and a closed finding that is fixed shows fixed", () => {
  const seed = new Seeder("fi-fixed-closed");
  seed.run("check", [{ key: "a", severity: "low" }]);
  seed.close("check", "a");
  seed.run("check", [{ key: "a", severity: "low", state: "fixed" }]);
  assert.equal(seed.find("check", "a").status, "fixed");
});

test("status: needs-decision, needs-code, high and critical need you; the rest is open", () => {
  const seed = new Seeder("fi-status");
  seed.run("check", [
    { key: "decide", state: "needs-decision", severity: "low" },
    { key: "code", state: "needs-code", severity: "info" },
    { key: "high", severity: "high" },
    { key: "critical", severity: "critical" },
    { key: "medium", severity: "medium" },
    { key: "unverified", state: "not-verified", severity: "low" },
  ]);
  const status = Object.fromEntries(seed.findings().map((finding) => [finding.key, finding.status]));
  assert.deepEqual(status, {
    decide: "needs-you",
    code: "needs-you",
    high: "needs-you",
    critical: "needs-you",
    medium: "open",
    unverified: "open",
  });
});

test("needs-you only for a confirmed finding under a key the run gave", () => {
  const seed = new Seeder("fi-needs-you-rules");
  seed.run("check", [{ key: "dropped", severity: "critical" }, { title: "No key", severity: "critical", state: "needs-decision" }]);
  seed.run("check", [{ key: "kept", severity: "high" }]);
  assert.equal(seed.find("check", "kept").status, "needs-you");
  const dropped = seed.find("check", "dropped");
  assert.equal(dropped.stale, true);
  assert.equal(dropped.status, "open", "a stale finding is not confirmed");
  const auto = seed.findings().find((finding) => finding.auto);
  assert.equal(auto?.status, "open", "an auto key is a guess");
});

test("the prompt lists no auto keys", () => {
  const seed = new Seeder("fi-prompt-auto");
  seed.run("check", [{ key: "real", severity: "medium" }, { title: "No key", severity: "medium" }]);
  const lines = findingPromptLines(seed.findings());
  assert.equal(lines.length, 1);
  assert.match(lines[0] ?? "", /\{real\}/u);
});

test("the sort is needs-you, open, closed, fixed; worst severity first; newest first", () => {
  const seed = new Seeder("fi-sort");
  seed.run("check", [
    { key: "fixed", state: "fixed", severity: "critical" },
    { key: "closed", severity: "low" },
    { key: "open-low", severity: "low" },
    { key: "open-medium", severity: "medium" },
    { key: "you-high", severity: "high" },
    { key: "you-critical", severity: "critical" },
  ]);
  seed.close("check", "closed");
  seed.run("check", [{ key: "open-low-newer", severity: "low" }]);
  assert.deepEqual(
    seed.findings().map((finding) => finding.key),
    ["you-critical", "you-high", "open-medium", "open-low-newer", "open-low", "closed", "fixed"],
  );
});

test("findingCounts counts needs-you and open", () => {
  const seed = new Seeder("fi-counts");
  seed.run("check", [{ key: "a", severity: "high" }, { key: "b" }, { key: "c", state: "fixed" }, { key: "d" }]);
  seed.close("check", "d");
  assert.deepEqual(findingCounts(seed.findings()), { needsYou: 1, open: 2 });
});

test("the prompt lines list open findings worst first, then the closed keys", () => {
  const seed = new Seeder("fi-prompt");
  seed.run("check", [
    { key: "k-open", severity: "medium", title: "Stale banner", target: "post 3" },
    { key: "k-high", severity: "high", state: "needs-code", title: "Broken link" },
    { key: "k-gone", severity: "low", title: "Old thing" },
    { key: "k-closed", severity: "low", title: "Known" },
    { key: "k-fixed", state: "fixed" },
  ]);
  seed.close("check", "k-closed");
  seed.run("check", [{ key: "k-open", severity: "medium", title: "Stale banner", target: "post 3" }, { key: "k-high", severity: "high", state: "needs-code", title: "Broken link" }]);
  const lines = findingPromptLines(seed.findings());
  assert.deepEqual(lines, [
    "- {k-high} high needs-code: Broken link (since 2026-10-01)",
    "- {k-open} medium open: Stale banner [post 3] (since 2026-10-01)",
    "- {k-gone} low open: Old thing (since 2026-10-01) stale",
    "",
    "Closed by the operator, do not report again unless worse: {k-closed}",
  ]);
  const section = findingsSection(lines).join("\n");
  assert.match(section, /^## Open findings\n\ndarius tracks these findings across runs\. Re-check each one and report it again with the same key: state fixed when it is gone, else its state now\./u);
  assert.deepEqual(findingsSection([]), []);
  assert.deepEqual(findingPromptLines([]), []);
});

test("the prompt lines cap open findings at 40 and closed keys at 20", () => {
  const seed = new Seeder("fi-cap");
  const many = Array.from({ length: PROMPT_OPEN_MAX + 5 }, (_, index) => ({ key: `open-${String(index).padStart(2, "0")}` }));
  const closed = Array.from({ length: PROMPT_CLOSED_MAX + 3 }, (_, index) => ({ key: `closed-${String(index).padStart(2, "0")}` }));
  seed.run("check", [...many, ...closed]);
  for (const item of closed) seed.close("check", item.key);
  const lines = findingPromptLines(seed.findings());
  assert.equal(lines.filter((line) => line.startsWith("- {open-")).length, PROMPT_OPEN_MAX);
  assert.ok(lines.includes("- (5 more)"));
  assert.equal((lines.at(-1) ?? "").match(/\{closed-/gu)?.length, PROMPT_CLOSED_MAX);
});

// --- reset (0.66.0) -------------------------------------------------------------------

test("a reset hides every result before it; a later run's findings show", () => {
  const seed = new Seeder("fi-reset");
  seed.run("check", [{ key: "a", severity: "high", state: "needs-code" }, { key: "b" }]);
  seed.close("check", "b");
  seed.reset();
  assert.deepEqual(seed.findings(), [], "nothing from before the reset");
  assert.deepEqual(findingPromptLines(seed.findings()), []);
  seed.run("check", [{ key: "b" }]);
  const [b] = seed.findings();
  assert.equal(seed.findings().length, 1);
  assert.equal(b?.key, "b");
  assert.equal(b?.runs, 1, "the history starts after the reset");
  assert.equal(b?.status, "open", "a close before the reset is gone with it");
});

test("a reset for one ritual leaves the others; the newest reset counts", () => {
  const seed = new Seeder("fi-reset-ritual");
  seed.run("one", [{ key: "a" }]);
  seed.run("two", [{ key: "b" }]);
  seed.reset("one");
  assert.deepEqual(seed.findings().map((finding) => `${finding.ritual}/${finding.key}`), ["two/b"]);
  seed.run("one", [{ key: "c" }]);
  seed.reset("two");
  assert.deepEqual(seed.findings().map((finding) => `${finding.ritual}/${finding.key}`), ["one/c"]);
  seed.reset();
  assert.deepEqual(seed.findings(), [], "a reset without a ritual is for all");
});

test("a reset line from another host's ledger chunk applies like a local one", () => {
  const seed = new Seeder("fi-reset-sync");
  seed.run("check", [{ key: "a" }]);
  const at = seed.tick();
  const line = { v: 1, id: ulid(Date.parse(at)), at, host: "host-b", who: "op", project: seed.project.name, type: "finding.reset", item: "ritual/check" };
  assert.equal(writeRemoteChunk(seed.project, { host: "host-b", name: `${ulid(Date.parse(at))}.jsonl`, text: `${JSON.stringify(line)}\n` }), "written");
  assert.deepEqual(seed.findings(), []);
});

// --- lapsed (0.66.0) ------------------------------------------------------------------

test("a finding two full runs in a row left out is lapsed: out of the counts and the prompt; a new report opens it", () => {
  const seed = new Seeder("fi-lapsed");
  seed.run("check", [{ key: "a", severity: "high", state: "needs-code" }, { key: "b" }]);
  seed.run("check", [{ key: "b" }]);
  assert.deepEqual([seed.find("check", "a").stale, seed.find("check", "a").status], [true, "open"], "one miss: stale, still open");
  seed.run("check", [{ key: "b" }]);
  assert.equal(seed.find("check", "a").status, "lapsed");
  assert.deepEqual(findingCounts(seed.findings()), { needsYou: 0, open: 1 });
  assert.equal(findingPromptLines(seed.findings()).some((line) => line.includes("{a}")), false);
  seed.run("check", [{ key: "a", severity: "high", state: "needs-code" }, { key: "b" }]);
  assert.equal(seed.find("check", "a").status, "needs-you", "reported again: open again");
});

test("not lapsed: reported by the full run before the newest, or only one full run since; a follow-up is not a full run", () => {
  const seed = new Seeder("fi-lapsed-not");
  seed.run("check", [{ key: "a" }, { key: "b" }]);
  seed.run("check", [{ key: "b" }]);
  const parent = seed.run("check", [{ key: "a" }, { key: "b" }]);
  seed.run("check", [{ key: "b" }]);
  assert.deepEqual([seed.find("check", "a").stale, seed.find("check", "a").status], [true, "open"], "the run before the newest reported it");
  seed.run("check", [{ key: "b", state: "fixed" }], { followUpOf: parent });
  assert.equal(seed.find("check", "a").status, "open", "a follow-up does not count as a second miss");
  const fixed = new Seeder("fi-lapsed-fixed");
  fixed.run("check", [{ key: "a", state: "fixed" }, { key: "b" }]);
  fixed.run("check", [{ key: "b" }]);
  fixed.run("check", [{ key: "b" }]);
  assert.equal(fixed.find("check", "a").status, "fixed", "fixed stays fixed");
});
