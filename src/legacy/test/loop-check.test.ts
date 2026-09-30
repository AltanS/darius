/**
 * Tests for the loop-check command — the Work Loop exit gate's decision engine.
 *
 * pnpm vitest run loop-check
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTracker } from "../lib/tracker-writer.ts";
import { openThread, closeThread, setStage } from "../lib/worklog.ts";
import { runLoopCheck, formatLoopCheckReport } from "../lib/loop-check.ts";

describe("loop-check", () => {
  let tmpDir: string;
  let trackerRoot: string;
  let worklogPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-loop-check-test-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    worklogPath = join(trackerRoot, "worklog", "m5-test.md");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // stuck detection
  // -------------------------------------------------------------------------

  it("stuck: clean when no worklog threads exist", () => {
    const result = runLoopCheck({ trackerRoot });
    expect(result.status).toBe("clean");
    expect(result.threads).toHaveLength(0);
  });

  it("stuck: flags open threads in planned, dispatched, and verified stages", () => {
    const planned = openThread({ worklogPath, slug: "t-planned", stage: "planned" });
    const dispatched = openThread({ worklogPath, slug: "t-dispatched", stage: "planned" });
    setStage({ worklogPath, threadId: dispatched, stage: "dispatched" });
    const verified = openThread({ worklogPath, slug: "t-verified", stage: "planned" });
    setStage({ worklogPath, threadId: verified, stage: "verified" });

    const result = runLoopCheck({ trackerRoot });
    expect(result.status).toBe("stuck");
    expect(result.threads.map((t) => t.threadId).sort()).toEqual(
      [planned, dispatched, verified].sort(),
    );
  });

  it("stuck: committed, closed, and stage-less threads are exempt", () => {
    const committed = openThread({ worklogPath, slug: "t-committed", stage: "planned" });
    setStage({ worklogPath, threadId: committed, stage: "committed" });

    const closed = openThread({ worklogPath, slug: "t-closed", stage: "planned" });
    closeThread({ worklogPath, threadId: closed, status: "blocked" });

    openThread({ worklogPath, slug: "t-legacy" }); // no stage

    const result = runLoopCheck({ trackerRoot });
    expect(result.status).toBe("clean");
    expect(result.threads).toHaveLength(0);
  });

  it("stuck: NEXT action text matches the thread's stage and embeds its id", () => {
    const planned = openThread({ worklogPath, slug: "t-plan", stage: "planned" });
    const dispatched = openThread({ worklogPath, slug: "t-disp", stage: "planned" });
    setStage({ worklogPath, threadId: dispatched, stage: "dispatched" });
    const verified = openThread({ worklogPath, slug: "t-ver", stage: "planned" });
    setStage({ worklogPath, threadId: verified, stage: "verified" });

    const result = runLoopCheck({ trackerRoot });
    const byId = new Map(result.threads.map((t) => [t.threadId, t]));

    expect(byId.get(planned)?.next).toContain(`tracker worklog dispatch ${planned}`);
    expect(byId.get(dispatched)?.next).toContain("/tracker:work-verify");
    expect(byId.get(dispatched)?.next).toContain(dispatched);
    expect(byId.get(verified)?.next).toContain("/tracker:commit");

    const report = formatLoopCheckReport(result);
    expect(report).toContain("STATUS: stuck");
    expect(report).toContain(`THREAD: ${planned}`);
    expect(report).toContain("NEXT: Stage 2");
  });

  // -------------------------------------------------------------------------
  // bounce budget
  // -------------------------------------------------------------------------

  it("bounce: increments per agent-id and exhausts after max (default 2)", () => {
    openThread({ worklogPath, slug: "t-stuck", stage: "planned" });

    const first = runLoopCheck({ trackerRoot, bounceId: "agent-1" });
    expect(first.status).toBe("stuck");
    expect(first.bounces).toBe(1);

    const second = runLoopCheck({ trackerRoot, bounceId: "agent-1" });
    expect(second.status).toBe("stuck");
    expect(second.bounces).toBe(2);

    const third = runLoopCheck({ trackerRoot, bounceId: "agent-1" });
    expect(third.status).toBe("exhausted");
    expect(third.bounces).toBe(3);

    // A different invocation gets its own budget
    const other = runLoopCheck({ trackerRoot, bounceId: "agent-2" });
    expect(other.status).toBe("stuck");
    expect(other.bounces).toBe(1);
  });

  it("bounce: honors --max-bounces override", () => {
    openThread({ worklogPath, slug: "t-stuck", stage: "planned" });

    const first = runLoopCheck({ trackerRoot, bounceId: "a", maxBounces: 1 });
    expect(first.status).toBe("stuck");

    const second = runLoopCheck({ trackerRoot, bounceId: "a", maxBounces: 1 });
    expect(second.status).toBe("exhausted");
  });

  it("bounce: prunes entries older than 24h", () => {
    openThread({ worklogPath, slug: "t-stuck", stage: "planned" });
    const bouncePath = join(trackerRoot, ".loop-bounces.json");

    const old = new Date("2026-06-01T00:00:00.000Z");
    runLoopCheck({ trackerRoot, bounceId: "stale", now: old });
    runLoopCheck({ trackerRoot, bounceId: "stale", now: old });
    expect(JSON.parse(readFileSync(bouncePath, "utf-8"))["stale"].count).toBe(2);

    // >24h later the stale entry is pruned, so the same id restarts at 1
    const later = new Date("2026-06-03T00:00:00.000Z");
    const result = runLoopCheck({ trackerRoot, bounceId: "stale", now: later });
    expect(result.bounces).toBe(1);
    expect(result.status).toBe("stuck");
  });

  it("bounce: clean run clears the agent's entry (self-cleaning ledger)", () => {
    openThread({ worklogPath, slug: "t-stuck", stage: "planned" });
    const bouncePath = join(trackerRoot, ".loop-bounces.json");

    const stuck = runLoopCheck({ trackerRoot, bounceId: "agent-1" });
    expect(stuck.status).toBe("stuck");
    expect(JSON.parse(readFileSync(bouncePath, "utf-8"))["agent-1"]).toBeDefined();

    // Loop completes (thread closed) — next bounce call wipes the entry
    const threads = stuck.threads;
    closeThread({ worklogPath, threadId: threads[0]!.threadId, status: "done" });
    const clean = runLoopCheck({ trackerRoot, bounceId: "agent-1" });
    expect(clean.status).toBe("clean");
    expect(JSON.parse(readFileSync(bouncePath, "utf-8"))["agent-1"]).toBeUndefined();
  });

  it("bounce: pure query mode without bounceId reads/writes no state", () => {
    openThread({ worklogPath, slug: "t-stuck", stage: "planned" });

    const result = runLoopCheck({ trackerRoot });
    expect(result.status).toBe("stuck");
    expect(result.bounces).toBeUndefined();
    expect(existsSync(join(trackerRoot, ".loop-bounces.json"))).toBe(false);
  });

  // -------------------------------------------------------------------------
  // fails open
  // -------------------------------------------------------------------------

  it("fails open: corrupt bounce file is treated as empty", () => {
    openThread({ worklogPath, slug: "t-stuck", stage: "planned" });
    const bouncePath = join(trackerRoot, ".loop-bounces.json");
    writeFileSync(bouncePath, "{not json!!");

    const result = runLoopCheck({ trackerRoot, bounceId: "agent-1" });
    expect(result.status).toBe("stuck");
    expect(result.bounces).toBe(1);
  });

  it("fails open: missing worklog dir yields clean", () => {
    // initTracker may not create worklog/ until first thread — point at a
    // tracker root with no worklog dir at all.
    const result = runLoopCheck({ trackerRoot: join(tmpDir, "nonexistent", ".tracker") });
    expect(result.status).toBe("clean");
  });
});
