/**
 * Losslessness tests for the `<!-- opened: -->` thread marker rule (M7/01).
 *
 * Folding unmarked `## ` headings back into freeform must not cost a single
 * byte: legacy, CLI-format and mixed files all have to survive parse→serialize
 * and every mutation path (which is guarded by `assertWorklogLossless`).
 *
 * pnpm vitest run worklog-legacy-lossless
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openThread,
  appendThread,
  closeThread,
  parseWorklogMarkdown,
  serializeWorklogMarkdown,
} from "../lib/worklog.ts";

const LEGACY = [
  "# Worklog — investigation",
  "",
  "## Root cause",
  "The parser treated every heading as a thread.",
  "",
  "## Files you OWN",
  "- lib/worklog.ts",
  "- bin/tracker.mts",
  "",
  "### 2026-01-01T00:00:00.000Z [note]",
  "A hand-written h3 that is not inside any thread.",
  "",
].join("\n");

const MIXED = [
  "# Worklog — mixed",
  "",
  "## Background",
  "prose before any thread",
  "",
  "## 01ABCDEFGHJKMNPQRSTV-alpha — alpha",
  "<!-- opened: 2026-01-01T00:00:00.000Z -->",
  "## Notes inside the thread",
  "freeform under a folded heading",
  "### 2026-01-01T00:00:00.000Z [note]",
  "a note",
  "",
  "## 01ABCDEFGHJKMNPQRSTW-omega — omega",
  "<!-- opened: 2026-01-02T00:00:00.000Z -->",
  "",
].join("\n");

/** Whitespace-normalized non-blank lines — the unit `assertWorklogLossless` counts. */
function contentLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l !== "");
}

describe("worklog legacy losslessness", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-worklog-legacy-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // 1. Round-trip byte identity.
  // -------------------------------------------------------------------------

  it("round-trips a pure legacy file byte-identically", () => {
    expect(serializeWorklogMarkdown(parseWorklogMarkdown(LEGACY))).toBe(LEGACY);
  });

  it("round-trips a mixed legacy/CLI file byte-identically", () => {
    expect(serializeWorklogMarkdown(parseWorklogMarkdown(MIXED))).toBe(MIXED);
  });

  it("round-trips a CLI-written file byte-identically and reaches a fixpoint", () => {
    const worklogPath = join(tmpDir, "cli.md");
    const id = openThread({ worklogPath, slug: "cycle", stage: "planned" });
    appendThread({ worklogPath, threadId: id, section: "note", message: "first note" });
    closeThread({ worklogPath, threadId: id, status: "done" });

    const content = readFileSync(worklogPath, "utf-8");
    const once = serializeWorklogMarkdown(parseWorklogMarkdown(content));
    const twice = serializeWorklogMarkdown(parseWorklogMarkdown(once));

    expect(once).toBe(content);
    expect(twice).toBe(content);
  });

  // -------------------------------------------------------------------------
  // 2. Deterministic parses (no clock in the parser).
  // -------------------------------------------------------------------------

  it("parses identically on repeated calls", () => {
    for (const fixture of [LEGACY, MIXED]) {
      expect(parseWorklogMarkdown(fixture)).toEqual(parseWorklogMarkdown(fixture));
    }
  });

  // -------------------------------------------------------------------------
  // 3. Mutation paths keep the fail-closed guard happy.
  // -------------------------------------------------------------------------

  it("opens a thread in a legacy file without destroying the prose", () => {
    const worklogPath = join(tmpDir, "legacy.md");
    writeFileSync(worklogPath, LEGACY, "utf-8");

    const id = openThread({ worklogPath, slug: "new-work", stage: "planned" });
    const after = readFileSync(worklogPath, "utf-8");

    for (const line of contentLines(LEGACY)) {
      expect(contentLines(after)).toContain(line);
    }
    expect(after).toContain(`## ${id}`);
  });

  it("appends to a real thread in a mixed file without destroying the folded sections", () => {
    const worklogPath = join(tmpDir, "mixed.md");
    writeFileSync(worklogPath, MIXED, "utf-8");

    appendThread({
      worklogPath,
      threadId: "01ABCDEFGHJKMNPQRSTV-alpha",
      section: "note",
      message: "appended note",
    });
    closeThread({ worklogPath, threadId: "01ABCDEFGHJKMNPQRSTW-omega", status: "done" });
    const after = readFileSync(worklogPath, "utf-8");

    for (const line of contentLines(MIXED)) {
      expect(contentLines(after)).toContain(line);
    }
    expect(after).toContain("appended note");
    expect(after).toContain("<!-- closed:");
  });

  it("refuses to address a folded heading as a thread", () => {
    const worklogPath = join(tmpDir, "legacy.md");
    writeFileSync(worklogPath, LEGACY, "utf-8");

    expect(() =>
      appendThread({ worklogPath, threadId: "Root cause", section: "note", message: "nope" }),
    ).toThrow(/Thread not found: Root cause/);

    // The failed mutation left the file untouched.
    expect(readFileSync(worklogPath, "utf-8")).toBe(LEGACY);
  });
});
