/**
 * The run page's one action (0.48.0; docs/concept.md, "Follow-up runs"):
 *
 *   POST /api/run/follow-up   body { project, run, approve: [N, ...], note? }
 *                             202 { ok: true, pending: true } | { ok: false, error }
 *
 * It starts `darius run follow-up <run> --approve N ... --who "web:<who>"`
 * as a detached process, with its output in `runs/<run>/follow-up.log`, and
 * answers at once; the page reloads to see the new run. `darius serve`
 * calls it only after its access check.
 *
 * The body names question numbers only. A grant line never comes from the
 * page: the lines are the ones the parent's result lists, and a body with
 * any other key (`grant`, `grants`) is refused. Before the spawn the server
 * checks again that the follow-up is ready on this host
 * (src/runner/follow-up-ready.ts), and the CLI checks once more. Like the
 * other write endpoints, a request must come from the page itself (its
 * Origin), be JSON, and be at most MAX_BODY bytes.
 *
 * The loopback viewer ("this host", src/web/auth.ts) may not start one: any
 * process on this host is that viewer, and a run that may `curl` could set
 * its own Origin. Only a tailnet identity starts a follow-up.
 *
 * The findings page has one action too (0.62.0; docs/concept.md,
 * "Findings"):
 *
 *   POST /api/finding/close   body { project, ritual, key, note? }
 *                             200 { ok: true } | { ok: false, error }
 *
 * It runs `darius finding close <key> --ritual R --project P --note N --who
 * "web:<who>"` and waits for it: the close is one ledger line, so the page
 * can reload and show it. It has the same guards as the follow-up: the
 * Origin, JSON, MAX_BODY, a tailnet identity (the loopback viewer is refused
 * for the same reason: a run could close its own findings), a known project,
 * and a finding that exists and is neither fixed nor closed. The key goes
 * after `--`, so a key that looks like a flag stays a key.
 */

import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { JsonValue } from "../core/model.ts";
import { collectFindings, type Finding } from "../core/finding-index.ts";
import { readLedger } from "../core/ledger.ts";
import { listProjects, openProject } from "../core/store.ts";
import { followUpReadiness } from "../runner/follow-up-ready.ts";
import { viewRun } from "../runner/run-due.ts";
import { errorMessage } from "../runtime.ts";
import type { FollowUpReadiness } from "./api.ts";
import { MAX_BODY, isSameOrigin, type PushApiReply } from "./push-api.ts";

export const ACTION_API_PREFIX = "/api/run/";
export const FINDING_API_PREFIX = "/api/finding/";
const FINDING_CLOSE_PATH = `${FINDING_API_PREFIX}close`;
const FOLLOW_UP_PATH = `${ACTION_API_PREFIX}follow-up`;

/** The operator's note, at most this many characters. */
export const NOTE_MAX = 500;
/** A result has at most 10 questions (src/core/result.ts). */
const APPROVE_MAX = 10;
const BODY_KEYS: ReadonlySet<string> = new Set(["project", "run", "approve", "note"]);
const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const RUN_ID = /^[0-9A-Za-z]{1,64}$/u;

const CLI = fileURLToPath(new URL("../../bin/darius", import.meta.url));

/** Starts the CLI with `argv`, detached, its output appended to `log`. */
export type FollowUpStarter = (argv: readonly string[], log: string) => void;

export const startDetachedFollowUp: FollowUpStarter = (argv, log) => {
  const fd = openSync(log, "a", 0o600);
  try {
    const child = spawn(CLI, [...argv], { detached: true, stdio: ["ignore", fd, fd] });
    child.on("error", (cause) => {
      console.error(`darius serve: could not start a follow-up: ${errorMessage(cause)}`);
    });
    child.unref();
  } finally {
    closeSync(fd);
  }
};

/** What the endpoint needs from the host; tests stub both. */
export interface ActionDeps {
  readiness: (project: string, run: string) => Promise<FollowUpReadiness>;
  start: FollowUpStarter;
}

/** Who the access check let in: `local` is the loopback caller, "this host". */
export interface ActionViewer {
  who: string;
  local?: boolean;
}

/** Why the loopback viewer gets no follow-up; the run page shows it too (src/web/context.ts). */
export const LOOPBACK_FOLLOW_UP = "the follow-up button needs a tailnet identity; open the page by its tailnet address";

/** Why the loopback viewer cannot close a finding; the same reason as the follow-up. */
export const LOOPBACK_CLOSE = "closing a finding needs a tailnet identity; open the page by its tailnet address";

const DEFAULT_DEPS: ActionDeps = { readiness: followUpReadiness, start: startDetachedFollowUp };

export interface ActionRequest {
  method: string;
  path: string;
  headers: Headers;
  body: string;
}

function fail(status: number, error: string): PushApiReply {
  return { status, body: { ok: false, error } };
}

function isRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isCount(value: JsonValue): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= APPROVE_MAX;
}

/** A request the endpoint can act on, or why not. */
type FollowUpBody = { project: string; run: string; approve: number[]; note?: string } | { error: string };

/** Checks the body's shape: known keys only, names that are names, numbers that are question numbers, a short note. */
function readBody(parsed: JsonValue): FollowUpBody {
  if (!isRecord(parsed)) return { error: "send { project, run, approve: [N], note? }" };
  const extra = Object.keys(parsed).find((key) => !BODY_KEYS.has(key));
  if (extra !== undefined) {
    return { error: `unknown field ${extra.slice(0, 40)}; the page approves question numbers only, and grant lines are for darius run follow-up on the command line` };
  }
  const { project, run, approve, note } = parsed;
  if (!isText(project) || !PROJECT_NAME.test(project)) return { error: "project must be a project name" };
  if (!isText(run) || !RUN_ID.test(run)) return { error: "run must be a run id" };
  if (!Array.isArray(approve) || approve.length === 0 || approve.length > APPROVE_MAX || !approve.every((n) => isCount(n))) {
    return { error: `approve must list question numbers, 1 to ${String(APPROVE_MAX)}` };
  }
  const numbers = [...new Set(approve.filter((n) => isCount(n)))];
  if (note === undefined || note === null) return { project, run, approve: numbers };
  if (!isText(note)) return { error: "note must be text" };
  const line = note.replaceAll(/\s+/gu, " ").trim();
  if (/\p{Cc}/u.test(line)) return { error: "note: plain text only, no control characters" };
  if ([...line].length > NOTE_MAX) return { error: `note: at most ${String(NOTE_MAX)} characters` };
  return line === "" ? { project, run, approve: numbers } : { project, run, approve: numbers, note: line };
}

/** One request under ACTION_API_PREFIX, already past the access check. `viewer` is who the access check let in. */
export async function actionApi(request: ActionRequest, viewer: ActionViewer, deps: ActionDeps = DEFAULT_DEPS): Promise<PushApiReply> {
  if (request.path !== FOLLOW_UP_PATH) return fail(404, "no such endpoint");
  if (request.method !== "POST") return fail(405, "POST only");
  if (viewer.local === true) return fail(403, LOOPBACK_FOLLOW_UP);
  if (!isSameOrigin(request.headers, process.env.DARIUS_WEB_URL?.trim())) return fail(403, "the request must come from the darius page");
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return fail(415, "send JSON");
  if (request.body.length > MAX_BODY) return fail(413, "too large");
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(request.body);
  } catch {
    return fail(400, "not valid JSON");
  }
  const body = readBody(parsed);
  if ("error" in body) return fail(400, body.error);
  if (!listProjects().includes(body.project)) return fail(400, `no project ${body.project}`);
  if (viewRun(readLedger(openProject(body.project)), body.run).item === undefined) return fail(400, `no run ${body.run} in ${body.project}`);
  const ready = await deps.readiness(body.project, body.run);
  if (!ready.ready) return fail(409, ready.reason);
  const known = new Set(ready.questions.map((question) => question.n));
  const unknown = body.approve.find((n) => !known.has(n));
  if (unknown !== undefined) return fail(400, `question ${String(unknown)} lists no commands to approve`);
  const argv = ["run", "follow-up", body.run, "--project", body.project];
  for (const n of body.approve) argv.push("--approve", String(n));
  if (body.note !== undefined) argv.push("--note", body.note);
  argv.push("--who", `web:${viewer.who}`);
  const dir = join(openProject(body.project).root, "runs", body.run);
  try {
    mkdirSync(dir, { recursive: true });
    deps.start(argv, join(dir, "follow-up.log"));
  } catch (cause) {
    return fail(500, `the follow-up could not be started: ${errorMessage(cause)}`);
  }
  return { status: 202, body: { ok: true, pending: true } };
}

// --- close a finding (0.62.0) --------------------------------------------------------------

/** The longest key the endpoint takes: a key the run gave has at most 120 characters, a key darius made from the title may have more. */
const FINDING_KEY_MAX = 1000;
const CLOSE_KEYS: ReadonlySet<string> = new Set(["project", "ritual", "key", "note"]);
const RITUAL_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
/** The CLI answers in well under a second; a hung one is stopped after this long. */
const CLOSE_TIMEOUT_MS = 15_000;

/** What running the CLI gave back. */
export interface CliAnswer {
  code: number;
  /** One plain line that says why it failed; empty on success. */
  error: string;
}

/** Runs the CLI with `argv` and waits for it. */
export type CliRunner = (argv: readonly string[]) => Promise<CliAnswer>;

/** The first line of a CLI answer: the `error` of its `--json` output, else the first line of stderr. */
function cliError(stdout: string, stderr: string): string {
  try {
    const parsed: JsonValue = JSON.parse(stdout);
    if (isRecord(parsed) && isText(parsed.error)) return parsed.error;
  } catch {
    // Not JSON: fall through to stderr.
  }
  const line = stderr.split("\n").find((candidate) => candidate.trim() !== "") ?? "";
  return line.replace(/^darius: /u, "").trim() || "the command failed";
}

export const runCli: CliRunner = (argv) =>
  new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(CLI, [...argv], { stdio: ["ignore", "pipe", "pipe"], timeout: CLOSE_TIMEOUT_MS });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (cause) => {
      resolve({ code: 1, error: `could not start darius: ${errorMessage(cause)}` });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, error: code === 0 ? "" : cliError(stdout, stderr) });
    });
  });

/** What the close endpoint needs from the host; tests stub both. */
export interface FindingDeps {
  /** The findings of a known project. */
  findings: (project: string) => Finding[];
  run: CliRunner;
}

const DEFAULT_FINDING_DEPS: FindingDeps = {
  findings: (project) => {
    const open = openProject(project);
    return collectFindings(open, readLedger(open));
  },
  run: runCli,
};

type CloseBody = { project: string; ritual: string; key: string; note?: string } | { error: string };

/** The operator's note, as one plain line; an empty note is no note. */
function readNote(note: JsonValue | undefined): { note?: string } | { error: string } {
  if (note === undefined || note === null) return {};
  if (!isText(note)) return { error: "note must be text" };
  const line = note.replaceAll(/\s+/gu, " ").trim();
  if (/\p{Cc}/u.test(line)) return { error: "note: plain text only, no control characters" };
  if ([...line].length > NOTE_MAX) return { error: `note: at most ${String(NOTE_MAX)} characters` };
  return line === "" ? {} : { note: line };
}

function readCloseBody(parsed: JsonValue): CloseBody {
  if (!isRecord(parsed)) return { error: "send { project, ritual, key, note? }" };
  const extra = Object.keys(parsed).find((key) => !CLOSE_KEYS.has(key));
  if (extra !== undefined) return { error: `unknown field ${extra.slice(0, 40)}` };
  const { project, ritual, key } = parsed;
  if (!isText(project) || !PROJECT_NAME.test(project)) return { error: "project must be a project name" };
  if (!isText(ritual) || !RITUAL_SLUG.test(ritual)) return { error: "ritual must be a ritual slug" };
  if (!isText(key) || key.trim() === "" || [...key].length > FINDING_KEY_MAX || /\p{Cc}/u.test(key)) {
    return { error: `key must be one line of plain text, at most ${String(FINDING_KEY_MAX)} characters` };
  }
  const note = readNote(parsed.note);
  if ("error" in note) return note;
  return { project, ritual, key, ...note };
}

/** One request under FINDING_API_PREFIX, already past the access check. */
export async function findingApi(request: ActionRequest, viewer: ActionViewer, deps: FindingDeps = DEFAULT_FINDING_DEPS): Promise<PushApiReply> {
  if (request.path !== FINDING_CLOSE_PATH) return fail(404, "no such endpoint");
  if (request.method !== "POST") return fail(405, "POST only");
  if (viewer.local === true) return fail(403, LOOPBACK_CLOSE);
  if (!isSameOrigin(request.headers, process.env.DARIUS_WEB_URL?.trim())) return fail(403, "the request must come from the darius page");
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return fail(415, "send JSON");
  if (request.body.length > MAX_BODY) return fail(413, "too large");
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(request.body);
  } catch {
    return fail(400, "not valid JSON");
  }
  const body = readCloseBody(parsed);
  if ("error" in body) return fail(400, body.error);
  if (!listProjects().includes(body.project)) return fail(400, `no project ${body.project}`);
  const found = deps.findings(body.project).find((finding) => finding.ritual === body.ritual && finding.key === body.key);
  if (found === undefined) return fail(400, `no finding '${body.key}' in ritual '${body.ritual}' of ${body.project}`);
  if (found.status === "fixed") return fail(409, "that finding is fixed; there is nothing to close");
  if (found.status === "closed") return fail(409, `that finding is already closed by ${found.closed?.who ?? "someone"}`);
  const argv = ["finding", "close", "--ritual", body.ritual, "--project", body.project];
  if (body.note !== undefined) argv.push("--note", body.note);
  argv.push("--who", `web:${viewer.who}`, "--json", "--", body.key);
  const answer = await deps.run(argv);
  if (answer.code !== 0) return fail(409, answer.error);
  return { status: 200, body: { ok: true } };
}
