/**
 * Refusals print the next command (0.100.3).
 *
 * Real Work Loop transcripts showed agents that hit a refusal and then guessed
 * the fix: `worklog park` flags in four tries, `darius spec show`, a `.tracker`
 * path that does not exist. Now each exit-1 refusal of the Work Loop verbs ends
 * with the exact next command, and an unknown option or sub-verb prints the
 * usage or the nearest valid verbs. `--json` fields do not change. Every case
 * runs in a sandbox: never the real store.
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { NO_GIT } from "./helpers/git.ts";
import { darius, makeHost, makeWorkRepo, ok, removeHost, specText, type Run } from "./helpers/work-repo.ts";

const host = makeHost("darius-wl-refusals");
after(() => removeHost(host));
const repo = makeWorkRepo(host, "store", "refusals");
const gitRepo = makeWorkRepo(host, "git", "refusals-git");
const A1 = repo.alpha1;

/** The last non-empty line of a stream. */
function last(text: string): string {
  return text.trimEnd().split("\n").at(-1) ?? "";
}

/** The run refused with exit 1 and its last stderr line is `  next: ...` holding `command`. */
function refusedWithNext(run: Run, command: string, label: string): void {
  assert.equal(run.code, 1, `${label}: ${run.stdout}${run.stderr}`);
  const line = last(run.stderr);
  assert.ok(line.startsWith("  next: "), `${label}: the last line is not a next line: ${run.stderr}`);
  assert.ok(line.includes(command), `${label}: ${line}`);
}

test("no session id: the claim and release refusals give the session flag and the way out for the thread", { skip: NO_GIT }, () => {
  const claim = darius(host, ["claim", A1], repo.dir);
  refusedWithNext(claim, `darius claim ${A1} --session <id>   (or set CLAUDE_CODE_SESSION_ID and run the same command)`, "claim");
  assert.ok(claim.stderr.includes('to give up on the thread: darius worklog park <thread-id> --reason "<why>"'), claim.stderr);
  refusedWithNext(darius(host, ["release", A1], repo.dir), `darius release ${A1} --session <id>`, "release");
});

test("a held claim: claim and release refusals name the takeover and the force command; claim --json stays the same", { skip: NO_GIT }, () => {
  ok(host, ["claim", A1, "--session", "a"], repo.dir);
  const taken = darius(host, ["claim", A1, "--session", "b"], repo.dir);
  refusedWithNext(taken, `darius claim ${A1} --takeover --session b`, "claim held");
  const json = darius(host, ["claim", A1, "--session", "b", "--json"], repo.dir);
  assert.equal(json.code, 1);
  const body = JSON.parse(json.stdout);
  for (const field of ["action", "ref", "session", "heldBy", "heldOn", "ageMs"]) assert.ok(field in body, `claim --json keeps ${field}`);
  assert.equal(body.action, "refused");
  refusedWithNext(darius(host, ["release", A1, "--session", "b"], repo.dir), `darius release ${A1} --force --session b`, "release held");
  const next = darius(host, ["next", "--session", "b"], repo.dir);
  assert.equal(next.code, 0, "a free spec is still handed out");
  for (const spec of [repo.alpha2, repo.beta1]) ok(host, ["claim", spec, "--session", "a"], repo.dir);
  refusedWithNext(darius(host, ["next", "--session", "b"], repo.dir), "darius claim --list", "next all claimed");
  refusedWithNext(darius(host, ["worklog", "open", "M1-alpha", "--spec", A1, "--session", "b", "--message", "x"], repo.dir), "darius next", "open on a held spec");
  for (const spec of [A1, repo.alpha2, repo.beta1]) ok(host, ["release", spec, "--session", "a"], repo.dir);
});

test("a thread id that no worklog holds: every worklog verb points at the list command", { skip: NO_GIT }, () => {
  const list = "darius worklog list --active --json";
  refusedWithNext(darius(host, ["worklog", "append", "NOPE", "--section", "note", "--message", "x"], repo.dir), list, "append");
  refusedWithNext(darius(host, ["worklog", "close", "NOPE", "--status", "blocked"], repo.dir), list, "close");
  refusedWithNext(darius(host, ["worklog", "set-stage", "NOPE", "dispatched"], repo.dir), list, "set-stage");
  refusedWithNext(darius(host, ["worklog", "dispatch", "NOPE", "--agent", "general-purpose"], repo.dir), list, "dispatch");
  refusedWithNext(darius(host, ["worklog", "park", "NOPE", "--reason", "x"], repo.dir), list, "park");
  // The transcript case: the milestone slug passed as the thread id.
  refusedWithNext(darius(host, ["worklog", "park", "M1-alpha", "01XYZ-m1-alpha", "--reason", "x"], repo.dir), list, "park with a slug");
});

test("an unknown option prints the usage of the verb; an unknown spec verb names the nearest valid verbs", { skip: NO_GIT }, () => {
  const park = darius(host, ["worklog", "park", "T", "--message", "x"], repo.dir);
  assert.equal(park.code, 2);
  assert.match(park.stderr, /unknown option --message/u);
  assert.equal(last(park.stderr), '  usage: darius worklog park <thread-id> --reason "<why this work is being deferred>"');
  const spec = darius(host, ["spec", "show", A1], repo.dir);
  assert.equal(spec.code, 2);
  assert.ok(spec.stderr.includes('spec: unknown verb "show"'), spec.stderr);
  assert.ok(spec.stderr.includes("darius spec check <spec> [--json]"), spec.stderr);
  assert.ok(spec.stderr.includes("darius show <spec> [--json]"), spec.stderr);
});

test("an acting session that differs from this one is refused with the same command plus --as-other-session", { skip: NO_GIT }, () => {
  const run = darius(host, ["worklog", "open", "M1-alpha", "--session", "s2", "--message", "two words"], repo.dir, { CLAUDE_CODE_SESSION_ID: "s1" });
  refusedWithNext(run, 'darius worklog open M1-alpha --session s2 --message "two words" --as-other-session', "session mismatch");
});

test("stage refusals end with the stage or evidence command", { skip: NO_GIT }, () => {
  const thread = ok(host, ["worklog", "open", "M1-alpha", "--spec", repo.alpha2, "--message", "start", "--session", "s1"], repo.dir).trim();
  refusedWithNext(darius(host, ["worklog", "set-stage", thread, "committed"], repo.dir), `darius worklog set-stage ${thread} verified`, "skips verified");
  ok(host, ["worklog", "dispatch", thread, "--agent", "general-purpose", "--session", "s1"], repo.dir);
  refusedWithNext(darius(host, ["worklog", "close", thread, "--status", "done"], repo.dir), `darius worklog set-stage ${thread} verified`, "done too early");
  refusedWithNext(darius(host, ["worklog", "set-stage", thread, "verified"], repo.dir), `darius verify-item ${repo.alpha2} 0`, "no ledger line");
  refusedWithNext(darius(host, ["worklog", "set-stage", thread, "planned"], repo.dir), `darius worklog set-stage ${thread} verified`, "backward");
  writeFileSync(join(repo.dir, "out.txt"), "hello\n");
  ok(host, ["verify-item", repo.alpha2, "0"], repo.dir);
  ok(host, ["worklog", "set-stage", thread, "verified"], repo.dir);
  refusedWithNext(darius(host, ["worklog", "set-stage", thread, "committed"], repo.dir), `darius worklog append ${thread} --section artifact --message "<path>"`, "no artifacts");
  refusedWithNext(darius(host, ["worklog", "append", thread, "--section", "artifact", "--message", "*.ts"], repo.dir), `darius worklog append ${thread} --section artifact --message "<project-relative path>"`, "bad artifact");
  refusedWithNext(darius(host, ["worklog", "set-stage", thread, "reviewed"], repo.dir), `darius worklog set-stage ${thread} committed`, "skips committed");
  ok(host, ["worklog", "park", thread, "--reason", "test over"], repo.dir);
  const closed = darius(host, ["worklog", "set-stage", thread, "committed"], repo.dir);
  refusedWithNext(closed, `darius worklog open M1-alpha --spec ${repo.alpha2} --session <id>`, "closed thread");
});

test("mark and verify-item refusals end with the exact command", { skip: NO_GIT }, () => {
  rmSync(join(repo.dir, "out.txt"), { force: true });
  refusedWithNext(darius(host, ["verify-item", A1, "9"], repo.dir), `darius show ${A1} --json`, "task index");
  refusedWithNext(darius(host, ["mark", A1, "0", "--pending", "--evidence", "x"], repo.dir), `darius mark ${A1} 0 --pending`, "evidence on pending");
  refusedWithNext(darius(host, ["mark", A1, "0", "--verified", "--override", "cannot run"], repo.dir), `darius mark ${A1} 0 --verified --override "cannot run" --evidence`, "override without evidence");
  refusedWithNext(darius(host, ["verify-item", A1, "0"], repo.dir), `darius verify-item ${A1} 0`, "failed check");
  const noPair = join(repo.tree, "M1-alpha", "03-manual.md");
  writeFileSync(noPair, specText("Manual").replace("  - Command: `test -f out.txt`\n  - Expected: `exit 0`\n", ""));
  refusedWithNext(darius(host, ["verify-item", "M1-alpha/03-manual.md", "0"], repo.dir), 'darius mark M1-alpha/03-manual.md 0 --verified --evidence "', "no pair");
});

test("spec check lists its next command on a failing spec; the JSON has no new field", { skip: NO_GIT }, () => {
  const bad = join(repo.tree, "M1-alpha", "04-bad.md");
  writeFileSync(bad, specText("Bad").replace("  - Command: `test -f out.txt`\n  - Expected: `exit 0`\n", ""));
  const text = darius(host, ["spec", "check", "M1-alpha/04-bad.md"], repo.dir);
  assert.equal(text.code, 1);
  assert.equal(last(text.stdout), "next: fix the problems above, then run: darius spec check M1-alpha/04-bad.md");
  const json = JSON.parse(darius(host, ["spec", "check", "M1-alpha/04-bad.md", "--json"], repo.dir).stdout);
  assert.deepEqual(Object.keys(json).toSorted(), ["counsel", "ok", "problems", "reviewGate", "reviewRequired", "risk", "riskReasons"]);
});

test("counsel-gate with a missing spec or transcript names the tracker-relative form", { skip: NO_GIT }, () => {
  const override = darius(host, ["counsel-gate", "--spec", "M1-alpha/nope.md", "--override", "why"], repo.dir);
  assert.equal(override.code, 1);
  assert.ok(override.stderr.includes(`spec not found: M1-alpha/nope.md (tracker root ${repo.tree};`), override.stderr);
  mkdirSync(join(repo.tree, "_counsel"), { recursive: true });
  const transcript = darius(host, ["counsel-gate", "_counsel/none.md", "--spec", A1], repo.dir);
  assert.equal(transcript.code, 1);
  assert.ok(transcript.stderr.includes(`transcript not found: _counsel/none.md (tracker root ${repo.tree};`), transcript.stderr);
});

test("git mode: the same refusals end with a next command", { skip: NO_GIT }, () => {
  refusedWithNext(darius(host, ["claim", gitRepo.alpha1], gitRepo.dir), `darius claim ${gitRepo.alpha1} --session <id>`, "git claim");
  refusedWithNext(darius(host, ["worklog", "close", "NOPE", "--status", "blocked"], gitRepo.dir), "darius worklog list --active --json", "git close");
  refusedWithNext(darius(host, ["verify-item", gitRepo.alpha1, "9"], gitRepo.dir), `darius show ${gitRepo.alpha1} --json`, "git task index");
});
