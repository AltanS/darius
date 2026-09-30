/**
 * Tests for doctor hard error when schema_version > CURRENT.
 *
 * pnpm vitest run version-future-error
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctor } from "../lib/doctor.ts";
import {
  setupCleanTracker,
  makeIndexWithVersion,
} from "./helpers/schema-version-fixtures.ts";

describe("version-future-error", () => {
  let tmpDir: string;
  let trackerRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-version-future-"));
    trackerRoot = setupCleanTracker(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("doctor throws a hard error when schema_version > CURRENT_SCHEMA_VERSION", () => {
    // Write index with schema_version far in the future
    writeFileSync(join(trackerRoot, "00-INDEX.md"), makeIndexWithVersion(99), "utf-8");

    expect(() => runDoctor({ trackerRoot })).toThrow(/plugin is too old/);
  });

  it("doctor hard error mentions the on-disk version number", () => {
    writeFileSync(join(trackerRoot, "00-INDEX.md"), makeIndexWithVersion(99), "utf-8");

    let thrownMessage = "";
    try {
      runDoctor({ trackerRoot });
    } catch (err) {
      thrownMessage = err instanceof Error ? err.message : String(err);
    }

    expect(thrownMessage).toContain("99");
    expect(thrownMessage).toContain("plugin is too old");
  });

  it("doctor does NOT auto-stamp a future version", () => {
    writeFileSync(join(trackerRoot, "00-INDEX.md"), makeIndexWithVersion(99), "utf-8");

    try {
      runDoctor({ trackerRoot });
    } catch {
      // Expected
    }

    // The file should still have schema_version: 99 (not overwritten)
    const raw = readFileSync(join(trackerRoot, "00-INDEX.md"), "utf-8");
    expect(raw).toContain("schema_version: 99");
  });
});
