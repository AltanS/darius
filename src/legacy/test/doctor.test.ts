/**
 * Tests for `tracker doctor`.
 *
 * pnpm vitest run doctor
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTracker, addMilestone, addSpec } from "../lib/tracker-writer.ts";
import { runDoctor } from "../lib/doctor.ts";

// A valid spec (no legacy derived fields)
const VALID_SPEC = `---
updated: 2026-01-01
agent: test
depends_on: []
---

# Valid Spec

## Verification Checklist

### Implementation

- [ ] First task
`;

// A spec with dangling depends_on
const DANGLING_DEP_SPEC = `---
updated: 2026-01-01
agent: test
depends_on:
  - .tracker/M99-nonexistent/01-nonexistent.md
---

# Dangling Dep Spec

## Verification Checklist

### Implementation

- [ ] Task
`;

// A spec using inline `[...]` sequence syntax — the strict frontmatter
// parser only supports block-list form for depends_on.
const INLINE_SEQUENCE_SPEC = (dep: string) => `---
updated: 2026-01-01
agent: test
depends_on: [${dep}]
---

# Inline Sequence Spec

## Verification Checklist

### Implementation

- [ ] Task
`;

describe("doctor", () => {
  let tmpDir: string;
  let trackerRoot: string;
  let milestonePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-doctor-test-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    addMilestone({
      trackerRoot,
      name: "Test Milestone",
      slug: "test-milestone",
      owner: "dev@example.com",
    });
    milestonePath = join(trackerRoot, "M1-test-milestone");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports healthy for a valid tracker setup", () => {
    const specPath = join(milestonePath, "01-valid.md");
    writeFileSync(specPath, VALID_SPEC, "utf-8");

    const report = runDoctor({ trackerRoot });
    expect(report.healthy).toBe(true);
    expect(report.findings).toHaveLength(0);
  });

  it("reports dangling-dep when depends_on references a missing spec", () => {
    const specPath = join(milestonePath, "01-dangling.md");
    writeFileSync(specPath, DANGLING_DEP_SPEC, "utf-8");

    const report = runDoctor({ trackerRoot });
    const danglingFindings = report.findings.filter((f) => f.kind === "dangling-dep");
    expect(danglingFindings.length).toBeGreaterThan(0);
  });

  it("reports healthy for valid depends_on (file exists)", () => {
    // Create a spec that depends on another spec that exists
    const spec1 = join(milestonePath, "01-first.md");
    const spec2 = join(milestonePath, "02-second.md");
    writeFileSync(spec1, VALID_SPEC, "utf-8");

    const spec2WithDep = `---
updated: 2026-01-01
agent: test
depends_on:
  - .tracker/M1-test-milestone/01-first.md
---

# Second Spec

## Verification Checklist

- [ ] Task
`;
    writeFileSync(spec2, spec2WithDep, "utf-8");

    const report = runDoctor({ trackerRoot });
    const danglingFindings = report.findings.filter((f) => f.kind === "dangling-dep");
    expect(danglingFindings).toHaveLength(0);
  });

  it("reports missing-index-entry for milestone not in index", () => {
    // Create a second milestone but clear the index
    addMilestone({
      trackerRoot,
      name: "Second Milestone",
      slug: "second-milestone",
      owner: "dev@example.com",
    });

    // Clear the index to simulate missing entries
    writeFileSync(join(trackerRoot, "00-INDEX.md"), "# Empty Index\n", "utf-8");

    const report = runDoctor({ trackerRoot });
    const missingEntries = report.findings.filter((f) => f.kind === "missing-index-entry");
    expect(missingEntries.length).toBeGreaterThan(0);
  });

  it("validates multiple specs in the same milestone", () => {
    const spec1 = join(milestonePath, "01-first.md");
    const spec2 = join(milestonePath, "02-second.md");
    writeFileSync(spec1, VALID_SPEC, "utf-8");
    writeFileSync(spec2, VALID_SPEC, "utf-8");

    const report = runDoctor({ trackerRoot });
    expect(report.healthy).toBe(true);
  });

  describe("inline sequence syntax (depends_on: [x.md])", () => {
    it("reports a specific inline-sequence finding, not a bare crash", () => {
      const specPath = join(milestonePath, "02-inline.md");
      writeFileSync(join(milestonePath, "01-first.md"), VALID_SPEC, "utf-8");
      writeFileSync(specPath, INLINE_SEQUENCE_SPEC("01-first.md"), "utf-8");

      const report = runDoctor({ trackerRoot });
      const inlineFindings = report.findings.filter((f) => f.kind === "inline-sequence");
      expect(inlineFindings).toHaveLength(1);
      expect(inlineFindings[0]!.detail).toContain("depends_on");
      expect(inlineFindings[0]!.detail).toContain("- 01-first.md");
    });

    it("does not also emit a duplicate generic schema-error for the same file", () => {
      const specPath = join(milestonePath, "02-inline.md");
      writeFileSync(join(milestonePath, "01-first.md"), VALID_SPEC, "utf-8");
      writeFileSync(specPath, INLINE_SEQUENCE_SPEC("01-first.md"), "utf-8");

      const report = runDoctor({ trackerRoot });
      const schemaErrorsForFile = report.findings.filter(
        (f) => f.kind === "schema-error" && f.file === specPath,
      );
      expect(schemaErrorsForFile).toHaveLength(0);
    });

    it("does not crash the dangling-dep or agent-roster checks", () => {
      // Before this fix, an inline `depends_on: [...]` threw an uncaught
      // FrontmatterParseError inside the (unguarded) dangling-dep pass,
      // aborting `tracker doctor` entirely instead of producing findings.
      const specPath = join(milestonePath, "01-inline.md");
      writeFileSync(specPath, INLINE_SEQUENCE_SPEC("nonexistent.md"), "utf-8");

      expect(() => runDoctor({ trackerRoot })).not.toThrow();
      const report = runDoctor({ trackerRoot });
      expect(report.healthy).toBe(false);
      expect(report.findings.some((f) => f.kind === "inline-sequence")).toBe(true);
    });

    it("--fix rewrites the inline sequence to block form and the tracker becomes healthy", () => {
      const spec1 = join(milestonePath, "01-first.md");
      const specPath = join(milestonePath, "02-inline.md");
      writeFileSync(spec1, VALID_SPEC, "utf-8");
      writeFileSync(specPath, INLINE_SEQUENCE_SPEC("01-first.md"), "utf-8");

      const fixReport = runDoctor({ trackerRoot, fix: true });
      expect(fixReport.findings.some((f) => f.kind === "inline-sequence")).toBe(false);

      const fixedRaw = readFileSync(specPath, "utf-8");
      expect(fixedRaw).toContain("depends_on:\n  - 01-first.md");
      expect(fixedRaw).not.toContain("[01-first.md]");

      const rereport = runDoctor({ trackerRoot });
      expect(rereport.healthy).toBe(true);
    });
  });
});
