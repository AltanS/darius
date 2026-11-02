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
 *
 * When a step of 1 to 4 fails, nothing is started, and the caller skips the
 * ritual as `box-broken` with the reason. The reason is in the run's run.log.
 */

import { appendFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { BoxError, boxPlan, parseHostPort, type HostPort, type RitualBoxKeys } from "../core/box.ts";
import { BOX_RELAY_PORT, boxEnterPrefix, boxFiles, hostBoxFiles, writeBoxFiles } from "../core/box-files.ts";
import { hostBoxFacts, prepareBox, removeBox } from "../core/box-host.ts";
import { startBroker, type Broker } from "../core/box-broker.ts";
import { hostAddresses, startBoxProxy, type BoxPolicy, type BoxProxy } from "../core/box-proxy.ts";
import { loadConfigIfPresent } from "../core/config.ts";
import { configDir } from "../core/paths.ts";
import { appendRunLog, noteSandbox, probeBwrap, resolveSandbox, sandboxPrefix, type Sandbox } from "../core/sandbox.ts";
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
}

/** The sandbox a body runs in. */
export interface RunSandbox {
  state: Sandbox["state"];
  /** The argv in front of the harness or the gate, program first; undefined when nothing is in front. */
  prefix: readonly string[] | undefined;
  /** In the box: a surface that cannot prove it must end the launch, not go on. */
  isBox: boolean;
}

/** What `withRunSandbox` gives back: the body's value, or why the box could not be built. */
export type SandboxEnd<T> = { ran: T } | { boxBroken: string };

/** One open box: the argv prefix, and how to close it. */
interface OpenBox {
  prefix: string[];
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

/** The proxy policy of one run: the ritual's `net` and `reach`, the harness hosts, this host's addresses, the web ports. */
export async function boxPolicy(ritual: RitualBoxKeys, harness: HarnessAdapter): Promise<BoxPolicy> {
  const tailnet = await tailnetAddress();
  return {
    net: ritual.net ?? "public",
    reach: (ritual.reach ?? []).map((entry) => parseHostPort(entry)),
    harnessHosts: [...harness.boxHosts],
    ownAddresses: hostAddresses(tailnet === null ? [] : [tailnet]),
    webPorts: webPorts(),
  };
}

/** Runs the plan's mounts with `true` instead of the command: a layout bwrap refuses fails here, before anything starts. */
function probeLayout(prefix: readonly string[], enterLength: number): void {
  const layout = prefix.slice(0, prefix.length - enterLength);
  const [bin = "", ...args] = [...layout, "true"];
  const probe = spawnSync(bin, args, { encoding: "utf8", timeout: LAYOUT_PROBE_TIMEOUT_MS });
  if (probe.error === undefined && probe.status === 0) return;
  const stderr = (probe.stderr ?? "").trim().slice(-300);
  const why = probe.error?.message ?? `exit ${String(probe.status ?? probe.signal)}`;
  throw new BoxError(`bwrap refused the box layout (${why}${stderr === "" ? "" : `: ${stderr}`})`);
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
 * started and removing the box dir.
 */
async function openBox(request: SandboxRequest): Promise<OpenBox> {
  const probe = probeBwrap();
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
  const policy = await boxPolicy(request.ritual, request.harness);
  let proxy: BoxProxy | undefined;
  let broker: Broker | undefined;
  let isClosed = false;
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
    removeBox(plan);
  };
  try {
    prepareBox(plan);
    writeBoxFiles(plan.boxDir, boxFiles(filesInput));
    probeLayout(plan.argv, enter.length);
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
  for (const warning of plan.warnings) appendRunLog(request.run.dir, warning);
  return { prefix: plan.argv, close };
}

/** The `box-broken` reason as one line for the report: the error's message. */
function brokenReason(cause: unknown): string {
  const message = errorMessage(cause).replaceAll(/\s+/gu, " ").trim();
  return message === "" ? "the box could not be built" : message;
}

/**
 * Runs `body` in this host's sandbox for one launch. For `box`, the box is
 * built first and closed after the body, also when it throws. A box that
 * cannot be built runs nothing: the result is `boxBroken`, and the reason is
 * in run.log. `mask` and `off` never give `boxBroken`.
 */
export async function withRunSandbox<T>(request: SandboxRequest, body: (sandbox: RunSandbox) => Promise<T>): Promise<SandboxEnd<T>> {
  const sandbox = resolveSandbox();
  if (sandbox.state !== "box") {
    noteSandbox(request.run.dir, sandbox);
    return { ran: await body({ state: sandbox.state, prefix: sandboxPrefix(sandbox), isBox: false }) };
  }
  let box: OpenBox;
  try {
    box = await openBox(request);
  } catch (cause) {
    const reason = brokenReason(cause);
    appendRunLog(request.run.dir, `box: this run does not start, the box could not be built: ${reason}`);
    return { boxBroken: reason };
  }
  try {
    return { ran: await body({ state: "box", prefix: box.prefix, isBox: true }) };
  } finally {
    await box.close();
  }
}
