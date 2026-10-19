/**
 * The run page's actions (0.48.0; docs/concept.md, "Follow-up runs"):
 *
 *   POST /api/run/follow-up   body { project, run, approve: [N, ...], items?: [KEY, ...], note? }
 *                             (approve may be [] when items or the note carry the decision, 0.65.0, 0.69.0)
 *                             202 { ok: true, run, host, id, at }
 *                             | 202 { ok: true, pending: true, host, id, at, message }
 *                             | 409 or 503 { ok: false, error }
 *
 * It starts `darius run follow-up <run> --approve N ... --item KEY ... --who
 * "web:<who>"` as a detached process, with its output in
 * `runs/<run>/follow-up.log`. Since 0.69.0 it then waits up to
 * OUTCOME_WAIT_MS for the CLI's "started run <id>" line, or for the CLI to
 * end: 202 names the new run, 409 carries the CLI's refusal or skip
 * sentence (lease held, open run, wrong state), 503 says ssh failed. Only
 * when neither came in time is it 202 with `pending` and a message that
 * says so; the answer is never silent. `darius serve` calls it only after
 * its access check.
 *
 * When the ritual's host is another (0.69.0), readiness ran there (src/runner/
 * follow-up-ready.ts) and says `via`: the argv gets `--on <host>`, and the
 * CLI's own ssh forward starts the follow-up there (src/core/ssh.ts quotes
 * each word for that host's shell). The argv never passes through a shell
 * here: spawn gets it as a list.
 *
 * The body names question numbers and item keys only. A grant line never
 * comes from the page: the lines are the ones the parent's result lists,
 * and a body with any other key (`grant`, `grants`) is refused. An item key
 * must name a needs-decision item of the parent with that key. Before the
 * spawn the server checks again that the follow-up is ready
 * (src/runner/follow-up-ready.ts), and the CLI checks once more. Like the
 * other write endpoints, a request must come from the page itself (its
 * Origin), be JSON, and be at most MAX_BODY bytes.
 *
 * The loopback viewer ("this host", src/web/auth.ts) may not start one: any
 * process on this host is that viewer, and a run that may `curl` could set
 * its own Origin. Only a tailnet identity starts a follow-up.
 *
 *   GET /api/run/follow-up/ready?project=&run=   (0.98.0)
 *                             200 { ok: true, ...FollowUpReadiness } | 400 or 405 { ok: false, error }
 *
 * The check the run page asks after it renders: whether a follow-up can start
 * now, which over ssh can take seconds. It keeps the guards of the POST except
 * the Origin, the content type and the size, which a read has no use for. A
 * browser request marked `Sec-Fetch-Site: cross-site` is refused, because the
 * check can cost an ssh round trip. The loopback viewer gets 200 with
 * `ready: false` and the POST's reason.
 *
 * The other is the Acknowledge button (0.68.0; docs/concept.md, "Acknowledge"):
 *
 *   POST /api/run/ack         body { project, run, note? }
 *                             200 { ok: true } | { ok: false, error }
 *
 * It runs `darius run ack --project P --who "web:<who>" --json [--note N] --
 * <run>` and waits for it: the acknowledgement is one ledger line, so the page
 * can reload and show it. The guards are the follow-up's: the Origin, JSON,
 * MAX_BODY, a tailnet identity (the loopback viewer is refused for the same
 * reason: a run could acknowledge its own failure), a known project, a body
 * with no other key, a plain one-line note and a run that exists. What the
 * run may be acknowledged as is the CLI's rule (a held, a running or an
 * already acknowledged run is refused): its sentence comes back as 409.
 *
 * The answer form of an "Asks you" card (0.80.0; docs/concept.md, "Answers
 * carried until used") widens the acknowledgement and adds one endpoint:
 *
 *   POST /api/run/ack         body { project, run, note?, answers?: [{n, text}], runNow?: bool }
 *                             200 { ok: true }
 *                             | 200 { ok: true, run, host, id, at }     (runNow: the run started)
 *                             | 200 { ok: true, pending: true, host, id, at, message } (runNow: not started yet)
 *                             | 200 { ok: true, runNow: { error } }    (the ack is written, the run did not start)
 *                             | 400 or 409 { ok: false, error }        (nothing is written)
 *   POST /api/run/ack-earlier body { project, run, runs: [ID, ...] }
 *                             200 { ok: true, count } | 400 or 409 { ok: false, error }
 *
 * `answers` runs `darius run ack --answer N=TEXT ...`. With `runNow` the
 * server then starts `darius run now <ritual>` detached, only after the ack
 * worked, and waits up to OUTCOME_WAIT_MS for the CLI's "started run" line
 * like the follow-up does. The ritual and the `--on` host come from the
 * run's ledger item and the ritual's host, never from the body. The ack is
 * never rolled back. When the ritual belongs to another host, the ack goes
 * there too (`darius run ack --on HOST`) before `run now --on HOST`, so the
 * run that starts there reads the answer. The host is checked first: a bad
 * name writes nothing. `ack-earlier` dismisses, bare, the open asks of the
 * same ritual that the page showed under the newest one: each id must be an
 * open ask of the run's ritual that started before it, or the whole call is
 * refused with 409.
 *
 * A held run is answered and resumed from its card (0.80.0):
 *
 *   POST /api/run/answer      body { project, run, answers: [{n, text}], resume: true }
 *                             200 { ok: true, resumed: true, run, host, id, at }
 *                             | 200 { ok: true, pending: true, host, id, at, message }
 *                             | 200 { ok: true, resume: { error } }  (answers written, resume refused)
 *                             | 400 or 409 { ok: false, error }      (nothing is written)
 *
 * It runs `darius run answer <run> --answer N=TEXT ...` once (all answers or
 * none, each a question of the current hold; the run id after `--`, each
 * answer one argv word, so a text that starts with `--` is data), then starts
 * `darius run resume <run>` detached and waits up to OUTCOME_WAIT_MS for its
 * "started run" line. When the ritual belongs to another host, both calls go
 * there with `--on HOST`, so the resume never runs where the answers are
 * not. A run that is not held is a 409 and nothing is written; a second POST
 * finds it so. An answer call that ssh or a signal ended is a 502: the host
 * did not answer. A hold that is answered but not yet resumed takes answers
 * again, so the operator can retry after a refused resume.
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
 *
 * A closed finding can be reopened where it was closed (0.96.0):
 *
 *   POST /api/finding/reopen  body { project, ritual, key, note? }
 *                             200 { ok: true } | { ok: false, error }
 *
 * It runs `darius finding reopen <key> --ritual R --project P [--note N]
 * --who "web:<who>"` and has the guards of the close, except that only a
 * closed finding qualifies (any other status is a 409). The note goes on the
 * `finding.reopened` line, where the history and the Activity list show it.
 *
 * The vigil page has one action (0.86.0; docs/concept.md, "Failure
 * reason, dispatch, one-vigil check, separate states"):
 *
 *   POST /api/vigil/check     body { project, slug }
 *                             202 { ok: true, started: true, host, id, at }
 *                             | 202 { ok: true, pending: true, host, id, at, message }
 *                             | 409 { ok: false, error, retryAt, lastCheckedAt }  (inside the cooldown)
 *                             | 400, 404, 409 or 500 { ok: false, error }
 *
 * It starts `darius vigil sweep <slug> --project P --json --who "web:<who>"`
 * detached, with its output in `<project>/sweeps/<slug>.log`, and does not
 * wait for the sweep. Inside the 2 minute cooldown (the newest `vigil.swept` line
 * that is no skip) it answers 409 with `retryAt` and `lastCheckedAt` before it
 * spawns anything. It waits at most CHECK_WAIT_MS for what the CLI prints
 * at once: the "started" line once the vigil's lease is taken (202 names the
 * host), or a refusal (the daily sweep runs, another check runs, the 2 minute
 * cooldown), which comes back as 409 with the CLI's own sentence. The CLI
 * ends the lease itself (as a 2 minute cooldown since 0.86.2), so a client
 * that went away leaves nothing held. A paused or closed vigil is a 409 before anything starts.
 * The guards are the follow-up's (`guard()`): the Origin, JSON, MAX_BODY and a
 * tailnet identity, and the loopback viewer is refused for the same reason: a
 * check runs the vigil's Commands.
 */

import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { JsonValue, LedgerLine, Ritual } from "../core/model.ts";
import { answerProblem, type QuestionAnswer } from "../core/answers.ts";
import { collectFindings, type Finding } from "../core/finding-index.ts";
import { hostId, linesFor, readLedger } from "../core/ledger.ts";
import { isSlug, itemRef, listProjects, openProject } from "../core/store.ts";
import { SWEEP_COOLDOWN_MS, vigilStatus } from "../core/sweep.ts";
import { ritualHost } from "../core/workdir.ts";
import { ITEMS_MAX } from "../runner/follow-up.ts";
import { followUpReadiness, lastSentence } from "../runner/follow-up-ready.ts";
import { viewRun } from "../runner/run-due.ts";
import { errorMessage } from "../runtime.ts";
import type { FollowUpReadiness, PendingPollEntry } from "./api.ts";
import { markEnded, pollStarts, recordPending, type LedgerView, type PendingInput } from "./pending.ts";
import { MAX_BODY, isSameOrigin, type PushApiReply } from "./push-api.ts";

export const ACTION_API_PREFIX = "/api/run/";
export const FINDING_API_PREFIX = "/api/finding/";
export const VIGIL_API_PREFIX = "/api/vigil/";
const FINDING_CLOSE_PATH = `${FINDING_API_PREFIX}close`;
const FINDING_REOPEN_PATH = `${FINDING_API_PREFIX}reopen`;
const FOLLOW_UP_PATH = `${ACTION_API_PREFIX}follow-up`;
/** The read of whether a follow-up can start (0.98.0). The run page asks it after it renders, because the check can take seconds over ssh. */
export const FOLLOW_UP_READY_PATH = `${ACTION_API_PREFIX}follow-up/ready`;
const ACK_PATH = `${ACTION_API_PREFIX}ack`;
const ACK_EARLIER_PATH = `${ACTION_API_PREFIX}ack-earlier`;
const ANSWER_PATH = `${ACTION_API_PREFIX}answer`;

/** What a 413 says to the person who typed the answers: ten answers of 500 characters do not fit MAX_BODY together. */
export const ANSWERS_TOO_LONG = "The answers are too long together. Shorten them.";

/** The operator's note, at most this many characters. */
export const NOTE_MAX = 500;
/** A result has at most 10 questions (src/core/result.ts). */
const APPROVE_MAX = 10;
const BODY_KEYS: ReadonlySet<string> = new Set(["project", "run", "approve", "items", "note"]);
/** An item key a run gave has at most 120 characters (src/core/result.ts, KEY_MAX). */
const ITEM_KEY_MAX = 120;
/** How long the POST waits for the follow-up to start or end (0.69.0). */
export const OUTCOME_WAIT_MS = 2_500;
const OUTCOME_POLL_MS = 100;
/** The stderr line of `darius run follow-up` once the run started (src/cli/run-due.ts, STARTED_PREFIX). */
const STARTED_LINE = /^darius run follow-up: started run ([0-9A-Z]{26}) on (\S+)$/mu;
/** The same line of `darius run now` (src/cli/run-due.ts, NOW_STARTED_PREFIX). */
export const NOW_STARTED_LINE = /^darius run now: started run ([0-9A-Z]{26}) on (\S+)$/mu;
/** The same line of `darius run resume` (src/cli/run-due.ts, RESUME_STARTED_PREFIX). */
export const RESUME_STARTED_LINE = /^darius run resume: started run ([0-9A-Z]{26}) on (\S+)$/mu;
/** ssh exits 255 when it cannot connect (src/core/ssh.ts). */
const SSH_EXIT = 255;
const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const RUN_ID = /^[0-9A-Za-z]{1,64}$/u;

const CLI = fileURLToPath(new URL("../../bin/darius", import.meta.url));

/** The CLI answers in well under a second; a hung one is stopped after this long. */
const CLI_TIMEOUT_MS = 15_000;

/** What running the CLI gave back. */
export interface CliAnswer {
  code: number;
  /** A signal ended the CLI, such as the timeout (the code is then 1). */
  killed?: boolean;
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
    const child = spawn(CLI, [...argv], { stdio: ["ignore", "pipe", "pipe"], timeout: CLI_TIMEOUT_MS });
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
      const answer: CliAnswer = { code: code ?? 1, error: code === 0 ? "" : cliError(stdout, stderr) };
      if (code === null) answer.killed = true;
      resolve(answer);
    });
  });

/** A started follow-up process: `exited` settles with its exit code, null when it could not start or a signal ended it. */
export interface StartedFollowUp {
  exited: Promise<number | null>;
}

/** Starts the CLI with `argv`, detached, its output appended to `log`. */
export type FollowUpStarter = (argv: readonly string[], log: string) => StartedFollowUp;

export const startDetachedFollowUp: FollowUpStarter = (argv, log) => {
  const fd = openSync(log, "a", 0o600);
  try {
    // No shell: the operator's note and the item keys reach the CLI as argv words, as they are.
    const child = spawn(CLI, [...argv], { detached: true, stdio: ["ignore", fd, fd] });
    const exited = new Promise<number | null>((resolve) => {
      child.on("error", (cause) => {
        console.error(`darius serve: could not start a follow-up: ${errorMessage(cause)}`);
        resolve(null);
      });
      child.on("exit", (code) => {
        resolve(code);
      });
    });
    child.unref();
    return { exited };
  } finally {
    closeSync(fd);
  }
};

/** What the endpoints need from the host; tests stub all three. */
export interface ActionDeps {
  readiness: (project: string, run: string) => Promise<FollowUpReadiness>;
  start: FollowUpStarter;
  /** Runs the CLI and waits: the acknowledgement. */
  run: CliRunner;
  /** How long the follow-up POST waits for the outcome; OUTCOME_WAIT_MS when absent. Tests shorten it. */
  waitMs?: number;
  /** The host that must run `run now` for this ritual when it is not this one (0.80.0); undefined when this host is right. */
  nowHost?: (project: string, slug: string) => string | undefined;
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

/** Why the loopback viewer cannot reopen a finding (0.96.0). */
export const LOOPBACK_REOPEN = "reopening a finding needs a tailnet identity; open the page by its tailnet address";

/** Why the loopback viewer cannot acknowledge a run; the same reason as the follow-up, and the page hides the button for it (src/web/context.ts). */
export const LOOPBACK_ACK = "acknowledging a run needs a tailnet identity; open the page by its tailnet address";

/** Why the loopback viewer cannot answer a held run; the same reason as the acknowledgement. */
export const LOOPBACK_ANSWER = "answering a held run needs a tailnet identity; open the page by its tailnet address";

/** Why the loopback viewer cannot check a vigil; the same reason as the others, and the page hides the button for it. */
export const LOOPBACK_CHECK = "checking a vigil needs a tailnet identity; open the page by its tailnet address";

const DEFAULT_DEPS: ActionDeps = { readiness: followUpReadiness, start: startDetachedFollowUp, run: runCli };

export interface ActionRequest {
  method: string;
  path: string;
  headers: Headers;
  body: string;
  /** The query string of the address, with or without the leading `?`; absent for a request with none. */
  query?: string;
}

function fail(status: number, error: string, id?: string): PushApiReply {
  return { status, body: id === undefined ? { ok: false, error } : { ok: false, error, id } };
}

/** `body` with the pending-starts `id` and the time asked added, when there is an entry. */
function withAsked(body: { [key: string]: JsonValue }, ask: Asked | undefined): { [key: string]: JsonValue } {
  if (ask !== undefined) Object.assign(body, { id: ask.id, at: ask.at });
  return body;
}

/** What every start reply names, started or pending: the registry entry, the host that runs it, and when it was asked (ISO). */
interface Asked {
  id: string;
  host: string;
  at: string;
}

/** The sentence for a start the host has not confirmed within the wait. It is the normal reply of a slow start. */
export function pendingMessage(host: string): string {
  return `${host} has not confirmed the start yet. It shows in Now when it starts.`;
}

/** The sentence for a start the CLI refused or could not make. A trailing full stop of the reason is dropped, the sentence adds its own. */
export function refusedMessage(host: string, reason: string): string {
  return `${host} did not start it: ${reason.replace(/[.\s]+$/u, "")}.`;
}

/** Records in the pending-starts registry that the spawn `id` ended, whatever its code (src/web/pending.ts). */
function watchEnd(id: string, started: StartedFollowUp): void {
  const record = async (): Promise<void> => {
    markEnded(id, await started.exited);
  };
  void record();
}

function isRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isCount(value: JsonValue, max = APPROVE_MAX): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max;
}

/** A request the endpoint can act on, or why not. */
type FollowUpBody = { project: string; run: string; approve: number[]; items: string[]; note?: string } | { error: string };

/** `items` of the body (0.69.0): absent, or 1 to ITEMS_MAX distinct item keys, each one plain line. */
function readItems(value: JsonValue | undefined): string[] | { error: string } {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length === 0 || value.length > ITEMS_MAX) return { error: `items must list 1 to ${String(ITEMS_MAX)} item keys` };
  const keys: string[] = [];
  for (const key of value) {
    if (!isText(key) || key.trim() === "" || [...key].length > ITEM_KEY_MAX || /\p{Cc}/u.test(key)) {
      return { error: `items: each key is one line of plain text, at most ${String(ITEM_KEY_MAX)} characters` };
    }
    if (keys.includes(key)) return { error: `items: the key '${key.slice(0, 80)}' is given twice` };
    keys.push(key);
  }
  return keys;
}

/** Checks the body's shape: known keys only, names that are names, numbers that are question numbers, item keys, a short note. */
function readBody(parsed: JsonValue): FollowUpBody {
  if (!isRecord(parsed)) return { error: "send { project, run, approve: [N], items?: [KEY], note? }" };
  const extra = Object.keys(parsed).find((key) => !BODY_KEYS.has(key));
  if (extra !== undefined) {
    return { error: `unknown field ${extra.slice(0, 40)}; the page approves question numbers only, and grant lines are for darius run follow-up on the command line` };
  }
  const { project, run, approve, note } = parsed;
  if (!isText(project) || !PROJECT_NAME.test(project)) return { error: "project must be a project name" };
  if (!isText(run) || !RUN_ID.test(run)) return { error: "run must be a run id" };
  if (!Array.isArray(approve) || approve.length > APPROVE_MAX || !approve.every((n) => isCount(n))) {
    return { error: `approve must list question numbers, 1 to ${String(APPROVE_MAX)}` };
  }
  const numbers = [...new Set(approve.filter((n) => isCount(n)))];
  const items = readItems(parsed.items);
  if ("error" in items) return items;
  const noDecision = { error: "approve question numbers or proposals, or give a note with the operator's decision" };
  const isEmpty = numbers.length === 0 && items.length === 0;
  if (note === undefined || note === null) return isEmpty ? noDecision : { project, run, approve: numbers, items };
  if (!isText(note)) return { error: "note must be text" };
  const line = note.replaceAll(/\s+/gu, " ").trim();
  if (/\p{Cc}/u.test(line)) return { error: "note: plain text only, no control characters" };
  if ([...line].length > NOTE_MAX) return { error: `note: at most ${String(NOTE_MAX)} characters` };
  if (line === "") return isEmpty ? noDecision : { project, run, approve: numbers, items };
  return { project, run, approve: numbers, items, note: line };
}

/** What the shared guards found: a reply that ends the request, or the JSON body to check further. */
type Guarded = { reply: PushApiReply } | { parsed: JsonValue };

/** The guards the follow-up and the acknowledgement share, in order: method, viewer, Origin, content type, size, JSON. */
function guard(request: ActionRequest, viewer: ActionViewer, loopbackReason: string, tooLarge = "too large"): Guarded {
  if (request.method !== "POST") return { reply: fail(405, "POST only") };
  if (viewer.local === true) return { reply: fail(403, loopbackReason) };
  if (!isSameOrigin(request.headers, process.env.DARIUS_WEB_URL?.trim())) return { reply: fail(403, "the request must come from the darius page") };
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return { reply: fail(415, "send JSON") };
  if (request.body.length > MAX_BODY) return { reply: fail(413, tooLarge) };
  try {
    return { parsed: JSON.parse(request.body) };
  } catch {
    return { reply: fail(400, "not valid JSON") };
  }
}

/** One request under ACTION_API_PREFIX, already past the access check. `viewer` is who the access check let in. */
export async function actionApi(request: ActionRequest, viewer: ActionViewer, deps: ActionDeps = DEFAULT_DEPS): Promise<PushApiReply> {
  if (request.path === FOLLOW_UP_PATH) return startFollowUp(request, viewer, deps);
  if (request.path === FOLLOW_UP_READY_PATH) return followUpReady(request, viewer, deps);
  if (request.path === ACK_PATH) return acknowledge(request, viewer, deps);
  if (request.path === ACK_EARLIER_PATH) return acknowledgeEarlier(request, viewer, deps);
  if (request.path === ANSWER_PATH) return answerHeld(request, viewer, deps);
  return fail(404, "no such endpoint");
}

/** The path of the light poll of pending starts (`pendingApi`). */
export const PENDING_API_PATH = "/api/pending";
/** At most this many ids in one poll. */
export const PENDING_IDS_MAX = 50;
const PENDING_ID = /^[0-9A-Z]{26}$/u;

/** The ledger of a project for the poll: empty for a project that is unknown or cannot be read. */
const pollLedger: LedgerView = (name) => {
  try {
    return listProjects().includes(name) ? readLedger(openProject(name)) : [];
  } catch {
    return [];
  }
};

/**
 * `GET /api/pending?ids=<id>,<id>` (the light poll): the state of those registry entries only, as
 * `{ ok: true, starts: [{ id, state, host, run?, at, kind, project, item }] }`, in the order asked. An id the
 * registry does not hold is `{ id, state: "unknown" }`. It reads the registry and the ledgers of the listed
 * entries' projects and nothing else, so it answers fast. Like the readiness read it has no Origin check,
 * since it changes nothing, and it refuses a cross-site caller. The loopback viewer may read it too.
 */
export function pendingApi(request: ActionRequest, ledgerView: LedgerView = pollLedger): PushApiReply {
  if (request.method !== "GET" && request.method !== "HEAD") return fail(405, "GET only");
  if (request.headers.get("sec-fetch-site") === "cross-site") return fail(403, "the request must come from the darius page");
  const raw = new URLSearchParams(request.query ?? "").get("ids") ?? "";
  const ids = [...new Set(raw.split(",").filter((id) => id !== ""))];
  if (ids.length === 0) return { status: 200, body: { ok: true, starts: [] } };
  if (ids.length > PENDING_IDS_MAX) return fail(400, `ids: at most ${String(PENDING_IDS_MAX)}`);
  if (!ids.every((id) => PENDING_ID.test(id))) return fail(400, "ids must be start ids");
  const starts: PendingPollEntry[] = pollStarts(ids, ledgerView);
  // PendingPollEntry holds only strings; the round trip makes it a JSON value.
  const json: JsonValue = JSON.parse(JSON.stringify(starts));
  return { status: 200, body: { ok: true, starts: json } };
}

/**
 * `GET /api/run/follow-up/ready?project=&run=` (0.98.0): whether a follow-up of the run can start now, as
 * `FollowUpReadiness`. It keeps the guards of the POST except the Origin check, which protects a write, and
 * the content type and body size, which a read has none of: the method, the viewer, the shape of the project
 * and run names, and that both exist. The loopback viewer gets `{ready: false, reason}`, as the run page showed
 * before. It writes nothing.
 */
async function followUpReady(request: ActionRequest, viewer: ActionViewer, deps: ActionDeps): Promise<PushApiReply> {
  if (request.method !== "GET") return fail(405, "GET only");
  if (viewer.local === true) return { status: 200, body: { ok: true, ready: false, host: hostId(), reason: LOOPBACK_FOLLOW_UP } };
  // No Origin check, since a read changes nothing. But the check costs an ssh round trip, so a page of another site may not start it.
  if (request.headers.get("sec-fetch-site") === "cross-site") return fail(403, "the request must come from the darius page");
  const query = new URLSearchParams(request.query ?? "");
  const project = query.get("project") ?? "";
  const run = query.get("run") ?? "";
  if (!PROJECT_NAME.test(project)) return fail(400, "project must be a project name");
  if (!RUN_ID.test(run)) return fail(400, "run must be a run id");
  if (!listProjects().includes(project)) return fail(400, `no project ${project}`);
  if (viewRun(readLedger(openProject(project)), run).item === undefined) return fail(400, `no run ${run} in ${project}`);
  const ready = await deps.readiness(project, run);
  // FollowUpReadiness holds only strings, booleans and lists of them; the round trip makes it a JSON value.
  const json: JsonValue = JSON.parse(JSON.stringify(ready));
  return { status: 200, body: isRecord(json) ? { ok: true, ...json } : { ok: true } };
}

async function startFollowUp(request: ActionRequest, viewer: ActionViewer, deps: ActionDeps): Promise<PushApiReply> {
  const guarded = guard(request, viewer, LOOPBACK_FOLLOW_UP);
  if ("reply" in guarded) return guarded.reply;
  const body = readBody(guarded.parsed);
  if ("error" in body) return fail(400, body.error);
  if (!listProjects().includes(body.project)) return fail(400, `no project ${body.project}`);
  const parentItem = viewRun(readLedger(openProject(body.project)), body.run).item;
  if (parentItem === undefined) return fail(400, `no run ${body.run} in ${body.project}`);
  const ready = await deps.readiness(body.project, body.run);
  if (!ready.ready) return fail(409, ready.reason);
  const known = new Set(ready.questions.map((question) => question.n));
  const unknown = body.approve.find((n) => !known.has(n));
  if (unknown !== undefined) return fail(400, `question ${String(unknown)} lists no commands to approve`);
  const keys = new Set(ready.items.map((item) => item.key));
  const missing = body.items.find((key) => !keys.has(key));
  if (missing !== undefined) return fail(400, `run ${body.run} has no needs-decision item with the key '${missing.slice(0, 80)}' to approve`);
  const argv = followUpArgv(body, viewer, ready.via === undefined ? undefined : ready.host);
  const dir = join(openProject(body.project).root, "runs", body.run);
  const log = join(dir, "follow-up.log");
  let started: StartedFollowUp;
  let offset: number;
  const at = new Date().toISOString();
  try {
    mkdirSync(dir, { recursive: true });
    offset = existsSync(log) ? statSync(log).size : 0;
    started = deps.start(argv, log);
  } catch (cause) {
    return fail(500, `the follow-up could not be started: ${errorMessage(cause)}`);
  }
  const pending: PendingInput = { at, who: `web:${viewer.who}`, kind: "follow-up", project: body.project, parent: body.run, host: ready.host, log, offset };
  const slug = ritualSlug(parentItem);
  if (slug !== undefined) pending.ritual = slug;
  const id = recordPending(pending);
  watchEnd(id, started);
  return outcomeReply(await waitForOutcome(started, { log, offset, waitMs: deps.waitMs ?? OUTCOME_WAIT_MS }), { id, host: ready.host, at });
}

/**
 * The argv of the follow-up: the verb, the approved question numbers and
 * item keys, the note, who, and `--on <host>` when it starts on the ritual's
 * host (0.69.0). Every value is one argv word, never a shell string.
 */
export function followUpArgv(body: { project: string; run: string; approve: readonly number[]; items: readonly string[]; note?: string }, viewer: ActionViewer, on: string | undefined): string[] {
  const argv = ["run", "follow-up", body.run, "--project", body.project];
  for (const n of body.approve) argv.push("--approve", String(n));
  for (const key of body.items) argv.push("--item", key);
  if (body.note !== undefined) argv.push("--note", body.note);
  argv.push("--who", `web:${viewer.who}`);
  if (on !== undefined) argv.push("--on", on);
  return argv;
}

/** What the follow-up did within the wait: started a run, ended without one, or neither yet. */
export type FollowUpOutcome = { started: string; host: string } | { ended: number | null; sentence: string } | { pending: true };

/** The log text written since `offset`. */
function logSince(log: string, offset: number): string {
  try {
    return readFileSync(log).subarray(offset).toString("utf8");
  } catch {
    return "";
  }
}

/**
 * Waits for the CLI's "started run" line in the log, or for the CLI to end,
 * at most `waitMs`. A line that came before the end wins: a run that
 * started and ended fast still started.
 */
export async function waitForOutcome(started: StartedFollowUp, at: { log: string; offset: number; waitMs: number; line?: RegExp }): Promise<FollowUpOutcome> {
  const settled = started.exited.then((code) => ({ code }));
  const deadline = Date.now() + at.waitMs;
  let ended: { code: number | null } | null = null;
  for (;;) {
    const output = logSince(at.log, at.offset);
    const line = (at.line ?? STARTED_LINE).exec(output);
    if (line !== null) return { started: line[1] ?? "", host: line[2] ?? "" };
    if (ended !== null) return { ended: ended.code, sentence: lastSentence(output) };
    if (Date.now() >= deadline) return { pending: true };
    const pause = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), OUTCOME_POLL_MS);
    });
    ended = await Promise.race([settled, pause]);
  }
}

/** The answer for an outcome: 202 with the run, 409 or 503 with the CLI's sentence, or 202 pending with a message. */
function outcomeReply(outcome: FollowUpOutcome, asked: Asked): PushApiReply {
  const { id, host, at } = asked;
  if ("started" in outcome) return { status: 202, body: { ok: true, run: outcome.started, host: outcome.host, id, at } };
  if ("pending" in outcome) return { status: 202, body: { ok: true, pending: true, host, id, at, message: pendingMessage(host) } };
  const isSsh = outcome.ended === SSH_EXIT || outcome.ended === null;
  const sentence = outcome.sentence === "" ? `darius ended with exit code ${String(outcome.ended)} and no message` : outcome.sentence;
  return fail(isSsh ? 503 : 409, refusedMessage(host, sentence), id);
}

// --- acknowledge a run (0.68.0, answers and run now 0.80.0) -------------------------------

const ACK_KEYS: ReadonlySet<string> = new Set(["project", "run", "note", "answers", "runNow"]);
const ANSWER_KEYS: ReadonlySet<string> = new Set(["n", "text"]);
const ITEM_RITUAL = "ritual/";
/** A host name that is safe as one argv word after `--on`: no leading dash, no space. */
const HOST_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

type AckBody = { project: string; run: string; note?: string; answers: QuestionAnswer[]; runNow: boolean } | { error: string };

/** The limits of an answer list: a result has at most 10 questions; a held run numbers its questions on across holds. */
interface AnswerLimits {
  entries: number;
  maxN: number;
}

const RESULT_ANSWERS: AnswerLimits = { entries: APPROVE_MAX, maxN: APPROVE_MAX };
const HELD_ANSWERS: AnswerLimits = { entries: 50, maxN: 1000 };

/** `answers` of the body: absent, or up to `limits.entries` entries { n, text }, n from 1 to `limits.maxN`, each text one plain line. */
function readAnswerList(value: JsonValue | undefined, limits: AnswerLimits = RESULT_ANSWERS): QuestionAnswer[] | { error: string } {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > limits.entries) return { error: `answers must list at most ${String(limits.entries)} entries { n, text }` };
  const answers: QuestionAnswer[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return { error: "answers: each entry is { n, text }" };
    const extra = Object.keys(entry).find((key) => !ANSWER_KEYS.has(key));
    if (extra !== undefined) return { error: `answers: unknown field ${extra.slice(0, 40)}` };
    const { n, text } = entry;
    if (n === undefined || !isCount(n, limits.maxN)) return { error: `answers: n must be a question number, 1 to ${String(limits.maxN)}` };
    if (!isText(text)) return { error: `answers: the text of question ${String(n)} must be text` };
    const line = text.replaceAll(/\s+/gu, " ").trim();
    const problem = answerProblem(line);
    if (problem !== null) return { error: `answers: the text of question ${String(n)} ${problem}` };
    if (answers.some((answer) => answer.n === n)) return { error: `answers: question ${String(n)} is answered twice` };
    answers.push({ n, text: line });
  }
  return answers;
}

/** Checks the body's shape: known keys only, a project name, a run id, a plain one-line note, the answers, a boolean runNow. */
function readAckBody(parsed: JsonValue): AckBody {
  if (!isRecord(parsed)) return { error: "send { project, run, note?, answers?, runNow? }" };
  const extra = Object.keys(parsed).find((key) => !ACK_KEYS.has(key));
  if (extra !== undefined) return { error: `unknown field ${extra.slice(0, 40)}` };
  const { project, run, runNow } = parsed;
  if (!isText(project) || !PROJECT_NAME.test(project)) return { error: "project must be a project name" };
  if (!isText(run) || !RUN_ID.test(run)) return { error: "run must be a run id" };
  const note = readNote(parsed.note);
  if ("error" in note) return note;
  const answers = readAnswerList(parsed.answers);
  if ("error" in answers) return answers;
  if (runNow !== undefined && runNow !== true && runNow !== false) return { error: "runNow must be true or false" };
  return { project, run, ...note, answers, runNow: runNow === true };
}

/** The ritual slug of a run's ledger item, or undefined for a run that is not a ritual run. */
function ritualSlug(item: string): string | undefined {
  if (!item.startsWith(ITEM_RITUAL)) return undefined;
  const slug = item.slice(ITEM_RITUAL.length);
  return RITUAL_SLUG.test(slug) ? slug : undefined;
}

/** The host `run now` must go to when the ritual belongs to another one (the CLI forwards it over ssh); undefined when this host is right. */
function ritualNowHost(project: string, slug: string): string | undefined {
  const store = openProject(project);
  const doc = store.readItem<Ritual>("ritual", slug);
  if (doc === null) return undefined;
  const right = ritualHost(store, readLedger(store), doc);
  return right === null || right.host === hostId() ? undefined : right.host;
}

/** Whether the run may be acknowledged is the CLI's rule (`ackable()` in src/runner/hold.ts); its sentence is the 409. */
async function acknowledge(request: ActionRequest, viewer: ActionViewer, deps: ActionDeps): Promise<PushApiReply> {
  const guarded = guard(request, viewer, LOOPBACK_ACK, ANSWERS_TOO_LONG);
  if ("reply" in guarded) return guarded.reply;
  const body = readAckBody(guarded.parsed);
  if ("error" in body) return fail(400, body.error);
  if (!listProjects().includes(body.project)) return fail(400, `no project ${body.project}`);
  const item = viewRun(readLedger(openProject(body.project)), body.run).item;
  if (item === undefined) return fail(400, `no run ${body.run} in ${body.project}`);
  const slug = ritualSlug(item);
  if (body.runNow && slug === undefined) return fail(400, "runNow: only a run of a ritual can start the ritual again");
  // "Send and run now" on a ritual of another host: the ack is written there too, before the run starts there,
  // so the run reads the answer without waiting for a sync. A plain "Send answer" stays local; sync carries it.
  let on: string | undefined;
  if (body.runNow && slug !== undefined) {
    let host: { on: string | undefined } | { failed: string };
    try {
      host = targetHost(deps, body.project, slug);
    } catch (cause) {
      return fail(500, `the ritual's host could not be read: ${errorMessage(cause)}`);
    }
    if ("failed" in host) return fail(409, `nothing written: ${host.failed}`);
    on = host.on;
  }
  const argv = ["run", "ack", "--project", body.project, "--who", `web:${viewer.who}`, "--json"];
  if (body.note !== undefined) argv.push("--note", body.note);
  for (const answer of body.answers) argv.push("--answer", `${String(answer.n)}=${answer.text}`);
  if (on !== undefined) argv.push("--on", on);
  argv.push("--", body.run);
  const answer = await deps.run(argv);
  if (answer.killed === true || (on !== undefined && answer.code === SSH_EXIT)) {
    return fail(502, on === undefined ? `darius did not finish: ${answer.error}` : `${on} did not answer: ${answer.error}`);
  }
  if (answer.code !== 0) return fail(409, answer.error);
  if (!body.runNow || slug === undefined) return { status: 200, body: { ok: true } };
  return runNowReply(await startRunNow(body, slug, viewer, deps, on), on ?? hostId());
}

/** What a detached run verb did within the wait: the run started, is still starting, or could not start. */
type RunNowOutcome = (Exclude<FollowUpOutcome, { ended: number | null }> | { ended: number | null; sentence: string; forwarded: boolean } | { failed: string }) & { ask?: Asked };

/** The part of a pending-starts line that only the spawn knows: when it was asked, its log and the log's size before. */
interface Spawned {
  at: string;
  log: string;
  offset: number;
}

/**
 * Starts the CLI detached with the argv `build` makes, its output in
 * `runs/<run>/<logName>`, and waits for `line`. `build` runs inside the try,
 * so anything that throws is a sentence for the card, never a 500: the
 * answer is already saved when this runs. `build` returns the host it
 * forwards to, if any.
 */
async function spawnWatched(
  deps: ActionDeps,
  watch: { project: string; run: string; logName: string; line: RegExp; host: string; record: (spawned: Spawned) => string },
  build: () => { argv: string[]; on: string | undefined } | { failed: string },
): Promise<RunNowOutcome> {
  let started: StartedFollowUp;
  let offset: number;
  let log: string;
  let on: string | undefined;
  const asked = new Date().toISOString();
  try {
    const made = build();
    if ("failed" in made) return made;
    on = made.on;
    const dir = join(openProject(watch.project).root, "runs", watch.run);
    log = join(dir, watch.logName);
    mkdirSync(dir, { recursive: true });
    offset = existsSync(log) ? statSync(log).size : 0;
    started = deps.start(made.argv, log);
  } catch (cause) {
    return { failed: refusedMessage(watch.host, errorMessage(cause)) };
  }
  const id = watch.record({ at: asked, log, offset });
  const ask: Asked = { id, host: watch.host, at: asked };
  watchEnd(id, started);
  const outcome = await waitForOutcome(started, { log, offset, waitMs: deps.waitMs ?? OUTCOME_WAIT_MS, line: watch.line });
  return "ended" in outcome ? { ...outcome, forwarded: on !== undefined, ask } : { ...outcome, ask };
}

/** The host a ritual's verb goes to with `--on`, or why it cannot go. Undefined when this host is right. */
function targetHost(deps: ActionDeps, project: string, slug: string): { on: string | undefined } | { failed: string } {
  const on = (deps.nowHost ?? ritualNowHost)(project, slug);
  if (on !== undefined && !HOST_NAME.test(on)) return { failed: "the ritual's host name is not valid" };
  return { on };
}

function startRunNow(body: { project: string; run: string }, slug: string, viewer: ActionViewer, deps: ActionDeps, on: string | undefined): Promise<RunNowOutcome> {
  const host = on ?? hostId();
  const record = (spawned: Spawned): string => recordPending({ ...spawned, who: `web:${viewer.who}`, kind: "run-now", project: body.project, ritual: slug, parent: body.run, host });
  return spawnWatched(deps, { project: body.project, run: body.run, logName: "run-now.log", line: NOW_STARTED_LINE, host, record }, () => {
    const argv = ["run", "now", slug, "--project", body.project, "--who", `web:${viewer.who}`];
    if (on !== undefined) argv.push("--on", on);
    return { argv, on };
  });
}

/** The refusal a verb that did not start a run gives: its sentence, or the ssh failure when it went over ssh. */
function endedReason(outcome: { ended: number | null; sentence: string; forwarded: boolean }, host: string): string {
  const sentence = outcome.sentence === "" ? `darius ended with exit code ${String(outcome.ended)} and no message` : outcome.sentence;
  return refusedMessage(host, sentence);
}

/** The answer for "run now": the ack worked, so it is always 200; the run's own fate is in the body. */
function runNowReply(outcome: RunNowOutcome, host: string): PushApiReply {
  const ask = outcome.ask;
  if ("failed" in outcome) return { status: 200, body: { ok: true, runNow: { error: outcome.failed } } };
  if ("started" in outcome) return { status: 200, body: withAsked({ ok: true, run: outcome.started, host: outcome.host }, ask) };
  if ("pending" in outcome) return { status: 200, body: withAsked({ ok: true, pending: true, host, message: pendingMessage(host) }, ask) };
  return { status: 200, body: withAsked({ ok: true, runNow: { error: endedReason(outcome, host) } }, ask) };
}

// --- answer and resume a held run (0.80.0) -------------------------------------------------

const HELD_KEYS: ReadonlySet<string> = new Set(["project", "run", "answers", "resume"]);

type AnswerBody = { project: string; run: string; answers: QuestionAnswer[] } | { error: string };

function readAnswerBody(parsed: JsonValue): AnswerBody {
  if (!isRecord(parsed)) return { error: "send { project, run, answers: [{ n, text }], resume: true }" };
  const extra = Object.keys(parsed).find((key) => !HELD_KEYS.has(key));
  if (extra !== undefined) return { error: `unknown field ${extra.slice(0, 40)}` };
  const { project, run, resume } = parsed;
  if (!isText(project) || !PROJECT_NAME.test(project)) return { error: "project must be a project name" };
  if (!isText(run) || !RUN_ID.test(run)) return { error: "run must be a run id" };
  if (resume !== true) return { error: "resume must be true: this endpoint answers and resumes" };
  const answers = readAnswerList(parsed.answers, HELD_ANSWERS);
  if ("error" in answers) return answers;
  if (answers.length === 0) return { error: "answers: give at least one answer" };
  return { project, run, answers };
}

async function answerHeld(request: ActionRequest, viewer: ActionViewer, deps: ActionDeps): Promise<PushApiReply> {
  const guarded = guard(request, viewer, LOOPBACK_ANSWER, ANSWERS_TOO_LONG);
  if ("reply" in guarded) return guarded.reply;
  const body = readAnswerBody(guarded.parsed);
  if ("error" in body) return fail(400, body.error);
  if (!listProjects().includes(body.project)) return fail(400, `no project ${body.project}`);
  const view = viewRun(readLedger(openProject(body.project)), body.run);
  if (view.item === undefined) return fail(400, `no run ${body.run} in ${body.project}`);
  const slug = ritualSlug(view.item);
  if (slug === undefined) return fail(400, "only a run of a ritual can be resumed");
  if (view.phase !== "held") return fail(409, `run ${body.run} is not held (phase: ${view.phase ?? "unknown"})`);
  const first = view.holdFrom + 1;
  const last = view.questions.length;
  const stray = body.answers.find((answer) => answer.n < first || answer.n > last);
  if (stray !== undefined) return fail(400, `question ${String(stray.n)} is not a question of the current hold (${String(first)} to ${String(last)})`);
  let host: { on: string | undefined } | { failed: string };
  try {
    host = targetHost(deps, body.project, slug);
  } catch (cause) {
    return fail(500, `the ritual's host could not be read: ${errorMessage(cause)}`);
  }
  if ("failed" in host) return fail(409, `nothing written: ${host.failed}`);
  const who = `web:${viewer.who}`;
  const argv = ["run", "answer", "--project", body.project, "--who", who, "--json"];
  for (const answer of body.answers) argv.push("--answer", `${String(answer.n)}=${answer.text}`);
  if (host.on !== undefined) argv.push("--on", host.on);
  argv.push("--", body.run);
  const written = await deps.run(argv);
  // ssh failed or a signal ended the CLI: the host did not answer, which is not the run's refusal.
  if (written.killed === true || (host.on !== undefined && written.code === SSH_EXIT)) {
    return fail(502, host.on === undefined ? `darius did not finish: ${written.error}` : `${host.on} did not answer: ${written.error}`);
  }
  if (written.code !== 0) return fail(409, written.error);
  const resumeArgv = ["resume", body.run, "--project", body.project, "--who", who];
  if (host.on !== undefined) resumeArgv.push("--on", host.on);
  const where = host.on ?? hostId();
  const record = (spawned: Spawned): string => recordPending({ ...spawned, who, kind: "resume", project: body.project, ritual: slug, parent: body.run, host: where });
  return resumeReply(await spawnWatched(deps, { project: body.project, run: body.run, logName: "resume.log", line: RESUME_STARTED_LINE, host: where, record }, () => ({ argv: ["run", ...resumeArgv], on: host.on })), where);
}

/** The answer after the answers were written: the run went on, is still starting, or the resume was refused. The answers are never rolled back. */
function resumeReply(outcome: RunNowOutcome, host: string): PushApiReply {
  const ask = outcome.ask;
  if ("failed" in outcome) return { status: 200, body: { ok: true, resume: { error: outcome.failed } } };
  if ("started" in outcome) return { status: 200, body: withAsked({ ok: true, resumed: true, run: outcome.started, host: outcome.host }, ask) };
  if ("pending" in outcome) return { status: 200, body: withAsked({ ok: true, pending: true, host, message: pendingMessage(host) }, ask) };
  return { status: 200, body: withAsked({ ok: true, resume: { error: endedReason(outcome, host) } }, ask) };
}

// --- dismiss earlier asks (0.80.0) ---------------------------------------------------------

const ACK_EARLIER_KEYS: ReadonlySet<string> = new Set(["project", "run", "runs"]);

type AckEarlierBody = { project: string; run: string; runs: string[] } | { error: string };

function readAckEarlierBody(parsed: JsonValue): AckEarlierBody {
  if (!isRecord(parsed)) return { error: "send { project, run, runs: [ID] }" };
  const extra = Object.keys(parsed).find((key) => !ACK_EARLIER_KEYS.has(key));
  if (extra !== undefined) return { error: `unknown field ${extra.slice(0, 40)}` };
  const { project, run, runs } = parsed;
  if (!isText(project) || !PROJECT_NAME.test(project)) return { error: "project must be a project name" };
  if (!isText(run) || !RUN_ID.test(run)) return { error: "run must be a run id" };
  if (!Array.isArray(runs) || runs.length === 0 || runs.length > APPROVE_MAX) return { error: `runs must list 1 to ${String(APPROVE_MAX)} run ids` };
  const ids: string[] = [];
  for (const id of runs) {
    if (!isText(id) || !RUN_ID.test(id)) return { error: "runs: each entry must be a run id" };
    if (ids.includes(id)) return { error: `runs: ${id} is given twice` };
    ids.push(id);
  }
  return { project, run, runs: ids };
}

/** Why `id` is not an earlier open ask of the ritual of run `run`, or undefined when it is one. */
function notEarlierAsk(ledger: readonly LedgerLine[], run: string, id: string): string | undefined {
  const view = viewRun(ledger, run);
  const other = viewRun(ledger, id);
  if (other.item === undefined) return `no run ${id}`;
  if (other.item !== view.item) return `run ${id} is not a run of the same ritual as ${run}`;
  // Same order as the page: by start time, the ledger order breaking a tie.
  const starts = ledger.flatMap((line) => (line.type === "run.started" && line.item === view.item && isText(line.run) ? [{ run: line.run, at: line.at }] : []));
  const here = starts.findIndex((start) => start.run === run);
  const there = starts.findIndex((start) => start.run === id);
  const hereStart = starts[here];
  const thereStart = starts[there];
  if (hereStart === undefined || thereStart === undefined) return `run ${id} did not start before run ${run}`;
  const gap = thereStart.at.localeCompare(hereStart.at);
  if (gap > 0 || (gap === 0 && there >= here)) return `run ${id} did not start before run ${run}`;
  if (other.phase !== "closed" || other.outcome !== "complete" || (other.result?.questions ?? 0) === 0) return `run ${id} is not a completed run with questions`;
  if (other.acknowledged !== undefined) return `run ${id} is already acknowledged by ${other.acknowledged.who}`;
  return undefined;
}

async function acknowledgeEarlier(request: ActionRequest, viewer: ActionViewer, deps: ActionDeps): Promise<PushApiReply> {
  const guarded = guard(request, viewer, LOOPBACK_ACK);
  if ("reply" in guarded) return guarded.reply;
  const body = readAckEarlierBody(guarded.parsed);
  if ("error" in body) return fail(400, body.error);
  if (!listProjects().includes(body.project)) return fail(400, `no project ${body.project}`);
  const ledger = readLedger(openProject(body.project));
  if (viewRun(ledger, body.run).item === undefined) return fail(400, `no run ${body.run} in ${body.project}`);
  for (const id of body.runs) {
    const reason = notEarlierAsk(ledger, body.run, id);
    if (reason !== undefined) return fail(409, `nothing dismissed: ${reason}`);
  }
  let count = 0;
  let firstError = "";
  for (const id of body.runs) {
    const answer = await deps.run(["run", "ack", "--project", body.project, "--who", `web:${viewer.who}`, "--json", "--", id]);
    if (answer.code === 0) count += 1;
    else if (firstError === "") firstError = answer.error;
  }
  if (count < body.runs.length) return fail(409, `${String(count)} of ${String(body.runs.length)} dismissed; ${firstError}`);
  return { status: 200, body: { ok: true, count } };
}

// --- close a finding (0.62.0), reopen it (0.96.0) --------------------------------------------------------------

/** The longest key the endpoint takes: a key the run gave has at most 120 characters, a key darius made from the title may have more. */
const FINDING_KEY_MAX = 1000;
const CLOSE_KEYS: ReadonlySet<string> = new Set(["project", "ritual", "key", "note"]);
const RITUAL_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
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

/** One request under FINDING_API_PREFIX, already past the access check: `close` or `reopen`. */
export async function findingApi(request: ActionRequest, viewer: ActionViewer, deps: FindingDeps = DEFAULT_FINDING_DEPS): Promise<PushApiReply> {
  const verb = request.path === FINDING_CLOSE_PATH ? "close" : request.path === FINDING_REOPEN_PATH ? "reopen" : null;
  if (verb === null) return fail(404, "no such endpoint");
  if (request.method !== "POST") return fail(405, "POST only");
  if (viewer.local === true) return fail(403, verb === "close" ? LOOPBACK_CLOSE : LOOPBACK_REOPEN);
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
  if (verb === "close") {
    if (found.status === "fixed") return fail(409, "that finding is fixed; there is nothing to close");
    if (found.status === "closed") return fail(409, `that finding is already closed by ${found.closed?.who ?? "someone"}`);
  } else if (found.status !== "closed") {
    return fail(409, `that finding is not closed (status: ${found.status}); there is nothing to reopen`);
  }
  const argv = ["finding", verb, "--ritual", body.ritual, "--project", body.project];
  if (body.note !== undefined) argv.push("--note", body.note);
  argv.push("--who", `web:${viewer.who}`, "--json", "--", body.key);
  const answer = await deps.run(argv);
  if (answer.code !== 0) return fail(409, answer.error);
  return { status: 200, body: { ok: true } };
}

// --- check one vigil now (0.86.0) ----------------------------------------------------------

const CHECK_KEYS: ReadonlySet<string> = new Set(["project", "slug"]);
/** How long the POST waits for the CLI's "started" line or its refusal. A lease on a bucket takes a round trip or two. */
export const CHECK_WAIT_MS = 1_500;
/** The stderr line of `darius vigil sweep <slug>` once its lease is held (src/cli/vigil.ts, SWEEP_STARTED_PREFIX). */
export const SWEEP_STARTED_LINE = /^darius vigil sweep: started (\S+) on (\S+)$/mu;
/** A sweep log grows with each check; past this size the next check starts it afresh. */
const SWEEP_LOG_MAX = 256 * 1024;

/** What the check endpoint needs from the host; tests stub the spawn. */
export interface VigilCheckDeps {
  start: FollowUpStarter;
  /** How long the POST waits; CHECK_WAIT_MS when absent. Tests shorten it. */
  waitMs?: number;
}

const DEFAULT_CHECK_DEPS: VigilCheckDeps = { start: startDetachedFollowUp };

type CheckBody = { project: string; slug: string } | { error: string };

function readCheckBody(parsed: JsonValue): CheckBody {
  if (!isRecord(parsed)) return { error: "send { project, slug }" };
  const extra = Object.keys(parsed).find((key) => !CHECK_KEYS.has(key));
  if (extra !== undefined) return { error: `unknown field ${extra.slice(0, 40)}` };
  const { project, slug } = parsed;
  if (!isText(project) || !PROJECT_NAME.test(project)) return { error: "project must be a project name" };
  if (!isText(slug) || !isSlug(slug)) return { error: "slug must be a vigil slug" };
  return { project, slug };
}

/** The argv of the check. Every value is one argv word, never a shell string. */
export function vigilCheckArgv(body: { project: string; slug: string }, viewer: ActionViewer): string[] {
  return ["vigil", "sweep", body.slug, "--project", body.project, "--json", "--who", `web:${viewer.who}`];
}

/** The sentence of a sweep that ended without a "started" line: its stderr refusal, or the reason of a `--json` skip. */
function checkSentence(output: string): string {
  for (const line of output.split("\n").toReversed()) {
    if (!line.startsWith("{")) continue;
    try {
      const parsed: JsonValue = JSON.parse(line);
      const skipped = isRecord(parsed) ? parsed.skipped : undefined;
      if (skipped !== undefined && isRecord(skipped) && isText(skipped.detail)) return skipped.detail;
    } catch {
      // Not a skip: the stderr sentence is the answer.
    }
  }
  return lastSentence(output);
}

/** The answer for a check: 202 once it started, 409 with the CLI's refusal, or 202 pending when nothing came in time. */
function checkReply(outcome: FollowUpOutcome, output: () => string, asked: Asked): PushApiReply {
  const { id, host, at } = asked;
  if ("started" in outcome) return { status: 202, body: { ok: true, started: true, host: outcome.host, id, at } };
  if ("pending" in outcome) return { status: 202, body: { ok: true, pending: true, host, id, at, message: pendingMessage(host) } };
  if (outcome.ended === null) return fail(500, refusedMessage(host, "the check could not be started"), id);
  const sentence = checkSentence(output());
  return fail(409, refusedMessage(host, sentence === "" ? `the check ended with exit code ${String(outcome.ended)} and no message` : sentence), id);
}

/** `HH:MM` on this host's clock. */
function clockTime(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * A repeat check inside the cooldown, answered before anything is spawned (the CLI would refuse it with a
 * sentence about `--force`, which the web cannot pass). The rule is the CLI's `cooldownLeftMs`: the newest
 * `vigil.swept` line that is not a skip. The body carries both times so a client can word its own sentence.
 */
export function cooldownReply(lines: readonly LedgerLine[], now: number): PushApiReply | null {
  const last = lines.findLast((line) => line.type === "vigil.swept" && line.outcome !== "skipped");
  if (last === undefined) return null;
  const checked = Date.parse(last.at);
  const retry = checked + SWEEP_COOLDOWN_MS;
  if (Number.isNaN(checked) || retry <= now) return null;
  const minutes = Math.max(1, Math.round((now - checked) / 60_000));
  const error = `Checked ${String(minutes)} min ago. Check again at ${clockTime(retry)}.`;
  return { status: 409, body: { ok: false, error, retryAt: new Date(retry).toISOString(), lastCheckedAt: last.at } };
}

/** One request under VIGIL_API_PREFIX, already past the access check. */
export async function vigilApi(request: ActionRequest, viewer: ActionViewer, deps: VigilCheckDeps = DEFAULT_CHECK_DEPS): Promise<PushApiReply> {
  if (request.path !== `${VIGIL_API_PREFIX}check`) return fail(404, "no such endpoint");
  const guarded = guard(request, viewer, LOOPBACK_CHECK);
  if ("reply" in guarded) return guarded.reply;
  const body = readCheckBody(guarded.parsed);
  if ("error" in body) return fail(400, body.error);
  if (!listProjects().includes(body.project)) return fail(400, `no project ${body.project}`);
  const project = openProject(body.project);
  if (project.readItem("vigil", body.slug) === null) return fail(404, `no vigil ${body.slug} in ${body.project}`);
  const lines = linesFor(readLedger(project), itemRef("vigil", body.slug));
  const status = vigilStatus(body.slug, lines);
  if (status.state === "closed") return fail(409, `vigil '${body.slug}' is closed; there is nothing to check`);
  if (status.paused) return fail(409, `vigil '${body.slug}' is paused${status.pausedUntil === undefined ? "" : ` until ${status.pausedUntil}`}; resume it to check it`);
  const cooling = cooldownReply(lines, Date.now());
  if (cooling !== null) return cooling;
  const dir = join(project.root, "sweeps");
  const log = join(dir, `${body.slug}.log`);
  let started: StartedFollowUp;
  let offset: number;
  const at = new Date().toISOString();
  try {
    mkdirSync(dir, { recursive: true });
    if (existsSync(log) && statSync(log).size > SWEEP_LOG_MAX) rmSync(log);
    offset = existsSync(log) ? statSync(log).size : 0;
    started = deps.start(vigilCheckArgv(body, viewer), log);
  } catch (cause) {
    return fail(500, `the check could not be started: ${errorMessage(cause)}`);
  }
  const id = recordPending({ at, who: `web:${viewer.who}`, kind: "vigil-check", project: body.project, vigil: body.slug, host: hostId(), log, offset });
  watchEnd(id, started);
  const outcome = await waitForOutcome(started, { log, offset, waitMs: deps.waitMs ?? CHECK_WAIT_MS, line: SWEEP_STARTED_LINE });
  return checkReply(outcome, () => logSince(log, offset), { id, host: hostId(), at });
}
