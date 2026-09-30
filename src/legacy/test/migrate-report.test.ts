/**
 * Tests for migration report log structure.
 *
 * pnpm vitest run migrate-report
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  readdirSync,
  existsSync,
  cpSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrate } from "../lib/migrate.ts";

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

describe("migrate-report", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-migrate-report-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes a migration log at .tracker/.migration-<ISO-date>.log after apply", () => {
    const trackerRoot = copyFixture("v8-drift", tmpDir);

    const result = runMigrate({ trackerRoot, dryRun: false });

    expect(result.logPath).not.toBeNull();
    expect(result.logPath).toMatch(/\.migration-.+\.log$/);
    expect(existsSync(result.logPath!)).toBe(true);

    const logContent = readFileSync(result.logPath!, "utf-8");
    const lines = logContent.trim().split("\n").filter((l) => l.trim());
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/\[.+\] STEP=\S+ FILE=\S+ ACTION=\S+ REASON=.+/);
    }
  });

  it("log contains step names for each migration action", () => {
    const trackerRoot = copyFixture("v8-drift", tmpDir);

    const result = runMigrate({ trackerRoot, dryRun: false });

    const logContent = readFileSync(result.logPath!, "utf-8");
    expect(logContent).toContain("STEP=migrateLegacyFrontmatter");
  });

  it("dry-run does NOT create a .migration log file", () => {
    const trackerRoot = copyFixture("v8-drift", tmpDir);

    const result = runMigrate({ trackerRoot, dryRun: true });

    expect(result.logPath).toBeNull();
    const files = readdirSync(trackerRoot);
    const logFiles = files.filter((f) => f.startsWith(".migration-"));
    expect(logFiles).toHaveLength(0);
  });

  it("dry-run output is prefixed with # DRY RUN", () => {
    const trackerRoot = copyFixture("v8-drift", tmpDir);

    const result = runMigrate({ trackerRoot, dryRun: true });

    expect(result.diffText).toContain("# DRY RUN");
  });
});
