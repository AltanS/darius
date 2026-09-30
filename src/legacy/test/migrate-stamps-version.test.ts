/**
 * Tests for migrate --apply writing schema_version to the index.
 *
 * pnpm vitest run migrate-stamps-version
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrate } from "../lib/migrate.ts";
import { CURRENT_SCHEMA_VERSION } from "../lib/version.ts";
import {
  MIGRATIONS_FIXTURES_DIR,
  readIndexSchemaVersion,
} from "./helpers/schema-version-fixtures.ts";

describe("migrate-stamps-version", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-migrate-stamps-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("migrate --apply writes schema_version: 2 to the index as final step", () => {
    // Use the v8-drift fixture which has actual drift signals and no schema_version
    const fixtureSrc = join(MIGRATIONS_FIXTURES_DIR, "v8-drift");
    cpSync(fixtureSrc, tmpDir, { recursive: true });
    const trackerRoot = join(tmpDir, ".tracker");

    // Confirm no stamp yet
    expect(readIndexSchemaVersion(trackerRoot)).toBeNull();

    // Run migrate with apply
    runMigrate({ trackerRoot, dryRun: false });

    const stampedVersion = readIndexSchemaVersion(trackerRoot);
    expect(stampedVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("migrate is idempotent — running apply twice leaves the same stamp", () => {
    const fixtureSrc = join(MIGRATIONS_FIXTURES_DIR, "v8-drift");
    cpSync(fixtureSrc, tmpDir, { recursive: true });
    const trackerRoot = join(tmpDir, ".tracker");

    runMigrate({ trackerRoot, dryRun: false });
    const firstStamp = readIndexSchemaVersion(trackerRoot);

    // Run again — should be idempotent (v9 now, no structural changes, stamp preserved)
    runMigrate({ trackerRoot, dryRun: false });
    const secondStamp = readIndexSchemaVersion(trackerRoot);

    expect(firstStamp).toBe(CURRENT_SCHEMA_VERSION);
    expect(secondStamp).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("dry-run output mentions the stampSchemaVersion step", () => {
    const fixtureSrc = join(MIGRATIONS_FIXTURES_DIR, "v8-drift");
    cpSync(fixtureSrc, tmpDir, { recursive: true });
    const trackerRoot = join(tmpDir, ".tracker");

    const result = runMigrate({ trackerRoot, dryRun: true });

    expect(result.diffText).toContain("stampSchemaVersion");
  });
});
