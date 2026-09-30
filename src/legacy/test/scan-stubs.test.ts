/**
 * Tests for `tracker scan stubs`.
 *
 * pnpm vitest run scan-stubs
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanStubs } from "../lib/scan.ts";

describe("scan-stubs", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-scan-stubs-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds throw new Error("not implemented")', () => {
    const file = join(tmpDir, "stub.ts");
    writeFileSync(
      file,
      'function foo() {\n  throw new Error("not implemented");\n}\n',
      "utf-8",
    );

    const matches = scanStubs({ path: tmpDir });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.pattern).toContain("not implemented");
  });

  it('finds throw new Error("TODO")', () => {
    const file = join(tmpDir, "stub.ts");
    writeFileSync(
      file,
      "function bar() {\n  throw new Error('TODO');\n}\n",
      "utf-8",
    );

    const matches = scanStubs({ path: tmpDir });
    expect(matches.length).toBeGreaterThan(0);
  });

  it("finds trivial expect(true).toBe(true)", () => {
    const file = join(tmpDir, "trivial.test.ts");
    writeFileSync(
      file,
      "it('test', () => {\n  expect(true).toBe(true);\n});\n",
      "utf-8",
    );

    const matches = scanStubs({ path: tmpDir });
    expect(matches.some((m) => m.pattern === "trivial assertion")).toBe(true);
  });

  it("finds return null as only return in a function body context", () => {
    const file = join(tmpDir, "nullable.ts");
    writeFileSync(
      file,
      "function stub(): string | null {\n  return null;\n}\n",
      "utf-8",
    );

    const matches = scanStubs({ path: tmpDir });
    expect(matches.some((m) => m.pattern.includes("return null"))).toBe(true);
  });

  it("finds return undefined", () => {
    const file = join(tmpDir, "undef.ts");
    writeFileSync(
      file,
      "function stub(): string | undefined {\n  return undefined;\n}\n",
      "utf-8",
    );

    const matches = scanStubs({ path: tmpDir });
    expect(matches.some((m) => m.pattern.includes("return undefined"))).toBe(true);
  });

  it("returns empty array for clean implementation", () => {
    const file = join(tmpDir, "clean.ts");
    writeFileSync(
      file,
      "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
      "utf-8",
    );

    const matches = scanStubs({ path: tmpDir });
    expect(matches).toHaveLength(0);
  });

  it("scans recursively", () => {
    const subDir = join(tmpDir, "src");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(
      join(subDir, "deep.ts"),
      'function stub() { throw new Error("not implemented"); }\n',
      "utf-8",
    );

    const matches = scanStubs({ path: tmpDir });
    expect(matches.length).toBeGreaterThan(0);
  });
});
