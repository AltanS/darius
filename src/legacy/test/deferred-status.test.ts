/**
 * Tests for issue #2 — deferred milestone status and skipped-item rollup.
 *
 * Covers:
 *   - Checklist parser recognizes `[-]`, `[~]`, `[!]` markers and sets state.
 *   - Spec with all `[-]` items rolls up to `Skipped` (not `Not Started`).
 *   - Milestone with Complete + Skipped specs rolls up to `Complete`
 *     (not `In Progress`) and is treated as terminal.
 *   - README frontmatter `status: Deferred` overrides the rollup.
 *   - Skipped/Deferred milestones are excluded from "Current Focus".
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseChecklist } from "../lib/markdown/checklist.ts";
import { parseSpec } from "../lib/documents/spec.ts";
import {
  readTrackerState,
  formatTrackerStatus,
  isTerminalMilestone,
} from "../lib/tracker-reader.ts";
import { initTracker, addMilestone, rebuildIndex } from "../lib/tracker-writer.ts";
import { withReadmeStatus } from "./helpers/readme-status.ts";
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Checklist parser — all five markers
// ---------------------------------------------------------------------------

describe("checklist parser — all marker states", () => {
  it("parses `[ ]` as pending", () => {
    const items = parseChecklist("- [ ] task");
    expect(items[0]?.state).toBe("pending");
    expect(items[0]?.checked).toBe(false);
  });

  it("parses `[x]` as verified", () => {
    const items = parseChecklist("- [x] task");
    expect(items[0]?.state).toBe("verified");
    expect(items[0]?.checked).toBe(true);
  });

  it("parses `[X]` as verified (case-insensitive)", () => {
    const items = parseChecklist("- [X] task");
    expect(items[0]?.state).toBe("verified");
    expect(items[0]?.checked).toBe(true);
  });

  it("parses `[~]` as in_progress", () => {
    const items = parseChecklist("- [~] task");
    expect(items[0]?.state).toBe("in_progress");
    expect(items[0]?.checked).toBe(false);
  });

  it("parses `[!]` as blocked", () => {
    const items = parseChecklist("- [!] task");
    expect(items[0]?.state).toBe("blocked");
    expect(items[0]?.checked).toBe(false);
  });

  it("parses `[-]` as skipped", () => {
    const items = parseChecklist("- [-] task");
    expect(items[0]?.state).toBe("skipped");
    expect(items[0]?.checked).toBe(false);
  });

  it("parses a mixed checklist with all five marker types", () => {
    const body = [
      "- [ ] pending task",
      "- [x] verified task",
      "- [~] in-progress task",
      "- [!] blocked task",
      "- [-] skipped task",
    ].join("\n");
    const items = parseChecklist(body);
    expect(items).toHaveLength(5);
    expect(items.map((i) => i.state)).toEqual([
      "pending",
      "verified",
      "in_progress",
      "blocked",
      "skipped",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Spec status rollup with skipped items
// ---------------------------------------------------------------------------

describe("spec computedStatus — skipped rollup", () => {
  it("all `[-]` items → status Skipped (not Not Started)", () => {
    const raw = `---
updated: 2026-05-17
---

# Skipped Spec

- [-] item one
- [-] item two
- [-] item three
`;
    const view = parseSpec(raw, "/fake/01-spec.md");
    expect(view.computedStatus).toBe("Skipped");
    expect(view.skippedCount).toBe(3);
    expect(view.verifiedCount).toBe(0);
    expect(view.totalCount).toBe(3);
  });

  it("mix of `[x]` and `[-]` → status Complete (terminal)", () => {
    const raw = `---
updated: 2026-05-17
---

# Mixed Spec

- [x] verified one
- [-] skipped two
- [-] skipped three
`;
    const view = parseSpec(raw, "/fake/01-spec.md");
    expect(view.computedStatus).toBe("Complete");
  });

  it("`[~]` items make spec In Progress", () => {
    const raw = `---
updated: 2026-05-17
---

# Active Spec

- [~] in progress
- [ ] pending
`;
    const view = parseSpec(raw, "/fake/01-spec.md");
    expect(view.computedStatus).toBe("In Progress");
    expect(view.inProgressCount).toBe(1);
  });

  it("`[!]` items make spec Blocked", () => {
    const raw = `---
updated: 2026-05-17
---

# Blocked Spec

- [!] blocked item
- [ ] pending item
`;
    const view = parseSpec(raw, "/fake/01-spec.md");
    expect(view.computedStatus).toBe("Blocked");
    expect(view.blockedCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Milestone rollup — Skipped specs and Deferred override
// ---------------------------------------------------------------------------

describe("milestone deriveStatus — repro from issue #2", () => {
  let tmpDir: string;
  let trackerRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-deferred-test-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSpec(milestoneSlug: string, fileName: string, body: string): void {
    writeFileSync(join(trackerRoot, milestoneSlug, fileName), body, "utf-8");
  }

  it("Complete + all-Skipped specs → milestone Complete (was: In Progress)", () => {
    addMilestone({
      trackerRoot,
      name: "Multi-Source Fallback",
      slug: "fallback",
      owner: "dev",
    });

    writeSpec(
      "M1-fallback",
      "01-investigation.md",
      `---
updated: 2026-05-17
---

# Investigation

- [x] finding documented
- [x] reviewed
`,
    );
    writeSpec(
      "M1-fallback",
      "02-implementation.md",
      `---
updated: 2026-05-17
---

# Implementation

- [-] step one (no longer needed)
- [-] step two (no longer needed)
`,
    );

    const state = readTrackerState(trackerRoot);
    const m = state.milestones[0]!;
    expect(m.specs).toHaveLength(2);
    expect(m.specs[0]?.view.computedStatus).toBe("Complete");
    expect(m.specs[1]?.view.computedStatus).toBe("Skipped");
    expect(m.status).toBe("Complete");
    expect(isTerminalMilestone(m.status)).toBe(true);
  });

  it("all-Skipped specs → milestone Skipped", () => {
    addMilestone({
      trackerRoot,
      name: "Abandoned Idea",
      slug: "abandoned",
      owner: "dev",
    });
    writeSpec(
      "M1-abandoned",
      "01-spec.md",
      `---
updated: 2026-05-17
---

# Abandoned

- [-] don't do this
- [-] don't do that
`,
    );

    const state = readTrackerState(trackerRoot);
    expect(state.milestones[0]?.status).toBe("Skipped");
    expect(isTerminalMilestone(state.milestones[0]!.status)).toBe(true);
  });

  it("README `status: Deferred` overrides rollup", () => {
    addMilestone({
      trackerRoot,
      name: "Deferred Work",
      slug: "deferred-work",
      owner: "dev",
    });

    const readmePath = join(trackerRoot, "M1-deferred-work", "00-README.md");
    const existing = readFileSync(readmePath, "utf-8");
    writeFileSync(
      readmePath,
      withReadmeStatus(existing, "Deferred"),
      "utf-8",
    );

    writeSpec(
      "M1-deferred-work",
      "01-active.md",
      `---
updated: 2026-05-17
---

# Active Spec (but milestone is Deferred)

- [x] item one
- [ ] item two
- [ ] item three
`,
    );

    const state = readTrackerState(trackerRoot);
    const m = state.milestones[0]!;
    expect(m.status).toBe("Deferred");
    expect(isTerminalMilestone(m.status)).toBe(true);
  });

  it("terminal milestone is not the Current Focus", () => {
    addMilestone({
      trackerRoot,
      name: "First (deferred)",
      slug: "first",
      owner: "dev",
    });
    addMilestone({
      trackerRoot,
      name: "Second (active)",
      slug: "second",
      owner: "dev",
    });

    // Defer M1 via README
    const m1Readme = join(trackerRoot, "M1-first", "00-README.md");
    const existing = readFileSync(m1Readme, "utf-8");
    writeFileSync(
      m1Readme,
      withReadmeStatus(existing, "Deferred"),
      "utf-8",
    );
    writeSpec(
      "M1-first",
      "01-spec.md",
      `---
updated: 2026-05-17
---

# Deferred spec

- [x] item
`,
    );
    writeSpec(
      "M2-second",
      "01-spec.md",
      `---
updated: 2026-05-17
---

# Active spec

- [ ] item to do
`,
    );

    const state = readTrackerState(trackerRoot);
    const output = formatTrackerStatus(state);
    expect(output).toContain("Current Focus: M2");
    expect(output).not.toContain("Current Focus: M1");
  });

  it("rebuilt index treats Deferred milestone as terminal", () => {
    addMilestone({
      trackerRoot,
      name: "Deferred",
      slug: "deferred",
      owner: "dev",
    });
    const readmePath = join(trackerRoot, "M1-deferred", "00-README.md");
    const existing = readFileSync(readmePath, "utf-8");
    writeFileSync(
      readmePath,
      withReadmeStatus(existing, "Deferred"),
      "utf-8",
    );
    writeSpec(
      "M1-deferred",
      "01-spec.md",
      `---
updated: 2026-05-17
---

# Spec

- [x] done one
- [ ] still pending
`,
    );

    rebuildIndex(trackerRoot);
    const indexContent = readFileSync(join(trackerRoot, "00-INDEX.md"), "utf-8");
    expect(indexContent).toContain("| Deferred |");
    // No Current Focus pointer for the terminal milestone — fallback message
    expect(indexContent).toContain("All milestones complete");
  });
});
