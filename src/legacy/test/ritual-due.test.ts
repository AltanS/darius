/**
 * Tests for ritual reading + due selection (the "what's due" queue).
 *
 * pnpm exec vitest run test/ritual-due.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTracker, addRitual, completeRun } from "../lib/tracker-writer.ts";
import { readTrackerState, selectDueRituals } from "../lib/tracker-reader.ts";

describe("ritual-due", () => {
  let tmpDir: string;
  let trackerRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-ritual-due-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads rituals into TrackerState", () => {
    addRitual({ trackerRoot, name: "Bench", slug: "bench", cadence: "7d", due: "2026-06-22" });
    const state = readTrackerState(trackerRoot);
    expect(state.rituals).toHaveLength(1);
    expect(state.rituals[0]!.slug).toBe("bench");
    expect(state.rituals[0]!.cadence).toBe("7d");
    expect(state.rituals[0]!.due).toBe("2026-06-22");
    expect(state.rituals[0]!.lastRun).toBeNull();
  });

  it("selects only rituals due on/before today, most overdue first", () => {
    addRitual({ trackerRoot, name: "Overdue", slug: "overdue", cadence: "7d", due: "2026-06-10" });
    addRitual({ trackerRoot, name: "Due Today", slug: "due-today", cadence: "7d", due: "2026-06-15" });
    addRitual({ trackerRoot, name: "Future", slug: "future", cadence: "7d", due: "2026-06-30" });

    const state = readTrackerState(trackerRoot);
    const due = selectDueRituals(state.rituals, "2026-06-15");

    expect(due.map((d) => d.slug)).toEqual(["overdue", "due-today"]);
    expect(due[0]!.daysOverdue).toBe(5);
    expect(due[1]!.daysOverdue).toBe(0);
  });

  it("excludes dormant rituals (no due date)", () => {
    addRitual({ trackerRoot, name: "Ad Hoc", slug: "ad-hoc" });
    // an on-demand ritual defaults due to today, so complete it to make it dormant
    completeRun({ trackerRoot, slug: "ad-hoc", today: "2026-06-15" });

    const state = readTrackerState(trackerRoot);
    const due = selectDueRituals(state.rituals, "2026-06-20");
    expect(due).toHaveLength(0);
  });

  it("re-arms after completion only once the rolled due date arrives", () => {
    addRitual({ trackerRoot, name: "Bench", slug: "bench", cadence: "7d", due: "2026-06-15" });
    completeRun({ trackerRoot, slug: "bench", today: "2026-06-15" }); // next due 2026-06-22

    let state = readTrackerState(trackerRoot);
    expect(selectDueRituals(state.rituals, "2026-06-20")).toHaveLength(0);
    expect(selectDueRituals(state.rituals, "2026-06-22")).toHaveLength(1);
  });
});
