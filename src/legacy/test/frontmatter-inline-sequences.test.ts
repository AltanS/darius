/**
 * Tests for the non-throwing inline-sequence scanner/rewriter in
 * lib/markdown/frontmatter.ts — the detection + auto-fix machinery behind
 * the `tracker doctor` inline-sequence check.
 */

import { describe, it, expect } from "vitest";
import {
  parseFrontmatter,
  findInlineSequences,
  rewriteInlineSequences,
} from "../lib/markdown/frontmatter.ts";

describe("findInlineSequences", () => {
  it("returns empty for well-formed frontmatter (no false positives)", () => {
    const raw = `---
title: Something
depends_on:
  - 01-first.md
tags: []
---

body
`;
    expect(findInlineSequences(raw)).toEqual([]);
  });

  it("returns empty for content with no frontmatter", () => {
    expect(findInlineSequences("just a markdown file\n")).toEqual([]);
  });

  it("detects a single inline sequence with its key, line, and parsed items", () => {
    const raw = `---
title: Foo
depends_on: [01-first.md, 02-second.md]
---

body
`;
    const issues = findInlineSequences(raw);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      key: "depends_on",
      line: 3,
      items: ["01-first.md", "02-second.md"],
    });
  });

  it("unquotes single- and double-quoted inline items", () => {
    const raw = `---
depends_on: ["01-first.md", '02-second.md']
---
`;
    const issues = findInlineSequences(raw);
    expect(issues[0]!.items).toEqual(["01-first.md", "02-second.md"]);
  });

  it("detects multiple inline-sequence keys in one file", () => {
    const raw = `---
depends_on: [01-first.md]
blocks: [02-second.md, 03-third.md]
---
`;
    const issues = findInlineSequences(raw);
    expect(issues.map((i) => i.key)).toEqual(["depends_on", "blocks"]);
  });
});

describe("rewriteInlineSequences", () => {
  it("returns the input unchanged when there is nothing to rewrite", () => {
    const raw = `---
depends_on:
  - 01-first.md
---

body
`;
    const { raw: rewritten, rewrites } = rewriteInlineSequences(raw);
    expect(rewritten).toBe(raw);
    expect(rewrites).toEqual([]);
  });

  it("rewrites an inline sequence to block form and stays parseable", () => {
    const raw = `---
title: Foo
depends_on: [01-first.md, 02-second.md]
updated: 2026-01-01
---

# Foo

body content
`;
    const { raw: rewritten, rewrites } = rewriteInlineSequences(raw);
    expect(rewrites).toHaveLength(1);
    expect(rewritten).toContain("depends_on:\n  - 01-first.md\n  - 02-second.md\n");

    // Round-trips through the strict parser cleanly.
    const { data, content } = parseFrontmatter(rewritten);
    expect(data.depends_on).toEqual(["01-first.md", "02-second.md"]);
    expect(data.title).toBe("Foo");
    expect(data.updated).toBe("2026-01-01");
    expect(content).toContain("body content");
  });

  it("preserves surrounding keys, ordering, and the markdown body untouched", () => {
    const raw = `---
a: 1
depends_on: [x.md]
b: 2
---

# Body

- [ ] task
`;
    const { raw: rewritten } = rewriteInlineSequences(raw);
    const { data, content } = parseFrontmatter(rewritten);
    expect(Object.keys(data)).toEqual(["a", "depends_on", "b"]);
    expect(content).toBe("\n# Body\n\n- [ ] task\n");
  });
});
