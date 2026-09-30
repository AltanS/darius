/**
 * Schema validation tests.
 *
 * Covers:
 * - SpecInputSchema accepts valid input
 * - SpecInputSchema rejects malformed types
 * - SpecJSONSchema validates CLI output shape
 * - MilestoneInputSchema passthrough
 * - WorklogThreadSchema validation
 * - IndexDocGeneratorInputSchema (generator-only, no parseIndex)
 * - TrackerValidationError translator produces human-readable messages
 */

import { describe, it, expect } from "vitest";
import { SpecInputSchema, SpecJSONSchema } from "../lib/documents/spec.js";
import { MilestoneInputSchema } from "../lib/documents/milestone.js";
import { WorklogThreadSchema } from "../lib/documents/worklog.js";
import { IndexDocGeneratorInputSchema, generateIndexDoc } from "../lib/documents/index-doc.js";
import { translateZodError, formatParseError, TrackerValidationError } from "../lib/markdown/errors.js";

describe("SpecInputSchema", () => {
  it("accepts a minimal spec front-matter", () => {
    const result = SpecInputSchema.safeParse({ agent: "typescript:ts-expert" });
    expect(result.success).toBe(true);
  });

  it("accepts an empty object", () => {
    const result = SpecInputSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts legacy status and verified fields via passthrough", () => {
    const result = SpecInputSchema.safeParse({
      status: "Not Started",
      verified: "0/5",
      agent: "test",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as Record<string, unknown>;
      expect(data["status"]).toBe("Not Started");
    }
  });

  it("accepts all known fields", () => {
    const result = SpecInputSchema.safeParse({
      agent: "typescript:typescript-expert",
      counsel: "2026-01-01T00:00:00Z",
      depends_on: ["M1-foo/01-bar.md"],
      template: "generic",
      updated: "2026-01-01",
    });
    expect(result.success).toBe(true);
  });

  it("rejects depends_on that is not an array", () => {
    const result = SpecInputSchema.safeParse({
      depends_on: "M1-foo/01-bar.md", // should be array
    });
    expect(result.success).toBe(false);
  });
});

describe("SpecJSONSchema", () => {
  it("validates a well-formed SpecJSON object", () => {
    const result = SpecJSONSchema.safeParse({
      path: "/path/to/spec.md",
      title: "My Spec",
      status: "In Progress",
      verified: 2,
      total: 5,
      tasks: [
        { index: 0, checked: true, label: "task", command: null, expected: null },
      ],
      meta: {},
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status values", () => {
    const result = SpecJSONSchema.safeParse({
      path: "/path/to/spec.md",
      title: "My Spec",
      status: "Unknown",
      verified: 0,
      total: 0,
      tasks: [],
      meta: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative verified count", () => {
    const result = SpecJSONSchema.safeParse({
      path: "/path/to/spec.md",
      title: "My Spec",
      status: "Not Started",
      verified: -1,
      total: 0,
      tasks: [],
      meta: {},
    });
    expect(result.success).toBe(false);
  });
});

describe("MilestoneInputSchema", () => {
  it("accepts empty object", () => {
    expect(MilestoneInputSchema.safeParse({}).success).toBe(true);
  });

  it("accepts milestone front-matter", () => {
    const result = MilestoneInputSchema.safeParse({
      name: "Design Overhaul",
      slug: "design-overhaul-benchmark",
      started: "2026-04-28",
      target: "TBD",
      owner: "user@example.com",
    });
    expect(result.success).toBe(true);
  });

  it("passes through unknown fields", () => {
    const result = MilestoneInputSchema.safeParse({
      unknown_field: "some value",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as Record<string, unknown>;
      expect(data["unknown_field"]).toBe("some value");
    }
  });
});

describe("WorklogThreadSchema", () => {
  it("validates a well-formed thread", () => {
    const result = WorklogThreadSchema.safeParse({
      threadId: "01KQA00MJ5725V29Q1AF-auth-refactor",
      label: "Auth refactor thread",
      openedAt: "2026-01-01T00:00:00Z",
      entries: [
        { kind: "note", text: "Started work", timestamp: "2026-01-01T01:00:00Z" },
        { kind: "artifact", path: "/path/to/file.ts" },
        { kind: "blocker", text: "Need DB access" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown entry kind", () => {
    const result = WorklogThreadSchema.safeParse({
      threadId: "test-123",
      entries: [{ kind: "unknown", text: "foo" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("IndexDocGeneratorInputSchema — generator only", () => {
  it("validates generator input", () => {
    const result = IndexDocGeneratorInputSchema.safeParse({
      milestoneSlug: "M2-tracker-cli-refactor",
      milestoneName: "Tracker CLI Refactor",
      generatedAt: "2026-05-09T00:00:00Z",
      schema_version: 2,
      specs: [
        {
          path: "01-schema-and-parser.md",
          title: "Schema and Parser",
          status: "In Progress",
          verified: 3,
          total: 12,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("generates an index doc with the do-not-edit comment", () => {
    const content = generateIndexDoc({
      milestoneSlug: "M2-tracker-cli-refactor",
      milestoneName: "Tracker CLI Refactor",
      generatedAt: "2026-05-09T00:00:00Z",
      schema_version: 2,
      specs: [
        {
          path: "01-schema-and-parser.md",
          title: "Schema and Parser",
          status: "In Progress",
          verified: 3,
          total: 12,
        },
      ],
    });
    expect(content).toContain("<!-- Generated by tracker CLI.");
    expect(content).toContain("tracker index --rebuild");
    expect(content).toContain("Schema and Parser");
  });

  it("index-doc.ts has no parseIndex or parseIndexDoc export", async () => {
    const mod = await import("../lib/documents/index-doc.js");
    const modKeys = Object.keys(mod);
    expect(modKeys).not.toContain("parseIndex");
    expect(modKeys).not.toContain("parseIndexDoc");
  });
});

describe("TrackerValidationError translator", () => {
  it("produces human-readable messages for type errors", () => {
    const err = new TrackerValidationError({
      path: "name",
      expected: "string",
      actual: "number",
      sourcePath: "/path/to/file.md",
    });
    const translated = translateZodError(err, "/path/to/file.md");
    expect(translated.kind).toBe("parse-error");
    expect(translated.filePath).toBe("/path/to/file.md");
    expect(translated.errors.length).toBeGreaterThan(0);

    const formatted = formatParseError(translated);
    expect(formatted).toContain("name");
    expect(formatted).toContain("Expected string");
  });

  it("includes the file path in the formatted output", () => {
    const err = new TrackerValidationError({
      path: "count",
      expected: "number",
      actual: "string",
      sourcePath: "/my/spec.md",
    });
    const translated = translateZodError(err, "/my/spec.md");
    const formatted = formatParseError(translated);
    expect(formatted).toContain("/my/spec.md");
  });

  it("handles nested field paths", () => {
    const err = new TrackerValidationError({
      path: "meta.count",
      expected: "number",
      actual: "string",
    });
    const translated = translateZodError(err);
    expect(translated.errors[0]?.fieldPath).toBe("meta.count");
  });

  it("works with null filePath", () => {
    const err = new TrackerValidationError({
      path: "name",
      expected: "string",
      actual: "number",
    });
    const translated = translateZodError(err, null);
    const formatted = formatParseError(translated);
    expect(formatted).toContain("Parse error:");
  });
});
