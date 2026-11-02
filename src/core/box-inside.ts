/**
 * Inside the box (M4 box, spec 03): the relay, `darius box enter` and
 * `darius box connect`.
 *
 * The box has its own network namespace with only loopback. The proxy
 * (src/core/box-proxy.ts) runs outside, on a Unix socket the box sees at
 * /run/darius/proxy.sock. Programs reach it two ways:
 *
 *   - the relay: `box enter` listens on 127.0.0.1:<port> and pipes each TCP
 *     connection to the proxy socket, unread. HTTPS_PROXY and the other proxy
 *     variables point at it. A tool that ignores them gets no network.
 *   - `box connect <host> <port>`: the ssh ProxyCommand. It sends CONNECT on
 *     the proxy socket itself, then joins stdin and stdout to the tunnel.
 *
 * Both use only what the box shows: no store, no config, no marker of a
 * project. `box enter` refuses to run without the box marker file
 * (/run/darius/box.json), so a harness never starts unboxed by mistake.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createConnection, createServer, isIPv6, type AddressInfo, type Server, type Socket } from "node:net";
import { constants } from "node:os";
import type { Readable, Writable } from "node:stream";

import { BoxError } from "./box.ts";
import type { JsonValue } from "./model.ts";
import { BOX_MARKER, type BoxMarker } from "./box-files.ts";
import { errorMessage } from "../runtime.ts";

/** The signals `box enter` passes on to the harness. */
export const FORWARDED_SIGNALS = ["SIGTERM", "SIGINT", "SIGHUP"] as const;
/** The proxy's reply header must end within this many bytes. */
const REPLY_HEADER_MAX = 16 * 1024;
/** What `box connect` keeps of a refusal body for its one stderr line. */
const REFUSAL_MAX = 4 * 1024;

/** The marker path. `DARIUS_BOX_MARKER` overrides it, for the tests only. */
export function boxMarkerPath(): string {
  const path = process.env.DARIUS_BOX_MARKER;
  return path === undefined || path === "" ? BOX_MARKER : path;
}

function isRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isAddressInfo(value: AddressInfo | string | null): value is AddressInfo {
  return value !== null && typeof value !== "string";
}

/** The marker in a parsed `box.json`, or undefined when it is not one. */
function markerOf(value: JsonValue): BoxMarker | undefined {
  if (!isRecord(value)) return undefined;
  const { v, run, darius } = value;
  if (v !== 1 || !isText(run) || !isText(darius)) return undefined;
  return { v, run, darius };
}

/** The box marker at `path`. Throws a BoxError outside a box. */
export function readBoxMarker(path: string): BoxMarker {
  if (!existsSync(path)) throw new BoxError(`not in a box: ${path} is missing. darius box enter runs only inside a box the runner built`);
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new BoxError(`the box marker ${path} cannot be read: ${errorMessage(cause)}`);
  }
  const marker = markerOf(parsed);
  if (marker === undefined) throw new BoxError(`the box marker ${path} is not a darius box marker`);
  return marker;
}

// --- the relay ---------------------------------------------------------------------

export interface Relay {
  port: number;
  close(): Promise<void>;
}

/** Joins two sockets both ways; when one ends or fails, both close. */
function join2(left: Socket, right: Socket): void {
  const end = (): void => {
    left.destroy();
    right.destroy();
  };
  left.once("error", end);
  right.once("error", end);
  left.once("close", end);
  right.once("close", end);
  left.pipe(right);
  right.pipe(left);
}

/**
 * Listens on 127.0.0.1:`port` (0: any free port) and pipes each connection
 * to the proxy socket. The relay reads nothing: the proxy decides.
 */
export async function startRelay(port: number, socketPath: string): Promise<Relay> {
  const open = new Set<Socket>();
  const keep = (socket: Socket): void => {
    open.add(socket);
    socket.once("close", () => open.delete(socket));
  };
  const server: Server = createServer((client) => {
    keep(client);
    const upstream = createConnection(socketPath);
    keep(upstream);
    join2(client, upstream);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", (cause) => reject(new BoxError(`the relay cannot listen on 127.0.0.1:${String(port)}: ${errorMessage(cause)}`)));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => resolve());
  });
  const address = server.address();
  const bound = isAddressInfo(address) ? address.port : port;
  return {
    port: bound,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        for (const socket of open) socket.destroy();
      }),
  };
}

// --- box enter ---------------------------------------------------------------------

export interface EnterInput {
  relayPort: number;
  proxySocket: string;
  argv: readonly string[];
  markerPath: string;
  /** Where the lines of `box enter` itself go. */
  stderr: Writable;
  /**
   * True when stdin is a terminal (a herdr tab). The kernel then sends the
   * SIGINT of Ctrl-C to the whole foreground process group, the harness
   * included, so `box enter` must not send it a second time.
   */
  isStdinTty?: boolean;
}

/** The signals `box enter` passes on: SIGINT only when no terminal sends it to the harness itself. */
export function forwardedSignals(isStdinTty: boolean): NodeJS.Signals[] {
  return FORWARDED_SIGNALS.filter((signal) => !(isStdinTty && signal === "SIGINT"));
}

/** The exit code of a child: its own, or 128 plus the signal number. */
export function exitCodeOf(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) return code;
  if (signal === null) return 1;
  return 128 + (constants.signals[signal] ?? 0);
}

/**
 * Checks the box marker, starts the relay, runs `argv` with this process's
 * stdio and env, passes SIGTERM, SIGINT and SIGHUP on (SIGINT only when stdin
 * is not a terminal: a terminal sends it to the harness itself), and returns
 * its exit code (128 + the signal number when a signal ended it). A program
 * that cannot start gives 127.
 */
export async function enterBox(input: EnterInput): Promise<number> {
  const [program, ...args] = input.argv;
  if (program === undefined) throw new BoxError("box enter needs a command after --");
  readBoxMarker(input.markerPath);
  const relay = await startRelay(input.relayPort, input.proxySocket);
  const handlers = new Map<NodeJS.Signals, () => void>();
  const passed = forwardedSignals(input.isStdinTty === true);
  try {
    return await new Promise<number>((resolve) => {
      const child = spawn(program, args, { stdio: "inherit" });
      for (const signal of FORWARDED_SIGNALS) {
        // Each signal keeps a handler, so `box enter` never dies before the harness.
        const handler = (): void => {
          if (passed.includes(signal)) child.kill(signal);
        };
        handlers.set(signal, handler);
        process.on(signal, handler);
      }
      child.once("error", (cause) => {
        input.stderr.write(`darius box: cannot start ${program}: ${errorMessage(cause)}\n`);
        resolve(127);
      });
      child.once("exit", (code, signal) => resolve(exitCodeOf(code, signal)));
    });
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
    await relay.close();
  }
}

// --- box connect -------------------------------------------------------------------

export interface ConnectInput {
  proxySocket: string;
  host: string;
  port: number;
  input: Readable;
  output: Writable;
}

export type ConnectResult = { ok: true } | { ok: false; line: string };

/** `host:port` as the CONNECT line writes it: an IPv6 address in brackets. */
export function connectAuthority(host: string, port: number): string {
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return isIPv6(bare) ? `[${bare}]:${String(port)}` : `${bare}:${String(port)}`;
}

/** The first line of a refusal body, or the status line when the body is empty. */
function refusalLine(statusLine: string, body: string): string {
  const first = body.split("\n").find((line) => line.trim() !== "");
  return first === undefined ? `darius box: the proxy said ${statusLine}` : first.trim();
}

/** Reads the proxy's reply header. Resolves with the status line and what came after the header. */
function readReply(socket: Socket): Promise<{ status: string; rest: Buffer }> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const fail = (why: string): void => {
      cleanup();
      reject(new BoxError(why));
    };
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf("\r\n\r\n");
      if (end === -1) {
        if (buffer.length > REPLY_HEADER_MAX) fail("the box proxy sent a reply header that is too long");
        return;
      }
      cleanup();
      socket.pause();
      const head = buffer.subarray(0, end).toString("latin1");
      resolve({ status: head.split("\r\n")[0] ?? "", rest: buffer.subarray(end + 4) });
    };
    const onEnd = (): void => fail("the box proxy closed the connection without a reply");
    const onError = (cause: Error): void => fail(`the box proxy failed: ${errorMessage(cause)}`);
    const cleanup = (): void => {
      socket.off("data", onData);
      socket.off("end", onEnd);
      socket.off("error", onError);
    };
    socket.on("data", onData);
    socket.once("end", onEnd);
    socket.once("error", onError);
  });
}

/** The rest of a refusal body, at most REFUSAL_MAX bytes. */
function readBody(socket: Socket, first: Buffer): Promise<string> {
  return new Promise((resolve) => {
    let body = first;
    const done = (): void => {
      socket.destroy();
      resolve(body.subarray(0, REFUSAL_MAX).toString("utf8"));
    };
    socket.on("data", (chunk: Buffer) => {
      body = Buffer.concat([body, chunk]);
      if (body.length > REFUSAL_MAX) done();
    });
    socket.once("end", done);
    socket.once("error", done);
    socket.resume();
  });
}

function openSocket(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    socket.once("connect", () => {
      socket.removeAllListeners("error");
      resolve(socket);
    });
    socket.once("error", (cause) => reject(new BoxError(`cannot reach the box proxy at ${path}: ${errorMessage(cause)}`)));
  });
}

/**
 * Opens a tunnel to `host:port` through the proxy socket and joins `input`
 * and `output` to it until the tunnel closes. A refusal resolves with the
 * proxy's one line. `output` is never ended: it may be this process's stdout.
 */
export async function connectTunnel(input: ConnectInput): Promise<ConnectResult> {
  const authority = connectAuthority(input.host, input.port);
  const socket = await openSocket(input.proxySocket);
  socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
  const reply = await readReply(socket);
  if (!/^HTTP\/1\.[01] 200 /u.test(`${reply.status} `)) {
    return { ok: false, line: refusalLine(reply.status, await readBody(socket, reply.rest)) };
  }
  if (reply.rest.length > 0) input.output.write(reply.rest);
  await new Promise<void>((resolve) => {
    socket.once("close", () => resolve());
    socket.on("error", () => socket.destroy());
    input.input.pipe(socket);
    socket.pipe(input.output, { end: false });
    socket.resume();
  });
  input.input.unpipe(socket);
  return { ok: true };
}
