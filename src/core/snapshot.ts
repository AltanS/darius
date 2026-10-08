/**
 * `darius snapshot`: a dated archive of this host's store, kept in a local
 * folder, with an optional copy in an S3 bucket (docs/concept.md,
 * "Snapshots"). It exists because the store can grow to gigabytes, which a git
 * repo is the wrong place for (it replaced the git export of 0.43.0).
 *
 * One snapshot is `darius-<host>-<UTC stamp>.tar.gz`, made by the system `tar`
 * from the state dir, so it restores with `tar -xzf` and nothing of darius.
 * Next to it sits `<name>.json` (a manifest with the SHA-256) and, in the
 * folder, `status.json` (what the last run did, and the bucket's listing as of
 * that run) and `lock.json` (present while a run is going).
 *
 * The config dir is never archived: it holds credentials and push keys. Before
 * it archives, the run scans the store for names that look like secrets and
 * refuses when it finds one, the same rule as the export.
 *
 * A failed upload leaves the local snapshot in place and exits 3, as sync
 * does; the next run makes a new snapshot and uploads that one. Retention runs
 * after every run: the newest `keep` stay locally, the newest `keep_remote`
 * stay in the bucket. Only names this module makes are ever deleted.
 *
 * `remote_prune = false` is the no-delete mode, for a key that may not delete
 * (docs/backups.md, "A key that cannot delete"): no path here then calls
 * DELETE on an object in the bucket. The bucket's versioning and lifecycle
 * rule keep it tidy, and `checkRemote` reports whether the key can delete and
 * whether the bucket keeps old versions.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";

import { errorMessage } from "../runtime.ts";
import { findSecretNames, listStore } from "./store-scan.ts";
import type { JsonValue } from "./model.ts";
import { createS3, S3Error, S3NetworkError, type BucketVersioning, type S3, type S3Copy, type S3Upload, type S3Versioning, type UploadSource } from "./s3.ts";
import { pingKindFor, sendPing } from "./snapshot-ping.ts";
import { readSnapshotCredentials, type ResolvedSnapshotSettings, type SnapshotRemote } from "./snapshot-settings.ts";

/** `darius-<host>-<stamp>.tar.gz`. The host id may hold dashes, so the stamp is the last part. */
const NAME_PATTERN = /^darius-([A-Za-z0-9][A-Za-z0-9._-]*)-(\d{8}T\d{6}Z)\.tar\.gz$/u;
const STATE_FILE = "status.json";
const LOCK_FILE = "lock.json";
const LOCK_MAX_AGE_MS = 12 * 3_600_000;
const PROBE_KEY = ".darius-check";

export interface SnapshotManifest {
  v: 1;
  name: string;
  host: string;
  /** When the snapshot was made. */
  at: string;
  darius: string;
  /** Files and bytes of the store the archive was made from. */
  files: number;
  storeBytes: number;
  /** The archive's size and SHA-256. */
  bytes: number;
  sha256: string;
  /** The bucket key, once the copy is verified there. */
  uploaded?: { at: string; key: string };
}

export interface RemoteObject {
  name: string;
  bytes: number;
}

/** What a DELETE of the probe object did: the key may delete, or the bucket answered 403. */
export type DeleteOutcome = "deleted" | "refused";

/** The facts of the last good `snapshot check`, and the warnings it gave. */
export interface CheckRecord {
  at: string;
  delete: DeleteOutcome;
  versioning: BucketVersioning;
  /** `remote_prune` when the check ran; the warnings depend on it. */
  remotePrune: boolean;
  warnings: string[];
}

export interface SnapshotState {
  v: 1;
  /** The last run: its end, its result, and what it made. */
  last: { at: string; ok: boolean; name: string | null; error: string | null } | null;
  /** The last contact with the bucket: a run's upload or a check. `objects` is the listing at that time. */
  remote: { at: string; ok: boolean; error: string | null; objects: RemoteObject[]; monthly?: RemoteObject[] } | null;
  /** The last check that reached the probe DELETE. A run does not change it. */
  check: CheckRecord | null;
}

export interface SnapshotRow {
  name: string;
  host: string;
  at: string;
  bytes: number;
  files: number | null;
  sha256: string | null;
  /** The archive is in the local folder. */
  local: boolean;
  /** The bucket held it at the last contact. */
  remote: boolean;
}

export type SnapshotCode = 0 | 1 | 3;

export interface SnapshotRunResult {
  /** 0 done, 1 refused or failed, 3 the snapshot is local but the bucket could not be reached. */
  code: SnapshotCode;
  ok: boolean;
  name: string | null;
  bytes: number;
  files: number;
  /** Bytes of the store the archive was made from (the manifest's storeBytes). */
  storeBytes: number;
  /** True when another run held the lock: nothing was made and nothing failed. */
  busy: boolean;
  /** Null when no remote copy is set up or `upload` was off. */
  remote: { ok: boolean; key: string | null; error: string | null } | null;
  pruned: { local: number; remote: number };
  /** The monthly copy (`keep_monthly`): its key when this run made one, and the old ones it removed. */
  monthly: { copied: string | null; pruned: number };
  warnings: string[];
  error: string | null;
}

export type Bucket = S3 & S3Upload & S3Versioning & S3Copy;

export interface SnapshotRunOptions {
  resolved: ResolvedSnapshotSettings;
  host: string;
  version: string;
  stateDir: string;
  now?: Date;
  /** False keeps the snapshot local even when a remote is set up. */
  upload?: boolean;
  /** A bucket for a test; the real one is made from the remote settings. */
  bucket?: Bucket;
  /** The wait for the dead-man ping, in milliseconds; a test shortens it. */
  pingTimeoutMs?: number;
}

// --- small helpers ----------------------------------------------------------------------

function isRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}/u, "");
}

function atOfStamp(value: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u.exec(value);
  return match === null ? value : `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z`;
}

/** The parts of a snapshot name, or null when it is not one this module makes. */
export function parseSnapshotName(name: string): { host: string; stamp: string; at: string } | null {
  const match = NAME_PATTERN.exec(name);
  const host = match?.[1];
  const time = match?.[2];
  return host === undefined || time === undefined ? null : { host, stamp: time, at: atOfStamp(time) };
}

function newestFirst<T extends { name: string }>(items: T[]): T[] {
  return items.toSorted((a, b) => (parseSnapshotName(b.name)?.stamp ?? "").localeCompare(parseSnapshotName(a.name)?.stamp ?? ""));
}

function writeJson(path: string, value: JsonValue): void {
  const temp = `${path}.${String(process.pid)}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, path);
}

function readJson(path: string): JsonValue | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function isString(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isNumber(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function str(value: JsonValue | undefined): string | null {
  return isString(value) ? value : null;
}

function count(value: JsonValue | undefined): number {
  return isNumber(value) ? value : 0;
}

/** A source over a file: the bucket client reads one part at a time, so the file never sits in memory. */
export async function fileSource(path: string): Promise<{ source: UploadSource; close(): Promise<void> }> {
  const handle = await open(path, "r");
  const { size } = await handle.stat();
  return {
    source: {
      size,
      async read(offset, length) {
        const buffer = new Uint8Array(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        if (bytesRead !== length) throw new Error(`${path}: the file changed size while it was read`);
        return buffer;
      },
    },
    close: () => handle.close(),
  };
}

function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => {
        resolve(hash.digest("hex"));
      });
  });
}

/** `tar -czf <dest> -C <root> .`. Exit 1 means a file changed while it was read: the archive is kept, with a warning. */
function runTar(root: string, dest: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", ["-czf", dest, "-C", root, "."], { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, LC_ALL: "C" } });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-400);
    });
    child.on("error", (cause) => {
      reject(new Error(`tar did not run: ${errorMessage(cause)}`));
    });
    child.on("close", (code) => {
      if (code === 0) resolve(null);
      else if (code === 1) resolve(stderr.trim() === "" ? "a file changed while it was archived" : stderr.trim());
      else reject(new Error(`tar exited ${String(code)}: ${stderr.trim()}`));
    });
  });
}

// --- state and lock ----------------------------------------------------------------------

export function readSnapshotState(dir: string): SnapshotState {
  const parsed = readJson(join(dir, STATE_FILE));
  const state: SnapshotState = { v: 1, last: null, remote: null, check: null };
  if (!isRecord(parsed)) return state;
  const last = parsed.last;
  if (isRecord(last)) {
    const at = str(last.at);
    if (at !== null) state.last = { at, ok: last.ok === true, name: str(last.name), error: str(last.error) };
  }
  const remote = parsed.remote;
  if (isRecord(remote)) {
    const at = str(remote.at);
    const objects = readObjects(remote.objects);
    if (at !== null) state.remote = { at, ok: remote.ok === true, error: str(remote.error), objects, monthly: readObjects(remote.monthly) };
  }
  state.check = readCheckRecord(parsed.check);
  return state;
}

function readObjects(value: JsonValue | undefined): RemoteObject[] {
  const objects: RemoteObject[] = [];
  if (!Array.isArray(value)) return objects;
  for (const object of value) {
    if (isRecord(object) && str(object.name) !== null) objects.push({ name: str(object.name) ?? "", bytes: count(object.bytes) });
  }
  return objects;
}

const VERSIONING_STATES: readonly BucketVersioning[] = ["enabled", "suspended", "off", "unknown"];

function readCheckRecord(value: JsonValue | undefined): CheckRecord | null {
  if (!isRecord(value)) return null;
  const at = str(value.at);
  const outcome = value.delete === "deleted" || value.delete === "refused" ? value.delete : null;
  const versioning = VERSIONING_STATES.find((state) => state === value.versioning);
  if (at === null || outcome === null || versioning === undefined) return null;
  const warnings = Array.isArray(value.warnings) ? value.warnings.filter(isString) : [];
  return { at, delete: outcome, versioning, remotePrune: value.remotePrune !== false, warnings };
}

function writeSnapshotState(dir: string, state: SnapshotState): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeJson(join(dir, STATE_FILE), JSON.parse(JSON.stringify(state)));
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return cause instanceof Error && "code" in cause && cause.code === "EPERM";
  }
}

/** The run that holds the lock, or null. A lock of a dead process, or older than 12 hours, does not count. */
export function runningSnapshot(dir: string, now: number = Date.now()): { pid: number; startedAt: string } | null {
  const parsed = readJson(join(dir, LOCK_FILE));
  if (!isRecord(parsed)) return null;
  const pid = count(parsed.pid);
  const startedAt = str(parsed.startedAt);
  if (pid === 0 || startedAt === null) return null;
  if (!pidAlive(pid) || now - Date.parse(startedAt) > LOCK_MAX_AGE_MS) return null;
  return { pid, startedAt };
}

type Lock = { ok: true; release: () => void } | { ok: false; holder: { pid: number; startedAt: string } };

function takeLock(dir: string, now: Date): Lock {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, LOCK_FILE);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(path, JSON.stringify({ pid: process.pid, startedAt: now.toISOString() }), { flag: "wx" });
      return {
        ok: true,
        release: () => {
          rmSync(path, { force: true });
        },
      };
    } catch (cause) {
      if (!(cause instanceof Error && "code" in cause && cause.code === "EEXIST")) throw cause;
      const holder = runningSnapshot(dir, now.getTime());
      if (holder !== null) return { ok: false, holder };
      rmSync(path, { force: true });
    }
  }
  throw new Error(`${path}: cannot take the lock`);
}

// --- listing ------------------------------------------------------------------------------

function readManifest(dir: string, name: string): SnapshotManifest | null {
  const parsed = readJson(join(dir, `${name}.json`));
  if (!isRecord(parsed)) return null;
  const uploaded = parsed.uploaded;
  const manifest: SnapshotManifest = {
    v: 1,
    name,
    host: str(parsed.host) ?? "",
    at: str(parsed.at) ?? "",
    darius: str(parsed.darius) ?? "",
    files: count(parsed.files),
    storeBytes: count(parsed.storeBytes),
    bytes: count(parsed.bytes),
    sha256: str(parsed.sha256) ?? "",
  };
  if (isRecord(uploaded) && str(uploaded.at) !== null && str(uploaded.key) !== null) {
    manifest.uploaded = { at: str(uploaded.at) ?? "", key: str(uploaded.key) ?? "" };
  }
  return manifest;
}

/** The archives in the local folder, newest first. Reads no archive, only names, sizes and manifests. */
export function listLocalSnapshots(dir: string): SnapshotRow[] {
  if (!existsSync(dir)) return [];
  const state = readSnapshotState(dir);
  const inBucket = new Set((state.remote?.objects ?? []).map((object) => object.name));
  const rows: SnapshotRow[] = [];
  for (const name of readdirSync(dir)) {
    const parts = parseSnapshotName(name);
    if (parts === null) continue;
    const manifest = readManifest(dir, name);
    const size = statSync(join(dir, name), { throwIfNoEntry: false })?.size ?? 0;
    rows.push({
      name,
      host: parts.host,
      at: parts.at,
      bytes: size,
      files: manifest === null ? null : manifest.files,
      sha256: manifest === null || manifest.sha256 === "" ? null : manifest.sha256,
      local: true,
      remote: inBucket.has(name),
    });
  }
  return newestFirst(rows);
}

function keyPrefix(remote: SnapshotRemote, host: string): string {
  return remote.prefix === "" ? `${host}/` : `${remote.prefix}/${host}/`;
}

async function listBucket(bucket: Bucket, remote: SnapshotRemote, host: string): Promise<RemoteObject[]> {
  const prefix = keyPrefix(remote, host);
  const objects: RemoteObject[] = [];
  for (const object of await bucket.list(prefix)) {
    const name = object.key.slice(prefix.length);
    if (parseSnapshotName(name) !== null) objects.push({ name, bytes: object.size });
  }
  return newestFirst(objects);
}

function makeBucket(remote: SnapshotRemote): { ok: true; bucket: Bucket } | { ok: false; error: string } {
  const credentials = readSnapshotCredentials();
  if (!credentials.ok) return { ok: false, error: credentials.error };
  try {
    return { ok: true, bucket: createS3(remote, credentials.credentials) };
  } catch (cause) {
    return { ok: false, error: errorMessage(cause) };
  }
}

// --- a run ---------------------------------------------------------------------------------

function pruneLocal(dir: string, host: string, keep: number): number {
  const mine = listLocalSnapshots(dir).filter((row) => row.host === host);
  let removed = 0;
  for (const row of mine.slice(keep)) {
    rmSync(join(dir, row.name), { force: true });
    rmSync(join(dir, `${row.name}.json`), { force: true });
    removed += 1;
  }
  return removed;
}

async function pruneBucket(bucket: Bucket, remote: SnapshotRemote, host: string, keep: number): Promise<{ removed: number; left: RemoteObject[] }> {
  const objects = await listBucket(bucket, remote, host);
  const prefix = keyPrefix(remote, host);
  let removed = 0;
  for (const object of objects.slice(keep)) {
    await bucket.del(`${prefix}${object.name}`);
    await bucket.del(`${prefix}${object.name}.json`);
    removed += 1;
  }
  return { removed, left: objects.slice(0, keep) };
}

function failure(error: string, extra: Partial<SnapshotRunResult> = {}): SnapshotRunResult {
  return { code: 1, ok: false, name: null, bytes: 0, files: 0, storeBytes: 0, busy: false, remote: null, pruned: { local: 0, remote: 0 }, monthly: { copied: null, pruned: 0 }, warnings: [], error, ...extra };
}

/**
 * Makes one snapshot, copies it to the bucket when one is set up, applies
 * retention, and sends the dead-man ping when `ping_url` is set (a warning
 * when it fails, never a change of the result). Never throws.
 */
export async function runSnapshot(options: SnapshotRunOptions): Promise<SnapshotRunResult> {
  const result = await runExclusive(options);
  const { pingUrl, enabled, remote } = options.resolved.settings;
  // A run refused by the lock made nothing, and a host with snapshots off is silent on purpose.
  // A run with the upload off on a host with a bucket says nothing about the bucket copy, so it is silent too.
  if (pingUrl === null || !enabled || result.busy || (remote !== null && options.upload === false)) return result;
  const warning = await sendPing(pingUrl, pingKindFor(result), { timeoutMs: options.pingTimeoutMs });
  if (warning !== null) result.warnings.push(warning);
  return result;
}

async function runExclusive(options: SnapshotRunOptions): Promise<SnapshotRunResult> {
  const { resolved, stateDir } = options;
  const { settings } = resolved;
  const now = options.now ?? new Date();
  if (resolved.problems.length > 0) return failure(`the settings have problems: ${resolved.problems.join("; ")}`);
  if (!settings.enabled) return failure("snapshots are off (enabled = false)");
  if (!existsSync(stateDir)) return failure(`${stateDir}: there is no store to snapshot`);

  const lock = takeLock(settings.dir, now);
  if (!lock.ok) return failure(`a snapshot is already running (pid ${String(lock.holder.pid)}, since ${lock.holder.startedAt})`, { busy: true });
  try {
    return await runLocked(options, now);
  } catch (cause) {
    const error = errorMessage(cause);
    recordLast(settings.dir, { at: new Date().toISOString(), ok: false, name: null, error });
    return failure(error);
  } finally {
    lock.release();
  }
}

async function runLocked(options: SnapshotRunOptions, started: Date): Promise<SnapshotRunResult> {
  const { resolved, host, version, stateDir } = options;
  const { settings } = resolved;
  const listing = listStore(stateDir);
  const secrets = findSecretNames(listing.files.map((file) => file.path));
  if (secrets.length > 0) {
    const error = `the store holds a name that looks like a secret (${secrets.slice(0, 3).join(", ")}); nothing was archived`;
    recordLast(settings.dir, { at: new Date().toISOString(), ok: false, name: null, error });
    return failure(error);
  }

  // The lock is ours, so a partial file belongs to a run that died (a restart of the web service kills a run it started).
  for (const left of readdirSync(settings.dir)) {
    if (left.startsWith(".darius-") && left.endsWith(".partial")) rmSync(join(settings.dir, left), { force: true });
  }

  const name = `darius-${host}-${stamp(started)}.tar.gz`;
  const finalPath = join(settings.dir, name);
  const partial = join(settings.dir, `.${name}.partial`);
  const warnings = listing.other.map((path) => `${path}: not a regular file, archived as it is`);
  try {
    const changed = await runTar(stateDir, partial);
    if (changed !== null) warnings.push(changed);
  } catch (cause) {
    rmSync(partial, { force: true });
    throw cause;
  }
  renameSync(partial, finalPath);
  const manifest: SnapshotManifest = {
    v: 1,
    name,
    host,
    at: started.toISOString(),
    darius: version,
    files: listing.files.length,
    storeBytes: listing.files.reduce((sum, file) => sum + file.bytes, 0),
    bytes: statSync(finalPath).size,
    sha256: await hashFile(finalPath),
  };
  writeJson(join(settings.dir, `${name}.json`), JSON.parse(JSON.stringify(manifest)));

  const result: SnapshotRunResult = {
    code: 0,
    ok: true,
    name,
    bytes: manifest.bytes,
    files: manifest.files,
    storeBytes: manifest.storeBytes,
    busy: false,
    remote: null,
    pruned: { local: 0, remote: 0 },
    monthly: { copied: null, pruned: 0 },
    warnings,
    error: null,
  };

  if (settings.remote !== null && options.upload !== false) await copyToBucket(options, settings.remote, manifest, result);
  result.pruned.local = pruneLocal(settings.dir, host, settings.keep);
  recordLast(settings.dir, { at: new Date().toISOString(), ok: result.code !== 1, name, error: result.error });
  return result;
}

function recordLast(dir: string, last: NonNullable<SnapshotState["last"]>): void {
  try {
    writeSnapshotState(dir, { ...readSnapshotState(dir), last });
  } catch {
    // The run's own result still reaches the caller; a state file that cannot be written must not hide it.
  }
}

async function copyToBucket(options: SnapshotRunOptions, remote: SnapshotRemote, manifest: SnapshotManifest, result: SnapshotRunResult): Promise<void> {
  const { settings } = options.resolved;
  const made = options.bucket === undefined ? makeBucket(remote) : { ok: true as const, bucket: options.bucket };
  const fail = (error: string, offline: boolean): void => {
    result.code = offline ? 3 : 1;
    result.ok = false;
    result.remote = { ok: false, key: null, error };
    result.error = error;
    const previous = readSnapshotState(settings.dir).remote;
    writeSnapshotState(settings.dir, { ...readSnapshotState(settings.dir), remote: { ...previous, at: new Date().toISOString(), ok: false, error, objects: previous?.objects ?? [] } });
  };
  if (!made.ok) {
    fail(made.error, false);
    return;
  }
  const key = `${keyPrefix(remote, options.host)}${manifest.name}`;
  const reader = await fileSource(join(settings.dir, manifest.name));
  const onAbortFailed = (message: string): void => {
    result.warnings.push(message);
  };
  try {
    await made.bucket.upload(key, reader.source, { contentType: "application/gzip", onAbortFailed });
    const head = await made.bucket.head(key);
    if (head === null || head.size !== manifest.bytes) {
      fail(`the bucket holds ${head === null ? "no object" : `${String(head.size)} bytes`} after the upload, not ${String(manifest.bytes)}`, false);
      return;
    }
    manifest.uploaded = { at: new Date().toISOString(), key };
    writeJson(join(settings.dir, `${manifest.name}.json`), JSON.parse(JSON.stringify(manifest)));
    await made.bucket.put(`${key}.json`, JSON.stringify(manifest), { contentType: "application/json" });
    // No-delete mode: list only. The bucket's lifecycle rule is the retention there.
    const pruned = settings.remotePrune ? await pruneBucket(made.bucket, remote, options.host, settings.keepRemote) : { removed: 0, left: await listBucket(made.bucket, remote, options.host) };
    result.pruned.remote = pruned.removed;
    result.remote = { ok: true, key, error: null };
    const monthly = await keepMonthlyCopy(made.bucket, remote, options, { manifest, key, source: reader.source }, result);
    writeSnapshotState(settings.dir, { ...readSnapshotState(settings.dir), remote: { at: new Date().toISOString(), ok: true, error: null, objects: pruned.left, monthly } });
  } catch (cause) {
    fail(errorMessage(cause), cause instanceof S3NetworkError);
  } finally {
    await reader.close();
  }
}

// --- monthly copies ----------------------------------------------------------------------------

const MONTHLY_DIR = "monthly/";
/** The largest source a CopyObject takes on AWS. */
const COPY_LIMIT_BYTES = 5 * 1024 ** 3;

function monthlyPrefix(remote: SnapshotRemote, host: string): string {
  return `${keyPrefix(remote, host)}${MONTHLY_DIR}`;
}

/** The monthly archives of this host, newest first, by plain name (`monthly/` is not part of it), and the names of the manifests beside them. */
async function listMonthlyFolder(bucket: Bucket, remote: SnapshotRemote, host: string): Promise<{ archives: RemoteObject[]; manifests: Set<string> }> {
  const prefix = monthlyPrefix(remote, host);
  const objects: RemoteObject[] = [];
  const manifests = new Set<string>();
  for (const object of await bucket.list(prefix)) {
    const name = object.key.slice(prefix.length);
    if (parseSnapshotName(name) !== null) objects.push({ name, bytes: object.size });
    else if (name.endsWith(".json")) manifests.add(name.slice(0, -".json".length));
  }
  return { archives: newestFirst(objects), manifests };
}

async function listMonthly(bucket: Bucket, remote: SnapshotRemote, host: string): Promise<RemoteObject[]> {
  return (await listMonthlyFolder(bucket, remote, host)).archives;
}

/** The month of a snapshot name, `YYYYMM` in UTC. */
function monthOf(name: string): string {
  return (parseSnapshotName(name)?.stamp ?? "").slice(0, 6);
}

/** Server-side copy; one upload from the local file when the archive is over 5 GB or the backend answers 400. */
async function placeMonthly(bucket: Bucket, from: string, to: string, run: { manifest: SnapshotManifest; source: UploadSource }, result: SnapshotRunResult): Promise<void> {
  const again = async (): Promise<void> => {
    await bucket.upload(to, run.source, { contentType: "application/gzip", onAbortFailed: (message) => result.warnings.push(message) });
  };
  if (run.manifest.bytes > COPY_LIMIT_BYTES) {
    await again();
    return;
  }
  try {
    await bucket.copy(from, to);
  } catch (cause) {
    if (!(cause instanceof S3Error && cause.status === 400)) throw cause;
    await again();
  }
}

/**
 * `keep_monthly` above 0: the first good snapshot of a UTC month is also kept
 * as `<prefix>/<host>/monthly/<name>`, with its manifest. With `remote_prune`
 * on, the monthly folder is pruned to the newest `keep_monthly`; with it off
 * nothing is deleted and the bucket's lifecycle rule for the `monthly/` folders governs.
 * A failure here is a warning: the daily copy is already safe. Returns the
 * monthly listing after the run.
 */
async function keepMonthlyCopy(
  bucket: Bucket,
  remote: SnapshotRemote,
  options: SnapshotRunOptions,
  run: { manifest: SnapshotManifest; key: string; source: UploadSource },
  result: SnapshotRunResult,
): Promise<RemoteObject[]> {
  const { keepMonthly, remotePrune } = options.resolved.settings;
  if (keepMonthly === 0) return [];
  const { host } = options;
  const prefix = monthlyPrefix(remote, host);
  try {
    const folder = await listMonthlyFolder(bucket, remote, host);
    let monthly = folder.archives;
    const month = monthOf(run.manifest.name);
    // A copy counts only with its manifest. One without (a run that stopped between the two) is redone by this run.
    if (!monthly.some((object) => monthOf(object.name) === month && folder.manifests.has(object.name))) {
      const to = `${prefix}${run.manifest.name}`;
      const same = monthly.find((object) => object.name === run.manifest.name);
      if (same?.bytes !== run.manifest.bytes) await placeMonthly(bucket, run.key, to, run, result);
      const head = await bucket.head(to);
      if (head === null || head.size !== run.manifest.bytes) throw new Error(`the bucket holds ${head === null ? "no object" : `${String(head.size)} bytes`} at ${to}, not ${String(run.manifest.bytes)}`);
      await bucket.put(`${to}.json`, JSON.stringify({ ...run.manifest, uploaded: { at: new Date().toISOString(), key: to } }), { contentType: "application/json" });
      result.monthly.copied = to;
      const halfDone = monthly.filter((object) => monthOf(object.name) === month && object.name !== run.manifest.name);
      if (remotePrune) {
        for (const object of halfDone) await bucket.del(`${prefix}${object.name}`);
      }
      const replaced = new Set(remotePrune ? halfDone.map((object) => object.name) : []);
      monthly = newestFirst([...monthly.filter((object) => object.name !== run.manifest.name && !replaced.has(object.name)), { name: run.manifest.name, bytes: run.manifest.bytes }]);
    }
    if (!remotePrune) return monthly;
    for (const object of monthly.slice(keepMonthly)) {
      await bucket.del(`${prefix}${object.name}`);
      await bucket.del(`${prefix}${object.name}.json`);
      result.monthly.pruned += 1;
    }
    return monthly.slice(0, keepMonthly);
  } catch (cause) {
    result.warnings.push(`the monthly copy failed: ${errorMessage(cause)}`);
    return readSnapshotState(options.resolved.settings.dir).remote?.monthly ?? [];
  }
}

// --- checks and deletes -----------------------------------------------------------------------

export interface RemoteCheck {
  /** False when the bucket could not be listed or written, or the probe DELETE failed with a status other than 403. */
  ok: boolean;
  error: string | null;
  objects: RemoteObject[];
  /** The probe key. It is fixed, so a key that cannot delete overwrites it on each check instead of piling up objects. */
  probe: string | null;
  /** Null when the check stopped before the DELETE. */
  delete: DeleteOutcome | null;
  /** Null when the check stopped before it asked. */
  versioning: BucketVersioning | null;
  remotePrune: boolean;
  /** What the operator should fix. A check with warnings still exits 0. */
  warnings: string[];
}

export const WARN_KEY_MAY_DELETE = "the key may delete objects. Use a key without s3:DeleteObject and s3:DeleteObjectVersion";
export const WARN_PRUNE_REFUSED = "the key cannot delete, but remote_prune is on: pruning will fail. Set remote_prune false";
const WARN_VERSIONING_UNREADABLE = "the key may not read the versioning state. Give it s3:GetBucketVersioning";

/** The warnings for the facts of a check under a `remote_prune` value. Pure, so `status` and the page can say the same. */
export function checkWarnings(remotePrune: boolean, outcome: DeleteOutcome, versioning: BucketVersioning): string[] {
  const warnings: string[] = [];
  if (!remotePrune && outcome === "deleted") warnings.push(WARN_KEY_MAY_DELETE);
  if (!remotePrune && versioning !== "enabled") warnings.push(`versioning is ${versioning}: an overwrite loses the old copy. Turn versioning on`);
  if (remotePrune && outcome === "refused") warnings.push(WARN_PRUNE_REFUSED);
  return warnings;
}

/** The last line of a check for a person: the verdict when nothing is wrong, else the count of warnings. */
export function checkVerdict(check: Pick<RemoteCheck, "remotePrune" | "warnings">): string {
  if (check.warnings.length > 0) return `${String(check.warnings.length)} ${check.warnings.length === 1 ? "warning" : "warnings"}: fix ${check.warnings.length === 1 ? "it" : "them"}, then run darius snapshot check again`;
  return check.remotePrune ? "ok: the key may delete, and darius prunes the bucket (remote_prune on)" : "ok: the key cannot delete, the bucket keeps history";
}

/** GetBucketVersioning, with a 403 read as `unknown` plus a warning: a key without that right can still back up. */
async function readVersioning(bucket: Bucket, warnings: string[]): Promise<BucketVersioning> {
  try {
    return await bucket.getBucketVersioning();
  } catch (cause) {
    if (!(cause instanceof S3Error && cause.status === 403)) throw cause;
    warnings.push(WARN_VERSIONING_UNREADABLE);
    return "unknown";
  }
}

/**
 * Lists the bucket's snapshots of this host, writes the probe object, tries to
 * delete it, and asks whether the bucket keeps old versions. A 403 on the
 * DELETE is a fact (`refused`), not a failure: the probe then stays, and the
 * next check overwrites it. Stores the listing and the facts in `status.json`.
 */
export async function checkRemote(resolved: ResolvedSnapshotSettings, host: string, bucketForTest?: Bucket): Promise<RemoteCheck> {
  const { remote, dir, remotePrune } = resolved.settings;
  const result: RemoteCheck = { ok: false, error: null, objects: [], probe: null, delete: null, versioning: null, remotePrune, warnings: [] };
  if (remote === null) return { ...result, error: "no remote copy is set up" };
  const made = bucketForTest === undefined ? makeBucket(remote) : { ok: true as const, bucket: bucketForTest };
  if (!made.ok) return { ...result, error: made.error };
  const probe = remote.prefix === "" ? PROBE_KEY : `${remote.prefix}/${PROBE_KEY}`;
  result.probe = probe;
  try {
    result.objects = await listBucket(made.bucket, remote, host);
    await made.bucket.put(probe, new Uint8Array(0));
    result.delete = await deleteProbe(made.bucket, probe);
    const extra: string[] = [];
    result.versioning = await readVersioning(made.bucket, extra);
    result.warnings = [...checkWarnings(remotePrune, result.delete, result.versioning), ...extra];
    result.ok = true;
    const at = new Date().toISOString();
    saveState(dir, {
      remote: { ...readSnapshotState(dir).remote, at, ok: true, error: null, objects: result.objects },
      check: { at, delete: result.delete, versioning: result.versioning, remotePrune, warnings: result.warnings },
    });
    return result;
  } catch (cause) {
    const error = errorMessage(cause);
    saveState(dir, { remote: { ...readSnapshotState(dir).remote, at: new Date().toISOString(), ok: false, error, objects: readSnapshotState(dir).remote?.objects ?? [] } });
    return { ...result, ok: false, error, objects: [] };
  }
}

async function deleteProbe(bucket: Bucket, probe: string): Promise<DeleteOutcome> {
  try {
    await bucket.del(probe);
    return "deleted";
  } catch (cause) {
    if (cause instanceof S3Error && cause.status === 403) return "refused";
    throw cause;
  }
}

export type RemoteListing = { ok: true; objects: RemoteObject[]; monthly: RemoteObject[] } | { ok: false; error: string; offline: boolean };

/**
 * The bucket's snapshots of this host, newest first, without a probe write
 * (`darius snapshot list --remote`). Stores the listing as the last bucket
 * contact, as checkRemote does. `offline` is true when the bucket could not
 * be reached at all (exit 3), false for any other failure.
 */
export async function listRemoteSnapshots(resolved: ResolvedSnapshotSettings, host: string, bucketForTest?: Bucket): Promise<RemoteListing> {
  const { remote, dir } = resolved.settings;
  if (remote === null) return { ok: false, error: "no remote copy is set up", offline: false };
  const made = bucketForTest === undefined ? makeBucket(remote) : { ok: true as const, bucket: bucketForTest };
  if (!made.ok) return { ok: false, error: made.error, offline: false };
  try {
    const objects = await listBucket(made.bucket, remote, host);
    const monthly = await listMonthly(made.bucket, remote, host);
    saveRemote(dir, { at: new Date().toISOString(), ok: true, error: null, objects, monthly });
    return { ok: true, objects, monthly };
  } catch (cause) {
    const error = errorMessage(cause);
    saveRemote(dir, { ...readSnapshotState(dir).remote, at: new Date().toISOString(), ok: false, error, objects: readSnapshotState(dir).remote?.objects ?? [] });
    return { ok: false, error, offline: cause instanceof S3NetworkError };
  }
}

function saveRemote(dir: string, remote: NonNullable<SnapshotState["remote"]>): void {
  saveState(dir, { remote });
}

function saveState(dir: string, change: Partial<Pick<SnapshotState, "remote" | "check">>): void {
  try {
    writeSnapshotState(dir, { ...readSnapshotState(dir), ...change });
  } catch {
    // The check's answer still reaches the caller.
  }
}

/** Deletes one local snapshot by name. Refuses any name this module does not make. */
export function deleteLocalSnapshot(dir: string, name: string): { ok: true } | { ok: false; error: string } {
  if (parseSnapshotName(name) === null) return { ok: false, error: "not a snapshot name" };
  if (!existsSync(join(dir, name))) return { ok: false, error: "no such snapshot" };
  rmSync(join(dir, name), { force: true });
  rmSync(join(dir, `${name}.json`), { force: true });
  return { ok: true };
}

/** Deletes one snapshot of this host in the bucket, and drops it from the stored listing. */
export async function deleteRemoteSnapshot(resolved: ResolvedSnapshotSettings, host: string, name: string, bucketForTest?: Bucket): Promise<{ ok: true } | { ok: false; error: string }> {
  const { remote, dir } = resolved.settings;
  const parts = parseSnapshotName(name);
  if (parts === null || parts.host !== host) return { ok: false, error: "not a snapshot of this host" };
  if (remote === null) return { ok: false, error: "no remote copy is set up" };
  if (!resolved.settings.remotePrune) return { ok: false, error: "remote_prune is off: delete in the bucket by hand" };
  const made = bucketForTest === undefined ? makeBucket(remote) : { ok: true as const, bucket: bucketForTest };
  if (!made.ok) return { ok: false, error: made.error };
  try {
    const key = `${keyPrefix(remote, host)}${name}`;
    await made.bucket.del(key);
    await made.bucket.del(`${key}.json`);
    const state = readSnapshotState(dir);
    if (state.remote !== null) saveRemote(dir, { ...state.remote, objects: state.remote.objects.filter((object) => object.name !== name) });
    return { ok: true };
  } catch (cause) {
    return { ok: false, error: errorMessage(cause) };
  }
}

/** One line for a person. */
export function describeSnapshotRun(result: SnapshotRunResult): string {
  if (result.name === null) return `snapshot failed: ${result.error ?? "unknown error"}`;
  const size = `${(result.bytes / 1_048_576).toFixed(1)} MiB`;
  const bucket = result.remote === null ? "no remote copy" : result.remote.ok ? `copied to the bucket (${result.remote.key ?? ""})` : `bucket copy failed: ${result.remote.error ?? ""}`;
  const pruned = result.pruned.local + result.pruned.remote > 0 ? `, removed ${String(result.pruned.local)} local and ${String(result.pruned.remote)} remote old ones` : "";
  const monthly = result.monthly.copied === null ? "" : `, monthly copy ${result.monthly.copied}`;
  return `${result.name}: ${size}, ${String(result.files)} files, ${bucket}${pruned}${monthly}`;
}

// --- fetch ---------------------------------------------------------------------------------------

export type FetchResult =
  | { code: 0; ok: true; name: string; bytes: number; path: string; already: boolean }
  | { code: 1 | 3; ok: false; name: string; error: string };

/**
 * Copies one snapshot and its manifest from the bucket into the local folder,
 * for `darius restore`. GET only (and a list for nothing), so it works with a
 * key that may not delete or even write. The archive's size and SHA-256 must
 * match the manifest before the file gets its final name. `host` is the
 * bucket folder; it defaults to the host in the name. `monthly/<name>` fetches
 * a monthly copy; the local file gets the plain name. Exit 3 when the bucket
 * cannot be reached.
 */
export async function fetchRemoteSnapshot(resolved: ResolvedSnapshotSettings, requested: string, host?: string, bucketForTest?: Bucket): Promise<FetchResult> {
  const { remote, dir } = resolved.settings;
  // `monthly/<name>` is a monthly copy; the file here gets the plain name.
  const monthly = requested.startsWith(MONTHLY_DIR);
  const name = monthly ? requested.slice(MONTHLY_DIR.length) : requested;
  const parts = parseSnapshotName(name);
  const fail = (error: string, code: 1 | 3 = 1): FetchResult => ({ code, ok: false, name: requested, error });
  if (parts === null) return fail("not a snapshot name (darius-<host>-<stamp>.tar.gz or monthly/<name>); darius snapshot list --remote shows them");
  if (remote === null) return fail("no remote copy is set up");
  const finalPath = join(dir, name);
  if (existsSync(finalPath) && existsSync(`${finalPath}.json`)) return { code: 0, ok: true, name, bytes: statSync(finalPath).size, path: finalPath, already: true };
  const made = bucketForTest === undefined ? makeBucket(remote) : { ok: true as const, bucket: bucketForTest };
  if (!made.ok) return fail(made.error);
  const key = `${monthly ? monthlyPrefix(remote, host ?? parts.host) : keyPrefix(remote, host ?? parts.host)}${name}`;
  try {
    const manifestObject = await made.bucket.get(`${key}.json`);
    if (manifestObject === null) return fail(`the bucket has no ${key}.json`);
    const manifest: JsonValue = JSON.parse(new TextDecoder().decode(manifestObject.body));
    if (!isRecord(manifest) || !isNumber(manifest.bytes) || !isString(manifest.sha256)) return fail(`${key}.json is not a snapshot manifest`);
    const archive = await made.bucket.get(key);
    if (archive === null) return fail(`the bucket has no ${key}`);
    if (archive.body.length !== manifest.bytes) return fail(`the bucket's ${name} has ${String(archive.body.length)} bytes, the manifest says ${String(manifest.bytes)}`);
    const sha = createHash("sha256").update(archive.body).digest("hex");
    if (sha !== manifest.sha256) return fail(`the bucket's ${name} has SHA-256 ${sha}, the manifest says ${manifest.sha256}`);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const partial = join(dir, `.${name}.partial`);
    writeFileSync(partial, archive.body);
    renameSync(partial, finalPath);
    writeJson(`${finalPath}.json`, manifest);
    return { code: 0, ok: true, name, bytes: archive.body.length, path: finalPath, already: false };
  } catch (cause) {
    return fail(errorMessage(cause), cause instanceof S3NetworkError ? 3 : 1);
  }
}
