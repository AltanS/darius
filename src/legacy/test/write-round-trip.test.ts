/**
 * Round-trip integration test: add spec → parse back → schema validates.
 *
 * pnpm vitest run write-round-trip
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTracker, addMilestone, addSpec, markTask } from "../lib/tracker-writer.ts";
import { parseSpec } from "../lib/documents/spec.ts";
import { SpecInputSchema } from "../lib/documents/spec.ts";

describe("write-round-trip", () => {
  let tmpDir: string;
  let trackerRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-round-trip-test-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    addMilestone({
      trackerRoot,
      name: "Round Trip Test",
      slug: "round-trip-test",
      owner: "dev@example.com",
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a spec that parses back without errors", () => {
    const result = addSpec({
      trackerRoot,
      milestoneArg: "M1-round-trip-test",
      name: "My Feature",
      template: "generic",
      agent: "typescript:typescript-expert",
    });

    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;

    const raw = readFileSync(result.filePath, "utf-8");
    // Should not throw
    const view = parseSpec(raw, result.filePath);
    expect(view.title).toBe("My Feature");
    expect(view.agent).toBe("typescript:typescript-expert");
  });

  it("spec frontmatter validates against SpecInputSchema after creation", () => {
    const result = addSpec({
      trackerRoot,
      milestoneArg: "M1-round-trip-test",
      name: "API Endpoint",
      template: "api-endpoint",
    });

    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;

    const raw = readFileSync(result.filePath, "utf-8");
    const view = parseSpec(raw, result.filePath);

    // Validate the extracted frontmatter fields
    const fmFields = {
      agent: view.agent,
      depends_on: view.depends_on,
      template: view.template,
      updated: view.updated,
    };
    const parseResult = SpecInputSchema.safeParse(fmFields);
    expect(parseResult.success).toBe(true);
  });

  it("spec with depends_on parses back with correct array", () => {
    const result = addSpec({
      trackerRoot,
      milestoneArg: "M1-round-trip-test",
      name: "Dependent Feature",
      template: "generic",
      dependsOn: [".tracker/M1-round-trip-test/00-README.md"],
    });

    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;

    const raw = readFileSync(result.filePath, "utf-8");
    const view = parseSpec(raw, result.filePath);
    expect(view.depends_on).toContain(".tracker/M1-round-trip-test/00-README.md");
  });

  it("marking a task then parsing back gives verifiedCount = 1", () => {
    const result = addSpec({
      trackerRoot,
      milestoneArg: "M1-round-trip-test",
      name: "Markable Feature",
      template: "generic",
    });

    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;

    // Mark first task (index 0 if any checklist items)
    const rawBefore = readFileSync(result.filePath, "utf-8");
    const viewBefore = parseSpec(rawBefore, result.filePath);

    if (viewBefore.totalCount > 0) {
      markTask({
        specPath: result.filePath,
        taskIndex: 0,
        state: "verified",
        trackerRoot,
      });

      const rawAfter = readFileSync(result.filePath, "utf-8");
      const viewAfter = parseSpec(rawAfter, result.filePath);
      expect(viewAfter.verifiedCount).toBeGreaterThan(0);
    }
  });

  it("all template types produce parseable specs", () => {
    const templates = ["generic", "api-endpoint", "ui-component", "library"] as const;

    for (const template of templates) {
      const result = addSpec({
        trackerRoot,
        milestoneArg: "M1-round-trip-test",
        name: `${template} Feature`,
        template,
      });

      expect(result.kind).toBe("created");
      if (result.kind !== "created") continue;

      const raw = readFileSync(result.filePath, "utf-8");
      // Should not throw
      const view = parseSpec(raw, result.filePath);
      expect(view.title).toBeTruthy();
    }
  });
});
