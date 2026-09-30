/**
 * Tests for `tracker set-status`.
 *
 * pnpm vitest run set-status
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTracker, addMilestone, addSpec, setStatus } from "../lib/tracker-writer.ts";
import { parseFrontmatter } from "../lib/markdown/frontmatter.ts";

const SAMPLE_SPEC = `---
status: Not Started
updated: 2026-01-01
agent: test
---

# My Spec

## Verification Checklist

- [ ] A task
`;

describe("set-status", () => {
  let tmpDir: string;
  let trackerRoot: string;
  let specPath: string;
  let milestonePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-set-status-test-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    addMilestone({
      trackerRoot,
      name: "Test Milestone",
      slug: "test-milestone",
      owner: "dev@example.com",
    });

    milestonePath = join(trackerRoot, "M1-test-milestone");
    specPath = join(milestonePath, "01-my-spec.md");
    writeFileSync(specPath, SAMPLE_SPEC, "utf-8");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("sets status to In Progress on a spec file", () => {
    setStatus({ target: specPath, status: "In Progress", trackerRoot });
    const raw = readFileSync(specPath, "utf-8");
    const { data } = parseFrontmatter(raw);
    expect(data["status"]).toBe("In Progress");
  });

  it("sets status to Complete on a spec file", () => {
    setStatus({ target: specPath, status: "Complete", trackerRoot });
    const raw = readFileSync(specPath, "utf-8");
    const { data } = parseFrontmatter(raw);
    expect(data["status"]).toBe("Complete");
  });

  it("sets status to Blocked on a spec file", () => {
    setStatus({ target: specPath, status: "Blocked", trackerRoot });
    const raw = readFileSync(specPath, "utf-8");
    const { data } = parseFrontmatter(raw);
    expect(data["status"]).toBe("Blocked");
  });

  it("sets status to Archived on a milestone folder", () => {
    setStatus({ target: milestonePath, status: "Archived", trackerRoot });
    const raw = readFileSync(join(milestonePath, "00-README.md"), "utf-8");
    const { data } = parseFrontmatter(raw);
    expect(data["status"]).toBe("Archived");
  });

  it("sets status on milestone 00-README.md when folder is provided", () => {
    setStatus({ target: milestonePath, status: "Complete", trackerRoot });
    const raw = readFileSync(join(milestonePath, "00-README.md"), "utf-8");
    const { data } = parseFrontmatter(raw);
    expect(data["status"]).toBe("Complete");
  });

  it("throws on invalid status value", () => {
    expect(() =>
      setStatus({ target: specPath, status: "InvalidStatus" as any, trackerRoot }),
    ).toThrow("Invalid status");
  });

  it("regenerates 00-INDEX.md after set-status", () => {
    setStatus({ target: specPath, status: "Blocked", trackerRoot });
    const indexContent = readFileSync(join(trackerRoot, "00-INDEX.md"), "utf-8");
    expect(indexContent).toContain("Test Milestone");
  });

  it("preserves body content after status change", () => {
    setStatus({ target: specPath, status: "In Progress", trackerRoot });
    const content = readFileSync(specPath, "utf-8");
    expect(content).toContain("My Spec");
    expect(content).toContain("A task");
  });

  // -------------------------------------------------------------------------
  // Drift at source: `verified:` is derived and must not survive stale
  // -------------------------------------------------------------------------

  it("syncs a stale legacy `verified:` to the computed count", () => {
    writeFileSync(
      specPath,
      SAMPLE_SPEC.replace("status: Not Started", "status: Not Started\nverified: 7/9"),
      "utf-8",
    );

    setStatus({ target: specPath, status: "In Progress", trackerRoot });

    const { data } = parseFrontmatter(readFileSync(specPath, "utf-8"));
    // One unchecked item in SAMPLE_SPEC → 0/1, not the invented 7/9.
    expect(data["verified"]).toBe("0/1");
    // The explicit status the caller asked for is still what lands: writing it
    // is this command's entire contract, and on a spec it is a human override
    // no reader consumes (all display paths use computedStatus).
    expect(data["status"]).toBe("In Progress");
  });

  it("does NOT introduce a `verified:` field onto a spec that lacks one", () => {
    setStatus({ target: specPath, status: "Complete", trackerRoot });
    const { data } = parseFrontmatter(readFileSync(specPath, "utf-8"));
    expect(data["verified"]).toBeUndefined();
  });

  it("leaves a milestone README untouched apart from its status override", () => {
    // A README has no checklist to derive from, and its `status:` IS read as
    // the terminal override — never sync it against a computed value.
    setStatus({ target: milestonePath, status: "Deferred", trackerRoot });
    const { data } = parseFrontmatter(
      readFileSync(join(milestonePath, "00-README.md"), "utf-8"),
    );
    expect(data["status"]).toBe("Deferred");
    expect(data["verified"]).toBeUndefined();
    expect(data["owner"]).toBe("dev@example.com");
  });
});

describe("add milestone — no derived status stamp", () => {
  let tmpDir: string;
  let trackerRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-milestone-nostamp-test-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not stamp `status:` into a new milestone README", () => {
    addMilestone({
      trackerRoot,
      name: "Fresh Milestone",
      slug: "fresh-milestone",
      owner: "dev@example.com",
    });
    const raw = readFileSync(
      join(trackerRoot, "M1-fresh-milestone", "00-README.md"),
      "utf-8",
    );
    const { data } = parseFrontmatter(raw);
    expect(data["status"]).toBeUndefined();
    // Human-authored fields survive, including the template's YAML comments.
    expect(data["name"]).toBe("Fresh Milestone");
    expect(data["owner"]).toBe("dev@example.com");
    expect(raw).toContain("lessons: skip");
  });

  it("the un-stamped README still renders in the index (status derived)", () => {
    addMilestone({
      trackerRoot,
      name: "Fresh Milestone",
      slug: "fresh-milestone",
      owner: "dev@example.com",
    });
    const index = readFileSync(join(trackerRoot, "00-INDEX.md"), "utf-8");
    expect(index).toContain("Fresh Milestone");
    // Derived from zero specs — same value the old inert stamp claimed.
    expect(index).toContain("Not Started");
  });
});
