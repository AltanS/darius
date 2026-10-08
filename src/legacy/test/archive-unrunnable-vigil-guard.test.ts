/**
 * `tracker archive-check <milestone>` (M315/07, patch 4).
 *
 * Archiving is where a milestone stops being watched. A vigil it armed that
 * nobody can run outlives the folder explaining it — permanently due, never
 * answerable. The check refuses while any such vigil is armed, names it, and
 * offers no `--force`: the two ways past are a real Command or a verdict.
 *
 * `/tracker:archive` calls this in its validate step, before anything is
 * written or deleted.
 *
 * pnpm exec vitest run test/archive-unrunnable-vigil-guard.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { initTracker, addMilestone } from "../lib/tracker-writer.ts";

function vigil(opts: {
  slug: string;
  from: string;
  commands: string[];
  verdict?: string;
}): string {
  const steps =
    opts.commands.length === 0
      ? "- [ ] nothing to run\n"
      : opts.commands
          .map((c, i) => `- [ ] step ${i + 1}\n  - Command: \`${c}\`\n  - Expected: \`exit 0\`\n`)
          .join("");
  return `---
type: vigil
name: ${opts.slug}
slug: ${opts.slug}
due:
until: some future event
from: ${opts.from}
agent:
opened: 2026-09-02
resolved:
verdict: ${opts.verdict ?? ""}
---

# ${opts.slug}

## Verification Checklist

${steps}`;
}

describe("archive-check", () => {
  let tmpDir: string;
  let trackerRoot: string;
  let vigilsDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-archive-check-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    addMilestone({ trackerRoot, name: "Shipping", slug: "shipping", owner: "dev@example.com" });
    addMilestone({ trackerRoot, name: "Other", slug: "other", owner: "dev@example.com" });
    vigilsDir = join(trackerRoot, "vigils");
    mkdirSync(vigilsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function write(slug: string, content: string): void {
    writeFileSync(join(vigilsDir, `${slug}.md`), content, "utf-8");
  }

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

  it("clears a milestone whose armed vigils all have real Commands", () => {
    write("ok", vigil({ slug: "ok", from: "M1/01", commands: ["test -f package.json"] }));
    const result = run(["archive-check", "M1-shipping"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("clear");
  });

  it("REFUSES while an armed vigil of that milestone has only no-op Commands", () => {
    write("stale-soak", vigil({ slug: "stale-soak", from: "M1/01", commands: ["echo todo"] }));
    const result = run(["archive-check", "M1-shipping"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("REFUSED");
    expect(result.stderr).toContain("stale-soak");
    expect(result.stderr).toContain("darius vigil close");
  });

  it("REFUSES on a vigil with no Command at all", () => {
    write("empty-soak", vigil({ slug: "empty-soak", from: "M1/01", commands: [] }));
    const result = run(["archive-check", "M1-shipping"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no Command: line at all");
  });

  it("resolves the milestone by slug as well as by folder name", () => {
    write("stale-soak", vigil({ slug: "stale-soak", from: "M1/01", commands: ["echo todo"] }));
    expect(run(["archive-check", "shipping"]).status).toBe(1);
  });

  it("matches a `from:` that names only the milestone number", () => {
    write("numbered", vigil({ slug: "numbered", from: "M1", commands: ["echo todo"] }));
    const result = run(["archive-check", "M1-shipping"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("numbered");
  });

  it("ignores an unrunnable vigil belonging to a DIFFERENT milestone", () => {
    write("elsewhere", vigil({ slug: "elsewhere", from: "M2/01", commands: ["echo todo"] }));
    const result = run(["archive-check", "M1-shipping"]);
    expect(result.status).toBe(0);
  });

  it("ignores a CLOSED vigil, however unrunnable", () => {
    write(
      "closed",
      vigil({ slug: "closed", from: "M1/01", commands: ["echo todo"], verdict: "held" }),
    );
    expect(run(["archive-check", "M1-shipping"]).status).toBe(0);
  });

  it("offers no --force", () => {
    write("stale-soak", vigil({ slug: "stale-soak", from: "M1/01", commands: ["echo todo"] }));
    const result = run(["archive-check", "M1-shipping", "--force"]);
    expect(result.status).not.toBe(0);
  });

  it("reports machine-readably with --json", () => {
    write("stale-soak", vigil({ slug: "stale-soak", from: "M1/01", commands: ["echo todo"] }));
    const result = run(["archive-check", "M1-shipping", "--json"]);
    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout) as {
      clear: boolean;
      blocking: Array<{ slug: string }>;
    };
    expect(parsed.clear).toBe(false);
    expect(parsed.blocking.map((b) => b.slug)).toEqual(["stale-soak"]);
  });

  it("errors on a milestone that does not exist", () => {
    const result = run(["archive-check", "M99-nope"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Milestone not found");
  });

  it("requires a milestone argument", () => {
    const result = run(["archive-check"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Usage:");
  });
});
