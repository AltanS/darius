/**
 * The box broker (M4 box, spec 04): the one way a boxed run writes the store.
 *
 * In the box the store is read-only, but a run must still hold and complete
 * itself. The runner starts one broker per run, outside the box, on a Unix
 * socket the box sees as `/run/darius/broker.sock`. Inside, `darius run hold`
 * and `darius run complete` find that socket (src/cli/run.ts) and send
 * `{argv, stdin}` to it, one JSON line. The broker checks the argv, runs the
 * real CLI outside as an argv list (no shell), and sends back
 * `{exit, stdout, stderr}`, so a refused result block reaches the model as it
 * would outside the box.
 *
 * WHAT PASSES, and nothing else:
 *
 *   run hold <this run> --question Q [--question Q ...]
 *   run complete <this run> --outcome complete|failed|abandoned [--findings-stdin] [--json]
 *   (either may carry `--project <this run's project>`, which the run prompt names; it is checked, not passed on)
 *
 * A flag may also be written as `--question=Q` or `--outcome=X`. Every other
 * flag (`--who`, `--project`, `--on`, `--banner`, `--stdin`, `--note`, ...),
 * `--help`, `-h`, a bare `--`, a second positional, another verb and another
 * run id are refused with exit 2 and one stderr line. The broker rebuilds the
 * argv it runs from the checked parts, always in the `--flag=value` form, so
 * a question can never turn into a flag or a help request.
 *
 * ENV. The child gets an env built from scratch: the run id, its policy file,
 * the project and the `who` the runner names, `HOME`, `PATH`, and the store
 * dirs when the runner has them. The request's own env, if it sends one, is
 * never read. `DARIUS_BOX_BROKER` is set empty, so the child never forwards
 * to a broker itself.
 *
 * LIMITS. stdin at most FINDINGS_MAX plus 64 KB; one request at a time (a
 * second one is refused while the first runs); the child is killed after
 * 60 s. Each request and its exit code is one line in `<run dir>/broker.jsonl`.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";

import type { JsonValue } from "./model.ts";
import { projectDir } from "./paths.ts";
import { FINDINGS_MAX } from "./result.ts";
import { errorMessage } from "../runtime.ts";
import type { ChildEnv } from "../surface/headless.ts";

/** Where the box binds the broker socket (src/core/box.ts binds the box dir at /run/darius). */
export const BOX_BROKER_SOCKET = "/run/darius/broker.sock";

/** The most stdin bytes a request may carry: the findings limit plus 64 KB for the result block. */
export const BROKER_STDIN_MAX = FINDINGS_MAX + 64 * 1024;

/** A JSON string may escape a byte as six (`\u0000`), so the request line may be that much longer. */
const REQUEST_MAX = 6 * BROKER_STDIN_MAX + 64 * 1024;

const DEFAULT_TIMEOUT_MS = 60_000;

/** What the broker keeps of the child's stdout and of its stderr, each. */
const OUTPUT_MAX = 1024 * 1024;

const OUTCOMES: readonly string[] = ["complete", "failed", "abandoned"];

/** The env keys the broker copies from the runner, when they are set. */
const PASSED_KEYS: readonly string[] = ["HOME", "PATH", "DARIUS_STATE_DIR", "DARIUS_CONFIG_DIR"];

export interface BrokerOptions {
  /** The socket to listen on, `<box dir>/broker.sock`. Created with mode 0600. */
  socketPath: string;
  /** This run's id. Only commands for it pass. */
  run: string;
  /** The run's project, as its run record names it. */
  project: string;
  /** The `who` of the lines the run writes, as the run record names it (`claude:<run>`). */
  who: string;
  /** The darius CLI to run, program first: `[dariusBin()]`. */
  darius: readonly string[];
  /** The run dir in the store. Default: `<project dir>/runs/<run>`. */
  runDir?: string;
  /** Default 60 000. */
  timeoutMs?: number;
  /** Where HOME, PATH and the store dirs come from. Default: process.env. */
  sourceEnv?: Readonly<Record<string, string | undefined>>;
}

export interface Broker {
  close(): Promise<void>;
}

export interface BrokerRequest {
  argv: string[];
  stdin?: string;
}

export interface BrokerReply {
  exit: number;
  stdout: string;
  stderr: string;
}

/** The argv the broker runs, with whether the child gets stdin, or why the request is refused. */
export type BrokerCheck = { argv: string[]; stdin: boolean } | Refused;

// --- the argv check ---------------------------------------------------------------

/** One token as it goes into a one-line message: quoted, no line breaks, at most 60 characters. */
function quote(token: string): string {
  const flat = token.replaceAll(/[\r\n]+/gu, " ");
  return JSON.stringify(flat.length > 60 ? `${flat.slice(0, 57)}...` : flat);
}

interface FlagSpec {
  /** Flags that take a value, as `--flag value` or `--flag=value`. May repeat. */
  valued: ReadonlySet<string>;
  /** Flags that stand alone. At most once. */
  bare: ReadonlySet<string>;
}

interface ReadFlags {
  values: Map<string, string[]>;
  bare: Set<string>;
}

/** Help and the end of flags are never passed on, wherever they stand. */
function forbiddenToken(token: string): string | undefined {
  if (token === "--") return "a bare -- is not allowed";
  if (token === "-h" || token === "--help" || token.startsWith("--help=")) return `${token.split("=")[0] ?? token} is not allowed; read the help outside the run`;
  return undefined;
}

/** Reads the flags after `run <verb> <run>`, or says why they are refused. */
interface Refused {
  refused: string;
}

function readFlags(tokens: readonly string[], spec: FlagSpec, verb: string): ReadFlags | Refused {
  const refuse = (message: string): Refused => ({ refused: `run ${verb}: ${message}` });
  const values = new Map<string, string[]>();
  const bare = new Set<string>();
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    if (!token.startsWith("--") || token.length === 2) return refuse(`unexpected word ${quote(token)}`);
    const body = token.slice(2);
    const equalsAt = body.indexOf("=");
    const name = equalsAt >= 0 ? body.slice(0, equalsAt) : body;
    if (spec.bare.has(name)) {
      if (equalsAt >= 0) return refuse(`--${name} takes no value`);
      if (bare.has(name)) return refuse(`--${name} is given twice`);
      bare.add(name);
      index += 1;
      continue;
    }
    if (!spec.valued.has(name)) return refuse(`--${name} is not allowed through the box broker`);
    if (equalsAt >= 0) {
      values.set(name, [...(values.get(name) ?? []), body.slice(equalsAt + 1)]);
      index += 1;
      continue;
    }
    const next = tokens[index + 1];
    if (next === undefined) return refuse(`--${name} needs a value`);
    if (next.startsWith("--")) return refuse(`--${name} needs a value; for a value that starts with --, write --${name}=VALUE`);
    values.set(name, [...(values.get(name) ?? []), next]);
    index += 2;
  }
  return { values, bare };
}

const HOLD_FLAGS: FlagSpec = { valued: new Set(["question", "project"]), bare: new Set() };
const COMPLETE_FLAGS: FlagSpec = { valued: new Set(["outcome", "project"]), bare: new Set(["findings-stdin", "json"]) };

function checkHold(run: string, flags: ReadFlags): BrokerCheck {
  const questions = flags.values.get("question") ?? [];
  if (questions.length === 0) return { refused: "run hold needs at least one --question" };
  return { argv: ["run", "hold", run, ...questions.map((question) => `--question=${question}`)], stdin: false };
}

function checkComplete(run: string, flags: ReadFlags): BrokerCheck {
  const outcomes = flags.values.get("outcome") ?? [];
  if (outcomes.length !== 1) return { refused: `run complete needs --outcome ${OUTCOMES.join("|")} exactly once` };
  const outcome = outcomes[0] ?? "";
  if (!OUTCOMES.includes(outcome)) return { refused: `run complete needs --outcome ${OUTCOMES.join("|")}, got ${quote(outcome)}` };
  const argv = ["run", "complete", run, `--outcome=${outcome}`];
  const stdin = flags.bare.has("findings-stdin");
  if (stdin) argv.push("--findings-stdin");
  if (flags.bare.has("json")) argv.push("--json");
  return { argv, stdin };
}

/**
 * Checks a request's argv (`run hold|complete <run> ...`, without `darius`)
 * against the two shapes above, for the run `run`.
 */
export function checkBrokerArgv(argv: readonly string[], run: string, project?: string): BrokerCheck {
  for (const token of argv) {
    const forbidden = forbiddenToken(token);
    if (forbidden !== undefined) return { refused: forbidden };
  }
  const [command, verb, target, ...rest] = argv;
  if (command !== "run" || (verb !== "hold" && verb !== "complete")) {
    return { refused: `only run hold and run complete pass, got ${quote([command, verb].filter((word) => word !== undefined).join(" "))}` };
  }
  if (target !== run) return { refused: `run ${verb}: only this run (${run}) passes, got ${quote(target ?? "")}` };
  const flags = readFlags(rest, verb === "hold" ? HOLD_FLAGS : COMPLETE_FLAGS, verb);
  if ("refused" in flags) return flags;
  // The run prompt names the project, so `--project` passes when it names this run's own project.
  // It is never passed on: the broker sets the project itself (DARIUS_PROJECT).
  for (const named of flags.values.get("project") ?? []) {
    if (project === undefined || named !== project) return { refused: `run ${verb}: --project must be this run's project${project === undefined ? "" : ` (${project})`}, got ${quote(named)}` };
  }
  return verb === "hold" ? checkHold(run, flags) : checkComplete(run, flags);
}

// --- the request ------------------------------------------------------------------

function isRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isWholeNumber(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isTextList(value: JsonValue | undefined): value is readonly string[] {
  return Array.isArray(value) && value.every(isText);
}

/** The argv and stdin of one request line. Every other field (an `env`, say) is dropped unread. */
function decodeRequest(line: string): BrokerRequest | Refused {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { refused: "the request is not JSON" };
  }
  if (!isRecord(parsed) || !isTextList(parsed.argv)) return { refused: "the request needs argv, a list of words" };
  const stdin = parsed.stdin;
  if (stdin !== undefined && !isText(stdin)) return { refused: "the request's stdin must be text" };
  if (stdin === undefined) return { argv: [...parsed.argv] };
  if (Buffer.byteLength(stdin) > BROKER_STDIN_MAX) {
    return { refused: `stdin is ${String(Buffer.byteLength(stdin))} bytes; the box broker takes at most ${String(BROKER_STDIN_MAX)}` };
  }
  return { argv: [...parsed.argv], stdin };
}

// --- the child --------------------------------------------------------------------

/** The child's env, from scratch. */
export function brokerEnv(options: BrokerOptions, runDir: string): ChildEnv {
  const source = options.sourceEnv ?? process.env;
  const env: ChildEnv = {};
  for (const key of PASSED_KEYS) {
    const value = source[key];
    if (value !== undefined && value !== "") env[key] = value;
  }
  env.DARIUS_RUN = options.run;
  env.DARIUS_RUN_POLICY = join(runDir, "policy.json");
  env.DARIUS_PROJECT = options.project;
  env.DARIUS_WHO = options.who;
  env.DARIUS_BOX_BROKER = "";
  return env;
}

function collect(stream: NodeJS.ReadableStream | null, into: { text: string }): void {
  stream?.setEncoding("utf8");
  stream?.on("data", (chunk: string) => {
    if (into.text.length < OUTPUT_MAX) into.text += chunk.slice(0, OUTPUT_MAX - into.text.length);
  });
}

interface ChildRun {
  argv: readonly string[];
  stdin: string | undefined;
  env: ChildEnv;
  cwd: string;
  timeoutMs: number;
  onStart: (child: ChildProcess) => void;
}

interface ChildEnd {
  code: number | null;
  timedOut: boolean;
  failure: string | undefined;
  timeoutMs: number;
  stdout: string;
  stderr: string;
}

function childReply(end: ChildEnd): BrokerReply {
  if (end.failure !== undefined) return { exit: 1, stdout: end.stdout, stderr: `${end.stderr}darius: box broker: cannot run darius: ${end.failure}\n` };
  if (end.timedOut) {
    const seconds = String(end.timeoutMs / 1000);
    return { exit: 1, stdout: end.stdout, stderr: `${end.stderr}darius: box broker: the command ran over ${seconds} s and was stopped\n` };
  }
  return { exit: end.code ?? 1, stdout: end.stdout, stderr: end.stderr };
}

async function runChild(program: readonly string[], input: ChildRun): Promise<BrokerReply> {
  const [bin = "", ...lead] = program;
  const child = spawn(bin, [...lead, ...input.argv], {
    cwd: input.cwd,
    env: input.env,
    stdio: [input.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  input.onStart(child);
  const out = { text: "" };
  const err = { text: "" };
  collect(child.stdout, out);
  collect(child.stderr, err);
  let timedOut = false;
  let failure: string | undefined;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, input.timeoutMs);
  // A child that cannot start emits `error` and then `close`; `close` alone settles.
  child.once("error", (cause) => {
    failure = errorMessage(cause);
  });
  const closed = new Promise<number | null>((resolve) => {
    child.once("close", resolve);
  });
  if (input.stdin !== undefined) {
    child.stdin?.on("error", () => {
      // The child may exit before it reads all of stdin; its exit code says what happened.
    });
    child.stdin?.end(input.stdin);
  }
  const code = await closed;
  clearTimeout(timer);
  return childReply({ code, timedOut, failure, timeoutMs: input.timeoutMs, stdout: out.text, stderr: err.text });
}

// --- the server -------------------------------------------------------------------

function refusal(message: string): BrokerReply {
  return { exit: 2, stdout: "", stderr: `darius: box broker: ${message}\n` };
}

/** A token as the log keeps it: at most 200 characters. */
function clip(token: string): string {
  return token.length > 200 ? `${token.slice(0, 197)}...` : token;
}

interface LogEntry {
  argv: readonly string[] | null;
  stdinBytes: number;
  exit: number;
  refused?: string;
}

/** One line of broker.jsonl. */
interface BrokerLogLine {
  at: string;
  argv: string[] | null;
  stdin_bytes: number;
  exit: number;
  refused?: string;
}

function logRequest(runDir: string, entry: LogEntry): void {
  const line: BrokerLogLine = {
    at: new Date().toISOString(),
    argv: entry.argv === null ? null : entry.argv.map(clip),
    stdin_bytes: entry.stdinBytes,
    exit: entry.exit,
  };
  if (entry.refused !== undefined) line.refused = entry.refused;
  try {
    appendFileSync(join(runDir, "broker.jsonl"), `${JSON.stringify(line)}\n`);
  } catch {
    // The log is a record, not a gate: a full disk must not keep the run from completing.
  }
}

/** Removes a socket left over from an earlier broker. Anything else at the path is an error. */
function clearSocketPath(path: string): void {
  if (!existsSync(path)) return;
  if (!lstatSync(path).isSocket()) throw new Error(`box broker: ${path} exists and is not a socket`);
  unlinkSync(path);
}

/**
 * Starts the broker for one run. Resolves once the socket listens with mode
 * 0600; `close()` stops it, kills a running child and removes the socket.
 */
export async function startBroker(options: BrokerOptions): Promise<Broker> {
  const runDir = options.runDir ?? join(projectDir(options.project), "runs", options.run);
  mkdirSync(runDir, { recursive: true });
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const env = brokerEnv(options, runDir);
  let busy = false;
  let running: ChildProcess | undefined;

  const answer = async (line: string): Promise<BrokerReply> => {
    const request = decodeRequest(line);
    if ("refused" in request) {
      logRequest(runDir, { argv: null, stdinBytes: 0, exit: 2, refused: request.refused });
      return refusal(request.refused);
    }
    const stdinBytes = request.stdin === undefined ? 0 : Buffer.byteLength(request.stdin);
    const checked = checkBrokerArgv(request.argv, options.run, options.project);
    if ("refused" in checked) {
      logRequest(runDir, { argv: request.argv, stdinBytes, exit: 2, refused: checked.refused });
      return refusal(checked.refused);
    }
    if (busy) {
      const message = "another request is running; try again when it is done";
      logRequest(runDir, { argv: request.argv, stdinBytes, exit: 1, refused: message });
      return { exit: 1, stdout: "", stderr: `darius: box broker: ${message}\n` };
    }
    busy = true;
    try {
      const stdin = checked.stdin ? (request.stdin ?? "") : undefined;
      const reply = await runChild(options.darius, {
        argv: checked.argv,
        stdin,
        env,
        cwd: runDir,
        timeoutMs,
        onStart: (child) => {
          running = child;
        },
      });
      logRequest(runDir, { argv: request.argv, stdinBytes, exit: reply.exit });
      return reply;
    } finally {
      busy = false;
      running = undefined;
    }
  };

  const serve = (socket: Socket): void => {
    let buffered = "";
    let done = false;
    const reply = (value: BrokerReply): void => {
      socket.end(`${JSON.stringify(value)}\n`);
    };
    socket.setEncoding("utf8");
    // Idle while the child runs: the child's own timeout ends that first.
    socket.setTimeout(timeoutMs + 10_000, () => socket.destroy());
    socket.on("error", () => {
      // The caller went away; nothing to tell it.
    });
    socket.on("data", (chunk: string) => {
      if (done) return;
      buffered += chunk;
      const newline = buffered.indexOf("\n");
      if (newline < 0 && buffered.length <= REQUEST_MAX) return;
      // Later data is read and dropped, so ending the socket never resets it under the reply.
      done = true;
      if (newline < 0 || newline > REQUEST_MAX) {
        const message = `the request is over ${String(REQUEST_MAX)} bytes`;
        logRequest(runDir, { argv: null, stdinBytes: buffered.length, exit: 2, refused: message });
        reply(refusal(message));
        return;
      }
      void answer(buffered.slice(0, newline)).then(reply);
    });
  };

  clearSocketPath(options.socketPath);
  const server: Server = createServer(serve);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  chmodSync(options.socketPath, 0o600);

  return {
    close: () =>
      new Promise<void>((resolve) => {
        running?.kill("SIGKILL");
        server.close(() => {
          if (existsSync(options.socketPath)) unlinkSync(options.socketPath);
          resolve();
        });
      }),
  };
}

// --- the client (inside the box) ---------------------------------------------------

/**
 * The broker socket a `run hold|complete` inside the box sends to, or
 * undefined outside a box. `DARIUS_BOX_BROKER` overrides the path (tests use
 * it); set empty, it turns the client off.
 */
export function boxBrokerSocket(): string | undefined {
  const path = process.env.DARIUS_BOX_BROKER ?? BOX_BROKER_SOCKET;
  if (path === "") return undefined;
  return existsSync(path) ? path : undefined;
}

function decodeReply(text: string): BrokerReply {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("the box broker sent a reply that is not JSON");
  }
  if (!isRecord(parsed)) throw new Error("the box broker sent a reply that is not an object");
  const { exit, stdout, stderr } = parsed;
  if (!isWholeNumber(exit) || !isText(stdout) || !isText(stderr)) throw new Error("the box broker sent a reply without exit, stdout and stderr");
  return { exit, stdout, stderr };
}

/** Sends one request to the broker at `socketPath` and waits for its reply. */
export function askBroker(socketPath: string, request: BrokerRequest): Promise<BrokerReply> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let text = "";
    socket.setEncoding("utf8");
    socket.setTimeout(DEFAULT_TIMEOUT_MS + 30_000, () => {
      socket.destroy();
      reject(new Error(`the box broker at ${socketPath} did not answer in time`));
    });
    socket.once("error", (cause) => reject(new Error(`cannot reach the box broker at ${socketPath}: ${errorMessage(cause)}`)));
    socket.on("data", (chunk: string) => {
      text += chunk;
    });
    socket.once("end", () => {
      try {
        resolve(decodeReply(text.trim()));
      } catch (cause) {
        reject(cause instanceof Error ? cause : new Error(errorMessage(cause)));
      }
    });
    socket.once("connect", () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
  });
}
