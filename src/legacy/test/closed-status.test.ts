/**
 * Tests for issue #5 — `status: Closed` as a terminal milestone status.
 *
 * Covers:
 *   - README frontmatter `status: Closed` overrides the spec rollup.
 *   - Closed is terminal: excluded from Current Focus and `next`.
 *   - Unrecognized `status:` values warn on stderr instead of silently
 *     falling through; recognized non-terminal values stay silent.
 *   - `setStatus` accepts Closed/Deferred/Skipped for milestone folders
 *     but rejects them for spec files.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readTrackerState,
  formatTrackerStatus,
  isTerminalMilestone,
} from "../lib/tracker-reader.ts";
import { initTracker, addMilestone, setStatus } from "../lib/tracker-writer.ts";
import { withReadmeStatus } from "./helpers/readme-status.ts";

describe("milestone status: Closed", () => {
  let tmpDir: string;
  let trackerRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-closed-test-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function setupMilestone(slug: string, name: string): string {
    addMilestone({ trackerRoot, name, slug, owner: "dev" });
    const state = readTrackerState(trackerRoot);
    return state.milestones[state.milestones.length - 1]!.slug;
  }

  function setReadmeStatus(milestoneSlug: string, status: string): void {
    const readmePath = join(trackerRoot, milestoneSlug, "00-README.md");
    const existing = readFileSync(readmePath, "utf-8");
    writeFileSync(readmePath, withReadmeStatus(existing, status), "utf-8");
  }

  function writeSpec(milestoneSlug: string, fileName: string, body: string): void {
    writeFileSync(join(trackerRoot, milestoneSlug, fileName), body, "utf-8");
  }

  const HALF_DONE_SPEC = `---
updated: 2026-06-10
---

# Spec

- [x] done one
- [ ] still pending
`;

  it("README `status: Closed` overrides the rollup and is terminal", () => {
    const slug = setupMilestone("closed-work", "Closed Work");
    setReadmeStatus(slug, "Closed");
    writeSpec(slug, "01-spec.md", HALF_DONE_SPEC);

    const state = readTrackerState(trackerRoot);
    const m = state.milestones[0]!;
    expect(m.status).toBe("Closed");
    expect(isTerminalMilestone(m.status)).toBe(true);
  });

  it("Closed milestone is not the Current Focus", () => {
    const first = setupMilestone("first", "First (closed)");
    setupMilestone("second", "Second (active)");
    setReadmeStatus(first, "Closed");
    writeSpec(first, "01-spec.md", HALF_DONE_SPEC);
    writeSpec("M2-second", "01-spec.md", HALF_DONE_SPEC);

    const state = readTrackerState(trackerRoot);
    const output = formatTrackerStatus(state);
    expect(output).toContain("Current Focus: M2");
    expect(output).not.toContain("Current Focus: M1");
  });

  it("unrecognized status value warns on stderr and falls back to rollup", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const slug = setupMilestone("typo", "Typo Status");
    setReadmeStatus(slug, "Abandoned");
    writeSpec(slug, "01-spec.md", HALF_DONE_SPEC);

    const state = readTrackerState(trackerRoot);
    expect(state.milestones[0]?.status).toBe("In Progress");
    const warnings = stderrSpy.mock.calls.map((c) => String(c[0]));
    expect(warnings.some((w) => w.includes('unrecognized milestone status "Abandoned"'))).toBe(
      true,
    );
  });

  it("recognized non-terminal statuses (template default) do not warn", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const slug = setupMilestone("fresh", "Fresh Milestone");
    // Template writes `status: Not Started`; also exercise In Progress.
    setReadmeStatus(slug, "In Progress");
    writeSpec(slug, "01-spec.md", HALF_DONE_SPEC);

    const state = readTrackerState(trackerRoot);
    expect(state.milestones[0]?.status).toBe("In Progress");
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("setStatus writes Closed to a milestone folder README", () => {
    const slug = setupMilestone("close-me", "Close Me");
    writeSpec(slug, "01-spec.md", HALF_DONE_SPEC);

    setStatus({ target: join(trackerRoot, slug), status: "Closed", trackerRoot });

    const state = readTrackerState(trackerRoot);
    expect(state.milestones[0]?.status).toBe("Closed");
  });

  it("setStatus rejects Closed for a spec file", () => {
    const slug = setupMilestone("spec-target", "Spec Target");
    writeSpec(slug, "01-spec.md", HALF_DONE_SPEC);

    expect(() =>
      setStatus({
        target: join(trackerRoot, slug, "01-spec.md"),
        status: "Closed",
        trackerRoot,
      }),
    ).toThrow(/Invalid status/);
  });
});
