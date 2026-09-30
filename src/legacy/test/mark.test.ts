/**
 * Tests for `tracker mark`.
 *
 * pnpm vitest run mark
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTracker, addMilestone, addSpec, markTask } from "../lib/tracker-writer.ts";
import { parseSpec } from "../lib/documents/spec.ts";
import { parseFrontmatter } from "../lib/markdown/frontmatter.ts";
import { hasVerificationPassed } from "../lib/uncommitted.ts";

const SAMPLE_SPEC = `---
status: Not Started
updated: 2026-01-01
agent: test
---

# My Spec

## Verification Checklist

### Implementation

- [ ] First task
- [ ] Second task
- [ ] Third task
`;

describe("mark", () => {
  let tmpDir: string;
  let trackerRoot: string;
  let specPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-mark-test-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    addMilestone({
      trackerRoot,
      name: "Test Milestone",
      slug: "test-milestone",
      owner: "dev@example.com",
    });

    // Write a spec manually with known checklist
    const milestonePath = join(trackerRoot, "M1-test-milestone");
    specPath = join(milestonePath, "01-my-spec.md");
    writeFileSync(specPath, SAMPLE_SPEC, "utf-8");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("marks task 0 as verified [x]", () => {
    markTask({ specPath, taskIndex: 0, state: "verified", trackerRoot });
    const content = readFileSync(specPath, "utf-8");
    expect(content).toContain("- [x] First task");
  });

  it("marks task 1 as in-progress [~]", () => {
    markTask({ specPath, taskIndex: 1, state: "in-progress", trackerRoot });
    const content = readFileSync(specPath, "utf-8");
    expect(content).toContain("- [~] Second task");
  });

  it("marks task 2 as blocked [!]", () => {
    markTask({ specPath, taskIndex: 2, state: "blocked", trackerRoot });
    const content = readFileSync(specPath, "utf-8");
    expect(content).toContain("- [!] Third task");
  });

  it("marks task as skipped [-]", () => {
    markTask({ specPath, taskIndex: 0, state: "skipped", trackerRoot });
    const content = readFileSync(specPath, "utf-8");
    expect(content).toContain("- [-] First task");
  });

  it("marks task as pending [ ]", () => {
    // First mark as verified then pending
    markTask({ specPath, taskIndex: 0, state: "verified", trackerRoot });
    markTask({ specPath, taskIndex: 0, state: "pending", trackerRoot });
    const content = readFileSync(specPath, "utf-8");
    expect(content).toContain("- [ ] First task");
  });

  it("updates the frontmatter `updated:` field to today", () => {
    markTask({ specPath, taskIndex: 0, state: "verified", trackerRoot });
    const raw = readFileSync(specPath, "utf-8");
    const { data } = parseFrontmatter(raw);
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    expect(data["updated"]).toBe(todayStr);
  });

  it("preserves other checklist items unchanged", () => {
    markTask({ specPath, taskIndex: 0, state: "verified", trackerRoot });
    const content = readFileSync(specPath, "utf-8");
    expect(content).toContain("- [ ] Second task");
    expect(content).toContain("- [ ] Third task");
  });

  it("throws when task index is out of range", () => {
    expect(() =>
      markTask({ specPath, taskIndex: 99, state: "verified", trackerRoot }),
    ).toThrow("out of range");
  });

  it("regenerates 00-INDEX.md after mark", () => {
    markTask({ specPath, taskIndex: 0, state: "verified", trackerRoot });
    const indexContent = readFileSync(join(trackerRoot, "00-INDEX.md"), "utf-8");
    expect(indexContent).toContain("Test Milestone");
  });

  // -------------------------------------------------------------------------
  // verification_passed stamp (issue #8, finding 2)
  // -------------------------------------------------------------------------

  it("verified writes a verification_passed stamp the commit-first gate reads", () => {
    markTask({ specPath, taskIndex: 0, state: "verified", trackerRoot });
    const raw = readFileSync(specPath, "utf-8");
    // The stamp the commit skill / uncommitted.ts gate keys on.
    expect(hasVerificationPassed(raw)).toBe(true);
    const { data } = parseFrontmatter(raw);
    expect(typeof data["verification_passed"]).toBe("string");
    expect(String(data["verification_passed"])).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
  });

  it("non-verified states do not add a verification_passed stamp", () => {
    markTask({ specPath, taskIndex: 0, state: "in-progress", trackerRoot });
    const raw = readFileSync(specPath, "utf-8");
    expect(hasVerificationPassed(raw)).toBe(false);
    const { data } = parseFrontmatter(raw);
    expect(data["verification_passed"]).toBeUndefined();
  });

  it("re-marking preserves the stamp and other frontmatter", () => {
    // Verify (stamps), then mark a different task in-progress.
    markTask({ specPath, taskIndex: 0, state: "verified", trackerRoot });
    const firstStamp = parseFrontmatter(readFileSync(specPath, "utf-8")).data[
      "verification_passed"
    ];
    expect(typeof firstStamp).toBe("string");

    markTask({ specPath, taskIndex: 1, state: "in-progress", trackerRoot });
    const raw = readFileSync(specPath, "utf-8");
    const { data } = parseFrontmatter(raw);

    // in-progress must not clear the existing stamp…
    expect(hasVerificationPassed(raw)).toBe(true);
    expect(data["verification_passed"]).toBe(firstStamp);
    // …and unrelated frontmatter keys survive intact.
    expect(data["agent"]).toBe("test");
    // A legacy `status:` is NOT preserved stale — it is synced to what the CLI
    // now computes from the same file (1 verified + 1 in-progress → In Progress).
    expect(data["status"]).toBe("In Progress");
    // Both markers landed.
    expect(raw).toContain("- [x] First task");
    expect(raw).toContain("- [~] Second task");
  });
});

// ---------------------------------------------------------------------------
// Drift at source: legacy derived frontmatter is synced, never preserved stale
// ---------------------------------------------------------------------------

const LEGACY_SPEC = `---
status: Not Started
verified: 0/3
updated: 2026-01-01
agent: test
---

# Legacy Spec

## Verification Checklist

### Implementation

- [ ] First task
- [ ] Second task
- [ ] Third task
`;

const CLEAN_SPEC = `---
updated: 2026-01-01
agent: test
---

# Clean Spec

## Verification Checklist

### Implementation

- [ ] First task
- [ ] Second task
`;

describe("mark — legacy derived-field sync", () => {
  let tmpDir: string;
  let trackerRoot: string;
  let milestonePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-mark-sync-test-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    addMilestone({
      trackerRoot,
      name: "Test Milestone",
      slug: "test-milestone",
      owner: "dev@example.com",
    });
    milestonePath = join(trackerRoot, "M1-test-milestone");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("syncs a stale legacy status/verified to the computed values", () => {
    const specPath = join(milestonePath, "01-legacy.md");
    writeFileSync(specPath, LEGACY_SPEC, "utf-8");

    markTask({ specPath, taskIndex: 0, state: "verified", trackerRoot });

    const { data } = parseFrontmatter(readFileSync(specPath, "utf-8"));
    expect(data["status"]).toBe("In Progress");
    expect(data["verified"]).toBe("1/3");
  });

  it("frontmatter agrees with the CLI's own computation after the write", () => {
    const specPath = join(milestonePath, "01-legacy.md");
    writeFileSync(specPath, LEGACY_SPEC, "utf-8");

    for (const idx of [0, 1, 2]) {
      markTask({ specPath, taskIndex: idx, state: "verified", trackerRoot });
    }

    const raw = readFileSync(specPath, "utf-8");
    const view = parseSpec(raw, specPath);
    const { data } = parseFrontmatter(raw);

    // The whole point: file and CLI can no longer disagree.
    expect(data["status"]).toBe(view.computedStatus);
    expect(data["status"]).toBe("Complete");
    expect(data["verified"]).toBe(`${view.verifiedCount}/${view.totalCount}`);
    expect(data["verified"]).toBe("3/3");
  });

  it("syncs in the OTHER direction too — an over-claiming status is corrected", () => {
    const overclaiming = LEGACY_SPEC.replace(
      "status: Not Started",
      "status: Complete",
    ).replace("verified: 0/3", "verified: 3/3");
    const specPath = join(milestonePath, "01-overclaim.md");
    writeFileSync(specPath, overclaiming, "utf-8");

    markTask({ specPath, taskIndex: 0, state: "in-progress", trackerRoot });

    const { data } = parseFrontmatter(readFileSync(specPath, "utf-8"));
    expect(data["status"]).toBe("In Progress");
    expect(data["verified"]).toBe("0/3");
  });

  it("does NOT introduce status/verified onto a spec that lacks them", () => {
    const specPath = join(milestonePath, "01-clean.md");
    writeFileSync(specPath, CLEAN_SPEC, "utf-8");

    markTask({ specPath, taskIndex: 0, state: "verified", trackerRoot });

    const { data } = parseFrontmatter(readFileSync(specPath, "utf-8"));
    expect(data["status"]).toBeUndefined();
    expect(data["verified"]).toBeUndefined();
    // The write still did its job.
    expect(readFileSync(specPath, "utf-8")).toContain("- [x] First task");
  });

  it("syncs `verified:` even when only that legacy field is present", () => {
    const verifiedOnly = LEGACY_SPEC.replace("status: Not Started\n", "");
    const specPath = join(milestonePath, "01-verified-only.md");
    writeFileSync(specPath, verifiedOnly, "utf-8");

    markTask({ specPath, taskIndex: 0, state: "verified", trackerRoot });

    const { data } = parseFrontmatter(readFileSync(specPath, "utf-8"));
    expect(data["verified"]).toBe("1/3");
    expect(data["status"]).toBeUndefined();
  });

  it("counts skipped items as not-verified but keeps the total", () => {
    const specPath = join(milestonePath, "01-legacy.md");
    writeFileSync(specPath, LEGACY_SPEC, "utf-8");

    markTask({ specPath, taskIndex: 0, state: "verified", trackerRoot });
    markTask({ specPath, taskIndex: 1, state: "skipped", trackerRoot });
    markTask({ specPath, taskIndex: 2, state: "skipped", trackerRoot });

    const { data } = parseFrontmatter(readFileSync(specPath, "utf-8"));
    expect(data["verified"]).toBe("1/3");
    // 1 verified + 2 skipped, nothing pending → terminal Complete.
    expect(data["status"]).toBe("Complete");
  });
});
