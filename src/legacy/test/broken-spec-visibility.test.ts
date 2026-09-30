/**
 * Tests for broken-spec visibility — the fix for the silent-drop bug where
 * a spec that failed to parse (most commonly `depends_on: [x.md]` inline
 * sequence syntax, which the strict frontmatter parser rejects) simply
 * vanished from readSpecs()'s output. That let a milestone report
 * "N/N Complete" while one of its N+1 real specs was never counted at all.
 *
 * These tests assert the spec is now surfaced (never silently dropped):
 *   - milestone.brokenSpecs carries it
 *   - deriveMilestoneStatus refuses to report Complete/Skipped while it exists
 *   - formatTrackerStatus lists it in a dedicated section
 *   - `tracker next` points at it instead of skipping past the milestone
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTrackerState, formatTrackerStatus, collectBrokenSpecs } from "../lib/tracker-reader.ts";
import { initTracker, addMilestone } from "../lib/tracker-writer.ts";

const COMPLETE_SPEC = `---
updated: 2026-06-10
---

# Spec

- [x] done one
`;

// Inline `[...]` sequence — rejected by the strict frontmatter parser.
const BROKEN_SPEC = `---
updated: 2026-06-10
depends_on: [01-first.md]
---

# Broken Spec

- [ ] not done
`;

describe("broken specs are never silently dropped", () => {
  let tmpDir: string;
  let trackerRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-broken-spec-test-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    addMilestone({ trackerRoot, name: "Demo", slug: "demo", owner: "dev" });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSpec(fileName: string, body: string): void {
    writeFileSync(join(trackerRoot, "M1-demo", fileName), body, "utf-8");
  }

  it("records the broken spec on the milestone instead of dropping it", () => {
    writeSpec("01-first.md", COMPLETE_SPEC);
    writeSpec("02-second.md", BROKEN_SPEC);

    const state = readTrackerState(trackerRoot);
    const m = state.milestones[0]!;

    expect(m.specs.map((s) => s.file)).toEqual(["01-first.md"]);
    expect(m.brokenSpecs).toHaveLength(1);
    expect(m.brokenSpecs[0]!.file).toBe("02-second.md");
    expect(m.brokenSpecs[0]!.error).toContain("Inline non-empty sequences");
  });

  it("never reports Complete while a spec in the milestone is broken", () => {
    writeSpec("01-first.md", COMPLETE_SPEC);
    writeSpec("02-second.md", BROKEN_SPEC);

    const state = readTrackerState(trackerRoot);
    const m = state.milestones[0]!;

    // Before the fix: all *parsed* specs were terminal (1/1 complete), so
    // the milestone reported "Complete" — the exact M262 false-positive.
    expect(m.status).not.toBe("Complete");
    expect(m.status).toBe("In Progress");
  });

  it("a milestone with only a broken spec is not Not Started", () => {
    writeSpec("01-broken.md", BROKEN_SPEC);

    const state = readTrackerState(trackerRoot);
    expect(state.milestones[0]!.status).toBe("In Progress");
  });

  it("formatTrackerStatus lists broken specs in a dedicated section", () => {
    writeSpec("01-first.md", COMPLETE_SPEC);
    writeSpec("02-second.md", BROKEN_SPEC);

    const state = readTrackerState(trackerRoot);
    const output = formatTrackerStatus(state);

    expect(output).toContain("Broken Specs");
    expect(output).toContain("02-second.md");
    // The dashboard's Status column must not claim Complete while a spec
    // in the milestone is broken, even though its parsed-only 1/1 count
    // looks finished — that's the exact false-positive this fix closes.
    expect(output).not.toMatch(/\| M1 \|.*\| Complete \|/);
  });

  it("formatTrackerStatus omits the broken-specs section when nothing is broken", () => {
    writeSpec("01-first.md", COMPLETE_SPEC);

    const state = readTrackerState(trackerRoot);
    const output = formatTrackerStatus(state);

    expect(output).not.toContain("Broken Specs");
  });

  it("collectBrokenSpecs flattens across milestones with milestone slug attached", () => {
    writeSpec("01-first.md", COMPLETE_SPEC);
    writeSpec("02-second.md", BROKEN_SPEC);

    const state = readTrackerState(trackerRoot);
    const broken = collectBrokenSpecs(state);

    expect(broken).toEqual([
      {
        milestoneSlug: "M1-demo",
        file: "02-second.md",
        error: expect.stringContaining("Inline non-empty sequences"),
      },
    ]);
  });

  it("`tracker next` points at the broken spec instead of skipping past the milestone", () => {
    writeSpec("01-first.md", COMPLETE_SPEC);
    writeSpec("02-second.md", BROKEN_SPEC);

    const result = spawnSync(
      "node",
      ["--experimental-strip-types", "--no-warnings", join(process.cwd(), "bin/tracker.mts"), "next"],
      { encoding: "utf-8", cwd: tmpDir, timeout: 30_000 },
    );

    // Before the fix: the milestone read as "Complete" (1/1 parsed specs
    // terminal), so `next` skipped it and reported "All tasks complete".
    expect(result.stdout).toContain("02-second.md");
    expect(result.stdout).not.toContain("All tasks complete");
  });
});
