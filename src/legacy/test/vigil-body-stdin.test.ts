/**
 * `tracker vigil add --stdin` and `tracker vigil set-body --stdin` (v10.9.2).
 *
 * v10.9.0 made a real checklist mandatory in practice — `doctor` FAILS on an
 * armed vigil with no executable `Command:` — while `vigil add` had no route to
 * supply one. Bodies were being spliced into the files by hand. These tests pin
 * the two routes that close that gap, and every refusal that guards them.
 *
 * Spawns the real binary (mirrors vigil-cli) because the stdin contract is part
 * of what is under test.
 *
 * pnpm exec vitest run test/vigil-body-stdin.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTracker } from "../lib/tracker-writer.ts";

/** A body that passes every rule: heading, one executable Command. */
const GOOD_BODY = [
  "# Named by the author",
  "",
  "## Goal",
  "",
  "Prove the guard fires on the first real batch.",
  "",
  "## Verification Checklist",
  "",
  "### Steps",
  "",
  "- [ ] the guard marker appears in prod logs",
  "  - Command: `test -f /etc/os-release`",
  "  - Expected: `exit 0`",
  "- [ ] operator confirms the batch ran",
  '  - Command: `echo "operator decision (whose: operator) — record it"`',
  "  - Expected: `manual (owner: operator, expires: 2026-12-31)`",
  "",
].join("\n");

describe("vigil bodies over stdin", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-vigil-body-"));
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

  function vigilFile(slug: string): string {
    return readFileSync(vigilPath(slug), "utf-8");
  }

  function frontmatterOf(raw: string): string {
    const end = raw.indexOf("\n---\n", 3);
    expect(end).toBeGreaterThan(0);
    return raw.slice(0, end + "\n---\n".length);
  }

  // -------------------------------------------------------------------------
  // vigil add --stdin
  // -------------------------------------------------------------------------

  it("add --stdin writes the piped body under the CLI's own frontmatter", () => {
    const { exitCode, stdout } = runTracker(
      ["vigil", "add", "soak", "--name", "Soak", "--until", "first real batch", "--stdin"],
      GOOD_BODY,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("created");
    expect(stdout).toContain("1 executable Command");

    const raw = vigilFile("soak");
    // Frontmatter is exactly what the CLI generates today — same keys, same order.
    expect(frontmatterOf(raw)).toBe(
      [
        "---",
        "type: vigil",
        "name: Soak",
        "slug: soak",
        "due:",
        "until: first real batch",
        "from:",
        "agent:",
        `opened: ${new Date().toISOString().slice(0, 10)}`,
        "resolved:",
        "verdict:",
        "---",
        "",
      ].join("\n"),
    );
    expect(raw).toContain("## Verification Checklist");
    expect(raw).toContain("- Command: `test -f /etc/os-release`");
    // The author's own H1 survives — nothing is rewritten to the vigil name.
    expect(raw).toContain("# Named by the author");
    expect(raw).not.toContain("{{VIGIL_NAME}}");
    expect(raw).not.toContain("replace-me-with-a-real-check");
  });

  it("add --stdin round-trips through the parser `vigil list --json` uses", () => {
    runTracker(
      ["vigil", "add", "soak", "--name", "Soak", "--until", "batch: the first one", "--stdin"],
      GOOD_BODY,
    );
    const { exitCode, stdout } = runTracker(["vigil", "list", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as Array<{ slug: string; until: string | null }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.slug).toBe("soak");
    expect(parsed[0]?.until).toBe("batch: the first one");
  });

  it("add --stdin prepends `# <name>` when the body carries no H1", () => {
    const noH1 = ["## Verification Checklist", "", "- [ ] a real check", "  - Command: `test -f /etc/os-release`", ""].join("\n");
    const { exitCode } = runTracker(
      ["vigil", "add", "soak", "--name", "Headless soak", "--until", "batch", "--stdin"],
      noH1,
    );
    expect(exitCode).toBe(0);
    expect(vigilFile("soak")).toContain("# Headless soak");
  });

  it("add --stdin refuses a body whose only Command is a shell no-op, and writes nothing", () => {
    const body = [
      "## Verification Checklist",
      "",
      "- [ ] check the thing",
      "  - Command: `echo todo`",
      "  - Expected: `exit 0`",
      "",
    ].join("\n");
    const { exitCode, stderr } = runTracker(
      ["vigil", "add", "soak", "--until", "batch", "--stdin"],
      body,
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("shell no-op Command");
    expect(stderr).toContain("A Command that cannot fail is not a check");
    // The refusal names the file it did not write, and the file is not there.
    expect(stderr).toContain(vigilPath("soak"));
    expect(existsSync(vigilPath("soak"))).toBe(false);
  });

  it("add --stdin refuses a body where every Command is a declared operator decision", () => {
    const body = [
      "## Verification Checklist",
      "",
      "- [ ] operator confirms",
      '  - Command: `echo "operator decision"`',
      "  - Expected: `manual (owner: operator, expires: 2026-12-31)`",
      "",
    ].join("\n");
    const { exitCode, stderr } = runTracker(
      ["vigil", "add", "soak", "--until", "batch", "--stdin"],
      body,
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("no checklist item carries an executable `Command:`");
    expect(existsSync(vigilPath("soak"))).toBe(false);
  });

  it("add --stdin refuses an empty body", () => {
    const { exitCode, stderr } = runTracker(
      ["vigil", "add", "soak", "--until", "batch", "--stdin"],
      "   \n\n",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("refusing to write an empty body");
    expect(existsSync(vigilPath("soak"))).toBe(false);
  });

  it("add --stdin refuses a body with no `## Verification Checklist` heading", () => {
    const body = [
      "# A soak",
      "",
      "- [ ] a check with no section",
      "  - Command: `test -f /etc/os-release`",
      "",
    ].join("\n");
    const { exitCode, stderr } = runTracker(
      ["vigil", "add", "soak", "--until", "batch", "--stdin"],
      body,
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("no `## Verification Checklist` heading");
    expect(existsSync(vigilPath("soak"))).toBe(false);
  });

  it("add on an existing slug says the piped body was NOT written", () => {
    runTracker(["vigil", "add", "soak", "--until", "batch", "--stdin"], GOOD_BODY);
    const { exitCode, stdout } = runTracker(
      ["vigil", "add", "soak", "--until", "batch", "--stdin"],
      GOOD_BODY,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("already exists");
    expect(stdout).toContain("body NOT written");
    expect(stdout).toContain("tracker vigil set-body soak --stdin");
  });

  it("add with no --stdin still scaffolds the template body", () => {
    const { exitCode } = runTracker(["vigil", "add", "soak", "--until", "batch"]);
    expect(exitCode).toBe(0);
    expect(vigilFile("soak")).toContain("replace-me-with-a-real-check");
  });

  // -------------------------------------------------------------------------
  // vigil set-body --stdin
  // -------------------------------------------------------------------------

  it("set-body --stdin replaces the body and preserves the frontmatter byte for byte", () => {
    runTracker([
      "vigil", "add", "soak",
      "--name", "Soak",
      "--until", "first real batch",
      "--from", "M77/S02",
    ]);
    const before = frontmatterOf(vigilFile("soak"));

    const { exitCode, stdout } = runTracker(["vigil", "set-body", "soak", "--stdin"], GOOD_BODY);
    expect(exitCode).toBe(0);
    expect(stdout).toContain(vigilPath("soak"));
    expect(stdout).toContain("1 executable Command");

    const raw = vigilFile("soak");
    expect(frontmatterOf(raw)).toBe(before);
    expect(raw).toContain("- Command: `test -f /etc/os-release`");
    expect(raw).not.toContain("replace-me-with-a-real-check");

    // Still readable by the parser every other command depends on.
    const list = runTracker(["vigil", "list", "--json"]);
    expect(list.exitCode).toBe(0);
    expect(JSON.parse(list.stdout)[0].from).toBe("M77/S02");
  });

  it("set-body --stdin refuses a closed vigil", () => {
    runTracker(["vigil", "add", "soak", "--due", "2020-01-01"]);
    runTracker(["vigil", "close", "soak", "--verdict", "held"]);
    const before = vigilFile("soak");

    const { exitCode, stderr } = runTracker(["vigil", "set-body", "soak", "--stdin"], GOOD_BODY);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("is closed (verdict held");
    expect(stderr).toContain("historical");
    expect(vigilFile("soak")).toBe(before);
  });

  it("set-body --stdin refuses an unknown slug", () => {
    const { exitCode, stderr } = runTracker(["vigil", "set-body", "ghost", "--stdin"], GOOD_BODY);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/not found/i);
  });

  it("set-body --stdin refuses an empty body and leaves the file alone", () => {
    runTracker(["vigil", "add", "soak", "--until", "batch"]);
    const before = vigilFile("soak");
    const { exitCode, stderr } = runTracker(["vigil", "set-body", "soak", "--stdin"], "\n \n");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("refusing to write an empty body");
    expect(vigilFile("soak")).toBe(before);
  });

  it("set-body --stdin refuses a no-op-only body and leaves the file alone", () => {
    runTracker(["vigil", "add", "soak", "--until", "batch"]);
    const before = vigilFile("soak");
    const body = [
      "## Verification Checklist",
      "",
      "- [ ] check the thing",
      "  - Command: `echo manual`",
      "",
    ].join("\n");
    const { exitCode, stderr } = runTracker(["vigil", "set-body", "soak", "--stdin"], body);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("shell no-op Command");
    expect(stderr).toContain(vigilPath("soak"));
    expect(vigilFile("soak")).toBe(before);
  });

  it("set-body requires exactly one of --stdin or --content", () => {
    runTracker(["vigil", "add", "soak", "--until", "batch"]);
    const neither = runTracker(["vigil", "set-body", "soak"]);
    expect(neither.exitCode).toBe(1);
    expect(neither.stderr).toContain("exactly one of --content <path> or --stdin");

    const both = runTracker(["vigil", "set-body", "soak", "--stdin", "--content", "/nope"]);
    expect(both.exitCode).toBe(1);
    expect(both.stderr).toContain("exactly one of --content <path> or --stdin");
  });

  it("set-body without a slug prints usage and exits 1", () => {
    const { exitCode, stderr } = runTracker(["vigil", "set-body"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage: tracker vigil set-body <slug>");
  });

  it("a vigil written over stdin passes doctor", () => {
    runTracker(["vigil", "add", "soak", "--until", "batch", "--stdin"], GOOD_BODY);
    const { exitCode, stdout } = runTracker(["doctor"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("OK");
  });
});
