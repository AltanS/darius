/**
 * Tests for vigil reading + due/armed selection (the one-shot pending queue).
 *
 * pnpm exec vitest run test/vigil-due.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTracker, addVigil, closeVigil } from "../lib/tracker-writer.ts";
import { readTrackerState, selectDueVigils } from "../lib/tracker-reader.ts";

describe("vigil-due", () => {
  let tmpDir: string;
  let trackerRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-vigil-due-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads vigils into TrackerState", () => {
    addVigil({ trackerRoot, slug: "soak", name: "Soak", due: "2026-08-01", from: "M77/S02" });
    const state = readTrackerState(trackerRoot);
    expect(state.vigils).toHaveLength(1);
    expect(state.vigils[0]!.slug).toBe("soak");
    expect(state.vigils[0]!.due).toBe("2026-08-01");
    expect(state.vigils[0]!.from).toBe("M77/S02");
    expect(state.vigils[0]!.verdict).toBeNull();
  });

  it("partitions open vigils into due / armed and hides not-yet-due / closed", () => {
    // date gate already past → due
    addVigil({ trackerRoot, slug: "past-due", name: "Past", due: "2026-06-10" });
    // event gate only → armed
    addVigil({ trackerRoot, slug: "event-only", name: "Event", until: "first batch" });
    // future date, no event → hidden
    addVigil({ trackerRoot, slug: "future", name: "Future", due: "2999-01-01" });
    // closed → excluded entirely
    addVigil({ trackerRoot, slug: "done", name: "Done", due: "2026-06-10" });
    closeVigil({ trackerRoot, slug: "done", verdict: "held", date: "2026-06-12" });

    const state = readTrackerState(trackerRoot);
    const { due, armed } = selectDueVigils(state.vigils, "2026-06-15");

    expect(due.map((d) => d.slug)).toEqual(["past-due"]);
    expect(armed.map((a) => a.slug)).toEqual(["event-only"]);
    expect(due[0]!.daysOverdue).toBe(5);
  });

  it("treats a past due date as a backstop even when an until event is set", () => {
    addVigil({
      trackerRoot,
      slug: "backstop",
      name: "Backstop",
      due: "2026-06-10",
      until: "first batch",
    });
    const state = readTrackerState(trackerRoot);
    const { due, armed } = selectDueVigils(state.vigils, "2026-06-15");
    // Date fired → lands in `due`, not `armed`.
    expect(due.map((d) => d.slug)).toEqual(["backstop"]);
    expect(armed).toHaveLength(0);
  });

  it("sorts due most-overdue-first and armed oldest-opened-first", () => {
    addVigil({ trackerRoot, slug: "due-b", name: "B", due: "2026-06-14" }); // 1d overdue
    addVigil({ trackerRoot, slug: "due-a", name: "A", due: "2026-06-05" }); // 10d overdue
    addVigil({ trackerRoot, slug: "armed-new", name: "New", until: "x", opened: "2026-06-10" });
    addVigil({ trackerRoot, slug: "armed-old", name: "Old", until: "y", opened: "2026-06-01" });

    const state = readTrackerState(trackerRoot);
    const { due, armed } = selectDueVigils(state.vigils, "2026-06-15");

    expect(due.map((d) => d.slug)).toEqual(["due-a", "due-b"]);
    expect(armed.map((a) => a.slug)).toEqual(["armed-old", "armed-new"]);
  });
});
