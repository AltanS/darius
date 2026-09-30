/**
 * Tests for `tracker scan artifacts`.
 *
 * pnpm vitest run scan-artifacts
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
import { scanArtifacts } from "../lib/scan.ts";

describe("scan-artifacts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-scan-artifacts-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds console.log in a TypeScript file", () => {
    const file = join(tmpDir, "test.ts");
    writeFileSync(file, 'function foo() {\n  console.log("debug");\n}\n', "utf-8");

    const matches = scanArtifacts({ path: tmpDir });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.pattern).toBe("console.log");
    expect(matches[0]?.line).toBe(2);
  });

  it("finds console.debug", () => {
    const file = join(tmpDir, "test.ts");
    writeFileSync(file, "console.debug('test');\n", "utf-8");

    const matches = scanArtifacts({ path: tmpDir });
    expect(matches.some((m) => m.pattern === "console.debug")).toBe(true);
  });

  it("finds debugger statement", () => {
    const file = join(tmpDir, "test.ts");
    writeFileSync(file, "function foo() {\n  debugger;\n}\n", "utf-8");

    const matches = scanArtifacts({ path: tmpDir });
    expect(matches.some((m) => m.pattern === "debugger")).toBe(true);
  });

  it("finds TODO: comment", () => {
    const file = join(tmpDir, "test.ts");
    writeFileSync(file, "// TODO: implement this\nconst x = 1;\n", "utf-8");

    const matches = scanArtifacts({ path: tmpDir });
    expect(matches.some((m) => m.pattern === "TODO:")).toBe(true);
  });

  it("finds FIXME: comment", () => {
    const file = join(tmpDir, "test.ts");
    writeFileSync(file, "// FIXME: broken\nconst x = 1;\n", "utf-8");

    const matches = scanArtifacts({ path: tmpDir });
    expect(matches.some((m) => m.pattern === "FIXME:")).toBe(true);
  });

  it("finds XXX: comment", () => {
    const file = join(tmpDir, "test.ts");
    writeFileSync(file, "// XXX: hack\n", "utf-8");

    const matches = scanArtifacts({ path: tmpDir });
    expect(matches.some((m) => m.pattern === "XXX:")).toBe(true);
  });

  it("finds HACK: comment", () => {
    const file = join(tmpDir, "test.ts");
    writeFileSync(file, "// HACK: this is bad\n", "utf-8");

    const matches = scanArtifacts({ path: tmpDir });
    expect(matches.some((m) => m.pattern === "HACK:")).toBe(true);
  });

  it("returns empty array for clean file", () => {
    const file = join(tmpDir, "clean.ts");
    writeFileSync(
      file,
      "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
      "utf-8",
    );

    const matches = scanArtifacts({ path: tmpDir });
    expect(matches).toHaveLength(0);
  });

  it("scans recursively into subdirectories", () => {
    const subDir = join(tmpDir, "src");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "nested.ts"), "console.log('nested');\n", "utf-8");

    const matches = scanArtifacts({ path: tmpDir });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.file).toContain("nested.ts");
  });

  it("skips node_modules directory", () => {
    const nodeModules = join(tmpDir, "node_modules");
    mkdirSync(nodeModules, { recursive: true });
    writeFileSync(join(nodeModules, "lib.ts"), "console.log('from node_modules');\n", "utf-8");

    const matches = scanArtifacts({ path: tmpDir });
    expect(matches).toHaveLength(0);
  });

  it("only scans TypeScript/JavaScript files", () => {
    writeFileSync(join(tmpDir, "notes.md"), "console.log in docs", "utf-8");
    writeFileSync(join(tmpDir, "test.ts"), "console.log('actual code');\n", "utf-8");

    const matches = scanArtifacts({ path: tmpDir });
    expect(matches.every((m) => m.file.endsWith(".ts"))).toBe(true);
  });

  it("scans a single file directly", () => {
    const file = join(tmpDir, "single.ts");
    writeFileSync(file, "console.log('direct');\n", "utf-8");

    const matches = scanArtifacts({ path: file });
    expect(matches).toHaveLength(1);
  });

  it("reports correct line numbers", () => {
    const file = join(tmpDir, "lines.ts");
    writeFileSync(
      file,
      "const a = 1;\nconst b = 2;\nconsole.log(a, b);\nconst c = 3;\n",
      "utf-8",
    );

    const matches = scanArtifacts({ path: file });
    expect(matches[0]?.line).toBe(3);
  });
});
