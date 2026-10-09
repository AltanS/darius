/**
 * Answers carried until used (0.80.0): src/core/handoff.ts, the writers in
 * src/runner/run-due.ts and src/cli/run.ts. Every answer or dismissal that
 * no completed run has read reaches the next run, with its question text,
 * and is delivered when a run that read it completes.
 *
 * The real `claude` is never started. DARIUS_CLAUDE points at a small fake
 * that completes, holds or does nothing, as in test/runner.test.ts. Runs
 * the test needs open or closed by hand use `darius run start|complete`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs } from "../src/cli/args.ts";
import type { Command } from "../src/cli/registry.ts";
import { ritualCommand } from "../src/cli/ritual.ts";
import { runCommand } from "../src/cli/run.ts";
import { appendLine, readLedger } from "../src/core/ledger.ts";
import { handoffLines, latestHandoff, type Handoff } from "../src/core/handoff.ts";
import { writeLink } from "../src/core/links.ts";
import type { LedgerLine, Policy, Ritual } from "../src/core/model.ts";
import { openProject } from "../src/core/store.ts";
import { ulid } from "../src/core/ulid.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-handoff-answers-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
delete process.env.DARIUS_PROJECT;
// Where the Claude adapter looks for a session to resume; never the operator's ~/.claude.
const CLAUDE_HOME = join(SANDBOX, "claude-home");
process.env.CLAUDE_CONFIG_DIR = CLAUDE_HOME;

const REPO = join(import.meta.dirname, "..");
const BIN = join(SANDBOX, "bin");
mkdirSync(BIN, { recursive: true });
symlinkSync(join(REPO, "bin", "darius"), join(BIN, "darius"));

/** bash by full path. The Nix build sandbox has no /usr/bin/env for a shebang to use. */
const BASH =
  (process.env.PATH ?? "")
    .split(":")
    .map((dir) => join(dir, "bash"))
    .find((candidate) => candidate.startsWith("/") && existsSync(candidate)) ?? "/bin/bash";

const FAKE_CLAUDE = join(BIN, "fake-claude");
writeFileSync(
  FAKE_CLAUDE,
  `#!${BASH}
set -euo pipefail
if [ "\${1:-}" = --version ]; then printf '2.1.999 (Claude Code)\\n'; exit 0; fi
case "\${FAKE_CLAUDE_MODE:-complete}" in
  complete)
    result="\${FAKE_CLAUDE_RESULT:-}"
    [ -n "$result" ] || result='{"v":1,"status":"ok","summary":"heartbeat ok"}'
    printf 'heartbeat ok\\n\`\`\`darius-result\\n%s\\n\`\`\`\\n' "$result" \\
      | darius run complete "$DARIUS_RUN" --project "$DARIUS_PROJECT" \\
      --outcome complete --findings-stdin --who claude:fake-session >/dev/null ;;
  hold)
    darius run hold "$DARIUS_RUN" --project "$DARIUS_PROJECT" --question "may I push?" --who claude:fake-session >/dev/null ;;
  silent) : ;;
esac
printf '{"type":"result","is_error":false,"session_id":"fake-session","total_cost_usd":0.0012,"result":"done"}\\n'
`,
);
chmodSync(FAKE_CLAUDE, 0o755);
process.env.DARIUS_CLAUDE = FAKE_CLAUDE;
// The fake's version has passed its gate check, so a run starts at once.
appendLine(openProject("_global", { create: true }), { who: "test", type: "harness.checked", harness: "claude", version: "2.1.999", outcome: "passed" });
process.env.DARIUS_HERDR = join(SANDBOX, "no-herdr");
process.env.PATH = `${BIN}:${process.env.PATH ?? ""}`;

const POLICY: Policy = { mode: "report", may: ["Bash(darius *)", "Bash(date)"], hold: ["git push", "rm -rf"], model: "haiku", max_turns: 6 };

function seedRitual(project: string, opts: { mode?: Policy["mode"] } = {}): void {
  const now = new Date().toISOString();
  const header: Ritual = {
    id: ulid(),
    kind: "ritual",
    slug: "heartbeat",
    title: "Heartbeat",
    created: now,
    updated: now,
    tags: [],
    cadence: "1d",
    anchor: "due",
    policy: { ...POLICY, mode: opts.mode ?? "report" },
  };
  openProject(project, { create: true }).writeItem({ header, body: "Run `darius --version` and `date`, then complete the run.\n" }, { who: "test" });
}

interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(command: Command, argv: string[], stdin?: string): Promise<CliRun> {
  const args = parseArgs(argv);
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

const run = (project: string, ...argv: string[]): Promise<CliRun> => runCli(runCommand, [...argv, "--project", project]);

function ledgerOf(project: string): LedgerLine[] {
  return readLedger(openProject(project));
}

function linesOf(project: string, type: string): LedgerLine[] {
  return ledgerOf(project).filter((line) => line.type === type);
}

function startedLine(project: string, id: string): LedgerLine | undefined {
  return linesOf(project, "run.started").find((line) => line.run === id);
}

function handoffOf(project: string, now?: Date): Handoff {
  const store = openProject(project);
  const handoff = latestHandoff(store, readLedger(store), "heartbeat", now);
  assert.ok(handoff !== null, "there is a handoff");
  return handoff;
}

function textOf(project: string, now?: Date): string {
  return handoffLines(handoffOf(project, now)).join("\n");
}

function promptOf(project: string, id: string): string {
  return readFileSync(join(openProject(project).root, "runs", id, "prompt.md"), "utf8");
}

/** Fields a test adds to the result block. */
interface BlockExtra {
  handoff?: string;
  questions?: { text: string; recommendation?: string; commands?: string[] }[];
}

function resultBlock(questions: number, extra: BlockExtra = {}): string {
  const list = Array.from({ length: questions }, (_, index) => ({ text: `Question ${String(index + 1)}?` }));
  return `done\n\`\`\`darius-result\n${JSON.stringify({ v: 1, status: questions > 0 ? "attention" : "ok", summary: "checked", questions: list, ...extra })}\n\`\`\`\n`;
}

/** A run started and completed by hand, with `questions` questions. Returns its id. */
async function handRun(project: string, questions: number, extra: BlockExtra = {}): Promise<string> {
  const started = await run(project, "start", "heartbeat", "--json");
  assert.equal(started.code, 0, started.stdout);
  const id: string = JSON.parse(started.stdout).run;
  const closed = await runCli(runCommand, ["complete", id, "--outcome", "complete", "--findings-stdin", "--project", project], resultBlock(questions, extra));
  assert.equal(closed.code, 0, closed.stdout);
  return id;
}

/** `darius run now heartbeat`: a launched run, which ends before this returns. */
async function runNow(project: string): Promise<string> {
  const now = await run(project, "now", "heartbeat", "--json");
  const entry = JSON.parse(now.stdout).projects[0].rituals[0];
  assert.equal(entry.action, "started", now.stdout);
  return entry.run;
}

function mode(value: "complete" | "hold" | "silent", questions?: number): void {
  process.env.FAKE_CLAUDE_MODE = value;
  if (questions === undefined) delete process.env.FAKE_CLAUDE_RESULT;
  else process.env.FAKE_CLAUDE_RESULT = JSON.stringify({ v: 1, status: "attention", summary: "asks", questions: Array.from({ length: questions }, (_, index) => ({ text: `Question ${String(index + 1)}?` })) });
}

async function ack(project: string, id: string, ...argv: string[]): Promise<string> {
  const acked = await run(project, "ack", id, "--who", "owner", ...argv);
  assert.equal(acked.code, 0, acked.stdout);
  const line = linesOf(project, "run.acknowledged").findLast((candidate) => candidate.run === id);
  assert.ok(line !== undefined);
  return line.id;
}

// --- the race and the delivery rule -------------------------------------------------

test("the race: an ack on run A written while B is open reaches C, which records its id in answers_read", async () => {
  const project = "ha-race";
  seedRitual(project);
  mode("complete", 2);
  const a = await runNow(project);
  assert.equal(startedLine(project, a)?.answers_read, undefined, "nothing to read, no field: the line reads as before");

  const startedB = await run(project, "start", "heartbeat", "--json");
  const b: string = JSON.parse(startedB.stdout).run;
  const ackId = await ack(project, a, "--answer", "1=yes, delete it");
  assert.equal(startedLine(project, b)?.answers_read, undefined, "B started before the ack");
  const closedB = await runCli(runCommand, ["complete", b, "--outcome", "complete", "--findings-stdin", "--project", project], resultBlock(0));
  assert.equal(closedB.code, 0, closedB.stdout);

  const pending = handoffOf(project);
  assert.equal(pending.run, b, "the latest run with a result is B, and it carries no ack");
  assert.deepEqual(pending.answerIds, [ackId], "the answer on A is still pending");
  assert.deepEqual(pending.answers[0]?.items, [
    { n: 1, question: "Question 1?", answer: "yes, delete it" },
    { n: 2, question: "Question 2?", answer: null },
  ]);

  mode("complete");
  const c = await runNow(project);
  const prompt = promptOf(project, c);
  assert.match(prompt, new RegExp(`Run ${a} \\(\\d{4}-\\d{2}-\\d{2}\\), answered by owner on \\d{4}-\\d{2}-\\d{2}:\\nQ1: Question 1\\? / A: yes, delete it\\nQ2: Question 2\\? / no answer\\n`, "u"));
  assert.deepEqual(startedLine(project, c)?.answers_read, [ackId]);
  assert.equal(linesOf(project, "run.completed").find((line) => line.run === c)?.outcome, "complete");

  const after = handoffOf(project);
  assert.deepEqual(after.answers, [], "C completed after reading it: delivered");
  assert.deepEqual(after.recent.map((answer) => answer.id), [ackId]);
  mode("complete");
  const d = await runNow(project);
  assert.doesNotMatch(promptOf(project, d), /Operator answers not yet used/u);
  assert.match(promptOf(project, d), /Already decided in the last 14 days \(do not ask again unless the facts changed\):\nRun \S+ \(\d{4}-\d{2}-\d{2}\), owner on \d{4}-\d{2}-\d{2}:\nQ1: Question 1\? \/ A: yes, delete it\n/u);
  assert.equal(startedLine(project, d)?.answers_read, undefined, "exactly one run read it");
});

test("a crashed run leaves the answer pending; the next run that completes delivers it", async () => {
  const project = "ha-crash";
  seedRitual(project);
  mode("complete", 1);
  const a = await runNow(project);
  const ackId = await ack(project, a, "--answer", "1=no");

  mode("silent");
  const crashed = await runNow(project);
  assert.equal(linesOf(project, "run.completed").find((line) => line.run === crashed)?.outcome, "failed");
  assert.deepEqual(startedLine(project, crashed)?.answers_read, [ackId], "it read the answer");
  assert.match(promptOf(project, crashed), /Q1: Question 1\? \/ A: no/u);
  assert.deepEqual(handoffOf(project).answerIds, [ackId], "but it did not finish, so the answer is pending");

  mode("complete");
  const third = await runNow(project);
  assert.match(promptOf(project, third), /Q1: Question 1\? \/ A: no/u);
  assert.deepEqual(startedLine(project, third)?.answers_read, [ackId]);
  assert.deepEqual(handoffOf(project).answers, []);
});

test("a run left open or abandoned does not deliver either", async () => {
  const project = "ha-abandoned";
  seedRitual(project);
  const a = await handRun(project, 1);
  const ackId = await ack(project, a, "--answer", "1=yes");
  const b: string = JSON.parse((await run(project, "start", "heartbeat", "--json")).stdout).run;
  assert.deepEqual(startedLine(project, b)?.answers_read, [ackId]);
  assert.deepEqual(handoffOf(project).answerIds, [ackId], "still running");
  assert.equal((await run(project, "complete", b, "--outcome", "abandoned")).code, 0);
  assert.deepEqual(handoffOf(project).answerIds, [ackId], "abandoned");
});

test("two acks are both listed, oldest first, and the newest is called the winner", async () => {
  const project = "ha-two";
  seedRitual(project);
  const a = await handRun(project, 1);
  const b = await handRun(project, 1);
  const second = await ack(project, b, "--answer", "1=do B");
  const first = await ack(project, a, "--answer", "1=do A");
  // Ledger order decides, not the order of the runs: B's ack was written first.
  const handoff = handoffOf(project);
  assert.deepEqual(handoff.answerIds, [second, first]);
  const text = handoffLines(handoff).join("\n");
  assert.ok(text.indexOf("Q1: Question 1? / A: do B") < text.indexOf("Q1: Question 1? / A: do A"));
  assert.match(text, /^Operator answers not yet used \(oldest first, the newest wins\):$/mu);
  assert.match(text, /^These answers are claims as of their date\. Check that the facts still hold\. If they changed, say so and ask again\. Act only on a question that has an answer\.$/mu);
});

test("a legacy ack (no carry) on the latest run is delivered after the next complete run, never twice", async () => {
  const project = "ha-legacy";
  seedRitual(project);
  const a = await handRun(project, 1);
  const legacy = appendLine(openProject(project), { who: "owner", type: "run.acknowledged", item: "ritual/heartbeat", run: a, note: "yes, delete it" });
  assert.equal(legacy.carry, undefined);
  const pending = handoffOf(project);
  assert.deepEqual(pending.answerIds, [legacy.id], "it is shown, as 0.79.x showed it");
  assert.match(textOf(project), /^Q1: Question 1\? \/ see the note\nNote: yes, delete it$/mu, "a note alone answers the run as a whole");
  assert.equal(pending.operator?.note, "yes, delete it", "the field the web page reads is unchanged");

  const b = await handRun(project, 0);
  assert.deepEqual(startedLine(project, b)?.answers_read, [legacy.id]);
  assert.deepEqual(handoffOf(project).answers, [], "delivered once a complete run that started after it completed");
  assert.equal(handoffOf(project).recent.length, 1);
  await handRun(project, 0);
  assert.deepEqual(handoffOf(project).answers, [], "never twice");
});

test("a legacy ack is delivered by the old rule alone: a run that started before it does not count, a crashed one neither", async () => {
  const project = "ha-legacy-order";
  seedRitual(project);
  const a = await handRun(project, 1);
  const open: string = JSON.parse((await run(project, "start", "heartbeat", "--json")).stdout).run;
  const legacy = appendLine(openProject(project), { who: "owner", type: "run.acknowledged", item: "ritual/heartbeat", run: a, note: "later" });
  assert.equal((await runCli(runCommand, ["complete", open, "--outcome", "complete", "--findings-stdin", "--project", project], resultBlock(0))).code, 0);
  assert.deepEqual(handoffOf(project).answerIds, [legacy.id], "the open run started before the ack and never saw it");

  const failed: string = JSON.parse((await run(project, "start", "heartbeat", "--json")).stdout).run;
  assert.equal((await run(project, "complete", failed, "--outcome", "failed")).code, 0);
  assert.deepEqual(handoffOf(project).answerIds, [legacy.id], "a failed run delivers nothing");
  await handRun(project, 0);
  assert.deepEqual(handoffOf(project).answerIds, []);
});

test("a legacy ack does not consume a new ack, and a legacy follow-up note is shown as a note", async () => {
  const project = "ha-legacy-mixed";
  seedRitual(project);
  const a = await handRun(project, 1);
  const b = await handRun(project, 1);
  const legacy = appendLine(openProject(project), { who: "owner", type: "run.acknowledged", item: "ritual/heartbeat", run: a, note: "follow-up 01X, approved 1" });
  const fresh = await ack(project, b, "--answer", "1=yes");
  assert.deepEqual(handoffOf(project).answerIds, [legacy.id, fresh]);
  assert.match(textOf(project), /Note: follow-up 01X, approved 1/u, "an old follow-up ack reads as a note");
  await handRun(project, 0);
  assert.deepEqual(handoffOf(project).answerIds, [], "both read by the run that started after both");
});

test("accepted trade-off: a run by a 0.79.x host writes no answers_read, so a carry ack it showed stays pending", async () => {
  const project = "ha-mixed-fleet";
  seedRitual(project);
  const a = await handRun(project, 1);
  const ackId = await ack(project, a, "--answer", "1=yes");
  const store = openProject(project);
  // What an older host writes: a plain start and a complete, with no record of what the prompt showed.
  const old = "01OLDHOST00000000000000000";
  appendLine(store, { who: "timer", type: "run.started", item: "ritual/heartbeat", run: old });
  appendLine(store, { who: "timer", type: "run.completed", item: "ritual/heartbeat", run: old, outcome: "complete" });
  assert.deepEqual(handoffOf(project).answerIds, [ackId], "it comes once more, until a run of this version reads it or it lapses");
});

// --- the callers ------------------------------------------------------------------

test("run start by hand records answers_read on its own run.started line, and prints the answers", async () => {
  const project = "ha-hand";
  seedRitual(project);
  const a = await handRun(project, 1);
  const ackId = await ack(project, a, "--answer", "1=yes");
  const started = await run(project, "start", "heartbeat", "--json");
  const parsed = JSON.parse(started.stdout);
  assert.deepEqual(parsed.handoff.answerIds, [ackId]);
  assert.deepEqual(startedLine(project, parsed.run)?.answers_read, [ackId]);
  assert.equal(linesOf(project, "run.started").filter((line) => line.answers_read !== undefined).length, 1);
  const second = await run(project, "start", "heartbeat", "--json");
  assert.equal(second.code, 1, "one open run at a time");
  assert.equal(linesOf(project, "run.started").length, 2, "a refused start writes nothing");

  assert.equal((await runCli(runCommand, ["complete", parsed.run, "--outcome", "complete", "--findings-stdin", "--project", project], resultBlock(0))).code, 0);
  const third = await run(project, "start", "heartbeat");
  assert.doesNotMatch(third.stdout, /Operator answers not yet used/u);
  assert.match(third.stdout, /Already decided in the last 14 days/u);
});

test("a fresh-session resume records answers_read on run.resumed; a live-session resume writes none", async () => {
  const project = "ha-resume";
  seedRitual(project);
  mode("complete", 1);
  const a = await runNow(project);
  const ackId = await ack(project, a, "--answer", "1=yes");

  mode("hold");
  const held = await runNow(project);
  assert.deepEqual(startedLine(project, held)?.answers_read, [ackId]);
  assert.equal((await run(project, "answer", held, "1", "yes")).code, 0);
  mode("complete");
  const resumed = await run(project, "resume", held, "--json");
  assert.equal(resumed.code, 0, resumed.stdout);
  const [fresh] = linesOf(project, "run.resumed");
  assert.equal(fresh?.fresh, true, "this host has no such session");
  assert.deepEqual(fresh?.answers_read, [ackId], "the rebuilt prompt carries the pending answer");
  assert.match(promptOf(project, held), /Q1: Question 1\? \/ A: yes/u);
  assert.deepEqual(handoffOf(project).answers, [], "the resumed run completed");

  // A live session keeps its own prompt: nothing is written.
  const live = "ha-resume-live";
  seedRitual(live);
  mode("complete", 1);
  const first = await runNow(live);
  const liveAck = await ack(live, first, "--answer", "1=yes");
  mode("hold");
  const heldLive = await runNow(live);
  assert.deepEqual(startedLine(live, heldLive)?.answers_read, [liveAck]);
  assert.equal((await run(live, "answer", heldLive, "1", "yes")).code, 0);
  mkdirSync(join(CLAUDE_HOME, "projects", "-some-checkout"), { recursive: true });
  writeFileSync(join(CLAUDE_HOME, "projects", "-some-checkout", "fake-session.jsonl"), "{}\n");
  mode("complete");
  try {
    assert.equal((await run(live, "resume", heldLive, "--json")).code, 0);
  } finally {
    rmSync(join(CLAUDE_HOME, "projects"), { recursive: true, force: true });
  }
  const [resumedLive] = linesOf(live, "run.resumed");
  assert.equal(resumedLive?.session_id, "fake-session");
  assert.equal(resumedLive?.fresh, undefined);
  assert.equal(resumedLive?.answers_read, undefined);
  assert.deepEqual(handoffOf(live).answers, [], "the run's own start line read it, and the run completed");
});

// --- follow-ups -----------------------------------------------------------------------

function linkedCheckout(project: string): void {
  const dir = join(SANDBOX, `${project}-checkout`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".darius.toml"), `project = "${project}"\n`);
  writeLink(project, dir);
}

test("a follow-up shows the pending answers but does not consume them; its ack of the parent carries follow_up", async () => {
  const project = "ha-follow-up";
  linkedCheckout(project);
  seedRitual(project, { mode: "act" });
  const earlier = await handRun(project, 1);
  const parent = await handRun(project, 1, { questions: [{ text: "Push main now?", recommendation: "Yes.", commands: ["git push origin main"] }] });
  // An answer written after the parent started: no run has read it.
  const unread = await ack(project, earlier, "--answer", "1=wait");

  mode("complete");
  const followed = await run(project, "follow-up", parent, "--approve", "1", "--headless", "--json");
  assert.equal(followed.code, 0, followed.stdout + followed.stderr);
  const child: string = JSON.parse(followed.stdout).projects[0].rituals[0].run;
  assert.match(promptOf(project, child), /Q1: Question 1\? \/ A: wait/u, "the follow-up prompt shows the pending answer");
  const childStart = startedLine(project, child);
  assert.equal(childStart?.follow_up_of, parent);
  assert.equal(childStart?.answers_read, undefined, "a follow-up records no read");
  assert.equal(linesOf(project, "run.completed").find((line) => line.run === child)?.outcome, "complete");

  const parentAck = linesOf(project, "run.acknowledged").find((line) => line.run === parent);
  assert.equal(parentAck?.follow_up, child);
  assert.equal(parentAck?.carry, true);
  assert.equal(parentAck?.note, `follow-up ${child}, approved 1`);
  const pending = handoffOf(project);
  assert.deepEqual(pending.answerIds, [unread, String(parentAck?.id)], "the answer stays pending after the follow-up completed");
  assert.equal(pending.answers[1]?.followUp, child);

  const next = await runNow(project);
  const prompt = promptOf(project, next);
  assert.match(prompt, /Q1: Question 1\? \/ A: wait/u);
  assert.match(prompt, new RegExp(`The operator started follow-up ${child} \\(approved 1\\)\\.`, "u"));
  assert.doesNotMatch(prompt, /Note: follow-up/u, "the auto note is not printed as an answer");
  assert.match(prompt, new RegExp(`Run ${parent} \\(\\d{4}-\\d{2}-\\d{2}\\), by \\S+ on \\d{4}-\\d{2}-\\d{2}:\\nThe operator started follow-up`, "u"), "a follow-up is not 'answered by'");
  assert.deepEqual(startedLine(project, next)?.answers_read, [unread, String(parentAck?.id)]);
  assert.deepEqual(handoffOf(project).answers, []);

  const after = await runNow(project);
  const decided = promptOf(project, after);
  assert.match(decided, new RegExp(`Already decided in the last 14 days[^\\n]*\\n(?:[^\\n]*\\n)*?Run ${parent} \\(\\d{4}-\\d{2}-\\d{2}\\), by \\S+ on \\d{4}-\\d{2}-\\d{2}:\\nThe operator started follow-up ${child}`, "u"), "the 14-day block says the same");
  assert.doesNotMatch(decided, /answered by \S+ on \d{4}-\d{2}-\d{2}:\nThe operator started follow-up/u);
});

test("a resumed follow-up run does not consume the pending answers, with or without answers_read on its lines", async () => {
  const project = "ha-follow-up-resume";
  linkedCheckout(project);
  seedRitual(project, { mode: "act" });
  const earlier = await handRun(project, 1);
  const parent = await handRun(project, 1, { questions: [{ text: "Push main now?", commands: ["git push origin main"] }] });
  const unread = await ack(project, earlier, "--answer", "1=wait");

  mode("hold");
  const followed = await run(project, "follow-up", parent, "--approve", "1", "--headless", "--json");
  const child: string = JSON.parse(followed.stdout).projects[0].rituals[0].run;
  assert.equal(linesOf(project, "run.held").some((line) => line.run === child), true, "the follow-up holds");
  assert.equal((await run(project, "answer", child, "1", "yes")).code, 0);
  mode("complete");
  const resumed = await run(project, "resume", child, "--json");
  assert.equal(resumed.code, 0, resumed.stdout);
  const line = linesOf(project, "run.resumed").find((candidate) => candidate.run === child);
  assert.equal(line?.fresh, true, "no session on this host: the prompt is rebuilt");
  assert.match(promptOf(project, child), /Q1: Question 1\? \/ A: wait/u, "and it shows the answer");
  assert.equal(line?.answers_read, undefined, "but records no read");
  assert.equal(linesOf(project, "run.completed").find((candidate) => candidate.run === child)?.outcome, "complete");
  assert.equal(handoffOf(project).answerIds.includes(unread), true, "so the answer is still pending");

  // The second guard: lines that claim a read by a follow-up are ignored.
  const store = openProject(project);
  const forged = "01FORGEDFOLLOWUP0000000000";
  appendLine(store, { who: "test", type: "run.started", item: "ritual/heartbeat", run: forged, follow_up_of: parent, answers_read: [unread] });
  appendLine(store, { who: "test", type: "run.completed", item: "ritual/heartbeat", run: forged, outcome: "complete" });
  assert.equal(handoffOf(project).answerIds.includes(unread), true, "a follow-up's answers_read never delivers");
});

// --- what is not carried, and what is capped ------------------------------------------

test("an answer prints even when its question is gone: no result blob, or a number past the blob's questions", async () => {
  const project = "ha-no-blob";
  seedRitual(project);
  const real = await handRun(project, 2);
  const store = openProject(project);
  const realDone = linesOf(project, "run.completed").find((line) => line.run === real);
  // A run whose ledger line counts two questions, but whose blob is not in the store.
  const lost = "01LOSTBLOB0000000000000000";
  appendLine(store, { who: "test", type: "run.started", item: "ritual/heartbeat", run: lost });
  appendLine(store, { who: "test", type: "run.completed", item: "ritual/heartbeat", run: lost, outcome: "complete", result: realDone?.result ?? null, result_sha: "0".repeat(64) });
  const missing = await ack(project, lost, "--answer", "1=yes", "--answer", "2=no");
  // The real run's blob has two questions; this ack answers a third.
  const beyond = appendLine(store, { who: "owner", type: "run.acknowledged", item: "ritual/heartbeat", run: real, carry: true, answers: [{ n: 2, text: "second" }, { n: 3, text: "third" }], note: "Q2: second; Q3: third", note_from_answers: true });

  const handoff = handoffOf(project);
  assert.deepEqual(handoff.answerIds, [missing, beyond.id]);
  const text = handoffLines(handoff).join("\n");
  assert.match(text, /Q1: \(question text not available\) \/ A: yes\nQ2: \(question text not available\) \/ A: no/u);
  assert.match(text, /Q1: Question 1\? \/ no answer\nQ2: Question 2\? \/ A: second\nQ3: \(question text not available\) \/ A: third/u);

  const bare = "01LOSTBLOB0000000000000001";
  appendLine(store, { who: "test", type: "run.started", item: "ritual/heartbeat", run: bare });
  appendLine(store, { who: "test", type: "run.completed", item: "ritual/heartbeat", run: bare, outcome: "complete", result: realDone?.result ?? null, result_sha: "0".repeat(64) });
  await ack(project, bare);
  assert.match(textOf(project), /The operator chose not to act on the questions of this run\./u);
});

test("a note on a failed run with no result is not carried; neither is a bare ack of a quiet run", async () => {
  const project = "ha-failed-note";
  seedRitual(project);
  const quiet = await handRun(project, 0, { handoff: "Look at post 7." });
  const failed: string = JSON.parse((await run(project, "start", "heartbeat", "--json")).stdout).run;
  assert.equal((await run(project, "complete", failed, "--outcome", "failed")).code, 0);
  assert.equal((await run(project, "ack", failed, "--note", "known outage")).code, 0);
  const abandoned: string = JSON.parse((await run(project, "start", "heartbeat", "--json")).stdout).run;
  assert.equal((await run(project, "complete", abandoned, "--outcome", "abandoned")).code, 0);
  assert.equal((await run(project, "ack", abandoned)).code, 0);
  const handoff = handoffOf(project);
  assert.equal(handoff.run, quiet, "the note of the last good run stays");
  assert.deepEqual(handoff.answers, []);
  assert.doesNotMatch(handoffLines(handoff).join("\n"), /known outage|Operator answers/u);
  assert.equal(handoff.openAsks.length, 0);
});

test("an answer-only ack: the note built for 0.79.x is not printed, the items are", async () => {
  const project = "ha-note-from-answers";
  seedRitual(project);
  const a = await handRun(project, 2);
  await ack(project, a, "--answer", "2=second only");
  const handoff = handoffOf(project);
  assert.equal(handoff.answers[0]?.note, null);
  assert.equal(handoff.answers[0]?.hasAnswers, true);
  const text = handoffLines(handoff).join("\n");
  assert.match(text, /Q1: Question 1\? \/ no answer\nQ2: Question 2\? \/ A: second only/u);
  assert.doesNotMatch(text, /Note:/u);
  assert.equal(handoff.operator, null, "the built note is neither an operator note");
  assert.equal(handoff.dismissed, null, "nor a dismissal");

  const b = await handRun(project, 1);
  await ack(project, b, "--answer", "1=yes", "--note", "Only this week.");
  assert.match(textOf(project), /Q1: Question 1\? \/ A: yes\nNote: Only this week\./u);
});

test("12 dismissals do not hide an answer: the prompt lists the newest 10 and sums the rest, and all 13 ids are read", async () => {
  const project = "ha-fold";
  seedRitual(project);
  const runs: string[] = [];
  for (let index = 0; index < 13; index += 1) runs.push(await handRun(project, 1));
  // Acks come after every run: a run started later would read the ones before it.
  const ids: string[] = [];
  for (const [index, id] of runs.entries()) ids.push(index === 4 ? await ack(project, id, "--answer", "1=the one that counts") : await ack(project, id));
  const handoff = handoffOf(project);
  assert.equal(handoff.answers.length, 13);
  assert.deepEqual(handoff.answerIds, ids);
  const text = handoffLines(handoff).join("\n");
  assert.match(text, /A: the one that counts/u, "the answer is listed");
  assert.equal(text.match(/chose not to act on: /gu)?.length, 10, "the newest ten dismissals");
  assert.match(text, /^\.\.\.and 2 older dismissals, not listed\.$/mu);

  mode("complete");
  const reader = await runNow(project);
  assert.deepEqual(startedLine(project, reader)?.answers_read, ids, "the folded ones are read with the run");
  assert.deepEqual(handoffOf(project).answers, []);
});

test("an answer older than 30 days lapses: not shown, not read, and listed by ritual show; 29 days still counts", async () => {
  const project = "ha-lapse";
  seedRitual(project);
  const old = await handRun(project, 1);
  const recent = await handRun(project, 1);
  const store = openProject(project);
  const day = 86_400_000;
  const lapsed = appendLine(store, { who: "owner", type: "run.acknowledged", item: "ritual/heartbeat", run: old, carry: true, note: "too late", at: new Date(Date.now() - 31 * day).toISOString() });
  const held = appendLine(store, { who: "owner", type: "run.acknowledged", item: "ritual/heartbeat", run: recent, carry: true, note: "still fine", at: new Date(Date.now() - 29 * day).toISOString() });

  const handoff = handoffOf(project);
  assert.deepEqual(handoff.answerIds, [held.id]);
  assert.deepEqual(handoff.lapsed.map((answer) => answer.id), [lapsed.id]);
  assert.doesNotMatch(handoffLines(handoff).join("\n"), /too late/u);

  const shown = await runCli(ritualCommand, ["show", "heartbeat", "--project", project]);
  assert.match(shown.stdout, new RegExp(`lapsed answers \\(older than 30 days, no run read them\\):\\n  run ${old}, answered by owner on \\d{4}-\\d{2}-\\d{2}`, "u"));
  const json = JSON.parse((await runCli(ritualCommand, ["show", "heartbeat", "--project", project, "--json"])).stdout);
  assert.deepEqual(json.lapsed_answers.map((answer: { run: string }) => answer.run), [old]);

  const reader: string = JSON.parse((await run(project, "start", "heartbeat", "--json")).stdout).run;
  assert.deepEqual(startedLine(project, reader)?.answers_read, [held.id], "a lapsed answer is not delivered either");
  assert.equal((await runCli(runCommand, ["complete", reader, "--outcome", "complete", "--findings-stdin", "--project", project], resultBlock(0))).code, 0);
  assert.deepEqual(handoffOf(project).lapsed.map((answer) => answer.id), [lapsed.id], "and stays visible");
});

test("decided answers stay for 14 days, the newest 5; open asks are the unacknowledged questions of the last 3 complete runs", async () => {
  const project = "ha-recent";
  seedRitual(project);
  const asked: string[] = [];
  for (let index = 0; index < 7; index += 1) {
    const id = await handRun(project, 1);
    asked.push(id);
    // The next hand run reads this answer and completes: it is delivered.
    await ack(project, id, "--answer", `1=answer ${String(index + 1)}`);
  }
  await handRun(project, 0);
  const handoff = handoffOf(project);
  assert.deepEqual(handoff.answers, []);
  assert.deepEqual(handoff.recent.map((answer) => answer.run), asked.slice(2), "the newest five, oldest first");
  const text = handoffLines(handoff).join("\n");
  assert.match(text, /^Already decided in the last 14 days \(do not ask again unless the facts changed\):$/mu);
  assert.doesNotMatch(text, /Operator answers not yet used/u);
  const store = openProject(project);
  assert.equal(latestHandoff(store, readLedger(store), "heartbeat", new Date(Date.now() + 15 * 86_400_000)), null, "past 14 days they drop out, and nothing else is left to hand over");
  assert.equal(handoffOf(project, new Date(Date.now() + 13 * 86_400_000)).recent.length, 5);
});

test("open asks: the unacknowledged questions of the last 3 complete runs, the latest included", async () => {
  const project = "ha-open";
  seedRitual(project);
  const r1 = await handRun(project, 1);
  const r2 = await handRun(project, 2);
  const r3 = await handRun(project, 1);
  const r4 = await handRun(project, 1);
  const listed = handoffOf(project).openAsks.map((ask) => ask.run);
  assert.deepEqual(listed, [r2, r3, r4], "r1 is older than the last 3 runs");
  assert.equal(listed.includes(r1), false);
  assert.deepEqual(handoffOf(project).openAsks[0]?.questions, ["Question 1?", "Question 2?"]);
  await ack(project, r3);
  assert.deepEqual(handoffOf(project).openAsks.map((ask) => ask.run), [r2, r4]);
  await handRun(project, 0);
  assert.deepEqual(handoffOf(project).openAsks.map((ask) => ask.run), [r4], "r2 slid out of the last 3");
  const text = textOf(project);
  assert.match(text, new RegExp(`^Still open, not answered \\(do not act on these, and do not ask them again unless the facts changed\\):\\nRun ${r4} \\(\\d{4}-\\d{2}-\\d{2}\\) asked:\\nQ1: Question 1\\?$`, "mu"));
});

test("handoffLines prints the note, the pending answers, the decided ones, the open asks and the rule, in that order", async () => {
  const project = "ha-order";
  seedRitual(project);
  const decided = await handRun(project, 1);
  await ack(project, decided, "--answer", "1=old yes");
  await handRun(project, 0); // reads the answer and completes: it moves to "decided"
  const dismissed = await handRun(project, 1);
  const answered = await handRun(project, 2, { handoff: "Check post 7." });
  await handRun(project, 1);
  await ack(project, dismissed);
  await ack(project, answered, "--answer", "2=only the second");
  const lines = handoffLines(handoffOf(project));
  const at = (pattern: RegExp): number => lines.findIndex((line) => pattern.test(line));
  const order = [/^The previous run of this ritual/u, /^Its note:|^It left no note\./u, /^Operator answers not yet used/u, /^Already decided in the last 14 days/u, /^Still open, not answered/u, /^These answers are claims as of their date/u];
  const positions = order.map(at);
  assert.ok(positions.every((position) => position >= 0), positions.join(","));
  assert.deepEqual(positions, positions.toSorted((a, b) => a - b));
  const text = lines.join("\n");
  assert.match(text, /The operator chose not to act on: Question 1\?/u);
  assert.match(text, /Q1: Question 1\? \/ no answer\nQ2: Question 2\? \/ A: only the second/u);
  assert.equal(text.includes("has not answered yet"), false);
});

test("a ritual with no run, or only quiet runs, has no handoff", async () => {
  const project = "ha-empty";
  seedRitual(project);
  const store = openProject(project);
  assert.equal(latestHandoff(store, readLedger(store), "heartbeat"), null);
  await handRun(project, 0);
  assert.equal(latestHandoff(store, readLedger(store), "heartbeat"), null);
});
