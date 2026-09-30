/**
 * Regression tests for lossless worklog round-tripping (issue #8, finding 1).
 *
 * Before the fix, any mutating worklog command read → parsed → re-serialized the
 * WHOLE file, and the parser only retained content inside `### <ts> [<kind>]`
 * entry blocks — so the H1 title, intro prose, and any freeform body text were
 * silently destroyed on the first mutation. These tests lock the file down as
 * lossless and guard the fail-closed backstop.
 *
 * pnpm vitest run worklog-lossless
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTracker, addMilestone } from "../lib/tracker-writer.ts";
import {
  openThread,
  appendThread,
  closeThread,
  dispatchThread,
  parseWorklogMarkdown,
  serializeWorklogMarkdown,
} from "../lib/worklog.ts";

describe("worklog lossless", () => {
  let tmpDir: string;
  let trackerRoot: string;
  let worklogDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-worklog-lossless-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    worklogDir = join(trackerRoot, "worklog");
    addMilestone({
      trackerRoot,
      name: "Test Milestone",
      slug: "test-milestone",
      owner: "dev@example.com",
    });
    mkdirSync(worklogDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // 1. The exact minimal repro from the issue.
  // -------------------------------------------------------------------------

  it("preserves the H1 title and freeform prose when a mutation runs (issue repro)", () => {
    const worklogPath = join(worklogDir, "demo.md");
    const initial =
      "# Worklog — demo\n\n## 2026-07-04 — investigation notes\nLoad-bearing prose the next session needs.\n";
    writeFileSync(worklogPath, initial, "utf-8");

    const newId = openThread({ worklogPath, slug: "new-work" });

    const after = readFileSync(worklogPath, "utf-8");
    expect(after).toContain("# Worklog — demo");
    expect(after).toContain("Load-bearing prose the next session needs.");
    // The original hand-written thread header survives verbatim…
    expect(after).toContain("## 2026-07-04 — investigation notes");
    // …and the new thread was appended.
    expect(after).toContain(newId);
    expect(after).toContain("## " + newId);
  });

  // -------------------------------------------------------------------------
  // 2. Freeform prose under a section that ALSO has metadata + entries survives.
  // -------------------------------------------------------------------------

  it("preserves freeform prose alongside metadata comments and entries across mutations", () => {
    const worklogPath = join(worklogDir, "mixed.md");
    const threadId = "01ABCDEFGHJKMNPQRSTV-demo";
    const initial = [
      `## ${threadId} — demo`,
      "<!-- opened: 2026-01-01T00:00:00.000Z -->",
      "<!-- spec: .tracker/M1-x/01-y.md -->",
      "Some load-bearing freeform prose the parser used to drop.",
      "A second freeform line, indented in the original:",
      "    - a nested bullet a human wrote by hand",
      "### 2026-01-01T00:00:00.000Z [note]",
      "an existing entry note",
      "",
    ].join("\n");
    writeFileSync(worklogPath, initial, "utf-8");

    appendThread({ worklogPath, threadId, section: "note", message: "appended note" });
    dispatchThread({ worklogPath, threadId, agent: "Explore", reason: "exploration" });

    const after = readFileSync(worklogPath, "utf-8");
    expect(after).toContain("Some load-bearing freeform prose the parser used to drop.");
    expect(after).toContain("A second freeform line, indented in the original:");
    expect(after).toContain("- a nested bullet a human wrote by hand");
    // The pre-existing and new entries are both present.
    expect(after).toContain("an existing entry note");
    expect(after).toContain("appended note");
    expect(after).toContain("Agent selected: Explore — exploration");
    expect(after).toContain("<!-- stage: dispatched -->");
  });

  // -------------------------------------------------------------------------
  // 3. `## X` header without ` — ` round-trips verbatim.
  // -------------------------------------------------------------------------

  it("round-trips a `## X` header without a ` — ` separator verbatim", () => {
    const worklogPath = join(worklogDir, "noseparator.md");
    const initial = [
      "## Standalone Header No Separator",
      "<!-- opened: 2026-01-01T00:00:00.000Z -->",
      "### 2026-01-01T00:00:00.000Z [note]",
      "a note",
      "",
    ].join("\n");
    writeFileSync(worklogPath, initial, "utf-8");

    // Any mutation forces a full rewrite.
    openThread({ worklogPath, slug: "trigger" });

    const after = readFileSync(worklogPath, "utf-8");
    expect(after).toContain("## Standalone Header No Separator");
    // Must NOT be corrupted to `## X — X`.
    expect(after).not.toContain("## Standalone Header No Separator — Standalone Header No Separator");
  });

  // -------------------------------------------------------------------------
  // 4. Repeated mutations don't accumulate blanks / duplicate content.
  // -------------------------------------------------------------------------

  it("is a parse→serialize fixpoint and never accumulates blank lines", () => {
    const worklogPath = join(worklogDir, "cycle.md");
    const id = openThread({ worklogPath, slug: "cycle", stage: "planned" });
    appendThread({ worklogPath, threadId: id, section: "note", message: "first note" });
    closeThread({ worklogPath, threadId: id, status: "done" });

    const content = readFileSync(worklogPath, "utf-8");

    // parse→serialize→parse→serialize reaches a fixpoint on the CLI-written file.
    const once = serializeWorklogMarkdown(parseWorklogMarkdown(content));
    const twice = serializeWorklogMarkdown(parseWorklogMarkdown(once));
    expect(once).toBe(content);
    expect(twice).toBe(content);

    // No runs of 3+ newlines (would indicate blank-line accumulation).
    expect(content).not.toMatch(/\n\n\n/);
  });

  // -------------------------------------------------------------------------
  // 5. Fail-closed guard: a genuinely non-round-trippable file aborts untouched.
  // -------------------------------------------------------------------------

  it("refuses to rewrite a file it cannot round-trip and leaves it byte-identical", () => {
    const worklogPath = join(worklogDir, "dup.md");
    // Two `<!-- opened: ... -->` lines in one section: the second overwrites the
    // first in the model, so re-serializing would silently drop one line.
    const initial = [
      "## 01DUPLICATEDMETADATAXYZ-dup — dup",
      "<!-- opened: 2026-01-01T00:00:00.000Z -->",
      "<!-- opened: 2026-02-02T00:00:00.000Z -->",
      "### 2026-01-01T00:00:00.000Z [note]",
      "a note",
      "",
    ].join("\n");
    writeFileSync(worklogPath, initial, "utf-8");
    const before = readFileSync(worklogPath, "utf-8");

    expect(() => openThread({ worklogPath, slug: "should-not-write" })).toThrow(
      /would destroy/,
    );

    // The file on disk is untouched.
    const after = readFileSync(worklogPath, "utf-8");
    expect(after).toBe(before);
  });
});
