/**
 * CLI dispatch tests for `tracker due` and `tracker ritual <add|run|complete|list>`.
 * Spawns the real binary (mirrors verify-item.test.ts).
 *
 * pnpm exec vitest run test/ritual-cli.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTracker } from "../lib/tracker-writer.ts";
import { todayIso } from "../lib/dates.ts";

describe("ritual CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-ritual-cli-"));
    initTracker({ projectRoot: tmpDir });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function runTracker(args: string[]): { stdout: string; stderr: string; exitCode: number } {
    const result = spawnSync(
      "node",
      ["--experimental-strip-types", "--no-warnings", join(process.cwd(), "bin/tracker.mts"), ...args],
      { encoding: "utf-8", cwd: tmpDir, timeout: 30_000 },
    );
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.status ?? -1,
    };
  }

  it("ritual add creates a ritual (exit 0)", () => {
    const { exitCode, stdout } = runTracker([
      "ritual", "add", "--name", "Server Benchmark", "--slug", "server-benchmark",
      "--cadence", "7d", "--due", "2020-01-01",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("created");
  });

  it("due lists an overdue ritual; future ones are excluded", () => {
    runTracker(["ritual", "add", "--name", "Bench", "--slug", "bench", "--cadence", "7d", "--due", "2020-01-01"]);
    runTracker(["ritual", "add", "--name", "Future", "--slug", "future", "--cadence", "7d", "--due", "2999-01-01"]);

    const { exitCode, stdout } = runTracker(["due"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("bench");
    expect(stdout).toContain("overdue");
    expect(stdout).not.toContain("future");
  });

  it("due --json emits structured records", () => {
    runTracker(["ritual", "add", "--name", "Bench", "--slug", "bench", "--cadence", "7d", "--due", "2020-01-01"]);
    const { exitCode, stdout } = runTracker(["due", "--json"]);
    expect(exitCode).toBe(0);
    // Shape: { rituals: DueRitual[], vigils: { due: DueVigil[], armed: VigilRecord[] } }
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed.rituals)).toBe(true);
    expect(parsed.rituals[0].slug).toBe("bench");
    expect(parsed.rituals[0].daysOverdue).toBeGreaterThan(0);
    expect(parsed.vigils.due).toEqual([]);
    expect(parsed.vigils.armed).toEqual([]);
  });

  it("ritual run stamps a dated run; complete rolls due forward and dormants the queue", () => {
    runTracker(["ritual", "add", "--name", "Bench", "--slug", "bench", "--cadence", "7d", "--due", "2020-01-01"]);

    const run = runTracker(["ritual", "run", "bench", "--date", "2026-06-16"]);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("stamped");

    // Complete with real today so the rolled due lands in the future.
    const complete = runTracker(["ritual", "complete", "bench", "--today", todayIso()]);
    expect(complete.exitCode).toBe(0);
    expect(complete.stdout).toContain("next due");

    const due = runTracker(["due"]);
    expect(due.stdout).toContain("No rituals due");
  });

  it("ritual list shows all rituals", () => {
    runTracker(["ritual", "add", "--name", "Bench", "--slug", "bench", "--cadence", "7d"]);
    const { exitCode, stdout } = runTracker(["ritual", "list"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("bench");
    expect(stdout).toContain("cadence=7d");
  });

  it("rejects an invalid cadence with exit 1", () => {
    const { exitCode, stderr } = runTracker([
      "ritual", "add", "--name", "Bad", "--slug", "bad", "--cadence", "whenever",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/cadence/i);
  });

  it("ritual run on an unknown slug exits 1", () => {
    const { exitCode, stderr } = runTracker(["ritual", "run", "ghost"]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/not found/i);
  });
});
