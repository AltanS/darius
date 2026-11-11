/**
 * The hc surface (0.133.0): the harness in a herdr-core terminal, so a person
 * can watch the run and attach to it (docs/concept.md, "Harnesses, profiles
 * and surfaces" > "Surfaces"). herdr-core runs a program straight from its
 * argv, so this surface needs none of the herdr tab's shell work: no alias,
 * no marker, no wait for a shell prompt. Facts probed on hc 0.1.14 with
 * Claude Code 2.1.322, 2026-11-11, in an isolated core (own HC_SESSION and
 * scratch XDG paths):
 *
 *   - `hc connect` speaks the core's JSON-RPC 2.0 API over stdin and stdout,
 *     one message per line, and exits 0 once stdin is closed and the answer
 *     is out. It starts a core when none runs. Errors come back as
 *     `{"error":{"code","message","data":{"kind"}}}`, still with exit 0.
 *     darius uses it for every call: one parser, and `terminal.run` takes an
 *     `env` that the `hc run` CLI has no flag for.
 *   - A terminal gets the core's environment, not the caller's: a variable
 *     set only for `hc run` did not reach it. `terminal.run` with `env` sets
 *     variables on top of the core's, and they reached the program. So the
 *     run variables go there; none of them is a secret (run id, policy path,
 *     project, who, store dirs), and no `env K=V` prefix shows them in the
 *     process list.
 *   - Every terminal gets TERM=xterm-256color, also from a core started with
 *     no TERM at all. The box clears the env, so a boxed launch sets that
 *     literal (HC_TERM); there is no shell to fill in a `$TERM`.
 *   - `terminal.get` shows `argv` (what hc started), `pid` (its process) and
 *     `foreground` ({pid, name, argv, cwd} of the foreground process group's
 *     leader, from the OS; null once finished). For `bwrap ... -- bash` the
 *     foreground was bwrap with the terminal's own pid.
 *   - `state` is live or finished; `status` is the program's own OSC 7501
 *     report (idle, working, done, blocked, error), null when it never said;
 *     `reported` says whether it ever did. Claude Code probes for OSC 7501
 *     and reports `idle` at its prompt and `working` on a turn, also behind
 *     bwrap with a cleared env. At the folder trust dialog it reports
 *     nothing (`reported` false, status null). A plain program reports none.
 *   - A prompt as Claude's first argv word lands: the status went to
 *     `working` within a second (killed at once, no turn finished).
 *     `first_message.sent` exists only for template runs, not for a raw argv.
 *   - `terminal.wait` with a timeout (seconds, fractional) returns at once
 *     when the program is not working (`reason: status`), at its exit
 *     (`reason: exit`), else at the timeout (`ended: false`). A program that
 *     never reported waits for its exit.
 *   - `terminal.send` with `if: idle` types only into an idle program.
 *   - `terminal.kill` of a finished terminal answers ok; `terminal.rm` of a
 *     live one refuses (`kind: live`); a name is unique among live terminals
 *     only; an address (`t7`) is fixed on its core.
 *
 * The flow per run: `terminal.run` with the sandbox argv, then the harness
 * argv with the first message in it (HarnessLaunch.prompted). In the box,
 * darius then asks hc for proof that the terminal's program is the bwrap it
 * passed, and kills the terminal when hc cannot show it (the box fails
 * closed). The prompt is confirmed as on the herdr surface: the agent
 * worked, the gate log grew, or the run has a protocol line; an idle agent
 * with no sign gets it again by `terminal.send`, at most twice. Then the
 * watch: the ledger ends the run; an agent waiting for input past the grace
 * time holds the run with a question that says how to attach; the timeout
 * kills the terminal. Because Claude reports no status at its trust dialog,
 * a terminal that never reported and whose gate log never grew counts as
 * waiting too.
 *
 * A finished run's terminal stays for the person, like a herdr tab, and
 * run-due removes it (kill when live, then rm) by the same rule (isTabDue).
 * `hc.json` in the run dir records each launch's address.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import type { JsonValue } from "../core/model.ts";
import { appendRunLog } from "../core/sandbox.ts";
import { errorMessage } from "../runtime.ts";
import { agentName, closeDueRuns, gateLogSize, hasHarnessWork, MAX_RESENDS, showMs, sleep, type TabRun } from "./attended.ts";
import type { ChildEnv, LaunchResult } from "./headless.ts";

/** The TERM every hc terminal gets (probed above); a boxed launch passes it, as the box clears the env. */
export const HC_TERM = "xterm-256color";
/** Where a run records its terminals, so a later batch can remove them. */
const TERMINAL_FILE = "hc.json";
/** The label that names the run on its terminal; cleanup removes only a terminal that carries it. */
const RUN_LABEL = "darius_run";
/** darius's kill timeout for one hc call that passes hc no timeout. Every call answers in milliseconds. */
const CALL_KILL_MS = 60_000;
/** Added to any timeout darius passes to hc, so darius never kills a call that is about to answer. */
const CALL_MARGIN_MS = 30_000;
/** How long darius looks for bwrap in the terminal's foreground before the box counts as not proved. */
const PROOF_MS = 5_000;
const PROOF_RETRY_MS = 100;
const NO_MASK = "sandbox: this run starts UNMASKED, it can read darius secret files";

/** The hc executable and optional isolated session: `$DARIUS_HC`, `$DARIUS_HC_SESSION`. */
export interface HcTarget {
  bin: string;
  session?: string;
}

export function hcTarget(): HcTarget {
  const target: HcTarget = { bin: process.env.DARIUS_HC ?? "hc" };
  const session = process.env.DARIUS_HC_SESSION;
  if (session !== undefined && session !== "") target.session = session;
  return target;
}

type JsonRecord = { readonly [key: string]: JsonValue };

function isRecord(value: JsonValue | undefined): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isNumber(value: JsonValue | undefined): value is number {
  return typeof value === "number";
}

function parseJson(text: string): JsonValue | undefined {
  try {
    const parsed: JsonValue = JSON.parse(text.trim());
    return parsed;
  } catch {
    return undefined;
  }
}

/** One answer of the core: its result, or why there is none (hc's error kind and message, or why hc gave no answer). */
type Reply = { result: JsonRecord } | { failure: string; kind?: string; isSpawn?: true };

function readReply(stdout: string, code: number | null): Reply {
  const line = stdout.split("\n").find((entry) => entry.trim() !== "");
  const parsed = line === undefined ? undefined : parseJson(line);
  if (!isRecord(parsed)) return { failure: `hc exited ${String(code)} with no answer` };
  if (isRecord(parsed.result)) return { result: parsed.result };
  const error = parsed.error;
  if (!isRecord(error)) return { failure: `hc answered without a result: ${line?.slice(0, 200) ?? ""}` };
  const data = error.data;
  const kind = isRecord(data) && isText(data.kind) ? data.kind : undefined;
  const message = isText(error.message) ? error.message : "";
  return kind === undefined ? { failure: message } : { failure: `${kind}: ${message}`, kind };
}

/** One JSON-RPC call over `hc connect`. Never throws; darius kills the call after `killMs`. */
function rpc(target: HcTarget, call: { method: string; params: JsonRecord; killMs?: number }): Promise<Reply> {
  const env = target.session === undefined ? process.env : { ...process.env, HC_SESSION: target.session };
  const child = spawn(target.bin, ["connect"], { env, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  const timer = setTimeout(() => child.kill("SIGKILL"), call.killMs ?? CALL_KILL_MS);
  // "close" does not always follow an "error" for a process that never started.
  const failedToStart = new Promise<Reply>((resolve) => {
    child.on("error", (cause) => {
      if (child.pid === undefined) resolve({ failure: errorMessage(cause), isSpawn: true });
    });
  });
  const closed = new Promise<Reply>((resolve) => {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.resume();
    child.on("close", (code) => resolve(readReply(stdout, code)));
  });
  child.stdin.on("error", () => {
    // A program that never started has no stdin to write to; failedToStart answers.
  });
  child.stdin.end(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: call.method, params: call.params })}\n`);
  return Promise.race([closed, failedToStart]).finally(() => clearTimeout(timer));
}

/** `.result` of a call that succeeded. Throws with hc's own error otherwise. */
async function callHc(target: HcTarget, call: { method: string; params: JsonRecord; killMs?: number }): Promise<JsonRecord> {
  const reply = await rpc(target, call);
  if ("failure" in reply) throw new Error(`hc ${call.method}: ${reply.failure}`);
  return reply.result;
}

// --- availability ------------------------------------------------------------------

/** null when an hc core answers (`hc connect` starts one when none runs), else why not. Never throws. */
export async function hcUnavailable(target: HcTarget = hcTarget()): Promise<string | null> {
  const reply = await rpc(target, { method: "server.status", params: {} });
  if (!("failure" in reply)) return null;
  if (reply.isSpawn === true) return `hc is not installed here (${reply.failure})`;
  return `the hc core does not answer (${reply.failure})`;
}

// --- one run -----------------------------------------------------------------------

export interface HcPlan {
  target: HcTarget;
  /** The harness executable, as the headless surface starts it. */
  bin: string;
  /** The harness argv with the first message in it (HarnessLaunch.prompted). */
  argv: string[];
  /** The first message, sent again when it did not land. */
  message: string;
  cwd: string;
  /** Only the variables the run needs; the terminal has the hc core's env otherwise. */
  env: ChildEnv;
  /** Labels on the terminal; darius adds `darius_run`. */
  labels: { [key: string]: string };
  run: string;
  runDir: string;
  timeoutMs: number;
  pollMs: number;
  graceMs: number;
  confirmMs: number;
  idleMs: number;
  /** The argv of the sandbox to run the harness in (src/core/sandbox.ts), when it is masked or in the box. */
  sandbox?: readonly string[] | undefined;
  /** The sandbox is the box: it fails closed. When hc cannot show bwrap as the terminal's program, the terminal is killed and the launch ends with `boxBroken`. */
  isBox?: boolean;
  /** The run's phase in the ledger. */
  phase(): "running" | "held" | "closed";
  /** Holds the run with one question. */
  hold(question: string): void;
}

/** What hc shows of one terminal. `gone` is a terminal hc does not know; `unknown` an hc that did not answer. */
interface Snapshot {
  state: "live" | "finished" | "gone" | "unknown";
  /** The program's OSC 7501 word, or null. */
  status: string | null;
  reported: boolean;
  pid: number | null;
  argv: string[];
  foreground?: { pid: number; name: string };
  labels: { [key: string]: string };
}

function textList(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((entry) => isText(entry)) : [];
}

function toSnapshot(terminal: JsonRecord): Snapshot {
  const { status, foreground, labels } = terminal;
  const snapshot: Snapshot = {
    state: terminal.state === "live" ? "live" : "finished",
    status: isRecord(status) && isText(status.state) ? status.state : null,
    reported: terminal.reported === true,
    pid: isNumber(terminal.pid) ? terminal.pid : null,
    argv: textList(terminal.argv),
    labels: {},
  };
  if (isRecord(foreground) && isNumber(foreground.pid) && isText(foreground.name)) snapshot.foreground = { pid: foreground.pid, name: foreground.name };
  if (isRecord(labels)) for (const [key, value] of Object.entries(labels)) if (isText(value)) snapshot.labels[key] = value;
  return snapshot;
}

async function snapshotOf(target: HcTarget, address: string): Promise<Snapshot> {
  const reply = await rpc(target, { method: "terminal.get", params: { terminal: address } });
  if ("result" in reply) return toSnapshot(reply.result);
  return { state: reply.kind === "not_found" ? "gone" : "unknown", status: null, reported: false, pid: null, argv: [], labels: {} };
}

/**
 * Waits up to `ms` with `hc wait`, which comes back early when the program
 * stops working or exits, then reads the terminal. hc's wait cannot see the
 * ledger, so a program that is already not working (hc answers at once)
 * leaves the rest of `ms` to a plain sleep: the ledger poll needs a pause.
 */
async function observe(plan: HcPlan, address: string, ms: number): Promise<Snapshot> {
  const from = Date.now();
  const reply = await rpc(plan.target, { method: "terminal.wait", params: { terminal: address, timeout: ms / 1_000 }, killMs: ms + CALL_MARGIN_MS });
  const hasExited = "result" in reply && reply.result.reason === "exit";
  const rest = ms - (Date.now() - from);
  if (!hasExited && rest > 0) await sleep(rest);
  return snapshotOf(plan.target, address);
}

function ended(started: number, fields: { timedOut?: boolean; note: string; spawnError?: string }): LaunchResult {
  const result: LaunchResult = {
    exitCode: null,
    signal: null,
    timedOut: fields.timedOut ?? false,
    durationMs: Date.now() - started,
    stdout: "",
    stderrTail: `hc surface: ${fields.note}`,
  };
  if (fields.spawnError !== undefined) result.spawnError = fields.spawnError;
  return result;
}

/** The terminal addresses `hc.json` in `runDir` records, oldest first. Empty when there is none. */
export function recordedTerminals(runDir: string): string[] {
  const file = join(runDir, TERMINAL_FILE);
  if (!existsSync(file)) return [];
  const parsed = parseJson(readFileSync(file, "utf8"));
  return isRecord(parsed) ? textList(parsed.terminals) : [];
}

/** How a person reaches the terminal: `hc attach <name>`, with the session when it is not the default one. */
export function attachCommand(target: HcTarget, name: string): string {
  return target.session === undefined ? `hc attach ${name}` : `HC_SESSION=${target.session} hc attach ${name}`;
}

/**
 * The proof that the terminal's program is the sandbox darius passed: hc
 * started exactly `argv`, and the OS shows bwrap, with the terminal's own pid,
 * as the leader of the foreground group. A box scope (`systemd-run --scope`)
 * execs bwrap in place, so the name can read systemd-run for a moment; the
 * check looks again for up to PROOF_MS. Returns why there is no proof, or
 * undefined when there is.
 */
async function sandboxUnproved(plan: HcPlan, address: string, argv: readonly string[]): Promise<string | undefined> {
  const deadline = Date.now() + PROOF_MS;
  let why = "hc did not show the terminal";
  while (Date.now() <= deadline) {
    const snap = await snapshotOf(plan.target, address);
    if (snap.state === "live" && JSON.stringify(snap.argv) !== JSON.stringify(argv)) return "hc shows another program in the terminal than the launch argv";
    if (snap.state === "finished" || snap.state === "gone") return "the terminal ended before hc showed bwrap in its foreground";
    if (snap.foreground !== undefined && snap.foreground.name === "bwrap" && snap.foreground.pid === snap.pid) return undefined;
    why = snap.foreground === undefined ? "hc shows no foreground process in the terminal" : `hc shows ${snap.foreground.name} in the terminal's foreground, not bwrap`;
    await sleep(PROOF_RETRY_MS);
  }
  return why;
}

type ReadyEnd = { ready: true } | { ready: false; end: WatchEnd };

interface WatchEnd {
  timedOut: boolean;
  note: string;
}

type ConfirmEnd = { sign: "confirmed" | "idle" | "blocked" | "unsure" } | { sign: "ended"; end: WatchEnd };

/**
 * Looks for a sign that the prompt landed: the agent worked, the gate log
 * grew, or the run already has a protocol line. "idle" is an agent idle for
 * `plan.idleMs` with no sign, "blocked" one at a dialog, "unsure" a window
 * that ended with neither (no status, or the terminal ended), so the watch
 * takes over.
 */
async function confirmPrompt(plan: HcPlan, address: string, gateBefore: number, started: number): Promise<ConfirmEnd> {
  const sentAt = Date.now();
  let idleSince: number | undefined;
  while (Date.now() - sentAt < plan.confirmMs) {
    if (plan.phase() !== "running" || gateLogSize(plan.runDir) > gateBefore) return { sign: "confirmed" };
    if (Date.now() - started > plan.timeoutMs) return { sign: "ended", end: { timedOut: true, note: "the run timed out before the first message landed" } };
    const snap = await observe(plan, address, plan.pollMs);
    if (snap.status === "working") return { sign: "confirmed" };
    if (snap.state === "finished" || snap.state === "gone") return { sign: "unsure" };
    if (snap.status === "blocked") return { sign: "blocked" };
    const now = Date.now();
    idleSince = snap.status === "idle" ? (idleSince ?? now) : undefined;
    if (idleSince !== undefined && now - idleSince >= plan.idleMs) return { sign: "idle" };
  }
  return { sign: "unsure" };
}

/** Waits while the agent is blocked (a dialog). Past the grace time the run is held with a question that says how to attach. */
async function waitWhileBlocked(plan: HcPlan, terminal: { address: string; name: string }, started: number): Promise<ReadyEnd> {
  const blockedSince = Date.now();
  while (Date.now() - started <= plan.timeoutMs) {
    const snap = await observe(plan, terminal.address, plan.pollMs);
    if (snap.state === "finished" || snap.state === "gone") return { ready: false, end: { timedOut: false, note: "the agent exited at a dialog" } };
    if (snap.status !== "blocked") return { ready: true };
    if (Date.now() - blockedSince > plan.graceMs) {
      plan.hold(`the harness waits at a dialog in hc terminal ${terminal.name}; attach with ${attachCommand(plan.target, terminal.name)} (Ctrl+\\ detaches) and answer it there, then resume this run`);
      return { ready: false, end: { timedOut: false, note: "the agent was blocked past the grace time" } };
    }
  }
  return { ready: false, end: { timedOut: true, note: "the run timed out at a dialog" } };
}

/** `terminal.send` of the first message, only into an idle agent. A send that fails leaves a line in the run's log; the watch goes on. */
async function resend(plan: HcPlan, address: string, line: string): Promise<void> {
  appendRunLog(plan.runDir, line);
  const reply = await rpc(plan.target, { method: "terminal.send", params: { terminal: address, text: plan.message, if: "idle" } });
  if ("failure" in reply) appendRunLog(plan.runDir, `hc: the resend failed: ${reply.failure}`);
}

/**
 * Checks that the first message, which went in with the argv, landed. Claude
 * Code can show its folder trust dialog first. A message that did not land
 * is sent again when the agent is idle with no sign of work, and after a
 * dialog once the dialog is answered. At most MAX_RESENDS resends, each with
 * a run.log line; after that the watch and its grace hold take over.
 */
async function confirmFirstMessage(plan: HcPlan, terminal: { address: string; name: string }, started: number): Promise<ReadyEnd> {
  const gateBefore = gateLogSize(plan.runDir);
  for (let resends = 0; resends <= MAX_RESENDS; resends += 1) {
    const outcome = await confirmPrompt(plan, terminal.address, gateBefore, started);
    if (outcome.sign === "ended") return { ready: false, end: outcome.end };
    if (outcome.sign === "confirmed" || outcome.sign === "unsure" || resends === MAX_RESENDS) return { ready: true };
    if (outcome.sign === "blocked") {
      const ready = await waitWhileBlocked(plan, terminal, started);
      if (!ready.ready) return ready;
      if (plan.phase() !== "running" || gateLogSize(plan.runDir) > gateBefore) return { ready: true };
    }
    const why = outcome.sign === "blocked" ? "a dialog was up" : `the agent stayed idle for ${showMs(plan.idleMs)} with no sign of work`;
    await resend(plan, terminal.address, `hc: the first message did not land (${why}); sending it again (resend ${String(resends + 1)} of ${String(MAX_RESENDS)})`);
  }
  return { ready: true };
}

/** The status words that mean the agent waits for a person, whatever else runs. */
const WAITING_NOW: ReadonlySet<string> = new Set(["blocked", "error"]);
/** The status words of an agent at rest: it waits for a person only when none of its own work is in progress. */
const AT_REST: ReadonlySet<string> = new Set(["idle", "done"]);

/**
 * Why the agent waits for input, or undefined when it does not. `blocked`
 * and `error` wait at once. `idle` and `done` wait only when no tool shell of
 * the harness runs under the terminal (hasHarnessWork, 0.135.0): Claude Code
 * reports `done` while a `run_in_background` command runs, and it is woken
 * when the command ends, so nobody is needed. hc exposes no status detail for
 * that, so the signal is the process tree from the terminal's pid. A shell
 * that never ends keeps the run from being held, but not open: the run's
 * timeout kills the terminal. A terminal that never reported and whose gate
 * log never grew waits too: Claude Code reports nothing at its folder trust
 * dialog.
 */
function waitingWord(snap: Snapshot, plan: HcPlan, gateAtLaunch: number): string | undefined {
  if (snap.status !== null && WAITING_NOW.has(snap.status)) return snap.status;
  if (snap.status !== null && AT_REST.has(snap.status)) return hasHarnessWork(snap.pid === null ? [] : [snap.pid]) ? undefined : snap.status;
  if (!snap.reported && gateLogSize(plan.runDir) <= gateAtLaunch) return "silent, perhaps at a startup dialog such as the folder trust question,";
  return undefined;
}

/** Watches the ledger and the terminal until the run ends, the agent waits too long, or the timeout. */
async function watch(plan: HcPlan, terminal: { address: string; name: string }, started: number, gateAtLaunch: number): Promise<WatchEnd> {
  let waitingSince: number | undefined;
  while (Date.now() - started <= plan.timeoutMs) {
    if (plan.phase() !== "running") return { timedOut: false, note: "the run ended in the ledger" };
    const snap = await observe(plan, terminal.address, plan.pollMs);
    if (plan.phase() !== "running") return { timedOut: false, note: "the run ended in the ledger" };
    if (snap.state === "finished" || snap.state === "gone") return { timedOut: false, note: "the agent exited" };
    const word = waitingWord(snap, plan, gateAtLaunch);
    const now = Date.now();
    waitingSince = word === undefined ? undefined : (waitingSince ?? now);
    if (word !== undefined && waitingSince !== undefined && now - waitingSince > plan.graceMs) {
      const minutes = Math.round(plan.graceMs / 60_000);
      plan.hold(`the agent waits for input in hc terminal ${terminal.name} (${word} for over ${String(minutes)} min); attach with ${attachCommand(plan.target, terminal.name)} (Ctrl+\\ detaches) and answer there, or answer this run and resume it`);
      return { timedOut: false, note: `the agent was ${word} past the grace time` };
    }
  }
  if (plan.phase() !== "running") return { timedOut: false, note: "the run ended in the ledger" };
  return { timedOut: true, note: "the run timed out" };
}

async function killTerminal(target: HcTarget, address: string): Promise<void> {
  await rpc(target, { method: "terminal.kill", params: { terminal: address } });
}

/** Starts the terminal and records it in `hc.json`. Throws with hc's error. */
async function openTerminal(plan: HcPlan, argv: readonly string[], name: string, earlier: readonly string[]): Promise<string> {
  const created = await callHc(plan.target, {
    method: "terminal.run",
    params: { argv: [...argv], cwd: plan.cwd, name, no_parent: true, no_notify: true, env: { ...plan.env }, labels: { ...plan.labels, [RUN_LABEL]: plan.run } },
  });
  const address = created.address;
  if (!isText(address)) throw new Error("hc terminal.run: no terminal address");
  writeFileSync(join(plan.runDir, TERMINAL_FILE), `${JSON.stringify({ terminals: [...earlier, address], name })}\n`);
  return address;
}

/** Runs the harness in a new hc terminal until the run ends. Never throws: an hc failure comes back as `spawnError`, a box hc cannot prove as `boxBroken`. */
export async function launchHc(plan: HcPlan): Promise<LaunchResult> {
  const started = Date.now();
  const earlier = recordedTerminals(plan.runDir);
  const name = agentName(plan.run, earlier.length + 1);
  const argv = [...(plan.sandbox ?? []), plan.bin, ...plan.argv];
  const gateAtLaunch = gateLogSize(plan.runDir);
  let address: string | undefined;
  try {
    address = await openTerminal(plan, argv, name, earlier);
    const unproved = plan.sandbox === undefined ? undefined : await sandboxUnproved(plan, address, argv);
    if (plan.isBox === true && unproved !== undefined) {
      await killTerminal(plan.target, address);
      const result = ended(started, { note: `the terminal was killed: ${unproved}` });
      result.boxBroken = unproved;
      return result;
    }
    if (unproved !== undefined) appendRunLog(plan.runDir, `${NO_MASK}: ${unproved}`);
    const sent = await confirmFirstMessage(plan, { address, name }, started);
    if (!sent.ready) {
      if (sent.end.timedOut) await killTerminal(plan.target, address);
      return ended(started, sent.end);
    }
  } catch (cause) {
    if (address !== undefined) await killTerminal(plan.target, address);
    return ended(started, { note: "the harness did not start", spawnError: errorMessage(cause) });
  }
  const end = await watch(plan, { address, name }, started, gateAtLaunch);
  if (end.timedOut) await killTerminal(plan.target, address);
  return ended(started, end);
}

/**
 * Removes the terminals of one run dir: kill when live, then rm. Only a
 * terminal that carries the run's label: an address belongs to one core, and
 * a new core can give it to someone else's terminal. Best effort.
 */
async function removeTerminals(target: HcTarget, runDir: string): Promise<number> {
  const run = basename(runDir);
  let removed = 0;
  for (const address of recordedTerminals(runDir)) {
    const snap = await snapshotOf(target, address);
    if (snap.labels[RUN_LABEL] !== run) continue;
    if (snap.state === "live") await killTerminal(target, address);
    const reply = await rpc(target, { method: "terminal.rm", params: { terminal: address } });
    if ("result" in reply) removed += 1;
  }
  return removed;
}

/**
 * Removes the hc terminals of every finished run in `runsDir` that isTabDue
 * (each launch of a resumed run has one), and forgets them. A running or held
 * run keeps its terminal. A terminal the person already removed, or an hc
 * that is gone, is not an error.
 */
export async function closeFinishedTerminals(
  runsDir: string,
  runs: readonly TabRun[],
  now: number = Date.now(),
  target: HcTarget = hcTarget(),
): Promise<number> {
  return closeDueRuns(runsDir, runs, now, { file: TERMINAL_FILE, close: (runDir) => removeTerminals(target, runDir) });
}
