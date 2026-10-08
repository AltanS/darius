/**
 * Tests for `tracker verify <spec-path>`.
 *
 * pnpm vitest run verify-spec
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { initTracker, addMilestone } from "../lib/tracker-writer.ts";

// A spec with Command/Expected pairs — using always-passing commands
const SPEC_WITH_COMMANDS = `---
updated: 2026-01-01
agent: test
---

# My Verifiable Spec

## Verification Checklist

### Implementation

- [ ] Echo check passes
  - Command: \`awk 'BEGIN{print "hello"}'\`
  - Expected: \`stdout contains "hello"\`
- [ ] Exit zero check
  - Command: \`test -d .\`
  - Expected: \`exit 0\`
- [ ] No command here
`;

// Two real checks and one placeholder — the shape a spec actually arrives in.
const SPEC_WITH_TRIVIAL_COMMAND = `---
updated: 2026-01-01
agent: test
---

# Mixed Spec

## Verification Checklist

### Implementation

- [ ] Real check
  - Command: \`test -d .\`
  - Expected: \`exit 0\`
- [ ] Confirmed by hand
  - Command: \`echo manual: confirm the dashboard renders\`
  - Expected: \`exit 0\`
`;

const SPEC_WITH_FAILING_COMMAND = `---
updated: 2026-01-01
agent: test
---

# Failing Spec

## Verification Checklist

### Implementation

- [ ] Will fail
  - Command: \`exit 1\`
  - Expected: \`exit 0\`
`;

const SPEC_ALREADY_CHECKED = `---
updated: 2026-01-01
agent: test
---

# Already Done Spec

## Verification Checklist

### Implementation

- [x] Already verified
  - Command: \`awk 'BEGIN{print "hello"}'\`
  - Expected: \`stdout contains "hello"\`
`;

describe("verify-spec", () => {
  let tmpDir: string;
  let trackerRoot: string;
  let milestonePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-verify-spec-test-"));
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

  it("verifies items with Command/Expected pairs and marks them [x]", () => {
    const specPath = join(milestonePath, "01-verifiable.md");
    writeFileSync(specPath, SPEC_WITH_COMMANDS, "utf-8");

    const { exitCode, stdout } = runTracker(["verify", specPath]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("verified");

    const content = readFileSync(specPath, "utf-8");
    expect(content).toContain("- [x] Echo check passes");
    expect(content).toContain("- [x] Exit zero check");
  });

  it("exits 1 when some items fail", () => {
    const specPath = join(milestonePath, "01-failing.md");
    writeFileSync(specPath, SPEC_WITH_FAILING_COMMAND, "utf-8");

    const { exitCode, stdout, stderr } = runTracker(["verify", specPath]);

    expect(exitCode).toBe(1);
    // Summary goes to stdout
    expect(stdout + stderr).toContain("failed");
  });

  it("counts already-checked items separately", () => {
    const specPath = join(milestonePath, "01-already-done.md");
    writeFileSync(specPath, SPEC_ALREADY_CHECKED, "utf-8");

    const { exitCode, stdout } = runTracker(["verify", specPath]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("already done");
  });

  it("--dry-run runs checks but does not modify the file", () => {
    const specPath = join(milestonePath, "01-dry-run.md");
    writeFileSync(specPath, SPEC_WITH_COMMANDS, "utf-8");

    const { exitCode } = runTracker(["verify", "--dry-run", specPath]);

    expect(exitCode).toBe(0);

    const content = readFileSync(specPath, "utf-8");
    // Still unchecked because dry-run
    expect(content).toContain("- [ ] Echo check passes");
  });

  it("exits 1 for nonexistent spec file", () => {
    const { exitCode } = runTracker(["verify", "/nonexistent/path.md"]);
    expect(exitCode).toBe(1);
  });

  // -------------------------------------------------------------------------
  // M247/0a — trivial commands count as manual, never as verified
  // -------------------------------------------------------------------------

  it("leaves a trivial-command item unmarked and reports it as manual", () => {
    const specPath = join(milestonePath, "01-mixed.md");
    writeFileSync(specPath, SPEC_WITH_TRIVIAL_COMMAND, "utf-8");

    const { exitCode, stdout } = runTracker(["verify", specPath]);

    // Manual items are not failures — the item just stays unchecked.
    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 verified");
    expect(stdout).toContain("1 manual");
    expect(stdout).toContain("--evidence");

    const content = readFileSync(specPath, "utf-8");
    expect(content).toContain("- [x] Real check");
    expect(content).toContain("- [ ] Confirmed by hand");
  });

  it("ledgers both the executed check and the manual one", () => {
    const specPath = join(milestonePath, "01-mixed.md");
    writeFileSync(specPath, SPEC_WITH_TRIVIAL_COMMAND, "utf-8");

    runTracker(["verify", specPath]);

    const entries = readFileSync(join(trackerRoot, ".verification-log.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));

    expect(entries.map((e) => e.outcome)).toEqual(["pass", "manual"]);
    expect(entries[0].spec).toBe(".tracker/M1-test-milestone/01-mixed.md");
    expect(entries[1].command).toContain("echo manual:");
  });
});
