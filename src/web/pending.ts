/**
 * Pending starts (0.89.0; docs/concept.md, "Web status page"): a host-local
 * record of the CLI processes the web app started, so a page can say
 * "starting" between the POST and the ledger line, and say why a start did
 * not happen.
 *
 * The registry is `<state dir>/web/pending-starts.jsonl`. It is not under a
 * project folder and sync never reads it: the host that serves the page is the
 * host that spawned the process, and the log the entry points at is on this
 * host. A reader on another host sees the `run.started` line through sync and
 * needs no registry.
 *
 * Two kinds of line, append only, written under one file lock together with
 * the compaction (a rewrite through a temp file and a rename):
 *
 *   request  {id, at, who, kind, project, ritual?, vigil?, parent?, host, log, offset}
 *   ended    {id, ended: <exit code | null>, at}
 *
 * `offset` is the size of the log before the spawn: a log is appended to
 * across requests, so only the text after it belongs to this request.
 *
 * `pendingStarts` turns the lines into states, from the ledger and the log:
 *
 *   started  the ledger shows the run, the resume or the sweep this request asked for
 *   refused  the spawn ended without a start, or a sweep ran and skipped
 *   starting no sign yet, and the request is younger than 15 minutes
 *   lost     no sign after 15 minutes (a late line still turns it into `started`)
 *
 * Every sentence taken from a log or a sweep passes `maskSecrets`.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { hostId } from "../core/ledger.ts";
import { maskSecrets } from "../core/mask-secrets.ts";
import type { JsonValue, LedgerLine } from "../core/model.ts";
import { stateDir } from "../core/paths.ts";
import { withFileLock } from "../core/store.ts";
import { ulid } from "../core/ulid.ts";
import { lastSentence } from "../runner/follow-up-ready.ts";
import type { PendingKind, PendingStart } from "./api.ts";

/** How long a request may show `starting` before it is `lost`. */
export const STARTING_MS = 15 * 60 * 1000;
/** How long a request stays in the registry and in `WebContext.pending`. */
export const KEEP_MS = 24 * 60 * 60 * 1000;
/** A forwarded start (`--on <host>`) writes its ledger time with the other host's clock: lines up to this much before `at` still count. A start on this host needs no skew, and a window would let the line of the request before it answer this one. */
export const CLOCK_SKEW_MS = 2 * 60 * 1000;

/** One request line of the registry. */
export interface PendingRequest {
  id: string;
  at: string;
  who: string;
  kind: PendingKind;
  project: string;
  ritual?: string;
  vigil?: string;
  parent?: string;
  host: string;
  log: string;
  offset: number;
}

/** What a caller gives `recordPending`: the request without its id. */
export type PendingInput = Omit<PendingRequest, "id">;

/** The lines of a project's ledger, oldest first. */
export type LedgerView = (project: string) => readonly LedgerLine[];

const KINDS: readonly PendingKind[] = ["follow-up", "run-now", "resume", "vigil-check"];
const STARTED_LINE = /^darius (?:run (?:follow-up|now|resume)|vigil sweep): started (?:run )?(\S+) on (\S+)$/mu;

/** `<state dir>/web/pending-starts.jsonl`. */
export function pendingFile(): string {
  return join(stateDir(), "web", "pending-starts.jsonl");
}

function lockFile(): string {
  return `${pendingFile()}.lock`;
}

// --- reading the file -------------------------------------------------------------------

interface Registry {
  requests: PendingRequest[];
  ended: Map<string, number | null>;
}

function isRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isNumber(value: JsonValue | undefined): value is number {
  return typeof value === "number";
}

function kindOf(value: JsonValue | undefined): PendingKind | undefined {
  return KINDS.find((kind) => kind === value);
}

function requestOf(row: { readonly [key: string]: JsonValue }): PendingRequest | null {
  const kind = kindOf(row.kind);
  const { id, at, who, project, host, log, offset } = row;
  if (kind === undefined || !isString(id) || !isString(at) || !isString(who) || !isString(project) || !isString(host) || !isString(log)) return null;
  if (Number.isNaN(Date.parse(at))) return null;
  const request: PendingRequest = { id, at, who, kind, project, host, log, offset: isNumber(offset) ? offset : 0 };
  if (isString(row.ritual)) request.ritual = row.ritual;
  if (isString(row.vigil)) request.vigil = row.vigil;
  if (isString(row.parent)) request.parent = row.parent;
  return request;
}

/** The registry as it is on disk. A torn or unknown line is skipped; a missing file is empty. */
export function readRegistry(): Registry {
  const registry: Registry = { requests: [], ended: new Map() };
  const file = pendingFile();
  if (!existsSync(file)) return registry;
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    return registry;
  }
  for (const text of content.split("\n")) {
    if (text.trim() === "") continue;
    let row: JsonValue;
    try {
      row = JSON.parse(text);
    } catch {
      continue;
    }
    if (!isRecord(row) || !isString(row.id)) continue;
    if ("ended" in row) {
      registry.ended.set(row.id, isNumber(row.ended) ? row.ended : null);
      continue;
    }
    const request = requestOf(row);
    if (request !== null) registry.requests.push(request);
  }
  return registry;
}

// --- writing the file -------------------------------------------------------------------

interface Compacted {
  kept: string[];
  changed: boolean;
}

/** The file's lines, minus the requests older than KEEP_MS, the `ended` lines of those, and torn lines. `changed` tells whether anything went. */
function compacted(content: string, now: number): Compacted {
  const rows: Array<{ text: string; row: { readonly [key: string]: JsonValue } }> = [];
  for (const text of content.split("\n")) {
    if (text.trim() === "") continue;
    try {
      const row: JsonValue = JSON.parse(text);
      if (isRecord(row)) rows.push({ text, row });
    } catch {
      // A torn line is dropped.
    }
  }
  const dropped = new Set<string>();
  for (const { row } of rows) {
    const isOld = !isString(row.at) || !(now - Date.parse(row.at) < KEEP_MS);
    if (isString(row.id) && "kind" in row && isOld) dropped.add(row.id);
  }
  // An `ended` line whose request is gone (dropped now, or compacted before its spawn ended) goes too.
  const asked = new Set(rows.flatMap(({ row }) => ("kind" in row && isString(row.id) ? [row.id] : [])));
  const kept = rows.filter(({ row }) => isString(row.id) && asked.has(row.id) && !dropped.has(row.id)).map(({ text }) => text);
  return { kept, changed: kept.length !== content.split("\n").filter((text) => text.trim() !== "").length };
}

/** Appends `lines` to the registry under the lock, compacting first. Never throws: the registry only helps the page. */
function write(lines: readonly object[]): void {
  try {
    const file = pendingFile();
    mkdirSync(join(stateDir(), "web"), { recursive: true });
    withFileLock(lockFile(), () => {
      const now = Date.now();
      const before = existsSync(file) ? readFileSync(file, "utf8") : "";
      const { kept, changed } = compacted(before, now);
      if (changed) {
        const temp = `${file}.tmp-${String(process.pid)}`;
        writeFileSync(temp, kept.length === 0 ? "" : `${kept.join("\n")}\n`, { mode: 0o600 });
        renameSync(temp, file);
      }
      appendFileSync(file, lines.map((line) => `${JSON.stringify(line)}\n`).join(""), { mode: 0o600 });
    });
  } catch (cause) {
    console.error(`darius serve: could not write the pending starts: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

/** Records one request and returns its id. A failure to write is logged, and the id still comes back. */
export function recordPending(input: PendingInput): string {
  const id = ulid();
  write([{ id, ...input }]);
  return id;
}

/** Records that the spawn of request `id` ended: its exit code, or null when it could not start or a signal ended it. */
export function markEnded(id: string, code: number | null): void {
  write([{ id, ended: code, at: new Date().toISOString() }]);
}

// --- resolving --------------------------------------------------------------------------

/** The text of `log` written since `offset`; the whole log when it is shorter than `offset` (it was cut). */
export function logSince(log: string, offset: number): string {
  try {
    const bytes = readFileSync(log);
    return (bytes.length < offset ? bytes : bytes.subarray(offset)).toString("utf8");
  } catch {
    return "";
  }
}

/** The longest sentence the page shows; a stack trace in a log would fill the card. */
const SENTENCE_MAX = 300;

/** A sentence for the page: masked, then cut at SENTENCE_MAX characters. */
function shownSentence(sentence: string): string {
  const masked = maskSecrets(sentence);
  const chars = [...masked];
  return chars.length <= SENTENCE_MAX ? masked : `${chars.slice(0, SENTENCE_MAX - 1).join("")}…`;
}

function whoMatches(lineWho: string, who: string): boolean {
  return lineWho === who || lineWho.startsWith(`${who} `);
}

function isInWindow(line: LedgerLine, request: PendingRequest, isForwarded: boolean): boolean {
  return Date.parse(line.at) >= Date.parse(request.at) - (isForwarded ? CLOCK_SKEW_MS : 0);
}

/** The `skipped.detail` of a `--json` sweep result in the log, if any. */
function skipDetail(output: string): string | null {
  for (const text of output.split("\n").toReversed()) {
    if (!text.startsWith("{")) continue;
    try {
      const parsed: JsonValue = JSON.parse(text);
      const skipped = isRecord(parsed) ? parsed.skipped : undefined;
      if (isRecord(skipped) && isString(skipped.detail)) return skipped.detail;
    } catch {
      // Not a skip result.
    }
  }
  return null;
}

/** The first line of the ledger that answers `request`, or null. */
function answer(request: PendingRequest, lines: readonly LedgerLine[], logRun: string | null, isForwarded: boolean): { run?: string; skipped?: string } | null {
  for (const line of lines) {
    const isRunStart = request.kind === "follow-up" || request.kind === "run-now";
    if (isRunStart && line.type === "run.started" && logRun !== null && line.run === logRun) return { run: logRun };
    if (!isInWindow(line, request, isForwarded) || !whoMatches(line.who, request.who)) continue;
    if (request.kind === "follow-up" && line.type === "run.started" && line.follow_up_of === request.parent && isString(line.run)) return { run: line.run };
    if (request.kind === "run-now" && line.type === "run.started" && line.item === `ritual/${request.ritual ?? ""}` && !isString(line.follow_up_of) && isString(line.run)) return { run: line.run };
    if (request.kind === "resume" && line.type === "run.resumed" && line.run === request.parent) return { run: request.parent };
    if (request.kind === "vigil-check" && line.type === "vigil.swept" && line.item === `vigil/${request.vigil ?? ""}` && line.dry_run !== true) {
      return line.outcome === "skipped" ? { skipped: isString(line.reason) ? line.reason : "the sweep skipped the vigil" } : {};
    }
  }
  return null;
}

/**
 * The state of one request. Pure over its inputs: `lines` is the project's
 * ledger, `output` the log text after the request's offset, `ended` the
 * recorded end of the spawn (undefined while it is not known to have ended).
 */
export function resolvePending(request: PendingRequest, input: { lines: readonly LedgerLine[]; output: string; ended: number | null | undefined; now: number; isForwarded?: boolean }): PendingStart {
  const base: PendingStart = { id: request.id, at: request.at, who: request.who, kind: request.kind, project: request.project, host: request.host, state: "starting" };
  if (request.ritual !== undefined) base.ritual = request.ritual;
  if (request.vigil !== undefined) base.vigil = request.vigil;
  if (request.parent !== undefined) base.parent = request.parent;
  const logRun = STARTED_LINE.exec(input.output)?.[1] ?? null;
  const found = answer(request, input.lines, logRun, input.isForwarded === true);
  if (found?.skipped !== undefined) return { ...base, state: "refused", sentence: shownSentence(found.skipped) };
  if (found !== null) {
    const run = found.run;
    return run === undefined ? { ...base, state: "started" } : { ...base, state: "started", run };
  }
  const sentence = request.kind === "vigil-check" ? (skipDetail(input.output) ?? lastSentence(input.output)) : lastSentence(input.output);
  if (request.kind === "vigil-check" && input.ended !== undefined && skipDetail(input.output) !== null) return { ...base, state: "refused", sentence: shownSentence(sentence) };
  const hasStarted = STARTED_LINE.test(input.output);
  if (input.ended !== undefined && !hasStarted) {
    const said = sentence === "" ? (input.ended === null ? "darius could not be started" : `darius ended with exit code ${String(input.ended)} and no message`) : sentence;
    return { ...base, state: "refused", sentence: shownSentence(said) };
  }
  if (input.now - Date.parse(request.at) < STARTING_MS) return base;
  return sentence === "" ? { ...base, state: "lost" } : { ...base, state: "lost", sentence: shownSentence(sentence) };
}

/**
 * The requests of the last 24 hours, newest first, one project or all, each
 * resolved against the ledger (`ledgerView`) and its log. Reads the registry
 * and the logs; writes nothing.
 */
export function pendingStarts(project: string | null, ledgerView: LedgerView, now: Date = new Date()): PendingStart[] {
  const registry = readRegistry();
  const wanted = registry.requests.filter((request) => (project === null || request.project === project) && now.getTime() - Date.parse(request.at) < KEEP_MS);
  const here = hostId();
  const states = wanted.map((request) =>
    resolvePending(request, { lines: ledgerView(request.project), output: logSince(request.log, request.offset), ended: registry.ended.get(request.id), now: now.getTime(), isForwarded: request.host !== here }),
  );
  return states.toSorted((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0));
}

/**
 * The check of a vigil that the vigil page and the vigils list show (0.95.0): the newest `vigil-check`
 * start for the slug that has no result yet. It is `starting`, `refused` or `lost`; a `started` one has
 * its `vigil.swept` line, so it is null. A refusal or a loss that a later sweep (the timer's, another
 * check) overtook is null too: `sweptAt` is the time of the newest `vigil.swept` line of the vigil.
 */
export function vigilCheckOf(starts: readonly PendingStart[], slug: string, sweptAt: string | null): PendingStart | null {
  const newest = starts.filter((start) => start.kind === "vigil-check" && start.vigil === slug).toSorted((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0))[0];
  if (newest === undefined || newest.state === "started") return null;
  if (newest.state !== "starting" && sweptAt !== null && sweptAt > newest.at) return null;
  return newest;
}
