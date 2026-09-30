/**
 * Namespace guard — archived milestones under ANY prefix occupy their number.
 *
 * Background: per-repo trackers were merged into one workspace tracker (M231)
 * and their milestones were archived under a source prefix (DLP = acme-web,
 * ATH, BLD = other source repos) rather than renumbered. `getNextMilestoneNumber`
 * scanned `^M\d+-` only, so with archived DLP252–DLP269 present the next 18
 * mints would each have collided with an archived acme-web milestone — the same
 * "269 means two different things" ambiguity M231 was supposed to end.
 *
 * pnpm vitest run milestone-namespace-guard
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initTracker,
  addMilestone,
  assertMilestoneNumberAvailable,
  collectOccupiedMilestoneNumbers,
  MILESTONE_ID_PREFIXES,
} from "../lib/tracker-writer.ts";

/** Build the archive fixture: a consolidated archived milestone doc. */
function archiveDoc(trackerRoot: string, fileName: string): void {
  const archiveDir = join(trackerRoot, "archive");
  mkdirSync(archiveDir, { recursive: true });
  writeFileSync(join(archiveDir, fileName), `# ${fileName}\n`, "utf-8");
}

describe("milestone namespace guard", () => {
  let tmpDir: string;
  let trackerRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-namespace-guard-test-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Auto-mint
  // -------------------------------------------------------------------------

  it("mints above an archived DLP269 (the real workspace fixture)", () => {
    archiveDoc(trackerRoot, "DLP269-football-fixture-venue-integrity.md");

    const result = addMilestone({
      trackerRoot,
      name: "Next Thing",
      slug: "next-thing",
      owner: "dev@example.com",
    });

    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;
    expect(result.number).toBe(270);
    expect(existsSync(join(trackerRoot, "M270-next-thing"))).toBe(true);
  });

  it("mints above the max across ALL prefixes, not just M", () => {
    archiveDoc(trackerRoot, "M230-old-workspace-thing.md");
    archiveDoc(trackerRoot, "ATH2-revenue-report-accuracy.md");
    archiveDoc(trackerRoot, "BLD17-homepage-query-performance.md");
    archiveDoc(trackerRoot, "DLP269-football-fixture-venue-integrity.md");

    const result = addMilestone({
      trackerRoot,
      name: "Across Prefixes",
      slug: "across-prefixes",
      owner: "dev@example.com",
    });

    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;
    expect(result.number).toBe(270);
  });

  it("mints above a prefixed archive even when the active tree is lower", () => {
    // Reproduces the exact reported hazard: active tree at M251, archive
    // holding DLP252–DLP269 → the pre-fix CLI would have minted M252.
    addMilestone({
      trackerRoot,
      name: "Active",
      slug: "active",
      owner: "dev@example.com",
      number: 251,
    });
    for (let n = 252; n <= 269; n++) {
      archiveDoc(trackerRoot, `DLP${n}-acme-web-thing.md`);
    }

    const result = addMilestone({
      trackerRoot,
      name: "Fresh",
      slug: "fresh",
      owner: "dev@example.com",
    });

    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;
    expect(result.number).toBe(270);
  });

  it("counts a legacy archived DIRECTORY under a prefix, not just .md files", () => {
    mkdirSync(join(trackerRoot, "archive", "DLP42-legacy-dir"), { recursive: true });
    writeFileSync(
      join(trackerRoot, "archive", "DLP42-legacy-dir", "00-README.md"),
      "# Legacy\n",
      "utf-8",
    );

    const result = addMilestone({
      trackerRoot,
      name: "After Legacy",
      slug: "after-legacy",
      owner: "dev@example.com",
    });

    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;
    expect(result.number).toBe(43);
  });

  it("ignores date-stamped and unprefixed archive entries", () => {
    // A `2026-07-29-*.md` note must never be read as milestone 2026.
    archiveDoc(trackerRoot, "2026-07-29-retro-notes.md");
    archiveDoc(trackerRoot, "MIGRATION-MAP.md");
    archiveDoc(trackerRoot, "DLP-03-ENHANCED-MATCH-CONTEXT.md");

    const result = addMilestone({
      trackerRoot,
      name: "Unaffected",
      slug: "unaffected",
      owner: "dev@example.com",
    });

    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;
    expect(result.number).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Explicit-number collision refusal
  // -------------------------------------------------------------------------

  it("refuses an explicit number held by an archived DLP milestone, naming it", () => {
    archiveDoc(trackerRoot, "DLP269-football-fixture-venue-integrity.md");

    expect(() =>
      addMilestone({
        trackerRoot,
        name: "Collider",
        slug: "collider",
        owner: "dev@example.com",
        number: 269,
      }),
    ).toThrow(/DLP269-football-fixture-venue-integrity\.md/);

    // …and nothing was created.
    expect(existsSync(join(trackerRoot, "M269-collider"))).toBe(false);
  });

  it("refuses an explicit number held by an ACTIVE milestone, naming it", () => {
    addMilestone({
      trackerRoot,
      name: "First",
      slug: "first",
      owner: "dev@example.com",
    });

    expect(() =>
      addMilestone({
        trackerRoot,
        name: "Second",
        slug: "second",
        owner: "dev@example.com",
        number: 1,
      }),
    ).toThrow(/M1-first/);
  });

  it("accepts an explicit number nobody holds", () => {
    archiveDoc(trackerRoot, "DLP269-acme-web-thing.md");

    const result = addMilestone({
      trackerRoot,
      name: "Gap Filler",
      slug: "gap-filler",
      owner: "dev@example.com",
      number: 300,
    });

    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;
    expect(result.number).toBe(300);
    expect(existsSync(join(trackerRoot, "M300-gap-filler"))).toBe(true);
  });

  it("rejects a non-positive explicit number", () => {
    expect(() =>
      addMilestone({
        trackerRoot,
        name: "Zero",
        slug: "zero",
        owner: "dev@example.com",
        number: 0,
      }),
    ).toThrow(/Invalid milestone number/);
  });

  // -------------------------------------------------------------------------
  // Guard primitives
  // -------------------------------------------------------------------------

  it("assertMilestoneNumberAvailable names the collider for every prefix", () => {
    archiveDoc(trackerRoot, "DLP269-d.md");
    archiveDoc(trackerRoot, "ATH2-a.md");
    archiveDoc(trackerRoot, "BLD17-b.md");
    archiveDoc(trackerRoot, "M230-m.md");

    for (const [n, needle] of [
      [269, "DLP269-d.md"],
      [2, "ATH2-a.md"],
      [17, "BLD17-b.md"],
      [230, "M230-m.md"],
    ] as const) {
      expect(() => assertMilestoneNumberAvailable(trackerRoot, n)).toThrow(needle);
    }
    expect(() => assertMilestoneNumberAvailable(trackerRoot, 999)).not.toThrow();
  });

  it("collectOccupiedMilestoneNumbers reports every claimed number once", () => {
    archiveDoc(trackerRoot, "DLP269-d.md");
    archiveDoc(trackerRoot, "M230-m.md");
    addMilestone({
      trackerRoot,
      name: "Active",
      slug: "active",
      owner: "dev@example.com",
      number: 5,
    });

    const occupied = collectOccupiedMilestoneNumbers(trackerRoot);
    expect(occupied.get(269)).toBe("DLP269-d.md");
    expect(occupied.get(230)).toBe("M230-m.md");
    expect(occupied.get(5)).toBe("M5-active");
    expect(occupied.has(6)).toBe(false);
  });

  it("documents the guarded prefix set", () => {
    expect([...MILESTONE_ID_PREFIXES]).toEqual(["M", "DLP", "ATH", "BLD", "DJ"]);
  });

  // -------------------------------------------------------------------------
  // DJ — an archived-source prefix, folded in by the 2026-04-20 M40 consolidation and
  // documented in the workspace MIGRATION-MAP ("DJ{n} | pre-existing | ops
  // milestones merged in the 2026-04-20 M40 consolidation"). 89 DJ entries sit
  // in .tracker/archive/ today, so leaving it out of the namespace made
  // `--number 88` accept a number DJ88 already holds.
  // -------------------------------------------------------------------------

  it("mints above an archived DJ milestone", () => {
    archiveDoc(trackerRoot, "DJ88-ops-thing.md");

    const result = addMilestone({
      trackerRoot,
      name: "After Ops",
      slug: "after-ops",
      owner: "dev@example.com",
    });

    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;
    expect(result.number).toBe(89);
  });

  it("refuses an explicit number held by an archived DJ milestone, naming it", () => {
    archiveDoc(trackerRoot, "DJ88-ops-thing.md");

    expect(() =>
      addMilestone({
        trackerRoot,
        name: "Collider",
        slug: "collider",
        owner: "dev@example.com",
        number: 88,
      }),
    ).toThrow(/DJ88-ops-thing\.md/);

    expect(existsSync(join(trackerRoot, "M88-collider"))).toBe(false);
  });

  it("does not read a DJ-prefixed non-milestone doc as a number", () => {
    // `OPS-NOTES.md` starts with the DJ prefix but has no `<digits>-`
    // immediately after it, so the anchored id regex must not match.
    archiveDoc(trackerRoot, "OPS-NOTES.md");

    const occupied = collectOccupiedMilestoneNumbers(trackerRoot);
    expect(occupied.size).toBe(0);
  });

  it("still works on a tracker with no archive/ at all", () => {
    const result = addMilestone({
      trackerRoot,
      name: "No Archive",
      slug: "no-archive",
      owner: "dev@example.com",
    });
    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;
    expect(result.number).toBe(1);
  });
});
