/**
 * Tests for `closeVigil` — terminal verdict stamping.
 *
 * pnpm exec vitest run test/vigil-close.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTracker, addVigil, closeVigil } from "../lib/tracker-writer.ts";
import { todayIso } from "../lib/dates.ts";

describe("close-vigil", () => {
  let tmpDir: string;
  let trackerRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-vigil-close-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function vigilFile(slug: string): string {
    return readFileSync(join(trackerRoot, "vigils", `${slug}.md`), "utf-8");
  }

  it("closes with a held verdict, stamping resolved to today by default", () => {
    addVigil({ trackerRoot, slug: "soak", name: "Soak", due: "2026-08-01" });
    const result = closeVigil({ trackerRoot, slug: "soak", verdict: "held" });
    expect(result.kind).toBe("closed");
    if (result.kind === "closed") {
      expect(result.verdict).toBe("held");
      expect(result.resolved).toBe(todayIso());
    }
    const content = vigilFile("soak");
    expect(content).toContain("verdict: held");
    expect(content).toContain(`resolved: ${todayIso()}`);
  });

  it("closes with a failed verdict", () => {
    addVigil({ trackerRoot, slug: "soak", name: "Soak", until: "batch" });
    const result = closeVigil({ trackerRoot, slug: "soak", verdict: "failed" });
    expect(result.kind).toBe("closed");
    if (result.kind === "closed") expect(result.verdict).toBe("failed");
    expect(vigilFile("soak")).toContain("verdict: failed");
  });

  it("honors an explicit --date for the resolved stamp", () => {
    addVigil({ trackerRoot, slug: "soak", name: "Soak", due: "2026-08-01" });
    const result = closeVigil({ trackerRoot, slug: "soak", verdict: "held", date: "2026-09-15" });
    if (result.kind === "closed") expect(result.resolved).toBe("2026-09-15");
    expect(vigilFile("soak")).toContain("resolved: 2026-09-15");
  });

  it("throws for an unknown vigil", () => {
    expect(() =>
      closeVigil({ trackerRoot, slug: "ghost", verdict: "held" }),
    ).toThrow(/not found/i);
  });

  it("is non-destructive when already closed (keeps original verdict)", () => {
    addVigil({ trackerRoot, slug: "soak", name: "Soak", due: "2026-08-01" });
    closeVigil({ trackerRoot, slug: "soak", verdict: "held", date: "2026-08-05" });
    const again = closeVigil({ trackerRoot, slug: "soak", verdict: "failed", date: "2026-09-01" });
    expect(again.kind).toBe("already-closed");
    if (again.kind === "already-closed") {
      expect(again.verdict).toBe("held");
      expect(again.resolved).toBe("2026-08-05");
    }
    // File must retain the original verdict + resolved date.
    const content = vigilFile("soak");
    expect(content).toContain("verdict: held");
    expect(content).toContain("resolved: 2026-08-05");
    expect(content).not.toContain("verdict: failed");
  });

  it("rejects an invalid verdict", () => {
    addVigil({ trackerRoot, slug: "soak", name: "Soak", due: "2026-08-01" });
    expect(() =>
      closeVigil({ trackerRoot, slug: "soak", verdict: "maybe" }),
    ).toThrow(/verdict/i);
  });

  it("updates the index: row leaves the open table, closed footnote appears", () => {
    addVigil({ trackerRoot, slug: "soak", name: "Soak", due: "2026-08-01" });
    let index = readFileSync(join(trackerRoot, "00-INDEX.md"), "utf-8");
    expect(index).toContain("| soak |");

    closeVigil({ trackerRoot, slug: "soak", verdict: "held" });
    index = readFileSync(join(trackerRoot, "00-INDEX.md"), "utf-8");
    // No open-table row for the now-closed vigil...
    expect(index).not.toContain("| soak |");
    // ...but a closed footnote records it.
    expect(index).toContain("_1 closed_");
  });
});
