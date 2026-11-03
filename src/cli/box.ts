/**
 * `darius box`: the verbs of the run sandbox (M4 box).
 *
 *   box enter --relay-port N [--proxy PATH] -- <command> [args...]
 *       Inside the box only. Starts the relay on 127.0.0.1:N to the proxy
 *       socket, runs the command, passes SIGTERM, SIGINT and SIGHUP on (SIGINT
 *       only when stdin is not a terminal, which sends it to the whole
 *       foreground group itself), and exits with its code (128 + the signal
 *       number on a signal).
 *   box connect <host> <port> [--proxy PATH]
 *       The ssh ProxyCommand in the box: a tunnel through the proxy on stdin
 *       and stdout. A refusal is the proxy's one line on stderr, exit 1.
 *   box check [--json]
 *       Outside: proves the box on this host with a fake harness, no paid
 *       call (src/runner/box-check.ts), and appends `box.checked` to
 *       `_global`. Exit 0 pass, 1 fail.
 *   box status [--json]
 *       The newest box check per host and darius version, newest first, and
 *       the tainted work dirs of this host.
 *   box clear <work dir>
 *       Removes the taint of a work dir (src/core/box-taint.ts) and prints
 *       what it cleared. Exit 1 when there was none. A run cannot clear one.
 *
 * `enter` and `connect` read only what the box shows. src/cli.ts runs those
 * two before it reads any marker, link or store, so they touch neither the
 * store nor the config. `--proxy` defaults to /run/darius/proxy.sock.
 * `check`, `status` and `clear` run outside, on the normal path.
 */

import { resolve } from "node:path";
import { isatty } from "node:tty";

import { BOX_PROXY_SOCKET } from "../core/box.ts";
import { boxMarkerPath, connectTunnel, enterBox } from "../core/box-inside.ts";
import { clearTaint, readTaints, taintDir, type Taint } from "../core/box-taint.ts";
import { realOr } from "../core/box-work.ts";
import { defaultWho } from "../core/ledger.ts";
import { GLOBAL_PROJECT, openProject } from "../core/store.ts";
import { describeListed, globalLedger, newestBoxChecks, runBoxCheck, type BoxCheck, type BoxStep } from "../runner/box-check.ts";
import { UsageError, type Command, type ParsedArgs } from "./registry.ts";

const HELP = [
  "usage: darius box enter --relay-port N [--proxy PATH] -- <command> [args...]",
  "       darius box connect <host> <port> [--proxy PATH]",
  "       darius box check [--json]",
  "       darius box status [--json]",
  "       darius box clear <work dir>",
  "",
  "enter    inside the box: start the relay on 127.0.0.1:N to the proxy socket, run the command, pass its exit code and signals",
  "connect  the ssh ProxyCommand in the box: a tunnel through the proxy on stdin and stdout",
  "check    prove the box on this host with a fake harness (no paid call) and record box.checked; exit 0 pass, 1 fail",
  "status   the newest box check per host and darius version, and this host's tainted work dirs",
  "clear    remove the taint of a work dir after you looked at it; later runs there start again",
  "",
  `--proxy defaults to ${BOX_PROXY_SOCKET}. The runner starts enter and connect; you do not run them by hand.`,
  "run-due runs box check by itself before the first boxed run of a darius version.",
].join("\n");

const PORT = /^[1-9][0-9]{0,4}$/u;

function portOf(text: string | undefined, what: string): number {
  const port = Number(text);
  if (text === undefined || !PORT.test(text) || port > 65_535) throw new UsageError(`${what} must be a port from 1 to 65535`);
  return port;
}

function proxyOf(args: ParsedArgs): string {
  const flag = args.flags.proxy;
  if (flag === undefined || flag === false) return BOX_PROXY_SOCKET;
  if (flag === true || flag === "") throw new UsageError("--proxy needs a socket path");
  return flag;
}

async function runEnter(args: ParsedArgs): Promise<number> {
  const relay = args.flags["relay-port"];
  const argv = args.positional.slice(1);
  if (argv.length === 0) throw new UsageError("box enter needs a command after --");
  return enterBox({
    relayPort: portOf(relay === true || relay === false ? undefined : relay, "--relay-port"),
    proxySocket: proxyOf(args),
    argv,
    markerPath: boxMarkerPath(),
    stderr: process.stderr,
    isStdinTty: isatty(0),
  });
}

async function runConnect(args: ParsedArgs): Promise<number> {
  const [, host, portText, ...extra] = args.positional;
  if (host === undefined || portText === undefined || extra.length > 0) throw new UsageError("usage: darius box connect <host> <port>");
  if (host === "") throw new UsageError("box connect needs a host");
  const result = await connectTunnel({ proxySocket: proxyOf(args), host, port: portOf(portText, "the port"), input: process.stdin, output: process.stdout });
  // The tunnel is closed: stdin must not keep the process alive.
  process.stdin.destroy();
  if (result.ok) return 0;
  process.stderr.write(`${result.line}\n`);
  return 1;
}

const STEP_MARK = { pass: "✓", fail: "!", skip: "·" } satisfies Record<BoxStep["outcome"], string>;

function describeCheck(check: BoxCheck): string[] {
  const lines = check.steps.map((entry) => `${STEP_MARK[entry.outcome]} ${entry.name}: ${entry.outcome}, ${entry.reason}`);
  const failed = check.failed.length === 0 ? "" : `, failed: ${check.failed.join(", ")}`;
  const mark = check.outcome === "pass" ? "✓" : "!";
  lines.push(`${mark} box check ${check.outcome} on ${check.host}: darius ${check.darius}, bwrap ${check.bwrap}, kernel ${check.kernel}${failed}`);
  return lines;
}

async function runCheck(args: ParsedArgs): Promise<number> {
  if (args.positional.length > 1) throw new UsageError("usage: darius box check [--json]");
  const global = openProject(GLOBAL_PROJECT, { create: true });
  const check = await runBoxCheck({ global, who: defaultWho() });
  if (args.json) console.log(JSON.stringify({ ok: check.outcome === "pass", ...check }));
  else console.log(describeCheck(check).join("\n"));
  return check.outcome === "pass" ? 0 : 1;
}

function describeTaint(taint: Taint): string {
  return `! tainted ${taint.workDir}: run ${taint.run} (${taint.project}) at ${taint.at}: ${taint.reasons.join("; ")}. Runs there skip as box-broken. After you looked: darius box clear ${taint.workDir}`;
}

function runStatus(args: ParsedArgs): number {
  if (args.positional.length > 1) throw new UsageError("usage: darius box status [--json]");
  const checks = newestBoxChecks(globalLedger());
  const tainted = readTaints();
  if (args.json) {
    console.log(JSON.stringify({ checks, tainted }));
    return 0;
  }
  if (checks.length === 0) console.log("· no box checks yet; run darius box check, or run-due runs one before the first boxed run");
  for (const entry of checks) console.log(describeListed(entry));
  for (const taint of tainted) console.log(describeTaint(taint));
  return 0;
}

/** `box clear <work dir>`: removes its taint. A run may not: the taint is the operator's to judge. */
function runClear(args: ParsedArgs): number {
  const [, dir, ...extra] = args.positional;
  if (dir === undefined || dir === "" || extra.length > 0) throw new UsageError("usage: darius box clear <work dir>");
  if (process.env.DARIUS_RUN !== undefined || process.env.DARIUS_RUN_POLICY !== undefined) {
    console.error("darius box clear: a run cannot clear a taint; the operator does, after looking at the work dir");
    return 1;
  }
  const real = realOr(resolve(dir));
  const cleared = clearTaint(real);
  if (cleared.length === 0) {
    console.error(`darius box clear: no taint on ${real} in ${taintDir()}`);
    return 1;
  }
  for (const taint of cleared) console.log(`✓ cleared the taint of ${taint.workDir}: run ${taint.run} (${taint.project}) at ${taint.at}: ${taint.reasons.join("; ")}`);
  return 0;
}

async function run(args: ParsedArgs): Promise<number> {
  const verb = args.positional[0];
  switch (verb) {
    case "enter":
      return runEnter(args);
    case "connect":
      return runConnect(args);
    case "check":
      return runCheck(args);
    case "status":
      return runStatus(args);
    case "clear":
      return runClear(args);
    case undefined:
      throw new UsageError(HELP);
    default:
      throw new UsageError(`unknown box verb: ${verb}. Run 'darius box --help'.`);
  }
}

export const boxCommand: Command = {
  name: "box",
  summary: "the run sandbox: check, status and clear on this host; enter and connect run inside the box",
  usage: "box check|status|clear|enter|connect",
  help: HELP,
  flags: ["relay-port", "proxy"],
  run,
};
