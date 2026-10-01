/**
 * Run results (src/core/result.ts): the darius-result block is cut out of the
 * findings, checked, normalized, and its status only ever goes up.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { cutResult, HANDOFF_MAX, parseResult, readSummary, summarizeResult, type RunResult } from "../src/core/result.ts";

function block(json: string): string {
  return ["# Findings", "", "All fine.", "", "```darius-result", json, "```", ""].join("\n");
}

function parsed(json: string): RunResult {
  const result = parseResult(json);
  if ("errors" in result) throw new Error(result.errors.join("; "));
  return result.result;
}

function errorsOf(json: string): string[] {
  const result = parseResult(json);
  return "errors" in result ? result.errors : [];
}

test("the block is cut out of the findings; findings without one stay as they are", () => {
  const cut = cutResult(block('{"v":1,"status":"ok","summary":"fine"}'));
  assert.deepEqual(cut, { findings: "# Findings\n\nAll fine.\n", block: '{"v":1,"status":"ok","summary":"fine"}' });
  assert.deepEqual(cutResult("# Findings\n"), { findings: "# Findings\n", block: null });
  assert.deepEqual(cutResult("```darius-result\n{}\n```"), { findings: "", block: "{}" }, "a block alone leaves empty findings");
  assert.match(JSON.stringify(cutResult(`${block("{}")}\n${block("{}")}`)), /2 darius-result blocks; send exactly one/u);
  assert.match(JSON.stringify(cutResult("```darius-result\n{}\n")), /no closing/u);
  assert.equal(cutResult("```json\n{}\n```\n").block ?? null, null, "another fence is prose");
});

test("a full result is checked, normalized and summarized", () => {
  const result = parsed(
    JSON.stringify({
      v: 1,
      status: "attention",
      summary: "37 posts checked.",
      metrics: [{ label: "Posts", value: 37 }, { label: "Window", value: "1 day", tone: "ok" }],
      items: [
        { title: "Broken link", severity: "critical", state: "fixed", group: "site-a", target: "post 1" },
        { title: "Stale banner", severity: "medium", state: "open", group: "site-b", detail: "line one\nline two" },
        { title: "Card", severity: "low", state: "needs-decision" },
      ],
      questions: [{ text: "Delete the cards?", recommendation: "Yes." }],
      actions: [{ text: "Fixed the card", state: "done", target: "post 1" }],
      extra: "ignored",
    }),
  );
  assert.equal(result.items[1]?.detail, "line one\nline two", "detail keeps its lines");
  assert.equal(result.metrics[1]?.tone, "ok");
  assert.deepEqual(summarizeResult(result), {
    status: "attention",
    questions: 1,
    open: { critical: 0, high: 0, medium: 1, low: 1, info: 0 },
    fixed: 1,
  });
});

test("status only goes up: a question, an open high or critical item, or an unverified item makes it attention", () => {
  const base = { v: 1, status: "ok", summary: "s" };
  assert.equal(parsed(JSON.stringify(base)).status, "ok");
  assert.equal(parsed(JSON.stringify({ ...base, questions: [{ text: "q?" }] })).status, "attention");
  assert.equal(parsed(JSON.stringify({ ...base, items: [{ title: "t", severity: "high", state: "open" }] })).status, "attention");
  assert.equal(parsed(JSON.stringify({ ...base, items: [{ title: "t", severity: "critical", state: "fixed" }] })).status, "ok");
  assert.equal(parsed(JSON.stringify({ ...base, items: [{ title: "t", severity: "low", state: "not-verified" }] })).status, "attention");
  assert.equal(parsed(JSON.stringify({ ...base, items: [{ title: "t", severity: "medium", state: "open" }] })).status, "ok");
  assert.equal(parsed(JSON.stringify({ ...base, status: "failed", questions: [{ text: "q?" }] })).status, "failed", "failed stays");
});

test("every problem is listed at once, with its path", () => {
  const errors = errorsOf(
    JSON.stringify({
      v: 2,
      status: "great",
      items: [{ title: "", severity: "urgent", state: "done" }, "text"],
      metrics: [{ label: "x" }],
      questions: [{ text: 5 }],
    }),
  );
  assert.deepEqual(errors, [
    "v: must be 1",
    "result.status: must be one of ok, attention, failed",
    "result.summary: needs a non-empty string",
    "metrics[0].value: needs a number or a non-empty string",
    "items[1]: must be an object",
    "items[0].title: needs a non-empty string",
    "items[0].severity: must be one of critical, high, medium, low, info",
    "items[0].state: must be one of open, fixed, needs-decision, not-verified",
    "questions[0].text: needs a non-empty string",
  ]);
  assert.match(errorsOf("{not json")[0] ?? "", /not valid JSON/u);
  assert.deepEqual(errorsOf("[1]"), ["the darius-result block must be one JSON object"]);
  const many = JSON.stringify({ v: 1, status: "ok", summary: "s", questions: Array.from({ length: 11 }, () => ({ text: "q" })) });
  assert.deepEqual(errorsOf(many), ["questions: at most 10 entries, got 11"]);
});

test("texts are plain: control characters go, long texts are clipped", () => {
  const result = parsed(
    JSON.stringify({ v: 1, status: "ok", summary: `a\u001b[31mb\u0007c ${"x".repeat(600)}`, items: [{ title: "t\nu", severity: "info", state: "open" }] }),
  );
  assert.equal(result.summary.includes("\u001b"), false);
  assert.equal(result.summary.length, 240);
  assert.ok(result.summary.endsWith("…"));
  assert.equal(result.items[0]?.title, "t u", "a title is one line");
});

test("a summary reads back from a ledger value, and anything else is null", () => {
  const summary = { status: "attention", questions: 2, open: { critical: 1, high: 0, medium: 0, low: 0, info: 0 }, fixed: 3 };
  assert.deepEqual(readSummary(summary), summary);
  assert.equal(readSummary({ status: "weird", questions: 1, open: {}, fixed: 0 }), null);
  assert.equal(readSummary("attention"), null);
  assert.equal(readSummary(undefined), null);
});

test("the handoff note is one line of at most 200 characters; a longer one is refused, not cut", () => {
  const base = { v: 1, status: "ok", summary: "s" };
  assert.equal(parsed(JSON.stringify(base)).handoff, undefined, "no note, no field");
  assert.equal(parsed(JSON.stringify({ ...base, handoff: "  Check post 7.\nThen\tpost 9.  " })).handoff, "Check post 7. Then post 9.");
  assert.equal(parsed(JSON.stringify({ ...base, handoff: "   " })).handoff, undefined, "a blank note is no note");
  assert.equal(parsed(JSON.stringify({ ...base, handoff: "é".repeat(HANDOFF_MAX) })).handoff?.length, HANDOFF_MAX, "200 characters fit");
  assert.deepEqual(errorsOf(JSON.stringify({ ...base, handoff: "x".repeat(HANDOFF_MAX + 1) })), ["handoff: at most 200 characters, got 201; make it shorter"]);
  assert.deepEqual(errorsOf(JSON.stringify({ ...base, handoff: 5 })), ["handoff: must be a string when set"]);
});

const long = (n: number): string => "y".repeat(n + 50);

test("the tighter limits clip detail, question, recommendation and action silently", () => {
  const result = parsed(
    JSON.stringify({
      v: 1,
      status: "ok",
      summary: "s",
      items: [{ title: "t", severity: "info", state: "open", detail: long(400) }],
      questions: [{ text: long(300), recommendation: long(200) }],
      actions: [{ text: long(200), state: "done" }],
    }),
  );
  assert.equal(result.items[0]?.detail?.length, 400);
  assert.equal(result.questions[0]?.text.length, 300);
  assert.equal(result.questions[0]?.recommendation?.length, 200);
  assert.equal(result.actions[0]?.text.length, 200);
});

test("a question may list the exact commands a yes runs; each is one plain command (0.46.0)", () => {
  const ok = parsed(
    JSON.stringify({
      v: 1,
      status: "ok",
      summary: "one question",
      questions: [{ text: "Delete the two pages?", commands: ["pnpm -C tools cli pages delete 12 --confirm", "  pnpm -C tools cli pages delete 13 --confirm "] }],
    }),
  );
  assert.deepEqual(ok.questions[0]?.commands, ["pnpm -C tools cli pages delete 12 --confirm", "pnpm -C tools cli pages delete 13 --confirm"]);
  assert.equal(parsed('{"v":1,"status":"ok","summary":"x","questions":[{"text":"q"}]}').questions[0]?.commands, undefined, "commands stay optional");
  const bad = (commands: string | readonly (string | number)[]): string[] => errorsOf(JSON.stringify({ v: 1, status: "ok", summary: "x", questions: [{ text: "q", commands }] }));
  const cases: [string, RegExp][] = [
    ["cd tools && pnpm cli x", /questions\[0\]\.commands\[0\]: not one plain command \(more than one command/u],
    ["a | b", /more than one command/u],
    ["a; b", /more than one command/u],
    ["echo $(id)", /\$/u],
    ["echo `id`", /command substitution/u],
    ["echo x > /tmp/out", /output redirection/u],
    [`echo ${"x".repeat(300)}`, /at most 300 characters/u],
  ];
  for (const [line, reason] of cases) assert.match(bad([line]).join("\n"), reason, line);
  assert.match(bad(Array.from({ length: 21 }, (_, index) => `echo ${String(index)}`)).join("\n"), /commands: at most 20 lines, got 21/u);
  assert.match(bad("echo x").join("\n"), /commands: must be a list of strings/u);
  assert.match(bad([1]).join("\n"), /commands\[0\]: must be a string/u);
});
