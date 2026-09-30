/**
 * Regression test for the depends_on quote explosion.
 *
 * `mark` rewrites the whole frontmatter block on every call. The block
 * sequence collector used to push the raw item text, quotes included, so the
 * serializer re-quoted an already quoted item and the quote count doubled on
 * every write. A clean full filename must survive any number of marks
 * byte-identical, and a quoted item must be normalised once and then stay put.
 *
 * pnpm vitest run mark-depends-on-quoting
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTracker, addMilestone, markTask } from "../lib/tracker-writer.ts";
import { parseFrontmatter } from "../lib/markdown/frontmatter.ts";

const CHECKLIST = `
# My Spec

## Verification Checklist

### Implementation

- [ ] First task
- [ ] Second task
`;

function specWith(dependsOn: string[]): string {
  const deps = dependsOn.map((d) => `  - ${d}`).join("\n");
  return `---\nstatus: Not Started\nupdated: 2026-01-01\ndepends_on:\n${deps}\nagent: test\n---\n${CHECKLIST}`;
}

function frontmatterOf(raw: string): string {
  const end = raw.indexOf("\n---", 4);
  return raw.slice(0, end + 4);
}

/** The depends_on block only; the rest of the frontmatter carries timestamps. */
function dependsBlockOf(raw: string): string {
  const lines = frontmatterOf(raw).split("\n");
  const start = lines.findIndex((l) => l.startsWith("depends_on:"));
  if (start === -1) throw new Error("no depends_on in frontmatter");
  const block = [lines[start]!];
  for (let i = start + 1; i < lines.length; i++) {
    if (!/^\s+- /.test(lines[i]!)) break;
    block.push(lines[i]!);
  }
  return block.join("\n");
}

describe("mark does not re-quote depends_on", () => {
  let tmpDir: string;
  let trackerRoot: string;
  let specPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-depends-on-test-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    addMilestone({
      trackerRoot,
      name: "Test Milestone",
      slug: "test-milestone",
      owner: "dev@example.com",
    });
    specPath = join(trackerRoot, "M1-test-milestone", "02-my-spec.md");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("leaves a clean full filename byte-identical across two marks", () => {
    writeFileSync(specPath, specWith(["01-first-spec.md"]), "utf-8");

    markTask({ specPath, taskIndex: 0, state: "verified", trackerRoot });
    const rawFirst = readFileSync(specPath, "utf-8");
    const afterFirst = dependsBlockOf(rawFirst);

    markTask({ specPath, taskIndex: 1, state: "verified", trackerRoot });
    const rawSecond = readFileSync(specPath, "utf-8");
    const afterSecond = dependsBlockOf(rawSecond);

    expect(afterFirst).toContain("  - 01-first-spec.md");
    expect(afterSecond).toBe(afterFirst);
    expect(afterSecond).not.toMatch(/['"]/);
    expect(frontmatterOf(rawSecond)).not.toMatch(/['"]/);
    expect(parseFrontmatter(readFileSync(specPath, "utf-8")).data["depends_on"]).toEqual([
      "01-first-spec.md",
    ]);
  });

  // Control case: a quoted item is the shape that used to double its quotes.
  it("normalises a quoted item once and then keeps it stable", () => {
    writeFileSync(specPath, specWith(["'01-first-spec.md'"]), "utf-8");

    markTask({ specPath, taskIndex: 0, state: "verified", trackerRoot });
    const rawFirst = readFileSync(specPath, "utf-8");
    const afterFirst = dependsBlockOf(rawFirst);

    markTask({ specPath, taskIndex: 1, state: "verified", trackerRoot });
    const rawSecond = readFileSync(specPath, "utf-8");
    const afterSecond = dependsBlockOf(rawSecond);

    expect(afterFirst).toContain("  - 01-first-spec.md");
    expect(afterFirst).not.toMatch(/['"]/);
    expect(afterSecond).toBe(afterFirst);
  });

  it("does not grow the quote count on a repeatedly marked spec", () => {
    writeFileSync(specPath, specWith(["01-first-spec.md"]), "utf-8");

    for (let i = 0; i < 4; i++) {
      markTask({ specPath, taskIndex: i % 2, state: "verified", trackerRoot });
    }

    const raw = readFileSync(specPath, "utf-8");
    expect(frontmatterOf(raw)).not.toMatch(/['"]/);
  });
});
