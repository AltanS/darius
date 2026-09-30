/**
 * Parser tests for the `<!-- opened: -->` thread marker rule (M7/01).
 *
 * Before the rule, every `^## ` line started a thread — so a pre-CLI freeform
 * worklog full of plain section headers (`## Root cause`, `## Files you OWN`)
 * shredded into fake, perpetually-open, zero-entry threads, each stamped with a
 * fresh `new Date()` timestamp on every parse. A heading is now a thread only
 * when an `<!-- opened: ... -->` marker follows it before any content line.
 *
 * pnpm vitest run worklog-legacy-parse
 */

import { describe, it, expect } from "vitest";
import { parseWorklogMarkdown } from "../lib/worklog.ts";

const LEGACY = [
  "# Worklog — investigation",
  "",
  "## Root cause",
  "The parser treated every heading as a thread.",
  "",
  "## Files you OWN",
  "- lib/worklog.ts",
  "",
].join("\n");

const CLI_FORMAT = [
  "# Worklog — M1",
  "",
  "## 01ABCDEFGHJKMNPQRSTV-alpha — alpha",
  "<!-- opened: 2026-01-01T00:00:00.000Z -->",
  "<!-- spec: .tracker/M1-x/01-y.md -->",
  "<!-- stage: planned -->",
  "### 2026-01-01T00:00:00.000Z [note]",
  "a note",
  "",
].join("\n");

describe("worklog parser — legacy heading folding", () => {
  // -------------------------------------------------------------------------
  // 1. Unmarked headings never become threads.
  // -------------------------------------------------------------------------

  it("parses a pure legacy file as zero threads with every line in the preamble", () => {
    const doc = parseWorklogMarkdown(LEGACY);

    expect(doc.threads).toEqual([]);
    expect(doc.foldedHeadings).toBe(2);
    expect(doc.preamble.join("\n")).toBe(LEGACY);
  });

  it("does not fabricate an openedAt timestamp for folded headings", () => {
    // The old fallback stamped `new Date()` on every unmarked heading, making
    // the parse both fake and nondeterministic.
    const first = parseWorklogMarkdown(LEGACY);
    const second = parseWorklogMarkdown(LEGACY);

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toMatch(new Date().toISOString().slice(0, 10));
  });

  // -------------------------------------------------------------------------
  // 2. Marked headings are still threads.
  // -------------------------------------------------------------------------

  it("still parses a marked heading as a thread and reads openedAt from the marker", () => {
    const doc = parseWorklogMarkdown(CLI_FORMAT);

    expect(doc.threads).toHaveLength(1);
    expect(doc.foldedHeadings).toBe(0);
    const thread = doc.threads[0]!;
    expect(thread.threadId).toBe("01ABCDEFGHJKMNPQRSTV-alpha");
    expect(thread.openedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(thread.specPath).toBe(".tracker/M1-x/01-y.md");
    expect(thread.stage).toBe("planned");
    expect(thread.entries).toHaveLength(1);
  });

  it("accepts a marker sitting behind blank lines and other metadata comments", () => {
    const doc = parseWorklogMarkdown(
      [
        "## 01ABCDEFGHJKMNPQRSTV-beta — beta",
        "",
        "<!-- spec: .tracker/M1-x/01-y.md -->",
        "<!-- opened: 2026-02-02T00:00:00.000Z -->",
        "",
      ].join("\n"),
    );

    expect(doc.threads).toHaveLength(1);
    expect(doc.threads[0]!.openedAt).toBe("2026-02-02T00:00:00.000Z");
  });

  it("rejects a marker that only appears after a content line", () => {
    // Prose between the heading and the marker means the marker belongs to a
    // later section, not this heading.
    const doc = parseWorklogMarkdown(
      [
        "## Root cause",
        "some prose",
        "<!-- opened: 2026-02-02T00:00:00.000Z -->",
        "",
      ].join("\n"),
    );

    expect(doc.threads).toEqual([]);
    expect(doc.foldedHeadings).toBe(1);
  });

  it("stops the lookahead at the next heading", () => {
    const doc = parseWorklogMarkdown(
      [
        "## Root cause",
        "",
        "## 01ABCDEFGHJKMNPQRSTV-gamma — gamma",
        "<!-- opened: 2026-03-03T00:00:00.000Z -->",
        "",
      ].join("\n"),
    );

    expect(doc.foldedHeadings).toBe(1);
    expect(doc.threads).toHaveLength(1);
    expect(doc.threads[0]!.threadId).toBe("01ABCDEFGHJKMNPQRSTV-gamma");
    expect(doc.preamble).toEqual(["## Root cause", ""]);
  });

  // -------------------------------------------------------------------------
  // 3. Mixed files: legacy prose above, between and after real threads.
  // -------------------------------------------------------------------------

  it("folds legacy sections around real threads without losing them", () => {
    const doc = parseWorklogMarkdown(
      [
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
      ].join("\n"),
    );

    expect(doc.threads.map((t) => t.threadId)).toEqual([
      "01ABCDEFGHJKMNPQRSTV-alpha",
      "01ABCDEFGHJKMNPQRSTW-omega",
    ]);
    expect(doc.foldedHeadings).toBe(2);
    // The pre-thread section stays in the preamble…
    expect(doc.preamble).toContain("## Background");
    expect(doc.preamble).toContain("prose before any thread");
    // …and the in-thread section becomes that thread's freeform.
    expect(doc.threads[0]!.freeform).toEqual([
      "## Notes inside the thread",
      "freeform under a folded heading",
    ]);
  });

  // -------------------------------------------------------------------------
  // 4. No fabricated timestamps anywhere in the parser.
  // -------------------------------------------------------------------------

  it("has no `new Date()` fallback left in parseWorklogMarkdown", () => {
    const source = parseWorklogMarkdown.toString();
    expect(source).not.toContain("new Date()");
  });
});
