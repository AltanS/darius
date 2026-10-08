/**
 * Tests for `tracker verify-item <spec-path> <idx>`.
 *
 * pnpm vitest run verify-item
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { initTracker, addMilestone } from "../lib/tracker-writer.ts";

const SPEC = `---
updated: 2026-01-01
agent: test
---

# Single Item Spec

## Verification Checklist

### Implementation

- [ ] Echo hello
  - Command: \`awk 'BEGIN{print "hello"}'\`
  - Expected: \`stdout contains "hello"\`
- [ ] Exit zero
  - Command: \`test -d .\`
  - Expected: \`exit 0\`
- [ ] Will fail
  - Command: \`exit 1\`
  - Expected: \`exit 0\`
- [ ] No command pair
- [ ] Trivial no-op command
  - Command: \`echo manual: I checked it by hand\`
  - Expected: \`exit 0\`
`;

describe("verify-item", () => {
  let tmpDir: string;
  let trackerRoot: string;
  let specPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-verify-item-test-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    addMilestone({
      trackerRoot,
      name: "Test Milestone",
      slug: "test-milestone",
      owner: "dev@example.com",
    });
    const milestonePath = join(trackerRoot, "M1-test-milestone");
    specPath = join(milestonePath, "01-single-item.md");
    writeFileSync(specPath, SPEC, "utf-8");
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
      {
        encoding: "utf-8",
        cwd: tmpDir,
        timeout: 30_000,
      },
    );
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.status ?? -1,
    };
  }

  it("verifies item 0 and marks it [x]", () => {
    const { exitCode, stdout } = runTracker(["verify-item", specPath, "0"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("passed");

    const content = readFileSync(specPath, "utf-8");
    expect(content).toContain("- [x] Echo hello");
  });

  it("verifies item 1 (exit 0)", () => {
    const { exitCode } = runTracker(["verify-item", specPath, "1"]);
    expect(exitCode).toBe(0);
  });

  it("fails item 2 (exit 1 expected exit 0)", () => {
    const { exitCode, stderr } = runTracker(["verify-item", specPath, "2"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("failed");
  });

  it("exits 1 for item with no command pair", () => {
    const { exitCode, stderr } = runTracker(["verify-item", specPath, "3"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("no Command/Expected pair");
  });

  it("--dry-run does not mark the item", () => {
    runTracker(["verify-item", "--dry-run", specPath, "0"]);
    const content = readFileSync(specPath, "utf-8");
    expect(content).toContain("- [ ] Echo hello");
  });

  it("exits 1 for out-of-range index", () => {
    const { exitCode } = runTracker(["verify-item", specPath, "99"]);
    expect(exitCode).toBe(1);
  });

  it("reports already-done for pre-checked items", () => {
    // First mark item 0 as verified
    runTracker(["verify-item", specPath, "0"]);
    // Then try to verify again
    const { exitCode, stdout } = runTracker(["verify-item", specPath, "0"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("already done");
  });

  // -------------------------------------------------------------------------
  // M247/0a — trivial commands are refused, and the run is ledgered
  // -------------------------------------------------------------------------

  it("refuses a trivial-command item: exit 1, not marked, tells you how to record it", () => {
    const { exitCode, stderr } = runTracker(["verify-item", specPath, "4"]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("NOT verified");
    expect(stderr).toContain("shell no-op");
    expect(stderr).toContain("--evidence");

    const content = readFileSync(specPath, "utf-8");
    expect(content).toContain("- [ ] Trivial no-op command");
  });

  it("writes one ledger line per executed check, with the outcome and exit code", () => {
    runTracker(["verify-item", specPath, "0"]);
    runTracker(["verify-item", specPath, "2"]);
    runTracker(["verify-item", specPath, "4"]);

    const lines = readFileSync(join(trackerRoot, ".verification-log.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));

    expect(lines).toHaveLength(3);
    expect(lines[0].outcome).toBe("pass");
    expect(lines[0].exitCode).toBe(0);
    expect(lines[0].index).toBe(0);
    // Spec path is repo-relative, never absolute — the ledger is committed.
    expect(lines[0].spec).toBe(".tracker/M1-test-milestone/01-single-item.md");
    expect(lines[0].spec.startsWith("/")).toBe(false);
    expect(typeof lines[0].at).toBe("string");
    expect(typeof lines[0].pluginVersion).toBe("string");

    expect(lines[1].outcome).toBe("fail");
    expect(lines[1].exitCode).toBe(1);
    expect(lines[2].outcome).toBe("manual");
    expect(lines[2].exitCode).toBeNull();
  });

  it("--dry-run writes no ledger line", () => {
    runTracker(["verify-item", "--dry-run", specPath, "0"]);
    expect(existsSync(join(trackerRoot, ".verification-log.jsonl"))).toBe(false);
  });

  it("a passing item is stamped verification_method: executed", () => {
    runTracker(["verify-item", specPath, "0"]);
    const content = readFileSync(specPath, "utf-8");
    expect(content).toContain("verification_method: executed");
  });

  // Issue #4: a stray absolute (repo-root-prefixed) path still verifies — the
  // runner strips the cwd prefix so it degrades to its repo-relative form — and
  // the CLI warns so the author fixes the committed spec.
  it("strips a stray absolute path and warns (issue #4)", () => {
    writeFileSync(join(tmpDir, "marker.txt"), "x", "utf-8");
    const absSpec = `---
updated: 2026-01-01
agent: test
---

# Absolute Path Spec

## Verification Checklist

### Implementation

- [ ] Marker exists via absolute path
  - Command: \`test -f ${tmpDir}/marker.txt\`
  - Expected: \`exit 0\`
`;
    const absSpecPath = join(trackerRoot, "M1-test-milestone", "02-abs-path.md");
    writeFileSync(absSpecPath, absSpec, "utf-8");

    const { exitCode, stderr } = runTracker(["verify-item", absSpecPath, "0"]);
    expect(exitCode).toBe(0);
    expect(stderr).toContain("absolute path");

    const content = readFileSync(absSpecPath, "utf-8");
    expect(content).toContain("- [x] Marker exists via absolute path");
  });
});
