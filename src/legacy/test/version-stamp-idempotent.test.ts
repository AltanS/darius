/**
 * Tests for idempotency of schema_version stamping.
 *
 * pnpm vitest run version-stamp-idempotent
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
  readIndexSchemaVersion,
} from "./helpers/schema-version-fixtures.ts";

describe("version-stamp-idempotent", () => {
  let tmpDir: string;
  let trackerRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-version-idempotent-"));
    trackerRoot = setupCleanTracker(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("running doctor twice on a stamped tracker produces no diff", () => {
    // First run with --fix stamps the index (darius 0.66.0: never without --fix)
    writeFileSync(join(trackerRoot, "00-INDEX.md"), makeUnstampedIndex(), "utf-8");
    runDoctor({ trackerRoot, fix: true });

    const afterFirstRun = readFileSync(join(trackerRoot, "00-INDEX.md"), "utf-8");

    // Second run — should be no-op
    runDoctor({ trackerRoot });

    const afterSecondRun = readFileSync(join(trackerRoot, "00-INDEX.md"), "utf-8");

    expect(afterSecondRun).toBe(afterFirstRun);
  });

  it("doctor on an already-current-stamped tracker is healthy with no changes", () => {
    // setupCleanTracker already produces a schema_version: 2 stamped index
    const beforeContent = readFileSync(join(trackerRoot, "00-INDEX.md"), "utf-8");
    expect(readIndexSchemaVersion(trackerRoot)).toBe(CURRENT_SCHEMA_VERSION);

    const report = runDoctor({ trackerRoot });

    expect(report.healthy).toBe(true);
    const afterContent = readFileSync(join(trackerRoot, "00-INDEX.md"), "utf-8");
    expect(afterContent).toBe(beforeContent);
  });

  it("schema_version remains the same after multiple doctor runs", () => {
    writeFileSync(join(trackerRoot, "00-INDEX.md"), makeUnstampedIndex(), "utf-8");

    runDoctor({ trackerRoot, fix: true });
    expect(readIndexSchemaVersion(trackerRoot)).toBe(CURRENT_SCHEMA_VERSION);

    runDoctor({ trackerRoot });
    expect(readIndexSchemaVersion(trackerRoot)).toBe(CURRENT_SCHEMA_VERSION);

    runDoctor({ trackerRoot });
    expect(readIndexSchemaVersion(trackerRoot)).toBe(CURRENT_SCHEMA_VERSION);
  });
});
