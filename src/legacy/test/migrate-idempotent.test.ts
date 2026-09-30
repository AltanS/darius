/**
 * Tests for migration idempotency.
 *
 * pnpm vitest run migrate-idempotent
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  cpSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectVersion, runMigrate } from "../lib/migrate.ts";

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

describe("migrate-idempotent", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-migrate-idempotent-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("second apply run is a no-op (detects v9, returns 0 changes)", () => {
    const trackerRoot = copyFixture("v8-drift", tmpDir);

    const result1 = runMigrate({ trackerRoot, dryRun: false });
    expect(result1.noOp).toBe(false);
    expect(result1.changeCount).toBeGreaterThan(0);

    const result2 = runMigrate({ trackerRoot, dryRun: false });
    expect(result2.noOp).toBe(true);
    expect(result2.changeCount).toBe(0);
  });

  it("file content is identical after running apply twice", () => {
    const trackerRoot = copyFixture("v8-drift", tmpDir);

    runMigrate({ trackerRoot, dryRun: false });
    const specPath = join(trackerRoot, "M1-foo", "01-bar.md");
    const content1 = readFileSync(specPath, "utf-8");

    runMigrate({ trackerRoot, dryRun: false });
    const content2 = readFileSync(specPath, "utf-8");

    expect(content1).toBe(content2);
  });

  it("detects v9 after first apply and short-circuits", () => {
    const trackerRoot = copyFixture("v8-drift", tmpDir);

    runMigrate({ trackerRoot, dryRun: false });

    const version = detectVersion(trackerRoot);
    expect(version).toBe("v9");
  });
});
