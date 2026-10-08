/**
 * Which host has backed up lately (docs/backups.md, "See every host").
 *
 * Every `darius snapshot create` leaves one line in the `_global` ledger
 * (src/cli/snapshot.ts writes it). The ledger is the one thing every host
 * syncs, so any host can read every host's last backup, offline:
 *
 *   snapshot.ok      a local archive was made. `remote` says what the bucket
 *                    did (null when no bucket is set up or --no-upload).
 *   snapshot.failed  nothing was archived; `error` says why.
 *   snapshot.off     snapshots are off on purpose (`enabled = false`), so the
 *                    host is not reported as stale.
 *
 * A line never holds the key pair, a ping URL or a full endpoint URL. The
 * bucket is named by its endpoint host name only.
 *
 * `classifyBackups` is pure: lines and a clock in, one state per host out. The
 * `snapshot status --hosts` verb, the hosts card on /status and the stale
 * alert (src/core/alerts.ts) all use it, so they cannot disagree.
 */

import { existsSync } from "node:fs";

import { errorMessage } from "../runtime.ts";
import { appendLine, readLedger, type LedgerLineInput } from "./ledger.ts";
import type { JsonValue, LedgerLine } from "./model.ts";
import { projectDir } from "./paths.ts";
import { endpointHost, scrubForLedger } from "./redact.ts";
import type { SnapshotRunResult } from "./snapshot.ts";
import type { ResolvedSnapshotSettings } from "./snapshot-settings.ts";
import { GLOBAL_PROJECT, openProject } from "./store.ts";

/** A backup older than this is stale: a daily timer has missed a day and some slack. */
export const STALE_AFTER_MS = 36 * 3_600_000;
/** A host with no line of any kind for this long is silent: gone, not late. It raises no alarm. */
export const SILENT_AFTER_MS = 30 * 24 * 3_600_000;

export const SNAPSHOT_OK = "snapshot.ok";
export const SNAPSHOT_FAILED = "snapshot.failed";
export const SNAPSHOT_OFF = "snapshot.off";
const WHO = "snapshot";

export type BackupStateName = "ok" | "stale" | "failed" | "off" | "silent";

export interface BackupRemote {
  ok: boolean;
  key: string | null;
  error: string | null;
}

export interface BackupBucket {
  endpoint_host: string;
  bucket: string;
  prefix: string;
}

/** One host's backup state, from its newest snapshot lines. */
export interface BackupState {
  host: string;
  state: BackupStateName;
  /** The newest line of any type this host wrote in the ledger it was given. */
  seen_at: string;
  /** The newest snapshot line, and its type. */
  last_at: string;
  last_type: typeof SNAPSHOT_OK | typeof SNAPSHOT_FAILED | typeof SNAPSHOT_OFF;
  /** The newest `snapshot.ok`, or null when the host never made one. */
  last_ok_at: string | null;
  /** Milliseconds from `last_ok_at` to now; null without a good snapshot. */
  age_ms: number | null;
  /** True when the newest `snapshot.ok` had a bucket: the offsite copy then decides if the host is fresh. */
  needs_upload: boolean;
  /** The newest `snapshot.ok` whose bucket copy worked (`remote.ok`), or null. Only meaningful with `needs_upload`. */
  last_upload_at: string | null;
  /** Why the host is `stale` ("no upload for 40 h"); null in every other state. */
  reason: string | null;
  /** The fields of the newest `snapshot.ok` line. */
  name: string | null;
  bytes: number | null;
  files: number | null;
  store_bytes: number | null;
  darius: string | null;
  remote: BackupRemote | null;
  bucket: BackupBucket | null;
  /** The error of the newest line when it is `snapshot.failed`, else null. */
  error: string | null;
}

// --- the lines a run writes -------------------------------------------------------------------

function bucketOf(resolved: ResolvedSnapshotSettings): BackupBucket | null {
  const { remote } = resolved.settings;
  return remote === null ? null : { endpoint_host: endpointHost(remote.endpoint), bucket: remote.bucket, prefix: remote.prefix };
}

/** The addresses an error message must not repeat in full: the endpoint and the ping URL. */
function hiddenUrls(resolved: ResolvedSnapshotSettings): string[] {
  return [resolved.settings.remote?.endpoint ?? "", resolved.settings.pingUrl ?? ""].filter((url) => url !== "");
}

/**
 * The ledger line of one finished run. A run that made a local archive is
 * `snapshot.ok`, also when the bucket copy failed (that is in `remote`). A run
 * that made none is `snapshot.failed`.
 */
export function snapshotLineFor(result: SnapshotRunResult, resolved: ResolvedSnapshotSettings, version: string): LedgerLineInput {
  const hide = hiddenUrls(resolved);
  const bucket = bucketOf(resolved);
  const remote: JsonValue =
    result.remote === null ? null : { ok: result.remote.ok, key: result.remote.key, error: result.remote.error === null ? null : scrubForLedger(result.remote.error, hide) };
  const bucketJson: JsonValue = bucket === null ? null : { endpoint_host: bucket.endpoint_host, bucket: bucket.bucket, prefix: bucket.prefix };
  if (result.name === null) {
    return { who: WHO, type: SNAPSHOT_FAILED, error: scrubForLedger(result.error ?? "unknown error", hide), remote, bucket: bucketJson };
  }
  return {
    who: WHO,
    type: SNAPSHOT_OK,
    name: result.name,
    bytes: result.bytes,
    files: result.files,
    store_bytes: result.storeBytes,
    darius: version,
    remote,
    bucket: bucketJson,
  };
}

/** The line for a host that turned snapshots off on purpose. */
export function snapshotOffLine(): LedgerLineInput {
  return { who: WHO, type: SNAPSHOT_OFF };
}

// --- reading lines back -----------------------------------------------------------------------

function isRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isFlag(value: JsonValue | undefined): value is boolean {
  return typeof value === "boolean";
}

function isCount(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function stringOf(value: JsonValue | undefined): string | null {
  return isString(value) ? value : null;
}

function numberOf(value: JsonValue | undefined): number | null {
  return isCount(value) ? value : null;
}

function remoteOf(value: JsonValue | undefined): BackupRemote | null {
  if (!isRecord(value) || !isFlag(value.ok)) return null;
  return { ok: value.ok, key: stringOf(value.key), error: stringOf(value.error) };
}

function bucketFrom(value: JsonValue | undefined): BackupBucket | null {
  if (!isRecord(value)) return null;
  const host = stringOf(value.endpoint_host);
  const bucket = stringOf(value.bucket);
  return host === null || bucket === null ? null : { endpoint_host: host, bucket, prefix: stringOf(value.prefix) ?? "" };
}

function byTime(a: LedgerLine, b: LedgerLine): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

function isSnapshotType(type: string): type is BackupState["last_type"] {
  return type === SNAPSHOT_OK || type === SNAPSHOT_FAILED || type === SNAPSHOT_OFF;
}

/** `no upload for 40 h`, `no snapshot for 40 h`, or the "never" forms. `judgedAge` is the age of the line the host is judged on. */
function staleReason(needsUpload: boolean, judgedAge: number | null): string {
  const what = needsUpload ? "upload" : "snapshot";
  if (judgedAge === null) return needsUpload ? "no upload yet" : "no good snapshot yet";
  return `no ${what} for ${String(Math.floor(judgedAge / 3_600_000))} h`;
}

/** The state of one host from its lines (oldest first) and the age of its last good snapshot. */
function stateOf(host: string, lines: readonly LedgerLine[], now: number): BackupState | null {
  const snapshots = lines.filter((line) => isSnapshotType(line.type));
  const newest = snapshots.at(-1);
  const seen = lines.at(-1);
  if (newest === undefined || seen === undefined || !isSnapshotType(newest.type)) return null;
  const lastOk = snapshots.findLast((line) => line.type === SNAPSHOT_OK);
  const age = lastOk === undefined ? null : Math.max(0, now - Date.parse(lastOk.at));
  // A host with a bucket is fresh only while an upload worked inside the window; one without is judged on its local archive.
  const needsUpload = lastOk !== undefined && (remoteOf(lastOk.remote) !== null || bucketFrom(lastOk.bucket) !== null);
  const lastUpload = snapshots.findLast((line) => line.type === SNAPSHOT_OK && remoteOf(line.remote)?.ok === true);
  const judged = needsUpload ? lastUpload : lastOk;
  const judgedAge = judged === undefined ? null : Math.max(0, now - Date.parse(judged.at));
  const fresh = judgedAge !== null && judgedAge <= STALE_AFTER_MS;

  let state: BackupStateName;
  if (now - Date.parse(seen.at) > SILENT_AFTER_MS) state = "silent";
  else if (newest.type === SNAPSHOT_OFF) state = "off";
  else if (!fresh) state = "stale";
  else state = newest.type === SNAPSHOT_FAILED ? "failed" : "ok";

  return {
    host,
    state,
    seen_at: seen.at,
    last_at: newest.at,
    last_type: newest.type,
    last_ok_at: lastOk?.at ?? null,
    age_ms: age,
    needs_upload: needsUpload,
    last_upload_at: lastUpload?.at ?? null,
    reason: state === "stale" ? staleReason(needsUpload, judgedAge) : null,
    name: stringOf(lastOk?.name),
    bytes: numberOf(lastOk?.bytes),
    files: numberOf(lastOk?.files),
    store_bytes: numberOf(lastOk?.store_bytes),
    darius: stringOf(lastOk?.darius),
    remote: remoteOf(lastOk?.remote),
    bucket: bucketFrom(lastOk?.bucket),
    error: newest.type === SNAPSHOT_FAILED ? stringOf(newest.error) : null,
  };
}

/**
 * One state per host that ever wrote a snapshot line in `lines` (the `_global`
 * ledger, every host, every type). Pure. Newest good snapshot first; a host
 * with none comes last, then by name.
 *
 *   silent  the host's newest line of any type is older than SILENT_AFTER_MS
 *   off     the newest snapshot line is `snapshot.off`
 *   stale   the newest `snapshot.ok` is older than STALE_AFTER_MS, or there is none; when
 *           that line had a bucket, no `snapshot.ok` with `remote.ok` inside the window
 *           (an upload that fails every day is a stale backup)
 *   failed  the newest snapshot line is `snapshot.failed`, the last good one is fresh
 *   ok      otherwise
 *
 * A snapshot exactly STALE_AFTER_MS old is still ok.
 */
export function classifyBackups(lines: readonly LedgerLine[], now: number): BackupState[] {
  const byHost = new Map<string, LedgerLine[]>();
  for (const line of lines.toSorted(byTime)) {
    const own = byHost.get(line.host);
    if (own === undefined) byHost.set(line.host, [line]);
    else own.push(line);
  }
  const states: BackupState[] = [];
  for (const [host, own] of byHost) {
    const state = stateOf(host, own, now);
    if (state !== null) states.push(state);
  }
  return states.toSorted((a, b) => (b.last_ok_at ?? "").localeCompare(a.last_ok_at ?? "") || a.host.localeCompare(b.host));
}

/** The `_global` ledger of this host, or no lines when the project does not exist yet. */
export function readGlobalLines(): LedgerLine[] {
  if (!existsSync(projectDir(GLOBAL_PROJECT))) return [];
  return readLedger(openProject(GLOBAL_PROJECT));
}

/** The state of every host in the synced `_global` ledger, as of `now`. */
export function readBackupStates(now: number = Date.now()): BackupState[] {
  return classifyBackups(readGlobalLines(), now);
}

/**
 * Appends a snapshot line to `_global`. Returns a warning when the write
 * failed, else null: a run's exit code never depends on the ledger.
 */
export function recordSnapshotLine(line: LedgerLineInput): string | null {
  try {
    appendLine(openProject(GLOBAL_PROJECT, { create: true }), line);
    return null;
  } catch (cause) {
    return `the ${line.type} line could not be written to the _global ledger: ${errorMessage(cause)}`;
  }
}
