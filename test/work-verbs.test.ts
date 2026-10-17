/**
 * `darius work plan|verify|commit-check` (0.102.0), the delegation
 * `turn_budget` field and the spec size warning. Every case runs in a
 * sandbox host with its own state dir: never the real store.
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { commitAll, NO_GIT } from "./helpers/git.ts";
import { darius, makeHost, makeWorkRepo, ok, removeHost, type Run, type WorkRepo } from "./helpers/work-repo.ts";

const host = makeHost("darius-work-verbs");
after(() => removeHost(host));

const SESSION = { CLAUDE_CODE_SESSION_ID: "sess-work" };

interface PlanTask {
  spec: string;
  threadId: string;
  stage: string;
  agent: string | null;
  verification: { command: string; expected: string }[];
  worklogPath: string;
}

interface PlanJson {
  status: string;
  specs?: { path: string; gitStatus: string }[] | string[];
  problems?: string[];
  review?: { spec: string; riskReasons: string[]; transcriptPath: string };
  pending?: { threadId: string; stage: string }[];
  tasks: PlanTask[];
  availableAgents: { invocable: string }[];
  blocked: { spec: string; reason: string }[];
  warnings: string[];
  claims: string[];
  opened: string[];
}

interface VerifyJson {
  status: string;
  reason?: string;
  findings: string[];
  verified: number;
  total: number;
  manual: { index: number; label: string }[];
  touched: string[];
  stamp?: string;
}

interface CommitJson {
  threads: { spec: string; threadId: string | null; stage: string | null; artifacts: string[]; dirty: string[] }[];
  add: string[];
  problems: string[];
  warnings: string[];
  trailer: string;
  indexRebuilt: boolean;
}

function work(repo: WorkRepo, argv: string[], extraEnv: Record<string, string | undefined> = {}): Run {
  return darius(host, ["work", ...argv], repo.dir, { ...SESSION, ...extraEnv });
}

/** The JSON of a run's stdout: one line, nothing else. */
function json<T>(run: Run): T {
  assert.equal(run.stdout.trim().split("\n").length, 1, `one JSON line: ${run.stdout}`);
  // SAFETY: the verb's documented --json answer; the test reads the fields it asserts.
  return JSON.parse(run.stdout) as T;
}

interface Planned {
  run: Run;
  answer: PlanJson;
}

function plan(repo: WorkRepo, extra: string[] = []): Planned {
  const run = work(repo, ["plan", "--json", ...extra]);
  assert.equal(run.code, 0, `${run.stdout}${run.stderr}`);
  return { run, answer: json<PlanJson>(run) };
}

function specWith(title: string, items: string[], frontmatter: string[] = []): string {
  return ["---", "updated: 2026-10-17", "depends_on: []", "agent: unassigned", ...frontmatter, "---", "", `# ${title}`, "", "## Verification Checklist", "", ...items, ""].join("\n");
}

function runnable(file: string): string {
  return [`- [ ] Create \`${file}\``, `  - Command: \`test -f ${file}\``, "  - Expected: `exit 0`"].join("\n");
}

/** Plans, dispatches and creates the file the spec wants. Returns the task. */
function planAndBuild(repo: WorkRepo, file: string): PlanTask {
  const { answer } = plan(repo);
  assert.equal(answer.status, "ready", JSON.stringify(answer));
  const task = answer.tasks[0];
  assert.ok(task !== undefined);
  ok(host, ["worklog", "dispatch", task.threadId, "--agent", "main", "--reason", "test", "--session", "sess-work"], repo.dir);
  writeFileSync(join(repo.dir, file), "done\n");
  return task;
}

function loopRound(mode: "store" | "git"): void {
  const repo = makeWorkRepo(host, mode, `loop-${mode}`);
  // A git-mode tracker lives in git: the commit-first gate reads its dirty spec files.
  if (mode === "git") commitAll(repo.dir, "tracker");
  // Spec one of Alpha: the plan claims it, opens a thread at planned, and picks main (no roster).
  const { run, answer } = plan(repo);
  assert.equal(answer.status, "ready");
  assert.equal(answer.tasks.length, 1);
  const task = answer.tasks[0];
  assert.ok(task !== undefined);
  assert.equal(task.spec.endsWith("01-spec-one.md"), true, task.spec);
  assert.equal(task.stage, "planned");
  assert.equal(task.agent, "main");
  assert.deepEqual(task.verification, [{ command: "test -f out.txt", expected: "exit 0" }]);
  assert.deepEqual(answer.availableAgents, []);
  assert.match(answer.claims[0] ?? "", /^CLAIMED: /u);
  assert.deepEqual(answer.opened, [task.threadId]);
  assert.match(run.stderr, /^CLAIMED: /mu);
  assert.match(run.stderr, new RegExp(`^OPENED: ${task.threadId} `, "mu"));

  ok(host, ["worklog", "dispatch", task.threadId, "--agent", "main", "--reason", "test", "--session", "sess-work"], repo.dir);
  writeFileSync(join(repo.dir, "out.txt"), "done\n");
  const verified = work(repo, ["verify", task.spec, "--thread", task.threadId, "--touched", "out.txt", "--json"]);
  assert.equal(verified.code, 0, verified.stderr);
  const v = json<VerifyJson>(verified);
  assert.equal(v.status, "pass");
  assert.equal(v.verified, 1);
  assert.equal(v.total, 1);
  assert.equal(v.stamp, `set-stage: ${task.threadId} → verified`);
  assert.deepEqual(v.touched, ["out.txt"]);

  // A drift line for the artifact, to see set-stage committed prune it.
  writeFileSync(join(repo.tree, ".pending-sync"), "out.txt\nother.txt\n");
  const check = work(repo, ["commit-check", task.spec, "--json"]);
  assert.equal(check.code, 0, check.stderr);
  const c = json<CommitJson>(check);
  if (mode === "store") assert.deepEqual(c.add, ["out.txt"], "store mode commits code only");
  else assert.ok(c.add.includes("out.txt") && c.add.includes(".tracker/M1-alpha/01-spec-one.md"), c.add.join(" "));
  assert.equal(c.threads[0]?.stage, "verified");
  assert.match(c.trailer, /^Tracker: \S+01-spec-one\.md 0\/1 -> 1\/1 verified$/u);
  assert.equal(c.indexRebuilt, true);
  assert.match(c.warnings.join("\n"), /\.pending-sync lists 2 file/u);

  // The verified thread is debt: the next plan says commit first and opens nothing.
  const debt = plan(repo).answer;
  assert.equal(debt.status, "commit_first");
  assert.deepEqual(debt.opened, []);
  const text = work(repo, ["plan"]);
  assert.equal(text.stdout.split("\n")[0], "STATUS: commit_first");

  const sha = commitAll(repo.dir, "feat: out");
  const stamped = ok(host, ["worklog", "set-stage", task.threadId, "committed", "--commit", sha], repo.dir);
  assert.match(stamped, /removed 1 line\(s\) from \.pending-sync/u);
  assert.equal(readFileSync(join(repo.tree, ".pending-sync"), "utf8"), "other.txt\n");

  // The next plan moves on to spec two and lists the committed thread as context.
  const second = plan(repo).answer;
  assert.equal(second.status, "ready");
  assert.equal(second.tasks[0]?.spec.endsWith("02-spec-two.md"), true);
}

test("work plan, verify and commit-check run one loop round in store mode", () => {
  loopRound("store");
});

test("work plan, verify and commit-check run one loop round in git mode", { skip: NO_GIT }, () => {
  loopRound("git");
});

test("work plan returns complete with the threads that still owe a stage", () => {
  const repo = makeWorkRepo(host, "store", "complete");
  for (const spec of [repo.alpha1, repo.alpha2, repo.beta1]) ok(host, ["mark", spec, "0", "--skipped"], repo.dir);
  ok(host, ["worklog", "open", "M1-alpha", "--spec", repo.alpha1, "--stage", "planned", "--session", "sess-work"], repo.dir);
  const { answer } = plan(repo);
  assert.equal(answer.status, "complete");
  assert.equal(answer.pending?.length, 1);
  assert.equal(answer.pending?.[0]?.stage, "planned");
});

test("work plan stops on an invalid spec and opens no thread", () => {
  const repo = makeWorkRepo(host, "store", "invalid");
  writeFileSync(join(repo.tree, repo.alpha1), specWith("Broken", ["- [ ] No command here"]));
  const { answer } = plan(repo);
  assert.equal(answer.status, "spec_invalid");
  assert.deepEqual(answer.specs, [repo.alpha1]);
  assert.match(answer.problems?.join("\n") ?? "", /no Command/u);
  assert.deepEqual(answer.opened, []);
});

test("work plan prepares a high-risk spec as review_required, and stops on a rejected or exhausted stamp", () => {
  const repo = makeWorkRepo(host, "store", "review");
  const risky = (stamp: string[]): string => specWith("Risky", [runnable("out.txt")], ["risk: high", ...stamp]).replace("## Verification Checklist", "## Rollback\n\nRevert the commit.\n\n## Verification Checklist");
  writeFileSync(join(repo.tree, repo.alpha1), risky([]));
  const first = plan(repo).answer;
  assert.equal(first.status, "review_required");
  assert.equal(first.review?.spec, repo.alpha1);
  assert.match(first.review?.riskReasons.join("\n") ?? "", /frontmatter/u);
  assert.match(first.review?.transcriptPath ?? "", /M1-alpha\/_counsel\/01-spec-one\.md$/u);
  assert.equal(first.tasks.length, 1, "the task is still prepared");

  writeFileSync(join(repo.tree, repo.alpha1), risky(["counsel: rejected"]));
  const rejected = plan(repo).answer;
  assert.equal(rejected.status, "blocked");
  assert.equal(rejected.blocked[0]?.reason, "review rejected");
  assert.equal(rejected.tasks.length, 0);

  writeFileSync(join(repo.tree, repo.alpha1), risky(["counsel: exhausted"]));
  assert.equal(plan(repo).answer.status, "counsel_exhausted");
});

test("work plan --batch 2 takes two specs of the milestone", () => {
  const repo = makeWorkRepo(host, "store", "batch");
  const { answer } = plan(repo, ["--batch", "2"]);
  assert.equal(answer.status, "ready");
  assert.deepEqual(
    answer.tasks.map((task) => task.spec),
    [repo.alpha1, repo.alpha2],
  );
  assert.equal(answer.opened.length, 2);
});

test("work verify fails a check that does not pass, logs it, and names the next command", () => {
  const repo = makeWorkRepo(host, "store", "verify-fail");
  const task = planAndBuild(repo, "elsewhere.txt");
  const run = work(repo, ["verify", task.spec, "--thread", task.threadId, "--touched", "elsewhere.txt", "--json"]);
  assert.equal(run.code, 1, run.stderr);
  const v = json<VerifyJson>(run);
  assert.equal(v.status, "fail");
  assert.equal(v.reason, "verification");
  assert.match(v.findings[0] ?? "", /^\[0\] /u);
  assert.match(run.stderr, /next: fix the findings, then run: darius work verify /u);
  // SAFETY: the documented worklog list JSON.
  const threads = JSON.parse(ok(host, ["worklog", "list", "--active", "--json"], repo.dir)) as { threads: { threadId: string; stage: string }[] };
  assert.equal(threads.threads.find((thread) => thread.threadId === task.threadId)?.stage, "dispatched");
});

test("work verify fails on a debug artifact in a touched file", () => {
  const repo = makeWorkRepo(host, "store", "verify-artifact");
  const task = planAndBuild(repo, "out.txt");
  writeFileSync(join(repo.dir, "debug.js"), "console.log('x');\n");
  const run = work(repo, ["verify", task.spec, "--thread", task.threadId, "--touched", "out.txt,debug.js", "--json"]);
  assert.equal(run.code, 1);
  const v = json<VerifyJson>(run);
  assert.equal(v.reason, "artifacts");
  assert.match(v.findings[0] ?? "", /^debug\.js:1: console\.log/u);
});

test("work verify leaves a manual item to the caller and does not stamp", () => {
  const repo = makeWorkRepo(host, "store", "verify-manual");
  const manual = ["- [ ] Read the page", "  - Command: `echo looked`", "  - Expected: `exit 0`", "  - Manual: a person reads it"].join("\n");
  writeFileSync(join(repo.tree, repo.alpha1), specWith("Manual", [runnable("out.txt"), manual]));
  ok(host, ["index", "--rebuild"], repo.dir);
  const task = planAndBuild(repo, "out.txt");
  const run = work(repo, ["verify", task.spec, "--thread", task.threadId, "--touched", "out.txt", "--json"]);
  assert.equal(run.code, 0, run.stderr);
  const v = json<VerifyJson>(run);
  assert.equal(v.status, "manual");
  assert.deepEqual(v.manual, [{ index: 1, label: "Read the page" }]);
  assert.equal(v.stamp, undefined);
});

test("work commit-check refuses a thread that is not verified, with the next command", () => {
  const repo = makeWorkRepo(host, "store", "commit-refuse");
  const task = planAndBuild(repo, "out.txt");
  const run = work(repo, ["commit-check", task.spec, "--json"]);
  assert.equal(run.code, 1);
  const c = json<CommitJson>(run);
  assert.match(c.problems[0] ?? "", /is at stage dispatched, not verified/u);
  assert.match(run.stderr, /next: darius work verify /u);
});

test("work verbs: usage is exit 2, no tracker is exit 3, and bun runs them too", () => {
  const repo = makeWorkRepo(host, "store", "usage");
  assert.equal(work(repo, ["verify", repo.alpha1]).code, 2);
  assert.equal(work(repo, ["commit-check"]).code, 2);
  assert.equal(work(repo, ["plan", "--batch", "0"]).code, 2);
  assert.equal(work(repo, ["nope"]).code, 2);
  const noThread = work(repo, ["verify", repo.alpha1, "--thread", "01NOPE", "--touched", "out.txt"]);
  assert.equal(noThread.code, 1);
  assert.match(noThread.stderr, /next: darius worklog list --active --json/u);
  const bare = mkdtempSync(join(tmpdir(), "darius-work-none-"));
  const none = darius(host, ["work", "plan", "--json"], bare, SESSION);
  assert.equal(none.code, 3);
  const bun = work(repo, ["plan", "--json"], { DARIUS_RUNTIME: "bun" });
  assert.equal(bun.code, 0, bun.stderr);
  assert.equal(json<PlanJson>(bun).status, "ready");
});

test("spec check warns on more than 5 open items, and never blocks on it", () => {
  const repo = makeWorkRepo(host, "store", "size");
  const items = Array.from({ length: 6 }, (_, at) => runnable(`f${String(at)}.txt`));
  writeFileSync(join(repo.tree, repo.alpha1), specWith("Big", items));
  const big = darius(host, ["spec", "check", repo.alpha1, "--json"], repo.dir);
  assert.equal(big.code, 0, big.stderr);
  // SAFETY: the documented spec check JSON.
  assert.deepEqual((JSON.parse(big.stdout) as { warnings: string[] }).warnings, ["6 items; split specs over 5 items"]);
  const skipped = items.map((item, at) => (at === 0 ? item.replace("- [ ]", "- [-]") : item));
  writeFileSync(join(repo.tree, repo.alpha1), specWith("Five", skipped));
  // SAFETY: as above.
  assert.deepEqual((JSON.parse(ok(host, ["spec", "check", repo.alpha1, "--json"], repo.dir)) as { warnings: string[] }).warnings, []);
  writeFileSync(join(repo.tree, repo.alpha1), specWith("Big", items));
  const planned = plan(repo).answer;
  assert.equal(planned.status, "ready");
  assert.deepEqual(planned.warnings, [`${repo.alpha1}: 6 items; split specs over 5 items`]);
});

test("delegation validate takes an optional positive whole turn_budget", () => {
  const cwd = mkdtempSync(join(tmpdir(), "darius-turn-budget-"));
  const at = (budget: string): Run => darius(host, ["delegation", "validate", `{"task":"t","turn_budget":${budget}}`], cwd);
  assert.equal(at("60").code, 0);
  for (const bad of ["0", "-1", "1.5", '"60"']) {
    const run = at(bad);
    assert.equal(run.code, 1, bad);
    assert.match(run.stderr, /turn_budget: must be a positive integer when present/u);
  }
});
