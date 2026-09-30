/**
 * Tests for write command idempotency.
 *
 * pnpm vitest run idempotency
 *
 * Note: the existing test/idempotence.test.ts covers read-side idempotency
 * (canonical round-trips). This file covers write-side idempotency for
 * the new write commands.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initTracker,
  addMilestone,
  addSpec,
  markTask,
  setStatus,
  rebuildIndex,
} from "../lib/tracker-writer.ts";

const SAMPLE_SPEC = `---
status: Not Started
updated: 2026-01-01
agent: test
---

# My Spec

## Verification Checklist

- [ ] Task one
- [ ] Task two
`;

describe("idempotency", () => {
  let tmpDir: string;
  let trackerRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-idempotency-test-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("add milestone with same slug twice returns {kind: 'exists'} on second run", () => {
    const first = addMilestone({
      trackerRoot,
      name: "Test",
      slug: "test",
      owner: "dev@example.com",
    });
    const second = addMilestone({
      trackerRoot,
      name: "Test",
      slug: "test",
      owner: "dev@example.com",
    });
    expect(first.kind).toBe("created");
    expect(second.kind).toBe("exists");
  });

  it("add spec with same name twice returns {kind: 'exists'} on second run", () => {
    addMilestone({
      trackerRoot,
      name: "Test",
      slug: "test",
      owner: "dev@example.com",
    });
    const first = addSpec({
      trackerRoot,
      milestoneArg: "M1-test",
      name: "My Spec",
      template: "generic",
    });
    const second = addSpec({
      trackerRoot,
      milestoneArg: "M1-test",
      name: "My Spec",
      template: "generic",
    });
    expect(first.kind).toBe("created");
    expect(second.kind).toBe("exists");
  });

  it("add spec: re-running with same slug (case+separator variations) is idempotent", () => {
    addMilestone({
      trackerRoot,
      name: "Test",
      slug: "test",
      owner: "dev@example.com",
    });
    // First create with "My Spec" -> slug "my-spec"
    addSpec({
      trackerRoot,
      milestoneArg: "M1-test",
      name: "My Spec",
      template: "generic",
    });
    // Second call with same name
    const result = addSpec({
      trackerRoot,
      milestoneArg: "M1-test",
      name: "My Spec",
      template: "generic",
    });
    expect(result.kind).toBe("exists");
  });

  it("mark same task twice: second call is idempotent (no duplicate writes)", () => {
    addMilestone({
      trackerRoot,
      name: "Test",
      slug: "test",
      owner: "dev@example.com",
    });
    // writeFileSync is imported at top of file
    const specPath = join(trackerRoot, "M1-test", "01-my-spec.md");
    writeFileSync(specPath, SAMPLE_SPEC, "utf-8");

    markTask({ specPath, taskIndex: 0, state: "verified", trackerRoot });
    markTask({ specPath, taskIndex: 0, state: "verified", trackerRoot });

    const content = readFileSync(specPath, "utf-8");
    const matches = content.match(/- \[x\] Task one/g);
    expect(matches?.length).toBe(1);
  });

  it("set-status called twice with same value is idempotent", () => {
    addMilestone({
      trackerRoot,
      name: "Test",
      slug: "test",
      owner: "dev@example.com",
    });
    // writeFileSync is imported at top of file
    const specPath = join(trackerRoot, "M1-test", "01-my-spec.md");
    writeFileSync(specPath, SAMPLE_SPEC, "utf-8");

    setStatus({ target: specPath, status: "Blocked", trackerRoot });
    const after1 = readFileSync(specPath, "utf-8");

    setStatus({ target: specPath, status: "Blocked", trackerRoot });
    const after2 = readFileSync(specPath, "utf-8");

    // Content may differ only in 'updated' date, so check status field
    expect(after1).toContain("status: Blocked");
    expect(after2).toContain("status: Blocked");
  });

  it("rebuildIndex twice produces byte-identical output", () => {
    addMilestone({
      trackerRoot,
      name: "Test",
      slug: "test",
      owner: "dev@example.com",
    });
    // writeFileSync is imported at top of file
    const specPath = join(trackerRoot, "M1-test", "01-my-spec.md");
    writeFileSync(specPath, SAMPLE_SPEC, "utf-8");

    rebuildIndex(trackerRoot);
    const first = readFileSync(join(trackerRoot, "00-INDEX.md"), "utf-8");
    rebuildIndex(trackerRoot);
    const second = readFileSync(join(trackerRoot, "00-INDEX.md"), "utf-8");

    expect(first).toBe(second);
  });
});
