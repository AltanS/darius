/**
 * `mark --skipped --evidence "<why>"` (0.138.0) leaves a `skipped` line in
 * `.verification-log.jsonl`. The native readers take it and count it as no
 * pass (src/core/work-engine.ts), and the importer keeps it as evidence.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { isPassingLine } from "../src/core/work-engine.ts";

test("a skipped ledger line with evidence is no passing line", () => {
  const base = { spec: ".tracker/M1-a/01-b.md", index: 0, at: "2026-11-24T10:00:00.000Z", evidence: "moved to another tool" };
  assert.equal(isPassingLine({ ...base, outcome: "skipped" }), false);
  assert.equal(isPassingLine({ ...base, outcome: "manual" }), true, "a manual line with evidence still earns a tick");
});
