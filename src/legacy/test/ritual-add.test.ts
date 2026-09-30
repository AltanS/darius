/**
 * Tests for `addRitual` (rituals/<slug>/ritual.md scaffolding).
 *
 * pnpm exec vitest run test/ritual-add.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTracker, addRitual } from "../lib/tracker-writer.ts";
import { todayIso } from "../lib/dates.ts";

describe("add-ritual", () => {
  let tmpDir: string;
  let trackerRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-ritual-add-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function ritualFile(slug: string): string {
    return readFileSync(join(trackerRoot, "rituals", slug, "ritual.md"), "utf-8");
  }

  it("creates rituals/<slug>/ritual.md and an empty runs/ dir", () => {
    const result = addRitual({
      trackerRoot,
      name: "Server Benchmark",
      slug: "server-benchmark",
      cadence: "7d",
    });
    expect(result.kind).toBe("created");
    expect(existsSync(join(trackerRoot, "rituals", "server-benchmark", "ritual.md"))).toBe(true);
    expect(existsSync(join(trackerRoot, "rituals", "server-benchmark", "runs"))).toBe(true);
  });

  it("writes type/name/slug/cadence frontmatter", () => {
    addRitual({ trackerRoot, name: "Server Benchmark", slug: "server-benchmark", cadence: "7d" });
    const content = ritualFile("server-benchmark");
    expect(content).toContain("type: ritual");
    expect(content).toContain("name: Server Benchmark");
    expect(content).toContain("slug: server-benchmark");
    expect(content).toContain("cadence: 7d");
    expect(content).toContain("# Server Benchmark");
    expect(content).toContain("## Verification Checklist");
  });

  it("defaults due to today and started to today", () => {
    addRitual({ trackerRoot, name: "Weekly Report", slug: "weekly-report", cadence: "1w" });
    const content = ritualFile("weekly-report");
    expect(content).toContain(`due: ${todayIso()}`);
    expect(content).toContain(`started: ${todayIso()}`);
  });

  it("honors an explicit due date", () => {
    addRitual({ trackerRoot, name: "Audit", slug: "audit", cadence: "1m", due: "2026-07-01" });
    expect(ritualFile("audit")).toContain("due: 2026-07-01");
  });

  it("allows an on-demand ritual with no cadence", () => {
    const result = addRitual({ trackerRoot, name: "Ad Hoc", slug: "ad-hoc" });
    expect(result.kind).toBe("created");
    // cadence line present but empty
    expect(ritualFile("ad-hoc")).toMatch(/\ncadence:\s*\n/);
  });

  it("sets the agent in frontmatter", () => {
    addRitual({
      trackerRoot,
      name: "Server Benchmark",
      slug: "server-benchmark",
      cadence: "7d",
      agent: "typescript:typescript-expert",
    });
    expect(ritualFile("server-benchmark")).toContain("agent: typescript:typescript-expert");
  });

  it("rejects an invalid cadence", () => {
    expect(() =>
      addRitual({ trackerRoot, name: "Bad", slug: "bad", cadence: "whenever" }),
    ).toThrow(/cadence/i);
  });

  it("rejects an invalid due date", () => {
    expect(() =>
      addRitual({ trackerRoot, name: "Bad", slug: "bad", due: "07/01/2026" }),
    ).toThrow(/due/i);
  });

  it("is idempotent: re-running the same slug returns {kind:'exists'}", () => {
    addRitual({ trackerRoot, name: "Server Benchmark", slug: "server-benchmark", cadence: "7d" });
    const again = addRitual({ trackerRoot, name: "Server Benchmark", slug: "server-benchmark", cadence: "7d" });
    expect(again.kind).toBe("exists");
  });

  it("regenerates the index with a Rituals table row", () => {
    addRitual({ trackerRoot, name: "Server Benchmark", slug: "server-benchmark", cadence: "7d" });
    const index = readFileSync(join(trackerRoot, "00-INDEX.md"), "utf-8");
    expect(index).toContain("## Rituals");
    expect(index).toContain("| Ritual | Cadence | Last run | Next due |");
    expect(index).toContain("| server-benchmark | 7d |");
  });
});
