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

/** Flags that skip a gate. A `next:` line must never hold one. */
const BYPASS = /--(?:force|takeover|as-other-session|override|skip-commit-first|skip-verify-check)\b/u;

/** Every `next:` line any run of this file printed, to scan at the end. */
const seen: string[] = [];

/** Runs the CLI and records the `next:` lines of its output. */
function d(at: Parameters<typeof darius>[0], argv: string[], cwd: string, extraEnv: Record<string, string | undefined> = {}): Run {
  const run = darius(at, argv, cwd, extraEnv);
  for (const line of `${run.stdout}\n${run.stderr}`.split("\n")) if (/^\s*next: /u.test(line)) seen.push(line.trim());
  return run;
}

/**
 * The run refused with exit 1; a `  next: ...` line holds `command`; only
 * `  only if ...` lines may follow it (a bypass goes there, never on the next line).
 */
function refusedWithNext(run: Run, command: string, label: string): void {
  assert.equal(run.code, 1, `${label}: ${run.stdout}${run.stderr}`);
  const lines = run.stderr.trimEnd().split("\n");
  const at = lines.findLastIndex((line) => line.startsWith("  next: "));
  assert.ok(at >= 0, `${label}: no next line: ${run.stderr}`);
  const line = lines[at] ?? "";
  assert.ok(line.includes(command), `${label}: ${line}`);
  for (const extra of lines.slice(at + 1)) assert.match(extra, /^ {2}only if /u, `${label}: only an "only if" line may follow the next line: ${run.stderr}`);
}

/** The refusal has a separate `  only if ...: <command>` line holding `command`. */
function onlyIf(run: Run, command: string, label: string): void {
  const line = run.stderr.split("\n").find((candidate) => /^ {2}only if /u.test(candidate) && candidate.includes(command));
  assert.ok(line !== undefined, `${label}: no "only if" line with ${command}: ${run.stderr}`);
}

test("no session id: the claim and release refusals give the session flag and the way out for the thread", { skip: NO_GIT }, () => {
  const claim = d(host, ["claim", A1], repo.dir);
  refusedWithNext(claim, `darius claim ${A1} --session <id>   (or set CLAUDE_CODE_SESSION_ID and run the same command)`, "claim");
  assert.ok(claim.stderr.includes('to give up on the thread: darius worklog park <thread-id> --reason "<why>"'), claim.stderr);
  refusedWithNext(d(host, ["release", A1], repo.dir), `darius release ${A1} --session <id>`, "release");
});

test("a held claim: claim and release refusals name the takeover and the force command; claim --json stays the same", { skip: NO_GIT }, () => {
  ok(host, ["claim", A1, "--session", "a"], repo.dir);
  const taken = d(host, ["claim", A1, "--session", "b"], repo.dir);
  refusedWithNext(taken, "darius next", "claim held");
  onlyIf(taken, `darius claim ${A1} --takeover --session b`, "claim held");
  const json = d(host, ["claim", A1, "--session", "b", "--json"], repo.dir);
  assert.equal(json.code, 1);
  const body = JSON.parse(json.stdout);
  for (const field of ["action", "ref", "session", "heldBy", "heldOn", "ageMs"]) assert.ok(field in body, `claim --json keeps ${field}`);
  assert.equal(body.action, "refused");
  const released = d(host, ["release", A1, "--session", "b"], repo.dir);
  refusedWithNext(released, "darius claim --list", "release held");
  onlyIf(released, `darius release ${A1} --force --session b`, "release held");
  const next = d(host, ["next", "--session", "b"], repo.dir);
  assert.equal(next.code, 0, "a free spec is still handed out");
  for (const spec of [repo.alpha2, repo.beta1]) ok(host, ["claim", spec, "--session", "a"], repo.dir);
  const allClaimed = d(host, ["next", "--session", "b"], repo.dir);
  refusedWithNext(allClaimed, "darius claim --list", "next all claimed");
  onlyIf(allClaimed, "darius next --force", "next all claimed");
  const held = d(host, ["worklog", "open", "M1-alpha", "--spec", A1, "--session", "b", "--message", "x"], repo.dir);
  refusedWithNext(held, "darius next", "open on a held spec");
  onlyIf(held, "--takeover", "open on a held spec");
  for (const spec of [A1, repo.alpha2, repo.beta1]) ok(host, ["release", spec, "--session", "a"], repo.dir);
});

test("a thread id that no worklog holds: every worklog verb points at the list command", { skip: NO_GIT }, () => {
  const list = "darius worklog list --active --json";
  refusedWithNext(d(host, ["worklog", "append", "NOPE", "--section", "note", "--message", "x"], repo.dir), list, "append");
  refusedWithNext(d(host, ["worklog", "close", "NOPE", "--status", "blocked"], repo.dir), list, "close");
  refusedWithNext(d(host, ["worklog", "set-stage", "NOPE", "dispatched"], repo.dir), list, "set-stage");
  refusedWithNext(d(host, ["worklog", "dispatch", "NOPE", "--agent", "general-purpose"], repo.dir), list, "dispatch");
  refusedWithNext(d(host, ["worklog", "park", "NOPE", "--reason", "x"], repo.dir), list, "park");
  // The transcript case: the milestone slug passed as the thread id.
  refusedWithNext(d(host, ["worklog", "park", "M1-alpha", "01XYZ-m1-alpha", "--reason", "x"], repo.dir), list, "park with a slug");
});

test("an unknown option prints the usage of the verb; an unknown spec verb names the nearest valid verbs", { skip: NO_GIT }, () => {
  const park = d(host, ["worklog", "park", "T", "--message", "x"], repo.dir);
  assert.equal(park.code, 2);
  assert.match(park.stderr, /unknown option --message/u);
  assert.equal(last(park.stderr), '  usage: darius worklog park <thread-id> --reason "<why this work is being deferred>"');
  const spec = d(host, ["spec", "show", A1], repo.dir);
  assert.equal(spec.code, 2);
  assert.ok(spec.stderr.includes('spec: unknown verb "show"'), spec.stderr);
  assert.ok(spec.stderr.includes("darius spec check <spec> [--json]"), spec.stderr);
  assert.ok(spec.stderr.includes("darius show <spec> [--json]"), spec.stderr);
});

test("an acting session that differs from this one is refused with the same command plus --as-other-session", { skip: NO_GIT }, () => {
  const run = d(host, ["worklog", "open", "M1-alpha", "--session", "s2", "--message", "two words"], repo.dir, { CLAUDE_CODE_SESSION_ID: "s1" });
  refusedWithNext(run, "run the same command without --session", "session mismatch");
  onlyIf(run, 'darius worklog open M1-alpha --session s2 --message "two words" --as-other-session', "session mismatch");
});

test("stage refusals end with the stage or evidence command", { skip: NO_GIT }, () => {
  const thread = ok(host, ["worklog", "open", "M1-alpha", "--spec", repo.alpha2, "--message", "start", "--session", "s1"], repo.dir).trim();
  refusedWithNext(d(host, ["worklog", "set-stage", thread, "committed"], repo.dir), `darius worklog set-stage ${thread} verified`, "skips verified");
  ok(host, ["worklog", "dispatch", thread, "--agent", "general-purpose", "--session", "s1"], repo.dir);
  refusedWithNext(d(host, ["worklog", "close", thread, "--status", "done"], repo.dir), `darius worklog set-stage ${thread} verified`, "done too early");
  refusedWithNext(d(host, ["worklog", "set-stage", thread, "verified"], repo.dir), `darius verify-item ${repo.alpha2} 0`, "no ledger line");
  refusedWithNext(d(host, ["worklog", "set-stage", thread, "planned"], repo.dir), `darius worklog set-stage ${thread} verified`, "backward");
  writeFileSync(join(repo.dir, "out.txt"), "hello\n");
  ok(host, ["verify-item", repo.alpha2, "0"], repo.dir);
  ok(host, ["worklog", "set-stage", thread, "verified"], repo.dir);
  refusedWithNext(d(host, ["worklog", "set-stage", thread, "committed"], repo.dir), `darius worklog append ${thread} --section artifact --message "<path>"`, "no artifacts");
  refusedWithNext(d(host, ["worklog", "append", thread, "--section", "artifact", "--message", "*.ts"], repo.dir), `darius worklog append ${thread} --section artifact --message "<project-relative path>"`, "bad artifact");
  refusedWithNext(d(host, ["worklog", "set-stage", thread, "reviewed"], repo.dir), `darius worklog set-stage ${thread} committed`, "skips committed");
  ok(host, ["worklog", "park", thread, "--reason", "test over"], repo.dir);
  const closed = d(host, ["worklog", "set-stage", thread, "committed"], repo.dir);
  refusedWithNext(closed, `darius worklog open M1-alpha --spec ${repo.alpha2} --session <id>`, "closed thread");
});

test("mark and verify-item refusals end with the exact command", { skip: NO_GIT }, () => {
  rmSync(join(repo.dir, "out.txt"), { force: true });
  refusedWithNext(d(host, ["verify-item", A1, "9"], repo.dir), `darius show ${A1} --json`, "task index");
  refusedWithNext(d(host, ["mark", A1, "0", "--pending", "--evidence", "x"], repo.dir), `darius mark ${A1} 0 --pending`, "evidence on pending");
  const noEvidence = d(host, ["mark", A1, "0", "--verified", "--override", "cannot run"], repo.dir);
  refusedWithNext(noEvidence, `darius verify-item ${A1} 0`, "override without evidence");
  onlyIf(noEvidence, `darius mark ${A1} 0 --verified --override "cannot run" --evidence`, "override without evidence");
  const runnable = d(host, ["mark", A1, "0", "--verified"], repo.dir);
  refusedWithNext(runnable, `darius verify-item ${A1} 0`, "mark on a runnable check");
  assert.ok(runnable.stderr.includes("only if the check cannot run here (no network, missing service): darius mark"), runnable.stderr);
  refusedWithNext(d(host, ["verify-item", A1, "0"], repo.dir), `darius verify-item ${A1} 0`, "failed check");
  const noPair = join(repo.tree, "M1-alpha", "03-manual.md");
  writeFileSync(noPair, specText("Manual").replace("  - Command: `test -f out.txt`\n  - Expected: `exit 0`\n", ""));
  refusedWithNext(d(host, ["verify-item", "M1-alpha/03-manual.md", "0"], repo.dir), 'darius mark M1-alpha/03-manual.md 0 --verified --evidence "', "no pair");
});

test("spec check lists its next command on a failing spec; the JSON has no new field", { skip: NO_GIT }, () => {
  const bad = join(repo.tree, "M1-alpha", "04-bad.md");
  writeFileSync(bad, specText("Bad").replace("  - Command: `test -f out.txt`\n  - Expected: `exit 0`\n", ""));
  const text = d(host, ["spec", "check", "M1-alpha/04-bad.md"], repo.dir);
  assert.equal(text.code, 1);
  assert.equal(last(text.stdout), "next: fix the problems above, then run: darius spec check M1-alpha/04-bad.md");
  const json = JSON.parse(d(host, ["spec", "check", "M1-alpha/04-bad.md", "--json"], repo.dir).stdout);
  assert.deepEqual(Object.keys(json).toSorted(), ["counsel", "ok", "problems", "reviewGate", "reviewRequired", "risk", "riskReasons"]);
});

test("counsel-gate with a missing spec or transcript names the tracker-relative form", { skip: NO_GIT }, () => {
  const override = d(host, ["counsel-gate", "--spec", "M1-alpha/nope.md", "--override", "why"], repo.dir);
  assert.equal(override.code, 1);
  assert.ok(override.stderr.includes(`spec not found: M1-alpha/nope.md (tracker root ${repo.tree};`), override.stderr);
  mkdirSync(join(repo.tree, "_counsel"), { recursive: true });
  const transcript = d(host, ["counsel-gate", "_counsel/none.md", "--spec", A1], repo.dir);
  assert.equal(transcript.code, 1);
  assert.ok(transcript.stderr.includes(`transcript not found: _counsel/none.md (tracker root ${repo.tree};`), transcript.stderr);
});

test("git mode: the same refusals end with a next command", { skip: NO_GIT }, () => {
  refusedWithNext(d(host, ["claim", gitRepo.alpha1], gitRepo.dir), `darius claim ${gitRepo.alpha1} --session <id>`, "git claim");
  refusedWithNext(d(host, ["worklog", "close", "NOPE", "--status", "blocked"], gitRepo.dir), "darius worklog list --active --json", "git close");
  refusedWithNext(d(host, ["verify-item", gitRepo.alpha1, "9"], gitRepo.dir), `darius show ${gitRepo.alpha1} --json`, "git task index");
});

test("no next line holds a gate bypass flag; a bypass sits on an \"only if\" line", { skip: NO_GIT }, () => {
  assert.ok(seen.length >= 20, `the scan saw only ${String(seen.length)} next lines`);
  for (const line of seen) assert.equal(BYPASS.test(line), false, `a bypass flag on a next line: ${line}`);
  // The stage refusals print theirs from the library; scan those too.
  const thread = ok(host, ["worklog", "open", "M1-alpha", "--message", "no spec", "--session", "s9"], repo.dir).trim();
  const noSpec = d(host, ["worklog", "set-stage", thread, "verified"], repo.dir);
  refusedWithNext(noSpec, `darius worklog park ${thread} --reason "<why>"`, "verified with no spec");
  onlyIf(noSpec, "verified --force --reason", "verified with no spec");
  const forceNoReason = d(host, ["worklog", "set-stage", thread, "verified", "--force"], repo.dir);
  assert.equal(forceNoReason.code, 2, "a missing --reason is usage, exit 2");
});
