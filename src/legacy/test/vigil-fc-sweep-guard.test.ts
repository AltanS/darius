/**
 * `vigil add --stdin` / `vigil set-body --stdin` reject a self-recursing
 * `fc vigil-sweep` Command; `tracker doctor` warns on heavy Commands (v10.9.3).
 *
 * a project's own sweep script executes every open vigil's `Command:` lines
 * unattended. On 2026-09-03 a vigil whose Command invoked `fc vigil-sweep`
 * itself recursed 14 levels deep and nearly killed the host — the sweep ran
 * the vigil, whose Command re-ran the sweep, which ran the vigil again. This
 * pins the write-time refusal that closes that hole, plus the separate
 * doctor-only warning for Commands that are merely expensive (toolbox
 * spin-ups, full evaluation runs, bounded `--runs` batches, `fc discover` /
 * `fc check`) rather than recursive.
 *
 * pnpm exec vitest run test/vigil-fc-sweep-guard.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTracker } from "../lib/tracker-writer.ts";

/** A body that passes every existing rule: heading, one real Command. */
const NORMAL_BODY = [
  "## Verification Checklist",
  "",
  "- [ ] the guard marker appears in prod logs",
  "  - Command: `test -f /etc/os-release`",
  "  - Expected: `exit 0`",
  "",
].join("\n");

/** A body whose Command recurses into the sweep that runs it. */
const RECURSIVE_BODY = [
  "## Verification Checklist",
  "",
  "- [ ] check the latest sweep output",
  "  - Command: `sweep fc vigil-sweep --json`",
  "  - Expected: `exit 0`",
  "",
].join("\n");

/** A body whose Command is real but heavy (toolbox spin-up). */
const HEAVY_BODY = [
  "## Verification Checklist",
  "",
  "- [ ] the sport pipeline still runs end to end",
  "  - Command: `toolbox run --container ts-dev bash -lc 'pnpm eval-football --runs 5'`",
  "  - Expected: `exit 0`",
  "",
].join("\n");

describe("vigil add/set-body — fc vigil-sweep recursion guard + heavy-Command warning", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-vigil-sweep-guard-"));
    initTracker({ projectRoot: tmpDir });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function runTracker(
    args: string[],
    input?: string,
  ): { stdout: string; stderr: string; exitCode: number } {
    const result = spawnSync(
      "node",
      [
        "--experimental-strip-types",
        "--no-warnings",
        join(process.cwd(), "bin/tracker.mts"),
        ...args,
      ],
      { encoding: "utf-8", cwd: tmpDir, timeout: 30_000, input: input ?? "" },
    );
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.status ?? -1,
    };
  }

  function vigilPath(slug: string): string {
    return join(tmpDir, ".tracker", "vigils", `${slug}.md`);
  }

  // -------------------------------------------------------------------------
  // rejection: fc vigil-sweep in a Command
  // -------------------------------------------------------------------------

  it("vigil add --stdin refuses a Command that invokes fc vigil-sweep, and writes nothing", () => {
    const { exitCode, stderr } = runTracker(
      ["vigil", "add", "soak", "--until", "batch", "--stdin"],
      RECURSIVE_BODY,
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      "vigil Commands run unattended by fc vigil-sweep; a vigil that invokes the sweep recurses.",
    );
    expect(stderr).toContain("Read .tracker/.fc-vigil-sweep-latest.json instead.");
    expect(existsSync(vigilPath("soak"))).toBe(false);
  });

  it("vigil set-body --stdin refuses a Command that invokes fc vigil-sweep, leaving the file alone", () => {
    runTracker(["vigil", "add", "soak", "--until", "batch", "--stdin"], NORMAL_BODY);
    const before = readFileSync(vigilPath("soak"), "utf-8");

    const { exitCode, stderr } = runTracker(
      ["vigil", "set-body", "soak", "--stdin"],
      RECURSIVE_BODY,
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("vigil Commands run unattended by fc vigil-sweep");
    expect(readFileSync(vigilPath("soak"), "utf-8")).toBe(before);
  });

  it("refuses the recursive Command regardless of surrounding arguments", () => {
    const body = [
      "## Verification Checklist",
      "",
      "- [ ] nested invocation",
      "  - Command: `cd sweep-app && pnpm exec tsx src/cli.ts fc vigil-sweep --dry-run`",
      "  - Expected: `exit 0`",
      "",
    ].join("\n");
    const { exitCode, stderr } = runTracker(
      ["vigil", "add", "nested", "--until", "batch", "--stdin"],
      body,
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("vigil Commands run unattended by fc vigil-sweep");
  });

  // -------------------------------------------------------------------------
  // a normal body is still accepted
  // -------------------------------------------------------------------------

  it("vigil add --stdin still accepts a normal, non-recursive, non-heavy body", () => {
    const { exitCode, stdout } = runTracker(
      ["vigil", "add", "soak", "--until", "batch", "--stdin"],
      NORMAL_BODY,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("created");
    expect(existsSync(vigilPath("soak"))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // doctor: heavy-Command warning (never a rejection at write time)
  // -------------------------------------------------------------------------

  it("vigil add --stdin accepts a heavy-but-legitimate Command (not a recursion, so not refused)", () => {
    const { exitCode } = runTracker(
      ["vigil", "add", "heavy", "--until", "batch", "--stdin"],
      HEAVY_BODY,
    );
    expect(exitCode).toBe(0);
    expect(existsSync(vigilPath("heavy"))).toBe(true);
  });

  it("tracker doctor warns (but still exits healthy) on an armed vigil with a heavy Command", () => {
    runTracker(["vigil", "add", "heavy", "--until", "batch", "--stdin"], HEAVY_BODY);
    const { exitCode, stdout, stderr } = runTracker(["doctor"]);
    const combined = stdout + stderr;
    expect(exitCode).toBe(0);
    expect(combined).toContain("heavy Command in vigil heavy");
    expect(combined).toContain("the daily sweep skips it unless --include-heavy");
  });

  it("tracker doctor stays quiet about heavy Commands for a normal vigil", () => {
    runTracker(["vigil", "add", "soak", "--until", "batch", "--stdin"], NORMAL_BODY);
    const { exitCode, stdout, stderr } = runTracker(["doctor"]);
    const combined = stdout + stderr;
    expect(exitCode).toBe(0);
    expect(combined).not.toContain("heavy Command in vigil");
  });
});
