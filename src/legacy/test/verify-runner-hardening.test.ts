/**
 * v10.7.1 — the four ways the verify runner lied.
 *
 * 1. `--dry-run` executed every Command and only suppressed the writes.
 * 2. `verify` skipped anything already `[x]`, so it could never see a regression.
 * 3. Commands inherited the CLI's cwd, so an item could pass from one directory
 *    and fail from another.
 * 4. A fixed 60s budget killed any real test-suite/typecheck Command and filed
 *    the corpse as a generic `fail`.
 *
 * pnpm vitest run verify-runner-hardening
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { initTracker, addMilestone } from "../lib/tracker-writer.ts";
import {
  classifyItem,
  runVerification,
  DEFAULT_COMMAND_TIMEOUT_MS,
} from "../lib/verification/runner.ts";

const FRONTMATTER = `---
updated: 2026-01-01
agent: test
---
`;

function spec(body: string): string {
  return `${FRONTMATTER}
# Hardening Spec

## Verification Checklist

### Implementation

${body}`;
}

describe("verify runner hardening (v10.7.1)", () => {
  let tmpDir: string;
  let trackerRoot: string;
  let milestonePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-verify-hardening-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    addMilestone({
      trackerRoot,
      name: "Test Milestone",
      slug: "test-milestone",
      owner: "dev@example.com",
    });
    milestonePath = join(trackerRoot, "M1-test-milestone");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function runTracker(
    args: string[],
    opts: { cwd?: string } = {},
  ): { stdout: string; stderr: string; exitCode: number } {
    const result = spawnSync(
      "node",
      [
        "--experimental-strip-types",
        "--no-warnings",
        join(process.cwd(), "bin/tracker.mts"),
        ...args,
      ],
      {
        encoding: "utf-8",
        cwd: opts.cwd ?? tmpDir,
        timeout: 30_000,
      },
    );
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.status ?? -1,
    };
  }

  function writeSpec(name: string, body: string): string {
    const path = join(milestonePath, name);
    writeFileSync(path, spec(body), "utf-8");
    return path;
  }

  function ledgerLines(): Array<Record<string, unknown>> {
    const path = join(trackerRoot, ".verification-log.jsonl");
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf-8")
      .trim()
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  }

  // =========================================================================
  // Defect 1 — --dry-run must not spawn anything
  // =========================================================================

  describe("--dry-run executes nothing", () => {
    // The sentinel IS the assertion: a Command that touches a file cannot be
    // run "harmlessly". If the file appears, the dry run spawned a process.
    const SENTINEL = "dry-run-sentinel.txt";
    const SIDE_EFFECT_SPEC = `- [ ] Command with a side effect
  - Command: \`touch ${SENTINEL}\`
  - Expected: \`exit 0\`
`;

    it("verify --dry-run leaves no trace of the Command having run", () => {
      const specPath = writeSpec("01-side-effect.md", SIDE_EFFECT_SPEC);

      const { exitCode, stdout } = runTracker(["verify", "--dry-run", specPath]);

      expect(exitCode).toBe(0);
      expect(existsSync(join(tmpDir, SENTINEL))).toBe(false);
      expect(stdout).toContain("DRY RUN");
      expect(stdout).toContain("WOULD EXECUTE");
      expect(stdout).toContain(`touch ${SENTINEL}`);
      // No ledger line, no tick.
      expect(ledgerLines()).toHaveLength(0);
      expect(readFileSync(specPath, "utf-8")).toContain("- [ ] Command with a side effect");
    });

    it("verify-item --dry-run leaves no trace of the Command having run", () => {
      const specPath = writeSpec("02-side-effect.md", SIDE_EFFECT_SPEC);

      const { exitCode, stdout } = runTracker(["verify-item", "--dry-run", specPath, "0"]);

      expect(exitCode).toBe(0);
      expect(existsSync(join(tmpDir, SENTINEL))).toBe(false);
      expect(stdout).toContain("DRY RUN");
      expect(ledgerLines()).toHaveLength(0);
    });

    // Control: without --dry-run the very same fixture DOES fire, so the two
    // tests above are proving suppression and not a broken fixture.
    it("the same item without --dry-run really does run the Command", () => {
      const specPath = writeSpec("03-side-effect.md", SIDE_EFFECT_SPEC);

      const { exitCode } = runTracker(["verify-item", specPath, "0"]);

      expect(exitCode).toBe(0);
      expect(existsSync(join(tmpDir, SENTINEL))).toBe(true);
    });

    it("classifies every item kind without touching any of them", () => {
      const specPath = writeSpec(
        "04-classification.md",
        `- [ ] Real check
  - Command: \`touch ${SENTINEL}\`
  - Expected: \`exit 0\`
- [ ] No-op check
  - Command: \`echo manual: I looked at it\`
  - Expected: \`exit 0\`
- [ ] Broken clause
  - Command: \`touch never-happens.txt\`
  - Expected: \`exits with zero\`
- [ ] Prose only
- [ ] File check
  - Command: \`test -f README.md\`
  - Expected: \`file exists README.md\`
`,
      );

      const { exitCode, stdout } = runTracker(["verify", "--dry-run", specPath]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("WOULD EXECUTE");
      expect(stdout).toContain("MANUAL");
      expect(stdout).toContain("GRAMMAR ERROR");
      expect(stdout).toContain("NO COMMAND/EXPECTED PAIR");
      expect(stdout).toContain("WOULD STAT");
      expect(stdout).toContain(
        "1 would execute, 1 would stat, 1 manual, 1 grammar error, 1 no pair, 0 already done",
      );

      expect(existsSync(join(tmpDir, SENTINEL))).toBe(false);
      expect(existsSync(join(tmpDir, "never-happens.txt"))).toBe(false);
      expect(readFileSync(specPath, "utf-8")).not.toContain("- [x]");
    });

    it("names the directory Commands would run in and the timeout that would apply", () => {
      const specPath = writeSpec("05-report-header.md", SIDE_EFFECT_SPEC);

      const { stdout } = runTracker(["verify", "--dry-run", "--timeout", "300", specPath]);

      expect(stdout).toContain(`Commands would run from: ${tmpDir}`);
      expect(stdout).toContain("timeout 300s");
    });

    it("classifyItem is a pure classification — no spawn, no stat, no write", () => {
      const result = classifyItem({
        command: `touch ${join(tmpDir, "unit-sentinel.txt")}`,
        expected: "exit 0",
        index: 0,
        label: "unit",
      });

      expect(result.kind).toBe("would-execute");
      expect(existsSync(join(tmpDir, "unit-sentinel.txt"))).toBe(false);
    });
  });

  // =========================================================================
  // Defect 2 — --recheck, so verify is not a one-way ratchet
  // =========================================================================

  describe("--recheck re-executes already-verified items", () => {
    const KEEPER = "keeper.txt";
    const REGRESSION_SPEC = `- [ ] Keeper file is present
  - Command: \`test -f ${KEEPER}\`
  - Expected: \`exit 0\`
`;

    function armPassingItem(name: string): string {
      writeFileSync(join(tmpDir, KEEPER), "present\n", "utf-8");
      const specPath = writeSpec(name, REGRESSION_SPEC);
      const first = runTracker(["verify", specPath]);
      expect(first.exitCode).toBe(0);
      expect(readFileSync(specPath, "utf-8")).toContain("- [x] Keeper file is present");
      return specPath;
    }

    it("without --recheck a broken previously-verified item stays invisible", () => {
      const specPath = armPassingItem("01-ratchet.md");
      rmSync(join(tmpDir, KEEPER));

      const { exitCode, stdout } = runTracker(["verify", specPath]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("1 already done");
    });

    it("--recheck re-runs a passing item and re-stamps verification_passed", () => {
      const specPath = armPassingItem("02-restamp.md");
      const before = /verification_passed: (.+)/.exec(readFileSync(specPath, "utf-8"))?.[1];
      expect(before).toBeTruthy();

      const { exitCode, stdout } = runTracker(["verify", specPath, "--recheck"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("1 rechecked");
      expect(stdout).toContain("0 regressions");

      const after = /verification_passed: (.+)/.exec(readFileSync(specPath, "utf-8"))?.[1];
      expect(after).toBeTruthy();
      expect(after).not.toBe(before);

      const outcomes = ledgerLines().map((e) => e.outcome);
      expect(outcomes).toEqual(["pass", "pass"]);
    });

    it("--recheck reports a REGRESSION loudly, exits 1, and does NOT untick the box", () => {
      const specPath = armPassingItem("03-regression.md");
      rmSync(join(tmpDir, KEEPER));

      const { exitCode, stdout, stderr } = runTracker(["verify", specPath, "--recheck"]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain("REGRESSION");
      expect(stderr).toContain("Keeper file is present");
      expect(stdout).toContain("1 regression");

      // The tick is history, not live status — it stays.
      expect(readFileSync(specPath, "utf-8")).toContain("- [x] Keeper file is present");

      const last = ledgerLines().at(-1);
      expect(last?.outcome).toBe("regression");
    });

    it("verify-item --recheck reports a REGRESSION and leaves the box ticked", () => {
      const specPath = armPassingItem("04-regression-item.md");
      rmSync(join(tmpDir, KEEPER));

      const { exitCode, stderr } = runTracker(["verify-item", specPath, "0", "--recheck"]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain("REGRESSION");
      expect(readFileSync(specPath, "utf-8")).toContain("- [x] Keeper file is present");
      expect(ledgerLines().at(-1)?.outcome).toBe("regression");
    });

    it("verify-item --recheck re-stamps a still-passing item", () => {
      const specPath = armPassingItem("05-recheck-item.md");

      const { exitCode, stdout } = runTracker(["verify-item", specPath, "0", "--recheck"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("re-verified");
      expect(ledgerLines().at(-1)?.outcome).toBe("pass");
    });

    it("manual-evidence items are unrecheckable, never failed", () => {
      const specPath = writeSpec(
        "06-manual.md",
        `- [x] Confirmed by hand
  - Command: \`echo manual: I read the dashboard\`
  - Expected: \`exit 0\`
- [x] Prose only, no pair
`,
      );

      const { exitCode, stdout } = runTracker(["verify", specPath, "--recheck"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Unrecheckable items");
      expect(stdout).toContain("shell no-op");
      expect(stdout).toContain("no Command/Expected pair");
      expect(stdout).toContain("0 regressions");
    });

    it("verify-item --recheck on a manual item says unrecheckable and exits 0", () => {
      const specPath = writeSpec(
        "07-manual-item.md",
        `- [x] Confirmed by hand
  - Command: \`echo manual: I read the dashboard\`
  - Expected: \`exit 0\`
`,
      );

      const { exitCode, stdout } = runTracker(["verify-item", specPath, "0", "--recheck"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("not recheckable");
    });

    it("--dry-run --recheck says an already-verified item WOULD be re-executed", () => {
      const specPath = armPassingItem("08-dry-recheck.md");

      const plain = runTracker(["verify", "--dry-run", specPath]);
      expect(plain.stdout).toContain("ALREADY DONE");
      expect(plain.stdout).toContain("--recheck");

      const rechecking = runTracker(["verify", "--dry-run", "--recheck", specPath]);
      expect(rechecking.stdout).toContain("RECHECK — WOULD EXECUTE");
    });
  });

  // =========================================================================
  // Defect 3 — Commands run from the workspace root, wherever the CLI was called
  // =========================================================================

  describe("deterministic cwd", () => {
    it("a relative Command resolves the same from a subdirectory as from the root", () => {
      writeFileSync(join(tmpDir, "marker.txt"), "hello\n", "utf-8");
      const specPath = writeSpec(
        "01-relative.md",
        `- [ ] Marker readable
  - Command: \`cat marker.txt\`
  - Expected: \`stdout contains "hello"\`
`,
      );
      const subDir = join(tmpDir, "sub", "deeper");
      mkdirSync(subDir, { recursive: true });

      const { exitCode } = runTracker(["verify-item", specPath, "0"], { cwd: subDir });

      expect(exitCode).toBe(0);
      expect(readFileSync(specPath, "utf-8")).toContain("- [x] Marker readable");
    });

    it("a relative `file exists` path resolves against the workspace root too", () => {
      writeFileSync(join(tmpDir, "marker.txt"), "hello\n", "utf-8");
      // The Command is real (a shell no-op would classify `manual` before the
      // file check ever ran — that precedence is deliberate and unchanged).
      const specPath = writeSpec(
        "02-file-exists.md",
        `- [ ] Marker present
  - Command: \`test -f marker.txt\`
  - Expected: \`file exists marker.txt\`
`,
      );
      const subDir = join(tmpDir, "sub");
      mkdirSync(subDir, { recursive: true });

      const { exitCode } = runTracker(["verify-item", specPath, "0"], { cwd: subDir });

      expect(exitCode).toBe(0);
    });

    it("the Command's own cwd is the workspace root, not the invocation directory", () => {
      const specPath = writeSpec(
        "03-pwd.md",
        `- [ ] Runs from the workspace root
  - Command: \`pwd\`
  - Expected: \`stdout contains "${tmpDir}"\`
`,
      );
      const subDir = join(tmpDir, "sub");
      mkdirSync(subDir, { recursive: true });

      const fromSub = runTracker(["verify-item", "--dry-run", specPath, "0"], { cwd: subDir });
      expect(fromSub.stdout).toContain(`Commands would run from: ${tmpDir}`);

      const { exitCode } = runTracker(["verify-item", specPath, "0"], { cwd: subDir });
      expect(exitCode).toBe(0);
    });

    it("runVerification honours an explicit cwd", () => {
      writeFileSync(join(tmpDir, "marker.txt"), "hello\n", "utf-8");
      const input = {
        command: "cat marker.txt",
        expected: 'stdout contains "hello"',
        index: 0,
        label: "unit",
      };

      expect(runVerification(input, { cwd: tmpDir }).outcome).toBe("pass");
      expect(runVerification(input, { cwd: join(tmpDir, ".tracker") }).outcome).toBe("fail");
    });
  });

  // =========================================================================
  // Defect 4 — --timeout, and a timeout that reports as itself
  // =========================================================================

  describe("--timeout", () => {
    const SLOW_SPEC = `- [ ] Slow check
  - Command: \`sleep 5\`
  - Expected: \`exit 0\`
`;

    it("defaults to 60s", () => {
      expect(DEFAULT_COMMAND_TIMEOUT_MS).toBe(60_000);
    });

    it("verify reports a blown budget as a timeout, not a failure, naming the limit", () => {
      const specPath = writeSpec("01-slow.md", SLOW_SPEC);

      const { exitCode, stdout, stderr } = runTracker([
        "verify",
        specPath,
        "--timeout",
        "1",
      ]);

      expect(exitCode).toBe(1);
      expect(stdout).toContain("1 timed out");
      expect(stdout).toContain("0 failed");
      expect(stderr).toContain("Timed out (limit 1s");
      expect(stderr).toContain("--timeout <seconds>");
      expect(ledgerLines().at(-1)?.outcome).toBe("timeout");
      // Never silently ticked.
      expect(readFileSync(specPath, "utf-8")).toContain("- [ ] Slow check");
    });

    it("verify-item reports the timeout distinctly and ledgers it as `timeout`", () => {
      const specPath = writeSpec("02-slow-item.md", SLOW_SPEC);

      const { exitCode, stderr } = runTracker([
        "verify-item",
        specPath,
        "0",
        "--timeout",
        "1",
      ]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain("TIMED OUT after 1s");
      expect(stderr).not.toContain("failed:");
      expect(ledgerLines().at(-1)?.outcome).toBe("timeout");
    });

    it("a raised budget lets a slow-but-finishing command pass", () => {
      const specPath = writeSpec(
        "03-slow-ok.md",
        `- [ ] Slow but finishes
  - Command: \`sleep 2 && printf ok\`
  - Expected: \`stdout contains "ok"\`
`,
      );

      const { exitCode } = runTracker(["verify-item", specPath, "0", "--timeout", "20"]);

      expect(exitCode).toBe(0);
    });

    it("refuses a nonsense --timeout instead of silently reverting to 60s", () => {
      const specPath = writeSpec("04-bad-timeout.md", SLOW_SPEC);

      // `--timeout=-5` rather than `--timeout -5`: node's own parseArgs rejects
      // the space-separated dash form before we ever see the value.
      for (const bad of ["--timeout=0", "--timeout=-5", "--timeout=abc", "--timeout=1.5"]) {
        const { exitCode, stderr } = runTracker(["verify", specPath, bad]);
        expect(exitCode).toBe(1);
        expect(stderr).toContain("--timeout takes a positive whole number of seconds");
      }
    });

    it("runVerification surfaces the limit it hit on the result", () => {
      const result = runVerification(
        { command: "sleep 5", expected: "exit 0", index: 0, label: "unit" },
        { cwd: tmpDir, timeoutMs: 500 },
      );

      expect(result.outcome).toBe("timeout");
      if (result.outcome === "timeout") {
        expect(result.timeoutMs).toBe(500);
        expect(result.reason).toContain("0.5s");
      }
    });
  });
});
