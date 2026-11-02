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
 *
 * Both read only what the box shows. src/cli.ts runs this command before it
 * reads any marker, link or store, so nothing here touches the store or the
 * config. `--proxy` defaults to /run/darius/proxy.sock.
 */

import { isatty } from "node:tty";

import { BOX_PROXY_SOCKET } from "../core/box.ts";
import { boxMarkerPath, connectTunnel, enterBox } from "../core/box-inside.ts";
import { UsageError, type Command, type ParsedArgs } from "./registry.ts";

const HELP = [
  "usage: darius box enter --relay-port N [--proxy PATH] -- <command> [args...]",
  "       darius box connect <host> <port> [--proxy PATH]",
  "",
  "enter    inside the box: start the relay on 127.0.0.1:N to the proxy socket, run the command, pass its exit code and signals",
  "connect  the ssh ProxyCommand in the box: a tunnel through the proxy on stdin and stdout",
  "",
  `--proxy defaults to ${BOX_PROXY_SOCKET}. The runner starts both verbs; you do not run them by hand.`,
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

async function run(args: ParsedArgs): Promise<number> {
  const verb = args.positional[0];
  switch (verb) {
    case "enter":
      return runEnter(args);
    case "connect":
      return runConnect(args);
    case undefined:
      throw new UsageError(HELP);
    default:
      throw new UsageError(`unknown box verb: ${verb}. Run 'darius box --help'.`);
  }
}

export const boxCommand: Command = {
  name: "box",
  summary: "the run sandbox: enter (inside, starts the relay and the harness) and connect (the ssh ProxyCommand)",
  usage: "box enter|connect",
  help: HELP,
  flags: ["relay-port", "proxy"],
  run,
};
