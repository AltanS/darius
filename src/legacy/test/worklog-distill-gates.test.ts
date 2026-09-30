/**
 * Eligibility gates for `worklog distill` (M7/02).
 *
 * Distill is a sanctioned lossy rewrite, so the CLI — not the calling skill —
 * decides when it is safe. These tests pin the gate chain, its order, the
 * distinct one-line errors, and the fact that `--check` and `--list --json`
 * agree on every verdict.
 *
 * pnpm vitest run worklog-distill-gates
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { initTracker } from "../lib/tracker-writer.ts";
import { evaluateDistillEligibility, listDistillCandidates } from "../lib/worklog-distill.ts";

const SHA_ZERO = "0".repeat(64);
const DAY_MS = 86_400_000;

/** A CLI-format thread that is still open. */
const OPEN_THREAD = [
  "## 01ABCDEFGHJKMNPQRSTV-alpha — alpha",
  "<!-- opened: 2020-01-01T00:00:00.000Z -->",
  "### 2020-01-01T00:00:00.000Z [note]",
  "still working",
  "",
].join("\n");

/** The same thread, closed. */
const CLOSED_THREAD = [
  "## 01ABCDEFGHJKMNPQRSTV-alpha — alpha",
  "<!-- opened: 2020-01-01T00:00:00.000Z -->",
  "<!-- closed: 2020-01-02T00:00:00.000Z status: done -->",
  "### 2020-01-01T00:00:00.000Z [note]",
  "done here",
  "",
].join("\n");

/** Pre-CLI prose: no markers, so zero threads. */
const LEGACY_PROSE = ["# Worklog — investigation", "", "## Root cause", "a heading with no marker", ""].join(
  "\n",
);

const STAMP = `<!-- distilled: 2026-01-01T00:00:00.000Z source-sha256: ${SHA_ZERO} raw: .tracker/archive/worklog-raw/x.md -->`;

type ListJson = {
  minAgeDays: number;
  files: Array<{ worklogFile: string; eligible: boolean; reason: string; detail: string }>;
};

describe("worklog distill — eligibility gates", () => {
  let tmpDir: string;
  let trackerRoot: string;
  let worklogDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-distill-gates-"));
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

  /** Backdate a worklog file so the age gate sees it as quiet. */
  function age(file: string, days: number): void {
    const when = (Date.now() - days * DAY_MS) / 1000;
    utimesSync(join(worklogDir, file), when, when);
  }

  function archiveMilestone(slug: string): void {
    const archiveDir = join(trackerRoot, "archive");
    mkdirSync(archiveDir, { recursive: true });
    writeFileSync(join(archiveDir, `${slug}.md`), "# archived\n", "utf-8");
  }

  function runTracker(args: string[]): { stdout: string; stderr: string; exitCode: number } {
    const result = spawnSync(
      "node",
      ["--experimental-strip-types", "--no-warnings", join(process.cwd(), "bin/tracker.mts"), ...args],
      { encoding: "utf-8", cwd: tmpDir, timeout: 30_000 },
    );
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? -1 };
  }

  function check(file: string, extra: string[] = []) {
    return runTracker(["worklog", "distill", file, "--check", ...extra]);
  }

  function listJson(extra: string[] = []): ListJson {
    const { stdout, exitCode } = runTracker(["worklog", "distill", "--list", "--json", ...extra]);
    expect(exitCode).toBe(0);
    return JSON.parse(stdout) as ListJson;
  }

  function reasonFor(json: ListJson, file: string): string {
    const row = json.files.find((f) => f.worklogFile === file);
    expect(row, `no --list row for ${file}`).toBeDefined();
    return row!.reason;
  }

  // -------------------------------------------------------------------------
  // Gate 1 — is this even a distillable worklog file?
  // -------------------------------------------------------------------------

  it("refuses a file that does not exist", () => {
    const { stdout, stderr, exitCode } = check("nope.md");
    expect(exitCode).toBe(1);
    expect(stdout.trim()).toBe("not-found");
    expect(stderr).toContain("no such worklog file");
  });

  it("never treats a 00- index file as eligible, and keeps it out of --list", () => {
    write("00-INDEX.md", "# Worklog index\n");

    const { stdout, stderr, exitCode } = check("00-INDEX.md");
    expect(exitCode).toBe(1);
    expect(stdout.trim()).toBe("index-file");
    expect(stderr).toContain("generated index file");
    // Enumeration skips 00- files entirely (M7/03) — only a file named
    // explicitly gets the `index-file` refusal.
    expect(listJson().files.map((f) => f.worklogFile)).not.toContain("00-INDEX.md");
  });

  it("accepts a basename with or without the .md suffix", () => {
    write("M9-done.md", CLOSED_THREAD);
    archiveMilestone("M9-done");

    expect(check("M9-done").stdout.trim()).toBe("eligible");
    expect(check("M9-done.md").stdout.trim()).toBe("eligible");
  });

  it("resolves <file> as a basename so it cannot escape the worklog dir", () => {
    write("M9-done.md", CLOSED_THREAD);
    archiveMilestone("M9-done");

    expect(check("../../M9-done.md").stdout.trim()).toBe("eligible");
  });

  // -------------------------------------------------------------------------
  // Gate 2 — zero open threads.
  // -------------------------------------------------------------------------

  it("refuses a file with an open thread", () => {
    write("scratch.md", OPEN_THREAD);
    age("scratch.md", 400);

    const { stdout, stderr, exitCode } = check("scratch.md");
    expect(exitCode).toBe(1);
    expect(stdout.trim()).toBe("open-threads");
    expect(stderr).toContain("has 1 open thread(s)");
    expect(reasonFor(listJson(), "scratch.md")).toBe("open-threads");
  });

  it("passes a file whose threads are all closed", () => {
    write("scratch.md", CLOSED_THREAD);

    // Closed 2020 → far past any min-age.
    expect(check("scratch.md").stdout.trim()).toBe("eligible");
  });

  it("passes a pure-legacy file with zero threads", () => {
    write("scratch.md", LEGACY_PROSE);
    age("scratch.md", 400);

    const { stdout, exitCode } = check("scratch.md");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("eligible");
  });

  // -------------------------------------------------------------------------
  // Gate 3 — milestone-linked files ride the milestone lifecycle.
  // -------------------------------------------------------------------------

  it("refuses a milestone file whose milestone directory still exists", () => {
    write("M9-live.md", CLOSED_THREAD);
    mkdirSync(join(trackerRoot, "M9-live"), { recursive: true });
    archiveMilestone("M9-live");

    const { stdout, stderr, exitCode } = check("M9-live.md");
    expect(exitCode).toBe(1);
    expect(stdout.trim()).toBe("milestone-active");
    expect(stderr).toContain("still active");
    expect(reasonFor(listJson(), "M9-live.md")).toBe("milestone-active");
  });

  it("refuses a milestone file with no archive document", () => {
    write("M9-gone.md", CLOSED_THREAD);

    const { stdout, stderr, exitCode } = check("M9-gone.md");
    expect(exitCode).toBe(1);
    expect(stdout.trim()).toBe("not-archived");
    expect(stderr).toContain("no archive document");
    expect(reasonFor(listJson(), "M9-gone.md")).toBe("not-archived");
  });

  it("passes a milestone file whose milestone is gone and archived", () => {
    write("M9-done.md", CLOSED_THREAD);
    archiveMilestone("M9-done");

    expect(check("M9-done.md").exitCode).toBe(0);
    expect(reasonFor(listJson(), "M9-done.md")).toBe("eligible");
  });

  it("matches the milestone slug case-insensitively in both directions", () => {
    write("m9-cased.md", CLOSED_THREAD);
    mkdirSync(join(trackerRoot, "M9-Cased"), { recursive: true });
    expect(check("m9-cased.md").stdout.trim()).toBe("milestone-active");

    rmSync(join(trackerRoot, "M9-Cased"), { recursive: true, force: true });
    expect(check("m9-cased.md").stdout.trim()).toBe("not-archived");

    archiveMilestone("M9-Cased");
    expect(check("m9-cased.md").stdout.trim()).toBe("eligible");
  });

  it("does not treat a file matching a milestone name as a directory", () => {
    write("M9-done.md", CLOSED_THREAD);
    // A *file* named like the milestone must not count as an active milestone.
    writeFileSync(join(trackerRoot, "M9-done"), "not a directory\n", "utf-8");
    archiveMilestone("M9-done");

    expect(check("M9-done.md").stdout.trim()).toBe("eligible");
  });

  it("exempts milestone files from the age gate", () => {
    write("M9-done.md", CLOSED_THREAD);
    archiveMilestone("M9-done");
    age("M9-done.md", 0);

    expect(check("M9-done.md", ["--min-age-days", "9999"]).stdout.trim()).toBe("eligible");
  });

  // -------------------------------------------------------------------------
  // Gate 4 — cross-cutting files ride the age gate.
  // -------------------------------------------------------------------------

  it("refuses a cross-cutting file that is still recent", () => {
    write("cross-cutting.md", LEGACY_PROSE);
    age("cross-cutting.md", 3);

    const { stdout, stderr, exitCode } = check("cross-cutting.md");
    expect(exitCode).toBe(1);
    expect(stdout.trim()).toBe("too-recent");
    expect(stderr).toContain("needs 14");
    expect(reasonFor(listJson(), "cross-cutting.md")).toBe("too-recent");
  });

  it("passes the same file with --min-age-days 0", () => {
    write("cross-cutting.md", LEGACY_PROSE);
    age("cross-cutting.md", 3);

    expect(check("cross-cutting.md", ["--min-age-days", "0"]).exitCode).toBe(0);
    expect(reasonFor(listJson(["--min-age-days", "0"]), "cross-cutting.md")).toBe("eligible");
  });

  it("uses file mtime as the last-activity fallback for thread-less legacy files", () => {
    write("cross-cutting.md", LEGACY_PROSE);

    age("cross-cutting.md", 13);
    expect(check("cross-cutting.md").stdout.trim()).toBe("too-recent");

    age("cross-cutting.md", 15);
    expect(check("cross-cutting.md").stdout.trim()).toBe("eligible");
  });

  it("uses the newest thread timestamp, not mtime, when threads exist", () => {
    // File touched just now, but its only thread closed in 2020 → eligible.
    write("cross-cutting.md", CLOSED_THREAD);
    age("cross-cutting.md", 0);

    expect(check("cross-cutting.md").stdout.trim()).toBe("eligible");

    // An entry timestamped today outranks the 2020 close stamp → too recent.
    write(
      "fresh.md",
      CLOSED_THREAD.replace(
        "### 2020-01-01T00:00:00.000Z [note]",
        `### ${new Date().toISOString()} [note]`,
      ),
    );
    expect(check("fresh.md").stdout.trim()).toBe("too-recent");
  });

  it("rejects a non-numeric or negative --min-age-days", () => {
    write("cross-cutting.md", LEGACY_PROSE);

    for (const bad of ["--min-age-days=soon", "--min-age-days=-1"]) {
      const { stderr, exitCode } = check("cross-cutting.md", [bad]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("--min-age-days must be a non-negative number");
    }
  });

  // -------------------------------------------------------------------------
  // Gate 5 — already distilled.
  // -------------------------------------------------------------------------

  it("refuses an already-stamped file without --force", () => {
    write("cross-cutting.md", `${STAMP}\n\nanchor prose\n`);
    age("cross-cutting.md", 400);

    const { stdout, stderr, exitCode } = check("cross-cutting.md");
    expect(exitCode).toBe(1);
    expect(stdout.trim()).toBe("already-distilled");
    expect(stderr).toContain("--force");
    expect(reasonFor(listJson(), "cross-cutting.md")).toBe("already-distilled");
  });

  it("ignores a distilled-looking comment that is not the first line", () => {
    write("cross-cutting.md", `# Notes\n\n${STAMP}\n`);
    age("cross-cutting.md", 400);

    expect(check("cross-cutting.md").stdout.trim()).toBe("eligible");
  });

  // -------------------------------------------------------------------------
  // Gate ordering.
  // -------------------------------------------------------------------------

  it("reports open-threads before already-distilled", () => {
    write("cross-cutting.md", `${STAMP}\n\n${OPEN_THREAD}`);
    age("cross-cutting.md", 400);

    expect(check("cross-cutting.md").stdout.trim()).toBe("open-threads");
  });

  it("reports the milestone gate before already-distilled", () => {
    write("M9-live.md", `${STAMP}\n\n${CLOSED_THREAD}`);
    mkdirSync(join(trackerRoot, "M9-live"), { recursive: true });

    expect(check("M9-live.md").stdout.trim()).toBe("milestone-active");
  });

  it("reports the age gate before already-distilled", () => {
    write("cross-cutting.md", `${STAMP}\n\nanchor prose\n`);
    age("cross-cutting.md", 1);

    expect(check("cross-cutting.md").stdout.trim()).toBe("too-recent");
  });

  it("reports milestone-active before not-archived", () => {
    write("M9-live.md", CLOSED_THREAD);
    mkdirSync(join(trackerRoot, "M9-live"), { recursive: true });

    expect(check("M9-live.md").stdout.trim()).toBe("milestone-active");
  });

  // -------------------------------------------------------------------------
  // --list and --check are the same verdict, two shapes.
  // -------------------------------------------------------------------------

  it("gives --check and --list --json the same reason for every file", () => {
    write("00-INDEX.md", "# index\n");
    write("M9-live.md", CLOSED_THREAD);
    mkdirSync(join(trackerRoot, "M9-live"), { recursive: true });
    write("M9-gone.md", CLOSED_THREAD);
    write("M9-done.md", CLOSED_THREAD);
    archiveMilestone("M9-done");
    write("open.md", OPEN_THREAD);
    write("recent.md", LEGACY_PROSE);
    age("recent.md", 1);
    write("quiet.md", LEGACY_PROSE);
    age("quiet.md", 90);

    const json = listJson();
    expect(json.minAgeDays).toBe(14);
    // 00-INDEX.md is written above but never enumerated (M7/03).
    expect(json.files.map((f) => f.worklogFile)).toEqual([
      "M9-done.md",
      "M9-gone.md",
      "M9-live.md",
      "open.md",
      "quiet.md",
      "recent.md",
    ]);

    for (const row of json.files) {
      const { stdout, exitCode } = check(row.worklogFile);
      expect(stdout.trim(), row.worklogFile).toBe(row.reason);
      expect(exitCode, row.worklogFile).toBe(row.eligible ? 0 : 1);
    }

    expect(json.files.filter((f) => f.eligible).map((f) => f.worklogFile)).toEqual([
      "M9-done.md",
      "quiet.md",
    ]);
    // Every ineligible row explains itself; eligible rows have nothing to say.
    for (const row of json.files) {
      expect(row.detail === "", row.worklogFile).toBe(row.eligible);
    }
  });

  it("renders --list for humans with the reason inline", () => {
    write("M9-gone.md", CLOSED_THREAD);
    write("quiet.md", LEGACY_PROSE);
    age("quiet.md", 90);

    const { stdout, exitCode } = runTracker(["worklog", "distill", "--list"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("M9-gone.md  not eligible — not-archived");
    expect(stdout).toContain("quiet.md  eligible");
  });

  // -------------------------------------------------------------------------
  // Library surface — the gates are callable without spawning the CLI.
  // -------------------------------------------------------------------------

  it("exposes the same verdicts through the library API", () => {
    write("M9-done.md", CLOSED_THREAD);
    archiveMilestone("M9-done");
    write("open.md", OPEN_THREAD);

    expect(evaluateDistillEligibility({ trackerRoot, file: "M9-done" })).toMatchObject({
      worklogFile: "M9-done.md",
      eligible: true,
      reason: "eligible",
      openThreads: 0,
    });
    expect(evaluateDistillEligibility({ trackerRoot, file: "open.md" })).toMatchObject({
      eligible: false,
      reason: "open-threads",
      openThreads: 1,
    });
    expect(listDistillCandidates({ trackerRoot }).map((c) => c.reason)).toEqual([
      "eligible",
      "open-threads",
    ]);
  });

  it("honors an injected clock for the age gate", () => {
    write("quiet.md", LEGACY_PROSE);
    age("quiet.md", 10);

    expect(evaluateDistillEligibility({ trackerRoot, file: "quiet.md" }).reason).toBe("too-recent");
    expect(
      evaluateDistillEligibility({
        trackerRoot,
        file: "quiet.md",
        now: new Date(Date.now() + 10 * DAY_MS),
      }).reason,
    ).toBe("eligible");
  });
});
