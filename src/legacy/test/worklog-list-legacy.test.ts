/**
 * `worklog list` reporting for pre-CLI freeform files (M7/01).
 *
 * A legacy file used to shred into fake open threads that polluted `--active`
 * and the loop-check gate. Now it parses as zero threads — so the listing has to
 * surface the file itself with a `legacy` flag instead of dropping it from view.
 *
 * pnpm vitest run worklog-list-legacy
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { initTracker } from "../lib/tracker-writer.ts";
import { listThreads, listWorklogFiles } from "../lib/worklog.ts";

const LEGACY = [
  "# Worklog — investigation",
  "",
  "## Root cause",
  "The parser treated every heading as a thread.",
  "",
  "## Files you OWN",
  "- lib/worklog.ts",
  "",
].join("\n");

const MIXED = [
  "# Worklog — mixed",
  "",
  "## Background",
  "prose before any thread",
  "",
  "## 01ABCDEFGHJKMNPQRSTV-alpha — alpha",
  "<!-- opened: 2026-01-01T00:00:00.000Z -->",
  "### 2026-01-01T00:00:00.000Z [note]",
  "a note",
  "",
].join("\n");

const CLEAN = [
  "## 01ABCDEFGHJKMNPQRSTX-clean — clean",
  "<!-- opened: 2026-01-03T00:00:00.000Z -->",
  "### 2026-01-03T00:00:00.000Z [note]",
  "a note",
  "",
].join("\n");

type ListJson = {
  threads: Array<{ threadId: string; worklogFile: string; legacy?: boolean }>;
  files: Array<{ worklogFile: string; threadCount: number; state: string; legacy: boolean }>;
};

describe("worklog list — legacy files", () => {
  let tmpDir: string;
  let trackerRoot: string;
  let worklogDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-worklog-list-legacy-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    worklogDir = join(trackerRoot, "worklog");
    mkdirSync(worklogDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function write(file: string, content: string): void {
    writeFileSync(join(worklogDir, file), content, "utf-8");
  }

  function runTracker(args: string[]): { stdout: string; exitCode: number } {
    const result = spawnSync(
      "node",
      [
        "--experimental-strip-types",
        "--no-warnings",
        join(process.cwd(), "bin/tracker.mts"),
        ...args,
      ],
      { encoding: "utf-8", cwd: tmpDir, timeout: 30_000 },
    );
    return { stdout: result.stdout ?? "", exitCode: result.status ?? -1 };
  }

  function listJson(args: string[] = []): ListJson {
    const { stdout, exitCode } = runTracker(["worklog", "list", "--json", ...args]);
    expect(exitCode).toBe(0);
    return JSON.parse(stdout) as ListJson;
  }

  // -------------------------------------------------------------------------
  // 1. Thread-less legacy files.
  // -------------------------------------------------------------------------

  it("reports a thread-less legacy file with legacy: true and no threads", () => {
    write("M9-legacy.md", LEGACY);

    const json = listJson();
    expect(json.threads).toEqual([]);
    expect(json.files).toEqual([
      { worklogFile: "M9-legacy.md", threadCount: 0, state: "legacy", legacy: true },
    ]);
  });

  it("tags the legacy file in human output instead of dropping it", () => {
    write("M9-legacy.md", LEGACY);

    const { stdout, exitCode } = runTracker(["worklog", "list"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("M9-legacy.md");
    expect(stdout).toContain("(legacy)");
    expect(stdout).not.toContain("Root cause");
  });

  it("keeps fake threads out of --active", () => {
    write("M9-legacy.md", LEGACY);

    expect(listJson(["--active"]).threads).toEqual([]);
    expect(listThreads({ trackerRoot, activeOnly: true })).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 2. Mixed files: real threads, flagged legacy.
  // -------------------------------------------------------------------------

  it("reports a mixed file's real threads with legacy: true", () => {
    write("M9-mixed.md", MIXED);

    const json = listJson();
    expect(json.threads).toHaveLength(1);
    expect(json.threads[0]!.threadId).toBe("01ABCDEFGHJKMNPQRSTV-alpha");
    expect(json.threads[0]!.legacy).toBe(true);
    expect(json.files).toEqual([
      { worklogFile: "M9-mixed.md", threadCount: 1, state: "legacy", legacy: true },
    ]);
  });

  it("tags mixed-file thread lines with (legacy) in human output", () => {
    write("M9-mixed.md", MIXED);

    const { stdout } = runTracker(["worklog", "list"]);
    expect(stdout).toContain("01ABCDEFGHJKMNPQRSTV-alpha");
    expect(stdout).toContain("(legacy)");
  });

  // -------------------------------------------------------------------------
  // 3. Clean CLI-format files are never flagged.
  // -------------------------------------------------------------------------

  it("does not flag a CLI-format file", () => {
    write("M9-clean.md", CLEAN);

    const json = listJson();
    expect(json.threads).toHaveLength(1);
    expect(json.threads[0]!.legacy).toBeUndefined();
    expect(json.files).toEqual([
      { worklogFile: "M9-clean.md", threadCount: 1, state: "clean", legacy: false },
    ]);

    const { stdout } = runTracker(["worklog", "list"]);
    expect(stdout).not.toContain("(legacy)");
  });

  it("does not flag an empty worklog file", () => {
    write("M9-empty.md", "");

    expect(listWorklogFiles({ trackerRoot })).toEqual([
      { worklogFile: "M9-empty.md", threadCount: 0, state: "clean", legacy: false },
    ]);
    expect(runTracker(["worklog", "list"]).stdout).toContain("No worklog threads found");
  });

  // -------------------------------------------------------------------------
  // 4. The milestone filter applies to files as well as threads.
  // -------------------------------------------------------------------------

  it("honors --milestone for the per-file rows", () => {
    write("M9-legacy.md", LEGACY);
    write("M10-clean.md", CLEAN);

    const json = listJson(["--milestone", "M9"]);
    expect(json.files.map((f) => f.worklogFile)).toEqual(["M9-legacy.md"]);
    expect(json.threads).toEqual([]);
  });
});
