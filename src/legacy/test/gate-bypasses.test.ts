/**
 * The gate bypasses closed in 0.76.0, one test per bypass. Each test runs the
 * real CLI (or the library) in a throwaway git repo with a `.tracker/`.
 *
 * pnpm vitest run gate-bypasses
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { initTracker, addMilestone } from "../lib/tracker-writer.ts";
import {
  escapeEntryText,
  listThreads,
  parseWorklogMarkdown,
  serializeWorklogMarkdown,
  unescapeEntryText,
} from "../lib/worklog.ts";
import { selectVerifiedThreads } from "../lib/uncommitted.ts";
import { normaliseArtifact, splitArtifactList } from "../lib/artifact-paths.ts";
import { readLedger } from "../lib/verification/ledger.ts";
import { reviewFenceProblem } from "../lib/counsel-gate.ts";

const KEY = "M1-probe/01-p.md";
const SPEC_REF = `.tracker/${KEY}`;

function spec(items: string[], frontmatter = ""): string {
  return [
    "---",
    "updated: 2026-01-01",
    "agent: test",
    ...(frontmatter === "" ? [] : [frontmatter]),
    "---",
    "",
    "# Probe",
    "",
    "## Verification Checklist",
    "",
    ...items,
    "",
    "## Rollback",
    "",
    "Revert the commit.",
    "",
  ].join("\n");
}

/** A runnable item: verify-item would run it. */
const RUNNABLE = ["- [ ] the file exists", "  - Command: `test -f src/a.ts`", "  - Expected: exit 0"].join("\n");
/** A manual item with its reason. */
const MANUAL = [
  "- [ ] looks right",
  "  - Command: `echo look at it`",
  "  - Expected: exit 0",
  "  - Manual: a person has to look",
].join("\n");

const REVIEW_OK = [
  "```darius-review",
  JSON.stringify({
    reviewer: "opus",
    items: Object.fromEntries(
      ["data-loss", "irreversible", "hidden-scope", "missing-test", "rollback"].map((k) => [k, { verdict: "ok", reason: "fine" }]),
    ),
  }),
  "```",
  "",
].join("\n");

const REVIEW_BLOCKED = REVIEW_OK.replace('"data-loss":{"verdict":"ok"', '"data-loss":{"verdict":"blocker"');

const OLD_FORMAT = "## Advisor 1 — Skeptic\n\n**Verdict**: thumbs_up\n\n**Assessment**: fine\n";

describe("gate bypasses closed in 0.76.0", () => {
  let tmpDir: string;
  let trackerRoot: string;
  let specPath: string;

  function git(args: string[]): string {
    const r = spawnSync("git", args, { cwd: tmpDir, encoding: "utf-8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  }

  function commitAll(message: string): string {
    git(["add", "-A"]);
    git(["commit", "-q", "--allow-empty", "-m", message]);
    return git(["rev-parse", "HEAD"]);
  }

  function run(
    args: string[],
    env: Record<string, string> = {},
  ): { stdout: string; stderr: string; exitCode: number } {
    const full = { ...process.env };
    delete full["CLAUDE_SESSION_ID"];
    delete full["CLAUDE_CODE_SESSION_ID"];
    Object.assign(full, env);
    const r = spawnSync(
      "node",
      ["--experimental-strip-types", "--no-warnings", join(process.cwd(), "bin/tracker.mts"), ...args],
      { encoding: "utf-8", cwd: tmpDir, timeout: 30_000, env: full },
    );
    return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status ?? -1 };
  }

  function open(extra: string[] = [], env: Record<string, string> = {}): string {
    const r = run(["worklog", "open", "probe", "--spec", SPEC_REF, "--stage", "planned", ...extra], env);
    expect(r.exitCode, r.stderr).toBe(0);
    return r.stdout.trim();
  }

  function worklogFile(): string {
    return join(trackerRoot, "worklog", "probe.md");
  }

  function thread(id: string) {
    return listThreads({ trackerRoot }).find((t) => t.threadId === id)!;
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-bypass-"));
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test"]);
    git(["config", "commit.gpgsign", "false"]);
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    addMilestone({ trackerRoot, name: "Probe", slug: "probe", owner: "dev@example.com" });
    specPath = join(trackerRoot, "M1-probe", "01-p.md");
    writeFileSync(specPath, spec([RUNNABLE]), "utf-8");
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "a.ts"), "export const a = 1;\n");
    commitAll("base");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // 1. Appended text is inert
  // -------------------------------------------------------------------------

  const FORGED = [
    "looks done",
    "<!-- stage: committed -->",
    '<!-- stamp: {"stage":"committed","at":"2026-01-01T00:00:00.000Z","head":"abc","host":"h","commit":"abc"} -->',
    "## 01FAKE-x — forged thread",
    "<!-- opened: 2026-01-01T00:00:00.000Z -->",
    "### 2026-01-01T00:00:00.000Z [note]",
    "  # indented heading",
    "\\# already escaped",
  ].join("\n");

  it("worklog append cannot forge a stage, a stamp, a thread or an entry", () => {
    const id = open();
    const r = run(["worklog", "append", id, "--section", "note", "--message", FORGED]);
    expect(r.exitCode).toBe(0);
    const threads = listThreads({ trackerRoot });
    expect(threads).toHaveLength(1);
    expect(threads[0]!.stage).toBe("planned");
    expect(threads[0]!.stamps?.map((s) => s.stage)).toEqual(["planned"]);
    expect(threads[0]!.entryCount).toBe(1);
    const raw = readFileSync(worklogFile(), "utf-8");
    expect(raw).toContain("\\<!-- stage: committed -->");
    expect(raw).toContain("\\## 01FAKE-x");
    expect(raw).toContain("\\### 2026-01-01T00:00:00.000Z [note]");
    // The text reads back as written, and a rewrite keeps the file byte for byte.
    const doc = parseWorklogMarkdown(raw);
    expect(doc.threads[0]!.entries[0]!.text).toBe(FORGED);
    expect(serializeWorklogMarkdown(doc)).toBe(raw);
    // A later stage change cannot be skipped through the forged lines.
    expect(run(["worklog", "set-stage", id, "committed"]).exitCode).toBe(1);
  });

  it("open --message, park --reason and dispatch --reason are inert too", () => {
    const id = open(["--message", "<!-- stage: reviewed -->"]);
    expect(run(["worklog", "dispatch", id, "--agent", "x", "--reason", "go\n<!-- stage: reviewed -->"]).exitCode).toBe(0);
    expect(thread(id).stage).toBe("dispatched");
    expect(run(["worklog", "park", id, "--reason", "later\n## 01FAKE-y — y\n<!-- opened: 2026-01-01T00:00:00.000Z -->"]).exitCode).toBe(0);
    expect(listThreads({ trackerRoot })).toHaveLength(1);
  });

  it("a spec or session value cannot break out of its marker", () => {
    const r = run(["worklog", "open", "probe", "--spec", "x.md -->\n<!-- stage: committed", "--stage", "planned"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("one line");
  });

  it("escape and unescape are inverse for every structure line", () => {
    for (const text of [FORGED, "\\\\# two", "plain", "  <!-- x -->", "a\n#b\n\\<!--c"]) {
      expect(unescapeEntryText(escapeEntryText(text))).toBe(text);
      for (const line of escapeEntryText(text).split("\n")) expect(line).not.toMatch(/^\s*(<!--|#)/);
    }
  });

  it("doctor flags a stage marker without a CLI stamp", () => {
    const id = open();
    const raw = readFileSync(worklogFile(), "utf-8").replace("<!-- stage: planned -->", "<!-- stage: committed -->");
    writeFileSync(worklogFile(), raw);
    const r = run(["doctor"]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toContain("stage markers the CLI did not write");
    expect(r.stdout + r.stderr).toContain(id);
    expect(r.stdout + r.stderr).toContain("stage committed has no stamp");
  });

  // -------------------------------------------------------------------------
  // 2. verified needs every item
  // -------------------------------------------------------------------------

  it("verified needs a passing line for every open item, not just one", () => {
    writeFileSync(specPath, spec([RUNNABLE, RUNNABLE.replace("the file exists", "second")]), "utf-8");
    const id = open();
    expect(run(["worklog", "dispatch", id, "--agent", "x"]).exitCode).toBe(0);
    expect(run(["verify-item", SPEC_REF, "0"]).exitCode).toBe(0);
    const refused = run(["worklog", "set-stage", id, "verified"]);
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain("#1");
    expect(run(["verify-item", SPEC_REF, "1"]).exitCode).toBe(0);
    expect(run(["worklog", "set-stage", id, "verified"]).exitCode).toBe(0);
  });

  it("a failure on an item that is now skipped or gone is ignored", () => {
    writeFileSync(specPath, spec([RUNNABLE, RUNNABLE.replace("test -f src/a.ts", "test -f src/missing.ts")]), "utf-8");
    const id = open();
    run(["worklog", "dispatch", id, "--agent", "x"]);
    run(["verify-item", SPEC_REF, "0"]);
    expect(run(["verify-item", SPEC_REF, "1"]).exitCode).toBe(1);
    expect(run(["worklog", "set-stage", id, "verified"]).stderr).toContain("#1 (fail)");
    writeFileSync(specPath, spec([RUNNABLE, RUNNABLE.replace("- [ ]", "- [-]")]), "utf-8");
    expect(run(["worklog", "set-stage", id, "verified"]).exitCode).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 3. mark --verified cannot replace a runnable check
  // -------------------------------------------------------------------------

  it("mark --verified --evidence on a runnable item is refused without --override", () => {
    const r = run(["mark", SPEC_REF, "0", "--verified", "--evidence", "trust me"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("runnable check");
    expect(readLedger(trackerRoot)).toHaveLength(0);
  });

  it("--override records manual-override; it counts until a later fail", () => {
    const id = open();
    run(["worklog", "dispatch", id, "--agent", "x"]);
    expect(run(["mark", SPEC_REF, "0", "--verified", "--override", "no network here"]).exitCode).toBe(1);
    const ok = run(["mark", SPEC_REF, "0", "--verified", "--override", "no network here", "--evidence", "ran it on the build host"]);
    expect(ok.exitCode, ok.stderr).toBe(0);
    const line = readLedger(trackerRoot).at(-1)!;
    expect(line.outcome).toBe("manual-override");
    expect(line.override).toBe("no network here");
    rmSync(join(tmpDir, "src", "a.ts"));
    expect(run(["verify-item", SPEC_REF, "0", "--recheck"]).exitCode).toBe(1);
    expect(run(["worklog", "set-stage", id, "verified"]).exitCode).toBe(1);
  });

  it("a manual item still takes --evidence alone", () => {
    writeFileSync(specPath, spec([MANUAL]), "utf-8");
    expect(run(["mark", SPEC_REF, "0", "--verified", "--evidence", "looked at it"]).exitCode).toBe(0);
    expect(run(["mark", SPEC_REF, "0", "--verified", "--override", "x", "--evidence", "y"]).exitCode).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 4. committed evidence
  // -------------------------------------------------------------------------

  it("artifact paths are normalised and bad ones refused at record time", () => {
    const id = open();
    for (const bad of [".", "./", "/etc/passwd", "src/*.ts", "../outside.ts", " , "]) {
      const r = run(["worklog", "append", id, "--section", "artifact", "--message", bad]);
      expect(r.exitCode, `artifact ${JSON.stringify(bad)}`).toBe(1);
    }
    expect(run(["worklog", "append", id, "--section", "Artifacts", "--message", "./src//a.ts, src/x/../b c.ts\n- `docs/d.md`"]).exitCode).toBe(0);
    expect(run(["worklog", "append", id, "--section", "artifact", "--message", join(tmpDir, "src", "e.ts")]).exitCode).toBe(0);
    expect(thread(id).artifacts).toEqual(["src/a.ts, src/b c.ts, docs/d.md", "src/e.ts"]);
    expect(splitArtifactList("a b.ts")).toEqual(["a b.ts"]);
    expect(normaliseArtifact("src/../..", tmpDir).ok).toBe(false);
  });

  function toVerified(): string {
    const id = open();
    run(["worklog", "dispatch", id, "--agent", "x"]);
    expect(run(["verify-item", SPEC_REF, "0"]).exitCode).toBe(0);
    expect(run(["worklog", "set-stage", id, "verified"]).exitCode).toBe(0);
    return id;
  }

  it("committed is refused without artifacts, and --no-code is the way out", () => {
    const id = toVerified();
    const r = run(["worklog", "set-stage", id, "committed"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("records no artifacts");
    expect(run(["worklog", "set-stage", id, "committed", "--no-code", "  "]).exitCode).toBe(1);
    expect(run(["worklog", "set-stage", id, "committed", "--no-code", "docs only, in the tracker"]).exitCode).toBe(0);
    expect(thread(id).stageStamp?.noCode).toBe("docs only, in the tracker");
  });

  it("--no-code is refused when the thread records artifacts", () => {
    const id = toVerified();
    run(["worklog", "append", id, "--section", "artifact", "--message", "src/a.ts"]);
    expect(run(["worklog", "set-stage", id, "committed", "--no-code", "nothing"]).stderr).toContain("records artifacts");
  });

  it("committed is refused for an empty commit range", () => {
    const id = toVerified();
    run(["worklog", "append", id, "--section", "artifact", "--message", "src/a.ts"]);
    const r = run(["worklog", "set-stage", id, "committed"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("no commit since dispatch");
  });

  it("committed is refused when the range touches no artifact, accepted when it does", () => {
    const id = toVerified();
    run(["worklog", "append", id, "--section", "artifact", "--message", "src/a.ts"]);
    writeFileSync(join(tmpDir, "unrelated.txt"), "x\n");
    commitAll("unrelated");
    expect(run(["worklog", "set-stage", id, "committed"]).stderr).toContain("touch none of the artifacts");
    appendFileSync(join(tmpDir, "src", "a.ts"), "// work\n");
    const sha = commitAll("work");
    expect(run(["worklog", "set-stage", id, "committed"]).exitCode).toBe(0);
    expect(thread(id).stageStamp?.commit).toBe(sha);
  });

  it("uncommitted-verified lists dirty artifacts from a comma list (store mode selection)", () => {
    const porcelain = " M app/src/a.ts\n?? app/src/new/b.ts\n";
    const [entry] = selectVerifiedThreads(
      [{ threadId: "t", worklogFile: "w.md", stage: "verified", closed: false, artifacts: ["src/a.ts, src/new/", "./docs/x.md"] }],
      porcelain,
      "app/",
    );
    expect(entry?.dirtyArtifacts).toEqual(["src/a.ts", "src/new"]);
  });

  // -------------------------------------------------------------------------
  // 5. reviewed needs content
  // -------------------------------------------------------------------------

  it("a Review: note needs three words", () => {
    const id = toVerified();
    run(["worklog", "append", id, "--section", "artifact", "--message", "src/a.ts"]);
    appendFileSync(join(tmpDir, "src", "a.ts"), "// work\n");
    commitAll("work");
    expect(run(["worklog", "set-stage", id, "committed"]).exitCode).toBe(0);
    run(["worklog", "append", id, "--section", "note", "--message", "Review: ok ..."]);
    const refused = run(["worklog", "set-stage", id, "reviewed"]);
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain("at least 3 words");
    run(["worklog", "append", id, "--section", "note", "--message", "Review: diff read, tests cover it"]);
    expect(run(["worklog", "set-stage", id, "reviewed"]).exitCode).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 6. counsel-gate and the review stamp
  // -------------------------------------------------------------------------

  function transcript(text: string, name = "01-p.md"): string {
    const dir = join(trackerRoot, "M1-probe", "_counsel");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, name);
    writeFileSync(path, text, "utf-8");
    return path;
  }

  function highRisk(): void {
    writeFileSync(specPath, spec([RUNNABLE], "risk: high"), "utf-8");
  }

  it("refuses two review blocks and near-miss fences with exit 2", () => {
    const cases = [
      REVIEW_OK + REVIEW_OK,
      REVIEW_OK.replace("```darius-review", "~~~darius-review").replace(/```\n$/, "~~~\n"),
      REVIEW_OK.replace("```darius-review", "```Darius-Review"),
      REVIEW_OK.replace("```darius-review", "```json"),
    ];
    for (const text of cases) {
      const r = run(["counsel-gate", transcript(text)]);
      expect(r.exitCode, text.slice(0, 20)).toBe(2);
      expect(r.stderr).toContain("darius-review");
    }
    expect(reviewFenceProblem(REVIEW_OK)).toBeNull();
  });

  it("a high-risk spec takes only the review format", () => {
    highRisk();
    const r = run(["counsel-gate", transcript(OLD_FORMAT), "--spec", SPEC_REF]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("high risk");
  });

  it("--max-rounds cannot raise the budget, and counsel_rounds: 0 does not reset it", () => {
    highRisk();
    const t = transcript(REVIEW_BLOCKED);
    expect(run(["counsel-gate", t, "--spec", SPEC_REF, "--json"]).exitCode).toBe(0);
    // Lower the frontmatter counter by hand: the log still counts the round.
    writeFileSync(specPath, readFileSync(specPath, "utf-8").replace(/counsel_rounds: \d+/, "counsel_rounds: 0"));
    const second = run(["counsel-gate", t, "--spec", SPEC_REF, "--max-rounds", "9", "--json"]);
    expect(second.stderr).toContain("cannot raise the budget");
    const json = JSON.parse(second.stdout) as { status: string; rounds: number; maxRounds: number };
    expect(json).toMatchObject({ status: "counsel_exhausted", rounds: 2, maxRounds: 2 });
  });

  it("dispatch refuses a high-risk spec with a hand-written counsel: stamp", () => {
    highRisk();
    writeFileSync(specPath, readFileSync(specPath, "utf-8").replace("risk: high", "risk: high\ncounsel: 2026-10-08T00:00:00Z"));
    const id = open();
    const r = run(["worklog", "dispatch", id, "--agent", "x", "--force"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("counsel-gate");
    expect(run(["worklog", "set-stage", id, "dispatched"]).exitCode).toBe(1);
  });

  it("dispatch accepts the stamp counsel-gate wrote, until the transcript changes", () => {
    highRisk();
    const t = transcript(REVIEW_OK);
    expect(run(["counsel-gate", t, "--spec", SPEC_REF]).exitCode).toBe(0);
    const fm = readFileSync(specPath, "utf-8");
    expect(fm).toMatch(/counsel_sha256: "?[0-9a-f]{64}/);
    expect(fm).toContain("counsel_transcript:");
    const id = open();
    appendFileSync(t, "edited\n");
    expect(run(["worklog", "dispatch", id, "--agent", "x"]).stderr).toContain("changed after counsel-gate");
    writeFileSync(t, REVIEW_OK);
    expect(run(["worklog", "dispatch", id, "--agent", "x"]).exitCode).toBe(0);
  });

  it("counsel: overridden needs a recorded reason; --override records one", () => {
    highRisk();
    writeFileSync(specPath, readFileSync(specPath, "utf-8").replace("risk: high", "risk: high\ncounsel: overridden"));
    const id = open();
    expect(run(["worklog", "dispatch", id, "--agent", "x"]).exitCode).toBe(1);
    expect(run(["counsel-gate", "--spec", SPEC_REF, "--override", "operator accepted the risk"]).exitCode).toBe(0);
    expect(run(["worklog", "dispatch", id, "--agent", "x"]).exitCode).toBe(0);
  });

  it("review_gate: off lets a high-risk spec dispatch without a stamp; a low-risk spec never needs one", () => {
    const low = open();
    expect(run(["worklog", "dispatch", low, "--agent", "x"]).exitCode).toBe(0);
    highRisk();
    appendFileSync(join(trackerRoot, "config.yml"), "\nreview_gate: off\n");
    const id = open();
    expect(run(["worklog", "dispatch", id, "--agent", "x"]).exitCode).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 12. claims at open and next
  // -------------------------------------------------------------------------

  it("worklog open --spec refuses a spec another live session holds; --takeover overrides", () => {
    expect(run(["claim", SPEC_REF], { CLAUDE_SESSION_ID: "sessA" }).exitCode).toBe(0);
    const r = run(["worklog", "open", "probe", "--spec", KEY], { CLAUDE_SESSION_ID: "sessB" });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("--takeover");
    expect(run(["worklog", "open", "probe", "--spec", KEY, "--takeover"], { CLAUDE_SESSION_ID: "sessB" }).exitCode).toBe(0);
    expect(run(["worklog", "open", "probe", "--spec", KEY], { CLAUDE_SESSION_ID: "sessA" }).exitCode).toBe(0);
  });

  it("next skips a claimed spec and hands out the next free one; exit 1 when all are claimed", () => {
    writeFileSync(join(trackerRoot, "M1-probe", "02-q.md"), spec([RUNNABLE.replace("the file exists", "other thing")]));
    run(["claim", SPEC_REF], { CLAUDE_SESSION_ID: "sessA" });
    const next = run(["next", "--json"], { CLAUDE_SESSION_ID: "sessB" });
    expect(next.exitCode).toBe(0);
    const json = JSON.parse(next.stdout) as { label: string; skippedClaimed: Array<{ spec: string }> };
    expect(json.label).toBe("other thing");
    expect(json.skippedClaimed.map((c) => c.spec)).toEqual([KEY]);
    expect(run(["next"], { CLAUDE_SESSION_ID: "sessB" }).stdout).toContain("other thing");
    run(["claim", "M1-probe/02-q.md"], { CLAUDE_SESSION_ID: "sessA" });
    const all = run(["next", "--json"], { CLAUDE_SESSION_ID: "sessB" });
    expect(all.exitCode).toBe(1);
    expect((JSON.parse(all.stdout) as { skippedClaimed: unknown[] }).skippedClaimed).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // 13. --session against the env session
  // -------------------------------------------------------------------------

  it("--session that differs from the env session is refused without --as-other-session", () => {
    const env = { CLAUDE_CODE_SESSION_ID: "real" };
    const r = run(["worklog", "open", "probe", "--spec", KEY, "--session", "other"], env);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("--as-other-session");
    const ok = run(["worklog", "open", "probe", "--spec", KEY, "--session", "other", "--as-other-session"], env);
    expect(ok.exitCode).toBe(0);
    const id = ok.stdout.trim();
    expect(thread(id).session).toBe("other");
    expect(readFileSync(worklogFile(), "utf-8")).toContain("by session real (--as-other-session)");
    expect(run(["worklog", "dispatch", id, "--agent", "x", "--session", "other"], env).exitCode).toBe(1);
    expect(run(["worklog", "dispatch", id, "--agent", "x", "--session", "other", "--as-other-session"], env).exitCode).toBe(0);
    expect(thread(id).stageStamp?.actingSession).toBe("real");
    // Without an env id, --session works as before.
    expect(run(["worklog", "open", "probe", "--session", "free"]).exitCode).toBe(0);
    expect(existsSync(worklogFile())).toBe(true);
  });
});
