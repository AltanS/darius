/**
 * `tracker doctor` on armed vigils (M315/07, patch 2).
 *
 * FAIL: an armed vigil with no executable `Command:` — nothing can ever close
 * it, so it is a permanent due item, not a soak.
 * WARN: an armed vigil guarding a spec at 0 verified items whose milestone
 * README records no deploy — a soak over work that never shipped.
 *
 * pnpm exec vitest run test/doctor-unrunnable-vigil.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { initTracker, addMilestone } from "../lib/tracker-writer.ts";
import { runDoctor, formatDoctorReport } from "../lib/doctor.ts";
import { isDeployLine } from "../lib/vigil-health.ts";

function vigil(opts: {
  slug: string;
  verdict?: string;
  from?: string;
  commands: string[];
}): string {
  const steps =
    opts.commands.length === 0
      ? "- [ ] nothing to run here\n"
      : opts.commands
          .map((c, i) => `- [ ] step ${i + 1}\n  - Command: \`${c}\`\n  - Expected: \`exit 0\`\n`)
          .join("");
  return `---
type: vigil
name: ${opts.slug}
slug: ${opts.slug}
due:
until: some future event
from: ${opts.from ?? ""}
agent:
opened: 2026-09-02
resolved:
verdict: ${opts.verdict ?? ""}
---

# ${opts.slug}

## Verification Checklist

${steps}`;
}

const SHIPPED_SPEC = `---
updated: 2026-01-01
agent: test
depends_on: []
---

# Shipped Spec

## Verification Checklist

### Implementation

- [x] it shipped
  - Command: \`test -f package.json\`
  - Expected: \`exit 0\`
`;

const UNSHIPPED_SPEC = `---
updated: 2026-01-01
agent: test
depends_on: []
---

# Unshipped Spec

## Verification Checklist

### Implementation

- [ ] not started
  - Command: \`test -f package.json\`
  - Expected: \`exit 0\`
`;

describe("doctor — unrunnable armed vigils", () => {
  let tmpDir: string;
  let trackerRoot: string;
  let vigilsDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-doctor-vigil-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    addMilestone({ trackerRoot, name: "Probe", slug: "probe", owner: "dev@example.com" });
    vigilsDir = join(trackerRoot, "vigils");
    mkdirSync(vigilsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function write(slug: string, content: string): void {
    writeFileSync(join(vigilsDir, `${slug}.md`), content, "utf-8");
  }

  it("is healthy when the armed vigil has a real Command", () => {
    write("good", vigil({ slug: "good", commands: ["test -f package.json"] }));
    const report = runDoctor({ trackerRoot });
    expect(report.findings.filter((f) => f.kind === "vigil-unrunnable")).toHaveLength(0);
    expect(report.healthy).toBe(true);
  });

  it("FAILS on an armed vigil whose only Commands are shell no-ops, naming it", () => {
    write("noop-only", vigil({ slug: "noop-only", commands: ["echo todo", "echo todo"] }));
    const report = runDoctor({ trackerRoot });
    const finding = report.findings.find((f) => f.kind === "vigil-unrunnable");
    expect(finding).toBeDefined();
    expect(finding?.detail).toContain("noop-only");
    expect(finding?.detail).toContain("shell no-ops");
    expect(report.healthy).toBe(false);
    // warnOnly must NOT be set — this has to change the exit code.
    expect(finding?.warnOnly).toBeUndefined();
    expect(formatDoctorReport(report)).toContain("noop-only");
  });

  it("FAILS on an armed vigil with no Command: line at all", () => {
    write("no-commands", vigil({ slug: "no-commands", commands: [] }));
    const report = runDoctor({ trackerRoot });
    const finding = report.findings.find((f) => f.kind === "vigil-unrunnable");
    expect(finding?.detail).toContain("no `Command:` line at all");
    expect(report.healthy).toBe(false);
  });

  it("ignores a CLOSED vigil, however unrunnable", () => {
    write(
      "closed",
      vigil({ slug: "closed", verdict: "held", commands: ["echo todo"] }),
    );
    const report = runDoctor({ trackerRoot });
    expect(report.findings.filter((f) => f.kind === "vigil-unrunnable")).toHaveLength(0);
    expect(report.healthy).toBe(true);
  });

  it("accepts the pipeline form the old classifier rejected", () => {
    write(
      "piped",
      vigil({ slug: "piped", commands: [`echo "select 1;" | ./scripts/prod-psql.sh`] }),
    );
    const report = runDoctor({ trackerRoot });
    expect(report.findings.filter((f) => f.kind === "vigil-unrunnable")).toHaveLength(0);
  });

  it("does not read archived vigils", () => {
    const archived = join(trackerRoot, "archive", "vigils");
    mkdirSync(archived, { recursive: true });
    writeFileSync(
      join(archived, "old.md"),
      vigil({ slug: "old", commands: ["echo todo"] }),
      "utf-8",
    );
    const report = runDoctor({ trackerRoot });
    expect(report.findings.filter((f) => f.kind === "vigil-unrunnable")).toHaveLength(0);
  });

  it("exits non-zero from the real binary and prints the slug", () => {
    write("cli-noop", vigil({ slug: "cli-noop", commands: ["echo todo"] }));
    const result = spawnSync(
      "node",
      [
        "--experimental-strip-types",
        "--no-warnings",
        join(process.cwd(), "bin/tracker.mts"),
        "doctor",
      ],
      { encoding: "utf-8", cwd: tmpDir, timeout: 30_000 },
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("cli-noop");
  });
});

describe("doctor — vigil armed on a spec that never shipped", () => {
  let tmpDir: string;
  let trackerRoot: string;
  let vigilsDir: string;
  let milestoneDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-doctor-premise-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    addMilestone({ trackerRoot, name: "Probe", slug: "probe", owner: "dev@example.com" });
    milestoneDir = join(trackerRoot, "M1-probe");
    vigilsDir = join(trackerRoot, "vigils");
    mkdirSync(vigilsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function armOn(from: string, specName: string, specBody: string): void {
    writeFileSync(join(milestoneDir, specName), specBody, "utf-8");
    writeFileSync(
      join(vigilsDir, "guard.md"),
      vigil({ slug: "guard", from, commands: ["test -f package.json"] }),
      "utf-8",
    );
  }

  function stripDeployLine(): void {
    const readme = join(milestoneDir, "00-README.md");
    const cleaned = readFileSync(readme, "utf-8")
      .split("\n")
      .filter((l) => !/deploy/i.test(l))
      .join("\n");
    writeFileSync(readme, cleaned, "utf-8");
  }

  it("WARNS (never fails) when the guarded spec has 0 verified items", () => {
    armOn("M1/01", "01-unshipped.md", UNSHIPPED_SPEC);
    stripDeployLine();
    const report = runDoctor({ trackerRoot });
    const warn = report.warnings.find((w) => w.kind === "vigil-premise-unshipped");
    expect(warn).toBeDefined();
    expect(warn?.detail).toContain("guard");
    expect(warn?.warnOnly).toBe(true);
    expect(report.healthy).toBe(true);
  });

  it("stays quiet when the guarded spec has a verified item", () => {
    armOn("M1/01", "01-shipped.md", SHIPPED_SPEC);
    stripDeployLine();
    const report = runDoctor({ trackerRoot });
    expect(report.warnings.filter((w) => w.kind === "vigil-premise-unshipped")).toHaveLength(0);
  });

  function appendToReadme(text: string): void {
    const readme = join(milestoneDir, "00-README.md");
    writeFileSync(readme, `${readFileSync(readme, "utf-8")}\n${text}\n`, "utf-8");
  }

  function premiseWarnings() {
    return runDoctor({ trackerRoot }).warnings.filter(
      (w) => w.kind === "vigil-premise-unshipped",
    );
  }

  it("stays quiet when the README records a deploy with a sha and a date", () => {
    armOn("M1/01", "01-unshipped.md", UNSHIPPED_SPEC);
    stripDeployLine();
    appendToReadme("\nDeployed fa4e2e5a on 2026-08-30.");
    expect(premiseWarnings()).toHaveLength(0);
  });

  it("still WARNS when the only `deploy` is Constraints prose", () => {
    // The shared P-series Constraints paragraph. It suppressed the warning on
    // 11 re-pointed vigils under the old substring test.
    armOn("M1/01", "01-unshipped.md", UNSHIPPED_SPEC);
    stripDeployLine();
    appendToReadme(
      "\n## Constraints\n\n" +
        "- A last-before-deploy item: \"AFTER: benchmark diff shows no regression on true\n" +
        "  positives kept, false positives, content destroyed; only then deploy\".\n" +
        "- Prove no regression before it deploys, not after a reader finds the defect.\n",
    );
    expect(premiseWarnings()).toHaveLength(1);
  });

  it("stays quiet on a `## Deploy log` table row carrying a date", () => {
    armOn("M1/01", "01-unshipped.md", UNSHIPPED_SPEC);
    stripDeployLine();
    appendToReadme(
      "\n## Deploy log\n\n" +
        "| What | When | Where |\n" +
        "|---|---|---|\n" +
        "| shipped the guard | 2026-08-30 | acme-web prod |\n",
    );
    expect(premiseWarnings()).toHaveLength(0);
  });

  it("a deploy verb with no sha and no date is not a deploy line", () => {
    armOn("M1/01", "01-unshipped.md", UNSHIPPED_SPEC);
    stripDeployLine();
    appendToReadme("\nWe shipped this at some point, honest.");
    expect(premiseWarnings()).toHaveLength(1);
  });

  it("skips silently when from: does not resolve to a spec", () => {
    stripDeployLine();
    writeFileSync(
      join(vigilsDir, "guard.md"),
      vigil({
        slug: "guard",
        from: "docs/architecture/some-plan.md",
        commands: ["test -f package.json"],
      }),
      "utf-8",
    );
    writeFileSync(
      join(vigilsDir, "bare.md"),
      vigil({ slug: "bare", from: "M1", commands: ["test -f package.json"] }),
      "utf-8",
    );
    const report = runDoctor({ trackerRoot });
    expect(report.warnings.filter((w) => w.kind === "vigil-premise-unshipped")).toHaveLength(0);
    expect(report.healthy).toBe(true);
  });
});

describe("isDeployLine", () => {
  it("accepts a verb plus a sha or a date", () => {
    expect(isDeployLine("Deployed fa4e2e5a on 2026-08-30")).toBe(true);
    expect(isDeployLine("deployed acme-web febbae77")).toBe(true);
    expect(isDeployLine("| shipped the guard | 2026-08-30 | acme-web prod |")).toBe(true);
    expect(isDeployLine("live on 2026-08-30")).toBe(true);
  });

  it("rejects prose about deploying", () => {
    expect(isDeployLine("benchmark BEFORE and AFTER deploy")).toBe(false);
    expect(isDeployLine("prove no regression before it deploys")).toBe(false);
    expect(isDeployLine("a last-before-deploy item; only then deploy")).toBe(false);
    expect(isDeployLine("M307 U12 and U17 to U20 shipped with 0 ticks")).toBe(false);
  });

  it("rejects a sha or a date with no deploy verb", () => {
    expect(isDeployLine("commit fa4e2e5a fixed the parser")).toBe(false);
    expect(isDeployLine("opened 2026-08-30")).toBe(false);
  });
});
