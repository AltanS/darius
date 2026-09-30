/**
 * Tests for doctor parity after migration.
 *
 * pnpm vitest run migrate-doctor-parity
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  cpSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrate } from "../lib/migrate.ts";
import { runDoctor } from "../lib/doctor.ts";

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

describe("migrate-doctor-parity", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-migrate-doctor-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("after migrate --apply on v8 fixture, tracker doctor exits healthy", () => {
    const trackerRoot = copyFixture("v8-drift", tmpDir);

    runMigrate({ trackerRoot, dryRun: false });

    const report = runDoctor({ trackerRoot });
    expect(report.healthy).toBe(true);
    expect(report.findings).toHaveLength(0);
  });

  it("after migrate --apply on v1 fixture, tracker doctor exits healthy", () => {
    const trackerRoot = copyFixture("v1-flat", tmpDir);

    runMigrate({ trackerRoot, dryRun: false });

    const report = runDoctor({ trackerRoot });
    expect(report.healthy).toBe(true);
  });

  it("already-v9 tracker is healthy before and after migrate (no-op)", () => {
    const trackerRoot = copyFixture("v8-drift", tmpDir);

    runMigrate({ trackerRoot, dryRun: false });

    const report1 = runDoctor({ trackerRoot });
    expect(report1.healthy).toBe(true);

    runMigrate({ trackerRoot, dryRun: false });

    const report2 = runDoctor({ trackerRoot });
    expect(report2.healthy).toBe(true);
  });
});
