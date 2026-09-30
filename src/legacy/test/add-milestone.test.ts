/**
 * Tests for `tracker add milestone`.
 *
 * pnpm vitest run add-milestone
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTracker, addMilestone } from "../lib/tracker-writer.ts";
import { parseFrontmatter } from "../lib/markdown/frontmatter.ts";

describe("add-milestone", () => {
  let tmpDir: string;
  let trackerRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-add-milestone-test-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates M1-<slug>/ directory", () => {
    const result = addMilestone({
      trackerRoot,
      name: "My Feature",
      slug: "my-feature",
      owner: "dev@example.com",
    });
    expect(result.kind).toBe("created");
    expect(existsSync(join(trackerRoot, "M1-my-feature"))).toBe(true);
  });

  it("creates 00-README.md inside the milestone directory", () => {
    addMilestone({
      trackerRoot,
      name: "My Feature",
      slug: "my-feature",
      owner: "dev@example.com",
    });
    expect(existsSync(join(trackerRoot, "M1-my-feature", "00-README.md"))).toBe(true);
  });

  it("substitutes milestone name in README", () => {
    addMilestone({
      trackerRoot,
      name: "My Feature",
      slug: "my-feature",
      owner: "dev@example.com",
    });
    const content = readFileSync(
      join(trackerRoot, "M1-my-feature", "00-README.md"),
      "utf-8",
    );
    expect(content).toContain("My Feature");
  });

  it("substitutes owner in README frontmatter", () => {
    addMilestone({
      trackerRoot,
      name: "My Feature",
      slug: "my-feature",
      owner: "dev@example.com",
    });
    const content = readFileSync(
      join(trackerRoot, "M1-my-feature", "00-README.md"),
      "utf-8",
    );
    expect(content).toContain("dev@example.com");
  });

  it("auto-increments milestone number to M2 when M1 exists", () => {
    addMilestone({
      trackerRoot,
      name: "First",
      slug: "first",
      owner: "dev@example.com",
    });
    const result = addMilestone({
      trackerRoot,
      name: "Second",
      slug: "second",
      owner: "dev@example.com",
    });
    expect(result.kind).toBe("created");
    if (result.kind === "created") {
      expect(result.number).toBe(2);
    }
    expect(existsSync(join(trackerRoot, "M2-second"))).toBe(true);
  });

  it("does not reassign a number occupied by an archived milestone (consolidated .md file)", () => {
    // Active tree only goes up to M2; archive holds a consolidated M5 doc.
    // Regression test for the M249 collision: the CLI must scan BOTH trees.
    addMilestone({
      trackerRoot,
      name: "First",
      slug: "first",
      owner: "dev@example.com",
    });
    addMilestone({
      trackerRoot,
      name: "Second",
      slug: "second",
      owner: "dev@example.com",
    });

    const archiveDir = join(trackerRoot, "archive");
    mkdirSync(archiveDir, { recursive: true });
    writeFileSync(join(archiveDir, "M5-archived-thing.md"), "# Archived Thing\n");

    const result = addMilestone({
      trackerRoot,
      name: "Third",
      slug: "third",
      owner: "dev@example.com",
    });

    expect(result.kind).toBe("created");
    if (result.kind === "created") {
      expect(result.number).toBe(6);
    }
    expect(existsSync(join(trackerRoot, "M6-third"))).toBe(true);
  });

  it("does not reassign a number occupied by a legacy archived milestone directory", () => {
    // Some older archives keep a directory layout (e.g. M11-quick-boost/)
    // instead of a single consolidated .md file — must be tolerated too.
    const archiveDir = join(trackerRoot, "archive");
    mkdirSync(join(archiveDir, "M9-legacy-thing"), { recursive: true });
    writeFileSync(
      join(archiveDir, "M9-legacy-thing", "00-README.md"),
      "# Legacy Thing\n",
    );

    const result = addMilestone({
      trackerRoot,
      name: "Fresh",
      slug: "fresh",
      owner: "dev@example.com",
    });

    expect(result.kind).toBe("created");
    if (result.kind === "created") {
      expect(result.number).toBe(10);
    }
    expect(existsSync(join(trackerRoot, "M10-fresh"))).toBe(true);
  });

  it("is idempotent: re-running with same slug returns {kind: 'exists'}", () => {
    addMilestone({
      trackerRoot,
      name: "My Feature",
      slug: "my-feature",
      owner: "dev@example.com",
    });

    const result = addMilestone({
      trackerRoot,
      name: "My Feature",
      slug: "my-feature",
      owner: "dev@example.com",
    });

    expect(result.kind).toBe("exists");
  });

  it("sets optional target date in frontmatter", () => {
    addMilestone({
      trackerRoot,
      name: "My Feature",
      slug: "my-feature",
      owner: "dev@example.com",
      target: "2026-12-31",
    });
    const content = readFileSync(
      join(trackerRoot, "M1-my-feature", "00-README.md"),
      "utf-8",
    );
    expect(content).toContain("2026-12-31");
  });

  it("regenerates 00-INDEX.md after creation", () => {
    addMilestone({
      trackerRoot,
      name: "My Feature",
      slug: "my-feature",
      owner: "dev@example.com",
    });
    const indexContent = readFileSync(join(trackerRoot, "00-INDEX.md"), "utf-8");
    expect(indexContent).toContain("My Feature");
  });

  it("bracket-prefixed name round-trips through frontmatter without a parse error", () => {
    const bracketName = "[INFRA] Workspace ergonomics";
    const result = addMilestone({
      trackerRoot,
      name: bracketName,
      slug: "workspace-ergonomics",
      owner: "dev@example.com",
    });
    expect(result.kind).toBe("created");

    const content = readFileSync(
      join(trackerRoot, "M1-workspace-ergonomics", "00-README.md"),
      "utf-8",
    );

    // Must not throw FrontmatterParseError ("Inline non-empty sequences are
    // not supported") — a bare `name: [INFRA] Workspace ergonomics` scalar
    // would be misread as an inline YAML sequence.
    const { data } = parseFrontmatter(content);
    expect(data.name).toBe(bracketName);
    expect(data.slug).toBe("workspace-ergonomics");
    expect(data.owner).toBe("dev@example.com");
  });
});
