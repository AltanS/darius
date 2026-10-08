/**
 * The CLI contract of 0.77.0 for the vendored verbs: `--help` prints the usage
 * and does nothing, a bad command line is exit 2, progress is an exact percent,
 * `doctor --json` has a shape, and the scaffold's Commands all fail.
 *
 * pnpm exec vitest run test/cli-contract.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTracker, addMilestone, addSpec } from "../lib/tracker-writer.ts";

describe("CLI contract", () => {
  let tmpDir: string;
  let trackerRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-contract-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function run(args: string[], input?: string): { stdout: string; stderr: string; exitCode: number } {
    const result = spawnSync(
      "node",
      ["--experimental-strip-types", "--no-warnings", join(process.cwd(), "bin/tracker.mts"), ...args],
      { encoding: "utf-8", cwd: tmpDir, timeout: 30_000, input: input ?? "" },
    );
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? -1 };
  }

  function snapshot(): string {
    return [...readdirSync(tmpDir, { recursive: true, encoding: "utf8" })]
      .sort()
      .map((path: string) => {
        try {
          return `${path}:${readFileSync(join(tmpDir, path), "utf-8").length}`;
        } catch {
          return path;
        }
      })
      .join("\n");
  }

  it("--help and -h print the usage, exit 0, and write nothing", () => {
    const before = snapshot();
    const verbs: string[][] = [
      ["status"], ["list"], ["show"], ["next"], ["add"], ["add", "milestone"], ["add", "spec"], ["mark"], ["set-status"],
      ["index"], ["verify"], ["verify-item"], ["archive-check"], ["worklog"], ["worklog", "open"], ["worklog", "append"],
      ["worklog", "set-stage"], ["worklog", "close"], ["worklog", "distill"], ["doctor"], ["scan"], ["due"], ["ritual"],
      ["vigil"], ["vigil", "add"], ["vigil", "close"], ["hook-stop"], ["hook-drift"], ["counsel-gate"], ["delegation"],
    ];
    for (const verb of verbs) {
      for (const flag of ["--help", "-h"]) {
        const { stdout, exitCode } = run([...verb, flag]);
        expect(exitCode, `${verb.join(" ")} ${flag}`).toBe(0);
        expect(stdout, `${verb.join(" ")} ${flag}`).toMatch(/Usage: darius /);
      }
    }
    expect(snapshot()).toBe(before);
  });

  it("--help in the middle of the arguments still only prints the usage", () => {
    const { stdout, exitCode } = run(["worklog", "close", "--help", "--status", "done"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage: darius worklog close");
  });

  it("a bad command line is exit 2", () => {
    const cases: string[][] = [
      ["list"],
      ["list", "milestones", "--bogus"],
      ["add", "milestone", "--name", "x"],
      ["set-status", "x", "bogus"],
      ["index"],
      ["verify"],
      ["verify-item", "x", "nope"],
      ["status", "--bogus"],
      ["worklog", "bogus"],
      ["worklog", "close", "id", "--status", "bogus"],
      ["worklog", "park", "id"],
      ["scan", "bogus"],
      ["doctor", "--bogus"],
      ["ritual", "bogus"],
      ["ritual", "run"],
      ["vigil", "close", "x"],
      ["vigil", "add"],
      ["archive-check"],
      ["hook-stop", "--bogus"],
      ["loop-check", "--bogus"],
      ["root", "--bogus"],
      ["nonsense"],
      [],
    ];
    for (const args of cases) {
      const { exitCode, stderr } = run(args);
      expect(exitCode, args.join(" ")).toBe(2);
      expect(stderr, args.join(" ")).not.toMatch(/\btracker\b/);
    }
  });

  it("a missing named item is exit 1", () => {
    expect(run(["show", "nope.md"]).exitCode).toBe(1);
    expect(run(["verify", "nope.md"]).exitCode).toBe(1);
    expect(run(["worklog", "close", "ghost", "--status", "done"]).exitCode).toBe(1);
    expect(run(["vigil", "close", "ghost", "--verdict", "held"]).exitCode).toBe(1);
  });

  it("progress is the exact percent: 3 of 4 is 75, not 80", () => {
    addMilestone({ trackerRoot, name: "Pct", slug: "pct", owner: "dev@example.com" });
    const folder = readdirSync(trackerRoot).find((name) => name.endsWith("-pct")) ?? "";
    writeFileSync(
      join(trackerRoot, folder, "01-four.md"),
      "---\nupdated: 2026-01-01\nagent: test\ndepends_on: []\n---\n\n# Four\n\n## Verification Checklist\n\n- [x] a\n- [x] b\n- [x] c\n- [ ] d\n",
    );
    const status = run(["status"]).stdout;
    expect(status).toContain("75%");
    expect(status).not.toContain("80%");
    run(["index", "--rebuild"]);
    const index = readFileSync(join(trackerRoot, "00-INDEX.md"), "utf-8");
    expect(index).toContain("75%");
    expect(index).not.toContain("80%");
    expect(status).toContain("darius status");
    expect(index).toContain("run `darius index --rebuild`");
  });

  it("doctor --json reports ok, findings and warnings; an unassigned agent is not a warning", () => {
    addMilestone({ trackerRoot, name: "Doc", slug: "doc", owner: "dev@example.com" });
    addSpec({ trackerRoot, milestoneArg: "doc", name: "One", template: "generic" });
    const { stdout, exitCode } = run(["doctor", "--json"]);
    const report = JSON.parse(stdout) as { ok: boolean; healthy: boolean; findings: unknown[]; warnings: { kind: string }[] };
    expect(typeof report.ok).toBe("boolean");
    expect(report.ok).toBe(report.healthy);
    expect(exitCode).toBe(report.healthy ? 0 : 1);
    expect(report.warnings.filter((warning) => warning.kind === "agent-not-in-roster")).toEqual([]);
    expect(run(["doctor", "--quick", "--json"]).exitCode).toBe(2);
  });

  it("agents with an empty roster prints a hint on stdout, and --json stays an array", () => {
    const text = run(["agents"]);
    expect(text.exitCode).toBe(0);
    if (text.stdout.startsWith("No agents found")) {
      expect(text.stdout).toContain("No expert agents found. The main thread can implement, or use a general-purpose agent.");
      expect(JSON.parse(run(["agents", "--json"]).stdout)).toEqual([]);
    }
  });

  it("every scaffold template's Command fails like the generic one", () => {
    addMilestone({ trackerRoot, name: "Tpl", slug: "tpl", owner: "dev@example.com" });
    for (const template of ["generic", "library", "api-endpoint", "ui-component"] as const) {
      const result = addSpec({ trackerRoot, milestoneArg: "tpl", name: `Spec ${template}`, template });
      expect(result.kind).toBe("created");
      const file = result.kind === "created" ? result.filePath : "";
      const text = readFileSync(file, "utf-8");
      const commands = [...text.matchAll(/^\s*- Command: `(.*)`\s*$/gm)].map((match) => match[1]);
      expect(commands.length, template).toBeGreaterThan(0);
      for (const command of commands) expect(command, template).toMatch(/^test -f \/nonexistent\/replace-me-with-a-real-check/);
      expect(text, template).not.toContain(".tracker/ is committed");
      expect(text, template).toContain("tracker files are shared with other hosts and sessions");
    }
  });
});
