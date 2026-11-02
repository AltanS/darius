/**
 * `darius box check`: this host proves the box before a boxed run starts
 * (M4 box, spec 06), as `darius harness check` proves the gate.
 *
 * No paid call. The check opens the box with the same function a run uses
 * (`openBox` in src/runner/box-launch.ts), for a throwaway project in a temp
 * store, with the Claude adapter's binds, `net = "public"` and no `reach`. It
 * runs a fake harness inside: a small script, written into the temp work
 * dir, run by this process's own runtime. The script tries each thing a run
 * must not do and prints what happened, one JSON object. darius judges the
 * steps outside:
 *
 *   box                    the box was built and the fake harness ran in it
 *   store-write            a new file in the store (the temp one and the real one) is refused
 *   policy-write           the run's policy.json does not open for writing
 *   claude-settings-write  ~/.claude/settings.json does not open for writing
 *   secret-masked          each masked secret file does not open
 *   docker-socket          /run/docker.sock does not connect
 *   tailscale-socket       /run/tailscale/tailscaled.sock does not connect
 *   system-bus             /run/dbus/system_bus_socket does not connect
 *   systemd-run            `systemd-run --user` does not start a unit
 *   web-api                CONNECT to every own address on each web port: the proxy refuses (403)
 *   ssh-port               CONNECT to every own address on port 22: the proxy refuses (403)
 *   public-https           CONNECT to the harness API on 443 opens (200). Offline
 *                          (no address, no connection, no answer in time) skips it,
 *                          and offline never fails the check.
 *   tiocsti                /proc/sys/dev/tty/legacy_tiocsti is 0. A kernel without
 *                          the knob fails: herdr launches run without --new-session.
 *   broker-complete        `darius run complete` inside reaches the broker, and the
 *                          run is complete in the temp store
 *
 * SAFETY. Nothing is sent past the proxy: a tunnel that opens is closed at
 * once, unused. A write probe opens an existing file without truncating it
 * and writes no byte, and a new probe file that does get made is removed. A
 * masked secret is only opened, never read. The temp store, work dir and run
 * are removed after the check.
 *
 * Each check appends `box.checked{darius, bwrap, kernel, outcome, failed,
 * skipped, run, detail?}` to the `_global` ledger; the line carries the
 * host. A boxed run needs a passing check for this host and darius version
 * (`boxReadiness`): run-due, `run now`, `run resume` and `run follow-up` all
 * ask it once per batch, and run a missing check first.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, release, tmpdir } from "node:os";
import { join } from "node:path";

import { hostPortText, type HostPort } from "../core/box.ts";
import { boxPathProblem } from "../core/box-files.ts";
import { appendLine, hostId, readLedger, type LedgerLineInput } from "../core/ledger.ts";
import type { JsonValue, LedgerLine, Ritual } from "../core/model.ts";
import { projectDir, stateDir } from "../core/paths.ts";
import { isBoxChosen, probeBwrap } from "../core/sandbox.ts";
import { GLOBAL_PROJECT, itemRef, openProject, type Project } from "../core/store.ts";
import { localToday } from "../core/sweep.ts";
import { ulid } from "../core/ulid.ts";
import { claudeHarness } from "../harness/claude.ts";
import { errorMessage } from "../runtime.ts";
import { VERSION } from "../version.ts";
import { openBox, type OpenBox, type SandboxRequest } from "./box-launch.ts";
import { writeRunFiles } from "./launch.ts";

/** The kernel knob that lets TIOCSTI push input into a terminal; 0 turns it off. */
export const TIOCSTI_KNOB = "/proc/sys/dev/tty/legacy_tiocsti";
const CHECK_PROJECT = "box-check";
const CHECK_SLUG = "box-check";
const HARNESS_TIMEOUT_MS = 150_000;
const REFUSE_TIMEOUT_MS = 5_000;
/** The proxy waits up to 10 s for a name and 10 s for a connect; this is a little more than both. */
const PUBLIC_TIMEOUT_MS = 22_000;
const SECRET_CAP = 32;
const DETAIL_MAX = 400;

/** Each step, in the order the check reports them. */
export const BOX_STEPS = [
  "box",
  "store-write",
  "policy-write",
  "claude-settings-write",
  "secret-masked",
  "docker-socket",
  "tailscale-socket",
  "system-bus",
  "systemd-run",
  "web-api",
  "ssh-port",
  "public-https",
  "tiocsti",
  "broker-complete",
] as const;
export type BoxStepName = (typeof BOX_STEPS)[number];

/** The host sockets the box must hide, each with the paths a program would try. */
const HOST_SOCKETS = {
  "docker-socket": ["/run/docker.sock", "/var/run/docker.sock"],
  "tailscale-socket": ["/run/tailscale/tailscaled.sock", "/var/run/tailscale/tailscaled.sock"],
  "system-bus": ["/run/dbus/system_bus_socket", "/var/run/dbus/system_bus_socket"],
} as const;
type SocketStep = keyof typeof HOST_SOCKETS;
/** One value per host socket step. */
interface PerSocket<T> {
  "docker-socket": T;
  "tailscale-socket": T;
  "system-bus": T;
}
const SOCKET_STEPS: readonly SocketStep[] = ["docker-socket", "tailscale-socket", "system-bus"];

export type StepOutcome = "pass" | "fail" | "skip";

export interface BoxStep {
  name: BoxStepName;
  outcome: StepOutcome;
  reason: string;
}

/** One check, as `darius box check` and the batch report show it. */
export interface BoxCheck {
  host: string;
  darius: string;
  bwrap: string;
  kernel: string;
  outcome: "pass" | "fail";
  steps: BoxStep[];
  failed: BoxStepName[];
  skipped: BoxStepName[];
  run: string;
}

// --- what the fake harness saw ------------------------------------------------------

/** A path tried inside: `ok` when it opened (or connected), else the error code. */
export interface Tried {
  path: string;
  result: string;
}

/** A CONNECT through the box proxy: the HTTP status, or `timeout`, `bad-reply`, `error:<code>`; and the refusal line. */
export interface Asked {
  target: string;
  status: number | string;
  body: string;
}

/** Everything the fake harness reports, one JSON object on stdout. */
export interface Observed {
  stores: Tried[];
  policy: Tried;
  claudeSettings: Tried;
  secrets: Tried[];
  sockets: PerSocket<Tried[]>;
  systemdRun: { result: string; stderr: string };
  web: Asked[];
  ssh: Asked[];
  public: Asked;
  broker: { exit: number | string; stdout: string; stderr: string };
}

/** The tiocsti knob as read on this host. */
export type TiocstiRead = { value: string } | { missing: true } | { error: string };

/** What the steps are judged from. */
export interface StepFacts {
  box: { built: true } | { built: false; reason: string };
  /** The fake harness's report, or why there is none. */
  observed: Observed | { none: string } | undefined;
  tiocsti: TiocstiRead;
  /** Which host sockets exist outside the box, for the reasons. */
  hostSockets: PerSocket<boolean>;
  /** The temp store has `run.completed{outcome: complete}` for the check's run. */
  brokerCompleted: boolean;
}

// --- judging ------------------------------------------------------------------------

function step(name: BoxStepName, outcome: StepOutcome, reason: string): BoxStep {
  return { name, outcome, reason };
}

/** `path (CODE)` for each try, joined. */
function triedText(tries: readonly Tried[]): string {
  return tries.map((entry) => `${entry.path} (${entry.result})`).join(", ");
}

/** Pass when no try opened. */
function judgeRefused(name: BoxStepName, tries: readonly Tried[], what: string): BoxStep {
  const opened = tries.filter((entry) => entry.result === "ok");
  if (opened.length > 0) return step(name, "fail", `${what} opened in the box: ${opened.map((entry) => entry.path).join(", ")}`);
  return step(name, "pass", `refused: ${triedText(tries)}`);
}

function judgeSocket(name: SocketStep, tries: readonly Tried[], isOnHost: boolean): BoxStep {
  const reached = tries.filter((entry) => entry.result === "ok" || entry.result === "timeout");
  if (reached.length > 0) return step(name, "fail", `the box reached ${triedText(reached)}`);
  const note = isOnHost ? "this host has the socket" : "this host has no such socket";
  return step(name, "pass", `not reachable (${note}): ${triedText(tries)}`);
}

/** The proxy's refusal rule in its reply line: `darius box: refused host:port (rule): ...`. */
function refusalRule(body: string): string | undefined {
  return /\(([a-z0-9-]+)\)/u.exec(body)?.[1];
}

/** Pass when the proxy refused every target with 403. */
function judgeConnects(name: BoxStepName, asked: readonly Asked[], what: string): BoxStep {
  if (asked.length === 0) return step(name, "skip", `no ${what} to try`);
  const through = asked.filter((entry) => entry.status !== 403);
  if (through.length > 0) {
    const listed = through.map((entry) => `${entry.target} (${String(entry.status)})`).join(", ");
    return step(name, "fail", `the proxy did not refuse ${listed}`);
  }
  const rules = [...new Set(asked.map((entry) => refusalRule(entry.body) ?? "refused"))].join(", ");
  return step(name, "pass", `the proxy refused ${String(asked.length)} target(s) (${rules})`);
}

/** Offline is a skip: no address, no connection, or no answer in time. Any other refusal fails. */
export function judgePublic(asked: Asked): BoxStep {
  const { target, status, body } = asked;
  if (status === 200) return step("public-https", "pass", `${target} opened through the proxy and was closed unused`);
  const rule = refusalRule(body);
  if (status === 403 && rule === "no-address") return step("public-https", "skip", `this host looks offline: ${target} resolved to no address`);
  if (status === 502) return step("public-https", "skip", `this host looks offline: ${target} did not connect`);
  if (status === "timeout") return step("public-https", "skip", `this host looks offline: no answer from ${target} in ${String(PUBLIC_TIMEOUT_MS / 1000)} s`);
  const why = body.trim() === "" ? String(status) : `${String(status)}, ${body.trim()}`;
  return step("public-https", "fail", `${target} did not open through the proxy (${why})`);
}

/** The knob must be 0. A missing knob fails: herdr launches drop `--new-session`, so nothing else stops TIOCSTI. */
export function judgeTiocsti(read: TiocstiRead): BoxStep {
  if ("missing" in read) return step("tiocsti", "fail", `${TIOCSTI_KNOB} is missing: this kernel cannot turn TIOCSTI off, and a herdr launch runs without --new-session`);
  if ("error" in read) return step("tiocsti", "fail", `cannot read ${TIOCSTI_KNOB}: ${read.error}`);
  if (read.value === "0") return step("tiocsti", "pass", "dev.tty.legacy_tiocsti is 0");
  return step("tiocsti", "fail", `dev.tty.legacy_tiocsti is ${read.value}, not 0: a run in a herdr tab could type into the operator's terminal`);
}

function judgeSystemdRun(ran: Observed["systemdRun"]): BoxStep {
  if (ran.result === "ok") return step("systemd-run", "fail", "systemd-run --user started a unit from inside the box");
  const why = ran.stderr === "" ? ran.result : `${ran.result}: ${ran.stderr}`;
  return step("systemd-run", "pass", `refused (${why})`);
}

function judgeBroker(broker: Observed["broker"], isCompleted: boolean): BoxStep {
  if (broker.exit === 0 && isCompleted) return step("broker-complete", "pass", "darius run complete went through the broker, and the run is complete");
  const tail = `${broker.stdout} ${broker.stderr}`.replaceAll(/\s+/gu, " ").trim().slice(-200);
  if (broker.exit === 0) return step("broker-complete", "fail", `darius run complete exited 0, and the store has no completed run${tail === "" ? "" : `: ${tail}`}`);
  return step("broker-complete", "fail", `darius run complete exited ${String(broker.exit)}${tail === "" ? "" : `: ${tail}`}`);
}

/** Every step from what the check saw. Pure. */
export function judgeSteps(facts: StepFacts): BoxStep[] {
  const tiocsti = judgeTiocsti(facts.tiocsti);
  const { observed } = facts;
  if (!facts.box.built) {
    const { reason } = facts.box;
    return BOX_STEPS.map((name) => {
      if (name === "box") return step("box", "fail", reason);
      if (name === "tiocsti") return tiocsti;
      return step(name, "skip", "the box was not built");
    });
  }
  if (observed === undefined || "none" in observed) {
    const why = observed === undefined ? "the fake harness did not run" : observed.none;
    return BOX_STEPS.map((name) => {
      if (name === "box") return step("box", "fail", `the box was built, but ${why}`);
      if (name === "tiocsti") return tiocsti;
      return step(name, "skip", "the fake harness gave no result");
    });
  }
  const secrets = observed.secrets.length === 0
    ? step("secret-masked", "skip", "no masked secret file exists on this host to try")
    : judgeRefused("secret-masked", observed.secrets, "a masked secret");
  return [
    step("box", "pass", "built with the run layout, and the fake harness ran in it"),
    judgeRefused("store-write", observed.stores, "a new store file"),
    judgeRefused("policy-write", [observed.policy], "policy.json"),
    judgeRefused("claude-settings-write", [observed.claudeSettings], "~/.claude/settings.json"),
    secrets,
    ...SOCKET_STEPS.map((name) => judgeSocket(name, observed.sockets[name], facts.hostSockets[name])),
    judgeSystemdRun(observed.systemdRun),
    judgeConnects("web-api", observed.web, "own address"),
    judgeConnects("ssh-port", observed.ssh, "own address"),
    judgePublic(observed.public),
    tiocsti,
    judgeBroker(observed.broker, facts.brokerCompleted),
  ];
}

/** The check from its steps. */
export function boxCheckOf(at: { host: string; bwrap: string; kernel: string; run: string }, steps: BoxStep[]): BoxCheck {
  const failed = steps.filter((entry) => entry.outcome === "fail").map((entry) => entry.name);
  const skipped = steps.filter((entry) => entry.outcome === "skip").map((entry) => entry.name);
  return { host: at.host, darius: VERSION, bwrap: at.bwrap, kernel: at.kernel, outcome: failed.length === 0 ? "pass" : "fail", steps, failed, skipped, run: at.run };
}

/** The `box.checked` line of a check. `detail`: the reasons of the failed steps. */
export function boxCheckedLine(check: BoxCheck, who: string): LedgerLineInput {
  const line: LedgerLineInput = {
    who,
    type: "box.checked",
    darius: check.darius,
    bwrap: check.bwrap,
    kernel: check.kernel,
    outcome: check.outcome,
    failed: [...check.failed],
    skipped: [...check.skipped],
    run: check.run,
  };
  const reasons = check.steps.filter((entry) => entry.outcome === "fail").map((entry) => `${entry.name}: ${entry.reason}`);
  if (reasons.length > 0) line.detail = reasons.join("; ").slice(0, DETAIL_MAX);
  return line;
}

// --- parsing the fake harness's report ---------------------------------------------

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

function triedOf(value: JsonValue | undefined): Tried | undefined {
  if (!isRecord(value) || !isText(value.path) || !isText(value.result)) return undefined;
  return { path: value.path, result: value.result };
}

function triedList(value: JsonValue | undefined): Tried[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.map((entry) => triedOf(entry));
  return list.every((entry) => entry !== undefined) ? list : undefined;
}

function askedOf(value: JsonValue | undefined): Asked | undefined {
  if (!isRecord(value) || !isText(value.target) || !isText(value.body)) return undefined;
  const { status } = value;
  if (!isNumber(status) && !isText(status)) return undefined;
  return { target: value.target, status, body: value.body };
}

function askedList(value: JsonValue | undefined): Asked[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.map((entry) => askedOf(entry));
  return list.every((entry) => entry !== undefined) ? list : undefined;
}

/** The fake harness's stdout as a report, or undefined when it is not one. */
export function parseObserved(text: string): Observed | undefined {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const stores = triedList(parsed.stores);
  const policy = triedOf(parsed.policy);
  const claudeSettings = triedOf(parsed.claudeSettings);
  const secrets = triedList(parsed.secrets);
  const sockets = isRecord(parsed.sockets) ? parsed.sockets : undefined;
  const docker = triedList(sockets?.["docker-socket"]);
  const tailscale = triedList(sockets?.["tailscale-socket"]);
  const bus = triedList(sockets?.["system-bus"]);
  const systemd = isRecord(parsed.systemdRun) ? parsed.systemdRun : undefined;
  const web = askedList(parsed.web);
  const ssh = askedList(parsed.ssh);
  const open = askedOf(parsed.public);
  const broker = isRecord(parsed.broker) ? parsed.broker : undefined;
  const exit = broker?.exit;
  if (stores === undefined || policy === undefined || claudeSettings === undefined || secrets === undefined) return undefined;
  if (docker === undefined || tailscale === undefined || bus === undefined || web === undefined || ssh === undefined || open === undefined) return undefined;
  if (!isText(systemd?.result) || !isText(systemd.stderr) || broker === undefined || (!isNumber(exit) && !isText(exit))) return undefined;
  if (!isText(broker.stdout) || !isText(broker.stderr)) return undefined;
  return {
    stores,
    policy,
    claudeSettings,
    secrets,
    sockets: { "docker-socket": docker, "tailscale-socket": tailscale, "system-bus": bus },
    systemdRun: { result: systemd.result, stderr: systemd.stderr },
    web,
    ssh,
    public: open,
    broker: { exit, stdout: broker.stdout, stderr: broker.stderr },
  };
}

// --- the fake harness ---------------------------------------------------------------

/**
 * The fake harness, an ES module that runs on node and on bun. It reads its
 * plan from the JSON file in argv[2] and prints one Observed object. No
 * template literals in it, so `String.raw` keeps every escape as written.
 */
export const FAKE_HARNESS = String.raw`
import fs from "node:fs";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";

const plan = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const codeOf = (error) => (error && error.code) || String(error);

// A new file: refused is the proof; a file that does get made is removed at once.
function tryCreate(path) {
  try {
    fs.closeSync(fs.openSync(path, "wx"));
    try { fs.unlinkSync(path); } catch {}
    return "ok";
  } catch (error) { return codeOf(error); }
}
// An existing file opens for reading and writing, not truncated, and no byte is written.
function tryWrite(path) {
  if (!fs.existsSync(path)) return tryCreate(path);
  try { fs.closeSync(fs.openSync(path, "r+")); return "ok"; } catch (error) { return codeOf(error); }
}
// A masked secret is opened, never read.
function tryOpen(path) {
  try { fs.closeSync(fs.openSync(path, "r")); return "ok"; } catch (error) { return codeOf(error); }
}
function tryUnix(path) {
  return new Promise((done) => {
    const socket = net.connect(path);
    const timer = setTimeout(() => { socket.destroy(); done("timeout"); }, 3000);
    socket.once("connect", () => { clearTimeout(timer); socket.destroy(); done("ok"); });
    socket.once("error", (error) => { clearTimeout(timer); done(codeOf(error)); });
  });
}
const relay = new URL(process.env.HTTPS_PROXY || "http://127.0.0.1:1");
// One CONNECT through the box proxy. A tunnel that opens is closed at once: nothing is sent past the proxy.
function viaProxy(target, timeoutMs) {
  return new Promise((done) => {
    const socket = net.connect(Number(relay.port), relay.hostname);
    let got = "";
    let settled = false;
    const finish = (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      const end = got.indexOf("\r\n\r\n");
      done({ target, status, body: end < 0 ? "" : got.slice(end + 4, end + 4 + 400) });
    };
    const statusOf = () => Number((/^HTTP\/1\.[01] (\d{3})/.exec(got) || [])[1] || 0);
    const timer = setTimeout(() => finish("timeout"), timeoutMs);
    socket.once("connect", () => socket.write("CONNECT " + target + " HTTP/1.1\r\nHost: " + target + "\r\n\r\n"));
    socket.on("data", (chunk) => {
      got += chunk.toString("latin1");
      if (got.indexOf("\r\n\r\n") < 0) { if (got.length > 16384) finish("bad-reply"); return; }
      if (statusOf() === 200) finish(200);
    });
    socket.once("close", () => finish(got.indexOf("\r\n\r\n") < 0 ? "bad-reply" : statusOf()));
    socket.once("error", (error) => finish("error:" + codeOf(error)));
  });
}
function systemdRun() {
  const ran = spawnSync("systemd-run", ["--user", "--quiet", "--collect", "true"], { encoding: "utf8", timeout: 10000 });
  if (ran.error) return { result: codeOf(ran.error), stderr: "" };
  const result = ran.status === 0 ? "ok" : "exit " + String(ran.status === null ? ran.signal : ran.status);
  return { result, stderr: (ran.stderr || "").trim().slice(-200) };
}
function complete() {
  const fence = "\x60\x60\x60";
  const findings = "darius box check: the fake harness completes its run.\n" + fence + "darius-result\n" +
    JSON.stringify({ v: 1, status: "ok", summary: "box check" }) + "\n" + fence + "\n";
  return new Promise((done) => {
    const child = spawn(plan.darius, ["run", "complete", plan.run, "--outcome", "complete", "--findings-stdin"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 90000);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => { clearTimeout(timer); done({ exit: codeOf(error), stdout, stderr }); });
    child.once("close", (code, signal) => { clearTimeout(timer); done({ exit: code === null ? String(signal) : code, stdout: stdout.slice(-2000), stderr: stderr.slice(-2000) }); });
    child.stdin.end(findings);
  });
}

const seen = {};
seen.stores = plan.stores.map((dir) => {
  const path = dir + "/.darius-box-check-" + plan.run;
  return { path, result: tryCreate(path) };
});
seen.policy = { path: plan.policy, result: tryWrite(plan.policy) };
seen.claudeSettings = { path: plan.claudeSettings, result: tryWrite(plan.claudeSettings) };
seen.secrets = plan.secrets.map((path) => ({ path, result: tryOpen(path) }));
seen.sockets = {};
for (const [name, paths] of Object.entries(plan.sockets)) {
  seen.sockets[name] = [];
  for (const path of paths) seen.sockets[name].push({ path, result: await tryUnix(path) });
}
seen.systemdRun = systemdRun();
seen.web = [];
for (const target of plan.web) seen.web.push(await viaProxy(target, plan.refuseTimeoutMs));
seen.ssh = [];
for (const target of plan.ssh) seen.ssh.push(await viaProxy(target, plan.refuseTimeoutMs));
seen.public = await viaProxy(plan.publicTarget, plan.publicTimeoutMs);
seen.broker = await complete();
process.stdout.write(JSON.stringify(seen));
`;

/** What the fake harness tries, written next to it as JSON. */
interface HarnessPlan {
  run: string;
  darius: string;
  stores: string[];
  policy: string;
  claudeSettings: string;
  secrets: string[];
  sockets: PerSocket<readonly string[]>;
  web: string[];
  ssh: string[];
  publicTarget: string;
  refuseTimeoutMs: number;
  publicTimeoutMs: number;
}

/** The secret files the box masks, read off the argv: `--ro-bind /dev/null <file>`, sockets left out. */
export function maskedSecrets(argv: readonly string[], isSocket: (path: string) => boolean): string[] {
  const found: string[] = [];
  for (let index = 0; index + 2 < argv.length; index += 1) {
    if (argv[index] === "--") break;
    const path = argv[index + 2] ?? "";
    if (argv[index] === "--ro-bind" && argv[index + 1] === "/dev/null" && !isSocket(path) && !found.includes(path)) found.push(path);
  }
  return found.slice(0, SECRET_CAP);
}

/** The CONNECT targets: every own address on each port, and each named web host on its port. */
/** The CONNECT targets of the web-api and ssh-port steps, as `host:port`. */
export interface OwnTargets {
  web: string[];
  ssh: string[];
}

export function ownTargets(addresses: readonly string[], ports: readonly HostPort[]): OwnTargets {
  const web: string[] = [];
  for (const entry of ports) {
    if (entry.host !== "") web.push(hostPortText(entry));
    else for (const address of addresses) web.push(hostPortText({ host: address, port: entry.port }));
  }
  const ssh = addresses.map((address) => hostPortText({ host: address, port: 22 }));
  return { web: [...new Set(web)], ssh: [...new Set(ssh)] };
}

// --- the host facts -----------------------------------------------------------------

/** `bubblewrap 0.11.0` -> `0.11.0`; `none` without a working bwrap. */
export function bwrapVersion(): string {
  const probe = probeBwrap();
  if ("problem" in probe) return "none";
  const ran = spawnSync(probe.bin, ["--version"], { encoding: "utf8", timeout: 10_000 });
  const text = (ran.stdout ?? "").trim();
  const match = /^bubblewrap\s+(\S+)/u.exec(text);
  if (match?.[1] !== undefined) return match[1];
  return text === "" ? "unknown" : text.split("\n")[0]?.slice(0, 40) ?? "unknown";
}

/** The tiocsti knob at `path`. */
export function readTiocsti(path: string = TIOCSTI_KNOB): TiocstiRead {
  if (!existsSync(path)) return { missing: true };
  try {
    return { value: readFileSync(path, "utf8").trim() };
  } catch (cause) {
    return { error: errorMessage(cause) };
  }
}

function isSocketPath(path: string): boolean {
  try {
    return lstatSync(path).isSocket();
  } catch {
    return false;
  }
}

// --- the check ----------------------------------------------------------------------

/** Runs `fn` with `DARIUS_STATE_DIR` at `dir`, so every store read, the box facts and the broker use the temp store. */
async function withStoreDir<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const saved = process.env.DARIUS_STATE_DIR;
  process.env.DARIUS_STATE_DIR = dir;
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.DARIUS_STATE_DIR;
    else process.env.DARIUS_STATE_DIR = saved;
  }
}

/** What a finished fake harness gave: its stdout, or why there is none. */
function fakeEnd(end: { code: number | null } | { error: Error }, seen: { stdout: string; stderr: string; isTimedOut: boolean; timeoutMs: number }): { stdout: string } | { none: string } {
  if ("error" in end) return { none: `the fake harness did not start: ${errorMessage(end.error)}` };
  const tail = seen.stderr.replaceAll(/\s+/gu, " ").trim().slice(-300);
  if (seen.isTimedOut) return { none: `the fake harness did not finish in ${String(Math.round(seen.timeoutMs / 1000))} s` };
  if (end.code !== 0) return { none: `the fake harness exited ${String(end.code)}${tail === "" ? "" : `: ${tail}`}` };
  return { stdout: seen.stdout };
}

/** Runs `argv` without a shell and gives its stdout, or why it gave none. Async: the proxy and the broker run in this process. */
async function runFake(argv: readonly string[], cwd: string, timeoutMs: number): Promise<{ stdout: string } | { none: string }> {
  const [bin = "", ...args] = argv;
  const child = spawn(bin, args, { cwd, env: { PATH: process.env.PATH ?? "" }, stdio: ["ignore", "pipe", "pipe"] });
  const seen = { stdout: "", stderr: "", isTimedOut: false, timeoutMs };
  const timer = setTimeout(() => {
    seen.isTimedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  child.stdout.on("data", (chunk: Buffer) => (seen.stdout += chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => (seen.stderr += chunk.toString("utf8")));
  const closed = new Promise<{ code: number | null }>((resolve) => {
    child.once("close", (code) => resolve({ code }));
  });
  // No pid: the process never started, and "close" is not guaranteed to follow.
  const failed = new Promise<{ error: Error }>((resolve) => {
    child.once("error", (error) => {
      if (child.pid === undefined) resolve({ error });
    });
  });
  try {
    return fakeEnd(await Promise.race([closed, failed]), seen);
  } finally {
    clearTimeout(timer);
  }
}

function checkRitual(): Ritual {
  const now = new Date().toISOString();
  return { id: ulid(), kind: "ritual", slug: CHECK_SLUG, title: "Box check", created: now, updated: now, tags: [], anchor: "due", policy: { mode: "report", may: [], hold: [] } };
}

/** The runtime that runs the fake harness: this process's own, as the box sees it. */
function boxRuntime(): string {
  const runtime = realpathSync(process.execPath);
  const problem = boxPathProblem(runtime, { home: homedir(), runtimeDir: process.env.XDG_RUNTIME_DIR ?? "" });
  if (problem !== undefined) throw new Error(`the runtime ${runtime} cannot run in the box: ${problem}`);
  return runtime;
}

interface InBox {
  box: StepFacts["box"];
  observed: StepFacts["observed"];
  brokerCompleted: boolean;
}

/** Opens the box for the check's run in the temp store, runs the fake harness, and closes the box. */
async function runInBox(input: { base: string; realStore: string; timeoutMs: number; run: string }): Promise<InBox> {
  const store = join(input.base, "store");
  const work = join(input.base, "work");
  return withStoreDir(store, async () => {
    const project = openProject(CHECK_PROJECT, { create: true });
    const files = writeRunFiles(project.root, { project: project.name, run: input.run, ritual: checkRitual(), body: "" }, "shell");
    appendLine(project, { who: `box-check:${input.run}`, type: "run.started", item: itemRef("ritual", CHECK_SLUG), run: input.run });
    const request: SandboxRequest = {
      run: { id: input.run, dir: files.dir, policy: files.policy, project: project.name, who: `box-check:${input.run}` },
      workDir: work,
      isReport: false,
      hasTty: false,
      ritual: {},
      harness: claudeHarness,
      envPass: [],
    };
    let box: OpenBox;
    let runtime: string;
    try {
      runtime = boxRuntime();
      box = await openBox(request);
    } catch (cause) {
      return { box: { built: false, reason: errorMessage(cause).replaceAll(/\s+/gu, " ").trim() }, observed: undefined, brokerCompleted: false };
    }
    try {
      const targets = ownTargets(box.policy.ownAddresses, box.policy.webPorts);
      const publicHost = claudeHarness.boxHosts[0] ?? { host: "api.anthropic.com", port: 443 };
      const plan: HarnessPlan = {
        run: input.run,
        darius: box.darius,
        stores: [...new Set([stateDir(), input.realStore])],
        policy: files.policy,
        claudeSettings: join(homedir(), ".claude", "settings.json"),
        secrets: maskedSecrets(box.prefix, isSocketPath),
        sockets: HOST_SOCKETS,
        web: targets.web,
        ssh: targets.ssh,
        publicTarget: hostPortText(publicHost),
        refuseTimeoutMs: REFUSE_TIMEOUT_MS,
        publicTimeoutMs: PUBLIC_TIMEOUT_MS,
      };
      const script = join(work, "fake-harness.mjs");
      const planFile = join(work, "plan.json");
      writeFileSync(script, FAKE_HARNESS);
      writeFileSync(planFile, `${JSON.stringify(plan)}\n`);
      const ran = await runFake([...box.prefix, runtime, script, planFile], work, input.timeoutMs);
      const observed = "none" in ran ? ran : (parseObserved(ran.stdout) ?? { none: "the fake harness printed no report" });
      const completed = readLedger(project).some((line) => line.type === "run.completed" && line.run === input.run && line.outcome === "complete");
      return { box: { built: true }, observed, brokerCompleted: completed };
    } finally {
      await box.close();
    }
  });
}

/**
 * Runs the box check on this host and appends its `box.checked` line to
 * `global`. The temp store, work dir and run go after.
 */
export async function runBoxCheck(input: { global: Project; who: string; timeoutMs?: number; tiocstiPath?: string }): Promise<BoxCheck> {
  const run = ulid();
  const host = hostId();
  const realStore = stateDir();
  const base = realpathSync(mkdtempSync(join(tmpdir(), "darius-box-check-")));
  const hostSockets: PerSocket<boolean> = {
    "docker-socket": HOST_SOCKETS["docker-socket"].some((path) => existsSync(path)),
    "tailscale-socket": HOST_SOCKETS["tailscale-socket"].some((path) => existsSync(path)),
    "system-bus": HOST_SOCKETS["system-bus"].some((path) => existsSync(path)),
  };
  let inBox: InBox;
  try {
    mkdirSync(join(base, "work"), { mode: 0o700 });
    inBox = await runInBox({ base, realStore, timeoutMs: input.timeoutMs ?? HARNESS_TIMEOUT_MS, run });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
  const steps = judgeSteps({ box: inBox.box, observed: inBox.observed, tiocsti: readTiocsti(input.tiocstiPath), hostSockets, brokerCompleted: inBox.brokerCompleted });
  const check = boxCheckOf({ host, bwrap: bwrapVersion(), kernel: release(), run }, steps);
  appendLine(input.global, boxCheckedLine(check, input.who));
  return check;
}

// --- the ledger and the gate --------------------------------------------------------

/** The newest `box.checked` line of `darius` on `host`. */
export function latestBoxCheck(ledger: readonly LedgerLine[], at: { host: string; darius: string }): LedgerLine | undefined {
  return ledger.findLast((line) => line.type === "box.checked" && line.host === at.host && line.darius === at.darius);
}

/** Whether boxed runs may start: `ready`, maybe with what a dry run would do first; or why not (a `box-broken` skip). */
export type BoxReadiness = { ready: true; pending?: string } | { ready: false; detail: string };

function failedText(failed: readonly string[]): string {
  return failed.length === 0 ? "" : `: ${failed.join(", ")}`;
}

/**
 * The gate of every boxed launch, asked once per batch: run-due, `run now`,
 * `run resume` and `run follow-up`. Outside the box it is always ready. A
 * passing check for this host and darius version is enough. A failed one
 * from today skips as `box-broken` until `darius box check` passes or the
 * next day. Without one the check runs now, outside a dry run.
 */
export async function boxReadiness(input: {
  today: string;
  isDryRun: boolean;
  who: string;
  isBox?: boolean;
  openGlobal: () => Project | null;
  onCheck: (check: BoxCheck) => void;
  runCheck?: (global: Project, who: string) => Promise<BoxCheck>;
}): Promise<BoxReadiness> {
  if (!(input.isBox ?? isBoxChosen())) return { ready: true };
  const host = hostId();
  const global = input.openGlobal();
  const latest = global === null ? undefined : latestBoxCheck(readLedger(global), { host, darius: VERSION });
  if (latest?.outcome === "pass") return { ready: true };
  if (latest !== undefined && localToday(new Date(latest.at)) === input.today) {
    return { ready: false, detail: `the box check of darius ${VERSION} on ${host} failed today${failedText(textList(latest.failed))}; run darius box check` };
  }
  if (input.isDryRun || global === null) return { ready: true, pending: `would run darius box check for darius ${VERSION} first` };
  const check = await (input.runCheck ?? ((project, who) => runBoxCheck({ global: project, who })))(global, input.who);
  input.onCheck(check);
  if (check.outcome === "pass") return { ready: true };
  return { ready: false, detail: `the box check of darius ${VERSION} on ${host} failed${failedText(check.failed)}; run darius box check` };
}

// --- doctor and status --------------------------------------------------------------

/** One `box.checked` line as `box status` lists it. */
export interface ListedBoxCheck {
  host: string;
  darius: string;
  bwrap: string;
  kernel: string;
  outcome: string;
  at: string;
  failed: string[];
  skipped: string[];
  detail?: string;
}

function textList(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((entry) => isText(entry)) : [];
}

export function listedBoxCheck(line: LedgerLine): ListedBoxCheck | undefined {
  const { darius, outcome } = line;
  if (!isText(darius) || !isText(outcome)) return undefined;
  const entry: ListedBoxCheck = {
    host: line.host,
    darius,
    bwrap: isText(line.bwrap) ? line.bwrap : "unknown",
    kernel: isText(line.kernel) ? line.kernel : "unknown",
    outcome,
    at: line.at,
    failed: textList(line.failed),
    skipped: textList(line.skipped),
  };
  if (isText(line.detail)) entry.detail = line.detail;
  return entry;
}

/** The newest check per host and darius version, newest first. */
export function newestBoxChecks(ledger: readonly LedgerLine[]): ListedBoxCheck[] {
  const newest = new Map<string, ListedBoxCheck>();
  for (const line of ledger) {
    if (line.type !== "box.checked") continue;
    const entry = listedBoxCheck(line);
    if (entry !== undefined) newest.set(`${entry.host}\u0000${entry.darius}`, entry);
  }
  return [...newest.values()].toSorted((a, b) => b.at.localeCompare(a.at));
}

/** `✓ host-a, darius 0.121.0: pass, bwrap 0.11.0, kernel 6.1.0, 2026-11-03T...`. */
export function describeListed(entry: ListedBoxCheck): string {
  const mark = entry.outcome === "pass" ? "✓" : "!";
  const failed = entry.failed.length === 0 ? "" : `, failed: ${entry.failed.join(", ")}`;
  const skipped = entry.skipped.length === 0 ? "" : `, skipped: ${entry.skipped.join(", ")}`;
  return `${mark} ${entry.host}, darius ${entry.darius}: ${entry.outcome}, bwrap ${entry.bwrap}, kernel ${entry.kernel}, ${entry.at}${failed}${skipped}`;
}

/** The `_global` ledger, read only; none when there is no `_global` here. */
export function globalLedger(): LedgerLine[] {
  return existsSync(projectDir(GLOBAL_PROJECT)) ? readLedger(openProject(GLOBAL_PROJECT)) : [];
}

/**
 * What `darius doctor` says about the box: the sandbox choice and the newest
 * check on this host. Empty when the host does not use the box and has never
 * checked it.
 */
export function boxDoctorLines(ledger: readonly LedgerLine[] = globalLedger(), isBox: boolean = isBoxChosen()): string[] {
  const host = hostId();
  const mine = newestBoxChecks(ledger).filter((entry) => entry.host === host);
  if (!isBox && mine.length === 0) return [];
  const lines = [isBox ? `[run] sandbox = "box": rituals on ${host} run in the box.` : `[run] sandbox is not "box" on ${host}: rituals do not run in the box.`];
  const current = mine.find((entry) => entry.darius === VERSION);
  const newest = current ?? mine[0];
  if (newest === undefined) lines.push(`WARN: no box check on ${host} yet. run-due runs one before the first boxed run, or run darius box check.`);
  else lines.push(`newest box check: ${describeListed(newest)}`);
  if (isBox && current === undefined && newest !== undefined) lines.push(`WARN: no box check of darius ${VERSION} on ${host} yet. run-due runs one first.`);
  if (isBox && current?.outcome === "fail") lines.push("WARN: the box check failed: every ritual here is skipped as box-broken. Run darius box check after the fix.");
  return lines;
}
