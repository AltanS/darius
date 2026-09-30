/**
 * Tests for `addVigil` (vigils/<slug>.md scaffolding).
 *
 * pnpm exec vitest run test/vigil-add.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTracker, addVigil } from "../lib/tracker-writer.ts";
import { readTrackerState } from "../lib/tracker-reader.ts";
import { todayIso } from "../lib/dates.ts";

describe("add-vigil", () => {
  let tmpDir: string;
  let trackerRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-vigil-add-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function vigilFile(slug: string): string {
    return readFileSync(join(trackerRoot, "vigils", `${slug}.md`), "utf-8");
  }

  it("creates vigils/<slug>.md (flat — no runs/ subdir)", () => {
    const result = addVigil({
      trackerRoot,
      slug: "s02-soak",
      name: "S02 scorer-attribution soak",
      due: "2026-08-01",
    });
    expect(result.kind).toBe("created");
    expect(existsSync(join(trackerRoot, "vigils", "s02-soak.md"))).toBe(true);
    expect(existsSync(join(trackerRoot, "vigils", "s02-soak", "runs"))).toBe(false);
  });

  it("writes type/name/slug/due/until/from/opened frontmatter", () => {
    addVigil({
      trackerRoot,
      slug: "s02-soak",
      name: "S02 scorer-attribution soak",
      due: "2026-08-01",
      until: "first real qualifier batch",
      from: "M77/S02",
    });
    const content = vigilFile("s02-soak");
    expect(content).toContain("type: vigil");
    expect(content).toContain("name: S02 scorer-attribution soak");
    expect(content).toContain("slug: s02-soak");
    expect(content).toContain("due: 2026-08-01");
    expect(content).toContain("until: first real qualifier batch");
    expect(content).toContain("from: M77/S02");
    expect(content).toContain(`opened: ${todayIso()}`);
    expect(content).toContain("# S02 scorer-attribution soak");
    expect(content).toContain("## Verification Checklist");
  });

  it("leaves resolved/verdict empty on a fresh vigil", () => {
    addVigil({ trackerRoot, slug: "s02-soak", name: "Soak", until: "batch" });
    const content = vigilFile("s02-soak");
    expect(content).toMatch(/\nresolved:\s*\n/);
    expect(content).toMatch(/\nverdict:\s*\n?/);
  });

  it("defaults name to slug and sets the agent in frontmatter", () => {
    addVigil({
      trackerRoot,
      slug: "gate-soak",
      name: "gate-soak",
      due: "2026-08-01",
      agent: "typescript:typescript-expert",
    });
    const content = vigilFile("gate-soak");
    expect(content).toContain("name: gate-soak");
    expect(content).toContain("agent: typescript:typescript-expert");
  });

  it("honors an explicit opened date", () => {
    addVigil({ trackerRoot, slug: "soak", name: "Soak", until: "batch", opened: "2026-07-01" });
    expect(vigilFile("soak")).toContain("opened: 2026-07-01");
  });

  it("YAML-safely serializes an `until` containing colons and quotes (round-trips)", () => {
    const tricky = "grep prod for [SCORER]: user's first batch";
    addVigil({ trackerRoot, slug: "tricky", name: "Tricky", until: tricky });
    // Round-trip through the real reader — the value must come back intact.
    const state = readTrackerState(trackerRoot);
    const v = state.vigils.find((x) => x.slug === "tricky");
    expect(v).toBeDefined();
    expect(v!.until).toBe(tricky);
  });

  it("requires at least one gate (due and/or until)", () => {
    expect(() =>
      addVigil({ trackerRoot, slug: "no-gate", name: "No Gate" }),
    ).toThrow(/gate/i);
  });

  it("accepts an until-only (event-gated) vigil with no due date", () => {
    const result = addVigil({ trackerRoot, slug: "event-only", name: "Event", until: "batch ships" });
    expect(result.kind).toBe("created");
  });

  it("rejects an invalid due date", () => {
    expect(() =>
      addVigil({ trackerRoot, slug: "bad-due", name: "Bad", due: "08/01/2026" }),
    ).toThrow(/due/i);
  });

  it("rejects a bad slug (uppercase/spaces/path chars)", () => {
    expect(() =>
      addVigil({ trackerRoot, slug: "Bad Slug!", name: "Bad", due: "2026-08-01" }),
    ).toThrow(/slug/i);
  });

  it("is idempotent: re-running the same slug returns {kind:'exists'}", () => {
    addVigil({ trackerRoot, slug: "s02-soak", name: "Soak", due: "2026-08-01" });
    const again = addVigil({ trackerRoot, slug: "s02-soak", name: "Soak", due: "2026-08-01" });
    expect(again.kind).toBe("exists");
  });

  it("regenerates the index with a Vigils table row", () => {
    addVigil({
      trackerRoot,
      slug: "s02-soak",
      name: "Soak",
      due: "2026-08-01",
      until: "first real qualifier batch",
      from: "M77/S02",
    });
    const index = readFileSync(join(trackerRoot, "00-INDEX.md"), "utf-8");
    expect(index).toContain("## Vigils");
    expect(index).toContain("| Vigil | Waiting on | Due | Opened | From |");
    expect(index).toContain("| s02-soak | first real qualifier batch | 2026-08-01 |");
  });
});
