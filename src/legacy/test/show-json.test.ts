/**
 * Tests for `tracker show <spec-path> --json` output.
 *
 * Verifies that the output validates against the SpecJSON schema and
 * contains expected fields.
 */

import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { parseSpec, toSpecJSON, SpecJSONSchema } from "../lib/documents/spec.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "fixtures");
const M1_FIXTURE_DIR = resolve(FIXTURES_DIR, "M1-design-overhaul-benchmark");

describe("tracker show --json", () => {
  it("parses a spec file and produces valid SpecJSON", () => {
    const filePath = resolve(M1_FIXTURE_DIR, "01-research-recent-plugin-commits.md");
    const raw = readFileSync(filePath, "utf-8");
    const view = parseSpec(raw, filePath);
    const json = toSpecJSON(view, filePath);

    // Must validate against SpecJSON schema without throwing
    const validated = SpecJSONSchema.parse(json);

    expect(validated.path).toBe(filePath);
    expect(validated.title).toBe("Research: Recent Plugin Commits Audit");
    expect(validated.status).toBe("Not Started");
    expect(validated.verified).toBe(0);
    expect(validated.total).toBe(3);
    expect(validated.tasks).toHaveLength(3);
  });

  it("SpecJSON includes the spec file name in path", () => {
    const filePath = resolve(M1_FIXTURE_DIR, "01-research-recent-plugin-commits.md");
    const raw = readFileSync(filePath, "utf-8");
    const view = parseSpec(raw, filePath);
    const json = toSpecJSON(view, filePath);

    // Verification: stdout matches /schema-and-parser/ — for schema-and-parser spec
    // This test verifies the fixture path includes "research-recent-plugin-commits"
    expect(json.path).toContain("research-recent-plugin-commits");
  });

  it("validates a Complete spec correctly", () => {
    // Build a minimal spec with all items checked
    const raw = `---
status: Complete
verified: 2/2
updated: 2026-05-01
---

# My Complete Spec

## Verification Checklist

- [x] First task done
- [x] Second task done
`;
    const filePath = "/fake/path/my-spec.md";
    const view = parseSpec(raw, filePath);
    const json = toSpecJSON(view, filePath);

    const validated = SpecJSONSchema.parse(json);

    expect(validated.status).toBe("Complete");
    expect(validated.verified).toBe(2);
    expect(validated.total).toBe(2);
  });

  it("validates an In Progress spec correctly", () => {
    const raw = `---
status: In Progress
verified: 1/3
updated: 2026-05-01
---

# My In Progress Spec

## Verification Checklist

- [x] First task done
- [ ] Second task pending
- [ ] Third task pending
`;
    const filePath = "/fake/path/my-spec.md";
    const view = parseSpec(raw, filePath);
    const json = toSpecJSON(view, filePath);

    const validated = SpecJSONSchema.parse(json);

    expect(validated.status).toBe("In Progress");
    expect(validated.verified).toBe(1);
    expect(validated.total).toBe(3);
  });

  it("all fixture spec files parse and validate as SpecJSON", () => {
    const fixtureFiles = [
      "01-research-recent-plugin-commits.md",
      "02-typescript-migration.md",
      "03-multi-model-support.md",
      "04-example-infographic-fixture.md",
      "05-benchmark-runner.md",
      "06-git-commit-research.md",
    ];

    for (const fileName of fixtureFiles) {
      const filePath = resolve(M1_FIXTURE_DIR, fileName);
      const raw = readFileSync(filePath, "utf-8");
      const view = parseSpec(raw, filePath);
      const json = toSpecJSON(view, filePath);

      // This will throw if invalid
      const validated = SpecJSONSchema.parse(json);

      expect(validated.path).toBe(filePath);
      expect(typeof validated.title).toBe("string");
      expect(typeof validated.verified).toBe("number");
      expect(typeof validated.total).toBe("number");
    }
  });

  it("tasks array has correct structure per SpecJSON schema", () => {
    const filePath = resolve(M1_FIXTURE_DIR, "01-research-recent-plugin-commits.md");
    const raw = readFileSync(filePath, "utf-8");
    const view = parseSpec(raw, filePath);
    const json = toSpecJSON(view, filePath);

    for (const task of json.tasks) {
      expect(typeof task.index).toBe("number");
      expect(typeof task.checked).toBe("boolean");
      expect(typeof task.label).toBe("string");
      // command and expected are nullable
      expect(task.command === null || typeof task.command === "string").toBe(true);
      expect(task.expected === null || typeof task.expected === "string").toBe(true);
    }
  });
});
