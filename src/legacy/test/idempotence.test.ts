/**
 * Idempotence tests.
 *
 * Property: serialize(parse(serialize(parse(x)))) === serialize(parse(x))
 * i.e. the second serialize-parse round-trip is a fixed point.
 *
 * Run against all M1 fixture files.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseSpec, serializeSpec } from "../lib/documents/spec.js";
import { canonicalize } from "../lib/markdown/canonical.js";

const FIXTURES_DIR = new URL(
  "./fixtures/M1-design-overhaul-benchmark/",
  import.meta.url,
).pathname;

function getFixtureFiles(): string[] {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(FIXTURES_DIR, f));
}

describe("idempotence — canonicalize()", () => {
  const files = getFixtureFiles();
  expect(files.length).toBeGreaterThan(0);

  for (const filePath of files) {
    it(`canonicalize is idempotent: ${filePath.split("/").at(-1)}`, () => {
      const raw = readFileSync(filePath, "utf-8");
      const pass1 = canonicalize(raw);
      const pass2 = canonicalize(pass1);
      expect(pass2).toBe(pass1);
    });
  }
});

describe("idempotence — parseSpec/serializeSpec round-trip", () => {
  // Only spec files (non-README) have the expected front-matter shape
  const specFiles = getFixtureFiles().filter((f) => !f.includes("00-README"));

  for (const filePath of specFiles) {
    it(`spec round-trip fixed point: ${filePath.split("/").at(-1)}`, () => {
      const raw = readFileSync(filePath, "utf-8");

      // First pass
      const view1 = parseSpec(raw, filePath);
      const serialized1 = serializeSpec(view1);

      // Second pass
      const view2 = parseSpec(serialized1, filePath);
      const serialized2 = serializeSpec(view2);

      // Fixed point: second pass equals first pass
      expect(serialized2).toBe(serialized1);
    });
  }
});

describe("mutation locality", () => {
  it("flipping a single checkbox produces a one-line diff", async () => {
    const raw = [
      "---",
      "agent: test",
      "---",
      "",
      "# Test Spec",
      "",
      "## Tasks",
      "",
      "- [ ] task one",
      "- [ ] task two",
      "- [ ] task three",
    ].join("\n");

    const { parseChecklist, flipChecklistItem } = await import(
      "../lib/markdown/checklist.js"
    );

    const body = raw.split("---\n").slice(2).join("---\n");
    const items = parseChecklist(body);
    const flipped = flipChecklistItem(items, 1); // flip "task two"

    // Serialize both versions
    const { serializeChecklist } = await import("../lib/markdown/checklist.js");
    const orig = serializeChecklist(items);
    const modified = serializeChecklist(flipped);

    const origLines = orig.split("\n");
    const modLines = modified.split("\n");

    const diffLines = origLines.filter((line, i) => line !== modLines[i]);
    expect(diffLines.length).toBe(1);
    expect(diffLines[0]).toBe("- [ ] task two");
  });
});
