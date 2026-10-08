/**
 * Tests for the loop-check command — the Work Loop exit gate's decision engine.
 *
 * Since 0.72.0: `committed` with a stamp is pre-terminal and `reviewed` is
 * terminal; the gate blocks only on threads the stopping session owns, and the
 * bounce budget is per thread.
 *
 * pnpm vitest run loop-check
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTracker } from "../lib/tracker-writer.ts";
import { openThread, closeThread, setStage, dispatchThread } from "../lib/worklog.ts";
import { runLoopCheck, formatLoopCheckReport } from "../lib/loop-check.ts";

const FORCE = { force: true, reason: "test without evidence" } as const;

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

  /** An open thread owned by `session`, moved to `stage`. */
  function owned(slug: string, session: string | null, stage: "planned" | "dispatched" | "verified" | "committed" | "reviewed"): string {
    const id = openThread({ worklogPath, slug, stage: "planned", session });
    const order = ["dispatched", "verified", "committed", "reviewed"] as const;
    for (const s of order) {
      if (order.indexOf(s) > order.indexOf(stage as (typeof order)[number])) break;
      setStage({ worklogPath, threadId: id, stage: s, ...FORCE });
    }
    return id;
  }

  // -------------------------------------------------------------------------
  // stuck detection (query mode)
  // -------------------------------------------------------------------------

  it("stuck: clean when no worklog threads exist", () => {
    const result = runLoopCheck({ trackerRoot });
    expect(result.status).toBe("clean");
    expect(result.threads).toHaveLength(0);
  });

  it("stuck: flags open threads in planned, dispatched, verified, and stamped committed stages", () => {
    const planned = owned("t-planned", null, "planned");
    const dispatched = owned("t-dispatched", null, "dispatched");
    const verified = owned("t-verified", null, "verified");
    const committed = owned("t-committed", null, "committed");

    const result = runLoopCheck({ trackerRoot });
    expect(result.status).toBe("stuck");
    expect(result.threads.map((t) => t.threadId).sort()).toEqual(
      [planned, dispatched, verified, committed].sort(),
    );
  });

  it("stuck: reviewed, closed, stage-less, and pre-0.72 committed threads are exempt", () => {
    owned("t-reviewed", null, "reviewed");

    const closed = openThread({ worklogPath, slug: "t-closed", stage: "planned" });
    closeThread({ worklogPath, threadId: closed, status: "blocked" });

    openThread({ worklogPath, slug: "t-legacy" }); // no stage

    // A committed thread written by 0.71: no stamp line at all.
    const oldPath = join(trackerRoot, "worklog", "m4-old.md");
    writeFileSync(
      oldPath,
      [
        "## 01OLD-done — done",
        "<!-- opened: 2026-01-01T00:00:00.000Z -->",
        "<!-- spec: .tracker/M4-x/01-y.md -->",
        "<!-- stage: committed -->",
        "",
      ].join("\n"),
    );

    const result = runLoopCheck({ trackerRoot });
    expect(result.status).toBe("clean");
    expect(result.threads).toHaveLength(0);
  });

  it("stuck: NEXT action text matches the thread's stage and embeds its id", () => {
    const planned = owned("t-plan", null, "planned");
    const dispatched = owned("t-disp", null, "dispatched");
    const verified = owned("t-ver", null, "verified");
    const committed = owned("t-com", null, "committed");

    const result = runLoopCheck({ trackerRoot });
    const byId = new Map(result.threads.map((t) => [t.threadId, t]));

    expect(byId.get(planned)?.next).toContain(`darius worklog dispatch ${planned}`);
    expect(byId.get(dispatched)?.next).toContain("/darius-work-verify");
    expect(byId.get(dispatched)?.next).toContain(dispatched);
    expect(byId.get(verified)?.next).toContain("/darius-commit");
    expect(byId.get(committed)?.next).toContain("Review:");
    expect(byId.get(committed)?.next).toContain(`darius worklog set-stage ${committed} reviewed`);

    const report = formatLoopCheckReport(result);
    expect(report).toContain("STATUS: stuck");
    expect(report).toContain(`THREAD: ${planned}`);
    expect(report).toContain("NEXT: Stage 2");
  });

  // -------------------------------------------------------------------------
  // gate mode: owner only
  // -------------------------------------------------------------------------

  it("gate: blocks only on threads the stopping session owns; others are a notice", () => {
    const mine = owned("t-mine", "sess-a", "verified");
    const theirs = owned("t-theirs", "sess-b", "dispatched");
    const nobody = owned("t-nobody", null, "planned");

    const result = runLoopCheck({ trackerRoot, session: "sess-a" });
    expect(result.status).toBe("stuck");
    expect(result.threads.map((t) => t.threadId)).toEqual([mine]);
    expect(result.others?.map((t) => t.threadId).sort()).toEqual([theirs, nobody].sort());

    const report = formatLoopCheckReport(result);
    const notice = report.split("\n").filter((l) => l.startsWith("NOTICE:"));
    expect(notice).toHaveLength(1);
    expect(notice[0]).toContain(`${theirs} (dispatched, session sess-b)`);
    expect(notice[0]).toContain(`${nobody} (planned, no session)`);
  });

  it("gate: a session with no own thread is clean, with the notice", () => {
    owned("t-theirs", "sess-b", "planned");
    const result = runLoopCheck({ trackerRoot, session: "sess-a" });
    expect(result.status).toBe("clean");
    expect(result.threads).toHaveLength(0);
    expect(result.others).toHaveLength(1);
  });

  it("gate: dispatch moves ownership to the dispatching session", () => {
    const id = openThread({ worklogPath, slug: "t-handoff", stage: "planned", session: "sess-a" });
    dispatchThread({ worklogPath, threadId: id, agent: "x", session: "sess-b" });
    expect(runLoopCheck({ trackerRoot, session: "sess-a" }).status).toBe("clean");
    expect(runLoopCheck({ trackerRoot, session: "sess-b" }).status).toBe("stuck");
  });

  it("gate: the old --bounce id acts as the session", () => {
    owned("t-mine", "sess-a", "planned");
    expect(runLoopCheck({ trackerRoot, bounceId: "sess-a" }).status).toBe("stuck");
    expect(runLoopCheck({ trackerRoot, bounceId: "agent-1" }).status).toBe("clean");
  });

  // -------------------------------------------------------------------------
  // bounce budget, per thread
  // -------------------------------------------------------------------------

  it("bounce: each thread blocks at most max times (default 2); a fresh thread still blocks", () => {
    const first = owned("t-one", "s", "planned");

    expect(runLoopCheck({ trackerRoot, session: "s" })).toMatchObject({ status: "stuck", bounces: 1 });
    expect(runLoopCheck({ trackerRoot, session: "s" })).toMatchObject({ status: "stuck", bounces: 2 });
    const third = runLoopCheck({ trackerRoot, session: "s" });
    expect(third.status).toBe("exhausted");
    expect(third.threads.map((t) => t.threadId)).toEqual([first]);
    expect(third.bounces).toBe(2);

    const second = owned("t-two", "s", "planned");
    const mixed = runLoopCheck({ trackerRoot, session: "s" });
    expect(mixed.status).toBe("stuck");
    expect(mixed.threads.map((t) => t.threadId)).toEqual([second]);
    expect(mixed.exhausted?.map((t) => t.threadId)).toEqual([first]);
    expect(formatLoopCheckReport(mixed)).toContain("OVER BUDGET (not blocking):");
  });

  it("bounce: honors --max-bounces override", () => {
    owned("t-stuck", "s", "planned");
    expect(runLoopCheck({ trackerRoot, session: "s", maxBounces: 1 }).status).toBe("stuck");
    expect(runLoopCheck({ trackerRoot, session: "s", maxBounces: 1 }).status).toBe("exhausted");
  });

  it("bounce: prunes entries older than 24h", () => {
    const id = owned("t-stuck", "s", "planned");
    const bouncePath = join(trackerRoot, ".loop-bounces.json");

    const old = new Date("2026-06-01T00:00:00.000Z");
    runLoopCheck({ trackerRoot, session: "s", now: old });
    runLoopCheck({ trackerRoot, session: "s", now: old });
    expect(JSON.parse(readFileSync(bouncePath, "utf-8"))[`thread:${id}`].count).toBe(2);

    const later = new Date("2026-06-03T00:00:00.000Z");
    const result = runLoopCheck({ trackerRoot, session: "s", now: later });
    expect(result.bounces).toBe(1);
    expect(result.status).toBe("stuck");
  });

  it("bounce: a thread that leaves the loop loses its entry", () => {
    const id = owned("t-stuck", "s", "planned");
    const bouncePath = join(trackerRoot, ".loop-bounces.json");

    runLoopCheck({ trackerRoot, session: "s" });
    expect(JSON.parse(readFileSync(bouncePath, "utf-8"))[`thread:${id}`]).toBeDefined();

    closeThread({ worklogPath, threadId: id, status: "cancelled" });
    expect(runLoopCheck({ trackerRoot, session: "s" }).status).toBe("clean");
    expect(JSON.parse(readFileSync(bouncePath, "utf-8"))[`thread:${id}`]).toBeUndefined();
  });

  it("bounce: the old per-session shape is ignored and dropped", () => {
    owned("t-stuck", "s", "planned");
    const bouncePath = join(trackerRoot, ".loop-bounces.json");
    writeFileSync(bouncePath, JSON.stringify({ s: { count: 9, updatedAt: new Date().toISOString() } }));

    const result = runLoopCheck({ trackerRoot, session: "s" });
    expect(result).toMatchObject({ status: "stuck", bounces: 1 });
    expect(JSON.parse(readFileSync(bouncePath, "utf-8"))["s"]).toBeUndefined();
  });

  it("bounce: pure query mode without a session reads/writes no state", () => {
    owned("t-stuck", "s", "planned");

    const result = runLoopCheck({ trackerRoot });
    expect(result.status).toBe("stuck");
    expect(result.bounces).toBeUndefined();
    expect(existsSync(join(trackerRoot, ".loop-bounces.json"))).toBe(false);
  });

  // -------------------------------------------------------------------------
  // fails open
  // -------------------------------------------------------------------------

  it("fails open: corrupt bounce file is treated as empty", () => {
    owned("t-stuck", "s", "planned");
    mkdirSync(trackerRoot, { recursive: true });
    writeFileSync(join(trackerRoot, ".loop-bounces.json"), "{not json!!");

    const result = runLoopCheck({ trackerRoot, session: "s" });
    expect(result.status).toBe("stuck");
    expect(result.bounces).toBe(1);
  });

  it("fails open: missing worklog dir yields clean", () => {
    const result = runLoopCheck({ trackerRoot: join(tmpDir, "nonexistent", ".tracker") });
    expect(result.status).toBe("clean");
  });
});
