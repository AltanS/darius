/**
 * Tests for `stampRun` (rituals/<slug>/runs/<date>.md from the step template).
 *
 * pnpm exec vitest run test/ritual-run.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTracker, addRitual, stampRun } from "../lib/tracker-writer.ts";
import { parseSpec } from "../lib/documents/spec.ts";

describe("stamp-run", () => {
  let tmpDir: string;
  let trackerRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-ritual-run-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    addRitual({
      trackerRoot,
      name: "Server Benchmark",
      slug: "server-benchmark",
      cadence: "7d",
      agent: "typescript:typescript-expert",
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function runFile(date: string): string {
    return readFileSync(
      join(trackerRoot, "rituals", "server-benchmark", "runs", `${date}.md`),
      "utf-8",
    );
  }

  it("creates runs/<date>.md", () => {
    const result = stampRun({ trackerRoot, slug: "server-benchmark", date: "2026-06-22" });
    expect(result.kind).toBe("created");
    expect(
      existsSync(join(trackerRoot, "rituals", "server-benchmark", "runs", "2026-06-22.md")),
    ).toBe(true);
  });

  it("writes run frontmatter (type/ritual/started) and a dated title", () => {
    stampRun({ trackerRoot, slug: "server-benchmark", date: "2026-06-22" });
    const content = runFile("2026-06-22");
    expect(content).toContain("type: run");
    expect(content).toContain("ritual: server-benchmark");
    expect(content).toContain("started: 2026-06-22");
    expect(content).toContain("# Server Benchmark — run 2026-06-22");
  });

  it("inherits the ritual's agent", () => {
    stampRun({ trackerRoot, slug: "server-benchmark", date: "2026-06-22" });
    expect(runFile("2026-06-22")).toContain("agent: typescript:typescript-expert");
  });

  it("resets all checkboxes to pending and parses as a spec", () => {
    stampRun({ trackerRoot, slug: "server-benchmark", date: "2026-06-22" });
    const content = runFile("2026-06-22");
    expect(content).not.toContain("[x]");
    expect(content).toContain("- [ ]");
    const view = parseSpec(content, "run.md");
    expect(view.totalCount).toBeGreaterThan(0);
    expect(view.verifiedCount).toBe(0);
    expect(view.computedStatus).toBe("Not Started");
  });

  it("is idempotent per date", () => {
    stampRun({ trackerRoot, slug: "server-benchmark", date: "2026-06-22" });
    const again = stampRun({ trackerRoot, slug: "server-benchmark", date: "2026-06-22" });
    expect(again.kind).toBe("exists");
  });

  it("throws for an unknown ritual", () => {
    expect(() => stampRun({ trackerRoot, slug: "nope", date: "2026-06-22" })).toThrow(/not found/i);
  });

  it("rejects a malformed date", () => {
    expect(() =>
      stampRun({ trackerRoot, slug: "server-benchmark", date: "June 22" }),
    ).toThrow(/date/i);
  });
});
