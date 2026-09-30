/**
 * The append-only ledger (docs/plan-tonight.md, "Ledger line"; docs/concept.md,
 * "Write path" and "Conflict rules").
 *
 * Each host appends to its own `ledger/<host>/open.jsonl` under the project
 * lock. Sync closes that file into an immutable `<ulid>.jsonl` chunk and
 * writes chunks pulled from other hosts under `ledger/<their host>/`. Reads
 * take the union of every host dir, open and closed files alike, dedupe by
 * `id` and sort by `id`. Lines never conflict: two hosts never write the same
 * file.
 *
 * Helpers beyond the module contract, for sync (T5), import (T7) and the
 * commands:
 *
 *   hostId(): string
 *       `host` from config.toml when one exists, else the short hostname.
 *   defaultWho(): string
 *       $USER, else the OS user name.
 *   appendLines(project: Project, lines: readonly LedgerLineInput[]): LedgerLine[]
 *       Many lines under one lock acquisition (import).
 *   parseLedgerText(text: string, source: string): LedgerLine[]
 *       Validates chunk text; throws naming `source:line` on a bad line.
 *   closeOpenChunk(project: Project): string | null
 *       Renames this host's open.jsonl to `<ulid>.jsonl` and returns that
 *       file name, or null when there is nothing to close.
 *   listChunks(project: Project): LedgerChunk[]
 *       Every closed chunk, all hosts, sorted by host then name.
 *   writeRemoteChunk(project: Project, chunk: RemoteChunk): "written" | "exists"
 *       Stores a pulled chunk under `ledger/<chunk.host>/<chunk.name>`.
 *       Validates every line first. Identical content already there is
 *       "exists"; different content under the same name throws.
 *
 * `LedgerLineInput.at` backdates a line (import). The line's id then encodes
 * that time, so the "id time equals at" rule holds for every line.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname, userInfo } from "node:os";
import { join } from "node:path";

import { loadConfig } from "./config.ts";
import type { JsonValue, LedgerLine } from "./model.ts";
import { configDir } from "./paths.ts";
import type { Project } from "./store.ts";
import { ulid, ulidTime } from "./ulid.ts";

/**
 * What a caller hands to `appendLine`. The contract spells this
 * `Omit<LedgerLine, "v" | "id" | "at" | "host" | "project">`, but `Omit`
 * over an interface with an index signature drops every named field (keyof
 * is just `string`), which would leave `who` and `type` optional and untyped.
 * This is the same set of fields, spelled out. `at` is optional: set it only
 * to backdate a line.
 */
export interface LedgerLineInput {
  who: string;
  type: string;
  item?: string;
  at?: string;
  [k: string]: JsonValue | undefined;
}

export interface LedgerChunk {
  readonly host: string;
  readonly name: string;
  readonly path: string;
}

export interface RemoteChunk {
  readonly host: string;
  readonly name: string;
  readonly text: string;
}

type JsonObject = { readonly [key: string]: JsonValue };

const OPEN_FILE = "open.jsonl";
const CHUNK_FILE = /^[0-9A-HJKMNP-TV-Z]{26}\.jsonl$/u;
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/u;
const HOST_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/u;
const RESERVED_KEYS = new Set(["v", "id", "host", "project"]);

// --- host and who -------------------------------------------------------------

function shortHostname(): string {
  const name = hostname();
  const first = name.split(".")[0];
  return first !== undefined && first !== "" ? first : name;
}

/** True when `host` can be a host id: it names a ledger directory, so it is one path segment of letters, digits, `.`, `_` and `-`. */
export function isHostId(host: string): boolean {
  return HOST_PATTERN.test(host);
}

function assertHost(host: string, where: string): void {
  if (!isHostId(host)) {
    throw new Error(`${where}: host id '${host}' cannot name a ledger directory`);
  }
}

let cachedHost: { readonly configDir: string; readonly host: string } | null = null;

/** `host` from config.toml when the file exists, else the short hostname. Cached per config dir. */
export function hostId(): string {
  const dir = configDir();
  if (cachedHost?.configDir === dir) return cachedHost.host;
  const hasConfig = existsSync(join(dir, "config.toml"));
  const host = hasConfig ? loadConfig().host : shortHostname();
  assertHost(host, hasConfig ? join(dir, "config.toml") : "hostname");
  cachedHost = { configDir: dir, host };
  return host;
}

/** Who a line is attributed to when the caller does not say: $DARIUS_WHO (set by the runner), else $USER, else the OS user. */
export function defaultWho(): string {
  const explicit = process.env.DARIUS_WHO;
  if (explicit !== undefined && explicit !== "") return explicit;
  const fromEnv = process.env.USER;
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  return userInfo().username;
}

// --- append ------------------------------------------------------------------

function lineTime(at: string | undefined): number {
  if (at === undefined) return Date.now();
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) throw new Error(`ledger line 'at' is not a date: '${at}'`);
  return ms;
}

function buildLine(project: Project, input: LedgerLineInput): LedgerLine {
  if (input.who === "") throw new Error("ledger line needs a non-empty 'who'");
  if (input.type === "") throw new Error("ledger line needs a non-empty 'type'");
  const ms = lineTime(input.at);
  const line: LedgerLine = {
    v: 1,
    id: ulid(ms),
    at: new Date(ms).toISOString(),
    host: hostId(),
    who: input.who,
    project: project.name,
    type: input.type,
  };
  if (input.item !== undefined) line.item = input.item;
  for (const [key, value] of Object.entries(input)) {
    if (RESERVED_KEYS.has(key)) throw new Error(`ledger line payload may not set '${key}'`);
    if (key === "who" || key === "type" || key === "item" || key === "at") continue;
    if (value !== undefined) line[key] = value;
  }
  return line;
}

/** Appends `inputs` to this host's open.jsonl under one lock acquisition. */
export function appendLines(project: Project, inputs: readonly LedgerLineInput[]): LedgerLine[] {
  return project.withLock(() => {
    const lines = inputs.map((input) => buildLine(project, input));
    if (lines.length === 0) return lines;
    const dir = join(project.root, "ledger", hostId());
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, OPEN_FILE), lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
    return lines;
  });
}

/** Appends one line, filling v, id, at, host and project. Returns the line as written. */
export function appendLine(project: Project, line: LedgerLineInput): LedgerLine {
  const [written] = appendLines(project, [line]);
  if (written === undefined) throw new Error("appendLine wrote nothing");
  return written;
}

// --- read --------------------------------------------------------------------

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonString(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function requireText(object: JsonObject, key: string, where: string): string {
  const value = object[key];
  if (!isJsonString(value) || value === "") throw new Error(`${where}: '${key}' must be a non-empty string`);
  return value;
}

function decodeLine(value: JsonValue, where: string): LedgerLine {
  if (!isJsonObject(value)) throw new Error(`${where}: a ledger line must be a JSON object`);
  if (value.v !== 1) throw new Error(`${where}: unsupported ledger version ${JSON.stringify(value.v)}`);
  const id = requireText(value, "id", where);
  const at = requireText(value, "at", where);
  if (!ULID_PATTERN.test(id)) throw new Error(`${where}: '${id}' is not a ULID`);
  if (ulidTime(id) !== Date.parse(at)) throw new Error(`${where}: id time does not match at ${at}`);
  if (value.item !== undefined && !isJsonString(value.item)) throw new Error(`${where}: 'item' must be a string`);
  return {
    ...value,
    v: 1,
    id,
    at,
    host: requireText(value, "host", where),
    who: requireText(value, "who", where),
    project: requireText(value, "project", where),
    type: requireText(value, "type", where),
  };
}

/** Parses JSONL text into validated ledger lines. Throws naming `source:line` on a bad line. */
export function parseLedgerText(text: string, source: string): LedgerLine[] {
  const lines: LedgerLine[] = [];
  const rows = text.split("\n");
  for (const [index, row] of rows.entries()) {
    if (row.trim() === "") continue;
    const where = `${source}:${index + 1}`;
    let parsed: JsonValue;
    try {
      parsed = JSON.parse(row);
    } catch (cause) {
      throw new Error(`${where}: not valid JSON`, { cause });
    }
    lines.push(decodeLine(parsed, where));
  }
  return lines;
}

function ledgerRoot(project: Project): string {
  return join(project.root, "ledger");
}

function hostDirs(project: Project): string[] {
  const root = ledgerRoot(project);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

function ledgerFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name === OPEN_FILE || CHUNK_FILE.test(name))
    .toSorted();
}

/** Every line from every host dir, open and closed chunks, deduped by id, sorted by id. */
export function readLedger(project: Project): LedgerLine[] {
  const byId = new Map<string, { readonly line: LedgerLine; readonly text: string; readonly where: string }>();
  for (const host of hostDirs(project)) {
    const dir = join(ledgerRoot(project), host);
    for (const file of ledgerFiles(dir)) {
      const path = join(dir, file);
      for (const line of parseLedgerText(readFileSync(path, "utf8"), path)) {
        const text = JSON.stringify(line);
        const seen = byId.get(line.id);
        if (seen === undefined) {
          byId.set(line.id, { line, text, where: path });
          continue;
        }
        if (seen.text !== text) {
          throw new Error(`${path}: line ${line.id} differs from the line with the same id in ${seen.where}`);
        }
      }
    }
  }
  return [...byId.values()].map((entry) => entry.line).toSorted(compareById);
}

function compareById(a: LedgerLine, b: LedgerLine): number {
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** The lines about one item, e.g. "ritual/heartbeat", in ledger order. */
export function linesFor(ledger: LedgerLine[], item: string): LedgerLine[] {
  return ledger.filter((line) => line.item === item);
}

// --- chunks, for sync --------------------------------------------------------

/**
 * Renames this host's open.jsonl to `<ulid>.jsonl` under the project lock and
 * returns the new file name. Null when there is no open file; an empty one
 * is deleted.
 */
export function closeOpenChunk(project: Project): string | null {
  return project.withLock(() => {
    const dir = join(ledgerRoot(project), hostId());
    const open = join(dir, OPEN_FILE);
    const stats = statSync(open, { throwIfNoEntry: false });
    if (stats === undefined) return null;
    if (stats.size === 0) {
      unlinkSync(open);
      return null;
    }
    const name = `${ulid()}.jsonl`;
    renameSync(open, join(dir, name));
    return name;
  });
}

/** Every closed chunk on disk, all hosts, sorted by host then name. */
export function listChunks(project: Project): LedgerChunk[] {
  const chunks: LedgerChunk[] = [];
  for (const host of hostDirs(project)) {
    const dir = join(ledgerRoot(project), host);
    for (const name of ledgerFiles(dir)) {
      if (name === OPEN_FILE) continue;
      chunks.push({ host, name, path: join(dir, name) });
    }
  }
  return chunks;
}

/**
 * Stores a chunk pulled from the bucket under `ledger/<host>/<name>`. Every
 * line is validated before anything is written. Returns "exists" when the
 * same content is already there; throws when different content is.
 */
export function writeRemoteChunk(project: Project, chunk: RemoteChunk): "written" | "exists" {
  assertHost(chunk.host, "remote chunk");
  if (!CHUNK_FILE.test(chunk.name)) throw new Error(`remote chunk name '${chunk.name}' is not <ulid>.jsonl`);
  const dir = join(ledgerRoot(project), chunk.host);
  const path = join(dir, chunk.name);
  parseLedgerText(chunk.text, path);
  return project.withLock(() => {
    if (existsSync(path)) {
      if (readFileSync(path, "utf8") === chunk.text) return "exists";
      throw new Error(`${path}: already exists with different content`);
    }
    mkdirSync(dir, { recursive: true });
    const temp = `${path}.tmp-${process.pid}`;
    writeFileSync(temp, chunk.text);
    renameSync(temp, path);
    return "written";
  });
}
