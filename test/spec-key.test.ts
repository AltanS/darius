/**
 * One spec key in git mode. `darius next --json` prints a spec tracker-relative
 * (`M1-alpha/01-spec-one.md`); a worklog thread may name it that way or as
 * `.tracker/M1-alpha/01-spec-one.md`. Every consumer must find the same
 * thread and the same ledger lines for both forms, whichever form the thread
 * stores and whichever form the caller types. Each case runs in a sandbox host.
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { commitAll, NO_GIT } from "./helpers/git.ts";
import { darius, makeHost, makeWorkRepo, removeHost, type Run, type WorkRepo } from "./helpers/work-repo.ts";

const host = makeHost("darius-spec-key");
after(() => removeHost(host));

const SESSION_ID = "sess-key";
const SESSION = { CLAUDE_CODE_SESSION_ID: SESSION_ID };

/** The spec of `makeWorkRepo` that `next` picks first, in the two forms a thread can name it. */
const FORMS = {
  tracker: "M1-alpha/01-spec-one.md",
  checkout: ".tracker/M1-alpha/01-spec-one.md",
} as const;
type Form = keyof typeof FORMS;
const FORM_NAMES: Form[] = ["tracker", "checkout"];

/** Every pairing of the form a thread stores and the form a caller types. */
const PAIRS: { stored: Form; typed: Form }[] = FORM_NAMES.flatMap((stored) => FORM_NAMES.map((typed) => ({ stored, typed })));

function run(repo: WorkRepo, argv: string[], input = ""): Run {
  return darius(host, argv, repo.dir, SESSION, input);
}

function okRun(repo: WorkRepo, argv: string[]): string {
  const result = run(repo, argv);
  assert.equal(result.code, 0, `darius ${argv.join(" ")}: ${result.stdout}${result.stderr}`);
  return result.stdout;
}

/** The parsed stdout of a verb that prints JSON. */
function jsonOf<T>(text: string): T {
  // SAFETY: the verbs' documented --json answers; each test reads the fields it asserts.
  return JSON.parse(text) as T;
}

/** A git-mode repo with the tracker committed, so the commit-first gate sees no debt. */
function gitRepo(name: string): WorkRepo {
  const repo = makeWorkRepo(host, "git", name);
  commitAll(repo.dir, "tracker");
  return repo;
}

/** Opens a thread on spec one, naming the spec the way `stored` says. Returns the thread id. */
function openThread(repo: WorkRepo, stored: Form): string {
  const id = okRun(repo, ["worklog", "open", "M1-alpha", "--spec", FORMS[stored], "--stage", "planned", "--session", SESSION_ID]).trim();
  assert.match(id, /-m1-alpha$/u);
  return id;
}

interface Listed {
  threadId: string;
  specPath?: string;
  stage?: string;
}

function activeThreads(repo: WorkRepo): Listed[] {
  return jsonOf<{ threads: Listed[] }>(okRun(repo, ["worklog", "list", "--active", "--json"])).threads;
}

interface Planned {
  status: string;
  opened: string[];
  tasks: { spec: string; threadId: string }[];
}

for (const { stored, typed } of PAIRS) {
  const label = `thread stores ${stored} form, caller types ${typed} form`;

  test(`legacy verbs find one thread and one ledger key (${label})`, { skip: NO_GIT }, () => {
    const repo = gitRepo(`legacy-${stored}-${typed}`);
    const threadId = openThread(repo, stored);
    const asTyped = FORMS[typed];

    // claim: one key whatever form is typed.
    okRun(repo, ["claim", asTyped, "--session", SESSION_ID]);
    const claims = jsonOf<{ ref: string }[]>(okRun(repo, ["claim", "--list", "--json"]));
    assert.deepEqual(
      claims.map((claim) => claim.ref),
      [FORMS.tracker],
    );

    // verify writes ledger lines under one key; set-stage verified reads them back.
    okRun(repo, ["worklog", "dispatch", threadId, "--agent", "main", "--reason", "test", "--session", SESSION_ID]);
    writeFileSync(join(repo.dir, "out.txt"), "done\n");
    okRun(repo, ["verify", asTyped]);
    const ledger = readFileSync(join(repo.tree, ".verification-log.jsonl"), "utf8").trim().split("\n");
    assert.ok(ledger.length > 0);
    for (const line of ledger) assert.equal(jsonOf<{ spec: string }>(line).spec, FORMS.checkout, line);
    const stage = run(repo, ["worklog", "set-stage", threadId, "verified"]);
    assert.equal(stage.code, 0, `${stage.stdout}${stage.stderr}`);

    // list: the stored form stays as stored; the thread is the same one.
    const listed = activeThreads(repo);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.threadId, threadId);
    assert.equal(listed[0]?.specPath, FORMS[stored]);
    assert.equal(listed[0]?.stage, "verified");

    // uncommitted-verified names the spec once, in the checkout form.
    const debt = jsonOf<{ path: string }[]>(okRun(repo, ["uncommitted-verified", "--json"]));
    assert.ok(debt.some((entry) => entry.path === FORMS.checkout), JSON.stringify(debt));

    // loop-check and hook-stop find the thread.
    const loop = run(repo, ["loop-check", "--json", "--session", SESSION_ID]);
    assert.equal(loop.code, 1, loop.stderr);
    const stuck = jsonOf<{ threads: Listed[] }>(loop.stdout).threads;
    assert.deepEqual(
      stuck.map((thread) => thread.threadId),
      [threadId],
    );
    assert.equal(stuck[0]?.specPath, FORMS[stored]);
    const payload = JSON.stringify({ hook_event_name: "Stop", session_id: SESSION_ID, cwd: repo.dir });
    const hook = run(repo, ["hook-stop"], payload);
    assert.equal(hook.code, 0, hook.stderr);
    assert.equal(jsonOf<{ decision: string; reason: string }>(hook.stdout).decision, "block");
    assert.ok(hook.stdout.includes(threadId), hook.stdout);
  });

  test(`work verbs reuse the thread and find its ledger lines (${label})`, { skip: NO_GIT }, () => {
    const repo = gitRepo(`work-${stored}-${typed}`);
    const threadId = openThread(repo, stored);
    const asTyped = FORMS[typed];

    // plan reuses the open thread and opens none.
    const planned = jsonOf<Planned>(okRun(repo, ["work", "plan", "--json"]));
    assert.equal(planned.status, "ready");
    assert.deepEqual(planned.opened, []);
    assert.equal(planned.tasks[0]?.threadId, threadId);
    assert.equal(activeThreads(repo).length, 1, "no second thread for the same spec");

    // verify: the ledger lookup behind set-stage verified.
    okRun(repo, ["worklog", "dispatch", threadId, "--agent", "main", "--reason", "test", "--session", SESSION_ID]);
    writeFileSync(join(repo.dir, "out.txt"), "done\n");
    const verified = run(repo, ["work", "verify", asTyped, "--thread", threadId, "--touched", "out.txt", "--json"]);
    assert.equal(verified.code, 0, `${verified.stdout}${verified.stderr}`);
    assert.equal(jsonOf<{ status: string }>(verified.stdout).status, "pass");

    // commit-check finds the same thread and the ledger lines for the trailer.
    const check = run(repo, ["work", "commit-check", asTyped, "--json"]);
    assert.equal(check.code, 0, `${check.stdout}${check.stderr}`);
    const answer = jsonOf<{ threads: { threadId: string | null; stage: string | null }[]; trailer: string }>(check.stdout);
    assert.equal(answer.threads[0]?.threadId, threadId);
    assert.equal(answer.threads[0]?.stage, "verified");
    assert.match(answer.trailer, /^Tracker: \S+01-spec-one\.md 0\/1 -> 1\/1 verified$/u);

    // The verified thread is debt, and it is found by its spec in either form.
    assert.equal(jsonOf<Planned>(okRun(repo, ["work", "plan", "--json"])).status, "commit_first");
    assert.equal(activeThreads(repo).length, 1);
  });
}

test("work plan opens a thread that a later plan and the legacy verbs find in both forms", { skip: NO_GIT }, () => {
  const repo = gitRepo("plan-opens");
  const first = jsonOf<Planned>(okRun(repo, ["work", "plan", "--json"]));
  assert.equal(first.opened.length, 1);
  const threadId = first.tasks[0]?.threadId ?? "";
  const second = jsonOf<Planned>(okRun(repo, ["work", "plan", "--json"]));
  assert.deepEqual(second.opened, []);
  assert.equal(second.tasks[0]?.threadId, threadId);
  assert.equal(activeThreads(repo).length, 1);

  // Whatever form the plan stored, a legacy set-stage verified reads the ledger.
  okRun(repo, ["worklog", "dispatch", threadId, "--agent", "main", "--reason", "test", "--session", SESSION_ID]);
  writeFileSync(join(repo.dir, "out.txt"), "done\n");
  okRun(repo, ["verify", FORMS.tracker]);
  okRun(repo, ["worklog", "set-stage", threadId, "verified"]);
  const listed = activeThreads(repo);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.stage, "verified");
});
