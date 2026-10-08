/**
 * Raw preservation and provenance for `worklog distill` (M7/02).
 *
 * Distill throws content away on purpose, so the only thing standing between a
 * bad stub and a lost worklog is the raw copy under archive/worklog-raw/ and
 * the stamp that names it. These tests pin both: the copy lands before the
 * swap, a re-run over identical content is idempotent, a mismatched copy is
 * refused outright, and the stamp the CLI writes actually addresses the copy.
 *
 * pnpm vitest run worklog-distill-preserve
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { initTracker } from "../lib/tracker-writer.ts";
import { distillWorklogFile, STUB_WARN_BYTES } from "../lib/worklog-distill.ts";
import { parseDistillStamp } from "../lib/worklog.ts";

const RAW = [
  "# Worklog — M9-done",
  "",
  "## 01ABCDEFGHJKMNPQRSTV-alpha — alpha",
  "<!-- opened: 2020-01-01T00:00:00.000Z -->",
  "<!-- closed: 2020-01-02T00:00:00.000Z status: done -->",
  "### 2020-01-01T00:00:00.000Z [note]",
  "a long-forgotten decision nobody needs verbatim",
  "",
].join("\n");

const STUB = "# M9-done — anchor\n\nDecision: we kept the O_EXCL lock.\n";

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

describe("worklog distill — raw preservation and provenance", () => {
  let tmpDir: string;
  let trackerRoot: string;
  let worklogDir: string;
  let rawDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-distill-preserve-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    worklogDir = join(trackerRoot, "worklog");
    rawDir = join(trackerRoot, "archive", "worklog-raw");
    mkdirSync(worklogDir, { recursive: true });
    mkdirSync(join(trackerRoot, "archive"), { recursive: true });
    writeFileSync(join(trackerRoot, "archive", "M9-done.md"), "# archived\n", "utf-8");
    writeFileSync(join(worklogDir, "M9-done.md"), RAW, "utf-8");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function readWorklog(file = "M9-done.md"): string {
    return readFileSync(join(worklogDir, file), "utf-8");
  }

  function runTracker(args: string[], input?: string) {
    const result = spawnSync(
      "node",
      ["--experimental-strip-types", "--no-warnings", join(process.cwd(), "bin/tracker.mts"), ...args],
      { encoding: "utf-8", cwd: tmpDir, timeout: 30_000, input: input ?? "" },
    );
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? -1 };
  }

  // -------------------------------------------------------------------------
  // The raw copy.
  // -------------------------------------------------------------------------

  it("copies the raw file into archive/worklog-raw before swapping", () => {
    const result = distillWorklogFile({ trackerRoot, file: "M9-done.md", content: STUB });

    expect(result.rawPreserved).toBe("copied");
    expect(readFileSync(join(rawDir, "M9-done.md"), "utf-8")).toBe(RAW);
    expect(readWorklog()).toContain("Decision: we kept the O_EXCL lock.");
    expect(readWorklog()).not.toContain("a long-forgotten decision");
  });

  it("creates archive/worklog-raw when it does not exist yet", () => {
    expect(existsSync(rawDir)).toBe(false);
    distillWorklogFile({ trackerRoot, file: "M9-done.md", content: STUB });
    expect(existsSync(rawDir)).toBe(true);
  });

  it("is idempotent when the existing raw copy is byte-identical", () => {
    // Simulates a crash between the copy and the swap: the copy is already
    // there and matches the file still sitting in the worklog dir.
    mkdirSync(rawDir, { recursive: true });
    writeFileSync(join(rawDir, "M9-done.md"), RAW, "utf-8");

    const result = distillWorklogFile({ trackerRoot, file: "M9-done.md", content: STUB });

    expect(result.rawPreserved).toBe("already-identical");
    expect(result.sourceSha256).toBe(sha256(RAW));
    expect(readFileSync(join(rawDir, "M9-done.md"), "utf-8")).toBe(RAW);
  });

  it("refuses when an existing raw copy differs, and leaves both files alone", () => {
    mkdirSync(rawDir, { recursive: true });
    writeFileSync(join(rawDir, "M9-done.md"), "# a different worklog entirely\n", "utf-8");

    expect(() => distillWorklogFile({ trackerRoot, file: "M9-done.md", content: STUB })).toThrow(
      /differs from the current M9-done\.md — reconcile by hand/,
    );
    expect(readWorklog()).toBe(RAW);
    expect(readFileSync(join(rawDir, "M9-done.md"), "utf-8")).toBe("# a different worklog entirely\n");
  });

  it("has no flag that overrides a mismatched raw copy", () => {
    mkdirSync(rawDir, { recursive: true });
    writeFileSync(join(rawDir, "M9-done.md"), "# a different worklog entirely\n", "utf-8");

    const { stderr, exitCode } = runTracker([
      "worklog",
      "distill",
      "M9-done.md",
      "--stdin",
      "--force",
    ], STUB);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("there is no override flag");
    expect(readWorklog()).toBe(RAW);
  });

  // -------------------------------------------------------------------------
  // The provenance stamp.
  // -------------------------------------------------------------------------

  it("prepends a stamp naming the raw copy and its digest", () => {
    const result = distillWorklogFile({ trackerRoot, file: "M9-done.md", content: STUB });

    const lines = readWorklog().split("\n");
    expect(lines[0]).toBe(
      `<!-- distilled: ${result.distilledAt} source-sha256: ${sha256(RAW)} raw: .tracker/archive/worklog-raw/M9-done.md -->`,
    );

    const stamp = parseDistillStamp(readWorklog());
    expect(stamp).not.toBeNull();
    expect(Date.parse(stamp!.distilledAt)).toBeGreaterThan(0);
    expect(stamp!.sourceSha256).toBe(sha256(readFileSync(join(rawDir, "M9-done.md"), "utf-8")));
    expect(readFileSync(join(tmpDir, stamp!.rawPath), "utf-8")).toBe(RAW);
  });

  it("keeps the stub body verbatim under the stamp", () => {
    distillWorklogFile({ trackerRoot, file: "M9-done.md", content: STUB });

    const [, ...body] = readWorklog().split("\n");
    expect(body.join("\n")).toBe(STUB);
  });

  it("strips a stamp the caller echoed back instead of duplicating it", () => {
    distillWorklogFile({ trackerRoot, file: "M9-done.md", content: STUB });
    const firstPass = readWorklog();

    // The natural --force workflow: read the stub, edit it, pipe it back.
    distillWorklogFile({
      trackerRoot,
      file: "M9-done.md",
      content: `${firstPass.trimEnd()}\nPlus one more anchor.\n`,
      force: true,
    });

    const stampLines = readWorklog()
      .split("\n")
      .filter((l) => l.startsWith("<!-- distilled:"));
    expect(stampLines).toHaveLength(1);
    expect(readWorklog()).toContain("Plus one more anchor.");
  });

  // -------------------------------------------------------------------------
  // --force re-distill: the preserved raw stays the ORIGINAL, not the stub.
  // -------------------------------------------------------------------------

  it("keeps the original raw on a --force re-distill", () => {
    distillWorklogFile({ trackerRoot, file: "M9-done.md", content: STUB });

    const result = distillWorklogFile({
      trackerRoot,
      file: "M9-done.md",
      content: "# second pass\n",
      force: true,
    });

    expect(result.rawPreserved).toBe("kept-original");
    expect(result.sourceSha256).toBe(sha256(RAW));
    expect(readFileSync(join(rawDir, "M9-done.md"), "utf-8")).toBe(RAW);
    expect(readWorklog()).toContain("# second pass");
  });

  it("refuses a --force re-distill when the preserved raw went missing", () => {
    distillWorklogFile({ trackerRoot, file: "M9-done.md", content: STUB });
    rmSync(join(rawDir, "M9-done.md"));

    expect(() =>
      distillWorklogFile({ trackerRoot, file: "M9-done.md", content: STUB, force: true }),
    ).toThrow(/raw copy is missing/);
  });

  it("refuses a --force re-distill when the preserved raw was tampered with", () => {
    distillWorklogFile({ trackerRoot, file: "M9-done.md", content: STUB });
    writeFileSync(join(rawDir, "M9-done.md"), `${RAW}tampered\n`, "utf-8");

    expect(() =>
      distillWorklogFile({ trackerRoot, file: "M9-done.md", content: STUB, force: true }),
    ).toThrow(/no longer matches the recorded source-sha256/);
  });

  // -------------------------------------------------------------------------
  // Both content channels.
  // -------------------------------------------------------------------------

  it("accepts the stub on stdin", () => {
    const { stdout, exitCode } = runTracker(["worklog", "distill", "M9-done.md", "--stdin"], STUB);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("M9-done.md → anchor stub");
    expect(readWorklog()).toContain("Decision: we kept the O_EXCL lock.");
    expect(readFileSync(join(rawDir, "M9-done.md"), "utf-8")).toBe(RAW);
  });

  it("accepts the stub from --content <path>", () => {
    const stubPath = join(tmpDir, "stub.md");
    writeFileSync(stubPath, STUB, "utf-8");

    const { exitCode } = runTracker(["worklog", "distill", "M9-done.md", "--content", stubPath]);

    expect(exitCode).toBe(0);
    expect(readWorklog()).toContain("Decision: we kept the O_EXCL lock.");
  });

  it("requires exactly one of --content and --stdin", () => {
    const stubPath = join(tmpDir, "stub.md");
    writeFileSync(stubPath, STUB, "utf-8");

    for (const args of [[], ["--stdin", "--content", stubPath]]) {
      const { stderr, exitCode } = runTracker(["worklog", "distill", "M9-done.md", ...args], STUB);
      expect(exitCode).toBe(2);
      expect(stderr).toContain("exactly one of --content <path> or --stdin");
    }
    expect(readWorklog()).toBe(RAW);
  });

  it("refuses empty stub content", () => {
    const { stderr, exitCode } = runTracker(["worklog", "distill", "M9-done.md", "--stdin"], "  \n");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("refusing to distill to empty content");
    expect(readWorklog()).toBe(RAW);
  });

  // -------------------------------------------------------------------------
  // Size budget: warn, never refuse.
  // -------------------------------------------------------------------------

  it("warns about an oversize stub but still writes it", () => {
    const big = `# big\n\n${"x".repeat(STUB_WARN_BYTES + 1)}\n`;
    const { stdout, exitCode } = runTracker(["worklog", "distill", "M9-done.md", "--stdin"], big);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("over the 4096-byte anchor budget");
    expect(readWorklog()).toContain("x".repeat(STUB_WARN_BYTES + 1));
  });

  it("does not warn about a small stub", () => {
    const { stdout } = runTracker(["worklog", "distill", "M9-done.md", "--stdin"], STUB);
    expect(stdout).not.toContain("anchor budget");
  });

  // -------------------------------------------------------------------------
  // Nothing is preserved when the gates refuse.
  // -------------------------------------------------------------------------

  it("does not copy the raw file when a gate refuses", () => {
    writeFileSync(
      join(worklogDir, "M9-live.md"),
      ["## 01ABCDEFGHJKMNPQRSTW-open — open", "<!-- opened: 2020-01-01T00:00:00.000Z -->", ""].join("\n"),
      "utf-8",
    );

    const { exitCode } = runTracker(["worklog", "distill", "M9-live.md", "--stdin"], STUB);

    expect(exitCode).toBe(1);
    expect(existsSync(join(rawDir, "M9-live.md"))).toBe(false);
  });
});
