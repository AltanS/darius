/**
 * Tests for `tracker mark --evidence` and the `verification_method:` stamp.
 *
 * M247/0a: a `[x]` must say how it was earned. A trivial Command
 * (echo/printf/true/:) proves nothing, so `--verified` on such an item is
 * refused unless the caller says what they actually checked; the claim then
 * lands in `.verification-log.jsonl` as evidence.
 *
 * pnpm vitest run mark-evidence
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { initTracker, addMilestone } from "../lib/tracker-writer.ts";

const SPEC = `---
updated: 2026-01-01
agent: test
---

# Evidence Spec

## Verification Checklist

### Implementation

- [ ] Real command
  - Command: \`exit 0\`
  - Expected: \`exit 0\`
- [ ] Placeholder command
  - Command: \`echo manual: confirm the report lands in Slack\`
  - Expected: \`exit 0\`
- [ ] No command at all
`;

describe("mark --evidence", () => {
  let tmpDir: string;
  let trackerRoot: string;
  let specPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-mark-evidence-test-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    addMilestone({
      trackerRoot,
      name: "Test Milestone",
      slug: "test-milestone",
      owner: "dev@example.com",
    });
    specPath = join(trackerRoot, "M1-test-milestone", "01-evidence.md");
    writeFileSync(specPath, SPEC, "utf-8");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function runTracker(args: string[]): { stdout: string; stderr: string; exitCode: number } {
    const result = spawnSync(
      "node",
      ["--experimental-strip-types", "--no-warnings", join(process.cwd(), "bin/tracker.mts"), ...args],
      { encoding: "utf-8", cwd: tmpDir, timeout: 30_000 },
    );
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.status ?? -1,
    };
  }

  function ledger(): Array<Record<string, unknown>> {
    const path = join(trackerRoot, ".verification-log.jsonl");
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf-8")
      .trim()
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  }

  it("refuses --verified on a trivial-command item when no evidence is given", () => {
    const { exitCode, stderr } = runTracker(["mark", specPath, "1", "--verified"]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("shell no-op");
    expect(stderr).toContain("--evidence");

    // The refusal is a refusal: the file is untouched and nothing is ledgered.
    expect(readFileSync(specPath, "utf-8")).toContain("- [ ] Placeholder command");
    expect(ledger()).toHaveLength(0);
  });

  it("accepts --verified with evidence and records it in the ledger", () => {
    const evidence =
      "Ran the 06:00 Berlin report by hand against staging, watched it arrive in room 10; agent: opus tier";
    const { exitCode } = runTracker([
      "mark",
      specPath,
      "1",
      "--verified",
      "--evidence",
      evidence,
    ]);

    expect(exitCode).toBe(0);
    expect(readFileSync(specPath, "utf-8")).toContain("- [x] Placeholder command");

    const entries = ledger();
    expect(entries).toHaveLength(1);
    expect(entries[0]!["outcome"]).toBe("manual");
    expect(entries[0]!["evidence"]).toBe(evidence);
    expect(entries[0]!["exitCode"]).toBeNull();
    expect(entries[0]!["index"]).toBe(1);
    expect(entries[0]!["spec"]).toBe(".tracker/M1-test-milestone/01-evidence.md");
  });

  it("stamps verification_method: manual on the spec so a plain Read shows it", () => {
    runTracker(["mark", specPath, "1", "--verified", "--evidence", "checked by hand"]);
    const content = readFileSync(specPath, "utf-8");
    expect(content).toContain("verification_method: manual");
    expect(content).toContain("verification_passed:");
  });

  it("does not require evidence for an item with a real command", () => {
    const { exitCode } = runTracker(["mark", specPath, "0", "--verified"]);
    expect(exitCode).toBe(0);
    expect(readFileSync(specPath, "utf-8")).toContain("- [x] Real command");
    // Still ledgered — a hand-mark is a claim, evidenced or not.
    expect(ledger()[0]!["outcome"]).toBe("manual");
  });

  it("does not require evidence for an item with no Command at all (legacy estates)", () => {
    const { exitCode } = runTracker(["mark", specPath, "2", "--verified"]);
    expect(exitCode).toBe(0);
    expect(readFileSync(specPath, "utf-8")).toContain("- [x] No command at all");
  });

  it("rejects --evidence on a non-verified state", () => {
    const { exitCode, stderr } = runTracker([
      "mark",
      specPath,
      "0",
      "--blocked",
      "--evidence",
      "nope",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--evidence only applies to --verified");
  });

  it("non-verified marks write no ledger line", () => {
    runTracker(["mark", specPath, "0", "--in-progress"]);
    expect(ledger()).toHaveLength(0);
  });

  it("an empty --evidence string does not satisfy the requirement", () => {
    const { exitCode, stderr } = runTracker([
      "mark",
      specPath,
      "1",
      "--verified",
      "--evidence",
      "   ",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("shell no-op");
  });
});
