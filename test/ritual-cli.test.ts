/**
 * `src/cli/ritual.ts`, `src/cli/run.ts`, `src/cli/due.ts` (T6b): ritual
 * add/list/show/set/pause/resume/retire, the run lifecycle (start, hold,
 * answer, complete, list) including the open-run refusal and the
 * concurrent-complete race, and `due --json` (single project and
 * `--all-projects`).
 *
 * Most tests call `Command.run()` directly, in process, capturing
 * console.log/console.error the way `test/sweep.test.ts` does -- these
 * commands are not wired into `src/cli/commands.ts` yet (that is the
 * coordinator's job), so `bin/darius` cannot dispatch to them. The one
 * exception is the run-complete concurrency test and the findings-stdin
 * test: both need a real second OS process racing on the project's O_EXCL
 * lock, or a real piped stdin, neither of which an in-process call can
 * produce. Those spawn a tiny child script, the same technique
 * `test/ledger.test.ts` uses for its 20-concurrent-appendLine test.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { parseArgs } from "../src/cli/args.ts";
import { dueCommand } from "../src/cli/due.ts";
import { ritualState } from "../src/core/due.ts";
import type { Command, ParsedArgs } from "../src/cli/registry.ts";
import { ritualCommand } from "../src/cli/ritual.ts";
import { runCommand } from "../src/cli/run.ts";
import { readLedger } from "../src/core/ledger.ts";
import { UsageError } from "../src/core/model.ts";
import type { Ritual } from "../src/core/model.ts";
import { openProject } from "../src/core/store.ts";
import { writeLink } from "../src/core/links.ts";
import { commitAll, initRepo, NO_GIT } from "./helpers/git.ts";

// Paths are read from the environment on every call, so setting them here,
// after the imports, still keeps every write inside this throwaway dir.
const SANDBOX = mkdtempSync(join(tmpdir(), "darius-ritual-cli-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");

const RITUAL = ["add", "--title", "Heartbeat", "--cadence", "1d"];

interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a Command's `run()` in process, capturing stdout and stderr. */
async function runCli(command: Command, project: string | null, argv: string[], stdin?: string): Promise<CliRun> {
  const full = project === null ? argv : [...argv, "--project", project];
  const args: ParsedArgs = parseArgs(full);
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

async function addRitual(project: string, slug: string, extra: string[] = []): Promise<void> {
  const added = await runCli(ritualCommand, project, ["add", slug, ...RITUAL.slice(1), ...extra]);
  assert.equal(added.code, 0, added.stderr);
}

async function startRun(project: string, slug: string): Promise<string> {
  const started = JSON.parse((await runCli(runCommand, project, ["start", slug, "--json"])).stdout);
  return started.run;
}

function readRitual(project: string, slug: string): Ritual {
  const doc = openProject(project).readItem<Ritual>("ritual", slug);
  assert.ok(doc !== null, `no ritual '${slug}' in ${project}`);
  return doc.header;
}

// --- ritual add / list / show / set / lifecycle ------------------------------

test("ritual add creates the item file; a second add on the same slug refuses", async () => {
  const project = "ritual-add";
  await addRitual(project, "heartbeat");
  const header = readRitual(project, "heartbeat");
  assert.equal(header.title, "Heartbeat");
  assert.equal(header.cadence, "1d");
  assert.equal(header.anchor, "due");
  assert.deepEqual(header.policy, { mode: "off", may: [], hold: [] });

  await assert.rejects(runCli(ritualCommand, project, ["add", "heartbeat", "--title", "x", "--cadence", "1d"]), UsageError);
});

test("ritual add requires --title, --cadence and a parseable cadence", async () => {
  const project = "ritual-validate";
  await assert.rejects(runCli(ritualCommand, project, ["add", "x", "--cadence", "1d"]), /--title/u);
  await assert.rejects(runCli(ritualCommand, project, ["add", "x", "--title", "X"]), /--cadence/u);
  await assert.rejects(runCli(ritualCommand, project, ["add", "x", "--title", "X", "--cadence", "nope"]), UsageError);
});

test("ritual list and show reflect lifecycle computed from the ledger", async () => {
  const project = "ritual-show";
  await addRitual(project, "heartbeat");

  const list = JSON.parse((await runCli(ritualCommand, project, ["list", "--json"])).stdout);
  assert.equal(list.rituals.length, 1);
  assert.equal(list.rituals[0].lifecycle, "active");

  assert.equal((await runCli(ritualCommand, project, ["pause", "heartbeat"])).code, 0);
  const paused = JSON.parse((await runCli(ritualCommand, project, ["show", "heartbeat", "--json"])).stdout);
  assert.equal(paused.status.lifecycle, "paused");
  assert.equal(paused.status.isDue, false);

  assert.equal((await runCli(ritualCommand, project, ["resume", "heartbeat"])).code, 0);
  assert.equal((await runCli(ritualCommand, project, ["retire", "heartbeat"])).code, 0);

  await assert.rejects(runCli(ritualCommand, project, ["pause", "heartbeat"]), /retired/u);
  await assert.rejects(runCli(ritualCommand, project, ["resume", "heartbeat"]), /retired/u);
});

test("ritual add and set --host pin a ritual to one host, show and list name it, --host \"\" clears it", async () => {
  const project = "ritual-host";
  await addRitual(project, "heartbeat", ["--host", "host-a"]);
  const readHost = (): string | undefined => openProject(project).readItem<Ritual>("ritual", "heartbeat")?.header.host;
  assert.equal(readHost(), "host-a");

  const set = await runCli(ritualCommand, project, ["set", "heartbeat", "--host", "host-b", "--json"]);
  assert.equal(set.code, 0, set.stderr);
  assert.equal(JSON.parse(set.stdout).updated.host, "host-b");
  assert.equal(readHost(), "host-b", "the pin survives the item file round trip");
  assert.equal(JSON.parse((await runCli(ritualCommand, project, ["list", "--json"])).stdout).rituals[0].host, "host-b");
  assert.match((await runCli(ritualCommand, project, ["list"])).stdout, /anchor=due host=host-b {2}Heartbeat/u);
  assert.match((await runCli(ritualCommand, project, ["show", "heartbeat"])).stdout, /^host: host-b \(other hosts skip it\)$/mu);
  assert.equal(JSON.parse((await runCli(ritualCommand, project, ["show", "heartbeat", "--json"])).stdout).header.host, "host-b");

  assert.equal((await runCli(ritualCommand, project, ["set", "heartbeat", "--title", "Beat"])).code, 0);
  assert.equal(readHost(), "host-b", "a set without --host keeps the pin");
  assert.equal((await runCli(ritualCommand, project, ["set", "heartbeat", "--host", ""])).code, 0);
  assert.equal(readHost(), undefined);
  assert.equal(JSON.parse((await runCli(ritualCommand, project, ["list", "--json"])).stdout).rituals[0].host, undefined);
  assert.equal((await runCli(ritualCommand, project, ["show", "heartbeat"])).stdout.includes("host:"), false);

  await assert.rejects(runCli(ritualCommand, project, ["set", "heartbeat", "--host", "no such/host"]), /is not a host id/u);
  await assert.rejects(runCli(ritualCommand, project, ["add", "other", ...RITUAL.slice(1), "--host", "../x"]), UsageError);
});

test("ritual set updates title, cadence, anchor, tags and body", async () => {
  const project = "ritual-set";
  await addRitual(project, "heartbeat");

  const result = await runCli(
    ritualCommand,
    project,
    [
      "set",
      "heartbeat",
      "--title",
      "Heartbeat v2",
      "--cadence",
      "2d",
      "--anchor",
      "completion",
      "--tag",
      "selftest",
      "--tag",
      "core",
      "--stdin",
    ],
    "# Heartbeat v2\n\nRun `darius --version`.\n",
  );
  assert.equal(result.code, 0, result.stderr);

  const header = readRitual(project, "heartbeat");
  assert.equal(header.title, "Heartbeat v2");
  assert.equal(header.cadence, "2d");
  assert.equal(header.anchor, "completion");
  assert.deepEqual(header.tags, ["selftest", "core"]);

  const doc = openProject(project).readItem<Ritual>("ritual", "heartbeat");
  assert.match(doc?.body ?? "", /Heartbeat v2/u);
});

// --- ritual policy flags (add / set / show) -----------------------------------

test("ritual add accepts --mode, --model, --max-turns, --may, --hold and --notes", async () => {
  const project = "ritual-policy-add";
  const result = await runCli(ritualCommand, project, [
    "add",
    "heartbeat",
    ...RITUAL.slice(1),
    "--mode",
    "report",
    "--model",
    "haiku",
    "--max-turns",
    "6",
    "--may",
    "Bash(date)",
    "--may",
    "Bash(darius *)",
    "--hold",
    "git push",
    "--hold",
    "rm -rf",
    "--notes",
    "read-only",
    "--json",
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).added.policy, {
    mode: "report",
    may: ["Bash(date)", "Bash(darius *)"],
    hold: ["git push", "rm -rf"],
    notes: "read-only",
    model: "haiku",
    max_turns: 6,
  });

  const header = readRitual(project, "heartbeat");
  assert.deepEqual(header.policy, {
    mode: "report",
    may: ["Bash(date)", "Bash(darius *)"],
    hold: ["git push", "rm -rf"],
    notes: "read-only",
    model: "haiku",
    max_turns: 6,
  });
});

test("ritual add refuses an unknown --mode, a non-integer --max-turns, a malformed --may rule, and an unparseable --hold regex", async () => {
  const project = "ritual-policy-validate";
  await assert.rejects(
    runCli(ritualCommand, project, ["add", "a", ...RITUAL.slice(1), "--mode", "sometimes"]),
    UsageError,
  );
  await assert.rejects(
    runCli(ritualCommand, project, ["add", "b", ...RITUAL.slice(1), "--max-turns", "0"]),
    UsageError,
  );
  await assert.rejects(
    runCli(ritualCommand, project, ["add", "c", ...RITUAL.slice(1), "--max-turns", "abc"]),
    UsageError,
  );
  await assert.rejects(
    runCli(ritualCommand, project, ["add", "d", ...RITUAL.slice(1), "--may", "not a rule"]),
    UsageError,
  );
  await assert.rejects(
    runCli(ritualCommand, project, ["add", "e", ...RITUAL.slice(1), "--hold", "git push("]),
    /does not compile as a regular expression/u,
  );
});

test("ritual add accepts a bare tool name and a Tool(pattern) rule for --may", async () => {
  const project = "ritual-policy-may-shapes";
  const result = await runCli(ritualCommand, project, ["add", "heartbeat", ...RITUAL.slice(1), "--may", "Bash", "--may", "Bash(date)"]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(readRitual(project, "heartbeat").policy.may, ["Bash", "Bash(date)"]);
});

test("ritual set --due re-arms a ritual without a cadence, and refuses a day that does not exist", async () => {
  const project = "ritual-set-due";
  const added = await runCli(ritualCommand, project, ["add", "on-demand", "--title", "On demand", "--cadence", "1d"]);
  assert.equal(added.code, 0, added.stderr);
  // `ritual add` needs a cadence; an imported on-demand ritual has none.
  const stored = openProject(project).readItem<Ritual>("ritual", "on-demand");
  assert.ok(stored !== null);
  const header: Ritual = { ...stored.header };
  delete header.cadence;
  openProject(project).writeItem({ header, body: stored.body });
  const doc = () => {
    const found = openProject(project).readItem<Ritual>("ritual", "on-demand");
    assert.ok(found !== null);
    return found;
  };
  assert.equal(ritualState(doc(), readLedger(openProject(project)), { now: new Date("2026-10-01T12:00:00") }).nextDue, undefined, "never due without a cadence");

  const set = await runCli(ritualCommand, project, ["set", "on-demand", "--due", "2026-10-05"]);
  assert.equal(set.code, 0, set.stderr);
  const lines = readLedger(openProject(project)).filter((line) => line.type === "ritual.rescheduled");
  assert.deepEqual(lines.map((line) => [line.item, line.due]), [["ritual/on-demand", "2026-10-05"]]);
  const state = ritualState(doc(), readLedger(openProject(project)), { now: new Date("2026-10-06T12:00:00") });
  assert.equal(state.nextDue, "2026-10-05");
  assert.equal(state.isDue, true);

  await assert.rejects(runCli(ritualCommand, project, ["set", "on-demand", "--due", "2026-02-30"]), UsageError);
});

test("ritual set replaces --may/--hold wholesale, and a bare --may \"\" clears the list", async () => {
  const project = "ritual-policy-set";
  await addRitual(project, "heartbeat", ["--may", "Bash(date)", "--hold", "git push"]);

  const replaced = await runCli(ritualCommand, project, ["set", "heartbeat", "--may", "Bash(darius *)", "--hold", "deploy"]);
  assert.equal(replaced.code, 0, replaced.stderr);
  const afterReplace = readRitual(project, "heartbeat");
  assert.deepEqual(afterReplace.policy.may, ["Bash(darius *)"]);
  assert.deepEqual(afterReplace.policy.hold, ["deploy"]);

  const cleared = await runCli(ritualCommand, project, ["set", "heartbeat", "--may", ""]);
  assert.equal(cleared.code, 0, cleared.stderr);
  const afterClear = readRitual(project, "heartbeat");
  assert.deepEqual(afterClear.policy.may, []);
  assert.deepEqual(afterClear.policy.hold, ["deploy"]); // untouched: --hold was not given this time
});

test("ritual set with no policy flags leaves the existing policy untouched", async () => {
  const project = "ritual-policy-untouched";
  await addRitual(project, "heartbeat", ["--mode", "report", "--model", "haiku", "--max-turns", "6"]);
  const before = readRitual(project, "heartbeat").policy;

  const result = await runCli(ritualCommand, project, ["set", "heartbeat", "--title", "Heartbeat v2"]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(readRitual(project, "heartbeat").policy, before);
});

test("setting --mode act prints the visibility warning on stderr; --mode report and off do not", async () => {
  const project = "ritual-policy-act-warning";
  const warning = "act mode: this ritual may run the commands in 'may' unattended; 'hold' still stops it.";

  const added = await runCli(ritualCommand, project, ["add", "heartbeat", ...RITUAL.slice(1), "--mode", "report"]);
  assert.equal(added.code, 0, added.stderr);
  assert.equal(added.stderr, "");

  const setToAct = await runCli(ritualCommand, project, ["set", "heartbeat", "--mode", "act"]);
  assert.equal(setToAct.code, 0, setToAct.stderr);
  assert.equal(setToAct.stderr, warning);

  const setToOff = await runCli(ritualCommand, project, ["set", "heartbeat", "--mode", "off"]);
  assert.equal(setToOff.code, 0, setToOff.stderr);
  assert.equal(setToOff.stderr, "");
});

test("ritual show prints the policy, and --json includes it under header.policy", async () => {
  const project = "ritual-policy-show";
  await addRitual(project, "heartbeat", [
    "--mode",
    "act",
    "--model",
    "haiku",
    "--max-turns",
    "4",
    "--may",
    "Bash(date)",
    "--hold",
    "git push",
    "--notes",
    "careful",
  ]);

  const text = await runCli(ritualCommand, project, ["show", "heartbeat"]);
  assert.equal(text.code, 0, text.stderr);
  assert.match(text.stdout, /policy: mode=act model=haiku max_turns=4/u);
  assert.match(text.stdout, /may: Bash\(date\)/u);
  assert.match(text.stdout, /hold: git push/u);
  assert.match(text.stdout, /notes: careful/u);

  const json = JSON.parse((await runCli(ritualCommand, project, ["show", "heartbeat", "--json"])).stdout);
  assert.deepEqual(json.header.policy, {
    mode: "act",
    may: ["Bash(date)"],
    hold: ["git push"],
    notes: "careful",
    model: "haiku",
    max_turns: 4,
  });
});

// --- run start / hold / answer / complete / list ------------------------------

test("run start begins a run; a second start refuses while it is open (exit 1)", async () => {
  const project = "run-start";
  await addRitual(project, "heartbeat");

  const first = await runCli(runCommand, project, ["start", "heartbeat", "--json"]);
  assert.equal(first.code, 0, first.stderr);
  const firstJson = JSON.parse(first.stdout);
  assert.equal(firstJson.ok, true);
  assert.match(firstJson.run, /^[0-9A-HJKMNP-TV-Z]{26}$/u);

  const second = await runCli(runCommand, project, ["start", "heartbeat", "--json"]);
  assert.equal(second.code, 1);
  const secondJson = JSON.parse(second.stdout);
  assert.equal(secondJson.ok, false);
  assert.equal(secondJson.openRun, firstJson.run);
});

test("run start refuses UsageError for an unknown ritual", async () => {
  const project = "run-start-missing";
  await assert.rejects(runCli(runCommand, project, ["start", "no-such-ritual"]), UsageError);
});

test("run hold, answer and complete walk a run through held to closed", async () => {
  const project = "run-lifecycle";
  await addRitual(project, "heartbeat");
  const runId = await startRun(project, "heartbeat");

  const held = await runCli(runCommand, project, ["hold", runId, "--question", "ok to push?", "--question", "which env?", "--json"]);
  assert.equal(held.code, 0, held.stderr);
  assert.deepEqual(JSON.parse(held.stdout).questions, ["ok to push?", "which env?"]);

  const answered = await runCli(runCommand, project, ["answer", runId, "1", "yes", "go", "ahead"]);
  assert.equal(answered.code, 0, answered.stderr);

  // Completing a held run directly is allowed tonight: "run resume" (T10's
  // launcher work) is out of scope for T6b (docs/plan-tonight.md, T6b's verb
  // list has no "resume"), so held --answer*--> held is as far as the
  // ledger's lifecycle goes before a direct complete.
  const completed = await runCli(runCommand, project, ["complete", runId, "--outcome", "complete", "--json"]);
  assert.equal(completed.code, 0, completed.stderr);

  const second = await runCli(runCommand, project, ["complete", runId, "--outcome", "complete", "--json"]);
  assert.equal(second.code, 1);
  assert.equal(JSON.parse(second.stdout).ok, false);

  const ledger = readLedger(openProject(project));
  const completedLines = ledger.filter((line) => line.type === "run.completed" && line.run === runId);
  assert.equal(completedLines.length, 1);
  assert.equal(completedLines[0]?.findings_sha, null);
});

test("run hold refuses when the run is not running; run answer refuses when it is not held", async () => {
  const project = "run-guards";
  await addRitual(project, "heartbeat");
  const runId = await startRun(project, "heartbeat");

  await assert.rejects(runCli(runCommand, project, ["answer", runId, "1", "no"]), /not held/u);

  assert.equal((await runCli(runCommand, project, ["hold", runId, "--question", "ok?"])).code, 0);
  await assert.rejects(runCli(runCommand, project, ["hold", runId, "--question", "again?"]), /not running/u);

  assert.equal((await runCli(runCommand, project, ["answer", runId, "1", "yes"])).code, 0);
  assert.equal((await runCli(runCommand, project, ["complete", runId, "--outcome", "complete"])).code, 0);
});

test("run hold refuses for an unknown run id; run complete refuses (exit 1) for an unknown run id", async () => {
  const project = "run-unknown";
  await addRitual(project, "heartbeat");
  const unknown = "01UNKNOWNRUNID0000000000";

  await assert.rejects(runCli(runCommand, project, ["hold", unknown, "--question", "x"]), /no run/u);

  const result = await runCli(runCommand, project, ["complete", unknown, "--outcome", "complete", "--json"]);
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.stdout).ok, false);
});

test("run complete requires a valid --outcome", async () => {
  const project = "run-outcome";
  await addRitual(project, "heartbeat");
  const runId = await startRun(project, "heartbeat");
  await assert.rejects(runCli(runCommand, project, ["complete", runId, "--outcome", "nope"]), UsageError);
});

test("run list shows every run; --open filters out closed ones", async () => {
  const project = "run-list";
  await addRitual(project, "heartbeat");
  const closedRun = await startRun(project, "heartbeat");
  assert.equal((await runCli(runCommand, project, ["complete", closedRun, "--outcome", "complete"])).code, 0);

  await addRitual(project, "second");
  const openRun = await startRun(project, "second");

  const all = JSON.parse((await runCli(runCommand, project, ["list", "--json"])).stdout);
  assert.equal(all.runs.length, 2);

  const open = JSON.parse((await runCli(runCommand, project, ["list", "--open", "--json"])).stdout);
  assert.equal(open.runs.length, 1);
  assert.equal(open.runs[0].run, openRun);
});

test("run ack --json: exit 0 with the outcome and note, exit 1 when refused, usage for an unknown run; run list does not change", async () => {
  const project = "run-ack";
  await addRitual(project, "heartbeat");
  const failed = await startRun(project, "heartbeat");
  assert.equal((await runCli(runCommand, project, ["complete", failed, "--outcome", "failed"])).code, 0);
  const listed = (await runCli(runCommand, project, ["list", "--json"])).stdout;

  const acked = await runCli(runCommand, project, ["ack", failed, "--note", "known outage", "--who", "tester", "--json"]);
  assert.equal(acked.code, 0, acked.stdout);
  assert.deepEqual(JSON.parse(acked.stdout), { ok: true, run: failed, outcome: "failed", note: "known outage" });
  assert.equal((await runCli(runCommand, project, ["list", "--json"])).stdout, listed, "run list output is unchanged");

  const again = await runCli(runCommand, project, ["ack", failed, "--json"]);
  assert.equal(again.code, 1);
  const refused = JSON.parse(again.stdout);
  assert.deepEqual([refused.ok, refused.run], [false, failed]);
  assert.match(refused.error, /already acknowledged by tester/u);

  const held = await startRun(project, "heartbeat");
  assert.equal((await runCli(runCommand, project, ["hold", held, "--question", "ok?"])).code, 0);
  const heldText = await runCli(runCommand, project, ["ack", held]);
  assert.equal(heldText.code, 1);
  assert.equal(heldText.stdout, `! run '${held}' is held: answer and resume it`);
  assert.equal((await runCli(runCommand, project, ["complete", held, "--outcome", "abandoned"])).code, 0);
  const plain = await runCli(runCommand, project, ["ack", held]);
  assert.equal(plain.code, 0);
  assert.equal(plain.stdout, `✓ acknowledged run ${held} (abandoned)`);
  assert.equal(JSON.parse((await runCli(runCommand, project, ["ack", held, "--json"])).stdout).ok, false);

  await assert.rejects(runCli(runCommand, project, ["ack", "01UNKNOWNRUNID0000000000", "--json"]), UsageError);
  await assert.rejects(runCli(runCommand, project, ["ack"]), /missing <run> id/u);
  const lines = readLedger(openProject(project)).filter((line) => line.type === "run.acknowledged");
  assert.deepEqual(lines.map((line) => [line.run, line.note]), [[failed, "known outage"], [held, undefined]]);
});

// --- due -----------------------------------------------------------------------

interface HandBlock {
  v: number;
  status: string;
  summary: string;
  handoff: string;
}

/** Findings that end with a darius-result block holding `json`. */
function withBlock(json: HandBlock): string {
  return `done\n\`\`\`darius-result\n${JSON.stringify(json)}\n\`\`\`\n`;
}

test("by hand: run start, ritual show and run show print the handoff of the latest run with a result", async () => {
  const project = "handoff-hand";
  await addRitual(project, "heartbeat");
  const first = await startRun(project, "heartbeat");
  const fresh = await runCli(runCommand, project, ["start", "heartbeat", "--json"]);
  assert.equal(fresh.code, 1, "one open run at a time");
  const result: HandBlock = { v: 1, status: "ok", summary: "fine", handoff: "Look at post 7 first." };
  const long = await runCli(runCommand, project, ["complete", first, "--outcome", "complete", "--findings-stdin"], withBlock({ ...result, handoff: "x".repeat(201) }));
  assert.equal(long.code, 1, "a note over 200 characters is refused");
  assert.match(long.stdout, /handoff: at most 200 characters, got 201; make it shorter/u);
  const done = await runCli(runCommand, project, ["complete", first, "--outcome", "complete", "--findings-stdin"], withBlock(result));
  assert.match(done.stdout, /, a note for the next run$/u);
  assert.match((await runCli(runCommand, project, ["show", first])).stdout, /^  note for the next run: Look at post 7 first\.$/mu);

  const second = await runCli(runCommand, project, ["start", "heartbeat"]);
  assert.match(second.stdout, new RegExp(`^✓ started run \\S+ for ritual 'heartbeat'\n\nThe previous run of this ritual \\(run ${first}, `, "u"));
  assert.match(second.stdout, /^Its note: Look at post 7 first\.$/mu);
  const shown = await runCli(ritualCommand, project, ["show", "heartbeat"]);
  assert.match(shown.stdout, /^handoff to the next run:\nThe previous run/mu);
  assert.equal(JSON.parse((await runCli(ritualCommand, project, ["show", "heartbeat", "--json"])).stdout).handoff.note, "Look at post 7 first.");

  const run = second.stdout.split(" ")[3] ?? "";
  const plain = await runCli(runCommand, project, ["complete", run, "--outcome", "complete", "--findings-stdin"], "no block\n");
  assert.equal(plain.code, 0, "a by-hand run may skip the block");
  const third = JSON.parse((await runCli(runCommand, project, ["start", "heartbeat", "--json"])).stdout);
  assert.equal(third.handoff.run, first, "a run without a result leaves the note in place");
});

const text = (n: number): string => `${"a".repeat(n)}\n`;

test("run complete: findings over 4000 characters are refused for complete, the block does not count", async () => {
  const project = "findings-cap";
  await addRitual(project, "heartbeat");
  const run = await startRun(project, "heartbeat");
  const block: HandBlock = { v: 1, status: "ok", summary: "fine", handoff: "x".repeat(200) };
  const send = (outcome: string, body: string) => runCli(runCommand, project, ["complete", run, "--outcome", outcome, "--findings-stdin"], body);

  const over = await send("complete", `${text(4001)}\`\`\`darius-result\n${JSON.stringify(block)}\n\`\`\`\n`);
  assert.equal(over.code, 1);
  assert.match(over.stdout, /findings: at most 4000 characters, got 4001; the result block carries the facts, keep the prose to what it cannot say/u);
  assert.equal(readFileSync(join(openProject(project).root, "runs", run, "findings-rejected.md"), "utf8").includes("darius-result"), true, "the refused text is kept");
  const plainOver = await send("complete", "b".repeat(4001));
  assert.equal(plainOver.code, 1, "a block-less text is counted too");

  const big = `${text(4000)}\`\`\`darius-result\n${JSON.stringify({ ...block, items: Array.from({ length: 60 }, () => ({ title: "t".repeat(100), severity: "info", state: "open" })) })}\n\`\`\`\n`;
  assert.equal((await send("complete", big)).code, 0, "the cut block does not count; 4000 or fewer pass");
});

test("run complete: a failed run keeps findings over 4000 characters", async () => {
  const project = "findings-cap-failed";
  await addRitual(project, "heartbeat");
  const run = await startRun(project, "heartbeat");
  const done = await runCli(runCommand, project, ["complete", run, "--outcome", "failed", "--findings-stdin"], "c".repeat(5000));
  assert.equal(done.code, 0);
});

test("due --json shows a ritual with isDue true, plus the legacy tracker field names", async () => {
  const project = "due-json";
  await addRitual(project, "heartbeat");

  const result = await runCli(dueCommand, project, ["--json"]);
  assert.equal(result.code, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.project, project);
  assert.equal(parsed.rituals.length, 1);

  const row = parsed.rituals[0];
  assert.equal(row.slug, "heartbeat");
  assert.equal(row.isDue, true);
  assert.equal(row.name, "Heartbeat");
  assert.equal(row.due, row.nextDue);
  assert.equal(row.daysOverdue, row.overdueDays);
  assert.equal(row.cadence, "1d");
  assert.equal(row.lastRun, null);
});

test("due --all-projects lists rituals across every project this host has", async () => {
  const projectA = "due-all-a";
  const projectB = "due-all-b";
  await addRitual(projectA, "one");
  await addRitual(projectB, "two");

  const parsed = JSON.parse((await runCli(dueCommand, null, ["--all-projects", "--json"])).stdout);
  assert.ok(Array.isArray(parsed.projects));
  const projects = new Set<string>(parsed.projects);
  assert.ok(projects.has(projectA));
  assert.ok(projects.has(projectB));
  const slugs = new Set<string>(parsed.rituals.map((ritual: { slug: string }) => ritual.slug));
  assert.ok(slugs.has("one"));
  assert.ok(slugs.has("two"));
});

// --- spawned-child tests: real stdin, real concurrency ------------------------

const RUN_MODULE_URL = pathToFileURL(join(import.meta.dirname, "../src/cli/run.ts")).href;
const ARGS_MODULE_URL = pathToFileURL(join(import.meta.dirname, "../src/cli/args.ts")).href;

const RUN_CHILD_SCRIPT = join(SANDBOX, "run-child.mjs");
writeFileSync(
  RUN_CHILD_SCRIPT,
  [
    `import { parseArgs } from ${JSON.stringify(ARGS_MODULE_URL)};`,
    `import { runCommand } from ${JSON.stringify(RUN_MODULE_URL)};`,
    "const startAt = Number(process.env.DARIUS_TEST_START_AT ?? 0);",
    "if (startAt > 0) {",
    "  const wait = startAt - Date.now();",
    "  if (wait > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);",
    "}",
    "const args = parseArgs(process.argv.slice(2));",
    "const code = await runCommand.run(args);",
    "process.exit(code);",
  ].join("\n"),
);

interface ChildResult {
  code: number | null;
  stdout: string;
}

function spawnRunChild(argv: string[], opts: { stdin?: string; env?: NodeJS.ProcessEnv } = {}): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--no-warnings", RUN_CHILD_SCRIPT, ...argv], {
      env: { ...process.env, ...opts.env },
      stdio: [opts.stdin === undefined ? "ignore" : "pipe", "pipe", "ignore"],
    });
    const out: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => out.push(chunk));
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stdout: Buffer.concat(out).toString("utf8") }));
    if (opts.stdin !== undefined) child.stdin?.end(opts.stdin);
  });
}

test("run complete --findings-stdin stores the findings as a blob and records its sha", async () => {
  const project = "run-findings";
  await addRitual(project, "heartbeat");
  const runId = await startRun(project, "heartbeat");
  const findings = "all good\n";

  const result = await spawnRunChild(
    ["complete", runId, "--outcome", "complete", "--findings-stdin", "--json", "--project", project],
    { stdin: findings },
  );
  assert.equal(result.code, 0, result.stdout);
  assert.equal(JSON.parse(result.stdout.trim()).ok, true);

  const ledger = readLedger(openProject(project));
  const completedLine = ledger.find((line) => line.type === "run.completed" && line.run === runId);
  assert.ok(completedLine !== undefined);
  assert.equal(completedLine?.findings_sha, createHash("sha256").update(findings).digest("hex"));
});

test(
  "two concurrent 'run complete' on one run give exactly one exit 0 and one exit 1, and exactly one run.completed line",
  async () => {
    const project = "run-concurrent";
    await addRitual(project, "heartbeat");
    const runId = await startRun(project, "heartbeat");

    const startAt = String(Date.now() + 500);
    const argv = ["complete", runId, "--outcome", "complete", "--json", "--project", project];
    const [first, second] = await Promise.all([
      spawnRunChild(argv, { env: { DARIUS_TEST_START_AT: startAt } }),
      spawnRunChild(argv, { env: { DARIUS_TEST_START_AT: startAt } }),
    ]);

    const codes = [first.code, second.code].toSorted((a, b) => (a ?? -1) - (b ?? -1));
    assert.deepEqual(codes, [0, 1]);

    const ledger = readLedger(openProject(project));
    const completedLines = ledger.filter((line) => line.type === "run.completed" && line.run === runId);
    assert.equal(completedLines.length, 1);
  },
);

// --- v3 projects (0.54.0): rituals live in .darius.toml --------------------------

const V3_MARKER = (project: string): string =>
  [
    "v = 3",
    `project = "${project}"`,
    'tz = "UTC"',
    "",
    "[rituals.daily]",
    'title = "Daily"',
    'cadence = "1d"',
    'at = "07:00"',
    'skill = "daily"',
    'mode = "report"',
    "",
  ].join("\n");

/** A linked v3 checkout (git when `git` is set), and the store project. */
function v3Project(project: string, opts: { git?: boolean } = {}): string {
  const dir = join(SANDBOX, `${project}-checkout`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".darius.toml"), V3_MARKER(project));
  if (opts.git === true) {
    initRepo(dir);
    commitAll(dir, "init");
  }
  openProject(project, { create: true });
  writeLink(project, dir);
  return dir;
}

test("ritual add is refused in a v3 project and names the table to add", async () => {
  const project = "rc-v3-add";
  v3Project(project);
  await assert.rejects(
    runCli(ritualCommand, project, ["add", "nightly", "--title", "Nightly", "--cadence", "1d"]),
    { name: "UsageError", message: /rc-v3-add defines rituals in \.darius\.toml \(v = 3\); add \[rituals\.nightly\] there and commit/u },
  );
  assert.equal(openProject(project).readItem("ritual", "nightly"), null);
});

test("ritual reconcile mirrors the marker; list and show say repo; --dry-run writes nothing; --json carries the result", async () => {
  const project = "rc-v3-reconcile";
  v3Project(project);
  const dry = await runCli(ritualCommand, project, ["reconcile", "--dry-run"]);
  assert.equal(dry.code, 0, dry.stderr);
  assert.match(dry.stdout, /would reconcile rc-v3-reconcile.*1 adopted, 0 updated, 0 unchanged, 0 retired/u);
  assert.equal(openProject(project).readItem("ritual", "daily"), null, "a dry run writes nothing");
  const real = await runCli(ritualCommand, project, ["reconcile"]);
  assert.match(real.stdout, /reconciled rc-v3-reconcile.*1 adopted/u);
  assert.equal(readRitual(project, "daily").source, "repo");
  const list = await runCli(ritualCommand, project, ["list"]);
  assert.match(list.stdout, /daily .*at=07:00 UTC .* repo /u);
  const show = await runCli(ritualCommand, project, ["show", "daily"]);
  assert.match(show.stdout, /source: repo \(no commit, host .*\)/u);
  assert.match(show.stdout, /nextDue: \d{4}-\d{2}-\d{2} 07:00 UTC/u);
  const json = JSON.parse((await runCli(ritualCommand, project, ["reconcile", "--json"])).stdout);
  assert.deepEqual([json.ok, json.marker, json.unchanged, json.adopted], [true, "v3", ["daily"], []]);
});

test("ritual reconcile exits 2 for a v2 marker, a missing marker and a project with no checkout here; 1 for an invalid marker", async () => {
  const none = "rc-v3-nocheckout";
  openProject(none, { create: true });
  await assert.rejects(runCli(ritualCommand, none, ["reconcile"]), /no checkout of rc-v3-nocheckout on this host/u);

  const v2 = "rc-v2-reconcile";
  const dir = v3Project(v2);
  writeFileSync(join(dir, ".darius.toml"), `v = 2\nproject = "${v2}"\n`);
  await assert.rejects(runCli(ritualCommand, v2, ["reconcile"]), { name: "UsageError", message: /not a v3 project/u });

  const bad = "rc-v3-bad";
  const badDir = v3Project(bad);
  writeFileSync(join(badDir, ".darius.toml"), `${V3_MARKER(bad)}bogus = 1\n`);
  const result = await runCli(ritualCommand, bad, ["reconcile"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /\.darius\.toml:\d+/u);
});

test("ritual set on a repo ritual takes store flags and refuses git flags with file:line", async () => {
  const project = "rc-v3-set";
  const dir = v3Project(project);
  await runCli(ritualCommand, project, ["reconcile"]);
  const ok = await runCli(ritualCommand, project, ["set", "daily", "--owner", "ops", "--tag", "x", "--due", "2026-10-09", "--host", "host-b"]);
  assert.equal(ok.code, 0, ok.stderr);
  assert.deepEqual([readRitual(project, "daily").owner, readRitual(project, "daily").host], ["ops", "host-b"]);
  const line = readFileSync(join(dir, ".darius.toml"), "utf8").split("\n").findIndex((row) => row === "[rituals.daily]") + 1;
  for (const flag of [["--title", "x"], ["--cadence", "2d"], ["--mode", "act"], ["--may", "Read"], ["--model", "opus"], ["--max-turns", "3"], ["--skill", "s"]]) {
    await assert.rejects(
      runCli(ritualCommand, project, ["set", "daily", ...flag]),
      { name: "UsageError", message: `${flag[0]} is defined in ${dir}/.darius.toml:${String(line)} ([rituals.daily]); edit the file and commit` },
      flag[0],
    );
  }
  await assert.rejects(runCli(ritualCommand, project, ["set", "daily"], "new body\n"), /--stdin is defined in .*\.darius\.toml:\d+ \(\[rituals\.daily\]\)/u);
  assert.equal(readRitual(project, "daily").title, "Daily");
});

test("ritual set on an unmanaged ritual works as in v2 and warns; retire is refused for a repo ritual only", async () => {
  const project = "rc-v3-unmanaged";
  v3Project(project);
  await runCli(ritualCommand, project, ["reconcile"]);
  const stray = openProject(project);
  stray.writeItem(
    { header: { id: "01JAAAAAAAAAAAAAAAAAAAAAAB", kind: "ritual", slug: "stray", title: "Stray", created: "2026-10-01T00:00:00.000Z", updated: "2026-10-01T00:00:00.000Z", tags: [], cadence: "1d", anchor: "due", policy: { mode: "off", may: [], hold: [] } }, body: "x\n" },
    { who: "test" },
  );
  const set = await runCli(ritualCommand, project, ["set", "stray", "--title", "Stray 2"]);
  assert.equal(set.code, 0, set.stderr);
  assert.match(set.stderr, /unmanaged: not in \.darius\.toml; it never runs unattended/u);
  assert.equal(readRitual(project, "stray").title, "Stray 2");
  const list = await runCli(ritualCommand, project, ["list", "--json"]);
  assert.equal(JSON.parse(list.stdout).rituals.find((entry: { slug: string }) => entry.slug === "stray").source, "unmanaged");

  await assert.rejects(
    runCli(ritualCommand, project, ["retire", "daily"]),
    { name: "UsageError", message: "remove [rituals.daily] from .darius.toml and commit; the next reconcile retires it" },
  );
  assert.equal((await runCli(ritualCommand, project, ["pause", "daily"])).code, 0, "pause stays a store verb");
  assert.equal((await runCli(ritualCommand, project, ["retire", "stray"])).code, 0, "an unmanaged ritual retires as today");
});

test("ritual list warns when the mirror differs from this checkout, and when a retired slug is named again", { skip: NO_GIT }, async () => {
  const project = "rc-v3-stale";
  const dir = v3Project(project, { git: true });
  await runCli(ritualCommand, project, ["reconcile"]);
  const doc = openProject(project).readItem<Ritual>("ritual", "daily");
  assert.ok(doc !== null);
  openProject(project).writeItem({ header: { ...doc.header, def_hash: "0".repeat(64), def_host: "host-b", def_commit: "abc123" }, body: "" }, { who: "test" });
  const list = await runCli(ritualCommand, project, ["list"]);
  assert.match(list.stdout, /! mirror is from host-b \(commit abc123\), this checkout differs: darius ritual reconcile/u);

  const full = readFileSync(join(dir, ".darius.toml"), "utf8");
  writeFileSync(join(dir, ".darius.toml"), full.slice(0, full.indexOf("[rituals.daily]")));
  await runCli(ritualCommand, project, ["reconcile"]);
  writeFileSync(join(dir, ".darius.toml"), full);
  const again = await runCli(ritualCommand, project, ["reconcile"]);
  assert.match(again.stdout, /! daily was retired; use a new slug/u);
  assert.match((await runCli(ritualCommand, project, ["list"])).stdout, /! daily was retired; use a new slug/u);
  assert.deepEqual(JSON.parse((await runCli(ritualCommand, project, ["reconcile", "--json"])).stdout).warnings, ["daily was retired; use a new slug"]);
});
