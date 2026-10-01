/**
 * `darius snapshot`: a dated archive of this host's store, kept in a local
 * folder, with an optional copy in an S3 bucket (docs/concept.md,
 * "Snapshots"). It exists because the store can grow to gigabytes, which a git
 * repo is the wrong place for (the git export of 0.43.0 stays for small stores).
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
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";

import { errorMessage } from "../runtime.ts";
import { findSecretNames, listStore } from "./store-scan.ts";
import type { JsonValue } from "./model.ts";
import { createS3, S3NetworkError, type S3, type S3Upload, type UploadSource } from "./s3.ts";
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

export interface SnapshotState {
  v: 1;
  /** The last run: its end, its result, and what it made. */
  last: { at: string; ok: boolean; name: string | null; error: string | null } | null;
  /** The last contact with the bucket: a run's upload or a check. `objects` is the listing at that time. */
  remote: { at: string; ok: boolean; error: string | null; objects: RemoteObject[] } | null;
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
  /** Null when no remote copy is set up or `upload` was off. */
  remote: { ok: boolean; key: string | null; error: string | null } | null;
  pruned: { local: number; remote: number };
  warnings: string[];
  error: string | null;
}

export type Bucket = S3 & S3Upload;

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
  const state: SnapshotState = { v: 1, last: null, remote: null };
  if (!isRecord(parsed)) return state;
  const last = parsed.last;
  if (isRecord(last)) {
    const at = str(last.at);
    if (at !== null) state.last = { at, ok: last.ok === true, name: str(last.name), error: str(last.error) };
  }
  const remote = parsed.remote;
  if (isRecord(remote)) {
    const at = str(remote.at);
    const objects: RemoteObject[] = [];
    if (Array.isArray(remote.objects)) {
      for (const object of remote.objects) {
        if (isRecord(object) && str(object.name) !== null) objects.push({ name: str(object.name) ?? "", bytes: count(object.bytes) });
      }
    }
    if (at !== null) state.remote = { at, ok: remote.ok === true, error: str(remote.error), objects };
  }
  return state;
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
  return { code: 1, ok: false, name: null, bytes: 0, files: 0, remote: null, pruned: { local: 0, remote: 0 }, warnings: [], error, ...extra };
}

/** Makes one snapshot, copies it to the bucket when one is set up, and applies retention. Never throws. */
export async function runSnapshot(options: SnapshotRunOptions): Promise<SnapshotRunResult> {
  const { resolved, stateDir } = options;
  const { settings } = resolved;
  const now = options.now ?? new Date();
  if (resolved.problems.length > 0) return failure(`the settings have problems: ${resolved.problems.join("; ")}`);
  if (!settings.enabled) return failure("snapshots are off (enabled = false)");
  if (!existsSync(stateDir)) return failure(`${stateDir}: there is no store to snapshot`);

  const lock = takeLock(settings.dir, now);
  if (!lock.ok) return failure(`a snapshot is already running (pid ${String(lock.holder.pid)}, since ${lock.holder.startedAt})`);
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
    remote: null,
    pruned: { local: 0, remote: 0 },
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
    writeSnapshotState(settings.dir, { ...readSnapshotState(settings.dir), remote: { at: new Date().toISOString(), ok: false, error, objects: previous?.objects ?? [] } });
  };
  if (!made.ok) {
    fail(made.error, false);
    return;
  }
  const key = `${keyPrefix(remote, options.host)}${manifest.name}`;
  const reader = await fileSource(join(settings.dir, manifest.name));
  try {
    await made.bucket.upload(key, reader.source, { contentType: "application/gzip" });
    const head = await made.bucket.head(key);
    if (head === null || head.size !== manifest.bytes) {
      fail(`the bucket holds ${head === null ? "no object" : `${String(head.size)} bytes`} after the upload, not ${String(manifest.bytes)}`, false);
      return;
    }
    manifest.uploaded = { at: new Date().toISOString(), key };
    writeJson(join(settings.dir, `${manifest.name}.json`), JSON.parse(JSON.stringify(manifest)));
    await made.bucket.put(`${key}.json`, JSON.stringify(manifest), { contentType: "application/json" });
    const pruned = await pruneBucket(made.bucket, remote, options.host, settings.keepRemote);
    result.pruned.remote = pruned.removed;
    result.remote = { ok: true, key, error: null };
    writeSnapshotState(settings.dir, { ...readSnapshotState(settings.dir), remote: { at: new Date().toISOString(), ok: true, error: null, objects: pruned.left } });
  } catch (cause) {
    fail(errorMessage(cause), cause instanceof S3NetworkError);
  } finally {
    await reader.close();
  }
}

// --- checks and deletes -----------------------------------------------------------------------

export interface RemoteCheck {
  ok: boolean;
  error: string | null;
  objects: RemoteObject[];
}

/** Lists the bucket's snapshots of this host, writes a small object and deletes it (proves read and write), and stores the listing. */
export async function checkRemote(resolved: ResolvedSnapshotSettings, host: string, bucketForTest?: Bucket): Promise<RemoteCheck> {
  const { remote, dir } = resolved.settings;
  if (remote === null) return { ok: false, error: "no remote copy is set up", objects: [] };
  const made = bucketForTest === undefined ? makeBucket(remote) : { ok: true as const, bucket: bucketForTest };
  if (!made.ok) return { ok: false, error: made.error, objects: [] };
  const probe = remote.prefix === "" ? PROBE_KEY : `${remote.prefix}/${PROBE_KEY}`;
  try {
    const objects = await listBucket(made.bucket, remote, host);
    await made.bucket.put(probe, new Uint8Array(0));
    await made.bucket.del(probe);
    saveRemote(dir, { at: new Date().toISOString(), ok: true, error: null, objects });
    return { ok: true, error: null, objects };
  } catch (cause) {
    const error = errorMessage(cause);
    saveRemote(dir, { at: new Date().toISOString(), ok: false, error, objects: readSnapshotState(dir).remote?.objects ?? [] });
    return { ok: false, error, objects: [] };
  }
}

function saveRemote(dir: string, remote: NonNullable<SnapshotState["remote"]>): void {
  try {
    writeSnapshotState(dir, { ...readSnapshotState(dir), remote });
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
  return `${result.name}: ${size}, ${String(result.files)} files, ${bucket}${pruned}`;
}
