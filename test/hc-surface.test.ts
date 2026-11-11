/**
 * The hc surface (0.133.0): launchHc against a fake `hc connect`
 * (test/helpers/fake-hc.ts). The launch argv with and without a sandbox, the
 * run variables through the API's env, the first message and its resend,
 * the hold of an agent that waits, the kill on timeout, the box proof, the
 * missing hc, and the removal of finished terminals. Nothing here reaches a
 * real hc core.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { agentName } from "../src/surface/attended.ts";
import { attachCommand, closeFinishedTerminals, hcUnavailable, launchHc, recordedTerminals, type HcPlan } from "../src/surface/hc.ts";
import { writeFakeHc, type FakeHcCall } from "./helpers/fake-hc.ts";

const ROOT = mkdtempSync(join(tmpdir(), "darius-hc-surface-"));
const SANDBOX_ARGV = ["/usr/bin/bwrap", "--die-with-parent", "--"];

interface Case {
  dir: string;
  runDir: string;
  held: string[];
  plan: HcPlan;
}

interface Setup {
  states?: string[];
  afterSend?: Record<number, string[]>;
  gateAfterSend?: number;
  foreground?: string;
  otherPid?: boolean;
  /** Closes the run in the "ledger" after this many ms. */
  closeAfterMs?: number;
}

/** A fake hc dir and a plan with short times. */
function setup(name: string, opts: Setup = {}, plan: Partial<HcPlan> = {}): Case {
  const dir = join(ROOT, name);
  const runDir = join(dir, "runs", `RUN${name.toUpperCase().replaceAll("-", "")}`);
  mkdirSync(runDir, { recursive: true });
  const bin = writeFakeHc(dir);
  if (opts.states !== undefined) writeFileSync(join(dir, "states"), `${opts.states.join("\n")}\n`);
  for (const [n, list] of Object.entries(opts.afterSend ?? {})) writeFileSync(join(dir, `after-send-${n}`), `${list.join("\n")}\n`);
  if (opts.gateAfterSend !== undefined) writeFileSync(join(dir, `gate-after-send-${String(opts.gateAfterSend)}`), "");
  if (opts.foreground !== undefined) writeFileSync(join(dir, "foreground"), opts.foreground);
  if (opts.otherPid === true) writeFileSync(join(dir, "foreground-pid"), "other");
  process.env.FAKE_HC_DIR = dir;
  process.env.RUN_DIR = runDir;
  const held: string[] = [];
  const startedAt = Date.now();
  const closeAfter = opts.closeAfterMs;
  const full: HcPlan = {
    target: { bin },
    bin: "/opt/claude",
    argv: ["Run ritual x now.", "--settings", "/run/settings.json"],
    message: "Run ritual x now.",
    cwd: dir,
    env: { DARIUS_RUN: "r1", DARIUS_PROJECT: "p1" },
    labels: { darius_ritual: "x" },
    run: runDir.split("/").pop() ?? "",
    runDir,
    timeoutMs: 20_000,
    pollMs: 20,
    graceMs: 400,
    confirmMs: 3_000,
    idleMs: 150,
    phase: () => (held.length > 0 || (closeAfter !== undefined && Date.now() - startedAt > closeAfter) ? "closed" : "running"),
    hold: (question) => {
      held.push(question);
    },
    ...plan,
  };
  return { dir, runDir, held, plan: full };
}

function calls(c: Case): FakeHcCall[] {
  const file = join(c.dir, "calls.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").trim().split("\n").map((line): FakeHcCall => JSON.parse(line));
}

function callsOf(c: Case, method: string): FakeHcCall[] {
  return calls(c).filter((call) => call.method === method);
}

function runLog(c: Case): string {
  const file = join(c.runDir, "run.log");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

test("no sandbox: hc runs the harness argv with the first message in it, the run variables in the API's env, no parent, the run's label; the ledger ends the run", async () => {
  const c = setup("plain", { states: ["live:working"], closeAfterMs: 200 });
  const result = await launchHc(c.plan);
  assert.match(result.stderrTail, /hc surface: the run ended in the ledger/u);
  assert.equal(result.timedOut, false);
  const [run] = callsOf(c, "terminal.run");
  assert.deepEqual(run?.params.argv, ["/opt/claude", "Run ritual x now.", "--settings", "/run/settings.json"]);
  assert.deepEqual(run?.params.env, { DARIUS_RUN: "r1", DARIUS_PROJECT: "p1" });
  assert.equal(run?.params.no_parent, true);
  assert.equal(run?.params.no_notify, true);
  assert.equal(run?.params.cwd, c.dir);
  assert.equal(run?.params.name, agentName(c.plan.run));
  assert.deepEqual(run?.params.labels, { darius_ritual: "x", darius_run: c.plan.run });
  assert.equal(callsOf(c, "terminal.send").length, 0, "the agent worked: the prompt in the argv landed, no resend");
  assert.equal(callsOf(c, "terminal.kill").length, 0, "a finished run's terminal stays");
  assert.ok(callsOf(c, "terminal.wait").length > 0, "it waits with hc wait, not a bare sleep");
  assert.deepEqual(recordedTerminals(c.runDir), ["t1"]);
  assert.equal(runLog(c), "");
});

test("masked: the sandbox argv goes straight in front of the harness; bwrap in the foreground is proof, no log line", async () => {
  const c = setup("masked", { states: ["live:working"], closeAfterMs: 200 }, { sandbox: SANDBOX_ARGV });
  await launchHc(c.plan);
  assert.deepEqual(callsOf(c, "terminal.run")[0]?.params.argv, [...SANDBOX_ARGV, "/opt/claude", "Run ritual x now.", "--settings", "/run/settings.json"]);
  assert.equal(runLog(c), "");
});

test("masked, but hc shows no bwrap in the foreground: the run goes on, and its log says it is unmasked", async () => {
  const c = setup("mask-lost", { states: ["live:working"], foreground: "claude", closeAfterMs: 200 }, { sandbox: SANDBOX_ARGV });
  const result = await launchHc(c.plan);
  assert.equal(result.boxBroken, undefined);
  assert.match(runLog(c), /sandbox: this run starts UNMASKED.*hc shows claude in the terminal's foreground, not bwrap/u);
});

test("the box fails closed: no bwrap in the foreground, or bwrap under another pid, kills the terminal and ends the launch as boxBroken", async () => {
  const named = setup("box-name", { states: ["live:working"], foreground: "systemd-run" }, { sandbox: SANDBOX_ARGV, isBox: true });
  const first = await launchHc(named.plan);
  assert.match(first.boxBroken ?? "", /hc shows systemd-run in the terminal's foreground, not bwrap/u);
  assert.equal(callsOf(named, "terminal.kill").length, 1);
  assert.equal(callsOf(named, "terminal.send").length, 0);

  const pid = setup("box-pid", { states: ["live:working"], otherPid: true }, { sandbox: SANDBOX_ARGV, isBox: true });
  const second = await launchHc(pid.plan);
  assert.ok(second.boxBroken !== undefined, "bwrap that is not the terminal's own process is no proof");
  assert.equal(callsOf(pid, "terminal.kill").length, 1);

  const proved = setup("box-ok", { states: ["live:working"], closeAfterMs: 200 }, { sandbox: SANDBOX_ARGV, isBox: true });
  const third = await launchHc(proved.plan);
  assert.equal(third.boxBroken, undefined);
  assert.equal(callsOf(proved, "terminal.kill").length, 0);
});

test("the agent stays idle with no sign of work: one resend by terminal.send, only into an idle agent, with a run.log line", async () => {
  const c = setup("idle-once", { states: ["live:idle"], afterSend: { 1: ["live:working", "finished"] } });
  const result = await launchHc(c.plan);
  const sends = callsOf(c, "terminal.send");
  assert.equal(sends.length, 1);
  assert.deepEqual(sends[0]?.params, { terminal: "t1", text: "Run ritual x now.", if: "idle" });
  assert.match(result.stderrTail, /the agent exited/u);
  const lines = runLog(c).trim().split("\n");
  assert.equal(lines.length, 1, runLog(c));
  assert.match(lines[0] ?? "", /hc: the first message did not land \(the agent stayed idle for 150 ms with no sign of work\); sending it again \(resend 1 of 2\)/u);
});

test("at most two resends; the gate log growing after a send counts as landed", async () => {
  const twice = setup("idle-always", { states: ["live:idle"] }, { graceMs: 300 });
  await launchHc(twice.plan);
  assert.equal(callsOf(twice, "terminal.send").length, 2);
  assert.equal(twice.held.length, 1, "after the resends the watch holds the idle agent");

  const gate = setup("gate-grew", { states: ["live:idle"], gateAfterSend: 1, closeAfterMs: 1_500 });
  await launchHc(gate.plan);
  assert.equal(callsOf(gate, "terminal.send").length, 1, "the gate log grew after the first resend: no second one");
});

test("an agent blocked past the grace time holds the run with a question that names how to attach", async () => {
  const c = setup("blocked", { states: ["live:blocked"] }, { target: { bin: "", session: "iso" } });
  c.plan.target.bin = join(c.dir, "hc");
  await launchHc(c.plan);
  assert.equal(c.held.length, 1);
  assert.match(c.held[0] ?? "", new RegExp(`waits at a dialog in hc terminal ${agentName(c.plan.run)}; attach with HC_SESSION=iso hc attach ${agentName(c.plan.run)}`, "u"));
  assert.equal(callsOf(c, "terminal.kill").length, 0, "a held run keeps its terminal");
  assert.equal(attachCommand({ bin: "hc" }, "d-x"), "hc attach d-x");
});

test("in the watch: idle past the grace time holds; a terminal that never reported and whose gate log never grew holds too", async () => {
  const idle = setup("watch-idle", { states: ["live:working", "live:working", "live:idle"] });
  await launchHc(idle.plan);
  assert.equal(idle.held.length, 1);
  assert.match(idle.held[0] ?? "", /the agent waits for input in hc terminal d-\S+ \(idle for over 0 min\); attach with hc attach /u);

  const silent = setup("watch-silent", { states: ["live:-"] }, { confirmMs: 100 });
  await launchHc(silent.plan);
  assert.equal(silent.held.length, 1);
  assert.match(silent.held[0] ?? "", /\(silent, perhaps at a startup dialog such as the folder trust question, for over/u);
});

test("timeout: the terminal is killed and the launch reports timedOut", async () => {
  const c = setup("slow", { states: ["live:working"] }, { timeoutMs: 300 });
  const result = await launchHc(c.plan);
  assert.equal(result.timedOut, true);
  assert.match(result.stderrTail, /the run timed out/u);
  assert.deepEqual(callsOf(c, "terminal.kill").map((call) => call.params.terminal), ["t1"]);
});

test("a missing hc: the launch never throws and says why; hcUnavailable names the reason", async () => {
  const c = setup("missing", {}, { target: { bin: join(ROOT, "no-hc") } });
  const result = await launchHc(c.plan);
  assert.match(result.spawnError ?? "", /ENOENT/u);
  assert.match((await hcUnavailable({ bin: join(ROOT, "no-hc") })) ?? "", /^hc is not installed here/u);
  const down = setup("down");
  assert.equal(await hcUnavailable(down.plan.target), null);
  writeFileSync(join(down.dir, "unavailable"), "");
  assert.match((await hcUnavailable(down.plan.target)) ?? "", /^the hc core does not answer \(unavailable: the core is down\)/u);
});

test("cleanup: a finished run's terminals are killed when live, then removed, by the tab rule; a held run and a foreign terminal stay", async () => {
  const c = setup("cleanup");
  const runsDir = join(c.dir, "runs");
  const record = (run: string, terminals: string[]): void => {
    mkdirSync(join(runsDir, run), { recursive: true });
    writeFileSync(join(runsDir, run, "hc.json"), `${JSON.stringify({ terminals })}\n`);
  };
  const terminal = (address: string, run: string, state: "live" | "finished"): void => {
    const labels = { darius_run: run };
    writeFileSync(join(c.dir, `${address}.json`), JSON.stringify({ address, name: address, argv: ["/opt/claude"], cwd: c.dir, labels, env: {}, pid: 4000, state, status: "-", reported: false }));
  };
  // t1 live and t2 finished for the old run, t3 for the held run, t4 labelled for another run than the one that records it.
  terminal("t1", "OLD", "live");
  terminal("t2", "OLD", "finished");
  terminal("t3", "HELD", "live");
  terminal("t4", "OTHER", "live");
  record("OLD", ["t1", "t2"]);
  record("HELD", ["t3"]);
  record("STALE", ["t4"]);
  const old = "2026-11-01T00:00:00.000Z";
  const runs = [
    { run: "OLD", item: "ritual/x", phase: "closed" as const, startedAt: old, endedAt: old },
    { run: "HELD", item: "ritual/y", phase: "held" as const, startedAt: old },
    { run: "STALE", item: "ritual/z", phase: "closed" as const, startedAt: old, endedAt: old },
  ];
  const before = calls(c).length;
  const removed = await closeFinishedTerminals(runsDir, runs, Date.parse("2026-11-11T00:00:00.000Z"), c.plan.target);
  assert.equal(removed, 2);
  const after = calls(c).slice(before);
  assert.deepEqual(after.filter((call) => call.method === "terminal.kill").map((call) => call.params.terminal), ["t1"], "only the live one is killed");
  assert.deepEqual(after.filter((call) => call.method === "terminal.rm").map((call) => call.params.terminal), ["t1", "t2"]);
  assert.ok(after.every((call) => call.params.terminal !== "t3"), "a held run keeps its terminal");
  assert.ok(after.every((call) => call.method === "terminal.get" || call.params.terminal !== "t4"), "a terminal labelled for another run is left alone");
  assert.equal(existsSync(join(runsDir, "OLD", "hc.json")), false);
  assert.equal(existsSync(join(runsDir, "HELD", "hc.json")), true);
  assert.equal(existsSync(join(runsDir, "STALE", "hc.json")), false, "the record of a due run goes, also when its terminal was not ours");
});
