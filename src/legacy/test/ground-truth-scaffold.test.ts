/**
 * Ground Truth scaffold (M247/0e) — creation-time section + warn-only doctor check.
 *
 * `tracker add spec` scaffolds a `## Ground Truth` section carrying one exact
 * placeholder comment. `tracker doctor` warns while that comment is still
 * present — keyed on PRESENCE, so legacy specs authored before the scaffold
 * existed never trip it.
 *
 * pnpm vitest run ground-truth-scaffold
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { initTracker, addMilestone, addSpec } from "../lib/tracker-writer.ts";
import type { TemplateKind } from "../lib/tracker-writer.ts";
import { runDoctor, formatDoctorReport } from "../lib/doctor.ts";
import {
  GROUND_TRUTH_HEADING,
  GROUND_TRUTH_PLACEHOLDER,
} from "../lib/documents/spec.ts";

const TEMPLATES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "templates",
);

const LEGACY_SPEC = `---
status: Not Started
verified: 0/1
updated: 2026-01-01
agent: test
---

# Legacy Spec (authored before the scaffold existed)

## Goal

Something old.

## Verification Checklist

- [ ] A task
`;

describe("ground-truth scaffold", () => {
  let tmpDir: string;
  let trackerRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-ground-truth-test-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    addMilestone({
      trackerRoot,
      name: "Test Milestone",
      slug: "test-milestone",
      owner: "dev@example.com",
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Template ↔ constant agreement (the drift these tests exist to prevent)
  // -------------------------------------------------------------------------

  it("every spec template carries the exact placeholder constant", () => {
    const templates = [
      "spec-generic.md",
      "spec-api-endpoint.md",
      "spec-ui-component.md",
      "spec-library.md",
    ];
    for (const file of templates) {
      const raw = readFileSync(join(TEMPLATES_DIR, file), "utf-8");
      expect(raw, file).toContain(GROUND_TRUTH_HEADING);
      expect(raw, file).toContain(GROUND_TRUTH_PLACEHOLDER);
    }
  });

  it("no spec template stamps derived status/verified frontmatter", () => {
    const templates = [
      "spec-generic.md",
      "spec-api-endpoint.md",
      "spec-ui-component.md",
      "spec-library.md",
    ];
    for (const file of templates) {
      const raw = readFileSync(join(TEMPLATES_DIR, file), "utf-8");
      const frontmatter = raw.split("\n---\n")[0] ?? "";
      expect(frontmatter, file).not.toContain("status:");
      expect(frontmatter, file).not.toContain("verified:");
    }
  });

  // -------------------------------------------------------------------------
  // doctor: warn-only, present-keyed
  // -------------------------------------------------------------------------

  it("warns on a freshly scaffolded spec whose placeholder is untouched", () => {
    const result = addSpec({
      trackerRoot,
      milestoneArg: "M1-test-milestone",
      name: "Unfilled Spec",
      template: "generic",
    });
    if (result.kind !== "created") throw new Error("expected created");

    const report = runDoctor({ trackerRoot });
    const gt = report.warnings.filter((w) => w.kind === "ground-truth-unfilled");
    expect(gt).toHaveLength(1);
    expect(gt[0]?.file).toBe(result.filePath);
    expect(gt[0]?.warnOnly).toBe(true);
  });

  it("the warning does NOT fail the healthcheck", () => {
    addSpec({
      trackerRoot,
      milestoneArg: "M1-test-milestone",
      name: "Unfilled Spec",
      template: "generic",
    });

    const report = runDoctor({ trackerRoot });
    expect(report.findings).toEqual([]);
    expect(report.healthy).toBe(true);
  });

  it("stops warning once the placeholder is removed", () => {
    const result = addSpec({
      trackerRoot,
      milestoneArg: "M1-test-milestone",
      name: "Filled Spec",
      template: "generic",
    });
    if (result.kind !== "created") throw new Error("expected created");

    const filled = readFileSync(result.filePath, "utf-8").replace(
      GROUND_TRUTH_PLACEHOLDER,
      "Read `lib/doctor.ts:62-360` first-hand; ran `pnpm test` (56 files green).",
    );
    writeFileSync(result.filePath, filled, "utf-8");

    const report = runDoctor({ trackerRoot });
    expect(report.warnings.filter((w) => w.kind === "ground-truth-unfilled")).toEqual(
      [],
    );
  });

  it("never warns on a legacy spec that predates the scaffold", () => {
    // The 116 active specs in the workspace estate look like this. Keying on
    // the placeholder's presence (not the section's absence) is what keeps
    // doctor quiet on all of them.
    writeFileSync(
      join(trackerRoot, "M1-test-milestone", "01-legacy.md"),
      LEGACY_SPEC,
      "utf-8",
    );

    const report = runDoctor({ trackerRoot });
    expect(report.warnings.filter((w) => w.kind === "ground-truth-unfilled")).toEqual(
      [],
    );
  });

  it("warns once per unfilled spec, across templates", () => {
    const templates: TemplateKind[] = ["generic", "api-endpoint", "library"];
    for (const template of templates) {
      addSpec({
        trackerRoot,
        milestoneArg: "M1-test-milestone",
        name: `Spec ${template}`,
        template,
      });
    }
    // …plus one legacy spec that must stay silent.
    writeFileSync(
      join(trackerRoot, "M1-test-milestone", "09-legacy.md"),
      LEGACY_SPEC,
      "utf-8",
    );

    const report = runDoctor({ trackerRoot });
    expect(
      report.warnings.filter((w) => w.kind === "ground-truth-unfilled"),
    ).toHaveLength(3);
  });

  it("surfaces the warning in the formatted report on the healthy path", () => {
    addSpec({
      trackerRoot,
      milestoneArg: "M1-test-milestone",
      name: "Unfilled Spec",
      template: "generic",
    });

    const out = formatDoctorReport(runDoctor({ trackerRoot }));
    expect(out).toContain("## Warnings");
    expect(out).toContain("Ground Truth");
  });

  it("surfaces the warning even when a hard finding is also present", () => {
    addSpec({
      trackerRoot,
      milestoneArg: "M1-test-milestone",
      name: "Unfilled Spec",
      template: "generic",
    });
    // A dangling depends_on produces a hard finding.
    writeFileSync(
      join(trackerRoot, "M1-test-milestone", "09-dangling.md"),
      [
        "---",
        "updated: 2026-01-01",
        "depends_on:",
        "  - .tracker/M99-nope/99-ghost.md",
        "---",
        "",
        "# Dangling",
        "",
        "- [ ] a task",
        "",
      ].join("\n"),
      "utf-8",
    );

    const report = runDoctor({ trackerRoot });
    expect(report.healthy).toBe(false);
    const out = formatDoctorReport(report);
    expect(out).toContain("## Warnings");
    expect(out).toContain("Ground Truth");
  });

  it("--fix does not silently delete the placeholder", () => {
    // Ground truth cannot be auto-written; the scaffold must survive --fix so
    // the warning keeps pointing at the real gap.
    const result = addSpec({
      trackerRoot,
      milestoneArg: "M1-test-milestone",
      name: "Fix Me",
      template: "generic",
    });
    if (result.kind !== "created") throw new Error("expected created");

    runDoctor({ trackerRoot, fix: true });

    expect(readFileSync(result.filePath, "utf-8")).toContain(
      GROUND_TRUTH_PLACEHOLDER,
    );
  });
});
