/**
 * `darius run answer <run> --answer N=TEXT ...` (0.80.0): src/cli/run.ts,
 * src/runner/hold.ts, and `viewRun` for the numbers of the current hold. All
 * answers or none under one lock; a number of an earlier hold is refused with
 * exit 2; the old positional form stays. The web endpoint that calls it is
 * covered in test/action-api.test.ts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs } from "../src/cli/args.ts";
import type { Command, ParsedArgs } from "../src/cli/registry.ts";
import { ritualCommand } from "../src/cli/ritual.ts";
import { runCommand } from "../src/cli/run.ts";
import { appendLine, hostId, readLedger } from "../src/core/ledger.ts";
import { UsageError, type LedgerLine } from "../src/core/model.ts";
import { openProject } from "../src/core/store.ts";
import { answerRunMany } from "../src/runner/hold.ts";
import { viewRun } from "../src/runner/run-due.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-run-answer-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");

interface CliRun {
  code: number;
  stdout: string;
}

async function runCli(command: Command, project: string, argv: string[]): Promise<CliRun> {
  const args: ParsedArgs = parseArgs([...argv, "--project", project]);
  const out: string[] = [];
  const { log } = console;
  console.log = (...parts: string[]) => out.push(parts.join(" "));
  try {
    const code = await command.run(args);
    return { code, stdout: out.join("\n") };
  } finally {
    console.log = log;
  }
}

/** A running run of a new ritual, held with these questions. */
async function heldRun(project: string, questions: string[]): Promise<string> {
  const added = await runCli(ritualCommand, project, ["add", "heartbeat", "--title", "Heartbeat", "--cadence", "1d"]);
  assert.equal(added.code, 0, added.stdout);
  const started = await runCli(runCommand, project, ["start", "heartbeat", "--json"]);
  const run: string = JSON.parse(started.stdout).run;
  await hold(project, run, questions);
  return run;
}

async function hold(project: string, run: string, questions: string[]): Promise<void> {
  const held = await runCli(runCommand, project, ["hold", run, ...questions.flatMap((question) => ["--question", question])]);
  assert.equal(held.code, 0, held.stdout);
}

function answeredOf(project: string, run: string): LedgerLine[] {
  return readLedger(openProject(project)).filter((line) => line.type === "run.answered" && line.run === run);
}

test("run answer --answer writes every answer, in the order given, and the run can be resumed", async () => {
  const project = "ra2-write";
  const run = await heldRun(project, ["Push?", "Which branch?", "Tag it?"]);
  const done = await runCli(runCommand, project, ["answer", run, "--answer", "1=yes", "--answer", "3= later ", "--who", "web:owner", "--json"]);
  assert.equal(done.code, 0, done.stdout);
  assert.deepEqual(JSON.parse(done.stdout), { ok: true, run, answers: [{ n: 1, text: "yes" }, { n: 3, text: "later" }] });
  const lines = answeredOf(project, run);
  assert.deepEqual(lines.map((line) => [line.n, line.text, line.who]), [[1, "yes", "web:owner"], [3, "later", "web:owner"]]);
  const view = viewRun(readLedger(openProject(project)), run);
  assert.equal(view.isAnswered, true, "an answer since the hold: resume may go");
  assert.equal(view.phase, "held");
  const plain = await runCli(runCommand, project, ["answer", run, "--answer", "2=main"]);
  assert.equal(plain.stdout, `✓ answered 1 question(s) on run ${run}`);
});

test("run answer --answer text may start with -- and holds = and spaces; it is one argv word", async () => {
  const project = "ra2-dash";
  const run = await heldRun(project, ["Which flag?"]);
  const done = await runCli(runCommand, project, ["answer", run, "--answer", "1=--force and a=b"]);
  assert.equal(done.code, 0, done.stdout);
  assert.equal(answeredOf(project, run)[0]?.text, "--force and a=b");
});

test("all or none: one number outside the hold, one repeat or one bad text writes nothing", async () => {
  const project = "ra2-none";
  const run = await heldRun(project, ["One?", "Two?"]);
  for (const flags of [["1=fine", "3=nope"], ["1=fine", "0=nope"], ["1=fine", "1=again"], ["1=fine", "2="], ["1=fine", `2=${"x".repeat(501)}`], ["1=fine", "2=a\u0007b"]]) {
    await assert.rejects(runCli(runCommand, project, ["answer", run, ...flags.flatMap((one) => ["--answer", one])]), UsageError, flags.join(" "));
  }
  assert.deepEqual(answeredOf(project, run), [], "the good answer 1 was not written either");
  // The check inside the lock: a number past the hold is refused after the flags parsed fine.
  const refused = answerRunMany(openProject(project), { run, who: "t", answers: [{ n: 1, text: "fine" }, { n: 7, text: "nope" }] });
  assert.match(refused ?? "", /there is no question 7 to answer now/u);
  assert.deepEqual(answeredOf(project, run), []);
});

test("only the questions of the current hold can be answered: an earlier hold's number is exit 2, the new numbers run on", async () => {
  const project = "ra2-hold";
  const run = await heldRun(project, ["Old one?", "Old two?"]);
  assert.equal((await runCli(runCommand, project, ["answer", run, "--answer", "1=yes"])).code, 0);
  appendLine(openProject(project), { who: "timer", type: "run.resumed", item: "ritual/heartbeat", run, fresh: true });
  await hold(project, run, ["New one?", "New two?"]);
  const view = viewRun(readLedger(openProject(project)), run);
  assert.deepEqual([view.holdFrom, view.questions.length, view.isAnswered], [2, 4, false]);

  await assert.rejects(runCli(runCommand, project, ["answer", run, "--answer", "1=too late"]), /held with question 3 to 4; there is no question 1 to answer now/u);
  await assert.rejects(runCli(runCommand, project, ["answer", run, "--answer", "3=ok", "--answer", "2=old"]), UsageError);
  assert.equal(answeredOf(project, run).length, 1, "only the first hold's answer is there");
  assert.equal((await runCli(runCommand, project, ["answer", run, "--answer", "4=second"])).code, 0);
  assert.equal(viewRun(readLedger(openProject(project)), run).isAnswered, true);
  // The old positional form is unchanged: it still takes any question of the run.
  assert.equal((await runCli(runCommand, project, ["answer", run, "1", "still", "allowed"])).code, 0);
  assert.equal(answeredOf(project, run).at(-1)?.text, "still allowed");
});

test("a run that is not held, an unknown run and a mixed call are refused", async () => {
  const project = "ra2-refuse";
  const added = await runCli(ritualCommand, project, ["add", "heartbeat", "--title", "Heartbeat", "--cadence", "1d"]);
  assert.equal(added.code, 0);
  const started = await runCli(runCommand, project, ["start", "heartbeat", "--json"]);
  const run: string = JSON.parse(started.stdout).run;
  await assert.rejects(runCli(runCommand, project, ["answer", run, "--answer", "1=yes"]), /is not held \(phase: running\)/u);
  await assert.rejects(runCli(runCommand, project, ["answer", "01JNOSUCHRUN0000000000000A", "--answer", "1=yes"]), /no run '01JNOSUCHRUN0000000000000A'/u);
  await hold(project, run, ["One?"]);
  await assert.rejects(runCli(runCommand, project, ["answer", run, "1", "text", "--answer", "1=yes"]), /not both/u);
  assert.deepEqual(answeredOf(project, run), []);
  const done = await runCli(runCommand, project, ["complete", run, "--outcome", "abandoned"]);
  assert.equal(done.code, 0, done.stdout);
  await assert.rejects(runCli(runCommand, project, ["answer", run, "--answer", "1=yes"]), /is not held \(phase: closed\)/u);
});

test("--on this host runs here; the real CLI exits 2 for a usage error, 0 for an answer", async () => {
  const project = "ra2-exit";
  const run = await heldRun(project, ["One?"]);
  const here = await runCli(runCommand, project, ["answer", run, "--answer", "1=yes", "--on", hostId()]);
  assert.equal(here.code, 0, here.stdout);
  assert.equal(answeredOf(project, run).length, 1);
  const darius = (...argv: string[]): number | null =>
    spawnSync(join(import.meta.dirname, "..", "bin", "darius"), ["run", "answer", run, "--project", project, ...argv], { env: process.env, encoding: "utf8" }).status;
  assert.equal(darius("--answer", "9=nope"), 2);
  assert.equal(darius("--answer", "one"), 2);
  assert.equal(darius("--answer", "1=changed"), 0);
});

test("a hold that is answered but not resumed takes answers again, and the latest per question wins: the retry path after a refused resume", async () => {
  const project = "ra2-retry";
  const run = await heldRun(project, ["One?", "Two?"]);
  assert.equal((await runCli(runCommand, project, ["answer", run, "--answer", "1=first"])).code, 0);
  assert.equal(viewRun(readLedger(openProject(project)), run).isAnswered, true, "answered, not resumed");
  assert.equal((await runCli(runCommand, project, ["answer", run, "--answer", "1=second", "--answer", "2=extra"])).code, 0);
  const view = viewRun(readLedger(openProject(project)), run);
  assert.deepEqual([...view.answers], [[1, "second"], [2, "extra"]]);
  assert.equal(answeredOf(project, run).length, 3, "every line is kept in the ledger");
});

test("a current hold with no question has its own sentence; the checks run before any line is written", async () => {
  const project = "ra2-empty";
  const run = await heldRun(project, ["One?"]);
  appendLine(openProject(project), { who: "timer", type: "run.resumed", item: "ritual/heartbeat", run, fresh: true });
  appendLine(openProject(project), { who: "claude:1", type: "run.held", item: "ritual/heartbeat", run, questions: [] });
  await assert.rejects(runCli(runCommand, project, ["answer", run, "--answer", "1=yes"]), new RegExp(`run '${run}' is held with no open question`, "u"));
  assert.deepEqual(answeredOf(project, run), []);
});
