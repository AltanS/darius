/**
 * CLI tests for `tracker uncommitted-verified` in both modes: git mode (a real
 * `.tracker/` in git) and store mode (the marker lists `milestone` in kinds, so
 * `.tracker` is a git-ignored link and the gate reads worklog thread stages).
 *
 * pnpm vitest run uncommitted-verified-cli
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { initTracker } from "../lib/tracker-writer.ts";
import {
  openThread,
  appendThread,
  setStage,
  closeThread,
} from "../lib/worklog.ts";
import { markerListsMilestone, selectVerifiedThreads } from "../lib/uncommitted.ts";

const SPEC_REF = ".tracker/M1-probe/01-p.md";

function git(cwd: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
}

function runGate(cwd: string): { exitCode: number; entries: Record<string, unknown>[] } {
  const result = spawnSync(
    "node",
    ["--experimental-strip-types", "--no-warnings", join(process.cwd(), "bin/tracker.mts"), "uncommitted-verified", "--json"],
    { encoding: "utf-8", cwd, timeout: 30_000 },
  );
  const out = result.stdout ?? "";
  return { exitCode: result.status ?? -1, entries: out.trim() ? JSON.parse(out) : [] };
}

describe("markerListsMilestone", () => {
  it("is true only when kinds names milestone", () => {
    expect(markerListsMilestone('v = 3\nproject = "p"\nkinds = ["ritual", "vigil", "milestone"]\n')).toBe(true);
    expect(markerListsMilestone('v = 3\nkinds = ["ritual", "vigil"]\n')).toBe(false);
    expect(markerListsMilestone('v = 3\nproject = "p"\n')).toBe(false);
    expect(markerListsMilestone('v = 3\nkinds = [\n  "ritual", # milestone later\n  "vigil",\n]\n')).toBe(false);
    expect(markerListsMilestone('v = 3\nkinds = [\n  "ritual",\n  "vigil",\n  "milestone",\n]\n')).toBe(true);
  });
});

describe("selectVerifiedThreads", () => {
  const base = { worklogFile: "M1-probe.md", closed: false, artifacts: [] };

  it("skips closed threads and threads not at verified", () => {
    const threads = [
      { ...base, threadId: "a", stage: "committed" },
      { ...base, threadId: "b", stage: "dispatched" },
      { ...base, threadId: "c", stage: "verified", closed: true },
      { ...base, threadId: "d" },
    ];
    expect(selectVerifiedThreads(threads, "")).toEqual([]);
  });

  it("falls back to the worklog path when the thread names no spec", () => {
    const [entry] = selectVerifiedThreads([{ ...base, threadId: "a", stage: "verified" }], "");
    expect(entry!.path).toBe(".tracker/worklog/M1-probe.md");
  });

  it("lists only artifacts that are dirty, and counts a directory artifact", () => {
    const [entry] = selectVerifiedThreads(
      [{ ...base, threadId: "a", stage: "verified", artifacts: ["src/a.ts", "src/b.ts", "lib/"] }],
      " M src/a.ts\n?? lib/new.ts\n",
    );
    expect(entry!.dirtyArtifacts).toEqual(["src/a.ts", "lib"]);
  });
});

describe("tracker uncommitted-verified CLI", () => {
  let tmpDir: string;
  let worklogPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-uv-cli-"));
    git(tmpDir, ["init", "-q"]);
    git(tmpDir, ["config", "user.email", "dev@example.com"]);
    git(tmpDir, ["config", "user.name", "Dev"]);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Store mode: the tree lives outside the repo, `.tracker` is an ignored link. */
  function setupStoreMode(): string {
    const tree = mkdtempSync(join(tmpdir(), "tracker-uv-tree-"));
    mkdirSync(join(tree, "worklog"), { recursive: true });
    symlinkSync(tree, join(tmpDir, ".tracker"));
    writeFileSync(
      join(tmpDir, ".darius.toml"),
      'v = 3\nproject = "probe"\nkinds = ["ritual", "vigil", "milestone"]\n',
    );
    writeFileSync(join(tmpDir, ".gitignore"), "/.tracker\n");
    worklogPath = join(tree, "worklog", "M1-probe.md");
    return tree;
  }

  it("store mode: a verified thread is one entry with the spec path and thread fields", () => {
    const tree = setupStoreMode();
    const threadId = openThread({ worklogPath, slug: "t1", specPath: SPEC_REF, stage: "dispatched" });
    appendThread({ worklogPath, threadId, section: "artifact", message: "src/a.ts" });
    appendThread({ worklogPath, threadId, section: "artifact", message: "src/clean.ts" });
    setStage({ worklogPath, threadId, stage: "verified" });
    mkdirSync(join(tmpDir, "src"));
    writeFileSync(join(tmpDir, "src", "a.ts"), "export {};\n");

    const { exitCode, entries } = runGate(tmpDir);
    expect(exitCode).toBe(0);
    expect(entries).toEqual([
      {
        path: SPEC_REF,
        gitStatus: "verified-uncommitted",
        source: "thread",
        threadId,
        dirtyArtifacts: ["src/a.ts"],
      },
    ]);
    rmSync(tree, { recursive: true, force: true });
  });

  it("store mode: a committed thread returns none", () => {
    const tree = setupStoreMode();
    const threadId = openThread({ worklogPath, slug: "t1", specPath: SPEC_REF, stage: "verified" });
    setStage({ worklogPath, threadId, stage: "committed" });

    expect(runGate(tmpDir)).toEqual({ exitCode: 0, entries: [] });
    rmSync(tree, { recursive: true, force: true });
  });

  it("store mode: a parked (closed) verified thread returns none", () => {
    const tree = setupStoreMode();
    const threadId = openThread({ worklogPath, slug: "t1", specPath: SPEC_REF, stage: "verified" });
    closeThread({ worklogPath, threadId, status: "blocked" });

    expect(runGate(tmpDir).entries).toEqual([]);
    rmSync(tree, { recursive: true, force: true });
  });

  it("git mode is unchanged: a dirty stamped spec is flagged, thread stages are ignored", () => {
    initTracker({ projectRoot: tmpDir });
    mkdirSync(join(tmpDir, ".tracker", "M1-probe"));
    writeFileSync(join(tmpDir, ".tracker", "M1-probe", "00-README.md"), "# Probe\n");
    mkdirSync(join(tmpDir, ".tracker", "worklog"));
    writeFileSync(join(tmpDir, ".tracker", "worklog", ".keep"), "");
    git(tmpDir, ["add", "-A"]);
    git(tmpDir, ["commit", "-q", "-m", "base"]);
    writeFileSync(
      join(tmpDir, ".tracker", "M1-probe", "01-p.md"),
      "---\nverification_passed: 2026-01-01T00:00:00Z\n---\n\n# P\n",
    );
    worklogPath = join(tmpDir, ".tracker", "worklog", "M1-probe.md");
    openThread({ worklogPath, slug: "t1", specPath: "x.md", stage: "verified" });

    const { exitCode, entries } = runGate(tmpDir);
    expect(exitCode).toBe(0);
    const spec = entries.find((e) => e["path"] === ".tracker/M1-probe/01-p.md");
    expect(spec).toEqual({ path: ".tracker/M1-probe/01-p.md", gitStatus: "??" });
    expect(entries.every((e) => e["source"] === undefined)).toBe(true);
  });
});
