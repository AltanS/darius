/**
 * `darius run ack --answer N=TEXT` and `darius run ack-earlier` (0.80.0):
 * src/cli/run.ts, src/runner/hold.ts, src/core/answers.ts. What the ack
 * lines hold and which calls are refused. Delivery to the next run is in
 * test/handoff-answers.test.ts.
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
import { ANSWER_MAX, noteFromAnswers, parseAnswerFlags, readAnswers } from "../src/core/answers.ts";
import { readLedger } from "../src/core/ledger.ts";
import { UsageError, type LedgerLine } from "../src/core/model.ts";
import { openProject } from "../src/core/store.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-run-ack-answers-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");

interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(command: Command, project: string, argv: string[], stdin?: string): Promise<CliRun> {
  const args: ParsedArgs = parseArgs([...argv, "--project", project]);
  if (stdin !== undefined) args.stdin = stdin;
  const out: string[] = [];
  const err: string[] = [];
  const { log, error } = console;
  console.log = (...parts: string[]) => out.push(parts.join(" "));
  console.error = (...parts: string[]) => err.push(parts.join(" "));
  try {
    const code = await command.run(args);
    return { code, stdout: out.join("\n"), stderr: err.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}

async function addRitual(project: string, slug: string): Promise<void> {
  const added = await runCli(ritualCommand, project, ["add", slug, "--title", slug, "--cadence", "1d"]);
  assert.equal(added.code, 0, added.stderr);
}

async function start(project: string, slug: string): Promise<string> {
  const started = await runCli(runCommand, project, ["start", slug, "--json"]);
  assert.equal(started.code, 0, started.stdout);
  return JSON.parse(started.stdout).run;
}

/** A started run of `slug`, completed complete with `count` questions (none: a result with no question). */
async function askingRun(project: string, slug: string, count: number): Promise<string> {
  const run = await start(project, slug);
  const questions = Array.from({ length: count }, (_, index) => ({ text: `Question ${String(index + 1)}?` }));
  const block = JSON.stringify({ v: 1, status: count > 0 ? "attention" : "ok", summary: "checked", questions });
  const done = await runCli(runCommand, project, ["complete", run, "--outcome", "complete", "--findings-stdin"], `done\n\`\`\`darius-result\n${block}\n\`\`\`\n`);
  assert.equal(done.code, 0, done.stdout);
  return run;
}

function acksOf(project: string): LedgerLine[] {
  return readLedger(openProject(project)).filter((line) => line.type === "run.acknowledged");
}

// --- ack --answer ----------------------------------------------------------------

test("run ack --answer writes answers and carry; the note is built from them and marked", async () => {
  const project = "ra-write";
  await addRitual(project, "heartbeat");
  const run = await askingRun(project, "heartbeat", 3);

  const acked = await runCli(runCommand, project, ["ack", run, "--answer", "1=yes, delete it", "--answer", "3=  later  ", "--who", "web:owner", "--json"]);
  assert.equal(acked.code, 0, acked.stdout);
  const reply = JSON.parse(acked.stdout);
  assert.deepEqual(reply, {
    ok: true,
    run,
    outcome: "complete",
    note: null,
    answers: [
      { n: 1, text: "yes, delete it" },
      { n: 3, text: "later" },
    ],
  });
  const [line] = acksOf(project);
  assert.deepEqual(line?.answers, [{ n: 1, text: "yes, delete it" }, { n: 3, text: "later" }], "an ack may leave a question empty");
  assert.equal(line?.carry, true);
  assert.equal(line?.note, "Q1: yes, delete it; Q3: later", "an answer-only ack also writes a note, for 0.79.x");
  assert.equal(line?.note_from_answers, true);
  assert.equal(line?.who, "web:owner");
});

test("run ack --answer splits at the first = and keeps the rest; --answer=N=TEXT works", async () => {
  const project = "ra-split";
  await addRitual(project, "heartbeat");
  const run = await askingRun(project, "heartbeat", 1);
  const acked = await runCli(runCommand, project, ["ack", run, "--answer=1=set a=b, then c"]);
  assert.equal(acked.code, 0, acked.stdout);
  assert.equal(acked.stdout, `✓ acknowledged run ${run} (complete), 1 answer(s)`);
  assert.deepEqual(acksOf(project)[0]?.answers, [{ n: 1, text: "set a=b, then c" }]);
});

test("run ack --answer with --note keeps the note as written and adds no note_from_answers", async () => {
  const project = "ra-note";
  await addRitual(project, "heartbeat");
  const run = await askingRun(project, "heartbeat", 2);
  const acked = await runCli(runCommand, project, ["ack", run, "--answer", "2=no", "--note", "Both only for this week.", "--json"]);
  assert.equal(JSON.parse(acked.stdout).note, "Both only for this week.");
  const [line] = acksOf(project);
  assert.equal(line?.note, "Both only for this week.");
  assert.equal(line?.note_from_answers, undefined);
  assert.deepEqual(line?.answers, [{ n: 2, text: "no" }]);
});

test("a bare run ack still works: no answers field, carry set, the old JSON fields plus answers: []", async () => {
  const project = "ra-bare";
  await addRitual(project, "heartbeat");
  const run = await askingRun(project, "heartbeat", 1);
  const acked = await runCli(runCommand, project, ["ack", run, "--json"]);
  assert.equal(acked.code, 0);
  assert.deepEqual(JSON.parse(acked.stdout), { ok: true, run, outcome: "complete", note: null, answers: [] });
  const [line] = acksOf(project);
  assert.equal(line?.answers, undefined);
  assert.equal(line?.note, undefined);
  assert.equal(line?.carry, true);
  const again = await runCli(runCommand, project, ["ack", run, "--answer", "1=late", "--json"]);
  assert.equal(again.code, 1, "a second ack is a refusal, not a usage error");
  assert.match(JSON.parse(again.stdout).error, /already acknowledged/u);
  assert.equal(acksOf(project).length, 1);
});

test("run ack --answer: a bad number, a duplicate, a number past the question count and a bad text are usage errors", async () => {
  const project = "ra-usage";
  await addRitual(project, "heartbeat");
  const run = await askingRun(project, "heartbeat", 2);
  const bad: ReadonlyArray<readonly [string[], RegExp]> = [
    [["--answer", "x=yes"], /N must be a positive whole number/u],
    [["--answer", "0=yes"], /N must be a positive whole number/u],
    [["--answer", "-1=yes"], /N must be a positive whole number/u],
    [["--answer", "1.5=yes"], /N must be a positive whole number/u],
    [["--answer", "=yes"], /N must be a positive whole number/u],
    [["--answer", "yes"], /needs N=TEXT/u],
    [["--answer", "1=yes", "--answer", "1=no"], /question 1 is answered twice/u],
    [["--answer", "3=yes"], /has 2 question\(s\); there is no question 3/u],
    [["--answer", "1=   "], /the text is empty/u],
    [["--answer", "1=two\nlines"], /one line/u],
    [["--answer", "1=bell\u0007"], /one line/u],
    [["--answer", `1=${"x".repeat(ANSWER_MAX + 1)}`], /at most 500 fit/u],
  ];
  for (const [argv, reason] of bad) {
    const refused = await runCli(runCommand, project, ["ack", run, ...argv]).then(
      () => null,
      (error: Error) => error,
    );
    assert.ok(refused instanceof UsageError, `${argv.join(" ")} is a usage error`);
    assert.match(refused.message, reason, argv.join(" "));
  }
  assert.equal(acksOf(project).length, 0, "no refusal writes a line");
  const fits = await runCli(runCommand, project, ["ack", run, "--answer", `2=${"y".repeat(ANSWER_MAX)}`]);
  assert.equal(fits.code, 0, "500 characters fit");
  assert.equal(String(acksOf(project)[0]?.note).length, ANSWER_MAX, "the built note is clipped to 500");
});

test("run ack --answer on a run that asked nothing is a usage error; a failed run still takes a note", async () => {
  const project = "ra-none";
  await addRitual(project, "heartbeat");
  const quiet = await askingRun(project, "heartbeat", 0);
  await assert.rejects(runCli(runCommand, project, ["ack", quiet, "--answer", "1=yes"]), /asked no questions/u);
  const failed = await start(project, "heartbeat");
  assert.equal((await runCli(runCommand, project, ["complete", failed, "--outcome", "failed"])).code, 0);
  await assert.rejects(runCli(runCommand, project, ["ack", failed, "--answer", "1=yes"]), UsageError);
  assert.equal((await runCli(runCommand, project, ["ack", failed, "--note", "known outage"])).code, 0);
  assert.equal(acksOf(project).length, 1);
});

test("the exit codes of run ack through the real CLI: 2 for a usage error, 1 for a refusal, 0 for an ack", async () => {
  const project = "ra-exit";
  await addRitual(project, "heartbeat");
  const run = await askingRun(project, "heartbeat", 1);
  const darius = (...argv: string[]): number | null =>
    spawnSync(join(import.meta.dirname, "..", "bin", "darius"), ["run", "ack", run, "--project", project, ...argv], { env: process.env, encoding: "utf8" }).status;
  assert.equal(darius("--answer", "9=nope"), 2);
  assert.equal(darius("--answer", "one"), 2);
  assert.equal(darius("--answer", "1=yes"), 0);
  assert.equal(darius("--answer", "1=again"), 1);
});

// --- ack-earlier -----------------------------------------------------------------

test("run ack-earlier acks only older, open, asking, complete runs of the same ritual, bare, with earlier_than", async () => {
  const project = "ra-earlier";
  await addRitual(project, "heartbeat");
  await addRitual(project, "other");
  const asked1 = await askingRun(project, "heartbeat", 1);
  const answered = await askingRun(project, "heartbeat", 2);
  assert.equal((await runCli(runCommand, project, ["ack", answered, "--answer", "1=yes"])).code, 0);
  const quiet = await askingRun(project, "heartbeat", 0);
  const failed = await start(project, "heartbeat");
  assert.equal((await runCli(runCommand, project, ["complete", failed, "--outcome", "failed"])).code, 0);
  const asked2 = await askingRun(project, "heartbeat", 1);
  const foreign = await askingRun(project, "other", 1);
  const newest = await askingRun(project, "heartbeat", 1);
  const later = await askingRun(project, "heartbeat", 1);

  const result = await runCli(runCommand, project, ["ack-earlier", newest, "--who", "web:owner", "--json"]);
  assert.equal(result.code, 0, result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, run: newest, acknowledged: [asked1, asked2] });

  const acks = acksOf(project);
  const mine = acks.filter((line) => line.earlier_than === newest);
  assert.deepEqual(mine.map((line) => line.run), [asked1, asked2]);
  for (const line of mine) {
    assert.equal(line.carry, true);
    assert.equal(line.who, "web:owner");
    assert.equal(line.note, undefined, "a bare ack");
    assert.equal(line.answers, undefined);
  }
  const ackedRuns = new Set(acks.map((line) => line.run));
  for (const untouched of [quiet, failed, foreign, newest, later]) assert.equal(ackedRuns.has(untouched), false, `${untouched} stays open`);
  assert.equal(acks.find((line) => line.run === answered)?.earlier_than, undefined, "the earlier answer is left as it was");

  const again = await runCli(runCommand, project, ["ack-earlier", newest, "--json"]);
  assert.equal(again.code, 0);
  assert.deepEqual(JSON.parse(again.stdout), { ok: true, run: newest, acknowledged: [] }, "nothing left to ack is exit 0 with an empty list");
  const oldest = await runCli(runCommand, project, ["ack-earlier", asked1]);
  assert.equal(oldest.code, 0);
  assert.equal(oldest.stdout, `✓ no earlier open asks before run ${asked1}`);
  const text = await runCli(runCommand, project, ["ack-earlier", later]);
  assert.equal(text.stdout, `✓ acknowledged 1 earlier ask(s): ${newest}`);
});

test("run ack-earlier needs a run, and an unknown run is a usage error", async () => {
  const project = "ra-earlier-usage";
  await addRitual(project, "heartbeat");
  await assert.rejects(runCli(runCommand, project, ["ack-earlier"]), /missing <run> id/u);
  await assert.rejects(runCli(runCommand, project, ["ack-earlier", "01UNKNOWNRUNID0000000000"]), UsageError);
});

// --- the helpers ---------------------------------------------------------------------

test("answers.ts: the note, the flag parser and the reader of an ack line", () => {
  assert.equal(noteFromAnswers([{ n: 1, text: "yes" }, { n: 2, text: "no" }]), "Q1: yes; Q2: no");
  assert.equal(noteFromAnswers([{ n: 1, text: "z".repeat(900) }]).length, ANSWER_MAX);
  assert.deepEqual(parseAnswerFlags(["2=b", "1=a"]), [{ n: 2, text: "b" }, { n: 1, text: "a" }]);
  assert.deepEqual(readAnswers(undefined), []);
  assert.deepEqual(readAnswers("text"), []);
  assert.deepEqual(readAnswers([{ n: 1, text: " ok " }, { n: 1, text: "twice" }, { n: 0, text: "zero" }, { n: 2 }, "junk", null]), [{ n: 1, text: "ok" }]);
});
