/**
 * The sandbox of one launch (0.120.0). Every path that starts a harness goes
 * through `withRunSandbox`: run-due, `run now`, `run resume` and `run
 * follow-up` (all in src/runner/run-due.ts, headless or in a herdr tab), and
 * the gate check per harness version (src/runner/harness-check.ts). The gate
 * preflight runs inside the same sandbox as the harness. `claude --version`
 * stays outside: it starts no session.
 *
 * `off` and `mask` (src/core/sandbox.ts) behave as before: the mask fails
 * open, and a run starts unmasked with a line in its run.log.
 *
 * `box` fails closed. Per launch:
 *
 *   1. probe bwrap, read the host's facts, build the plan (src/core/box.ts)
 *   2. make the box dir and write its files (src/core/box-files.ts)
 *   3. run the plan's mount layout once with `true`, so a layout bwrap
 *      refuses is a box-broken skip, not a harness that fails to start
 *   4. start the proxy (src/core/box-proxy.ts) with the ritual's policy, and
 *      the broker (src/core/box-broker.ts)
 *   5. run the body: preflight, then the launch
 *   6. close the proxy and the broker, and remove the box dir, also when the
 *      body throws or the run timed out
 *   7. reap the box: SIGKILL every process of it that is still alive (a
 *      herdr tab keeps the harness after the run ends), and wait for them
 *      (src/core/box-reap.ts)
 *   8. walk the work dir again and rename each `.git`, `.claude`,
 *      `.darius.toml`, `.mcp.json` and bare repo the run made (`checkPlants`
 *      in src/core/box-work.ts); skipped when the work dir was read-only. A
 *      box that would not die taints the work dir with no walk; so does what
 *      the walk cannot settle (src/core/box-taint.ts)
 *
 * Around all of it, on a box host, the launch holds the work dir's lock
 * (src/core/box-pending.ts): a launch in the same work dir, or in a folder
 * above or below, skips as `lease-held` until it ends. Before step 5 the
 * launch writes a pending record, and removes it after step 8. The first step
 * of every launch, in any sandbox mode, settles the pending records of dead
 * runners in its work dir or above or below: it reaps that box and runs its
 * check. SIGTERM and SIGINT run steps 6 to 8 before the runner exits.
 *
 * A tainted work dir runs nothing, boxed or not: every launch there is
 * `box-broken` until `darius box clear <work dir>`.
 *
 * When a step of 1 to 4 fails, nothing is started, and the caller skips the
 * ritual as `box-broken` with the reason. The reason is in the run's run.log.
 *
 * A ritual whose marker says `sandbox = "off"` (0.124.0) skips all of it on a
 * box host: it runs as on an `off` host, with one run.log line that says so.
 */

import { appendFileSync, existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { BoxError, boxPlan, parseHostPort, type HostPort, type RitualBoxKeys, type WorkScan } from "../core/box.ts";
import { BOX_RELAY_PORT, boxEnterPrefix, boxFiles, hostBoxFiles, writeBoxFiles } from "../core/box-files.ts";
import { hostBoxFacts, prepareBox, removeBox } from "../core/box-host.ts";
import { reapBox, REAP_WAIT_MS, type Reaped } from "../core/box-reap.ts";
import { addTaint, taintReason, taintsOn } from "../core/box-taint.ts";
import { isAlive, overlaps, readPending, removePending, selfProc, takeLock, writePending, type PendingBox, type WorkLock } from "../core/box-pending.ts";
import { checkPlants, PLANT_CHECK_CAP_MS, realOr, scanExtra, type PlantCheck } from "../core/box-work.ts";
import { findSystemdRun, randomTag, scopePrefix, scopeUnit } from "../core/box-scope.ts";
import { startBroker, type Broker } from "../core/box-broker.ts";
import { hostAddresses, hostSubnets, startBoxProxy, withWebAddresses, type BoxPolicy, type BoxProxy, type Resolver } from "../core/box-proxy.ts";
import { loadConfigIfPresent } from "../core/config.ts";
import { configDir } from "../core/paths.ts";
import { appendRunLog, BOX_FIX, noteSandbox, probeBwrap, readTiocsti, resolveSandbox, sandboxPrefix, TIOCSTI_KNOB, type Sandbox } from "../core/sandbox.ts";
import type { HarnessAdapter } from "../harness/contract.ts";
import { errorMessage } from "../runtime.ts";
import { TAB_TERM } from "../surface/herdr.ts";
import { tailnetAddress } from "../web/auth.ts";
import { dariusBin } from "./launch.ts";

/** The darius web lanes' default ports: stable and next. Always refused on a non-public address. */
export const WEB_LANE_PORTS: readonly number[] = [4747, 4748];
/** The files in the config dir that name the web lanes' address. */
const WEB_ENV_FILES: readonly string[] = ["web.env", "next.env"];
const LAYOUT_PROBE_TIMEOUT_MS = 10_000;
const STALE_PROBE_TIMEOUT_MS = 1_000;

/** What one launch needs of its sandbox. */
export interface SandboxRequest {
  run: {
    id: string;
    /** The run dir in the store. */
    dir: string;
    /** policy.json in the run dir. */
    policy: string;
    project: string;
    /** The `who` of the lines the broker writes for the run: `<harness>:<run>`. */
    who: string;
  };
  workDir: string;
  /** Report mode: the box shows the work dir read-only. */
  isReport: boolean;
  /** A herdr tab: the harness needs the terminal, so no `--new-session`, and the tab's TERM. */
  hasTty: boolean;
  /** The ritual's box keys from the marker; `{}` when there is no marker. */
  ritual: RitualBoxKeys;
  harness: HarnessAdapter;
  /** The profile's `env_pass`. */
  envPass: readonly string[];
  /**
   * Called once after a post-run check that blocked a plant or left something
   * unresolved, so the caller can record it on the run. `owner` is the run
   * the check was for: this launch's, or a dead runner's whose pending record
   * this launch settled. A throw is caught.
   */
  onPlants?: (check: PlantCheck, owner: PlantOwner) => void;
}

/** The run a post-run check was for. */
export interface PlantOwner {
  run: string;
  project: string;
}

/** The sandbox a body runs in. */
export interface RunSandbox {
  state: Sandbox["state"];
  /** The argv in front of the harness, program first; undefined when nothing is in front. */
  prefix: readonly string[] | undefined;
  /** The argv in front of the gate preflight: the same sandbox, and in the box a scope unit of its own. */
  gatePrefix: readonly string[] | undefined;
  /** In the box: a surface that cannot prove it must end the launch, not go on. */
  isBox: boolean;
  /** The marker's `sandbox = "off"` took this launch out of the host's box (0.124.0); the run's start line records it. */
  isRitualOff: boolean;
}

/**
 * What `withRunSandbox` gives back: the body's value; why the box could not
 * be built or the work dir is tainted; or `busy`, another launch holds the
 * work dir's lock, and a later try may start.
 */
export type SandboxEnd<T> = { ran: T } | { boxBroken: string } | { busy: string };

/** One open box: the argv prefix, the proxy's policy, the darius path the box runs, and how to close it. */
export interface OpenBox {
  /** The harness's argv prefix: the scope when it is on, then bwrap. */
  prefix: string[];
  /** The gate preflight's prefix: the same box, in a scope unit of its own. */
  gatePrefix: string[];
  /** The bwrap argv alone, with no scope in front. */
  layout: string[];
  scope: BoxScope;
  policy: BoxPolicy;
  /** The darius CLI as the box sees it. */
  darius: string;
  /** The launch's scan of the work dir: the post-run check renames what is new. */
  work: WorkScan;
  /** The box dir, which the outer bwrap names: the reap finds the box by it. */
  boxDir: string;
  /** The box shows the work dir read-only: no post-run check. */
  isWorkReadOnly: boolean;
  close(): Promise<void>;
}

/** `KEY=value` lines of an env file, `export` and quotes allowed. Missing file: none. */
function envFileValues(path: string, keys: readonly string[]): Map<string, string[]> {
  const values = new Map<string, string[]>();
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return values;
  }
  for (const line of text.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*?)\s*$/u.exec(line);
    const key = match?.[1];
    if (key === undefined || !keys.includes(key)) continue;
    const value = (match?.[2] ?? "").replace(/^(["'])(.*)\1$/u, "$2");
    if (value !== "") values.set(key, [...(values.get(key) ?? []), value]);
  }
  return values;
}

/** The host and port of a web URL, or undefined when it is not an http(s) URL. */
function urlTarget(text: string): { host: string; port: number; isExplicit: boolean } | undefined {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  const host = url.hostname.replace(/^\[(.*)\]$/u, "$1").toLowerCase();
  if (host === "") return undefined;
  const isExplicit = url.port !== "";
  return { host, port: isExplicit ? Number(url.port) : url.protocol === "https:" ? 443 : 80, isExplicit };
}

/**
 * The darius web ports the proxy refuses: 4747 and 4748 on any non-public
 * address, `DARIUS_WEB_URL` of `web.env` and `next.env` by its host and port
 * (and its port on any non-public address when the URL names one), and
 * `DARIUS_WEB_PORT` there. A URL that does not parse is left out: the web
 * lane does not serve on it either.
 */
export function webPorts(dir: string = configDir()): HostPort[] {
  const ports = new Set<number>(WEB_LANE_PORTS);
  const hosts: HostPort[] = [];
  for (const name of WEB_ENV_FILES) {
    const values = envFileValues(join(dir, name), ["DARIUS_WEB_URL", "DARIUS_WEB_PORT"]);
    for (const text of values.get("DARIUS_WEB_URL") ?? []) {
      const target = urlTarget(text);
      if (target === undefined) continue;
      hosts.push({ host: target.host, port: target.port });
      if (target.isExplicit) ports.add(target.port);
    }
    for (const text of values.get("DARIUS_WEB_PORT") ?? []) {
      const port = Number(text);
      if (/^[1-9][0-9]{0,4}$/u.test(text) && port <= 65_535) ports.add(port);
    }
  }
  return [...[...ports].map((port) => ({ host: "", port })), ...hosts];
}

/**
 * The proxy policy of one run: the ritual's `net` and `reach`, the harness
 * hosts, this host's addresses, the web ports. Each `DARIUS_WEB_URL` host is
 * resolved here, and its addresses are refused on that port too (0.122.0).
 * `resolve` is for tests; the default asks the system resolver.
 */
export async function boxPolicy(ritual: RitualBoxKeys, harness: Pick<HarnessAdapter, "boxHosts">, resolve?: Resolver): Promise<BoxPolicy> {
  const tailnet = await tailnetAddress();
  return {
    net: ritual.net ?? "public",
    reach: (ritual.reach ?? []).map((entry) => parseHostPort(entry)),
    harnessHosts: [...harness.boxHosts],
    ownAddresses: hostAddresses(tailnet === null ? [] : [tailnet]),
    ownSubnets: hostSubnets(),
    webPorts: await withWebAddresses(webPorts(), resolve),
  };
}

/** Runs `layout` (bwrap and its mounts, up to `--`, maybe behind a scope) with `true`; why it failed, or undefined. */
function layoutProblem(layout: readonly string[]): string | undefined {
  const [bin = "", ...args] = [...layout, "true"];
  const probe = spawnSync(bin, args, { encoding: "utf8", timeout: LAYOUT_PROBE_TIMEOUT_MS });
  if (probe.error === undefined && probe.status === 0) return undefined;
  const stderr = (probe.stderr ?? "").trim().slice(-300);
  const why = probe.error?.message ?? `exit ${String(probe.status ?? probe.signal)}`;
  return `${why}${stderr === "" ? "" : `: ${stderr}`}`;
}

/** Runs the plan's mounts with `true` instead of the command: a layout bwrap refuses fails here, before anything starts. */
function probeLayout(layout: readonly string[]): void {
  const problem = layoutProblem(layout);
  if (problem !== undefined) throw new BoxError(`bwrap refused the box layout (${problem})`);
}

/** The scope a box runs in (src/core/box-scope.ts): none without `[box] slice`, on, or skipped and why. */
export type BoxScope = { kind: "none" } | { kind: "on"; slice: string; systemdRun: string } | { kind: "skipped"; slice: string; reason: string };

/**
 * The layout probe, through a scope of `[box] slice` when one is set. A scope
 * that cannot start fails open: no systemd-run, or a probe that fails in the
 * scope while the plain probe passes, gives `skipped`. The plain probe still
 * fails closed: a layout bwrap refuses throws, scope or not.
 */
export function probeScoped(input: { slice: string | undefined; run: string; layout: readonly string[] }): BoxScope {
  const { slice, layout } = input;
  if (slice === undefined) {
    probeLayout(layout);
    return { kind: "none" };
  }
  const systemdRun = findSystemdRun();
  if (systemdRun === undefined) {
    probeLayout(layout);
    return { kind: "skipped", slice, reason: "systemd-run is not on PATH or in the NixOS profiles" };
  }
  const scoped = layoutProblem([...scopePrefix({ systemdRun, slice, unit: scopeUnit(input.run, randomTag()) }), ...layout]);
  if (scoped === undefined) return { kind: "on", slice, systemdRun };
  probeLayout(layout);
  return { kind: "skipped", slice, reason: `the layout probe failed in a scope of ${slice} and passed without it (${scoped})` };
}

/** The argv in front of one launch: a fresh scope unit when the scope is on, then the box. */
function launchPrefix(scope: BoxScope, run: string, argv: readonly string[]): string[] {
  if (scope.kind !== "on") return [...argv];
  return [...scopePrefix({ systemdRun: scope.systemdRun, slice: scope.slice, unit: scopeUnit(run, randomTag()) }), ...argv];
}

/** One line of the proxy's decisions in `<run dir>/net.jsonl`. Best effort: the run matters more than its log. */
function netLog(runDir: string): (line: string) => void {
  return (line) => {
    try {
      appendFileSync(join(runDir, "net.jsonl"), `${line}\n`);
    } catch {
      // A full disk must not stop the run.
    }
  };
}

/**
 * Builds the box for one launch and starts its proxy and broker. Throws a
 * BoxError, or the error of the step that failed, after closing what it
 * started and removing the box dir. `darius box check`
 * (src/runner/box-check.ts) opens its box here too, whatever `[run] sandbox`
 * says, so the check proves the layout a run gets.
 */
export async function openBox(request: SandboxRequest): Promise<OpenBox> {
  if (request.hasTty) checkTiocsti();
  const probe = probeBwrap(BOX_FIX);
  if ("problem" in probe) throw new BoxError(probe.problem);
  const cfg = loadConfigIfPresent();
  const facts = hostBoxFacts({ workDir: request.workDir });
  // In a tab the tab's shell gives the harness its own TERM when it runs the alias.
  if (request.hasTty) facts.env = { ...facts.env, TERM: TAB_TERM };
  const filesInput = hostBoxFiles({ run: request.run.id, dariusBin: dariusBin(), home: facts.home, runtimeDir: facts.runtimeDir, env: facts.env });
  const enter = boxEnterPrefix(filesInput.darius, BOX_RELAY_PORT);
  const plan = boxPlan({
    bwrap: probe.bin,
    command: enter,
    relayPort: BOX_RELAY_PORT,
    run: { id: request.run.id, dir: request.run.dir, policy: request.run.policy, project: request.run.project },
    workDir: request.workDir,
    isReport: request.isReport,
    hasTty: request.hasTty,
    ritual: request.ritual,
    host: cfg?.box ?? { sshAgent: false },
    harness: request.harness,
    envPass: request.envPass,
    facts,
  });
  checkExtras(plan.writable, realOr(request.workDir));
  const policy = await boxPolicy(request.ritual, request.harness);
  let proxy: BoxProxy | undefined;
  let broker: Broker | undefined;
  let scope: BoxScope = { kind: "none" };
  let isClosed = false;
  // Only a box dir this launch made is removed: prepareBox refuses one that is there, which a live launch owns.
  let isPrepared = false;
  const close = async (): Promise<void> => {
    if (isClosed) return;
    isClosed = true;
    for (const part of [proxy, broker]) {
      try {
        await part?.close();
      } catch {
        // The box dir goes next in any case.
      }
    }
    if (isPrepared) removeBox(plan);
  };
  try {
    await clearStaleBox(plan.boxDir);
    prepareBox(plan);
    isPrepared = true;
    writeBoxFiles(plan.boxDir, boxFiles(filesInput));
    scope = probeScoped({ slice: cfg?.box.slice, run: request.run.id, layout: plan.argv.slice(0, plan.argv.length - enter.length) });
    // Resource limits are not a boundary: a scope that does not start fails open, and the run says so.
    if (scope.kind === "skipped") appendRunLog(request.run.dir, `box: no scope in ${scope.slice}, so this run has no [box] slice limits: ${scope.reason}`);
    proxy = await startBoxProxy({ socketPath: join(plan.boxDir, "proxy.sock"), policy, log: netLog(request.run.dir) });
    broker = await startBroker({
      socketPath: join(plan.boxDir, "broker.sock"),
      run: request.run.id,
      project: request.run.project,
      who: request.run.who,
      darius: [dariusBin()],
      runDir: request.run.dir,
    });
  } catch (cause) {
    await close();
    throw cause;
  }
  const run = request.run.id;
  return {
    prefix: launchPrefix(scope, run, plan.argv),
    gatePrefix: launchPrefix(scope, run, plan.argv),
    layout: plan.argv,
    scope,
    policy,
    darius: filesInput.darius,
    work: facts.work,
    isWorkReadOnly: plan.isWorkReadOnly,
    boxDir: plan.boxDir,
    close,
  };
}

/** How long the walk of all writable extras may take, together. */
const EXTRA_SCAN_CAP_MS = 30_000;

/**
 * Refuses a writable extra that holds a `.git`, `.claude`, `.darius.toml`,
 * `.mcp.json` or bare repo, or that the walk cannot vouch for: the box gives
 * a writable extra no read-only guards, so the run could change what a later
 * unboxed tool trusts there. The work dir inside an extra is left to the
 * work dir's own walk.
 */
function checkExtras(extras: readonly string[], workDir: string): void {
  const deadline = Date.now() + EXTRA_SCAN_CAP_MS;
  for (const path of extras) {
    const scan = scanExtra({ path, pruned: [workDir], deadline });
    const guard = scan.guards[0];
    if (guard !== undefined) throw new BoxError(`the writable extra ${path} holds ${guard}, a .git, .claude, .darius.toml, .mcp.json or bare repo the box cannot keep read-only there; take it out of [box] writable or the ritual's writable, so this run does not start`);
    const problem = scan.problems[0];
    if (problem !== undefined) throw new BoxError(`${problem}; the walk of the writable extra ${path} cannot vouch for what is there, so this run does not start`);
    if (scan.timedOut) throw new BoxError(`the walk of the writable extras stopped within the ${String(EXTRA_SCAN_CAP_MS / 1000)} s cap at ${path}; a guard it did not reach would be writable in the box, so this run does not start`);
  }
}

/**
 * A launch on the terminal (herdr) has no `--new-session`, so only the kernel
 * knob stops TIOCSTI from typing into the operator's terminal. It is read at
 * each such launch: a box check passed earlier says nothing about now.
 */
function checkTiocsti(): void {
  const read = readTiocsti();
  if ("value" in read && read.value === "0") return;
  const now = "value" in read ? `is ${read.value}` : "missing" in read ? "is missing" : `cannot be read (${read.error})`;
  throw new BoxError(`${TIOCSTI_KNOB} ${now}, not 0: a run on the terminal could type into it, so this run does not start`);
}

/** True when something listens on the Unix socket at `path`. */
function isListening(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(path);
    const done = (isUp: boolean): void => {
      socket.destroy();
      resolve(isUp);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(STALE_PROBE_TIMEOUT_MS, () => done(false));
  });
}

/**
 * Removes the box dir of a runner that died before its cleanup, so a resume
 * of that run can build its box again. A box dir whose proxy or broker still
 * answers belongs to a live launch: it stays, and prepareBox refuses.
 */
export async function clearStaleBox(boxDir: string): Promise<void> {
  if (!existsSync(boxDir)) return;
  for (const socket of ["proxy.sock", "broker.sock"]) {
    if (await isListening(join(boxDir, socket))) return;
  }
  rmSync(boxDir, { recursive: true, force: true });
}

/** The `box-broken` reason as one line for the report: the error's message. */
function brokenReason(cause: unknown): string {
  const message = errorMessage(cause).replaceAll(/\s+/gu, " ").trim();
  return message === "" ? "the box could not be built" : message;
}

/** The cleanups of the boxes open in this process: a SIGTERM or SIGINT runs them before the exit. */
const OPEN_BOXES = new Set<() => Promise<void>>();
/** How long the signal cleanup may take before the runner exits anyway: the reap's wait and the check's cap fit. */
const SIGNAL_CLEANUP_MS = 45_000;
const SIGNALS = ["SIGTERM", "SIGINT"] as const;
const SIGNAL_EXIT = { SIGTERM: 143, SIGINT: 130 } as const satisfies Record<(typeof SIGNALS)[number], number>;
let isExiting = false;

/** On SIGTERM or SIGINT with a box open: reap and check every open box, best effort, then exit as the signal would. */
function onSignal(signal: (typeof SIGNALS)[number]): void {
  if (isExiting) return;
  isExiting = true;
  setTimeout(() => process.exit(SIGNAL_EXIT[signal]), SIGNAL_CLEANUP_MS);
  void Promise.allSettled([...OPEN_BOXES].map((cleanup) => cleanup())).then(() => process.exit(SIGNAL_EXIT[signal]));
}

const SIGNAL_HANDLERS = { SIGTERM: () => onSignal("SIGTERM"), SIGINT: () => onSignal("SIGINT") } as const;

/** Keeps `cleanup` for a signal while the box is open; the handlers are on only while a box is. */
function trackBox(cleanup: () => Promise<void>): () => void {
  if (OPEN_BOXES.size === 0) for (const signal of SIGNALS) process.on(signal, SIGNAL_HANDLERS[signal]);
  OPEN_BOXES.add(cleanup);
  return () => {
    OPEN_BOXES.delete(cleanup);
    if (OPEN_BOXES.size === 0 && !isExiting) for (const signal of SIGNALS) process.off(signal, SIGNAL_HANDLERS[signal]);
  };
}

/** One run of `fn`, however often it is called: the body's end and a signal share the cleanup. */
function once(fn: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | undefined;
  return () => {
    running ??= fn();
    return running;
  };
}

/**
 * Runs `body` in this host's sandbox for one launch. Every launch first takes
 * the work dir's lock (a held one gives `busy`) and settles what dead runners
 * left there (`settlePending`). On a box host it holds the lock to the end of
 * the post-run check; elsewhere it lets go before the body. For `box`, the
 * box is built first and closed after the body, also when it throws. A box
 * that cannot be built runs nothing: the result is `boxBroken`, and the
 * reason is in run.log. A tainted work dir gives `boxBroken` in every mode,
 * `mask` and `off` too; otherwise those two never do.
 */
export async function withRunSandbox<T>(request: SandboxRequest, body: (sandbox: RunSandbox) => Promise<T>): Promise<SandboxEnd<T>> {
  const workDir = realOr(request.workDir);
  const taken = takeLockQuietly(workDir, request.run.id);
  if ("busy" in taken) {
    appendRunLog(request.run.dir, `box: this run does not start now: ${taken.busy}`);
    return { busy: taken.busy };
  }
  const { lock } = taken;
  try {
    await settlePending(request, workDir);
    // A tainted work dir runs nothing, in or out of the box: what a run left there may run code unboxed.
    const taint = taintsOn(workDir)[0];
    if (taint !== undefined) {
      const reason = taintReason(taint);
      appendRunLog(request.run.dir, `box: this run does not start: ${reason}`);
      return { boxBroken: reason };
    }
    const sandbox = resolveSandbox();
    if (sandbox.state !== "box") {
      // No box, so no post-run check: the lock guards only the settling above.
      lock.release();
      noteSandbox(request.run.dir, sandbox);
      const prefix = sandboxPrefix(sandbox);
      return { ran: await body({ state: sandbox.state, prefix, gatePrefix: prefix, isBox: false, isRitualOff: false }) };
    }
    // The operator's opt-out in the committed marker: this ritual runs as on an `off` host. The box keeps the marker read-only.
    if (request.ritual.sandbox === "off") {
      appendRunLog(request.run.dir, "box: off for this ritual by the marker");
      return { ran: await body({ state: "off", prefix: undefined, gatePrefix: undefined, isBox: false, isRitualOff: true }) };
    }
    return await inBox(request, { workDir, lock }, body);
  } finally {
    lock.release();
  }
}

/** The lock, never a throw: a state dir that cannot hold it is a busy launch, which a later try may start. */
function takeLockQuietly(workDir: string, run: string): { lock: WorkLock } | { busy: string } {
  try {
    return takeLock({ workDir, run });
  } catch (cause) {
    return { busy: `the box lock of ${workDir} cannot be taken: ${brokenReason(cause)}` };
  }
}

/** Opens the box, writes the pending record, runs the body, and settles the work dir after, on a signal too. */
async function inBox<T>(request: SandboxRequest, held: { workDir: string; lock: WorkLock }, body: (sandbox: RunSandbox) => Promise<T>): Promise<SandboxEnd<T>> {
  let box: OpenBox;
  try {
    box = await openBox(request);
  } catch (cause) {
    const reason = brokenReason(cause);
    appendRunLog(request.run.dir, `box: this run does not start, the box could not be built: ${reason}`);
    return { boxBroken: reason };
  }
  let pending: string;
  try {
    pending = writePending({ run: request.run.id, project: request.run.project, runDir: request.run.dir, workDir: held.workDir, ids: [...box.work.ids], isBareTop: box.work.isBareTop, boxDir: box.boxDir, isWorkReadOnly: box.isWorkReadOnly, ...selfProc(), at: new Date().toISOString() });
  } catch (cause) {
    await box.close();
    const reason = `the pending record of the box cannot be written: ${brokenReason(cause)}`;
    appendRunLog(request.run.dir, `box: this run does not start: ${reason}`);
    return { boxBroken: reason };
  }
  const finish = once(async () => {
    const reaped = await reapQuietly(box.boxDir);
    await box.close();
    afterBox(request, box, reaped);
    removePendingQuietly(request.run.dir, pending);
  });
  const untrack = trackBox(async () => {
    await finish();
    held.lock.release();
  });
  try {
    return { ran: await body({ state: "box", prefix: box.prefix, gatePrefix: box.gatePrefix, isBox: true, isRitualOff: false }) };
  } finally {
    await finish();
    untrack();
  }
}

function removePendingQuietly(runDir: string, file: string): void {
  try {
    removePending(file);
  } catch (cause) {
    appendRunLog(runDir, `box: the pending record ${file} could not be removed: ${brokenReason(cause)}`);
  }
}

/**
 * Settles the pending record of every runner that died mid-run in `workDir`
 * (a real path) or a folder above or below: reaps what is left of its box,
 * runs its post-run check with the guard ids its launch recorded, taints
 * what that cannot settle, and removes the record. Its lines go to that
 * run's run.log, and one line to this launch's. A damaged record taints `/`.
 * Runs under the work dir's lock. Never throws.
 */
async function settlePending(request: SandboxRequest, workDir: string): Promise<void> {
  let entries: ReturnType<typeof readPending>;
  try {
    entries = readPending();
  } catch (cause) {
    taintDamaged(request, `the pending records cannot be listed (${brokenReason(cause)})`);
    return;
  }
  for (const entry of entries) {
    if ("damaged" in entry) {
      taintDamaged(request, `${entry.damaged}; the box of a run may have been left unchecked`);
      // Kept aside, so `darius box clear /` ends the taint.
      try {
        renameSync(entry.file, `${entry.file}.damaged`);
      } catch {
        // The taint stands in any case.
      }
      continue;
    }
    const { record } = entry;
    if (!overlaps(record.workDir, workDir) || isAlive(record)) continue;
    await settleDead(request, record);
    removePendingQuietly(request.run.dir, entry.file);
  }
}

function taintDamaged(request: SandboxRequest, reason: string): void {
  appendRunLog(request.run.dir, `box: unresolved, every work dir is tainted: ${reason}`);
  try {
    addTaint({ workDir: "/", run: request.run.id, project: request.run.project, at: new Date().toISOString(), reasons: [reason] });
  } catch (cause) {
    appendRunLog(request.run.dir, `box: the taint could not be written: ${brokenReason(cause)}`);
  }
}

/** The post-run check of a launch whose runner died. */
async function settleDead(request: SandboxRequest, record: PendingBox): Promise<void> {
  const owner: PlantOwner = { run: record.run, project: record.project };
  const runDir = existsSync(record.runDir) ? record.runDir : request.run.dir;
  appendRunLog(runDir, `box: the runner of run ${record.run} (pid ${String(record.pid)}) ended before its post-run check; run ${request.run.id} reaps its box and checks the work dir now`);
  const reaped = await reapQuietly(record.boxDir);
  const all = settle({ workDir: record.workDir, runDir, launch: { ids: record.ids, isBareTop: record.isBareTop }, isWorkReadOnly: record.isWorkReadOnly, reaped });
  if (all.unresolved.length > 0) taintWorkDir({ workDir: record.workDir, runDir, owner }, all.unresolved);
  await clearStaleBox(record.boxDir).catch(() => undefined);
  appendRunLog(request.run.dir, `box: settled the box of run ${record.run}, whose runner died: ${String(all.blocked.length)} blocked, ${String(all.unresolved.length)} unresolved`);
  notePlants(request, runDir, all, owner);
}

/** The reap, never a throw: a reap that fails counts as a box that would not die. */
async function reapQuietly(boxDir: string): Promise<Reaped> {
  try {
    return await reapBox({ boxDir });
  } catch (cause) {
    return { killed: 0, left: [], error: brokenReason(cause) };
  }
}

/** What one post-run check needs. */
interface SettleInput {
  workDir: string;
  runDir: string;
  launch: Pick<WorkScan, "ids" | "isBareTop">;
  isWorkReadOnly: boolean;
  reaped: Reaped;
}

/**
 * The post-run check after the reap. A box that would not die is unresolved
 * with no walk: a live process could race the renames and the chmods. Writes
 * the run.log lines and gives the check; never throws.
 */
function settle(input: SettleInput): PlantCheck {
  const { reaped } = input;
  const unresolved: string[] = [];
  if (reaped.left.length > 0) unresolved.push(`the box would not die within ${String(REAP_WAIT_MS / 1000)} s (pids ${reaped.left.join(", ")}), so the work dir was not checked`);
  if (reaped.error !== undefined) unresolved.push(`the box could not be reaped (${reaped.error}), so the work dir was not checked`);
  let check: PlantCheck = { blocked: [], unresolved: [], repaired: [], isUnfinished: false };
  if (unresolved.length === 0 && !input.isWorkReadOnly) {
    try {
      check = checkPlants({ workDir: input.workDir, launch: input.launch, capMs: PLANT_CHECK_CAP_MS });
    } catch (cause) {
      check = { blocked: [], unresolved: [`the post-run check failed: ${brokenReason(cause)}`], repaired: [], isUnfinished: false };
    }
  }
  const all: PlantCheck = { ...check, unresolved: [...unresolved, ...check.unresolved] };
  for (const line of all.repaired) appendRunLog(input.runDir, `box: ${line}`);
  for (const line of all.blocked) appendRunLog(input.runDir, `box: blocked ${line}`);
  for (const line of all.unresolved) appendRunLog(input.runDir, `box: unresolved, the work dir is tainted: ${line}`);
  return all;
}

/**
 * The post-run check, after the box is reaped and closed: renames what the
 * run planted in its work dir and writes one run.log line per plant. What it
 * cannot settle, and a box that would not die, taint the work dir. Hands the
 * check to `onPlants`. It never throws: the run's own end matters more.
 */
function afterBox(request: SandboxRequest, box: Pick<OpenBox, "work" | "isWorkReadOnly">, reaped: Reaped): void {
  const owner: PlantOwner = { run: request.run.id, project: request.run.project };
  const all = settle({ workDir: request.workDir, runDir: request.run.dir, launch: box.work, isWorkReadOnly: box.isWorkReadOnly, reaped });
  if (all.unresolved.length > 0) taintWorkDir({ workDir: realOr(request.workDir), runDir: request.run.dir, owner }, all.unresolved);
  notePlants(request, request.run.dir, all, owner);
}

/** Hands a check that blocked or left something to `onPlants`. */
function notePlants(request: SandboxRequest, runDir: string, all: PlantCheck, owner: PlantOwner): void {
  if (all.blocked.length === 0 && all.unresolved.length === 0) return;
  try {
    request.onPlants?.(all, owner);
  } catch (cause) {
    appendRunLog(runDir, `box: the post-run check could not be recorded on the run: ${brokenReason(cause)}`);
  }
}

/** Taints a work dir on this host. A taint that cannot be written is a run.log line: there is nothing else to tell. */
function taintWorkDir(target: { workDir: string; runDir: string; owner: PlantOwner }, reasons: readonly string[]): void {
  try {
    addTaint({ workDir: target.workDir, run: target.owner.run, project: target.owner.project, at: new Date().toISOString(), reasons: [...reasons] });
  } catch (cause) {
    appendRunLog(target.runDir, `box: the taint could not be written: ${brokenReason(cause)}`);
  }
}
