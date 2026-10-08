/**
 * Worklog guards (M7/05) — the three ways a caller could previously walk past
 * a rule the CLI already enforces everywhere else.
 *
 * 1. `worklog open 00-<slug>` exited 0 and wrote a thread that `list`, `append`
 *    and `close` can never see, because every enumeration filters `00-` files
 *    as generated index docs. Success plus invisibility is the worst outcome
 *    available; refusal is the right one.
 * 2. `migrate` was the one worklog-directory walk still missing that filter, so
 *    it would happily rewrite bullets inside a generated index.
 * 3. `distill --list --check` let `--list` win silently and answer a different
 *    question than the caller asked — the trap the `--content`/`--stdin` XOR
 *    already closes.
 *
 * pnpm vitest run worklog-guards
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  cpSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { initTracker } from "../lib/tracker-writer.ts";
import { runMigrate } from "../lib/migrate.ts";
import { listThreads } from "../lib/worklog.ts";

const FIXTURES_DIR = join(
  import.meta.dirname ?? new URL(".", import.meta.url).pathname,
  "fixtures",
  "migrations",
);

// Star bullets are exactly what migrate's normalizeWorklog step rewrites.
const STAR_BULLETS = ["# Worklog", "", "* first", "* second", ""].join("\n");

describe("worklog guards", () => {
  let tmpDir: string;
  let trackerRoot: string;
  let worklogDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-worklog-guards-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    worklogDir = join(trackerRoot, "worklog");
    mkdirSync(worklogDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function runTracker(args: string[]): { stdout: string; stderr: string; exitCode: number } {
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
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.status ?? -1,
    };
  }

  // -------------------------------------------------------------------------
  // 1. `worklog open` refuses a 00- slug.
  // -------------------------------------------------------------------------

  it("refuses `worklog open 00-<slug>` instead of creating an unreachable thread", () => {
    const { stderr, exitCode } = runTracker(["worklog", "open", "00-INDEX"]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("00-");
    expect(existsSync(join(worklogDir, "00-INDEX.md"))).toBe(false);
    expect(listThreads({ trackerRoot })).toEqual([]);
  });

  it("refuses any 00- prefix, not just the index name", () => {
    const { stderr, exitCode } = runTracker([
      "worklog",
      "open",
      "00-scratch",
      "--message",
      "notes",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("unreachable");
    expect(existsSync(join(worklogDir, "00-scratch.md"))).toBe(false);
  });

  it("still accepts a slug that merely contains 00-", () => {
    mkdirSync(join(trackerRoot, "M7-run-00-baseline"), { recursive: true });
    const { stdout, exitCode } = runTracker(["worklog", "open", "M7-run-00-baseline"]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).not.toBe("");
    expect(existsSync(join(worklogDir, "M7-run-00-baseline.md"))).toBe(true);
    // The whole point of the guard: a thread that opens must be findable.
    expect(listThreads({ trackerRoot }).map((t) => t.worklogFile)).toEqual([
      "M7-run-00-baseline.md",
    ]);
  });

  // -------------------------------------------------------------------------
  // 2. migrate skips generated index files.
  // -------------------------------------------------------------------------

  it("leaves a generated 00- index untouched while normalizing real worklogs", () => {
    const migrateDir = mkdtempSync(join(tmpdir(), "tracker-guards-migrate-"));
    try {
      cpSync(join(FIXTURES_DIR, "v8-drift"), migrateDir, { recursive: true });
      const migrateWorklogDir = join(migrateDir, ".tracker", "worklog");
      mkdirSync(migrateWorklogDir, { recursive: true });
      writeFileSync(join(migrateWorklogDir, "00-INDEX.md"), STAR_BULLETS, "utf-8");
      writeFileSync(join(migrateWorklogDir, "M1-foo.md"), STAR_BULLETS, "utf-8");

      runMigrate({ trackerRoot: join(migrateDir, ".tracker"), dryRun: false });

      // The real worklog is migrated; the generated index is not migrate's to edit.
      expect(readFileSync(join(migrateWorklogDir, "M1-foo.md"), "utf-8")).toContain("- first");
      expect(readFileSync(join(migrateWorklogDir, "00-INDEX.md"), "utf-8")).toBe(STAR_BULLETS);
    } finally {
      rmSync(migrateDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // 3. `distill --list` is mutually exclusive with the single-file forms.
  // -------------------------------------------------------------------------

  it("errors on `distill --list --check` instead of silently listing", () => {
    writeFileSync(join(worklogDir, "M1-foo.md"), STAR_BULLETS, "utf-8");

    const { stdout, stderr, exitCode } = runTracker([
      "worklog",
      "distill",
      "--list",
      "--check",
      "M1-foo.md",
    ]);

    expect(exitCode).toBe(2);
    expect(stderr).toContain("--list");
    expect(stdout).toBe("");
  });

  it("errors on `distill --list <file>` — a positional names one file, --list surveys all", () => {
    writeFileSync(join(worklogDir, "M1-foo.md"), STAR_BULLETS, "utf-8");

    const { stdout, stderr, exitCode } = runTracker([
      "worklog",
      "distill",
      "--list",
      "M1-foo.md",
    ]);

    expect(exitCode).toBe(2);
    expect(stderr).toContain("cannot be combined");
    expect(stdout).toBe("");
  });

  it("still accepts --list on its own", () => {
    writeFileSync(join(worklogDir, "M1-foo.md"), STAR_BULLETS, "utf-8");

    const { stdout, exitCode } = runTracker(["worklog", "distill", "--list"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("M1-foo.md");
  });

  it("still accepts --check on a single file", () => {
    writeFileSync(join(worklogDir, "M1-foo.md"), STAR_BULLETS, "utf-8");

    const { stdout } = runTracker(["worklog", "distill", "M1-foo.md", "--check"]);

    // Eligible or not, the point is that the single-file gate still answers.
    expect(stdout.trim()).not.toBe("");
  });
});
