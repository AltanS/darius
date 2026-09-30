/**
 * Tests for doctor's `verified-not-executed` check (M247/0a).
 *
 * A `[x]` whose Command is a shell no-op and which has no ledger entry is a
 * claim nobody stood behind. Doctor reports it — warn-only, capped at 10.
 *
 * pnpm vitest run doctor-claimed-not-executed
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTracker, addMilestone } from "../lib/tracker-writer.ts";
import { runDoctor, formatDoctorReport } from "../lib/doctor.ts";
import { appendLedgerEntry } from "../lib/verification/ledger.ts";

function spec(body: string): string {
  return `---
updated: 2026-01-01
agent: unassigned
---

# Doctor Spec

## Verification Checklist

### Implementation

${body}
`;
}

describe("doctor — claimed, not executed", () => {
  let tmpDir: string;
  let trackerRoot: string;
  let milestonePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-doctor-claimed-test-"));
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

  function writeSpec(name: string, body: string): string {
    const p = join(milestonePath, name);
    writeFileSync(p, spec(body), "utf-8");
    return p;
  }

  function warningsOf(kind: string) {
    return runDoctor({ trackerRoot }).warnings.filter((w) => w.kind === kind);
  }

  it("flags a verified item with a trivial command and no ledger entry", () => {
    writeSpec(
      "01-claimed.md",
      `- [x] Checked the dashboard
  - Command: \`echo manual: I looked at it\`
  - Expected: \`exit 0\``,
    );

    const warns = warningsOf("verified-not-executed");
    expect(warns).toHaveLength(1);
    expect(warns[0]!.detail).toContain("1 checklist item(s)");
    expect(warns[0]!.detail).toContain("claimed, not executed");
    expect(warns[0]!.detail).toContain(".tracker/M1-test-milestone/01-claimed.md#0");
  });

  it("is warn-only — doctor still reports healthy", () => {
    writeSpec(
      "01-claimed.md",
      `- [x] Checked the dashboard
  - Command: \`echo manual: I looked at it\`
  - Expected: \`exit 0\``,
    );

    const report = runDoctor({ trackerRoot });
    expect(report.healthy).toBe(true);
    expect(report.findings).toHaveLength(0);
    // …and it is actually printed, not silently collected.
    expect(formatDoctorReport(report)).toContain("claimed, not executed");
  });

  it("goes quiet once the item has a ledger entry", () => {
    const specPath = writeSpec(
      "01-claimed.md",
      `- [x] Checked the dashboard
  - Command: \`echo manual: I looked at it\`
  - Expected: \`exit 0\``,
    );

    appendLedgerEntry({
      trackerRoot,
      specPath,
      index: 0,
      label: "Checked the dashboard",
      command: "echo manual: I looked at it",
      expected: "exit 0",
      exitCode: null,
      outcome: "manual",
      evidence: "opened the Grafana board at 09:00, screenshotted; agent: sonnet tier",
    });

    expect(warningsOf("verified-not-executed")).toHaveLength(0);
  });

  it("ignores verified items with real commands, unverified items, and items with no command", () => {
    writeSpec(
      "01-mixed.md",
      `- [x] Real command, no ledger
  - Command: \`pnpm test\`
  - Expected: \`exit 0\`
- [ ] Trivial but not claimed
  - Command: \`echo manual: pending\`
  - Expected: \`exit 0\`
- [x] Verified with no command at all`,
    );

    expect(warningsOf("verified-not-executed")).toHaveLength(0);
  });

  it("caps the list at 10 and still reports the true count", () => {
    const items = Array.from(
      { length: 14 },
      (_, i) => `- [x] Claim ${i}
  - Command: \`echo manual: claim ${i}\`
  - Expected: \`exit 0\``,
    ).join("\n");
    writeSpec("01-many.md", items);

    const warns = warningsOf("verified-not-executed");
    expect(warns).toHaveLength(1);
    const detail = warns[0]!.detail;
    expect(detail).toContain("14 checklist item(s)");
    expect(detail).toContain("… and 4 more");
    // 10 listed lines, not 14.
    expect(detail.split("\n").filter((l) => l.includes("01-many.md#"))).toHaveLength(10);
  });

  it("says nothing on a clean tracker", () => {
    writeSpec(
      "01-clean.md",
      `- [x] Real check
  - Command: \`exit 0\`
  - Expected: \`exit 0\``,
    );
    expect(warningsOf("verified-not-executed")).toHaveLength(0);
  });
});
