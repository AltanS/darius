/**
 * Tests for doctor auto-stamp behavior.
 *
 * pnpm vitest run version-auto-stamp
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctor } from "../lib/doctor.ts";
import { CURRENT_SCHEMA_VERSION } from "../lib/version.ts";
import {
  setupCleanTracker,
  makeUnstampedIndex,
  makeDanglingSpec,
  readIndexSchemaVersion,
} from "./helpers/schema-version-fixtures.ts";

describe("version-auto-stamp", () => {
  let tmpDir: string;
  let trackerRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-version-auto-stamp-"));
    trackerRoot = setupCleanTracker(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes schema_version to the index when tracker is clean and unstamped", () => {
    // Replace with unstamped version
    writeFileSync(join(trackerRoot, "00-INDEX.md"), makeUnstampedIndex(), "utf-8");
    expect(readIndexSchemaVersion(trackerRoot)).toBeNull();

    const report = runDoctor({ trackerRoot });

    expect(report.healthy).toBe(true);
    expect(readIndexSchemaVersion(trackerRoot)).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("includes schema_version in frontmatter after stamping", () => {
    writeFileSync(join(trackerRoot, "00-INDEX.md"), makeUnstampedIndex(), "utf-8");
    expect(readIndexSchemaVersion(trackerRoot)).toBeNull();

    runDoctor({ trackerRoot });

    expect(readIndexSchemaVersion(trackerRoot)).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("does NOT stamp if there are other findings", () => {
    writeFileSync(join(trackerRoot, "00-INDEX.md"), makeUnstampedIndex(), "utf-8");

    // Add a dangling dep to create a finding
    const milestonePath = join(trackerRoot, "M1-test-milestone");
    writeFileSync(join(milestonePath, "02-dangling.md"), makeDanglingSpec(), "utf-8");

    runDoctor({ trackerRoot });

    // Stamp should NOT have been written
    expect(readIndexSchemaVersion(trackerRoot)).toBeNull();
  });

  it("doctor is healthy after auto-stamp", () => {
    writeFileSync(join(trackerRoot, "00-INDEX.md"), makeUnstampedIndex(), "utf-8");

    const firstReport = runDoctor({ trackerRoot });
    expect(firstReport.healthy).toBe(true);

    // Second run should also be healthy
    const secondReport = runDoctor({ trackerRoot });
    expect(secondReport.healthy).toBe(true);
  });
});
