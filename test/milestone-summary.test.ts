/**
 * The summary at the top of a milestone page (src/web/milestone-summary.ts):
 * the Goal paragraph, the fallback to the first prose paragraph, plain text,
 * and the cut at about 280 characters.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { capText, milestoneSummary, SUMMARY_MAX } from "../src/web/milestone-summary.ts";

test("the first paragraph under Goal, as plain text", () => {
  const readme = "# Cart\n\nAn intro line.\n\n## Goal\n\nA shopper who **reloads** the page finds the same `cart`,\nas [the spec](https://example.com/spec) says.\n\nA second paragraph.\n\n## Scope\n\n- one\n";
  assert.equal(milestoneSummary(readme), "A shopper who reloads the page finds the same cart, as the spec says.");
});

test("a Goal with only the template placeholder falls back to the first prose paragraph", () => {
  assert.equal(milestoneSummary("# Cart\n\n## Goal\n\n{{ONE_SENTENCE_GOAL}}\n\n## Why this matters\n\nCarts get lost on reload.\n"), "Carts get lost on reload.");
  // The tracker writes an HTML comment there; the parser drops it, so the Goal is empty.
  assert.equal(milestoneSummary("# Cart\n\n## Goal\n\n<!-- TODO: describe the goal -->\n\n## Why this matters\n\nCarts get lost on reload.\n"), "Carts get lost on reload.");
  // A README straight from the template has no prose at all.
  assert.equal(milestoneSummary("# Cart\n\n## Goal\n\n{{ONE_SENTENCE_GOAL}}\n\n## Why this matters\n\n{{MOTIVATION}}\n\n## Success criteria\n\n- {{CRITERION_1}}\n"), null);
});

test("a Goal heading with a list and no paragraph before the next heading falls back", () => {
  assert.equal(milestoneSummary("# Cart\n\nFirst prose.\n\n## Goal\n\n- a list item\n\n## Next\n\nLater prose.\n"), "First prose.");
});

test("no Goal heading: the first prose paragraph, never a heading, list, table or code", () => {
  const readme = "# Cart\n\n- a list\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```\ncode\n```\n\n### Notes\n\nThe first *real* paragraph.\n";
  assert.equal(milestoneSummary(readme), "The first real paragraph.");
});

test("an empty README, one with headings only, and no README give null", () => {
  assert.equal(milestoneSummary(""), null);
  assert.equal(milestoneSummary("\n\n"), null);
  assert.equal(milestoneSummary("# Cart\n\n## Goal\n\n## Scope\n"), null);
  assert.equal(milestoneSummary(null), null);
});

test("a long Goal is cut on a word boundary with an ellipsis", () => {
  const long = Array.from({ length: 80 }, (_, index) => `word${index}`).join(" ");
  const summary = milestoneSummary(`## Goal\n\n${long}\n`);
  assert.ok(summary !== null);
  assert.ok(summary.endsWith("…"));
  assert.ok(summary.length <= SUMMARY_MAX + 1, `at most ${SUMMARY_MAX} characters and the ellipsis`);
  assert.ok(long.startsWith(summary.slice(0, -1)), "a prefix of the text");
  assert.ok(long.charAt(summary.length - 1) === " ", "cut before a space, so no word is broken");
});

test("the cut: short text stays, trailing punctuation goes, one long word is cut hard", () => {
  assert.equal(capText("short"), "short");
  assert.equal(capText("one two, three", 9), "one two…");
  assert.equal(capText("x".repeat(300), 10), `${"x".repeat(10)}…`);
});
