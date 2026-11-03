/**
 * The box broker (src/core/box-broker.ts, M4 spec 04) and its client in
 * src/cli/run.ts. The broker passes exactly `run hold <run> --question Q...`
 * and `run complete <run> --outcome X [--findings-stdin] [--json]` for its own
 * run, runs the real CLI with an env built from scratch, and hands back what
 * it printed. Everything here runs in a throwaway store; the client finds the
 * socket through DARIUS_BOX_BROKER, so no test needs a real /run/darius.
 *
 * The client runs as a child process with `spawn`, never `spawnSync`: the
 * broker lives in this process, and a blocked event loop would never answer.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs } from "../src/cli/args.ts";
import type { Command, ParsedArgs } from "../src/cli/registry.ts";
import { ritualCommand } from "../src/cli/ritual.ts";
import { runCommand } from "../src/cli/run.ts";
import { askBroker, BROKER_STDIN_MAX, brokerEnv, checkBrokerArgv, startBroker, type Broker, type BrokerOptions, type BrokerReply } from "../src/core/box-broker.ts";
import { readLedger } from "../src/core/ledger.ts";
import type { LedgerLine } from "../src/core/model.ts";
import { projectDir } from "../src/core/paths.ts";
import { openProject } from "../src/core/store.ts";
import type { ChildEnv } from "../src/surface/headless.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-box-broker-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");

const BIN = join(import.meta.dirname, "..", "bin", "darius");
const RUNTIMES = ["node", "bun"] as const;
const WHO = "claude:box-run";
const BLOCK = JSON.stringify({ v: 1, status: "ok", summary: "checked" });
const GOOD_FINDINGS = `all good\n\`\`\`darius-result\n${BLOCK}\n\`\`\`\n`;

async function cli(command: Command, project: string, argv: string[]): Promise<string> {
  const args: ParsedArgs = parseArgs([...argv, "--project", project]);
  const out: string[] = [];
  const { log } = console;
  console.log = (...parts: string[]) => out.push(parts.join(" "));
  try {
    assert.equal(await command.run(args), 0, argv.join(" "));
  } finally {
    console.log = log;
  }
  return out.join("\n");
}

/** A running run of a new ritual in `project`, with a policy.json that asks for a result block. */
async function startedRun(project: string): Promise<string> {
  await cli(ritualCommand, project, ["add", "heartbeat", "--title", "Heartbeat", "--cadence", "1d"]);
  const run: string = JSON.parse(await cli(runCommand, project, ["start", "heartbeat", "--json"])).run;
  const dir = join(projectDir(project), "runs", run);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "policy.json"), `${JSON.stringify({ run, project, result: "required" })}\n`);
  return run;
}

interface Fixture {
  project: string;
  run: string;
  socket: string;
  options: BrokerOptions;
  broker: Broker;
}

let sockets = 0;

async function fixture(project: string, extra: Partial<BrokerOptions> = {}): Promise<Fixture> {
  const run = await startedRun(project);
  sockets += 1;
  const socket = join(SANDBOX, `b${String(sockets)}.sock`);
  const options: BrokerOptions = { socketPath: socket, run, project, who: WHO, darius: [BIN], ...extra };
  const broker = await startBroker(options);
  return { project, run, socket, options, broker };
}

function linesOf(project: string, run: string, type: string): LedgerLine[] {
  return readLedger(openProject(project)).filter((line) => line.type === type && line.run === run);
}

/** Sends one raw line to the socket and returns the reply line as text. */
function sendRaw(socket: string, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const connection = createConnection(socket);
    let text = "";
    connection.setEncoding("utf8");
    connection.on("data", (chunk: string) => {
      text += chunk;
    });
    connection.once("end", () => resolve(text));
    connection.on("error", reject);
    connection.once("connect", () => connection.write(payload));
  });
}

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs bin/darius as a child process, asynchronously. */
function spawnCli(argv: readonly string[], env: ChildEnv, input = ""): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(BIN, [...argv], { env, cwd: SANDBOX, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

/**
 * The env of a process inside the box: the socket, the run, and a store dir
 * of its own that has no such run. A client that wrote locally would fail.
 */
function insideEnv(socket: string, run: string, runtime: string): ChildEnv {
  const inside = join(SANDBOX, "inside-state");
  mkdirSync(inside, { recursive: true });
  return {
    PATH: process.env.PATH ?? "",
    HOME: SANDBOX,
    DARIUS_RUNTIME: runtime,
    DARIUS_BOX_BROKER: socket,
    DARIUS_RUN: run,
    DARIUS_STATE_DIR: inside,
    DARIUS_CONFIG_DIR: join(SANDBOX, "inside-config"),
  };
}

// --- the argv check -------------------------------------------------------------

test("the two good shapes pass, rebuilt in the --flag=value form", () => {
  const run = "01RUN";
  assert.deepEqual(checkBrokerArgv(["run", "hold", run, "--question", "Push?", "--question=Which -h branch?"], run), {
    argv: ["run", "hold", run, "--question=Push?", "--question=Which -h branch?"],
    stdin: false,
  });
  assert.deepEqual(checkBrokerArgv(["run", "complete", run, "--outcome", "complete", "--findings-stdin", "--json"], run), {
    argv: ["run", "complete", run, "--outcome=complete", "--findings-stdin", "--json"],
    stdin: true,
  });
  // run.ts reads --outcome=complete the same as --outcome complete (src/cli/args.ts), so the broker takes both.
  assert.deepEqual(checkBrokerArgv(["run", "complete", run, "--outcome=failed"], run), { argv: ["run", "complete", run, "--outcome=failed"], stdin: false });
  // A question that starts with -- is only safe in the = form.
  assert.deepEqual(checkBrokerArgv(["run", "hold", run, "--question=--who x"], run), { argv: ["run", "hold", run, "--question=--who x"], stdin: false });
});

test("every other shape is refused with one line", () => {
  const run = "01RUN";
  const refused: string[][] = [
    ["run", "hold", "01OTHER", "--question", "q"],
    ["run", "complete", "01OTHER", "--outcome", "complete"],
    ["run", "hold", run, "--question", "q", "--who", "operator"],
    ["run", "hold", run, "--question", "q", "--who=operator"],
    ["run", "complete", run, "--outcome", "complete", "--project", "other"],
    ["run", "complete", run, "--outcome", "complete", "--project=other"],
    ["run", "hold", run, "--question", "q", "--on", "host-b"],
    ["run", "hold", run, "--question", "q", "-h"],
    ["run", "hold", run, "--help"],
    ["run", "complete", run, "--outcome", "complete", "--help=x"],
    ["run", "complete", run, "--outcome", "complete", "--note", "x"],
    ["run", "complete", run, "--outcome", "complete", "--bogus"],
    ["run", "complete", run, "--outcome", "complete", "--banner"],
    ["run", "complete", run, "--outcome", "complete", "--stdin"],
    ["run", "hold", run, "--question", "q", "--json"],
    ["run", "hold", run, "--question", "q", "--", "--who"],
    ["run", "hold", run, "--question", "q", "extra"],
    ["run", "hold", run, "--question", "--who"],
    ["run", "hold", run, "--question"],
    ["run", "hold", run],
    ["run", "hold", run, "-q", "x"],
    ["run", "complete", run],
    ["run", "complete", run, "--outcome", "done"],
    ["run", "complete", run, "--outcome", "complete", "--outcome", "failed"],
    ["run", "complete", run, "--outcome", "complete", "--json", "--json"],
    ["run", "complete", run, "--outcome", "complete", "--json=1"],
    ["run", "answer", run, "1", "yes"],
    ["run", "ack", run],
    ["ritual", "list"],
    ["run"],
    [],
  ];
  for (const argv of refused) {
    const checked = checkBrokerArgv(argv, run);
    assert.ok("refused" in checked, `must refuse: ${JSON.stringify(argv)}`);
    assert.doesNotMatch(checked.refused, /\n/u);
  }
});

test("the child env is built from scratch: run, policy, project and who from the broker, never from the runner's DARIUS_ vars", () => {
  const options: BrokerOptions = {
    socketPath: "/unused",
    run: "01RUN",
    project: "p1",
    who: WHO,
    darius: [BIN],
    sourceEnv: { HOME: "/home/x", PATH: "/bin", DARIUS_STATE_DIR: "/s", DARIUS_WHO: "evil", DARIUS_RUN: "01OTHER", DARIUS_PROJECT: "other", SSH_AUTH_SOCK: "/a" },
  };
  assert.deepEqual(brokerEnv(options, "/runs/01RUN"), {
    HOME: "/home/x",
    PATH: "/bin",
    DARIUS_STATE_DIR: "/s",
    DARIUS_RUN: "01RUN",
    DARIUS_RUN_POLICY: "/runs/01RUN/policy.json",
    DARIUS_PROJECT: "p1",
    DARIUS_WHO: WHO,
    DARIUS_BOX_BROKER: "",
  });
});

// --- the broker over its socket --------------------------------------------------------

test("hold through the broker writes run.held as the run's who; refusals are exit 2 and one stderr line; the log has every request", async () => {
  const f = await fixture("bb-hold");
  try {
    assert.equal(statSync(f.socket).mode & 0o777, 0o600);
    const refusedCommands: string[][] = [
      ["run", "hold", "01OTHERRUN", "--question", "q"],
      ["run", "hold", f.run, "--question", "q", "--who", "operator"],
      ["run", "hold", f.run, "--question", "q", "--project", "other"],
      ["run", "hold", f.run, "--question", "q", "--on", "host-b"],
      ["run", "hold", f.run, "-h"],
      ["run", "hold", f.run, "--help"],
      ["run", "hold", f.run, "--question", "q", "--note", "x"],
      ["run", "hold", f.run, "--question", "q", "--unknown"],
      ["run", "hold", f.run, "--", "--question", "q"],
      ["run", "answer", f.run, "1", "yes"],
    ];
    for (const argv of refusedCommands) {
      const reply = await askBroker(f.socket, { argv });
      assert.equal(reply.exit, 2, argv.join(" "));
      assert.equal(reply.stdout, "");
      assert.match(reply.stderr, /^darius: box broker: [^\n]+\n$/u, argv.join(" "));
    }
    assert.equal(linesOf(f.project, f.run, "run.held").length, 0, "nothing refused reached the store");

    const held = await askBroker(f.socket, { argv: ["run", "hold", f.run, "--question", "Push now?", "--question=Which branch?", "--project", f.project] });
    assert.equal(held.exit, 0, held.stderr);
    assert.match(held.stdout, new RegExp(`✓ held run ${f.run} with 2 question\\(s\\)`, "u"));
    const lines = linesOf(f.project, f.run, "run.held");
    assert.equal(lines.length, 1);
    assert.deepEqual(lines[0]?.questions, ["Push now?", "Which branch?"]);
    assert.equal(lines[0]?.who, WHO);

    const log = readFileSync(join(projectDir(f.project), "runs", f.run, "broker.jsonl"), "utf8").trim().split("\n");
    assert.equal(log.length, refusedCommands.length + 1);
    const last: { exit: number; argv: string[]; refused?: string } = JSON.parse(log.at(-1) ?? "{}");
    assert.equal(last.exit, 0);
    assert.equal(last.refused, undefined);
    assert.equal(JSON.parse(log[0] ?? "{}").exit, 2);
  } finally {
    await f.broker.close();
  }
  assert.equal(existsSync(f.socket), false, "close removes the socket");
});

test("a request's env is never read: the line names the broker's who and run, not what the request claims", async () => {
  const f = await fixture("bb-env", { sourceEnv: { ...process.env, DARIUS_WHO: "evil-runner-env" } });
  try {
    const request = {
      argv: ["run", "hold", f.run, "--question", "q"],
      env: { DARIUS_RUN: "01OTHERRUN", DARIUS_WHO: "operator", DARIUS_PROJECT: "other", DARIUS_STATE_DIR: "/elsewhere" },
    };
    const reply: BrokerReply = JSON.parse(await sendRaw(f.socket, `${JSON.stringify(request)}\n`));
    assert.equal(reply.exit, 0, reply.stderr);
    const lines = linesOf(f.project, f.run, "run.held");
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.who, WHO);
    assert.equal(existsSync("/elsewhere"), false);
  } finally {
    await f.broker.close();
  }
});

test("an oversized stdin and an oversized request are refused before anything runs", async () => {
  const f = await fixture("bb-size");
  try {
    const big = "x".repeat(BROKER_STDIN_MAX + 1);
    const reply = await askBroker(f.socket, { argv: ["run", "complete", f.run, "--outcome", "complete", "--findings-stdin"], stdin: big });
    assert.equal(reply.exit, 2);
    assert.match(reply.stderr, new RegExp(`at most ${String(BROKER_STDIN_MAX)}`, "u"));
    const flood: BrokerReply = JSON.parse(await sendRaw(f.socket, "x".repeat(7 * BROKER_STDIN_MAX)));
    assert.equal(flood.exit, 2);
    assert.match(flood.stderr, /the request is over/u);
    const junk: BrokerReply = JSON.parse(await sendRaw(f.socket, "not json\n"));
    assert.equal(junk.exit, 2);
    assert.equal(linesOf(f.project, f.run, "run.completed").length, 0);
  } finally {
    await f.broker.close();
  }
});

test("a child over the timeout is killed, and a second request while one runs is refused", async () => {
  const f = await fixture("bb-slow", { darius: [process.execPath, "-e", "setTimeout(() => {}, 10000)"], timeoutMs: 400 });
  try {
    const argv = ["run", "hold", f.run, "--question", "q"];
    const [first, second] = await Promise.all([askBroker(f.socket, { argv }), askBroker(f.socket, { argv })]);
    const replies = [first, second].toSorted((a, b) => a.stderr.localeCompare(b.stderr));
    assert.equal(replies[0]?.exit, 1);
    assert.match(replies[0]?.stderr ?? "", /another request is running/u);
    assert.equal(replies[1]?.exit, 1);
    assert.match(replies[1]?.stderr ?? "", /ran over 0\.4 s and was stopped/u);
  } finally {
    await f.broker.close();
  }
});

test("a NUL byte or a non-text word in argv is refused, and the broker keeps serving", async () => {
  const run = "01RUN";
  const nul = checkBrokerArgv(["run", "hold", run, "--question=a\u0000b"], run);
  assert.ok("refused" in nul);
  assert.match(nul.refused, /NUL/u);
  const f = await fixture("bb-nul");
  try {
    const odd: BrokerReply = JSON.parse(await sendRaw(f.socket, `${JSON.stringify({ argv: ["run", "hold", f.run, 7] })}\n`));
    assert.equal(odd.exit, 2);
    assert.match(odd.stderr, /a list of words/u);
    const reply = await askBroker(f.socket, { argv: ["run", "hold", f.run, "--question=a\u0000b"] });
    assert.equal(reply.exit, 2);
    assert.match(reply.stderr, /NUL/u);
    const after = await askBroker(f.socket, { argv: ["run", "hold", f.run, "--question", "still here?"] });
    assert.equal(after.exit, 0, after.stderr);
    assert.equal(linesOf(f.project, f.run, "run.held").length, 1);
  } finally {
    await f.broker.close();
  }
});

test("a spawn that throws becomes an error reply, and the broker keeps serving", async () => {
  // A NUL in the program path makes spawn throw synchronously.
  const f = await fixture("bb-throw", { darius: ["/bin/true\u0000x"] });
  try {
    const argv = ["run", "hold", f.run, "--question", "q"];
    const first = await askBroker(f.socket, { argv });
    assert.equal(first.exit, 1);
    assert.match(first.stderr, /cannot run darius/u);
    const second = await askBroker(f.socket, { argv });
    assert.equal(second.exit, 1);
    assert.match(second.stderr, /cannot run darius/u);
  } finally {
    await f.broker.close();
  }
});

// --- the client in src/cli/run.ts, end to end ---------------------------------------------

for (const runtime of RUNTIMES) {
  test(`${runtime}: a refused result block comes back with the same text and exit code as a direct call`, async () => {
    const f = await fixture(`bb-refuse-${runtime}`);
    try {
      const argv = ["run", "complete", f.run, "--outcome", "complete", "--findings-stdin"];
      const bad = "no result block here\n";
      const boxed = await spawnCli(argv, insideEnv(f.socket, f.run, runtime), bad);
      const runDir = join(projectDir(f.project), "runs", f.run);
      const direct = await spawnCli(argv, { ...brokerEnv(f.options, runDir), DARIUS_RUNTIME: runtime }, bad);
      assert.equal(direct.code, 1, direct.stderr);
      assert.match(direct.stdout, /darius refused the findings/u);
      assert.deepEqual(boxed, direct);
      assert.equal(linesOf(f.project, f.run, "run.completed").length, 0);
    } finally {
      await f.broker.close();
    }
  });

  test(`${runtime}: hold and a good complete through the client write the store outside, as the run's who`, async () => {
    const f = await fixture(`bb-complete-${runtime}`);
    try {
      const env = insideEnv(f.socket, f.run, runtime);
      const held = await spawnCli(["run", "hold", f.run, "--question", "May I?"], env);
      assert.equal(held.code, 0, held.stderr);
      assert.equal(linesOf(f.project, f.run, "run.held").length, 1);

      const who = await spawnCli(["run", "complete", f.run, "--outcome", "complete", "--who", "operator"], env);
      assert.equal(who.code, 2);
      assert.match(who.stderr, /^darius: box broker: run complete: --who is not allowed through the box broker\n$/u);

      const done = await spawnCli(["run", "complete", f.run, "--outcome=complete", "--findings-stdin", "--json"], env, GOOD_FINDINGS);
      assert.equal(done.code, 0, done.stderr);
      assert.deepEqual(JSON.parse(done.stdout).ok, true);
      const completed = linesOf(f.project, f.run, "run.completed");
      assert.equal(completed.length, 1);
      assert.equal(completed[0]?.outcome, "complete");
      assert.equal(completed[0]?.who, WHO);
      assert.equal(existsSync(join(SANDBOX, "inside-state", f.project)), false, "the inside store was never written");
    } finally {
      await f.broker.close();
    }
  });
}

test("outside a box nothing changes: no socket at the path, run hold runs locally", async () => {
  const run = await startedRun("bb-local");
  const result = await spawnCli(["run", "hold", run, "--question", "q", "--project", "bb-local"], {
    PATH: process.env.PATH ?? "",
    HOME: SANDBOX,
    DARIUS_BOX_BROKER: join(SANDBOX, "no-such.sock"),
    DARIUS_STATE_DIR: process.env.DARIUS_STATE_DIR ?? "",
    DARIUS_CONFIG_DIR: process.env.DARIUS_CONFIG_DIR ?? "",
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(linesOf("bb-local", run, "run.held").length, 1);
});

test("--project passes only as this run's own project, and is never passed on", () => {
  const run = "01JBOXRUN0000000000000000";
  assert.deepEqual(checkBrokerArgv(["run", "complete", run, "--outcome", "complete", "--project", "mine"], run, "mine"), { argv: ["run", "complete", run, "--outcome=complete"], stdin: false });
  assert.deepEqual(checkBrokerArgv(["run", "hold", run, "--question", "q", "--project=mine"], run, "mine"), { argv: ["run", "hold", run, "--question=q"], stdin: false });
  for (const argv of [["run", "complete", run, "--outcome", "complete", "--project", "other"], ["run", "hold", run, "--question", "q", "--project", "mine", "--project", "other"]]) {
    assert.ok("refused" in checkBrokerArgv(argv, run, "mine"), argv.join(" "));
  }
  assert.ok("refused" in checkBrokerArgv(["run", "hold", run, "--question", "q", "--project", "mine"], run), "no project known: refused");
});

