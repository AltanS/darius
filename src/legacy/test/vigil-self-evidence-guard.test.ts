/**
 * `vigil add --stdin` / `vigil set-body --stdin` reject a Command that writes
 * its own evidence (v10.9.4).
 *
 * Two shapes, both measured on a live estate on 2026-09-05:
 *
 * 1. **State-mutating Command.** Nine armed vigils carried a Command that
 *    closed the vigil, stamped a ritual, or ticked a spec item. `fc
 *    vigil-sweep` runs every open vigil's Commands unattended, once a day, so
 *    such a Command makes the machine record a verdict nobody judged. All nine
 *    happened to fail only because the pinned CLI path had moved and `tracker`
 *    is not on PATH. That is luck, not a design.
 *
 * 2. **Self-referential verdict read.** Fifteen armed vigils carried a Command
 *    that greps their OWN `verdict:` frontmatter — circular, because an armed
 *    vigil has no verdict and cannot close while a check fails. Reading ANOTHER
 *    vigil's verdict is legitimate and stays allowed.
 *
 * pnpm exec vitest run test/vigil-self-evidence-guard.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTracker } from "../lib/tracker-writer.ts";

const NORMAL_BODY = [
  "## Verification Checklist",
  "",
  "- [ ] the guard marker appears in prod logs",
  "  - Command: `test -f /etc/os-release`",
  "  - Expected: `exit 0`",
  "",
].join("\n");

function bodyWith(command: string): string {
  return [
    "## Verification Checklist",
    "",
    "- [ ] a check",
    `  - Command: \`${command}\``,
    "  - Expected: `exit 0`",
    "",
  ].join("\n");
}

describe("vigil add/set-body — a vigil may not write its own evidence", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-vigil-self-evidence-"));
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
  // 1. state-mutating Commands
  // -------------------------------------------------------------------------

  const MUTATING: Array<[string, string]> = [
    ["bare close", "tracker vigil close soak --verdict held"],
    [
      "close via an absolute CLI path",
      "node --experimental-strip-types /home/x/.claude/plugins/cache/m/tracker/10.5.0/cli/bin/tracker.mts vigil close soak --verdict held",
    ],
    ["close with an alternation verdict", "tracker vigil close soak --verdict held|failed"],
    ["ritual complete", "tracker ritual complete prediction-integrity-cycle"],
    ["spec mark", "tracker mark M320/04 3 --verified --evidence 'read it'"],
  ];

  for (const [label, command] of MUTATING) {
    it(`refuses a Command that writes tracker state (${label}), and writes nothing`, () => {
      const { exitCode, stderr } = runTracker(
        ["vigil", "add", "soak", "--until", "batch", "--stdin"],
        bodyWith(command),
      );
      expect(exitCode).toBe(1);
      expect(stderr).toContain("a Command that writes tracker state");
      expect(stderr).toContain("Recording a verdict is a close action");
      expect(existsSync(vigilPath("soak"))).toBe(false);
    });
  }

  it("set-body refuses a state-mutating Command, leaving the existing file byte-identical", () => {
    runTracker(["vigil", "add", "soak", "--until", "batch", "--stdin"], NORMAL_BODY);
    const before = readFileSync(vigilPath("soak"), "utf-8");

    const { exitCode, stderr } = runTracker(
      ["vigil", "set-body", "soak", "--stdin"],
      bodyWith("tracker vigil close soak --verdict held"),
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("a Command that writes tracker state");
    expect(readFileSync(vigilPath("soak"), "utf-8")).toBe(before);
  });

  // -------------------------------------------------------------------------
  // 2. self-referential verdict reads
  // -------------------------------------------------------------------------

  it("refuses a Command that greps this vigil's own verdict: frontmatter", () => {
    const command =
      "python3 -c \"import re,sys; s=open('.tracker/vigils/soak.md').read(); m=re.search(r'^verdict:\\\\s*(\\\\S+)', s, re.M); sys.exit(0 if m else 1)\"";
    const { exitCode, stderr } = runTracker(
      ["vigil", "add", "soak", "--until", "batch", "--stdin"],
      bodyWith(command),
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("reads this vigil's own");
    expect(stderr).toContain("That is circular");
    expect(existsSync(vigilPath("soak"))).toBe(false);
  });

  it("refuses a grep-shaped self read of resolved: too", () => {
    const { exitCode, stderr } = runTracker(
      ["vigil", "add", "soak", "--until", "batch", "--stdin"],
      bodyWith("grep -cE '^(verdict|resolved): .+' .tracker/vigils/soak.md"),
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("reads this vigil's own");
  });

  it("ALLOWS reading another vigil's verdict — one vigil may wait on another", () => {
    const { exitCode } = runTracker(
      ["vigil", "add", "soak", "--until", "batch", "--stdin"],
      bodyWith('grep -q "verdict: held" .tracker/vigils/other-vigil.md'),
    );
    expect(exitCode).toBe(0);
    expect(existsSync(vigilPath("soak"))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 3. no collateral damage
  // -------------------------------------------------------------------------

  it("still accepts a normal body", () => {
    const { exitCode } = runTracker(
      ["vigil", "add", "soak", "--until", "batch", "--stdin"],
      NORMAL_BODY,
    );
    expect(exitCode).toBe(0);
    expect(existsSync(vigilPath("soak"))).toBe(true);
  });

  it("does not mistake prose about a verdict for a mutating Command", () => {
    const { exitCode } = runTracker(
      ["vigil", "add", "soak", "--until", "batch", "--stdin"],
      bodyWith("grep -c 'PASS' /etc/os-release"),
    );
    expect(exitCode).toBe(0);
  });
});
