/**
 * Stage evidence (0.72.0): every stage change is stamped with head, host and
 * time, and verified / committed / reviewed need proof. Runs against a real
 * throwaway git repo in the temp dir.
 *
 * pnpm vitest run worklog-stage-evidence
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { initTracker } from "../lib/tracker-writer.ts";
import {
  openThread,
  appendThread,
  listThreads,
  setStage,
  dispatchThread,
  parkThread,
  parseWorklogMarkdown,
  serializeWorklogMarkdown,
} from "../lib/worklog.ts";
import { StageRefusal } from "../lib/stage-evidence.ts";
import { appendLedgerEntry, readLedger } from "../lib/verification/ledger.ts";

const SPEC = ".tracker/M1-probe/01-p.md";

function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function refusal(fn: () => void): StageRefusal {
  try {
    fn();
  } catch (err) {
    if (err instanceof StageRefusal) return err;
    throw err;
  }
  throw new Error("expected a StageRefusal");
}

describe("stage evidence", () => {
  let tmpDir: string;
  let trackerRoot: string;
  let worklogPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-stage-evidence-"));
    git(tmpDir, ["init", "-q", "-b", "main"]);
    git(tmpDir, ["config", "user.email", "test@example.com"]);
    git(tmpDir, ["config", "user.name", "Test"]);
    git(tmpDir, ["config", "commit.gpgsign", "false"]);
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    mkdirSync(join(trackerRoot, "M1-probe"), { recursive: true });
    writeFileSync(join(tmpDir, SPEC), "# P\n");
    worklogPath = join(trackerRoot, "worklog", "M1-probe.md");
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "a.ts"), "export const a = 1;\n");
    git(tmpDir, ["add", "-A"]);
    git(tmpDir, ["commit", "-q", "-m", "base"]);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function dispatched(): string {
    const id = openThread({ worklogPath, slug: "t", specPath: SPEC, stage: "planned", session: "sess-1" });
    dispatchThread({ worklogPath, threadId: id, agent: "x", session: "sess-1" });
    return id;
  }

  function ledger(index: number, outcome: "pass" | "fail" | "manual", at?: string, evidence?: string): void {
    appendLedgerEntry({
      trackerRoot,
      specPath: join(tmpDir, SPEC),
      index,
      label: `item ${String(index)}`,
      command: "true",
      expected: "exit 0",
      exitCode: outcome === "pass" ? 0 : 1,
      outcome,
      evidence,
      at,
    });
  }

  function commitAll(message: string): string {
    git(tmpDir, ["add", "-A"]);
    git(tmpDir, ["commit", "-q", "-m", message]);
    return git(tmpDir, ["rev-parse", "HEAD"]);
  }

  /** A thread at `committed`, with its work in a real commit. */
  function committed(): string {
    const id = dispatched();
    ledger(0, "pass");
    setStage({ worklogPath, threadId: id, stage: "verified" });
    const sha = commitAll("work");
    setStage({ worklogPath, threadId: id, stage: "committed", commit: sha });
    return id;
  }

  // -------------------------------------------------------------------------
  // stamps
  // -------------------------------------------------------------------------

  it("stamps carry head, host and at, and appear in list --json fields", () => {
    const head = git(tmpDir, ["rev-parse", "HEAD"]);
    const id = dispatched();
    const t = listThreads({ trackerRoot }).find((x) => x.threadId === id)!;
    expect(t.session).toBe("sess-1");
    expect(t.stamps?.map((s) => s.stage)).toEqual(["planned", "dispatched"]);
    expect(t.stageStamp).toMatchObject({ stage: "dispatched", head, host: hostname(), session: "sess-1" });
    expect(Number.isFinite(Date.parse(t.stageStamp!.at))).toBe(true);
    const raw = readFileSync(worklogPath, "utf-8");
    expect(raw).toContain("<!-- stage: dispatched -->");
    expect(raw).toContain("<!-- session: sess-1 -->");
    expect(raw).toMatch(/<!-- stamp: \{"stage":"dispatched","at":"[^"]+","head":"[0-9a-f]{40}"/);
  });

  it("stamp lines round-trip, and an old reader's view keeps the plain stage line", () => {
    const id = committed();
    const raw = readFileSync(worklogPath, "utf-8");
    expect(serializeWorklogMarkdown(parseWorklogMarkdown(raw))).toBe(raw);
    // The stage line an old reader matches is unchanged in shape.
    expect(raw).toContain("<!-- stage: committed -->");
    const t = listThreads({ trackerRoot }).find((x) => x.threadId === id)!;
    expect(t.stageStamp?.commit).toBe(git(tmpDir, ["rev-parse", "HEAD"]));
  });

  it("a stamp reason with --> is escaped and cannot end the comment early", () => {
    const id = openThread({ worklogPath, slug: "esc", stage: "planned" });
    setStage({ worklogPath, threadId: id, stage: "verified", force: true, reason: "odd --> <reason>" });
    const raw = readFileSync(worklogPath, "utf-8");
    const stampLine = raw.split("\n").find((l) => l.includes('"stage":"verified"'))!;
    expect(stampLine.indexOf("-->")).toBe(stampLine.length - 3);
    expect(listThreads({ trackerRoot }).find((x) => x.threadId === id)?.stageStamp?.reason).toBe("odd --> <reason>");
  });

  it("old threads without stamps or session still parse", () => {
    mkdirSync(join(trackerRoot, "worklog"), { recursive: true });
    writeFileSync(
      worklogPath,
      ["## 01OLD-t — t", "<!-- opened: 2026-01-01T00:00:00.000Z -->", "<!-- stage: committed -->", ""].join("\n"),
    );
    const [t] = listThreads({ trackerRoot });
    expect(t?.stage).toBe("committed");
    expect(t?.stamps).toBeUndefined();
    expect(t?.session).toBeUndefined();
  });

  it("ledger lines carry head and host; old lines without them still parse", () => {
    appendFileSync(
      join(trackerRoot, ".verification-log.jsonl"),
      JSON.stringify({ spec: SPEC, index: 9, label: "old", command: null, expected: null, exitCode: null, outcome: "pass", pluginVersion: "1", at: "2026-01-01T00:00:00.000Z" }) + "\n",
    );
    ledger(0, "pass");
    const lines = readLedger(trackerRoot);
    expect(lines).toHaveLength(2);
    expect(lines[0]?.head).toBeUndefined();
    expect(lines[1]?.head).toBe(git(tmpDir, ["rev-parse", "HEAD"]));
    expect(lines[1]?.host).toBe(hostname());
  });

  // -------------------------------------------------------------------------
  // verified
  // -------------------------------------------------------------------------

  it("verified: refused with no ledger line, accepted after a passing one", () => {
    const id = dispatched();
    expect(refusal(() => setStage({ worklogPath, threadId: id, stage: "verified" })).message).toMatch(/no passing ledger line/);
    ledger(0, "pass");
    setStage({ worklogPath, threadId: id, stage: "verified" });
    expect(listThreads({ trackerRoot })[0]?.stage).toBe("verified");
  });

  it("verified: a pass from before the dispatch does not count", () => {
    ledger(0, "pass", "2020-01-01T00:00:00.000Z");
    const id = dispatched();
    expect(refusal(() => setStage({ worklogPath, threadId: id, stage: "verified" })).message).toMatch(/no passing ledger line/);
  });

  it("verified: refused while an item's latest result is a failure", () => {
    const id = dispatched();
    ledger(0, "pass");
    ledger(1, "fail");
    expect(refusal(() => setStage({ worklogPath, threadId: id, stage: "verified" })).message).toMatch(/#1 \(fail\)/);
    ledger(1, "pass");
    setStage({ worklogPath, threadId: id, stage: "verified" });
  });

  it("verified: a manual mark with evidence counts, a bare manual line does not", () => {
    const id = dispatched();
    ledger(0, "manual");
    expect(() => setStage({ worklogPath, threadId: id, stage: "verified" })).toThrow(StageRefusal);
    ledger(0, "manual", undefined, "checked by hand");
    setStage({ worklogPath, threadId: id, stage: "verified" });
  });

  // -------------------------------------------------------------------------
  // committed
  // -------------------------------------------------------------------------

  it("committed: defaults to HEAD and records the sha", () => {
    const id = dispatched();
    ledger(0, "pass");
    setStage({ worklogPath, threadId: id, stage: "verified" });
    const sha = commitAll("work");
    setStage({ worklogPath, threadId: id, stage: "committed" });
    expect(listThreads({ trackerRoot })[0]?.stageStamp?.commit).toBe(sha);
  });

  it("committed: refused when the sha is not an ancestor of HEAD", () => {
    const id = dispatched();
    ledger(0, "pass");
    setStage({ worklogPath, threadId: id, stage: "verified" });
    commitAll("tracker");
    git(tmpDir, ["checkout", "-q", "-b", "side"]);
    writeFileSync(join(tmpDir, "side.txt"), "x\n");
    const side = commitAll("side");
    git(tmpDir, ["checkout", "-q", "main"]);
    expect(refusal(() => setStage({ worklogPath, threadId: id, stage: "committed", commit: side })).message).toMatch(/not an ancestor of HEAD/);
    expect(refusal(() => setStage({ worklogPath, threadId: id, stage: "committed", commit: "deadbeef" })).message).toMatch(/names no commit/);
  });

  it("committed: refused while an artifact is dirty", () => {
    const id = dispatched();
    appendThread({ worklogPath, threadId: id, section: "artifact", message: "src/a.ts" });
    ledger(0, "pass");
    setStage({ worklogPath, threadId: id, stage: "verified" });
    commitAll("tracker");
    writeFileSync(join(tmpDir, "src", "a.ts"), "export const a = 2;\n");
    expect(refusal(() => setStage({ worklogPath, threadId: id, stage: "committed" })).message).toMatch(/dirty or untracked: src\/a\.ts/);
  });

  it("committed: refused while an untracked file sits under an artifact directory", () => {
    const id = dispatched();
    appendThread({ worklogPath, threadId: id, section: "artifact", message: "src/" });
    ledger(0, "pass");
    setStage({ worklogPath, threadId: id, stage: "verified" });
    commitAll("tracker");
    mkdirSync(join(tmpDir, "src", "deep"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "deep", "new.ts"), "x\n");
    expect(refusal(() => setStage({ worklogPath, threadId: id, stage: "committed" })).message).toMatch(/dirty or untracked: src\//);
  });

  it("committed: an Artifacts entry with several paths is checked path by path", () => {
    const id = dispatched();
    appendThread({ worklogPath, threadId: id, section: "Artifacts", message: "src/a.ts, src/b.ts" });
    expect(listThreads({ trackerRoot })[0]?.artifacts).toEqual(["src/a.ts, src/b.ts"]);
    ledger(0, "pass");
    setStage({ worklogPath, threadId: id, stage: "verified" });
    commitAll("tracker");
    writeFileSync(join(tmpDir, "src", "b.ts"), "x\n");
    expect(refusal(() => setStage({ worklogPath, threadId: id, stage: "committed" })).message).toMatch(/dirty or untracked: src\/b\.ts\. Commit/);
  });

  it("committed: outside git refuses with exit 3 unless --no-git", () => {
    const bare = mkdtempSync(join(tmpdir(), "tracker-stage-nogit-"));
    try {
      initTracker({ projectRoot: bare });
      const root = join(bare, ".tracker");
      const path = join(root, "worklog", "M1.md");
      const id = openThread({ worklogPath: path, slug: "t", stage: "planned" });
      setStage({ worklogPath: path, threadId: id, stage: "verified", force: true, reason: "no ledger here" });
      const err = refusal(() => setStage({ worklogPath: path, threadId: id, stage: "committed" }));
      expect(err.exitCode).toBe(3);
      setStage({ worklogPath: path, threadId: id, stage: "committed", noGit: true });
      const t = listThreads({ trackerRoot: root })[0];
      expect(t?.stageStamp).toMatchObject({ stage: "committed", commit: "none", head: "none" });
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // reviewed
  // -------------------------------------------------------------------------

  it("reviewed: refused without a Review: note after the commit, accepted with one", () => {
    const id = dispatched();
    appendThread({ worklogPath, threadId: id, section: "note", message: "Review: too early" });
    ledger(0, "pass");
    setStage({ worklogPath, threadId: id, stage: "verified" });
    setStage({ worklogPath, threadId: id, stage: "committed", commit: commitAll("work") });
    appendThread({ worklogPath, threadId: id, section: "note", message: "not a review" });
    // The note before the committed stamp may share its millisecond; push the stamp clearly after it.
    const doc = parseWorklogMarkdown(readFileSync(worklogPath, "utf-8"));
    const early = doc.threads[0]!.entries.find((e) => e.text === "Review: too early")!;
    early.timestamp = "2020-01-01T00:00:00.000Z";
    writeFileSync(worklogPath, serializeWorklogMarkdown(doc));
    expect(refusal(() => setStage({ worklogPath, threadId: id, stage: "reviewed" })).message).toMatch(/no note starting with "Review:"/);
    appendThread({ worklogPath, threadId: id, section: "note", message: "Review: diff read, tests cover the edge" });
    setStage({ worklogPath, threadId: id, stage: "reviewed" });
    expect(listThreads({ trackerRoot })[0]?.reviewNotes).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // no skipping, force, park
  // -------------------------------------------------------------------------

  it("skipping verified or committed is refused; skipping dispatched is not", () => {
    const id = openThread({ worklogPath, slug: "skip", specPath: SPEC, stage: "planned" });
    expect(refusal(() => setStage({ worklogPath, threadId: id, stage: "committed" })).message).toMatch(/skips verified/);
    expect(refusal(() => setStage({ worklogPath, threadId: id, stage: "reviewed" })).message).toMatch(/skips verified, committed/);
    ledger(0, "pass");
    setStage({ worklogPath, threadId: id, stage: "verified" });
    expect(refusal(() => setStage({ worklogPath, threadId: id, stage: "reviewed" })).message).toMatch(/skips committed/);
  });

  it("--force with a reason records forced on the stamp and a note on the thread", () => {
    const id = openThread({ worklogPath, slug: "f", stage: "planned" });
    setStage({ worklogPath, threadId: id, stage: "reviewed", force: true, reason: "hotfix, reviewed in the call" });
    const t = listThreads({ trackerRoot })[0]!;
    expect(t.stage).toBe("reviewed");
    expect(t.forced).toBe(true);
    expect(t.stageStamp).toMatchObject({ forced: true, reason: "hotfix, reviewed in the call" });
    expect(readFileSync(worklogPath, "utf-8")).toContain("Forced to reviewed: hotfix, reviewed in the call");
  });

  it("--force without a reason is refused", () => {
    const id = openThread({ worklogPath, slug: "f", stage: "planned" });
    expect(() => setStage({ worklogPath, threadId: id, stage: "committed", force: true })).toThrow(/non-empty --reason/);
    expect(() => setStage({ worklogPath, threadId: id, stage: "committed", force: true, reason: "  " })).toThrow(/non-empty --reason/);
  });

  it("park works from every stage", () => {
    for (const stage of ["planned", "dispatched", "verified", "committed"] as const) {
      const id = openThread({ worklogPath, slug: `p-${stage}`, stage: "planned" });
      if (stage !== "planned") setStage({ worklogPath, threadId: id, stage, force: true, reason: "setup" });
      parkThread({ worklogPath, threadId: id, reason: "deferred" });
      expect(listThreads({ trackerRoot }).find((x) => x.threadId === id)?.closeStatus).toBe("blocked");
    }
  });
});
