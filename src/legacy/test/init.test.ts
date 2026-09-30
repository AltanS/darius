/**
 * Tests for `tracker init` — scaffold .tracker/ skeleton.
 *
 * pnpm vitest run init
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTracker } from "../lib/tracker-writer.ts";

describe("init", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-init-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates .tracker/ directory", () => {
    initTracker({ projectRoot: tmpDir });
    expect(existsSync(join(tmpDir, ".tracker"))).toBe(true);
  });

  it("creates .tracker/00-INDEX.md", () => {
    initTracker({ projectRoot: tmpDir });
    const indexPath = join(tmpDir, ".tracker", "00-INDEX.md");
    expect(existsSync(indexPath)).toBe(true);
  });

  it("00-INDEX.md contains Progress Dashboard", () => {
    initTracker({ projectRoot: tmpDir });
    const content = readFileSync(join(tmpDir, ".tracker", "00-INDEX.md"), "utf-8");
    expect(content).toContain("Progress Dashboard");
  });

  it("00-INDEX.md contains Status Legend", () => {
    initTracker({ projectRoot: tmpDir });
    const content = readFileSync(join(tmpDir, ".tracker", "00-INDEX.md"), "utf-8");
    expect(content).toContain("Status Legend");
  });

  it("refuses to initialize if .tracker/ already exists", () => {
    initTracker({ projectRoot: tmpDir });
    expect(() => initTracker({ projectRoot: tmpDir })).toThrow(
      ".tracker/ already exists",
    );
  });

  it("is idempotent: running once succeeds, second time throws with informative message", () => {
    initTracker({ projectRoot: tmpDir });
    let errorMessage = "";
    try {
      initTracker({ projectRoot: tmpDir });
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }
    expect(errorMessage).toContain(".tracker/ already exists");
  });
});
