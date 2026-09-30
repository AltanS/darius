/**
 * Golden-file regression test for `tracker status`.
 *
 * Two test strategies:
 *
 * 1. **Fixture-based** (always runs): uses `test/fixtures/tracker-fixture/`
 *    which contains a controlled copy of M1 specs. This test is stable — it
 *    only breaks if the formatting logic changes.
 *
 * 2. **Repo-state** (skippable): runs the status command against the actual
 *    `.tracker/` in this repo and compares to the captured golden file at
 *    `test/fixtures/golden/tracker-status.md`. This test may need the golden
 *    file refreshed when the tracker evolves.
 *
 * To regenerate the repo golden file:
 *   cd /home/user/projects/agent-plugins
 *   node --experimental-strip-types --no-warnings \
 *     plugins/tracker/cli/bin/tracker.mts status \
 *     > plugins/tracker/cli/test/fixtures/golden/tracker-status.md
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readTrackerState, formatTrackerStatus } from "../lib/tracker-reader.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "fixtures");
const GOLDEN_DIR = resolve(FIXTURES_DIR, "golden");

// ---------------------------------------------------------------------------
// Fixture-based golden test (stable — uses controlled fixture dir)
// ---------------------------------------------------------------------------

describe("tracker status — fixture-based golden test", () => {
  it("matches the captured fixture golden file", () => {
    const fixtureTrackerRoot = resolve(FIXTURES_DIR, "tracker-fixture", ".tracker");
    const state = readTrackerState(fixtureTrackerRoot);
    const output = formatTrackerStatus(state);

    const goldenPath = join(GOLDEN_DIR, "fixture-tracker-status.md");
    const expected = readFileSync(goldenPath, "utf-8");

    expect(output).toBe(expected);
  });

  it("contains Progress Dashboard section", () => {
    const fixtureTrackerRoot = resolve(FIXTURES_DIR, "tracker-fixture", ".tracker");
    const state = readTrackerState(fixtureTrackerRoot);
    const output = formatTrackerStatus(state);

    expect(output).toContain("Progress Dashboard");
  });

  it("contains the current focus milestone", () => {
    const fixtureTrackerRoot = resolve(FIXTURES_DIR, "tracker-fixture", ".tracker");
    const state = readTrackerState(fixtureTrackerRoot);
    const output = formatTrackerStatus(state);

    expect(output).toContain("Current Focus: M1");
  });

  it("shows next task with correct format", () => {
    const fixtureTrackerRoot = resolve(FIXTURES_DIR, "tracker-fixture", ".tracker");
    const state = readTrackerState(fixtureTrackerRoot);
    const output = formatTrackerStatus(state);

    expect(output).toContain("**Next task:**");
    expect(output).toContain("01-research-recent-plugin-commits.md");
  });

  it("shows Waiting status for dependent specs", () => {
    const fixtureTrackerRoot = resolve(FIXTURES_DIR, "tracker-fixture", ".tracker");
    const state = readTrackerState(fixtureTrackerRoot);
    const output = formatTrackerStatus(state);

    expect(output).toContain("Waiting");
    expect(output).toContain("waiting on:");
  });
});

// ---------------------------------------------------------------------------
// Repo-state golden test (may need periodic golden file refresh)
// ---------------------------------------------------------------------------

describe.skip("tracker status — repo-state golden test (skip if .tracker evolves)", () => {
  it("matches the captured repo golden file", () => {
    // Walk up to find the real .tracker dir from the project root
    const projectRoot = resolve(__dirname, "..", "..", "..", "..", "..");
    const trackerRoot = resolve(projectRoot, ".tracker");

    const state = readTrackerState(trackerRoot);
    const output = formatTrackerStatus(state);

    const goldenPath = join(GOLDEN_DIR, "tracker-status.md");
    const expected = readFileSync(goldenPath, "utf-8");

    expect(output).toBe(expected);
  });
});
