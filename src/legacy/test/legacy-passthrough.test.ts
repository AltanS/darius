/**
 * Legacy front-matter passthrough tests.
 *
 * Verifies that spec files containing legacy `status` and `verified` fields
 * in their front-matter are NOT rejected by the parser.
 *
 * These fields will be stripped by the spec-07 migration.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSpec } from "../lib/documents/spec.js";

const LEGACY_WITH_STATUS = [
  "---",
  "status: Not Started",
  "verified: 0/3",
  "updated: 2026-04-28",
  "depends_on: []",
  "agent: Explore",
  "template: generic",
  "---",
  "",
  "# Legacy Spec",
  "",
  "## Tasks",
  "",
  "- [ ] task one",
  "- [x] task two",
].join("\n");

const LEGACY_WITH_EXTRA_UNKNOWN = [
  "---",
  "status: In Progress",
  "verified: 1/2",
  "some_unknown_key: arbitrary_value",
  "updated: 2026-01-01",
  "---",
  "",
  "# Another Legacy Spec",
  "",
  "- [ ] do something",
].join("\n");

const LEGACY_FIXTURE_01 = `---
status: Not Started
verified: 0/3
updated: 2026-04-28
depends_on: []
agent: Explore
template: generic
research_only: true
---

# Research: Recent Plugin Commits Audit

## Goal

Audit the last ~30 commits.

## Verification Checklist

### Implementation

- [ ] Git log examined
  - Command: \`git log\`
  - Expected: \`stdout matches /\\d+/\`
- [ ] Written audit summary exists
  - Command: \`grep -q "Hook wiring" file.md\`
  - Expected: \`exit 0\`

### Integration Tests

- [ ] Summary reviewed
  - Command: \`grep -q "status: Verified" file.md\`
  - Expected: \`exit 0\`
`;

describe("legacy-passthrough — status and verified fields", () => {
  it("does not throw when legacy `status` field is present", () => {
    expect(() => parseSpec(LEGACY_WITH_STATUS)).not.toThrow();
  });

  it("does not throw when legacy `verified` field is present", () => {
    expect(() => parseSpec(LEGACY_WITH_STATUS)).not.toThrow();
  });

  it("does not throw when unknown extra fields are present", () => {
    expect(() => parseSpec(LEGACY_WITH_EXTRA_UNKNOWN)).not.toThrow();
  });

  it("correctly computes derived status ignoring legacy status field", () => {
    const view = parseSpec(LEGACY_WITH_STATUS);
    // One item is checked, one is not → "In Progress"
    expect(view.computedStatus).toBe("In Progress");
    expect(view.verifiedCount).toBe(1);
    expect(view.totalCount).toBe(2);
  });

  it("parses the M1-01 fixture which has legacy fields", () => {
    expect(() => parseSpec(LEGACY_FIXTURE_01)).not.toThrow();
  });

  it("preserves passthrough fields on the view object", () => {
    const view = parseSpec(LEGACY_WITH_STATUS);
    // The passthrough object should carry the legacy fields
    const viewRecord = view as Record<string, unknown>;
    expect(viewRecord["status"]).toBe("Not Started");
    expect(viewRecord["verified"]).toBe("0/3");
  });

  it("does not include legacy fields in SpecJSON output", async () => {
    const { toSpecJSON } = await import("../lib/documents/spec.js");
    const view = parseSpec(LEGACY_WITH_STATUS);
    const json = toSpecJSON(view, "/path/to/spec.md");

    // SpecJSON has its own `status` field (computed), not the legacy one
    expect(json.status).toBe("In Progress");
    expect(json.path).toBe("/path/to/spec.md");
    expect(json.verified).toBe(1);
    expect(json.total).toBe(2);
  });
});

describe("legacy-passthrough — all M1 fixture files", () => {
  it("parses M1 README without throwing", () => {
    const fixtureDir = new URL(
      "./fixtures/M1-design-overhaul-benchmark/",
      import.meta.url,
    ).pathname;

    // README has milestone front-matter shape, not spec shape, but the
    // schema uses .passthrough() so it should still not throw
    const readme = readFileSync(join(fixtureDir, "00-README.md"), "utf-8");
    // README has milestone-shaped front-matter — schema is passthrough so parse should work
    expect(() => parseSpec(readme)).not.toThrow();
  });
});
