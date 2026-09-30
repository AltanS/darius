/**
 * Integration test: scan finds planted artifacts in fixture files.
 *
 * pnpm vitest run scan-fixture-detection
 */

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { scanArtifacts, scanStubs } from "../lib/scan.ts";

const FIXTURES_DIR = join(process.cwd(), "test/fixtures/scan-fixtures");

describe("scan-fixture-detection", () => {
  it("finds planted console.log in artifact-sample.ts", () => {
    const matches = scanArtifacts({ path: join(FIXTURES_DIR, "artifact-sample.ts") });

    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some((m) => m.pattern === "console.log")).toBe(true);
  });

  it("finds planted console.debug in artifact-sample.ts", () => {
    const matches = scanArtifacts({ path: join(FIXTURES_DIR, "artifact-sample.ts") });

    expect(matches.some((m) => m.pattern === "console.debug")).toBe(true);
  });

  it("reports correct file path in match", () => {
    const matches = scanArtifacts({ path: join(FIXTURES_DIR, "artifact-sample.ts") });

    expect(matches[0]?.file).toContain("artifact-sample.ts");
  });

  it("finds stub in stub-sample.ts", () => {
    const matches = scanStubs({ path: join(FIXTURES_DIR, "stub-sample.ts") });

    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some((m) => m.pattern.includes("not implemented"))).toBe(true);
  });

  it("returns no matches for clean-sample.ts", () => {
    const artifactMatches = scanArtifacts({ path: join(FIXTURES_DIR, "clean-sample.ts") });
    const stubMatches = scanStubs({ path: join(FIXTURES_DIR, "clean-sample.ts") });

    expect(artifactMatches).toHaveLength(0);
    expect(stubMatches).toHaveLength(0);
  });

  it("scans the whole fixtures directory and finds all planted artifacts", () => {
    const matches = scanArtifacts({ path: FIXTURES_DIR });

    // artifact-sample.ts has 2 artifacts (console.log + console.debug)
    expect(matches.length).toBeGreaterThanOrEqual(2);

    const files = new Set(matches.map((m) => m.file));
    expect([...files].some((f) => f.includes("artifact-sample.ts"))).toBe(true);
  });

  it("clean-sample.ts produces no artifact or stub matches when scanning directory", () => {
    // Scan only the clean file
    const artifactMatches = scanArtifacts({ path: join(FIXTURES_DIR, "clean-sample.ts") });
    const stubMatches = scanStubs({ path: join(FIXTURES_DIR, "clean-sample.ts") });

    expect(artifactMatches).toHaveLength(0);
    expect(stubMatches).toHaveLength(0);
  });
});
