/**
 * Tests for Work Loop stage tracking on worklog threads.
 *
 * Covers: stage round-trip serialization, forward-only transition rules,
 * dispatch/park sugar, legacy (stage-less) thread back-compat.
 *
 * pnpm vitest run worklog-stage
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTracker } from "../lib/tracker-writer.ts";
import {
  openThread,
  closeThread,
  listThreads,
  setStage,
  dispatchThread,
  parkThread,
} from "../lib/worklog.ts";

/** Evidence is not the subject of these tests: skip it the sanctioned way. */
const FORCE = { force: true, reason: "test without evidence" } as const;

describe("worklog stage", () => {
  let tmpDir: string;
  let trackerRoot: string;
  let worklogDir: string;
  let worklogPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-stage-test-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    worklogDir = join(trackerRoot, "worklog");
    worklogPath = join(worklogDir, "m5-test.md");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // round-trip
  // -------------------------------------------------------------------------

  it("round-trips stage through serialize/parse", () => {
    const threadId = openThread({ worklogPath, slug: "stage-rt", stage: "planned" });

    const raw = readFileSync(worklogPath, "utf-8");
    expect(raw).toContain("<!-- stage: planned -->");

    const threads = listThreads({ trackerRoot });
    expect(threads).toHaveLength(1);
    expect(threads[0]?.threadId).toBe(threadId);
    expect(threads[0]?.stage).toBe("planned");
  });

  it("opens without stage by default (legacy behavior unchanged)", () => {
    openThread({ worklogPath, slug: "no-stage" });

    const raw = readFileSync(worklogPath, "utf-8");
    expect(raw).not.toContain("<!-- stage:");

    const threads = listThreads({ trackerRoot });
    expect(threads[0]?.stage).toBeUndefined();
  });

  it("reads legacy worklog files and re-serializes without introducing stage lines", () => {
    mkdirSync(worklogDir, { recursive: true });
    const legacy = [
      "## 01LEGACY-old-thread — old-thread",
      "<!-- opened: 2026-01-01T00:00:00.000Z -->",
      "<!-- spec: .tracker/M2-x/01-y.md -->",
      "### 2026-01-01T00:00:00.000Z [note]",
      "an old note",
      "",
    ].join("\n");
    writeFileSync(worklogPath, legacy);

    // A write through the API must not add stage to the legacy thread
    openThread({ worklogPath, slug: "new-thread", stage: "planned" });

    const raw = readFileSync(worklogPath, "utf-8");
    const legacyBlock = raw.slice(0, raw.indexOf("## 01"));
    expect(raw.indexOf("<!-- stage: planned -->")).toBeGreaterThan(
      raw.indexOf("new-thread"),
    );
    expect(legacyBlock).not.toContain("<!-- stage:");

    const threads = listThreads({ trackerRoot });
    const old = threads.find((t) => t.threadId === "01LEGACY-old-thread");
    expect(old?.stage).toBeUndefined();
  });

  it("ignores unknown stage values when parsing", () => {
    mkdirSync(worklogDir, { recursive: true });
    writeFileSync(
      worklogPath,
      [
        "## 01BAD-thread — thread",
        "<!-- opened: 2026-01-01T00:00:00.000Z -->",
        "<!-- stage: bogus -->",
        "",
      ].join("\n"),
    );

    const threads = listThreads({ trackerRoot });
    expect(threads[0]?.stage).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // transitions
  // -------------------------------------------------------------------------

  it("transition: forward path planned → dispatched → verified → committed → reviewed (forced)", () => {
    const threadId = openThread({ worklogPath, slug: "fwd", stage: "planned" });

    setStage({ worklogPath, threadId, stage: "dispatched" });
    setStage({ worklogPath, threadId, stage: "verified", ...FORCE });
    setStage({ worklogPath, threadId, stage: "committed", ...FORCE });
    setStage({ worklogPath, threadId, stage: "reviewed", ...FORCE });

    expect(listThreads({ trackerRoot })[0]?.stage).toBe("reviewed");
  });

  it("transition: same-stage is an idempotent no-op", () => {
    const threadId = openThread({ worklogPath, slug: "idem", stage: "planned" });

    setStage({ worklogPath, threadId, stage: "dispatched" });
    expect(() => setStage({ worklogPath, threadId, stage: "dispatched" })).not.toThrow();
    expect(listThreads({ trackerRoot })[0]?.stage).toBe("dispatched");
  });

  it("transition: backward is rejected", () => {
    const threadId = openThread({ worklogPath, slug: "back", stage: "planned" });
    setStage({ worklogPath, threadId, stage: "verified", ...FORCE });

    expect(() => setStage({ worklogPath, threadId, stage: "dispatched" })).toThrow(
      /Backward stage transition/,
    );
    expect(listThreads({ trackerRoot })[0]?.stage).toBe("verified");
  });

  it("transition: unset stage accepts a first stamp up to dispatched, and refuses a skip to committed", () => {
    const threadId = openThread({ worklogPath, slug: "first-stamp" });

    expect(() => setStage({ worklogPath, threadId, stage: "committed" })).toThrow(/skips verified/);
    setStage({ worklogPath, threadId, stage: "dispatched" });
    expect(listThreads({ trackerRoot })[0]?.stage).toBe("dispatched");
  });

  it("transition: closed thread rejects stage changes", () => {
    const threadId = openThread({ worklogPath, slug: "closed", stage: "planned" });
    closeThread({ worklogPath, threadId, status: "done" });

    expect(() => setStage({ worklogPath, threadId, stage: "dispatched" })).toThrow(
      /closed/,
    );
  });

  it("transition: unknown thread throws", () => {
    openThread({ worklogPath, slug: "exists", stage: "planned" });

    expect(() =>
      setStage({ worklogPath, threadId: "01NOPE-missing", stage: "dispatched" }),
    ).toThrow(/not found/);
  });

  // -------------------------------------------------------------------------
  // dispatch / park sugar
  // -------------------------------------------------------------------------

  it("dispatch stamps dispatched and appends the Agent selected note", () => {
    const threadId = openThread({ worklogPath, slug: "disp", stage: "planned" });

    dispatchThread({
      worklogPath,
      threadId,
      agent: "typescript:typescript-expert",
      reason: "TS CLI work matches agent description",
    });

    const raw = readFileSync(worklogPath, "utf-8");
    expect(raw).toContain("<!-- stage: dispatched -->");
    expect(raw).toContain(
      "Agent selected: typescript:typescript-expert — TS CLI work matches agent description",
    );
  });

  it("dispatch without reason records the agent only", () => {
    const threadId = openThread({ worklogPath, slug: "disp-bare", stage: "planned" });

    dispatchThread({ worklogPath, threadId, agent: "Explore" });

    const raw = readFileSync(worklogPath, "utf-8");
    expect(raw).toContain("Agent selected: Explore");
    expect(raw).not.toContain("Agent selected: Explore —");
  });

  it("dispatch is idempotent at dispatched but rejects later stages and closed threads", () => {
    const threadId = openThread({ worklogPath, slug: "disp-rules", stage: "planned" });

    dispatchThread({ worklogPath, threadId, agent: "a" });
    expect(() => dispatchThread({ worklogPath, threadId, agent: "b" })).not.toThrow();

    setStage({ worklogPath, threadId, stage: "verified", ...FORCE });
    expect(() => dispatchThread({ worklogPath, threadId, agent: "c" })).toThrow(
      /Backward stage transition/,
    );

    const other = openThread({ worklogPath, slug: "disp-closed", stage: "planned" });
    closeThread({ worklogPath, threadId: other, status: "cancelled" });
    expect(() => dispatchThread({ worklogPath, threadId: other, agent: "d" })).toThrow(
      /closed/,
    );
  });

  it("park appends the reason and closes the thread as blocked", () => {
    const threadId = openThread({ worklogPath, slug: "park", stage: "dispatched" });

    parkThread({ worklogPath, threadId, reason: "blocked on upstream API decision" });

    const threads = listThreads({ trackerRoot });
    expect(threads[0]?.closedAt).toBeDefined();
    expect(threads[0]?.closeStatus).toBe("blocked");

    const raw = readFileSync(worklogPath, "utf-8");
    expect(raw).toContain("Parked: blocked on upstream API decision");
  });

  it("park requires a non-empty reason and an open thread", () => {
    const threadId = openThread({ worklogPath, slug: "park-rules", stage: "planned" });

    expect(() => parkThread({ worklogPath, threadId, reason: "   " })).toThrow(
      /non-empty reason/,
    );

    parkThread({ worklogPath, threadId, reason: "real reason" });
    expect(() => parkThread({ worklogPath, threadId, reason: "again" })).toThrow(
      /already closed/,
    );
  });
});
