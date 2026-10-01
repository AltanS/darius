/**
 * The hook verbs and the delegation validator that came from the tracker
 * plugin (0.60.0): `darius hook-stop`, `darius hook-drift` and `darius
 * delegation`. Each test runs the CLI in a throwaway checkout. The hooks fail
 * open, so most cases assert exit 0 and no output.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BIN = join(import.meta.dirname, "..", "bin", "darius");
const RUNTIMES = ["node", "bun"] as const;

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function cli(argv: string[], opts: { cwd: string; input?: string; runtime?: string }): CliResult {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: join(opts.cwd, ".home"),
    DARIUS_RUNTIME: opts.runtime ?? "node",
  };
  delete env.TRACKER_LOOP_DEBUG;
  delete env.TRACKER_LOOP_DEBUG_FILE;
  delete env.TRACKER_DRIFT_DEBUG;
  const result = spawnSync(BIN, argv, { encoding: "utf8", env, cwd: opts.cwd, input: opts.input ?? "", timeout: 20_000 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "darius-hooks-"));
}

/** A checkout whose worklog holds one open thread in the `planned` stage. */
function stuckCheckout(): string {
  const root = scratch();
  mkdirSync(join(root, ".tracker", "worklog"), { recursive: true });
  const opened = cli(["worklog", "open", "t-stuck", "--stage", "planned"], { cwd: root });
  assert.equal(opened.code, 0, opened.stderr);
  return root;
}

function stopPayload(root: string, extra: Record<string, string> = {}): string {
  return JSON.stringify({ hook_event_name: "Stop", session_id: "sess-1", cwd: root, ...extra });
}

test("hook-stop blocks a Stop with an open planned thread, under both runtimes", () => {
  for (const runtime of RUNTIMES) {
    const root = stuckCheckout();
    const result = cli(["hook-stop"], { cwd: root, input: stopPayload(root), runtime });
    assert.equal(result.code, 0, result.stderr);
    const decision = JSON.parse(result.stdout);
    assert.equal(decision.decision, "block");
    assert.match(decision.reason, /^Work Loop incomplete: finish it or park it before ending the turn\.\nSTATUS: stuck\n/u);
    assert.match(decision.reason, /t-stuck/u);
    assert.doesNotMatch(result.stdout, /—/u);
  }
});

test("hook-stop finds the tracker from the payload cwd, and spends the bounce budget before it lets go", () => {
  const root = stuckCheckout();
  const elsewhere = scratch();
  const payload = stopPayload(root, { session_id: "sess-budget" });
  for (const round of [1, 2]) {
    const blocked = cli(["hook-stop"], { cwd: elsewhere, input: payload });
    assert.equal(JSON.parse(blocked.stdout).decision, "block", `round ${String(round)}`);
  }
  const third = cli(["hook-stop"], { cwd: elsewhere, input: payload });
  assert.equal(third.code, 0);
  const message = JSON.parse(third.stdout);
  assert.equal(message.decision, undefined);
  assert.match(message.systemMessage, /^⚠ Turn ended mid-Work-Loop \(bounce budget exhausted\)\. Stuck threads:\nSTATUS: exhausted/u);
});

test("hook-stop treats SubagentStop of darius like Stop and passes every other subagent", () => {
  const root = stuckCheckout();
  const own = cli(["hook-stop"], { cwd: root, input: stopPayload(root, { hook_event_name: "SubagentStop", agent_type: "darius", agent_id: "a1" }) });
  assert.equal(JSON.parse(own.stdout).decision, "block");
  const foreign = cli(["hook-stop"], { cwd: root, input: stopPayload(root, { hook_event_name: "SubagentStop", agent_type: "typescript:typescript-expert", agent_id: "a2" }) });
  assert.equal(foreign.code, 0);
  assert.equal(foreign.stdout, "");
  const none = cli(["hook-stop"], { cwd: root, input: stopPayload(root, { hook_event_name: "SubagentStop" }) });
  assert.equal(none.stdout, "");
  const other = cli(["hook-stop"], { cwd: root, input: stopPayload(root, { hook_event_name: "PreToolUse" }) });
  assert.equal(other.stdout, "");
});

test("hook-stop fails open: no .tracker, bad JSON, empty stdin, a clean worklog", () => {
  const bare = scratch();
  const cases: [string, string][] = [
    [bare, stopPayload(bare)],
    [stuckCheckout(), "{not json"],
    [stuckCheckout(), ""],
    [stuckCheckout(), "[1, 2]"],
  ];
  for (const [cwd, input] of cases) {
    const result = cli(["hook-stop"], { cwd, input });
    assert.equal(result.code, 0, input);
    assert.equal(result.stdout, "", input);
    assert.equal(result.stderr, "", input);
  }
  const clean = scratch();
  mkdirSync(join(clean, ".tracker"));
  assert.equal(cli(["hook-stop"], { cwd: clean, input: stopPayload(clean) }).stdout, "");
});

test("hook-stop honours TRACKER_LOOP_DEBUG_FILE", () => {
  const root = scratch();
  const log = join(root, "debug.log");
  const env = { ...process.env, DARIUS_RUNTIME: "node", TRACKER_LOOP_DEBUG_FILE: log };
  const result = spawnSync(BIN, ["hook-stop"], { encoding: "utf8", env, cwd: root, input: JSON.stringify({ hook_event_name: "Notification" }) });
  assert.equal(result.status, 0);
  assert.match(readFileSync(log, "utf8"), /^loop-gate: event=Notification agent_type=<empty>/mu);
  assert.match(readFileSync(log, "utf8"), /unrecognized event \(Notification\), pass/u);
});

/** A checkout with one spec that names `src/app.ts`. */
function specCheckout(): string {
  const root = scratch();
  mkdirSync(join(root, ".tracker", "M1-cart"), { recursive: true });
  writeFileSync(join(root, ".tracker", "M1-cart", "01-totals.md"), "# Totals\n\n- [ ] edit `src/app.ts`\n");
  return root;
}

function editPayload(file: string): string {
  return JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: file } });
}

test("hook-drift appends a tracked file to .pending-sync once, absolute or relative, under both runtimes", () => {
  for (const runtime of RUNTIMES) {
    const root = specCheckout();
    const pending = join(root, ".tracker", ".pending-sync");
    const first = cli(["hook-drift"], { cwd: root, input: editPayload(join(root, "src", "app.ts")), runtime });
    assert.equal(first.code, 0, first.stderr);
    assert.equal(first.stdout, "");
    assert.equal(readFileSync(pending, "utf8"), "src/app.ts\n");
    cli(["hook-drift"], { cwd: root, input: editPayload(join(root, "src", "app.ts")), runtime });
    cli(["hook-drift"], { cwd: root, input: editPayload("src/app.ts"), runtime });
    assert.equal(readFileSync(pending, "utf8"), "src/app.ts\n", "no duplicate line");
    assert.deepEqual(readdirSync(join(root, ".tracker")).toSorted(), [".pending-sync", "M1-cart"], "nothing else is written");
  }
});

test("hook-drift leaves an untracked file, an edit inside .tracker, and a bad payload alone", () => {
  const root = specCheckout();
  const before = readdirSync(join(root, ".tracker")).toSorted();
  const inputs = [
    editPayload(join(root, "src", "other.ts")),
    editPayload(join(root, ".tracker", "M1-cart", "01-totals.md")),
    JSON.stringify({ tool_input: {} }),
    JSON.stringify({ tool_input: "text" }),
    "{not json",
    "",
  ];
  for (const input of inputs) {
    const result = cli(["hook-drift"], { cwd: root, input });
    assert.equal(result.code, 0, input);
    assert.equal(result.stdout, "", input);
  }
  assert.deepEqual(readdirSync(join(root, ".tracker")).toSorted(), before);
  assert.ok(!existsSync(join(root, ".tracker", ".pending-sync")));
  const bare = scratch();
  assert.equal(cli(["hook-drift"], { cwd: bare, input: editPayload("src/app.ts") }).code, 0);
  assert.deepEqual(readdirSync(bare).filter((name) => name !== ".home"), []);
});

test("hook-drift reads filePath too", () => {
  const root = specCheckout();
  const input = JSON.stringify({ tool_input: { filePath: join(root, "src", "app.ts") } });
  cli(["hook-drift"], { cwd: root, input });
  assert.equal(readFileSync(join(root, ".tracker", ".pending-sync"), "utf8"), "src/app.ts\n");
});

const GOOD_ENVELOPE = JSON.stringify({
  spec_path: "/repo/.tracker/M1-cart/01-totals.md",
  milestone_slug: "M1-cart",
  thread_id: "01HZ-totals",
  worklog_path: "/repo/.tracker/worklog/m1-cart.md",
  task: "Add the totals line",
  verification: [{ command: "bun test", expected: "exit 0" }],
  prior_artifacts: [],
});

test("delegation validate accepts a good envelope and rejects a bad one", () => {
  const cwd = scratch();
  for (const runtime of RUNTIMES) {
    const good = cli(["delegation", "validate", GOOD_ENVELOPE], { cwd, runtime });
    assert.equal(good.code, 0, good.stderr);
    assert.equal(good.stdout, "OK\n");
    assert.equal(cli(["delegation", "validate", '{"task":"alone"}'], { cwd, runtime }).stdout, "OK\n", "task alone is enough outside a worklog");

    const bad = cli(["delegation", "validate", '{"worklog_path":"/w.md","out_of_domain_hint":"Bad_Name"}'], { cwd, runtime });
    assert.equal(bad.code, 1);
    assert.equal(bad.stdout, "");
    assert.deepEqual(bad.stderr.trim().split("\n"), [
      "task: required non-empty string",
      "spec_path: required when worklog_path is set",
      "milestone_slug: required when worklog_path is set",
      "thread_id: required when worklog_path is set",
      "verification: required array (may be empty)",
      "out_of_domain_hint: must be a valid agent name (e.g. 'plugin:agent' or 'bare-name')",
    ]);
  }
});

test("delegation return-validate checks the status, the flags and next_agent", () => {
  const cwd = scratch();
  const good = cli(["delegation", "return-validate", '{"status":"complete","artifacts":["/a.ts"],"verification_run":true,"notes":"done"}'], { cwd });
  assert.equal(good.code, 0, good.stderr);
  assert.equal(good.stdout, "OK\n");
  const bad = cli(["delegation", "return-validate", '{"status":"out-of-domain","verification_run":"yes"}'], { cwd });
  assert.equal(bad.code, 1);
  assert.deepEqual(bad.stderr.trim().split("\n"), [
    "verification_run: must be boolean",
    "next_agent: required when status=\"out-of-domain\", must be a valid agent name (e.g. 'plugin:agent' or 'bare-name')",
  ]);
});

test("delegation exits 2 for a usage error, bad JSON or an unknown mode", () => {
  const cwd = scratch();
  assert.equal(cli(["delegation"], { cwd }).code, 2);
  assert.match(cli(["delegation"], { cwd }).stderr, /usage: darius delegation/u);
  assert.equal(cli(["delegation", "validate"], { cwd }).code, 2);
  const badJson = cli(["delegation", "validate", "{nope"], { cwd });
  assert.equal(badJson.code, 2);
  assert.match(badJson.stderr, /^invalid JSON: /u);
  const unknown = cli(["delegation", "check", "{}"], { cwd });
  assert.equal(unknown.code, 2);
  assert.equal(unknown.stderr, "unknown mode: check\n");
});
