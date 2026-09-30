/**
 * `tracker add` refuses a no-op `Command:` at scaffold time (M315/07, patch 3).
 *
 * The scaffold used to write `Command: echo todo` three times per spec and
 * three more per vigil. That exits 0, so the item read like a check; 460 of
 * 1,575 `Command:` lines fleet-wide were shell no-ops when this was measured.
 * Two changes close it:
 *
 *   1. the placeholder is now a REAL assertion that FAILS, so an unscoped spec
 *      is honestly red instead of quietly green;
 *   2. writing a no-op Command is refused outright, unless the item is an
 *      operator decision flagged `--manual --owner <who> --expires <date>`.
 *
 * pnpm exec vitest run test/add-spec-no-op-guard.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  initTracker,
  addMilestone,
  addSpec,
  addVigil,
  assertScaffoldCommandsRunnable,
  SCAFFOLD_PLACEHOLDER_COMMAND,
} from "../lib/tracker-writer.ts";
import { parseChecklist } from "../lib/markdown/checklist.ts";
import { parseFrontmatter } from "../lib/markdown/frontmatter.ts";
import { isTrivialCommand } from "../lib/verification/runner.ts";

function checklistOf(path: string) {
  const { content } = parseFrontmatter(readFileSync(path, "utf-8"));
  return parseChecklist(content);
}

describe("add spec — scaffolded Commands are real, failing assertions", () => {
  let tmpDir: string;
  let trackerRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-add-noop-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    addMilestone({ trackerRoot, name: "Probe", slug: "probe", owner: "dev@example.com" });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes no shell no-op Command in any template", () => {
    for (const template of ["generic", "api-endpoint", "ui-component", "library"] as const) {
      const result = addSpec({
        trackerRoot,
        milestoneArg: "probe",
        name: `Spec ${template}`,
        template,
      });
      expect(result.kind).toBe("created");
      const items = checklistOf((result as { filePath: string }).filePath);
      const commands = items.map((i) => i.command).filter((c): c is string => c !== null);
      expect(commands.length).toBeGreaterThan(0);
      for (const command of commands) {
        expect(isTrivialCommand(command), `${template}: ${command}`).toBe(false);
      }
    }
  });

  it("the placeholder actually fails when run — it is not a green stub", () => {
    const result = addSpec({
      trackerRoot,
      milestoneArg: "probe",
      name: "Placeholder Spec",
      template: "generic",
    });
    const items = checklistOf((result as { filePath: string }).filePath);
    expect(items[0]?.command).toBe(SCAFFOLD_PLACEHOLDER_COMMAND);
    const run = spawnSync("sh", ["-c", SCAFFOLD_PLACEHOLDER_COMMAND], { encoding: "utf-8" });
    expect(run.status).not.toBe(0);
  });

  it("vigil scaffolds are runnable too", () => {
    const result = addVigil({
      trackerRoot,
      slug: "some-soak",
      name: "Some soak",
      until: "first real batch",
    });
    const items = checklistOf((result as { vigilPath: string }).vigilPath);
    const commands = items.map((i) => i.command).filter((c): c is string => c !== null);
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      expect(isTrivialCommand(command), command).toBe(false);
    }
  });
});

describe("add spec --manual — the one sanctioned no-op", () => {
  let tmpDir: string;
  let trackerRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-add-manual-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    addMilestone({ trackerRoot, name: "Probe", slug: "probe", owner: "dev@example.com" });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes `Expected: manual (owner: …, expires: …)` and names the owner in the Command", () => {
    const result = addSpec({
      trackerRoot,
      milestoneArg: "probe",
      name: "Cost Cap Decision",
      template: "generic",
      manual: { owner: "owner@example.com", expires: "2026-10-01" },
    });
    const raw = readFileSync((result as { filePath: string }).filePath, "utf-8");
    expect(raw).toContain("Expected: `manual (owner: owner@example.com, expires: 2026-10-01)`");
    expect(raw).toContain("operator decision (whose: owner@example.com)");
    expect(raw).not.toContain("Expected: `exit 0`");
  });

  it("refuses --manual without an owner or with a non-ISO expiry", () => {
    expect(() =>
      addSpec({
        trackerRoot,
        milestoneArg: "probe",
        name: "No Owner",
        template: "generic",
        manual: { owner: "  ", expires: "2026-10-01" },
      }),
    ).toThrow(/--owner/);

    expect(() =>
      addSpec({
        trackerRoot,
        milestoneArg: "probe",
        name: "Bad Expiry",
        template: "generic",
        manual: { owner: "someone", expires: "soon" },
      }),
    ).toThrow(/--expires/);
  });
});

describe("assertScaffoldCommandsRunnable — the write-time refusal", () => {
  it("refuses a no-op Command and names the item", () => {
    const body = `# X

## Verification Checklist

- [ ] confirm it by hand
  - Command: \`echo todo\`
  - Expected: \`exit 0\`
`;
    expect(() => assertScaffoldCommandsRunnable(body, "ctx")).toThrow(
      /confirm it by hand/,
    );
    expect(() => assertScaffoldCommandsRunnable(body, "ctx")).toThrow(
      /--manual --owner <who> --expires <YYYY-MM-DD>/,
    );
  });

  it("permits a no-op whose Expected is the manual form", () => {
    const body = `# X

## Verification Checklist

- [ ] Operator decision
  - Command: \`echo "operator decision (whose: someone)"\`
  - Expected: \`manual (owner: someone, expires: 2026-10-01)\`
`;
    expect(() => assertScaffoldCommandsRunnable(body, "ctx")).not.toThrow();
  });

  it("permits real Commands, including a no-op piped into one", () => {
    const body = `# X

## Verification Checklist

- [ ] real
  - Command: \`cd acme-web && echo "select 1;" | ./scripts/prod-psql.sh\`
  - Expected: \`exit 0\`
`;
    expect(() => assertScaffoldCommandsRunnable(body, "ctx")).not.toThrow();
  });

  it("catches a template regression: put `echo todo` back and add spec stops working", () => {
    const tmp = mkdtempSync(join(tmpdir(), "tracker-tmpl-regress-"));
    try {
      initTracker({ projectRoot: tmp });
      const root = join(tmp, ".tracker");
      addMilestone({ trackerRoot: root, name: "Probe", slug: "probe", owner: "d@e.com" });

      // Point the writer at a poisoned copy of the template tree.
      const templates = join(new URL(".", import.meta.url).pathname, "..", "templates");
      const poisoned = readFileSync(join(templates, "spec-generic.md"), "utf-8").replace(
        /\{\{CMD_1\}\}/,
        "echo todo",
      );
      // The placeholder is substituted, so poisoning it directly is the only
      // way to simulate a template that hardcodes a no-op.
      const body = poisoned.replace(/\{\{[A-Z0-9_]+\}\}/g, "x");
      expect(() => assertScaffoldCommandsRunnable(body, "tracker add spec")).toThrow(
        /shell no-op Command/,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("add spec CLI — flag validation and the loud placeholder notice", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-add-cli-"));
    initTracker({ projectRoot: tmpDir });
    addMilestone({
      trackerRoot: join(tmpDir, ".tracker"),
      name: "Probe",
      slug: "probe",
      owner: "dev@example.com",
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function run(args: string[]) {
    return spawnSync(
      "node",
      [
        "--experimental-strip-types",
        "--no-warnings",
        join(process.cwd(), "bin/tracker.mts"),
        ...args,
      ],
      { encoding: "utf-8", cwd: tmpDir, timeout: 30_000 },
    );
  }

  it("refuses --manual without --owner and --expires", () => {
    const result = run([
      "add",
      "spec",
      "--milestone",
      "probe",
      "--name",
      "Decision",
      "--template",
      "generic",
      "--manual",
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--manual requires --owner");
  });

  it("refuses --owner/--expires without --manual", () => {
    const result = run([
      "add",
      "spec",
      "--milestone",
      "probe",
      "--name",
      "Decision",
      "--template",
      "generic",
      "--owner",
      "someone",
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("only apply with --manual");
  });

  it("tells the author the scaffolded checks fail on purpose", () => {
    const result = run([
      "add",
      "spec",
      "--milestone",
      "probe",
      "--name",
      "Fresh Spec",
      "--template",
      "generic",
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("fail on purpose");
    expect(result.stdout).toContain(SCAFFOLD_PLACEHOLDER_COMMAND);
  });

  it("documents --manual in the top-level usage", () => {
    const result = run([]);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "--manual --owner <who> --expires <YYYY-MM-DD>",
    );
  });

  it("writes the manual form end to end", () => {
    const result = run([
      "add",
      "spec",
      "--milestone",
      "probe",
      "--name",
      "Spend Decision",
      "--template",
      "generic",
      "--manual",
      "--owner",
      "owner@example.com",
      "--expires",
      "2026-10-01",
    ]);
    expect(result.status).toBe(0);
    const path = join(tmpDir, ".tracker", "M1-probe", "01-spend-decision.md");
    expect(readFileSync(path, "utf-8")).toContain(
      "manual (owner: owner@example.com, expires: 2026-10-01)",
    );
  });

});
