/**
 * Tests for `tracker add spec`.
 *
 * pnpm vitest run add-spec
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTracker, addMilestone, addSpec } from "../lib/tracker-writer.ts";
import type { TemplateKind } from "../lib/tracker-writer.ts";
import { parseFrontmatter } from "../lib/markdown/frontmatter.ts";
import {
  parseSpec,
  GROUND_TRUTH_HEADING,
  GROUND_TRUTH_PLACEHOLDER,
} from "../lib/documents/spec.ts";
import { runDoctor } from "../lib/doctor.ts";

describe("add-spec", () => {
  let tmpDir: string;
  let trackerRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-add-spec-test-"));
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

  it("creates 01-<slug>.md spec file", () => {
    const result = addSpec({
      trackerRoot,
      milestoneArg: "M1-test-milestone",
      name: "My Spec",
      template: "generic",
    });
    expect(result.kind).toBe("created");
    const specPath = join(trackerRoot, "M1-test-milestone", "01-my-spec.md");
    expect(existsSync(specPath)).toBe(true);
  });

  it("substitutes spec name in file", () => {
    addSpec({
      trackerRoot,
      milestoneArg: "M1-test-milestone",
      name: "My Spec",
      template: "generic",
    });
    const content = readFileSync(
      join(trackerRoot, "M1-test-milestone", "01-my-spec.md"),
      "utf-8",
    );
    expect(content).toContain("My Spec");
  });

  it("uses api-endpoint template", () => {
    addSpec({
      trackerRoot,
      milestoneArg: "M1-test-milestone",
      name: "Create User",
      template: "api-endpoint",
    });
    const content = readFileSync(
      join(trackerRoot, "M1-test-milestone", "01-create-user.md"),
      "utf-8",
    );
    expect(content).toContain("api-endpoint");
  });

  it("sets agent in frontmatter", () => {
    addSpec({
      trackerRoot,
      milestoneArg: "M1-test-milestone",
      name: "My Spec",
      template: "generic",
      agent: "typescript:typescript-expert",
    });
    const content = readFileSync(
      join(trackerRoot, "M1-test-milestone", "01-my-spec.md"),
      "utf-8",
    );
    expect(content).toContain("typescript:typescript-expert");
  });

  it("sets depends_on in frontmatter", () => {
    addSpec({
      trackerRoot,
      milestoneArg: "M1-test-milestone",
      name: "My Spec",
      template: "generic",
      dependsOn: [".tracker/M1-test-milestone/00-README.md"],
    });
    const content = readFileSync(
      join(trackerRoot, "M1-test-milestone", "01-my-spec.md"),
      "utf-8",
    );
    expect(content).toContain(".tracker/M1-test-milestone/00-README.md");
  });

  it("auto-increments spec number: second spec gets 02", () => {
    addSpec({
      trackerRoot,
      milestoneArg: "M1-test-milestone",
      name: "First Spec",
      template: "generic",
    });
    const result = addSpec({
      trackerRoot,
      milestoneArg: "M1-test-milestone",
      name: "Second Spec",
      template: "generic",
    });
    expect(result.kind).toBe("created");
    if (result.kind === "created") {
      expect(result.number).toBe(2);
    }
    expect(existsSync(join(trackerRoot, "M1-test-milestone", "02-second-spec.md"))).toBe(true);
  });

  it("accepts milestone by slug (without M1- prefix)", () => {
    const result = addSpec({
      trackerRoot,
      milestoneArg: "test-milestone",
      name: "My Spec",
      template: "generic",
    });
    expect(result.kind).toBe("created");
  });

  it("is idempotent: re-running with same name returns {kind: 'exists'}", () => {
    addSpec({
      trackerRoot,
      milestoneArg: "M1-test-milestone",
      name: "My Spec",
      template: "generic",
    });

    const result = addSpec({
      trackerRoot,
      milestoneArg: "M1-test-milestone",
      name: "My Spec",
      template: "generic",
    });
    expect(result.kind).toBe("exists");
  });

  it("regenerates 00-INDEX.md after spec creation", () => {
    addSpec({
      trackerRoot,
      milestoneArg: "M1-test-milestone",
      name: "My Spec",
      template: "generic",
    });
    const indexContent = readFileSync(join(trackerRoot, "00-INDEX.md"), "utf-8");
    expect(indexContent).toContain("Test Milestone");
  });

  it("bracket-prefixed agent round-trips through frontmatter without a parse error", () => {
    // Same vulnerability class as addMilestone's bracket-name bug: a free-text
    // --agent value starting with `[` must be quoted by the serializer, or it
    // lands as an invalid bare inline-sequence scalar.
    const bracketAgent = "[team] typescript-expert";
    addSpec({
      trackerRoot,
      milestoneArg: "M1-test-milestone",
      name: "My Spec",
      template: "generic",
      agent: bracketAgent,
      dependsOn: [".tracker/M1-test-milestone/00-README.md"],
    });
    const content = readFileSync(
      join(trackerRoot, "M1-test-milestone", "01-my-spec.md"),
      "utf-8",
    );
    const { data } = parseFrontmatter(content);
    expect(data.agent).toBe(bracketAgent);
    expect(data.template).toBe("generic");
    expect(data.depends_on).toEqual([".tracker/M1-test-milestone/00-README.md"]);
  });

  // -------------------------------------------------------------------------
  // Drift at source: derived fields are never stamped at creation
  // -------------------------------------------------------------------------

  it("does NOT stamp derived status/verified frontmatter", () => {
    // Both are recomputed from checklist markers on every read and were never
    // read back — stamping them created a copy that froze while the work moved.
    addSpec({
      trackerRoot,
      milestoneArg: "M1-test-milestone",
      name: "My Spec",
      template: "generic",
    });
    const content = readFileSync(
      join(trackerRoot, "M1-test-milestone", "01-my-spec.md"),
      "utf-8",
    );
    const { data } = parseFrontmatter(content);
    expect(data.status).toBeUndefined();
    expect(data.verified).toBeUndefined();
    // The fields that ARE authored by a human survive.
    expect(data.template).toBe("generic");
    expect(data.agent).toBe("unassigned");
    expect(typeof data.updated).toBe("string");
  });

  it("stamps no derived fields for any template kind", () => {
    const templates: TemplateKind[] = [
      "generic",
      "api-endpoint",
      "ui-component",
      "library",
    ];
    for (const template of templates) {
      const result = addSpec({
        trackerRoot,
        milestoneArg: "M1-test-milestone",
        name: `Spec ${template}`,
        template,
      });
      expect(result.kind).toBe("created");
      if (result.kind !== "created") continue;
      const { data } = parseFrontmatter(readFileSync(result.filePath, "utf-8"));
      expect(data.status, template).toBeUndefined();
      expect(data.verified, template).toBeUndefined();
    }
  });

  it("a freshly created spec parses and doctors clean (no derived fields to strip)", () => {
    const result = addSpec({
      trackerRoot,
      milestoneArg: "M1-test-milestone",
      name: "Clean Spec",
      template: "generic",
    });
    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;

    const raw = readFileSync(result.filePath, "utf-8");
    // Parses through the real spec parser…
    expect(() => parseSpec(raw, result.filePath)).not.toThrow();
    // …and doctor finds nothing to strip (hard findings empty).
    const report = runDoctor({ trackerRoot });
    expect(report.findings).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Ground Truth scaffold (0e)
  // -------------------------------------------------------------------------

  it("scaffolds a '## Ground Truth' section with the exact placeholder", () => {
    const result = addSpec({
      trackerRoot,
      milestoneArg: "M1-test-milestone",
      name: "Scaffolded Spec",
      template: "generic",
    });
    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;

    const content = readFileSync(result.filePath, "utf-8");
    expect(content).toContain(GROUND_TRUTH_HEADING);
    expect(content).toContain(GROUND_TRUTH_PLACEHOLDER);
  });

  it("scaffolds the Ground Truth section for every template kind", () => {
    const templates: TemplateKind[] = [
      "generic",
      "api-endpoint",
      "ui-component",
      "library",
    ];
    for (const template of templates) {
      const result = addSpec({
        trackerRoot,
        milestoneArg: "M1-test-milestone",
        name: `GT ${template}`,
        template,
      });
      expect(result.kind).toBe("created");
      if (result.kind !== "created") continue;
      const content = readFileSync(result.filePath, "utf-8");
      expect(content, template).toContain(GROUND_TRUTH_HEADING);
      expect(content, template).toContain(GROUND_TRUTH_PLACEHOLDER);
    }
  });

  it("the placeholder survives template substitution byte-for-byte", () => {
    // addSpec rewrites any leftover {{TOKEN}} to `<!-- TODO -->`. The
    // placeholder must not be collateral damage of that sweep — doctor's
    // warn-only check keys on the exact string.
    const result = addSpec({
      trackerRoot,
      milestoneArg: "M1-test-milestone",
      name: "Byte Exact",
      template: "generic",
    });
    if (result.kind !== "created") throw new Error("expected created");
    const content = readFileSync(result.filePath, "utf-8");
    const occurrences = content.split(GROUND_TRUTH_PLACEHOLDER).length - 1;
    expect(occurrences).toBe(1);
  });
});
