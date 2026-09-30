/**
 * Tests for doctor version_drift finding.
 *
 * pnpm vitest run version-drift-detection
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctor } from "../lib/doctor.ts";
import {
  setupCleanTracker,
  makeUnstampedIndex,
  makeDanglingSpec,
  readIndexSchemaVersion,
} from "./helpers/schema-version-fixtures.ts";

describe("version-drift-detection", () => {
  let tmpDir: string;
  let trackerRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-version-drift-"));
    trackerRoot = setupCleanTracker(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("emits version_drift finding when index has no schema_version AND other findings exist", () => {
    // Replace the index with an unstamped version
    writeFileSync(join(trackerRoot, "00-INDEX.md"), makeUnstampedIndex(), "utf-8");

    // Add a spec with a dangling depends_on to create another finding
    const milestonePath = join(trackerRoot, "M1-test-milestone");
    writeFileSync(join(milestonePath, "02-dangling.md"), makeDanglingSpec(), "utf-8");

    const report = runDoctor({ trackerRoot });

    expect(report.healthy).toBe(false);
    const driftFindings = report.findings.filter((f) => f.kind === "version_drift");
    expect(driftFindings.length).toBeGreaterThanOrEqual(1);
    expect(driftFindings[0]!.detail).toContain("ask darius to migrate");
  });

  it("emits version_drift when index has old schema_version AND other findings exist", () => {
    const indexPath = join(trackerRoot, "00-INDEX.md");
    // Write index with schema_version: 1 (old)
    const oldVersionIndex = makeUnstampedIndex().replace(
      "type: main-index",
      "schema_version: 1\ntype: main-index",
    );
    writeFileSync(indexPath, oldVersionIndex, "utf-8");

    // Add a dangling dep to create another finding
    const milestonePath = join(trackerRoot, "M1-test-milestone");
    writeFileSync(join(milestonePath, "02-dangling.md"), makeDanglingSpec(), "utf-8");

    const report = runDoctor({ trackerRoot });

    expect(report.healthy).toBe(false);
    const driftFindings = report.findings.filter((f) => f.kind === "version_drift");
    expect(driftFindings.length).toBeGreaterThanOrEqual(1);
  });

  it("does NOT emit version_drift when no other findings exist (auto-stamps instead)", () => {
    // Replace the index with an unstamped version (no other findings)
    writeFileSync(join(trackerRoot, "00-INDEX.md"), makeUnstampedIndex(), "utf-8");

    const report = runDoctor({ trackerRoot });

    // Should be healthy — auto-stamp applied
    expect(report.healthy).toBe(true);
    const driftFindings = report.findings.filter((f) => f.kind === "version_drift");
    expect(driftFindings).toHaveLength(0);
  });

  it("does NOT stamp when version_drift finding is reported", () => {
    writeFileSync(join(trackerRoot, "00-INDEX.md"), makeUnstampedIndex(), "utf-8");

    // Add dangling dep to ensure a finding is present
    const milestonePath = join(trackerRoot, "M1-test-milestone");
    writeFileSync(join(milestonePath, "02-dangling.md"), makeDanglingSpec(), "utf-8");

    runDoctor({ trackerRoot });

    // Stamp should NOT have been written (index still has no schema_version)
    expect(readIndexSchemaVersion(trackerRoot)).toBeNull();
  });
});
