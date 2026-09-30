/**
 * Tests for `completeRun` — roll-forward and run retention.
 *
 * pnpm exec vitest run test/ritual-complete.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTracker, addRitual, stampRun, completeRun } from "../lib/tracker-writer.ts";

describe("complete-run", () => {
  let tmpDir: string;
  let trackerRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-ritual-complete-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function ritualFile(slug: string): string {
    return readFileSync(join(trackerRoot, "rituals", slug, "ritual.md"), "utf-8");
  }
  function runsDir(slug: string): string {
    return join(trackerRoot, "rituals", slug, "runs");
  }

  it("rolls due forward by cadence and stamps last_run (interval-since-completion)", () => {
    addRitual({ trackerRoot, name: "Bench", slug: "bench", cadence: "7d", due: "2026-06-22" });
    // Completed late (06-25): next due is 06-25 + 7d = 07-02, not 06-29.
    const result = completeRun({ trackerRoot, slug: "bench", today: "2026-06-25" });
    expect(result.rolledDue).toBe("2026-07-02");
    expect(result.lastRun).toBe("2026-06-25");
    const content = ritualFile("bench");
    expect(content).toContain("due: 2026-07-02");
    expect(content).toContain("last_run: 2026-06-25");
  });

  it("goes dormant (due cleared) when the ritual has no cadence", () => {
    addRitual({ trackerRoot, name: "Ad Hoc", slug: "ad-hoc", due: "2026-06-22" });
    const result = completeRun({ trackerRoot, slug: "ad-hoc", today: "2026-06-25" });
    expect(result.rolledDue).toBeNull();
    const content = ritualFile("ad-hoc");
    expect(content).toContain("last_run: 2026-06-25");
    // due is now empty (dormant)
    expect(content).toMatch(/\ndue:\s*\n/);
  });

  it("rolls months with clamping", () => {
    addRitual({ trackerRoot, name: "Monthly", slug: "monthly", cadence: "1m" });
    const result = completeRun({ trackerRoot, slug: "monthly", today: "2026-01-31" });
    expect(result.rolledDue).toBe("2026-02-28");
  });

  it("throws for an unknown ritual", () => {
    expect(() => completeRun({ trackerRoot, slug: "nope" })).toThrow(/not found/i);
  });

  it("prunes runs beyond retention into _ledger.md, keeping the newest 8", () => {
    addRitual({ trackerRoot, name: "Bench", slug: "bench", cadence: "7d" });
    // Stamp 10 dated runs: 2026-06-01 .. 2026-06-10
    for (let d = 1; d <= 10; d++) {
      const date = `2026-06-${String(d).padStart(2, "0")}`;
      stampRun({ trackerRoot, slug: "bench", date });
    }
    const result = completeRun({ trackerRoot, slug: "bench", today: "2026-06-11" });

    // Oldest two pruned
    expect(result.pruned).toEqual(["2026-06-01", "2026-06-02"]);
    expect(existsSync(join(runsDir("bench"), "2026-06-01.md"))).toBe(false);
    expect(existsSync(join(runsDir("bench"), "2026-06-02.md"))).toBe(false);

    // Newest eight kept
    expect(existsSync(join(runsDir("bench"), "2026-06-03.md"))).toBe(true);
    expect(existsSync(join(runsDir("bench"), "2026-06-10.md"))).toBe(true);

    // Ledger records the pruned dates
    const ledger = readFileSync(join(runsDir("bench"), "_ledger.md"), "utf-8");
    expect(ledger).toContain("2026-06-01");
    expect(ledger).toContain("2026-06-02");
    expect(ledger).not.toContain("2026-06-03");
  });

  it("does not prune when run count is at or below retention", () => {
    addRitual({ trackerRoot, name: "Bench", slug: "bench", cadence: "7d" });
    for (let d = 1; d <= 5; d++) {
      stampRun({ trackerRoot, slug: "bench", date: `2026-06-0${d}` });
    }
    const result = completeRun({ trackerRoot, slug: "bench", today: "2026-06-06" });
    expect(result.pruned).toEqual([]);
    expect(existsSync(join(runsDir("bench"), "_ledger.md"))).toBe(false);
  });
});
