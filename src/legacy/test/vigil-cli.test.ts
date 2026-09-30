/**
 * CLI dispatch tests for `tracker vigil <add|list|close>` and `tracker due`
 * with mixed rituals + vigils. Spawns the real binary (mirrors ritual-cli).
 *
 * pnpm exec vitest run test/vigil-cli.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTracker } from "../lib/tracker-writer.ts";

describe("vigil CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-vigil-cli-"));
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

  it("vigil add creates a vigil (exit 0)", () => {
    const { exitCode, stdout } = runTracker([
      "vigil", "add", "s02-soak", "--name", "S02 soak", "--due", "2026-08-01",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("created");
  });

  it("vigil list shows open vigils by default; --all includes closed", () => {
    runTracker(["vigil", "add", "open-one", "--until", "batch ships"]);
    runTracker(["vigil", "add", "closed-one", "--due", "2020-01-01"]);
    runTracker(["vigil", "close", "closed-one", "--verdict", "held"]);

    const open = runTracker(["vigil", "list"]);
    expect(open.exitCode).toBe(0);
    expect(open.stdout).toContain("open-one");
    expect(open.stdout).not.toContain("closed-one");

    const all = runTracker(["vigil", "list", "--all"]);
    expect(all.stdout).toContain("open-one");
    expect(all.stdout).toContain("closed-one");
    expect(all.stdout).toContain("held");
  });

  it("due surfaces mixed rituals + vigils in grouped sections", () => {
    runTracker(["ritual", "add", "--name", "Bench", "--slug", "bench", "--cadence", "7d", "--due", "2020-01-01"]);
    runTracker(["vigil", "add", "date-soak", "--name", "Date soak", "--due", "2020-01-01", "--from", "M77/S02"]);
    runTracker(["vigil", "add", "event-soak", "--name", "Event soak", "--until", "first real qualifier batch"]);

    const { exitCode, stdout } = runTracker(["due"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("bench"); // ritual
    expect(stdout).toContain("Vigils due:");
    expect(stdout).toContain("date-soak");
    expect(stdout).toContain("[from M77/S02]");
    expect(stdout).toContain("Vigils armed (event-gated):");
    expect(stdout).toContain("waiting on: first real qualifier batch");
  });

  it("due --json emits the { rituals, vigils:{due,armed} } shape", () => {
    runTracker(["vigil", "add", "date-soak", "--due", "2020-01-01"]);
    runTracker(["vigil", "add", "event-soak", "--until", "batch"]);

    const { exitCode, stdout } = runTracker(["due", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed.rituals)).toBe(true);
    expect(parsed.vigils.due.map((v: { slug: string }) => v.slug)).toContain("date-soak");
    expect(parsed.vigils.armed.map((v: { slug: string }) => v.slug)).toContain("event-soak");
  });

  it("reports nothing-due covering both queues when empty", () => {
    const { exitCode, stdout } = runTracker(["due"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("No rituals due");
    expect(stdout).toContain("no vigils pending");
  });

  it("vigil close --verdict failed prints the remediation reminder", () => {
    runTracker(["vigil", "add", "soak", "--due", "2020-01-01"]);
    const { exitCode, stdout } = runTracker(["vigil", "close", "soak", "--verdict", "failed"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("verdict failed");
    expect(stdout).toContain("/tracker:add");
  });

  it("vigil add with no gate exits 1", () => {
    const { exitCode, stderr } = runTracker(["vigil", "add", "no-gate", "--name", "No gate"]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/gate/i);
  });

  it("vigil close on an unknown slug exits 1", () => {
    const { exitCode, stderr } = runTracker(["vigil", "close", "ghost", "--verdict", "held"]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/not found/i);
  });

  it("vigil close with an invalid verdict exits 1", () => {
    runTracker(["vigil", "add", "soak", "--due", "2020-01-01"]);
    const { exitCode, stderr } = runTracker(["vigil", "close", "soak", "--verdict", "maybe"]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/verdict/i);
  });
});
