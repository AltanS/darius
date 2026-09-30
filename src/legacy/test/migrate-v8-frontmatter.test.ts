/**
 * Tests for v8 tracker with legacy frontmatter drift.
 *
 * pnpm vitest run migrate-v8-frontmatter
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
import { parseFrontmatter } from "../lib/markdown/frontmatter.ts";
import { parseSpec } from "../lib/documents/spec.ts";

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

describe("migrate-v8-frontmatter", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-migrate-v8-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects v8 tracker correctly (has legacy status/verified fields)", () => {
    const trackerRoot = copyFixture("v8-drift", tmpDir);
    const version = detectVersion(trackerRoot);
    expect(version).toBe("v8");
  });

  it("apply strips status: and verified: from spec frontmatter", () => {
    const trackerRoot = copyFixture("v8-drift", tmpDir);

    runMigrate({ trackerRoot, dryRun: false });

    const specPath = join(trackerRoot, "M1-foo", "01-bar.md");
    const content = readFileSync(specPath, "utf-8");
    const { data } = parseFrontmatter(content);

    expect(data).not.toHaveProperty("status");
    expect(data).not.toHaveProperty("verified");
  });

  it("tracker show still derives status correctly after migration", () => {
    const trackerRoot = copyFixture("v8-drift", tmpDir);

    runMigrate({ trackerRoot, dryRun: false });

    const specPath = join(trackerRoot, "M1-foo", "01-bar.md");
    const raw = readFileSync(specPath, "utf-8");
    const view = parseSpec(raw, specPath);

    // Two unchecked items → Not Started
    expect(view.computedStatus).toBe("Not Started");
    expect(view.totalCount).toBe(2);
    expect(view.verifiedCount).toBe(0);
  });

  it("apply normalizes datetime strings to plain YYYY-MM-DD", () => {
    const trackerRoot = copyFixture("v8-drift", tmpDir);

    runMigrate({ trackerRoot, dryRun: false });

    const specPath = join(trackerRoot, "M1-foo", "01-bar.md");
    const content = readFileSync(specPath, "utf-8");
    const { data } = parseFrontmatter(content);

    // updated was "2026-01-01T00:00:00" — normalized to "2026-01-01"
    expect(data["updated"]).toBe("2026-01-01");
  });
});
