/**
 * The `depends_on` forms a spec may use: block lists, flat inline lists
 * (`[02, 03]`) and bare sibling numbers (`02`). Nested lists stay refused,
 * with a message that names the problem and shows the fix.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FrontmatterParseError, parseFrontmatter } from "../lib/markdown/frontmatter.ts";
import { readTrackerState } from "../lib/tracker-reader.ts";
import { addMilestone, addSpec, initTracker } from "../lib/tracker-writer.ts";
import { expandBareSpecNumber, isBareSpecNumber } from "../lib/dep-ref.ts";

const frontmatter = (line: string) => `---\nupdated: 2026-06-10\n${line}\n---\n\nbody\n`;

describe("inline lists in frontmatter", () => {
  it("reads depends_on: [02, 03] as the strings 02 and 03", () => {
    expect(parseFrontmatter(frontmatter("depends_on: [02, 03]")).data["depends_on"]).toEqual(["02", "03"]);
  });

  it("reads one item, quoted items and a comma inside quotes", () => {
    expect(parseFrontmatter(frontmatter("depends_on: [02]")).data["depends_on"]).toEqual(["02"]);
    expect(parseFrontmatter(frontmatter(`depends_on: ["a.md", 'b, c.md']`)).data["depends_on"]).toEqual(["a.md", "b, c.md"]);
  });

  it("drops empty items and keeps an apostrophe inside a plain item", () => {
    expect(parseFrontmatter(frontmatter("depends_on: [02, ]")).data["depends_on"]).toEqual(["02"]);
    expect(parseFrontmatter(frontmatter("tags: [it's, b]")).data["tags"]).toEqual(["it's", "b"]);
  });

  it("gives the same data as block form", () => {
    const inline = parseFrontmatter(frontmatter("depends_on: [M1-x/01-a.md, 02]")).data;
    const block = parseFrontmatter(frontmatter("depends_on:\n  - M1-x/01-a.md\n  - 02")).data;
    expect(inline).toEqual(block);
  });

  it("still accepts the empty list", () => {
    expect(parseFrontmatter(frontmatter("depends_on: []")).data["depends_on"]).toEqual([]);
  });

  it("refuses a nested list with a clear message", () => {
    expect(() => parseFrontmatter(frontmatter("depends_on: [[02], 03]"))).toThrow(FrontmatterParseError);
    expect(() => parseFrontmatter(frontmatter("depends_on: [[02], 03]"))).toThrow(
      /Nested flow sequences and mappings are not supported \(line 3\).*Use block form\./u,
    );
  });

  it("refuses a flow mapping item and a missing closing bracket", () => {
    expect(() => parseFrontmatter(frontmatter("depends_on: [{a: 1}]"))).toThrow(/Nested flow/u);
    expect(() => parseFrontmatter(frontmatter("depends_on: [02, 03"))).toThrow(/no closing \]/u);
  });
});

describe("bare spec numbers", () => {
  const files = ["01-first.md", "02-second.md", "10-tenth.md", "10-twin.md"];

  it("detects a bare number", () => {
    expect(isBareSpecNumber("02")).toBe(true);
    expect(isBareSpecNumber("2")).toBe(true);
    expect(isBareSpecNumber("02-second.md")).toBe(false);
    expect(isBareSpecNumber("M1-x/02-second.md")).toBe(false);
  });

  it("expands 02 and 2 to the one file with that number", () => {
    expect(expandBareSpecNumber("02", files)).toBe("02-second.md");
    expect(expandBareSpecNumber("2", files)).toBe("02-second.md");
  });

  it("leaves an unknown number, an ambiguous number and a path unchanged", () => {
    expect(expandBareSpecNumber("07", files)).toBe("07");
    expect(expandBareSpecNumber("10", files)).toBe("10");
    expect(expandBareSpecNumber("M1-x/02-second.md", files)).toBe("M1-x/02-second.md");
  });
});

describe("depends_on in a tracker", () => {
  let tmpDir: string;
  let trackerRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-depends-forms-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    addMilestone({ trackerRoot, name: "Demo", slug: "demo", owner: "dev" });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const spec = (dependsOn: string, mark: " " | "x") => `---\nupdated: 2026-06-10\n${dependsOn}\n---\n\n# Spec\n\n- [${mark}] item\n`;
  const write = (file: string, body: string) => writeFileSync(join(trackerRoot, "M1-demo", file), body, "utf-8");
  const effective = () => Object.fromEntries(readTrackerState(trackerRoot).milestones[0]!.specs.map((s) => [s.file, s.effectiveStatus]));

  it("an inline list is not a broken spec", () => {
    write("01-first.md", spec("depends_on: []", "x"));
    write("02-second.md", spec("depends_on: [02]", " "));
    const milestone = readTrackerState(trackerRoot).milestones[0]!;
    expect(milestone.brokenSpecs).toEqual([]);
    expect(milestone.specs.map((s) => s.view.depends_on)).toEqual([[], ["02"]]);
  });

  it("a bare number waits on the sibling until it is Complete", () => {
    write("01-first.md", spec("depends_on: []", " "));
    write("02-second.md", spec("depends_on: [01]", " "));
    expect(effective()["02-second.md"]).toBe("Waiting");

    write("01-first.md", spec("depends_on: []", "x"));
    expect(effective()["02-second.md"]).toBe("Not Started");
  });

  it("a bare number that names no spec keeps the spec waiting", () => {
    write("01-first.md", spec("depends_on: [09]", " "));
    expect(effective()["01-first.md"]).toBe("Waiting");
  });

  it("add spec --depends-on writes a tracker-relative path for a bare number", () => {
    write("01-first.md", spec("depends_on: []", "x"));
    const result = addSpec({ trackerRoot, milestoneArg: "demo", name: "Third", template: "generic", dependsOn: ["01", "M1-demo/01-first.md"] });
    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;
    const raw = readFileSync(result.filePath, "utf-8");
    expect(raw).toContain("depends_on:\n  - M1-demo/01-first.md\n  - M1-demo/01-first.md\n");
  });

  it("add spec --depends-on refuses a number that names no spec", () => {
    expect(() => addSpec({ trackerRoot, milestoneArg: "demo", name: "Third", template: "generic", dependsOn: ["05"] })).toThrow(
      /--depends-on 05: expected exactly one spec numbered 05 in M1-demo/u,
    );
  });

  it("the status command lists a nested-list spec as broken", () => {
    write("01-first.md", spec("depends_on: []", "x"));
    write("02-second.md", spec("depends_on: [[01]]", " "));
    const result = spawnSync(
      "node",
      ["--experimental-strip-types", "--no-warnings", join(process.cwd(), "bin/tracker.mts"), "status"],
      { encoding: "utf-8", cwd: tmpDir, timeout: 30_000 },
    );
    expect(result.stdout).toContain("Broken Specs");
    expect(result.stdout).toContain("02-second.md");
    expect(result.stdout).toContain("Nested flow sequences");
  });
});
