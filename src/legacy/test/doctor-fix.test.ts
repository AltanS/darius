/**
 * Tests for `tracker doctor --fix` — strips derived frontmatter fields.
 *
 * pnpm vitest run doctor-fix
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTracker, addMilestone } from "../lib/tracker-writer.ts";
import { runDoctor } from "../lib/doctor.ts";
import { parseFrontmatter } from "../lib/markdown/frontmatter.ts";

// A spec with legacy derived fields (status, verified) — legacy v8 format
const LEGACY_SPEC = `---
status: Not Started
verified: 0/5
updated: 2026-01-01
agent: test
depends_on: []
template: generic
---

# Legacy Spec

## Verification Checklist

### Implementation

- [ ] First task
- [ ] Second task
`;

describe("doctor-fix", () => {
  let tmpDir: string;
  let trackerRoot: string;
  let milestonePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-doctor-fix-test-"));
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

  it("--fix strips derived fields (status, verified) from spec frontmatter", () => {
    const specPath = join(milestonePath, "01-legacy.md");
    writeFileSync(specPath, LEGACY_SPEC, "utf-8");

    // Without fix: should be healthy (legacy fields are tolerated by passthrough)
    const beforeReport = runDoctor({ trackerRoot });
    expect(beforeReport.healthy).toBe(true);

    // With fix: should strip derived fields and regenerate index
    const afterReport = runDoctor({ trackerRoot, fix: true });
    expect(afterReport.healthy).toBe(true);
    expect(afterReport.findings).toHaveLength(0);

    // Verify derived fields are removed from frontmatter
    const content = readFileSync(specPath, "utf-8");
    const { data } = parseFrontmatter(content);
    expect(data).not.toHaveProperty("status");
    expect(data).not.toHaveProperty("verified");
  });

  it("--fix preserves non-derived frontmatter fields", () => {
    const specPath = join(milestonePath, "01-legacy.md");
    writeFileSync(specPath, LEGACY_SPEC, "utf-8");

    runDoctor({ trackerRoot, fix: true });

    const content = readFileSync(specPath, "utf-8");
    const { data } = parseFrontmatter(content);
    expect(data["agent"]).toBe("test");
    expect(data["template"]).toBe("generic");
    expect(data["updated"]).toBeDefined();
  });

  it("--fix preserves the spec body content", () => {
    const specPath = join(milestonePath, "01-legacy.md");
    writeFileSync(specPath, LEGACY_SPEC, "utf-8");

    runDoctor({ trackerRoot, fix: true });

    const content = readFileSync(specPath, "utf-8");
    expect(content).toContain("# Legacy Spec");
    expect(content).toContain("- [ ] First task");
    expect(content).toContain("- [ ] Second task");
  });

  it("--fix regenerates the index", () => {
    const specPath = join(milestonePath, "01-legacy.md");
    writeFileSync(specPath, LEGACY_SPEC, "utf-8");

    // Corrupt the index
    writeFileSync(join(trackerRoot, "00-INDEX.md"), "# Corrupted Index\n", "utf-8");

    runDoctor({ trackerRoot, fix: true });

    const indexContent = readFileSync(join(trackerRoot, "00-INDEX.md"), "utf-8");
    expect(indexContent).toContain("Test Milestone");
  });

  it("--fix is idempotent (running twice produces the same result)", () => {
    const specPath = join(milestonePath, "01-legacy.md");
    writeFileSync(specPath, LEGACY_SPEC, "utf-8");

    runDoctor({ trackerRoot, fix: true });
    const content1 = readFileSync(specPath, "utf-8");

    runDoctor({ trackerRoot, fix: true });
    const content2 = readFileSync(specPath, "utf-8");

    expect(content1).toBe(content2);
  });

  it("handles multiple specs with mixed legacy and clean frontmatter", () => {
    const legacyPath = join(milestonePath, "01-legacy.md");
    const cleanPath = join(milestonePath, "02-clean.md");

    writeFileSync(legacyPath, LEGACY_SPEC, "utf-8");
    writeFileSync(
      cleanPath,
      `---
updated: 2026-01-01
agent: test
---

# Clean Spec

- [ ] Task
`,
      "utf-8",
    );

    const report = runDoctor({ trackerRoot, fix: true });
    expect(report.healthy).toBe(true);

    // Legacy spec should have derived fields stripped
    const legacyContent = readFileSync(legacyPath, "utf-8");
    const { data: legacyData } = parseFrontmatter(legacyContent);
    expect(legacyData).not.toHaveProperty("status");

    // Clean spec should be untouched (no derived fields to strip)
    const cleanContent = readFileSync(cleanPath, "utf-8");
    expect(cleanContent).toContain("# Clean Spec");
  });
});
