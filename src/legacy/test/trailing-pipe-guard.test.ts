/**
 * Trailing-pipe exit-status masking (M316/18).
 *
 * A shell pipeline exits with the status of its LAST stage, so
 * `rg -n "foo" file.ts | head -1` paired with `Expected: exit 0` can never
 * fail — `rg` exits 1 on no match, `head` exits 0 regardless. Found on
 * 2026-09-20 when M347/04 item 3 ticked green while that half of the work had
 * not been started; 30 more such Commands were live in active specs.
 *
 * The guard refuses such an item at CLASSIFICATION time, so `--dry-run` and a
 * real run agree and nothing is spawned.
 *
 * pnpm exec vitest run test/trailing-pipe-guard.test.ts
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import {
  classifyItem,
  pipelineMasksExitStatus,
  runVerification,
  splitShellStagesDetailed,
  trailingPipeFilter,
} from "../lib/verification/runner.ts";

const item = (command: string, expected: string) => ({
  command,
  expected,
  index: 3,
  label: "a check",
});

/** The real Command from M347/04 that ticked green on unstarted work. */
const M347_COMMAND =
  'cd acme-web && rg -n "remedy-insufficient" apps/acme-web/app/jobs/held-creation-disposer.ts | head -1';

describe("splitShellStagesDetailed — separators", () => {
  it("records which operator introduced each stage", () => {
    expect(splitShellStagesDetailed("a | b")).toEqual([
      { text: "a", separator: null },
      { text: "b", separator: "|" },
    ]);
    expect(splitShellStagesDetailed("a && b")).toEqual([
      { text: "a", separator: null },
      { text: "b", separator: "&&" },
    ]);
    expect(splitShellStagesDetailed("a || b")).toEqual([
      { text: "a", separator: null },
      { text: "b", separator: "||" },
    ]);
    expect(splitShellStagesDetailed("a; b")).toEqual([
      { text: "a", separator: null },
      { text: "b", separator: ";" },
    ]);
  });

  it("is quote-aware, exactly like the string form", () => {
    expect(splitShellStagesDetailed(`echo "a | b"`)).toEqual([
      { text: `echo "a | b"`, separator: null },
    ]);
  });
});

describe("trailingPipeFilter — which stage takes the exit status", () => {
  it("names the trailing filter for every masking stage measured on the estate", () => {
    for (const filter of ["head", "tail", "sort", "uniq", "cut", "sed", "tr", "awk", "column", "wc"]) {
      expect(trailingPipeFilter(`rg -n "x" f.ts | ${filter} -1`), filter).toBe(filter);
    }
  });

  it("returns null when the last stage carries a real exit status", () => {
    expect(trailingPipeFilter(`rg -n "x" f.ts | grep -q foo`)).toBeNull();
    expect(trailingPipeFilter(`cat f.json | jq -e '.ok'`)).toBeNull();
    expect(trailingPipeFilter(`rg -c x f.ts | head -1 | grep -q 3`)).toBeNull();
  });

  it("only fires on a `|` — && and ; and a bare command are untouched", () => {
    expect(trailingPipeFilter(`rg -n "x" f.ts && head -1 f.ts`)).toBeNull();
    expect(trailingPipeFilter(`head -1 f.ts`)).toBeNull();
    expect(trailingPipeFilter(`cd acme-web && pnpm vitest run`)).toBeNull();
  });

  it("does not see a filter inside a substitution as the trailing stage", () => {
    expect(trailingPipeFilter(`test "$(rg -c x f.ts | head -1)" = "3"`)).toBeNull();
  });

  it("treats xargs as transparent — it reports its child's failure as 123", () => {
    // The estate's real shape (M244/01): the second grep's failure survives.
    expect(trailingPipeFilter(`grep -rln "dead" app | xargs grep -l "scan"`)).toBeNull();
    // …but a child that is itself a filter, an empty-input flag, or no child
    // at all (defaults to echo) does mask.
    expect(trailingPipeFilter(`grep -rln x app | xargs head -1`)).toBe("xargs");
    expect(trailingPipeFilter(`grep -rln x app | xargs -r grep -l y`)).toBe("xargs");
    expect(trailingPipeFilter(`grep -rln x app | xargs -n 1 head -1`)).toBe("xargs");
    expect(trailingPipeFilter(`grep -rln x app | xargs`)).toBe("xargs");
  });

  it("flags the real M347/04 Command that ticked green on unstarted work", () => {
    expect(pipelineMasksExitStatus(M347_COMMAND)).toBe(true);
    expect(trailingPipeFilter(M347_COMMAND)).toBe("head");
  });
});

describe("classifyItem — a masked Command is refused", () => {
  it("refuses `… | head -1` paired with `Expected: exit 0`", () => {
    const result = classifyItem(item(M347_COMMAND, "exit 0"));
    expect(result.kind).toBe("grammar-error");
    if (result.kind !== "grammar-error") throw new Error("unreachable");
    expect(result.reason).toContain("| head");
    expect(result.reason).toContain("pipefail");
  });

  it("refuses a masked Command paired with any exit assertion, not just exit 0", () => {
    expect(classifyItem(item(`rg -n "x" f.ts | wc -l`, "exit 1")).kind).toBe("grammar-error");
  });

  it("accepts `set -o pipefail` as an explicit opt-in", () => {
    const opted = `set -o pipefail; rg -n "x" f.ts | head -1`;
    expect(pipelineMasksExitStatus(opted)).toBe(false);
    expect(classifyItem(item(opted, "exit 0")).kind).toBe("would-execute");
  });

  it("accepts ${PIPESTATUS[0]} as an explicit opt-in", () => {
    const opted = `rg -n "x" f.ts | head -1; exit \${PIPESTATUS[0]}`;
    expect(pipelineMasksExitStatus(opted)).toBe(false);
    expect(classifyItem(item(opted, "exit 0")).kind).toBe("would-execute");
  });

  it("leaves a Command paired with `stdout matches` alone — the regex is the assertion", () => {
    const counted = `rg -c "x" f.ts | wc -l`;
    expect(classifyItem(item(counted, "stdout matches /^[1-9][0-9]*$/")).kind).toBe(
      "would-execute",
    );
    expect(classifyItem(item(counted, `stdout contains "3"`)).kind).toBe("would-execute");
  });

  it("leaves an unpiped Command alone", () => {
    expect(classifyItem(item(`cd acme-web && rg -q "remedy-insufficient" app/x.ts`, "exit 0")).kind)
      .toBe("would-execute");
  });

  it("still classifies a shell no-op as manual, not as a masked pipeline", () => {
    expect(classifyItem(item("true", "exit 0")).kind).toBe("manual");
  });
});

describe("runVerification — nothing is executed and nothing can auto-pass", () => {
  it("reports a masked Command as an error, never a pass", () => {
    // `: | head -1` would exit 0 if it ran; the guard must refuse it anyway.
    const result = runVerification(item(`ls /nonexistent-path-xyz | head -1`, "exit 0"));
    expect(result.outcome).toBe("error");
    if (result.outcome !== "error") throw new Error("unreachable");
    expect(result.reason).toContain("trailing");
  });

  it("does not spawn the Command — a masked pipeline with a side effect leaves none", () => {
    const marker = `/tmp/tracker-trailing-pipe-guard-${process.pid}.marker`;
    const result = runVerification(item(`touch ${marker} | head -1`, "exit 0"));
    expect(result.outcome).toBe("error");
    // If the guard ran the Command, the marker would exist.
    expect(existsSync(marker)).toBe(false);
  });
});
