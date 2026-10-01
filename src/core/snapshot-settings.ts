/**
 * The settings of the local snapshots and their optional S3 copy
 * (docs/concept.md, "Snapshots").
 *
 * Four layers set each value. The first one that holds a valid value wins:
 *
 *   1. the environment, `DARIUS_SNAPSHOT_<KEY>`, for example `DARIUS_SNAPSHOT_KEEP`
 *   2. the dashboard's file, `<configDir>/snapshot.json`
 *   3. `[snapshot]` in config.toml
 *   4. the default
 *
 * The environment is the top layer on purpose: a host started with a value in
 * its unit or `web.env` keeps it, and the dashboard shows the field as locked.
 * Every value remembers its layer, so the page can say where it came from.
 *
 * Keys: `enabled`, `dir`, `keep` (local snapshots), `keep_remote`, and the
 * remote copy: `endpoint`, `bucket`, `region`, `prefix`, `path_style`,
 * `allow_http`, `sse`. The copy is on when `endpoint` and `bucket` are both set.
 *
 * Secrets are not settings. The access key pair comes from
 * `DARIUS_SNAPSHOT_ACCESS_KEY_ID` and `DARIUS_SNAPSHOT_SECRET_ACCESS_KEY`, else
 * from `<configDir>/snapshot-credentials` (the AWS-ini file of
 * src/core/credentials.ts, mode 0600). The page can write that file and never
 * reads it back.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

import { errorMessage } from "../runtime.ts";
import { checkEndpointAllowed, loadConfigIfPresent } from "./config.ts";
import { loadCredentials, type Credentials } from "./credentials.ts";
import type { JsonValue } from "./model.ts";
import { configDir, stateDir } from "./paths.ts";
import type { RemoteConfig } from "./s3.ts";
import type { TomlValue } from "./toml.ts";

export const SNAPSHOT_KEYS = ["enabled", "dir", "keep", "keep_remote", "endpoint", "bucket", "region", "prefix", "path_style", "allow_http", "sse"] as const;

export type SnapshotKey = (typeof SNAPSHOT_KEYS)[number];
export type SnapshotValue = string | number | boolean;
/** What a layer may hold before it is checked: the TOML subset, or null (clear). */
export type RawSetting = TomlValue | null;
/** Where a value came from; `env` wins, `default` is the last resort. */
export type SettingSource = "env" | "file" | "config" | "default";
/** The values of some keys, as checked. */
export type SnapshotValues = Map<SnapshotKey, SnapshotValue>;

export const DEFAULT_SNAPSHOT_DIR = "~/.local/share/darius-snapshots";
export const MAX_KEEP = 3650;

const BOOLEAN_KEYS: ReadonlySet<SnapshotKey> = new Set(["enabled", "path_style", "allow_http", "sse"]);
const INTEGER_KEYS: ReadonlySet<SnapshotKey> = new Set(["keep", "keep_remote"]);

const DEFAULTS = new Map<SnapshotKey, SnapshotValue>([
  ["enabled", true],
  ["dir", DEFAULT_SNAPSHOT_DIR],
  ["keep", 7],
  ["keep_remote", 30],
  ["endpoint", ""],
  ["bucket", ""],
  ["region", "us-east-1"],
  ["prefix", "darius"],
  ["path_style", true],
  ["allow_http", false],
  ["sse", false],
]);

const FILE_NAME = "snapshot.json";
export const CREDENTIALS_FILE = "snapshot-credentials";
const PREFIX_PATTERN = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/u;
const BUCKET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{1,61}[A-Za-z0-9]$/u;
const REGION_PATTERN = /^[A-Za-z0-9-]{1,32}$/u;

export function isSnapshotKey(name: string): name is SnapshotKey {
  return SNAPSHOT_KEYS.some((key) => key === name);
}

function isString(value: RawSetting | undefined): value is string {
  return typeof value === "string";
}

function isBoolean(value: RawSetting | undefined): value is boolean {
  return typeof value === "boolean";
}

function isNumber(value: RawSetting | undefined): value is number {
  return typeof value === "number";
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

export function snapshotFilePath(): string {
  return join(configDir(), FILE_NAME);
}

export function snapshotCredentialsPath(): string {
  return join(configDir(), CREDENTIALS_FILE);
}

/** The environment variable that sets a key: `DARIUS_SNAPSHOT_KEEP_REMOTE`. */
export function snapshotEnvName(key: SnapshotKey): string {
  return `DARIUS_SNAPSHOT_${key.toUpperCase()}`;
}

// --- one value, from text or from JSON -----------------------------------------------

export type Coerced = { ok: true; value: SnapshotValue } | { ok: false; error: string };

function coerceBoolean(key: SnapshotKey, raw: RawSetting | undefined): Coerced {
  if (isBoolean(raw)) return { ok: true, value: raw };
  const word = isString(raw) ? raw.trim().toLowerCase() : "";
  if (["1", "true", "yes", "on"].includes(word)) return { ok: true, value: true };
  if (["0", "false", "no", "off"].includes(word)) return { ok: true, value: false };
  return { ok: false, error: `${key} must be true or false` };
}

function coerceInteger(key: SnapshotKey, raw: RawSetting | undefined): Coerced {
  const number = isNumber(raw) ? raw : isString(raw) && /^\d{1,5}$/u.test(raw.trim()) ? Number(raw.trim()) : Number.NaN;
  if (!Number.isInteger(number) || number < 1 || number > MAX_KEEP) return { ok: false, error: `${key} must be a whole number from 1 to ${String(MAX_KEEP)}` };
  return { ok: true, value: number };
}

function coerceEndpoint(text: string): Coerced {
  if (text === "") return { ok: true, value: text };
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "endpoint must start with https:// or http://" };
    if (url.search !== "" || url.hash !== "" || url.username !== "") return { ok: false, error: "endpoint must be a plain address" };
    return { ok: true, value: text };
  } catch {
    return { ok: false, error: "endpoint is not a valid URL" };
  }
}

function coerceText(key: SnapshotKey, text: string): Coerced {
  if (text.length > 300 || /[\0\r\n]/u.test(text)) return { ok: false, error: `${key} is too long or has a control character` };
  if (key === "prefix") {
    const prefix = text.replace(/^\/+|\/+$/gu, "");
    const bad = prefix !== "" && (!PREFIX_PATTERN.test(prefix) || prefix.split("/").some((part) => part === "." || part === ".."));
    return bad ? { ok: false, error: "prefix may hold letters, digits, . _ - and / between names" } : { ok: true, value: prefix };
  }
  if (key === "bucket" && text !== "" && !BUCKET_PATTERN.test(text)) return { ok: false, error: "bucket is not a valid bucket name" };
  if (key === "region" && !REGION_PATTERN.test(text)) return { ok: false, error: "region is not a valid region name" };
  if (key === "endpoint") return coerceEndpoint(text);
  if (key === "dir" && text === "") return { ok: false, error: "dir is empty" };
  return { ok: true, value: text };
}

/** A checked value for `key`, or a message. Text from the environment, TOML and JSON from the page all come here. */
export function coerceSnapshotValue(key: SnapshotKey, raw: RawSetting | undefined): Coerced {
  if (BOOLEAN_KEYS.has(key)) return coerceBoolean(key, raw);
  if (INTEGER_KEYS.has(key)) return coerceInteger(key, raw);
  return isString(raw) ? coerceText(key, raw.trim()) : { ok: false, error: `${key} must be text` };
}

// --- the dashboard's file ---------------------------------------------------------------

function isRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRaw(value: JsonValue): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/** The values the dashboard saved. A missing or unreadable file is no values. Invalid entries are dropped. */
export function readSnapshotFile(): SnapshotValues {
  const found: SnapshotValues = new Map();
  const file = snapshotFilePath();
  if (!existsSync(file)) return found;
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return found;
  }
  const values = isRecord(parsed) ? parsed.values : undefined;
  if (!isRecord(values)) return found;
  for (const [name, raw] of Object.entries(values)) {
    if (!isSnapshotKey(name) || !isRaw(raw)) continue;
    const checked = coerceSnapshotValue(name, raw);
    if (checked.ok) found.set(name, checked.value);
  }
  return found;
}

/** Writes the whole file, atomically, mode 0600. An empty map removes it. */
export function writeSnapshotFile(values: SnapshotValues): void {
  const file = snapshotFilePath();
  if (values.size === 0) {
    rmSync(file, { force: true });
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${String(process.pid)}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ v: 1, values: Object.fromEntries(values) }, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, file);
}

// --- the credentials file ---------------------------------------------------------------

/** Writes the key pair to `<configDir>/snapshot-credentials`, mode 0600, atomically. Never echoes a value. */
export function writeSnapshotCredentials(accessKeyId: string, secretAccessKey: string): void {
  const id = accessKeyId.trim();
  const secret = secretAccessKey.trim();
  if (id === "" || secret === "") throw new Error("both the access key id and the secret key are needed");
  if (/[\s\0]/u.test(id) || /[\0\r\n]/u.test(secret)) throw new Error("a key has a space or a control character");
  const file = snapshotCredentialsPath();
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${String(process.pid)}.tmp`;
  writeFileSync(temp, `[default]\naws_access_key_id = ${id}\naws_secret_access_key = ${secret}\n`, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, file);
}

export function clearSnapshotCredentials(): void {
  rmSync(snapshotCredentialsPath(), { force: true });
}

export type CredentialsSource = "env" | "file" | "none";

/** Where the key pair would come from, without reading any secret. */
export function credentialsSource(env: NodeJS.ProcessEnv = process.env): CredentialsSource {
  const id = env.DARIUS_SNAPSHOT_ACCESS_KEY_ID ?? "";
  const secret = env.DARIUS_SNAPSHOT_SECRET_ACCESS_KEY ?? "";
  if (id !== "" && secret !== "") return "env";
  return existsSync(snapshotCredentialsPath()) ? "file" : "none";
}

/** The key pair, or an error message. The message never holds a key value. */
export function readSnapshotCredentials(env: NodeJS.ProcessEnv = process.env): { ok: true; credentials: Credentials } | { ok: false; error: string } {
  const source = credentialsSource(env);
  if (source === "env") {
    return { ok: true, credentials: { accessKeyId: env.DARIUS_SNAPSHOT_ACCESS_KEY_ID ?? "", secretAccessKey: env.DARIUS_SNAPSHOT_SECRET_ACCESS_KEY ?? "" } };
  }
  if (source === "none") return { ok: false, error: "no access key: set DARIUS_SNAPSHOT_ACCESS_KEY_ID and DARIUS_SNAPSHOT_SECRET_ACCESS_KEY, or save a key pair on the status page" };
  try {
    return { ok: true, credentials: loadCredentials(snapshotCredentialsPath()) };
  } catch (cause) {
    return { ok: false, error: errorMessage(cause) };
  }
}

// --- the merge ----------------------------------------------------------------------------

export interface SnapshotRemote extends RemoteConfig {
  prefix: string;
}

export interface SnapshotSettings {
  enabled: boolean;
  /** The folder of the local snapshots, `~` expanded. */
  dir: string;
  /** Local snapshots to keep. */
  keep: number;
  /** Snapshots to keep in the bucket. */
  keepRemote: number;
  /** Null when no endpoint and bucket are set, or when they are refused (see `problems`). */
  remote: SnapshotRemote | null;
}

export interface ResolvedSnapshotSettings {
  settings: SnapshotSettings;
  /** The value of every key, `dir` as written (before `~` expansion). */
  values: ReadonlyMap<SnapshotKey, SnapshotValue>;
  sources: ReadonlyMap<SnapshotKey, SettingSource>;
  /** Layers that held a value this code refused, and other things the operator must fix. A run refuses while any exist. */
  problems: string[];
}

export interface ResolveInput {
  env?: NodeJS.ProcessEnv;
  /** `[snapshot]` of config.toml; read from the config when absent. */
  config?: Readonly<Record<string, TomlValue>>;
  /** The dashboard's values; read from `snapshot.json` when absent. */
  file?: SnapshotValues;
  stateDir?: string;
  configDir?: string;
}

function readConfigTable(): Readonly<Record<string, TomlValue>> {
  try {
    return loadConfigIfPresent()?.snapshot ?? {};
  } catch {
    // A broken config.toml is reported by every other command; the snapshot layers still work without it.
    return {};
  }
}

function under(parent: string, child: string): boolean {
  const a = resolve(parent);
  const b = resolve(child);
  return b === a || b.startsWith(`${a}${sep}`);
}

function textOf(values: ReadonlyMap<SnapshotKey, SnapshotValue>, key: SnapshotKey): string {
  return String(values.get(key) ?? "");
}

function remoteOf(values: ReadonlyMap<SnapshotKey, SnapshotValue>, problems: string[]): SnapshotRemote | null {
  const endpoint = textOf(values, "endpoint");
  const bucket = textOf(values, "bucket");
  if (endpoint === "" && bucket === "") return null;
  if (endpoint === "" || bucket === "") {
    problems.push("the remote copy needs both an endpoint and a bucket");
    return null;
  }
  const allowHttp = values.get("allow_http") === true;
  try {
    checkEndpointAllowed(endpoint, allowHttp, "snapshot settings");
  } catch (cause) {
    problems.push(errorMessage(cause).replace(/^snapshot settings: /u, ""));
    return null;
  }
  return {
    endpoint,
    bucket,
    region: textOf(values, "region"),
    path_style: values.get("path_style") === true,
    allow_http: allowHttp,
    sse: values.get("sse") === true,
    credentials: snapshotCredentialsPath(),
    prefix: textOf(values, "prefix"),
  };
}

/** The merged settings and where each value came from. Never throws. */
export function resolveSnapshotSettings(input: ResolveInput = {}): ResolvedSnapshotSettings {
  const env = input.env ?? process.env;
  const table = input.config ?? readConfigTable();
  const file = input.file ?? readSnapshotFile();
  const problems: string[] = [];
  const values: SnapshotValues = new Map(DEFAULTS);
  const sources = new Map<SnapshotKey, SettingSource>(SNAPSHOT_KEYS.map((key) => [key, "default"]));

  for (const key of Object.keys(table)) {
    if (!isSnapshotKey(key)) problems.push(`config.toml [snapshot] has an unknown key "${key}"`);
  }
  for (const key of SNAPSHOT_KEYS) {
    const fromEnv = env[snapshotEnvName(key)];
    const layers: Array<[SettingSource, RawSetting | undefined, string]> = [
      ["env", fromEnv === "" ? undefined : fromEnv, snapshotEnvName(key)],
      ["file", file.get(key), "the status page"],
      ["config", table[key], "config.toml [snapshot]"],
    ];
    for (const [source, raw, where] of layers) {
      if (raw === undefined) continue;
      const checked = coerceSnapshotValue(key, raw);
      if (checked.ok) {
        values.set(key, checked.value);
        sources.set(key, source);
        break;
      }
      problems.push(`${where}: ${checked.error}`);
    }
  }

  const dir = expandHome(textOf(values, "dir"));
  const state = input.stateDir ?? stateDir();
  const config = input.configDir ?? configDir();
  if (under(state, dir) || under(dir, state) || under(config, dir) || under(dir, config)) {
    problems.push(`dir ${dir} overlaps the store or the config folder; a snapshot must live outside both`);
  }
  const remote = remoteOf(values, problems);

  return {
    settings: { enabled: values.get("enabled") === true, dir, keep: Number(values.get("keep")), keepRemote: Number(values.get("keep_remote")), remote },
    values,
    sources,
    problems,
  };
}

/**
 * Checks a save from the page. Keys set by the environment are refused (the page cannot
 * override them). `null` clears a key from the file; the key then falls back to config.toml or the default.
 * Returns the whole new file content, or the errors. Writes nothing.
 */
export function planSnapshotSave(
  input: ReadonlyMap<string, RawSetting>,
  current: SnapshotValues,
  env: NodeJS.ProcessEnv = process.env,
): { ok: true; values: SnapshotValues } | { ok: false; errors: string[] } {
  const next: SnapshotValues = new Map(current);
  const errors: string[] = [];
  for (const [name, raw] of input) {
    if (!isSnapshotKey(name)) {
      errors.push(`unknown setting "${name}"`);
      continue;
    }
    const locked = env[snapshotEnvName(name)];
    if (locked !== undefined && locked !== "") {
      errors.push(`${name} is set by ${snapshotEnvName(name)}; change it where the service starts`);
      continue;
    }
    if (raw === null) {
      next.delete(name);
      continue;
    }
    const checked = coerceSnapshotValue(name, raw);
    if (checked.ok) next.set(name, checked.value);
    else errors.push(checked.error);
  }
  if (errors.length > 0) return { ok: false, errors };
  // A problem in a layer this save does not touch (config.toml, the environment) is not the page's to fix.
  const own = resolveSnapshotSettings({ env, file: next }).problems.filter((problem) => !problem.startsWith("config.toml") && !problem.startsWith("DARIUS_SNAPSHOT_"));
  if (own.length > 0) return { ok: false, errors: own };
  return { ok: true, values: next };
}
