/**
 * Tests for v1 flat tracker migration.
 *
 * pnpm vitest run migrate-v1
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  cpSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { detectVersion, planMigration, runMigrate } from "../lib/migrate.ts";

const FIXTURES_DIR = join(
  import.meta.dirname ?? new URL(".", import.meta.url).pathname,
  "fixtures",
  "migrations",
);

function copyFixture(fixtureName: string, destDir: string): string {
  const srcDir = join(FIXTURES_DIR, fixtureName);
  cpSync(srcDir, destDir, { recursive: true });
  return join(destDir, ".tracker");
}

describe("migrate-v1", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-migrate-v1-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects v1 flat tracker correctly", () => {
    const trackerRoot = copyFixture("v1-flat", tmpDir);
    const version = detectVersion(trackerRoot);
    expect(version).toBe("v1");
  });

  it("dry-run diff mentions folder creation (migrateV1ToV2 step)", () => {
    const trackerRoot = copyFixture("v1-flat", tmpDir);

    const result = runMigrate({ trackerRoot, dryRun: true });

    expect(result.diffText).toContain("migrateV1ToV2");
    expect(result.diffText).toMatch(/CREATED/);
  });

  it("dry-run diff mentions moving flat spec files", () => {
    const trackerRoot = copyFixture("v1-flat", tmpDir);

    const plan = planMigration({ trackerRoot });

    const movedChanges = plan.changes.filter(
      (c) => c.step === "migrateV1ToV2" && c.action === "moved",
    );
    expect(movedChanges.length).toBeGreaterThanOrEqual(2);
    const files = movedChanges.map((c) => basename(c.file));
    expect(files).toContain("01-flat-spec.md");
    expect(files).toContain("02-another.md");
  });

  it("dry-run does not create any files", () => {
    const trackerRoot = copyFixture("v1-flat", tmpDir);

    runMigrate({ trackerRoot, dryRun: true });

    expect(existsSync(join(trackerRoot, "M1-migrated"))).toBe(false);
  });

  it("apply creates the milestone folder and moves specs", () => {
    const trackerRoot = copyFixture("v1-flat", tmpDir);

    runMigrate({ trackerRoot, dryRun: false });

    const milestonePath = join(trackerRoot, "M1-migrated");
    expect(existsSync(milestonePath)).toBe(true);
    expect(existsSync(join(milestonePath, "00-README.md"))).toBe(true);
    expect(existsSync(join(milestonePath, "01-flat-spec.md"))).toBe(true);
    expect(existsSync(join(milestonePath, "02-another.md"))).toBe(true);
  });
});
