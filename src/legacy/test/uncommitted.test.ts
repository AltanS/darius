/**
 * Tests for the verified-but-uncommitted selector (commit-first gate).
 *
 * pnpm vitest run uncommitted
 */

import { describe, it, expect } from "vitest";
import {
  parsePorcelainLine,
  selectVerifiedUncommitted,
  hasVerificationPassed,
} from "../lib/uncommitted.ts";

describe("parsePorcelainLine", () => {
  it("splits the two-column status from the path", () => {
    expect(parsePorcelainLine(" M .tracker/M1-foo/01-bar.md")).toEqual({
      status: " M",
      path: ".tracker/M1-foo/01-bar.md",
    });
  });

  it("takes the new path on a rename", () => {
    expect(
      parsePorcelainLine("R  old/path.md -> .tracker/M1-foo/01-bar.md"),
    ).toEqual({ status: "R ", path: ".tracker/M1-foo/01-bar.md" });
  });

  it("handles untracked files", () => {
    expect(parsePorcelainLine("?? .tracker/M2-baz/02-qux.md")).toEqual({
      status: "??",
      path: ".tracker/M2-baz/02-qux.md",
    });
  });

  it("returns null for too-short lines", () => {
    expect(parsePorcelainLine("")).toBeNull();
    expect(parsePorcelainLine(" M ")).toBeNull();
  });
});

describe("hasVerificationPassed", () => {
  it("detects a stamped timestamp", () => {
    expect(
      hasVerificationPassed("---\nverification_passed: 2026-05-29T10:00:00Z\n---\n"),
    ).toBe(true);
  });

  it("tolerates quoted values", () => {
    expect(
      hasVerificationPassed(`---\nverification_passed: "2026-05-29T10:00:00Z"\n---`),
    ).toBe(true);
  });

  it("is false when absent", () => {
    expect(hasVerificationPassed("---\ncounsel: 2026-05-29\n---\n")).toBe(false);
  });

  it("is false when present but empty", () => {
    expect(hasVerificationPassed("---\nverification_passed:\n---\n")).toBe(false);
  });
});

describe("selectVerifiedUncommitted", () => {
  const verified = (p: string) => p.includes("verified");

  it("flags a dirty spec that is verified", () => {
    const porcelain = " M .tracker/M1-foo/01-verified.md\n";
    const result = selectVerifiedUncommitted(porcelain, verified);
    expect(result).toEqual([
      { path: ".tracker/M1-foo/01-verified.md", gitStatus: " M" },
    ]);
  });

  it("ignores a dirty spec that is NOT verified (in-progress edit)", () => {
    const porcelain = " M .tracker/M1-foo/01-draft.md\n";
    expect(selectVerifiedUncommitted(porcelain, verified)).toEqual([]);
  });

  it("ignores non-spec tracker files (index, worklog, README)", () => {
    const porcelain =
      " M .tracker/00-INDEX.md\n" +
      " M .tracker/worklog/M1-verified.md\n" +
      " M .tracker/M1-foo/00-README.md\n";
    expect(selectVerifiedUncommitted(porcelain, () => true)).toEqual([]);
  });

  it("ignores non-tracker code files", () => {
    const porcelain = " M src/verified-feature.ts\n";
    expect(selectVerifiedUncommitted(porcelain, () => true)).toEqual([]);
  });

  it("collects multiple verified specs and dedupes", () => {
    const porcelain =
      " M .tracker/M1-foo/01-verified.md\n" +
      "?? .tracker/M2-bar/03-verified.md\n" +
      " M .tracker/M1-foo/01-verified.md\n";
    const result = selectVerifiedUncommitted(porcelain, verified);
    expect(result.map((r) => r.path)).toEqual([
      ".tracker/M1-foo/01-verified.md",
      ".tracker/M2-bar/03-verified.md",
    ]);
  });

  it("returns empty on a clean tree", () => {
    expect(selectVerifiedUncommitted("", () => true)).toEqual([]);
  });

  it("matches specs nested under a deeper repo path", () => {
    const porcelain = " M packages/app/.tracker/M5-x/02-verified.md\n";
    const result = selectVerifiedUncommitted(porcelain, verified);
    expect(result).toHaveLength(1);
  });
});
