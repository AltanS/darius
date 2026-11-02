/**
 * `darius flare light|list|show|answer|accept|clear|reopen` (src/cli/flare.ts).
 * A follow-up needs the fake harness, so `answer --follow-up` that starts a run
 * is in test/runner.test.ts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs } from "../src/cli/args.ts";
import { flareCommand } from "../src/cli/flare.ts";
import { readLedger } from "../src/core/ledger.ts";
import type { LedgerLine } from "../src/core/model.ts";
import { NotFoundError, UsageError } from "../src/core/model.ts";
import { getBlobText, openProject } from "../src/core/store.ts";
import { Seeder, type Item } from "./helpers/finding-seed.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-flare-cli-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
// A suite run inside a darius run must not see its own run.
delete process.env.DARIUS_RUN;
delete process.env.DARIUS_RUN_POLICY;
delete process.env.DARIUS_PROJECT;

interface CliRun {
  code: number;
  stdout: string;
}

/** Runs the verb in process. `stdin` stands in for what src/cli.ts reads for `--stdin`. */
async function flare(project: string, argv: string[], stdin?: string): Promise<CliRun> {
  const out: string[] = [];
  const { log } = console;
  console.log = (...parts: string[]) => out.push(parts.join(" "));
  try {
    const args = parseArgs([...argv, "--project", project], flareCommand.flags);
    if (stdin !== undefined) args.stdin = stdin;
    const code = await flareCommand.run(args);
    return { code, stdout: out.join("\n") };
  } finally {
    console.log = log;
  }
}

function fresh(name: string): string {
  openProject(name, { create: true });
  return name;
}

function lines(project: string, type: string): LedgerLine[] {
  return readLedger(openProject(project)).filter((line) => line.type === type);
}

function light(project: string, key: string, severity = "high", more: string[] = []): Promise<CliRun> {
  return flare(project, ["light", key, "--title", `Flare ${key}`, "--severity", severity, ...more]);
}

function flagged(key: string, more: Item = {}): Item {
  return { key, title: `Flare ${key}`, severity: "high", state: "needs-decision", flare: true, ...more };
}

test("flare light writes one line with what it was given, and a new key lights", async () => {
  const project = fresh("fl-light");
  const lit = await flare(project, ["light", "dep/cve-1", "--title", "Vulnerable dependency", "--severity", "high", "--target", "web/package.json", "--source", "ci:nightly", "--deliver", "push,email", "--who", "script"]);
  assert.equal(lit.code, 0);
  assert.equal(lit.stdout, "✓ lit flare 'dep/cve-1' at high");
  const [line] = lines(project, "flare.lit");
  assert.equal(line?.key, "dep/cve-1");
  assert.equal(line?.title, "Vulnerable dependency");
  assert.equal(line?.severity, "high");
  assert.equal(line?.target, "web/package.json");
  assert.equal(line?.source, "ci:nightly");
  assert.deepEqual(line?.deliver, ["push", "email"]);
  assert.equal(line?.who, "script");
  assert.equal(line?.body_sha, undefined);
});

test("flare light leaves deliver out unless it is given, and none means the app only", async () => {
  const project = fresh("fl-deliver");
  await light(project, "plain");
  await light(project, "none", "high", ["--deliver", "none"]);
  await light(project, "dup", "high", ["--deliver", "push,push"]);
  const [plain, none, dup] = lines(project, "flare.lit");
  assert.equal(plain?.deliver, undefined, "the alert work resolves the default");
  assert.equal(plain?.source, "cli");
  assert.deepEqual(none?.deliver, []);
  assert.deepEqual(dup?.deliver, ["push"]);
  for (const bad of ["sms", "push,none", "push,", ""]) {
    await assert.rejects(light(project, "x", "high", ["--deliver", bad]), UsageError, bad);
  }
  assert.equal(lines(project, "flare.lit").length, 3, "a refused light writes nothing");
});

test("flare light on a lit key at the same or a lower severity says so, exits 0 and still writes, so lastSeen moves", async () => {
  const project = fresh("fl-seen");
  await light(project, "k");
  const before = JSON.parse((await flare(project, ["show", "k", "--json"])).stdout).flare;
  await new Promise((resolve) => setTimeout(resolve, 5));
  for (const severity of ["high", "low"]) {
    const seen = await light(project, "k", severity);
    assert.equal(seen.code, 0);
    assert.equal(seen.stdout, "✓ flare 'k' already lit, seen again");
  }
  assert.equal(lines(project, "flare.lit").length, 3);
  const after = JSON.parse((await flare(project, ["show", "k", "--json"])).stdout).flare;
  assert.equal(after.reports, 3);
  assert.ok(after.lastSeen.at > before.lastSeen.at, "lastSeen moved");
  assert.equal(after.firstSeen.at, before.firstSeen.at);

  const raised = await light(project, "k", "critical");
  assert.equal(raised.code, 0);
  assert.equal(raised.stdout, "✓ raised flare 'k' to critical");
  const json = JSON.parse((await light(project, "k", "critical", ["--json"])).stdout);
  assert.deepEqual([json.ok, json.status, json.severity, json.reports], [true, "lit", "critical", 5]);
});

test("flare light on a closed key leaves it closed, and on a gone key lights it again", async () => {
  const project = fresh("fl-closed");
  await light(project, "k");
  await flare(project, ["accept", "k"]);
  const seen = await light(project, "k");
  assert.equal(seen.stdout, "✓ flare 'k' already accepted, seen again; it stays closed");
  const shown = JSON.parse((await flare(project, ["show", "k", "--json"])).stdout).flare;
  assert.deepEqual([shown.status, shown.stillReported], ["accepted", true]);
  assert.equal((await light(project, "k", "critical")).stdout, "✓ raised flare 'k' to critical");
  await flare(project, ["clear", "k"]);
  assert.equal((await light(project, "k")).stdout, "✓ lit flare 'k' at high");
});

test("flare light --stdin stores the body as a blob, and show prints it", async () => {
  const project = fresh("fl-body");
  const body = "Line one\nLine two\u001b[31m\n";
  assert.equal((await flare(project, ["light", "k", "--title", "T", "--severity", "low", "--stdin"], body)).code, 0);
  assert.equal(getBlobText(openProject(project), String(lines(project, "flare.lit")[0]?.body_sha)), body);
  const text = (await flare(project, ["show", "k"])).stdout;
  assert.match(text, /\n {2}body:\n {4}Line one\n {4}Line two \[31m/u, "control characters do not reach the terminal");
  assert.equal(JSON.parse((await flare(project, ["show", "k", "--json"])).stdout).body, body);
  await assert.rejects(flare(project, ["light", "k2", "--title", "T", "--severity", "low", "--stdin"], "  \n"), /--stdin got an empty body/u);
});

test("flare light follows the key rules of a result item: one line, at most 120 characters, refused and not clipped", async () => {
  const project = fresh("fl-key");
  const longest = "k".repeat(120);
  assert.equal((await light(project, longest)).code, 0);
  assert.equal(lines(project, "flare.lit")[0]?.key, longest);
  await assert.rejects(light(project, "k".repeat(121)), /at most 120 characters, got 121; make it shorter/u);
  await assert.rejects(light(project, "two\nlines"), /<key> must be one line/u);
  await assert.rejects(light(project, "   "), /missing <key>/u);
  assert.equal(lines(project, "flare.lit").length, 1, "nothing written for a refused key");
  assert.equal((await light(project, "a   b")).code, 0);
  assert.equal(lines(project, "flare.lit")[1]?.key, "a b", "whitespace collapses as in a result item");
  assert.equal((await flare(project, ["show", "a   b"])).code, 0, "every verb reads the key the same way");
});

test("flare light refuses a missing title or severity, and a bad severity", async () => {
  const project = fresh("fl-usage");
  await assert.rejects(flare(project, ["light", "k", "--severity", "high"]), /missing --title/u);
  await assert.rejects(flare(project, ["light", "k", "--title", "   ", "--severity", "high"]), /missing --title/u);
  await assert.rejects(flare(project, ["light", "k", "--title", "T"]), /missing --severity/u);
  await assert.rejects(flare(project, ["light", "k", "--title", "T", "--severity", "urgent"]), /--severity takes critical, high, medium, low, info, got 'urgent'/u);
  assert.equal(lines(project, "flare.lit").length, 0);
});

test("flare list shows lit flares by default; --all and --status show more", async () => {
  const project = fresh("fl-list");
  assert.equal((await flare(project, ["list"])).stdout, "no flares");
  await light(project, "lit-low", "low");
  await light(project, "lit-high", "high", ["--target", "site-a", "--source", "ci:nightly"]);
  await light(project, "lit-high", "high", ["--target", "site-a", "--source", "ci:nightly"]);
  await light(project, "ans");
  await flare(project, ["answer", "ans", "--note", "ok"]);
  await light(project, "acc");
  await flare(project, ["accept", "acc"]);
  await light(project, "gone");
  await flare(project, ["clear", "gone"]);

  const shown = (await flare(project, ["list"])).stdout.split("\n");
  assert.equal(shown.length, 2);
  assert.match(shown[0] ?? "", /^lit high: Flare lit-high \[site-a\] \{lit-high\} since \d{4}-\d\d-\d\d seen 2 times from ci:nightly$/u);
  assert.match(shown[1] ?? "", /^lit low: Flare lit-low \{lit-low\} since .* seen once from cli$/u);
  assert.deepEqual((await flare(project, ["list", "--all"])).stdout.split("\n").map((line) => line.split(" ")[0]), ["lit", "lit", "answered", "accepted", "gone"]);
  for (const status of ["answered", "accepted", "gone"]) {
    const only = (await flare(project, ["list", "--status", status])).stdout.split("\n");
    assert.equal(only.length, 1);
    assert.ok(only[0]?.startsWith(`${status} `));
  }
  const json = JSON.parse((await flare(project, ["list", "--json"])).stdout);
  assert.equal(json.project, project);
  assert.deepEqual(json.flares.map((one: { key: string }) => one.key), ["lit-high", "lit-low"]);
  await assert.rejects(flare(project, ["list", "--status", "open"]), /--status takes lit, answered, accepted, gone, got 'open'/u);
  await assert.rejects(flare(project, ["list", "--all", "--status", "lit"]), /use --all or --status, not both/u);
});

test("flare show prints the flare and its history; an unknown key exits as not found", async () => {
  const project = fresh("fl-show");
  await light(project, "k", "high", ["--deliver", "none", "--who", "script"]);
  await flare(project, ["answer", "k", "--note", "Later", "--who", "op"]);
  const text = (await flare(project, ["show", "k"])).stdout;
  assert.match(text, /^answered high: Flare k \{k\} since /u);
  assert.match(text, /\n {2}deliver: none, the app only\n/u);
  assert.match(text, /\n {2}answered by op at .* at severity high: Later\n/u);
  assert.match(text, /\n {2}history, oldest first:\n {4}.* lit high by script\n {4}.* answered high by op: Later$/u);
  await assert.rejects(flare(project, ["show", "nope"]), NotFoundError);
  await assert.rejects(flare(project, ["show"]), /flare show: missing <key>/u);
});

test("flare answer needs a note, writes the severity it closed at, and refuses a second answer", async () => {
  const project = fresh("fl-answer");
  await light(project, "k");
  await assert.rejects(flare(project, ["answer", "k"]), /missing --note/u);
  await assert.rejects(flare(project, ["answer", "k", "--note", "  "]), /missing --note/u);
  await assert.rejects(flare(project, ["answer", "nope", "--note", "n"]), NotFoundError);
  const done = await flare(project, ["answer", "k", "--note", "  Update it  ", "--who", "op"]);
  assert.deepEqual([done.code, done.stdout], [0, "✓ answered flare 'k'"]);
  const [line] = lines(project, "flare.answered");
  assert.deepEqual([line?.key, line?.note, line?.severity, line?.who, line?.follow_up_run], ["k", "Update it", "high", "op", undefined]);
  const twice = await flare(project, ["answer", "k", "--note", "Again"]);
  assert.equal(twice.code, 1);
  assert.equal(twice.stdout, "! flare 'k' is already answered by op; reopen it to answer again");
  assert.equal(lines(project, "flare.answered").length, 1);
});

test("flare accept closes the flare; a note is optional, a second accept is refused, an accept may replace an answer", async () => {
  const project = fresh("fl-accept");
  await light(project, "k", "medium");
  assert.equal((await flare(project, ["accept", "k", "--who", "op"])).stdout, "✓ accepted flare 'k'");
  const [line] = lines(project, "flare.accepted");
  assert.deepEqual([line?.severity, line?.note, line?.who], ["medium", undefined, "op"]);
  assert.equal((await flare(project, ["accept", "k"])).code, 1);
  await light(project, "m");
  await flare(project, ["answer", "m", "--note", "n"]);
  assert.equal((await flare(project, ["accept", "m", "--note", "Risk is fine", "--json"])).code, 0);
  assert.equal(JSON.parse((await flare(project, ["show", "m", "--json"])).stdout).flare.status, "accepted");
});

test("flare clear ends a flare in any open status, and refuses a gone one", async () => {
  const project = fresh("fl-clear");
  for (const key of ["a", "b"]) await light(project, key);
  await flare(project, ["accept", "b"]);
  for (const key of ["a", "b"]) assert.equal((await flare(project, ["clear", key, "--note", "fixed"])).stdout, `✓ cleared flare '${key}'`);
  const again = await flare(project, ["clear", "a"]);
  assert.deepEqual([again.code, again.stdout], [1, "! flare 'a' is already gone"]);
  for (const verb of [["accept", "a"], ["answer", "a", "--note", "n"]]) {
    assert.equal((await flare(project, verb)).code, 1, "the index would skip this line, so it is refused");
  }
  const shown = JSON.parse((await flare(project, ["show", "a", "--json"])).stdout).flare;
  assert.deepEqual([shown.status, shown.cleared.note], ["gone", "fixed"]);
});

test("flare reopen takes back an answer or an accept, and only that", async () => {
  const project = fresh("fl-reopen");
  await light(project, "k");
  const lit = await flare(project, ["reopen", "k"]);
  assert.deepEqual([lit.code, lit.stdout], [1, "! flare 'k' is lit; there is nothing to reopen"]);
  await flare(project, ["answer", "k", "--note", "n"]);
  assert.equal((await flare(project, ["reopen", "k", "--note", "Not done", "--who", "op"])).stdout, "✓ reopened flare 'k'");
  const [line] = lines(project, "flare.reopened");
  assert.deepEqual([line?.note, line?.who], ["Not done", "op"]);
  assert.equal(JSON.parse((await flare(project, ["show", "k", "--json"])).stdout).flare.status, "lit");
  await flare(project, ["clear", "k"]);
  const gone = await flare(project, ["reopen", "k"]);
  assert.deepEqual([gone.code, gone.stdout], [1, "! flare 'k' is gone; only a new report lights it again"]);
});

test("flare answer --follow-up refuses a flare from outside, with a sentence that says why", async () => {
  const project = fresh("fl-outside");
  await light(project, "k", "high", ["--source", "ci:nightly"]);
  const refused = await flare(project, ["answer", "k", "--note", "n", "--follow-up"]);
  assert.equal(refused.code, 1);
  assert.equal(refused.stdout, "! flare 'k' has no run to follow up: its newest report came from ci:nightly. Answer it without --follow-up, and act on it yourself.");
  assert.equal(lines(project, "flare.answered").length, 0);
  const json = JSON.parse((await flare(project, ["answer", "k", "--note", "n", "--follow-up", "--json"])).stdout);
  assert.equal(json.ok, false);
  await assert.rejects(flare(project, ["answer", "k", "--follow-up"]), /missing --note/u);
  await assert.rejects(flare(project, ["accept", "k", "--follow-up"]), /flare accept takes no --follow-up/u);
});

test("flare answer --follow-up goes by the newest report: a later report from outside has no run to follow", async () => {
  const seed = new Seeder("fl-newest");
  seed.run("check", [flagged("k")]);
  await light(seed.project.name, "k");
  const refused = await flare(seed.project.name, ["answer", "k", "--note", "n", "--follow-up"]);
  assert.equal(refused.code, 1);
  assert.match(refused.stdout, /its newest report came from cli/u);
});

test("every write verb refuses inside a run, on DARIUS_RUN or DARIUS_RUN_POLICY; a read goes on", async () => {
  const project = fresh("fl-run");
  await light(project, "k");
  const writes = [
    ["light", "new", "--title", "T", "--severity", "high"],
    ["answer", "k", "--note", "n"],
    ["answer", "k", "--note", "n", "--follow-up"],
    ["accept", "k"],
    ["clear", "k"],
    ["reopen", "k"],
    ["light"],
  ];
  const ledgerBefore = readLedger(openProject(project)).length;
  for (const name of ["DARIUS_RUN", "DARIUS_RUN_POLICY"]) {
    process.env[name] = "01RUN";
    try {
      for (const argv of writes) {
        const refused = await flare(project, argv);
        assert.equal(refused.code, 1, argv.join(" "));
        assert.match(refused.stdout, /^! flare \w+ is for a person or a script; a run reports a flare in its result block with "flare": true$/u, argv.join(" "));
      }
      const json = JSON.parse((await flare(project, ["accept", "k", "--json"])).stdout);
      assert.equal(json.ok, false);
      assert.equal((await flare(project, ["list"])).code, 0);
      assert.equal((await flare(project, ["show", "k"])).code, 0);
    } finally {
      delete process.env[name];
    }
  }
  assert.equal(readLedger(openProject(project)).length, ledgerBefore, "nothing written");
  process.env.DARIUS_RUN = "";
  try {
    assert.equal((await flare(project, ["accept", "k"])).code, 0, "an empty value is no run, as for run follow-up");
  } finally {
    delete process.env.DARIUS_RUN;
  }
});

test("flare needs a known verb and known flags", async () => {
  const project = fresh("fl-verbs");
  await assert.rejects(flare(project, []), /flare needs a verb: light \| list \| show \| answer \| accept \| clear \| reopen/u);
  await assert.rejects(flare(project, ["dismiss", "k"]), UsageError);
  await assert.rejects(flare(project, ["list", "--bogus"]), /unknown option --bogus/u);
});
