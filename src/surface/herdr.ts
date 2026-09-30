/**
 * The herdr surface: the harness in a herdr tab, so a person can watch the
 * run and type into it (docs/concept.md, "Harnesses, profiles and surfaces"
 * > "Surfaces"). Facts from herdr 0.9.0, read 2026-09-28:
 *
 *   - Outside a pane (a systemd timer) the CLI finds the default server by
 *     itself. `herdr --session <name> ...` talks to a named, isolated one.
 *   - `herdr status` prints `server:` then `status: running` or
 *     `status: not running`, exit 0 either way; it has no JSON form.
 *   - Every other command prints one JSON object: `{"result":{...}}` on
 *     success, `{"error":{"code","message"}}` on stderr with exit 1.
 *   - `agent get` reports `agent_status`: idle, working, blocked, done or
 *     unknown. An agent that exited is `agent_not_found`.
 *
 * The flow per run: find or create the workspace `darius-runs`, create a tab
 * in the working dir with the run variables in its env, start the harness
 * in the tab's root pane, type the first message, then watch the ledger.
 * The run ends when the ledger shows it completed or held. An agent that
 * waits for input (blocked at an approval, or idle after a turn) for longer
 * than the grace time holds the run with a question naming the tab. On
 * timeout the tab is closed and the run fails as a headless one would.
 *
 * A finished run's tab stays open for the person; run-due closes it at the
 * start of the next batch (closeFinishedTabs).
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { JsonValue } from "../core/model.ts";
import { errorMessage } from "../runtime.ts";
import type { ChildEnv, LaunchResult } from "./headless.ts";

export const RUNS_WORKSPACE = "darius-runs";
const HERDR_TIMEOUT_MS = 60_000;
const AGENT_START_TIMEOUT_MS = 60_000;
export const DEFAULT_POLL_MS = 3_000;
/** A new tab's shell takes a moment to reach its prompt; `agent start` refuses it until then. */
const SHELL_READY_TIMEOUT_MS = 30_000;
const SHELL_READY_RETRY_MS = 500;
export const DEFAULT_WAIT_GRACE_MS = 10 * 60_000;
/** Where a run records its tab, so the next batch can close it. */
const TAB_FILE = "herdr.json";

/** The herdr executable and optional named session: `$DARIUS_HERDR`, `$DARIUS_HERDR_SESSION`. */
export interface HerdrTarget {
  bin: string;
  session?: string;
}

export function herdrTarget(): HerdrTarget {
  const target: HerdrTarget = { bin: process.env.DARIUS_HERDR ?? "herdr" };
  const session = process.env.DARIUS_HERDR_SESSION;
  if (session !== undefined && session !== "") target.session = session;
  return target;
}

interface HerdrOutput {
  code: number | null;
  stdout: string;
  stderr: string;
  spawnError?: string;
}

function runHerdr(target: HerdrTarget, args: readonly string[]): Promise<HerdrOutput> {
  const argv = target.session === undefined ? [...args] : ["--session", target.session, ...args];
  const output: HerdrOutput = { code: null, stdout: "", stderr: "" };
  const child = spawn(target.bin, argv, { stdio: ["ignore", "pipe", "pipe"] });
  const timer = setTimeout(() => child.kill("SIGKILL"), HERDR_TIMEOUT_MS);
  // "close" does not always follow an "error" for a process that never started.
  const failedToStart = new Promise<HerdrOutput>((resolve) => {
    child.on("error", (cause) => {
      output.spawnError = errorMessage(cause);
      if (child.pid === undefined) resolve(output);
    });
  });
  const closed = new Promise<HerdrOutput>((resolve) => {
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output.stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      output.stderr += chunk;
    });
    child.on("close", (code) => {
      output.code = code;
      resolve(output);
    });
  });
  return Promise.race([closed, failedToStart]).finally(() => clearTimeout(timer));
}

function isRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function parseJson(text: string): JsonValue | undefined {
  try {
    const parsed: JsonValue = JSON.parse(text.trim());
    return parsed;
  } catch {
    return undefined;
  }
}

/** A failed herdr call as one line: its error code and message, else its exit and stderr. */
function failure(output: HerdrOutput): string {
  if (output.spawnError !== undefined) return output.spawnError;
  const parsed = parseJson(output.stderr);
  const error = isRecord(parsed) ? parsed.error : undefined;
  if (isRecord(error) && isText(error.code)) return `${error.code}: ${isText(error.message) ? error.message : ""}`;
  return `herdr exited ${String(output.code)}: ${output.stderr.trim().slice(-300)}`;
}

/** `.result` of a successful call. Throws with herdr's own error otherwise. */
async function call(target: HerdrTarget, args: readonly string[]): Promise<{ readonly [key: string]: JsonValue }> {
  const output = await runHerdr(target, args);
  if (output.code !== 0) throw new Error(`herdr ${args.slice(0, 2).join(" ")}: ${failure(output)}`);
  const parsed = parseJson(output.stdout);
  const result = isRecord(parsed) ? parsed.result : undefined;
  if (!isRecord(result)) throw new Error(`herdr ${args.slice(0, 2).join(" ")}: no result in ${output.stdout.slice(0, 200)}`);
  return result;
}

/** An id field that herdr gives either as a string or as an object carrying `<key>`. */
function idOf(value: JsonValue | undefined, key: string): string | undefined {
  if (isText(value)) return value;
  if (isRecord(value) && isText(value[key])) return value[key];
  return undefined;
}

// --- availability ------------------------------------------------------------------

/** null when a herdr server answers, else why not. Never throws. */
export async function herdrUnavailable(target: HerdrTarget = herdrTarget()): Promise<string | null> {
  const output = await runHerdr(target, ["status"]);
  if (output.spawnError !== undefined) return `herdr is not installed here (${output.spawnError})`;
  if (/server:\s*\n\s*status:\s*running\b/u.test(output.stdout)) return null;
  return "no herdr server is running";
}

// --- one run -----------------------------------------------------------------------

export interface HerdrPlan {
  target: HerdrTarget;
  /** herdr's agent kind; darius's harness ids are herdr kinds. */
  kind: string;
  argv: string[];
  message: string;
  cwd: string;
  /** Only the variables the run needs; the tab's shell has the herdr server's env otherwise. */
  env: ChildEnv;
  label: string;
  run: string;
  runDir: string;
  timeoutMs: number;
  pollMs: number;
  graceMs: number;
  /** The run's phase in the ledger. */
  phase(): "running" | "held" | "closed";
  /** Holds the run with one question. */
  hold(question: string): void;
}

/** A herdr agent name for a run: lowercase, starts with a letter, at most 32 characters. */
export function agentName(run: string): string {
  return `d-${run.toLowerCase()}`.slice(0, 32);
}

async function runsWorkspace(plan: HerdrPlan): Promise<string> {
  const listed = await call(plan.target, ["workspace", "list"]);
  const workspaces = Array.isArray(listed.workspaces) ? listed.workspaces : [];
  for (const workspace of workspaces) {
    if (isRecord(workspace) && workspace.label === RUNS_WORKSPACE && isText(workspace.workspace_id)) return workspace.workspace_id;
  }
  const created = await call(plan.target, ["workspace", "create", "--label", RUNS_WORKSPACE, "--cwd", plan.cwd, "--no-focus"]);
  const id = idOf(created.workspace, "workspace_id");
  if (id === undefined) throw new Error("herdr workspace create: no workspace id");
  return id;
}

async function openTab(plan: HerdrPlan, workspace: string): Promise<{ tab: string; pane: string }> {
  const envFlags = Object.entries(plan.env).flatMap(([key, value]) => ["--env", `${key}=${value}`]);
  const created = await call(plan.target, [
    "tab", "create", "--workspace", workspace, "--cwd", plan.cwd, "--label", plan.label, ...envFlags, "--no-focus",
  ]);
  const tab = idOf(created.tab, "tab_id");
  const pane = idOf(created.root_pane, "pane_id");
  if (tab === undefined || pane === undefined) throw new Error("herdr tab create: no tab or root pane id");
  return { tab, pane };
}

type AgentState = "idle" | "working" | "blocked" | "done" | "unknown" | "gone";

async function agentState(plan: HerdrPlan, name: string): Promise<AgentState> {
  const output = await runHerdr(plan.target, ["agent", "get", name]);
  if (output.code !== 0) return failure(output).startsWith("agent_not_found") ? "gone" : "unknown";
  const parsed = parseJson(output.stdout);
  const result = isRecord(parsed) ? parsed.result : undefined;
  const agent = isRecord(result) ? result.agent : undefined;
  const status = isRecord(agent) ? agent.agent_status : undefined;
  if (status === "idle" || status === "working" || status === "blocked" || status === "done") return status;
  return "unknown";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface WatchEnd {
  timedOut: boolean;
  note: string;
}

/** Polls the ledger and the agent until the run ends, the agent waits too long, or the timeout. */
async function watch(plan: HerdrPlan, name: string, started: number): Promise<WatchEnd> {
  let waitingSince: number | undefined;
  for (;;) {
    if (plan.phase() !== "running") return { timedOut: false, note: "the run ended in the ledger" };
    const now = Date.now();
    if (now - started > plan.timeoutMs) return { timedOut: true, note: "the run timed out" };
    const state = await agentState(plan, name);
    if (state === "gone") return { timedOut: false, note: "the agent exited" };
    const isWaiting = state === "blocked" || state === "idle" || state === "done";
    waitingSince = isWaiting ? (waitingSince ?? now) : undefined;
    if (waitingSince !== undefined && now - waitingSince > plan.graceMs) {
      const minutes = Math.round(plan.graceMs / 60_000);
      plan.hold(`the agent waits for input in herdr tab "${plan.label}" (${state} for over ${String(minutes)} min); answer there, or answer this run and resume it`);
      return { timedOut: false, note: `the agent was ${state} past the grace time` };
    }
    await sleep(plan.pollMs);
  }
}

function ended(started: number, fields: { timedOut?: boolean; note: string; spawnError?: string }): LaunchResult {
  const result: LaunchResult = {
    exitCode: null,
    signal: null,
    timedOut: fields.timedOut ?? false,
    durationMs: Date.now() - started,
    stdout: "",
    stderrTail: `herdr surface: ${fields.note}`,
  };
  if (fields.spawnError !== undefined) result.spawnError = fields.spawnError;
  return result;
}

/**
 * `agent start` in the tab's root pane. Probed on herdr 0.9.0 with Claude
 * Code 2.1.283:
 *
 *   - right after `tab create` the pane is not yet "an available shell"
 *     (agent_pane_busy), so that error is retried until the shell is ready;
 *   - an interactive harness can stop at a startup dialog (Claude Code asks
 *     once per folder whether to trust it). herdr then answers
 *     agent_not_ready, and the agent is running but blocked. That is not a
 *     failure on a surface a person watches: "blocked" means the caller
 *     waits for the dialog to be answered.
 */
async function startAgent(plan: HerdrPlan, name: string, pane: string): Promise<"ready" | "blocked"> {
  const args = ["agent", "start", name, "--kind", plan.kind, "--pane", pane, "--timeout", String(AGENT_START_TIMEOUT_MS), "--", ...plan.argv];
  const deadline = Date.now() + SHELL_READY_TIMEOUT_MS;
  for (;;) {
    const output = await runHerdr(plan.target, args);
    if (output.code === 0) return "ready";
    const why = failure(output);
    if (why.startsWith("agent_not_ready")) return "blocked";
    if (!why.startsWith("agent_pane_busy") || Date.now() > deadline) throw new Error(`herdr agent start: ${why}`);
    await sleep(SHELL_READY_RETRY_MS);
  }
}

type ReadyEnd = { ready: true } | { ready: false; end: WatchEnd };

/**
 * Waits for an agent blocked at startup to become ready for its first
 * message. Past the grace time the run is held: the question tells the
 * person which tab waits.
 */
async function waitUntilReady(plan: HerdrPlan, name: string, started: number): Promise<ReadyEnd> {
  const blockedSince = Date.now();
  for (;;) {
    const state = await agentState(plan, name);
    if (state === "idle" || state === "done") return { ready: true };
    if (state === "gone") return { ready: false, end: { timedOut: false, note: "the agent exited at startup" } };
    const now = Date.now();
    if (now - started > plan.timeoutMs) return { ready: false, end: { timedOut: true, note: "the run timed out at startup" } };
    if (now - blockedSince > plan.graceMs) {
      plan.hold(`the harness waits at a startup dialog in herdr tab "${plan.label}" (for example a folder trust question); answer it there, then resume this run`);
      return { ready: false, end: { timedOut: false, note: "the agent was blocked at startup past the grace time" } };
    }
    await sleep(plan.pollMs);
  }
}

/** Runs the harness in a new herdr tab until the run ends. Never throws: a herdr failure comes back as `spawnError`. */
export async function launchHerdr(plan: HerdrPlan): Promise<LaunchResult> {
  const started = Date.now();
  const name = agentName(plan.run);
  let tab: string | undefined;
  try {
    const workspace = await runsWorkspace(plan);
    const opened = await openTab(plan, workspace);
    tab = opened.tab;
    writeFileSync(join(plan.runDir, TAB_FILE), `${JSON.stringify({ tab, agent: name })}\n`);
    if ((await startAgent(plan, name, opened.pane)) === "blocked") {
      const ready = await waitUntilReady(plan, name, started);
      if (!ready.ready) {
        if (ready.end.timedOut) await runHerdr(plan.target, ["tab", "close", tab]);
        return ended(started, ready.end);
      }
    }
    await call(plan.target, ["agent", "prompt", name, plan.message]);
  } catch (cause) {
    if (tab !== undefined) await runHerdr(plan.target, ["tab", "close", tab]);
    return ended(started, { note: "the harness did not start", spawnError: errorMessage(cause) });
  }
  const end = await watch(plan, name, started);
  if (end.timedOut) await runHerdr(plan.target, ["tab", "close", tab]);
  return ended(started, end);
}

/**
 * Closes the herdr tab of every run in `runsDir` whose run is no longer
 * running, and forgets it. Best effort: a tab the person already closed, or
 * a herdr that is gone, is not an error.
 */
export async function closeFinishedTabs(
  runsDir: string,
  runs: readonly string[],
  isRunning: (run: string) => boolean,
  target: HerdrTarget = herdrTarget(),
): Promise<number> {
  let closed = 0;
  for (const run of runs) {
    const file = join(runsDir, run, TAB_FILE);
    if (!existsSync(file) || isRunning(run)) continue;
    const parsed = parseJson(readFileSync(file, "utf8"));
    const tab = isRecord(parsed) && isText(parsed.tab) ? parsed.tab : undefined;
    if (tab !== undefined) {
      const output = await runHerdr(target, ["tab", "close", tab]);
      if (output.code === 0) closed += 1;
    }
    rmSync(file, { force: true });
  }
  return closed;
}
