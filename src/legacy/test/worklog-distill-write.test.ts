/**
 * The distill write path (M7/02).
 *
 * Distill is the one worklog write that is allowed to destroy content, so the
 * mechanics around it have to hold: the same O_EXCL lock every other mutator
 * takes, an atomic swap that leaves no debris, a lossless-guard bypass that
 * exists in exactly one place, and a distilled file that reads back as
 * `distilled` rather than as anonymous legacy prose.
 *
 * pnpm vitest run worklog-distill-write
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  existsSync,
  openSync,
  closeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { initTracker } from "../lib/tracker-writer.ts";
import { distillWorklogFile } from "../lib/worklog-distill.ts";
import { appendThread, listWorklogFiles, parseWorklogMarkdown } from "../lib/worklog.ts";

const RAW = [
  "# Worklog — M9-done",
  "",
  "## 01ABCDEFGHJKMNPQRSTV-alpha — alpha",
  "<!-- opened: 2020-01-01T00:00:00.000Z -->",
  "<!-- closed: 2020-01-02T00:00:00.000Z status: done -->",
  "### 2020-01-01T00:00:00.000Z [note]",
  "verbatim detail that the anchor will not keep",
  "",
].join("\n");

const STUB = ["# M9-done — anchor", "", "## Decisions", "- kept the O_EXCL lock", ""].join("\n");

describe("worklog distill — write path", () => {
  let tmpDir: string;
  let trackerRoot: string;
  let worklogDir: string;
  let worklogPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-distill-write-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    worklogDir = join(trackerRoot, "worklog");
    worklogPath = join(worklogDir, "M9-done.md");
    mkdirSync(worklogDir, { recursive: true });
    mkdirSync(join(trackerRoot, "archive"), { recursive: true });
    writeFileSync(join(trackerRoot, "archive", "M9-done.md"), "# archived\n", "utf-8");
    writeFileSync(worklogPath, RAW, "utf-8");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function runTracker(args: string[], input?: string) {
    const result = spawnSync(
      "node",
      ["--experimental-strip-types", "--no-warnings", join(process.cwd(), "bin/tracker.mts"), ...args],
      { encoding: "utf-8", cwd: tmpDir, timeout: 60_000, input: input ?? "" },
    );
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? -1 };
  }

  // -------------------------------------------------------------------------
  // Locking.
  // -------------------------------------------------------------------------

  it(
    "fails cleanly when another process holds the worklog lock",
    () => {
      // Exactly what a concurrent distill/append leaves behind while it works.
      const lockPath = `${worklogPath}.lock`;
      closeSync(openSync(lockPath, "wx"));

      try {
        expect(() => distillWorklogFile({ trackerRoot, file: "M9-done.md", content: STUB })).toThrow(
          /Failed to acquire lock/,
        );
        expect(readFileSync(worklogPath, "utf-8")).toBe(RAW);
        expect(existsSync(join(trackerRoot, "archive", "worklog-raw", "M9-done.md"))).toBe(false);
        // The failed attempt must not steal the other holder's lock.
        expect(existsSync(lockPath)).toBe(true);
      } finally {
        rmSync(lockPath, { force: true });
      }
    },
    60_000,
  );

  it("releases the lock after a successful distill", () => {
    distillWorklogFile({ trackerRoot, file: "M9-done.md", content: STUB });
    expect(existsSync(`${worklogPath}.lock`)).toBe(false);
  });

  it("releases the lock after a refused distill", () => {
    writeFileSync(
      join(worklogDir, "M9-open.md"),
      ["## 01ABCDEFGHJKMNPQRSTW-open — open", "<!-- opened: 2020-01-01T00:00:00.000Z -->", ""].join("\n"),
      "utf-8",
    );

    expect(() => distillWorklogFile({ trackerRoot, file: "M9-open.md", content: STUB })).toThrow();
    expect(existsSync(join(worklogDir, "M9-open.md.lock"))).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Atomic swap.
  // -------------------------------------------------------------------------

  it("leaves no temp or lock debris in the worklog or archive dirs", () => {
    distillWorklogFile({ trackerRoot, file: "M9-done.md", content: STUB });

    expect(readdirSync(worklogDir)).toEqual(["M9-done.md"]);
    expect(readdirSync(join(trackerRoot, "archive", "worklog-raw"))).toEqual(["M9-done.md"]);
  });

  it("never leaves the worklog file partially written", () => {
    distillWorklogFile({ trackerRoot, file: "M9-done.md", content: STUB });

    const written = readFileSync(worklogPath, "utf-8");
    expect(written.startsWith("<!-- distilled: ")).toBe(true);
    expect(written.endsWith("\n")).toBe(true);
    expect(written).toContain("- kept the O_EXCL lock");
  });

  // -------------------------------------------------------------------------
  // The lossless guard: bypassed here, and only here.
  // -------------------------------------------------------------------------

  it("discards content the lossless guard would have refused to drop", () => {
    distillWorklogFile({ trackerRoot, file: "M9-done.md", content: STUB });

    const written = readFileSync(worklogPath, "utf-8");
    expect(written).not.toContain("verbatim detail that the anchor will not keep");
    expect(written).not.toContain("01ABCDEFGHJKMNPQRSTV-alpha");
  });

  it("keeps the lossless guard on exactly one code path, and distill is not it", () => {
    const worklogSrc = readFileSync(join(process.cwd(), "lib/worklog.ts"), "utf-8");
    const distillSrc = readFileSync(join(process.cwd(), "lib/worklog-distill.ts"), "utf-8");

    // One declaration + one call site (readDocForMutation). Any third mention
    // means the guard grew a second entry point or a second bypass.
    expect(worklogSrc.match(/assertWorklogLossless\(/g)).toHaveLength(2);
    expect(distillSrc.match(/assertWorklogLossless\(/g)).toBeNull();

    // Every thread mutator still reads through the guarded path: one
    // declaration + open/append/close/set-stage/dispatch/park.
    expect(worklogSrc.match(/readDocForMutation\(/g)).toHaveLength(7);
    expect(distillSrc.match(/readDocForMutation\(/g)).toBeNull();
  });

  it("still preserves hand-written prose on a thread mutation", () => {
    const legacyPath = join(worklogDir, "cross-cutting.md");
    writeFileSync(
      legacyPath,
      [
        "# Worklog — cross-cutting",
        "",
        "## Hand-written section",
        "prose the CLI never wrote",
        "",
        "## 01ABCDEFGHJKMNPQRSTX-beta — beta",
        "<!-- opened: 2020-01-01T00:00:00.000Z -->",
        "",
      ].join("\n"),
      "utf-8",
    );

    appendThread({
      worklogPath: legacyPath,
      threadId: "01ABCDEFGHJKMNPQRSTX-beta",
      section: "note",
      message: "an update",
    });

    const after = readFileSync(legacyPath, "utf-8");
    expect(after).toContain("## Hand-written section");
    expect(after).toContain("prose the CLI never wrote");
    expect(after).toContain("an update");
  });

  // -------------------------------------------------------------------------
  // How a distilled file reads back.
  // -------------------------------------------------------------------------

  it("reports state distilled in worklog list, taking precedence over legacy", () => {
    distillWorklogFile({ trackerRoot, file: "M9-done.md", content: STUB });

    // The stub is thread-less prose with an unmarked `## ` heading — exactly the
    // shape that reads as `legacy` without a stamp.
    const doc = parseWorklogMarkdown(readFileSync(worklogPath, "utf-8"));
    expect(doc.threads).toEqual([]);
    expect(doc.foldedHeadings).toBe(1);

    expect(listWorklogFiles({ trackerRoot })).toEqual([
      { worklogFile: "M9-done.md", threadCount: 0, state: "distilled", legacy: false },
    ]);

    const { stdout, exitCode } = runTracker(["worklog", "list"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("M9-done.md  (distilled)  distilled anchor stub");
    expect(stdout).not.toContain("(legacy)");
  });

  it("keeps a distilled file out of the thread listing entirely", () => {
    distillWorklogFile({ trackerRoot, file: "M9-done.md", content: STUB });

    const { stdout } = runTracker(["worklog", "list", "--json"]);
    const json = JSON.parse(stdout) as { threads: unknown[]; files: Array<{ state: string }> };
    expect(json.threads).toEqual([]);
    expect(json.files.map((f) => f.state)).toEqual(["distilled"]);
  });

  // -------------------------------------------------------------------------
  // End-to-end through the CLI.
  // -------------------------------------------------------------------------

  it("distills an archived-milestone file, refuses an active one, and gates a cross-cutting one", () => {
    // Archived milestone → distills.
    expect(runTracker(["worklog", "distill", "M9-done.md", "--stdin"], STUB).exitCode).toBe(0);
    expect(readFileSync(worklogPath, "utf-8")).toContain("# M9-done — anchor");

    // Active milestone → refused, untouched.
    const activePath = join(worklogDir, "M9-live.md");
    writeFileSync(activePath, RAW, "utf-8");
    mkdirSync(join(trackerRoot, "M9-live"), { recursive: true });
    const active = runTracker(["worklog", "distill", "M9-live.md", "--stdin"], STUB);
    expect(active.exitCode).toBe(1);
    expect(active.stderr).toContain("still active");
    expect(readFileSync(activePath, "utf-8")).toBe(RAW);

    // Cross-cutting → gated by age, then allowed with --min-age-days 0.
    const crossPath = join(worklogDir, "cross-cutting.md");
    writeFileSync(crossPath, "# notes\n\nrecent scratch\n", "utf-8");
    const tooRecent = runTracker(["worklog", "distill", "cross-cutting.md", "--stdin"], STUB);
    expect(tooRecent.exitCode).toBe(1);
    expect(tooRecent.stderr).toContain("day(s) ago");
    expect(readFileSync(crossPath, "utf-8")).toBe("# notes\n\nrecent scratch\n");

    const forced = runTracker(
      ["worklog", "distill", "cross-cutting.md", "--stdin", "--min-age-days", "0"],
      STUB,
    );
    expect(forced.exitCode).toBe(0);
    expect(readFileSync(crossPath, "utf-8")).toContain("# M9-done — anchor");
  });
});
