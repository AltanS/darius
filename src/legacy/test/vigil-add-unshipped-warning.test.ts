/**
 * `tracker vigil add --from <spec>` warns on an unshipped premise (M315/07, patch 5).
 *
 * A soak observes shipped code. Four vigils on this estate guarded specs at 0
 * verified items and stayed armed for 26 days; no evidence could ever have
 * closed them. But arming a vigil the same hour a deploy lands — before
 * `verify` has caught up with the checklist — is normal, so this WARNS and
 * still creates the vigil. It never refuses.
 *
 * pnpm exec vitest run test/vigil-add-unshipped-warning.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { initTracker, addMilestone } from "../lib/tracker-writer.ts";

const UNSHIPPED = `---
updated: 2026-01-01
agent: test
depends_on: []
---

# Unshipped

## Verification Checklist

- [ ] not done
  - Command: \`test -f package.json\`
  - Expected: \`exit 0\`
`;

const SHIPPED = `---
updated: 2026-01-01
agent: test
depends_on: []
---

# Shipped

## Verification Checklist

- [x] done
  - Command: \`test -f package.json\`
  - Expected: \`exit 0\`
`;

describe("vigil add — unshipped-premise warning", () => {
  let tmpDir: string;
  let trackerRoot: string;
  let milestoneDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-vigil-warn-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    addMilestone({ trackerRoot, name: "Probe", slug: "probe", owner: "dev@example.com" });
    milestoneDir = join(trackerRoot, "M1-probe");
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

  it("warns, names the spec, and still creates the vigil", () => {
    writeFileSync(join(milestoneDir, "01-unshipped.md"), UNSHIPPED, "utf-8");
    const result = run([
      "vigil",
      "add",
      "premature",
      "--until",
      "first real batch",
      "--from",
      "M1/01",
    ]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("WARNING");
    expect(result.stderr).toContain("0 verified items");
    expect(result.stderr).toContain("01-unshipped.md");
    expect(existsSync(join(trackerRoot, "vigils", "premature.md"))).toBe(true);
  });

  it("stays quiet when the guarded spec has a verified item", () => {
    writeFileSync(join(milestoneDir, "01-shipped.md"), SHIPPED, "utf-8");
    const result = run([
      "vigil",
      "add",
      "proper",
      "--until",
      "first real batch",
      "--from",
      "M1/01",
    ]);
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("WARNING");
  });

  it("stays quiet when --from names no spec on disk", () => {
    for (const from of ["M1", "docs/architecture/plan.md", "M99/07"]) {
      const slug = `v-${from.replace(/[^a-z0-9]/gi, "").toLowerCase()}`;
      const result = run(["vigil", "add", slug, "--until", "later", "--from", from]);
      expect(result.status, from).toBe(0);
      expect(result.stderr, from).not.toContain("WARNING");
    }
  });

  it("stays quiet when there is no --from at all", () => {
    const result = run(["vigil", "add", "unanchored", "--until", "later"]);
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("WARNING");
  });

  it("resolves a full spec filename in --from", () => {
    writeFileSync(join(milestoneDir, "01-unshipped.md"), UNSHIPPED, "utf-8");
    const result = run([
      "vigil",
      "add",
      "byfilename",
      "--until",
      "later",
      "--from",
      "M1-probe/01-unshipped.md",
    ]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("WARNING");
  });
});
