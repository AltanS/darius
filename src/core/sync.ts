/**
 * Sync one local project store with the bucket (docs/concept.md, "Storage and
 * sync"; docs/plan-tonight.md, "Sync (v1, as small as it gets)").
 *
 * Bucket keys, all under `<project>/`:
 *
 *   ledger/<host>/<ulid>.jsonl   immutable chunk, PUT If-None-Match:*
 *   blobs/<sha256>               immutable blob, PUT If-None-Match:*
 *   items/<kind dir>/<slug>.md   item file, PUT under the project lease. The
 *                                kind dir mirrors the local store: `rituals`,
 *                                `vigils`, `profiles`.
 *   manifest.json                {v:1, items:{"ritual/<slug>":{sha,updated}}},
 *                                PUT under the lease, always after the items
 *   lease.json                   {holder,host,pid,expires}, 60 s, If-None-Match:*
 *   compat.json                  {v:1,compat,min_version,host,at}, the floor
 *                                (0.126.0), PUT under the lease
 *
 * One sync, in order:
 *
 *   0. Read the compat floor (see "Compat floor"). A floor above this
 *      binary's `SYNC_COMPAT` ends the sync with `skipped:
 *      "darius-outdated"` before anything is pulled or pushed. Otherwise,
 *      for a sync that pushes, this host's `host.version` line is appended
 *      when its newest one is missing or names another version.
 *   1. Pull chunks. Every listed chunk not in `sync.json.seen` is fetched and
 *      stored under `ledger/<its host>/`. Blobs its lines reference are
 *      fetched EAGERLY (see "Blob references"), then the chunk is marked seen.
 *      A crash before the mark only means the next sync fetches it again,
 *      which is a no-op.
 *   2. Push chunks. This host's `open.jsonl` is closed into `<ulid>.jsonl`.
 *      Every own chunk not yet seen is pushed: its referenced blobs first,
 *      then the chunk. A 412 on either means it is already there. The chunk
 *      is marked seen only after its PUT, so a crash re-pushes (412) next time.
 *   3. Take the lease. Held and fresh: stop with `skipped: "lease-held"`.
 *      Held but expired, or held by a dead process of this same host: delete
 *      and try once more.
 *   4. Reconcile items against the manifest read UNDER the lease, using
 *      `sync.json.base` (the sha both sides last agreed on):
 *        local == remote          nothing to do
 *        only remote changed      write it locally
 *        only local changed       push it
 *        both changed             the newer `updated` wins (tie: the larger
 *                                 sha, so every host picks the same winner);
 *                                 the loser's text goes to `blobs/` and a
 *                                 `conflict{sha_lost,sha_won}` line is appended
 *   5. Push the ledger again, so the conflict and `item.changed` lines of
 *      step 4 and the blobs they name land before the manifest does.
 *   6. PUT changed items, then `manifest.json`. Only then is `base` advanced.
 *      Then, when the floor read under the lease is below `SYNC_COMPAT`,
 *      raise it to `SYNC_COMPAT`.
 *   7. Release the lease.
 *
 * Steps 1 and 2 run without the lease: chunks and blobs never overwrite, so
 * they cannot race. Items are read and written only under the lease, so the
 * manifest a host compares against cannot change under it.
 *
 * Crash safety. Every object is written in one PUT, so a killed process
 * leaves no partial object. It can leave (a) a closed local chunk not yet
 * pushed: step 2 pushes it next time; (b) item objects newer than the
 * manifest: the next holder that fetches such an item uses the object it
 * actually got and rewrites the manifest to match; (c) a lease: it expires
 * after 60 s, and a lease whose holder is a dead process on this host is
 * taken over at once.
 *
 * Blob references. A ledger payload names a blob with a key that ends in
 * `_sha` (`findings_sha`, `output_sha`) or is `sha_before` or `sha_lost`, at
 * any depth (a sweep's `checks[]` entries included). `sha_after` names an
 * item version, not a blob, and is skipped. Pull is eager: every blob a new
 * chunk names is fetched with the chunk, at most 8 requests in flight. That
 * keeps every read offline-safe and is cheap at tonight's sizes. A blob a
 * line names but nobody has is a real error, never a skip: push order
 * guarantees the blob reaches the bucket before the chunk that names it.
 *
 * Offline. An `S3NetworkError` anywhere ends the sync with `skipped:
 * "offline"`. Whatever was already done stays done and is recorded.
 *
 * Compat floor (0.126.0). `SYNC_COMPAT` is the bucket format this binary
 * reads and writes. It is not the darius version: it is raised by hand only
 * in a release whose writes an older binary would misread. `compat.json`
 * holds the highest compat that synced the project. Absent means 0. It is
 * read twice: before step 1, where a higher floor refuses the whole sync,
 * and under the lease before step 4, where a higher floor (raised by a host
 * that synced in between) skips the items, and a lower one is raised at the
 * end of step 6. So only a host that completed a full sync raises the floor,
 * and a floor never goes down. A read that fails is handled like any other
 * bucket read: a network error is "offline", any other error throws. Neither
 * counts as compat 0. A pull-only sync is refused like a full one and never
 * raises. Binaries from before 0.126.0 do not know the object and ignore it.
 *
 * Host version (0.126.0). A sync that pushes appends one `host.version` line
 * `{version, compat}` when this host's newest own one is missing or names
 * another version: one line per version change, never one per sync.
 * `darius doctor` compares the newest line per host
 * (src/core/host-versions.ts).
 *
 * Reseed (`opts.reseed`) refills a bucket that lost its objects, from the one
 * host that holds a full local copy. It is a full sync whose push step is
 * complete instead of incremental: after step 1, every local blob and every
 * closed chunk of every host dir is PUT with If-None-Match, with no `seen`
 * filter and no host filter. A 412 means present and is not counted, so a
 * second reseed reports zero pushes and a bucket that is not empty loses
 * nothing. Steps 2 to 7 then run as usual, so items and the manifest follow the
 * normal three-way rule. A reseed does not recreate another host's
 * `open.jsonl` lines (they were never in the bucket) and does not touch the
 * lease except for the normal take and release.
 *
 * Pull-only (`opts.pullOnly`) runs step 1 and the "only remote changed" part
 * of step 4, without the lease and without writing to the bucket. Items
 * changed on both sides wait for a full sync.
 *
 * `sync.json` (owned here, never read by the store):
 *   {"v":1,"seen":["<host>/<ulid>.jsonl",...],"base":{"ritual/<slug>":"<sha>"},"last_sync":"<iso>"}
 * Saves merge `seen` with what is on disk, under the project lock.
 */

import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { VERSION } from "../version.ts";
import type { Config } from "./config.ts";
import { takeOverBucketLease } from "./lease.ts";
import { appendLine, closeOpenChunk, hostId, listChunks, parseLedgerText, readHostLines, writeRemoteChunk } from "./ledger.ts";
import type { JsonValue, Kind } from "./model.ts";
import { S3NetworkError } from "./s3.ts";
import type { S3 } from "./s3.ts";
import { decodeItem, getBlob, itemRef, listBlobs, putBlob, readItemText, sha256Hex, writeItemText } from "./store.ts";
import type { Project } from "./store.ts";

/**
 * The bucket format this binary reads and writes (file header, "Compat
 * floor"). Raise it by hand, and set `SYNC_COMPAT_SINCE` to that release,
 * only in a release whose bucket writes an older binary would misread. Two
 * hosts with the same compat sync normally whatever their versions.
 */
export const SYNC_COMPAT = 1;
/** The first darius release with `SYNC_COMPAT`: `min_version` of a floor this binary raises. */
export const SYNC_COMPAT_SINCE = "0.126.0";
/** The ledger line a sync appends when this host's darius version changed. */
export const HOST_VERSION_TYPE = "host.version";

/** A binary's compat and the release that brought it. Tests inject a lower one. */
export interface SyncCompat {
  readonly compat: number;
  readonly minVersion: string;
}

/** What `compat.json` says. Absent in the bucket reads as compat 0. */
export interface CompatFloor {
  compat: number;
  minVersion?: string;
  host?: string;
  at?: string;
}

/** Why a sync refused: the bucket's floor is above this binary's compat. */
export interface OutdatedFloor {
  bucketCompat: number;
  ownCompat: number;
  /** The release to update to; absent when the floor did not say. */
  minVersion?: string;
  /** The host that raised the floor, when it said. */
  raisedBy?: string;
}

export type CompatDecision = "refuse" | "raise" | "same";

/** What a sync does about the bucket's floor. Pure. Absent is compat 0. */
export function decideCompat(bucket: number, own: number): CompatDecision {
  if (bucket > own) return "refuse";
  return bucket < own ? "raise" : "same";
}

/** The one line `darius sync` and run-due print for a refused sync. */
export function outdatedLine(project: string, outdated: OutdatedFloor): string {
  const needs = outdated.minVersion === undefined ? `a darius with sync compat ${String(outdated.bucketCompat)}` : `darius ${outdated.minVersion} or newer`;
  const by = outdated.raisedBy === undefined ? "" : `, raised by ${outdated.raisedBy}`;
  return `${project}: the bucket needs ${needs} (sync compat ${String(outdated.bucketCompat)}${by}); this host runs ${VERSION} (compat ${String(outdated.ownCompat)}) and does not sync. Update it: darius update`;
}

export interface SyncReport {
  project: string;
  pulledChunks: number;
  pushedChunks: number;
  itemsPulled: number;
  itemsPushed: number;
  conflicts: string[];
  skipped?: "offline" | "lease-held" | "darius-outdated";
  /** Why the sync refused, when `skipped` is "darius-outdated" (0.126.0). */
  outdated?: OutdatedFloor;
  /** The compat this sync raised the bucket's floor to (0.126.0). */
  compatRaised?: number;
  /** True when this sync appended this host's `host.version` line (0.126.0). */
  hostVersionNoted?: boolean;
  /** Blobs fetched from the bucket. Beyond the plan's contract. */
  blobsPulled: number;
  /** Blobs this sync created in the bucket (a 412 is not counted). Beyond the plan's contract. */
  blobsPushed: number;
  /** Who holds the lease, when `skipped` is "lease-held". */
  leaseHolder?: string;
  /** True when this run was a reseed (see the file header). */
  reseed?: boolean;
}

export interface SyncOptions {
  /** Pull chunks, blobs and remote-only item changes; write nothing to the bucket. */
  pullOnly?: boolean;
  /** Push every local chunk of every host and every local blob, If-None-Match, then sync as usual. Not with `pullOnly`. */
  reseed?: boolean;
  /** This binary's compat; tests inject a lower one. Absent means `SYNC_COMPAT` since `SYNC_COMPAT_SINCE`. */
  compat?: SyncCompat;
}

/** The `who` of every line sync appends (pulled item versions, conflicts). */
export const SYNC_WHO = "sync";
export const LEASE_TTL_MS = 60_000;

const BLOB_CONCURRENCY = 8;
const SYNC_FILE = "sync.json";
const KINDS: readonly Kind[] = ["ritual", "vigil", "profile"];
const KIND_DIRS = { ritual: "rituals", vigil: "vigils", profile: "profiles" } as const satisfies Record<Kind, string>;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const CHUNK_KEY = /^([A-Za-z0-9][A-Za-z0-9._-]{0,62})\/([0-9A-HJKMNP-TV-Z]{26}\.jsonl)$/u;
const BLOB_REF_KEYS: ReadonlySet<string> = new Set(["sha_before", "sha_lost"]);
const JSON_CONTENT = "application/json";
const MARKDOWN_CONTENT = "text/markdown; charset=utf-8";
const JSONL_CONTENT = "application/x-ndjson";

const decoder = new TextDecoder("utf-8", { fatal: true });

interface SyncState {
  readonly seen: Set<string>;
  readonly base: Map<string, string>;
  lastSync?: string;
}

export interface ManifestEntry {
  readonly sha: string;
  readonly updated: string;
}

type Manifest = Map<string, ManifestEntry>;

interface Lease {
  readonly holder: string;
  readonly host: string;
  readonly pid: number;
  readonly expires: string;
}

interface SyncContext {
  readonly project: Project;
  readonly s3: S3;
  readonly host: string;
  readonly prefix: string;
  readonly state: SyncState;
  readonly report: SyncReport;
  readonly compat: SyncCompat;
}

interface ItemAddress {
  readonly kind: Kind;
  readonly slug: string;
}

type ItemAction = "none" | "same" | "pull" | "push" | "conflict";

interface ItemShas {
  readonly localSha: string | null;
  readonly baseSha: string | null;
  readonly remoteSha: string | null;
}

// --- small helpers -----------------------------------------------------------

function isJsonRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isJsonInteger(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function parseJson(text: string, where: string): JsonValue {
  try {
    const parsed: JsonValue = JSON.parse(text);
    return parsed;
  } catch (cause) {
    throw new Error(`${where}: not valid JSON`, { cause });
  }
}

function writeFileAtomic(path: string, content: string): void {
  const temp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`;
  writeFileSync(temp, content);
  try {
    renameSync(temp, path);
  } catch (cause) {
    if (existsSync(temp)) unlinkSync(temp);
    throw cause;
  }
}

function textOf(body: Uint8Array, where: string): string {
  try {
    return decoder.decode(body);
  } catch (cause) {
    throw new Error(`${where}: not valid UTF-8`, { cause });
  }
}

/** Runs `fn` over `items` with at most `limit` calls in flight. */
async function forEachLimited<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      if (item !== undefined) await fn(item);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
}

/** Every blob sha a ledger line names (see the file header, "Blob references"). */
function collectBlobRefs(value: JsonValue | undefined, key: string, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectBlobRefs(entry, key, into);
    return;
  }
  if (isJsonRecord(value)) {
    for (const [childKey, child] of Object.entries(value)) collectBlobRefs(child, childKey, into);
    return;
  }
  if (!isJsonText(value)) return;
  const isRef = key.endsWith("_sha") || BLOB_REF_KEYS.has(key);
  if (isRef && SHA256_HEX.test(value)) into.add(value);
}

function blobRefsOf(text: string, source: string): Set<string> {
  const refs = new Set<string>();
  for (const line of parseLedgerText(text, source)) {
    for (const [key, value] of Object.entries(line)) collectBlobRefs(value, key, refs);
  }
  return refs;
}

// --- keys --------------------------------------------------------------------

function ledgerPrefix(ctx: SyncContext): string {
  return `${ctx.prefix}ledger/`;
}

function blobKey(ctx: SyncContext, sha: string): string {
  return `${ctx.prefix}blobs/${sha}`;
}

function itemKey(ctx: SyncContext, kind: Kind, slug: string): string {
  return `${ctx.prefix}items/${KIND_DIRS[kind]}/${slug}.md`;
}

function manifestKey(ctx: SyncContext): string {
  return `${ctx.prefix}manifest.json`;
}

function leaseKey(ctx: SyncContext): string {
  return `${ctx.prefix}lease.json`;
}

function compatKey(ctx: SyncContext): string {
  return `${ctx.prefix}compat.json`;
}

function parseRef(ref: string): ItemAddress {
  const slash = ref.indexOf("/");
  const kind = KINDS.find((candidate) => candidate === ref.slice(0, slash));
  const slug = ref.slice(slash + 1);
  if (slash < 1 || kind === undefined || slug === "") throw new Error(`manifest: '${ref}' is not <kind>/<slug>`);
  return { kind, slug };
}

// --- sync.json ---------------------------------------------------------------

function syncFilePath(project: Project): string {
  return join(project.root, SYNC_FILE);
}

function decodeSyncState(text: string, where: string): SyncState {
  const parsed = parseJson(text, where);
  if (!isJsonRecord(parsed) || parsed.v !== 1) throw new Error(`${where}: expected {"v":1,...}`);
  const seen = new Set<string>();
  const seenList = parsed.seen ?? [];
  if (!Array.isArray(seenList)) throw new Error(`${where}: 'seen' must be a list`);
  for (const entry of seenList) {
    if (!isJsonText(entry)) throw new Error(`${where}: 'seen' holds a non-string`);
    seen.add(entry);
  }
  const base = new Map<string, string>();
  const baseMap = parsed.base ?? {};
  if (!isJsonRecord(baseMap)) throw new Error(`${where}: 'base' must be a map`);
  for (const [ref, sha] of Object.entries(baseMap)) {
    if (!isJsonText(sha) || !SHA256_HEX.test(sha)) throw new Error(`${where}: base '${ref}' is not a sha256`);
    base.set(ref, sha);
  }
  const state: SyncState = { seen, base };
  if (isJsonText(parsed.last_sync)) state.lastSync = parsed.last_sync;
  return state;
}

function readSyncState(project: Project): SyncState {
  const path = syncFilePath(project);
  if (!existsSync(path)) return { seen: new Set(), base: new Map() };
  return decodeSyncState(readFileSync(path, "utf8"), path);
}

/** When the project last synced in full on this host (`sync.json` `last_sync`), or undefined: never, or the file does not read. */
export function lastSyncAt(project: Project): string | undefined {
  try {
    return readSyncState(project).lastSync;
  } catch {
    return undefined;
  }
}

/** Writes sync.json under the project lock. `seen` is merged with the file, so a parallel pull loses nothing. */
function saveSyncState(project: Project, state: SyncState): void {
  project.withLock(() => {
    for (const entry of readSyncState(project).seen) state.seen.add(entry);
    const document = {
      v: 1,
      seen: [...state.seen].toSorted(),
      base: Object.fromEntries([...state.base.entries()].toSorted(([a], [b]) => (a < b ? -1 : 1))),
      last_sync: state.lastSync ?? null,
    };
    writeFileAtomic(syncFilePath(project), `${JSON.stringify(document, null, 2)}\n`);
  });
}

// --- blobs -------------------------------------------------------------------

async function pullBlobs(ctx: SyncContext, shas: Iterable<string>): Promise<void> {
  const missing = [...shas].filter((sha) => getBlob(ctx.project, sha) === null);
  await forEachLimited(missing, BLOB_CONCURRENCY, async (sha) => {
    const got = await ctx.s3.get(blobKey(ctx, sha));
    if (got === null) throw new Error(`${blobKey(ctx, sha)}: a ledger line names this blob, but the bucket has none`);
    if (sha256Hex(got.body) !== sha) throw new Error(`${blobKey(ctx, sha)}: content does not hash to its name`);
    putBlob(ctx.project, got.body);
    ctx.report.blobsPulled += 1;
  });
}

async function pushBlobs(ctx: SyncContext, shas: Iterable<string>, source: string): Promise<void> {
  await forEachLimited([...shas], BLOB_CONCURRENCY, async (sha) => {
    const blob = getBlob(ctx.project, sha);
    if (blob === null) throw new Error(`${source}: names blob ${sha}, which is not in the local store`);
    if (sha256Hex(blob) !== sha) throw new Error(`blob ${sha} in the local store does not hash to its name; nothing of it was pushed`);
    const result = await ctx.s3.put(blobKey(ctx, sha), blob, { ifNoneMatch: true });
    if (!("conflict" in result)) ctx.report.blobsPushed += 1;
  });
}

// --- ledger ------------------------------------------------------------------

async function pullChunks(ctx: SyncContext): Promise<void> {
  const prefix = ledgerPrefix(ctx);
  for (const object of await ctx.s3.list(prefix)) {
    const relative = object.key.slice(prefix.length);
    if (ctx.state.seen.has(relative)) continue;
    const match = CHUNK_KEY.exec(relative);
    const [, host, name] = match ?? [];
    if (host === undefined || name === undefined) throw new Error(`${object.key}: not <host>/<ulid>.jsonl`);
    const got = await ctx.s3.get(object.key);
    if (got === null) throw new Error(`${object.key}: listed, then gone (nothing deletes chunks in v1)`);
    const text = textOf(got.body, object.key);
    if (writeRemoteChunk(ctx.project, { host, name, text }) === "written") ctx.report.pulledChunks += 1;
    await pullBlobs(ctx, blobRefsOf(text, object.key));
    ctx.state.seen.add(relative);
  }
  saveSyncState(ctx.project, ctx.state);
}

/** Closes open.jsonl and pushes every own chunk the bucket has not seen, blobs first. */
async function pushChunks(ctx: SyncContext): Promise<void> {
  closeOpenChunk(ctx.project);
  const pending = listChunks(ctx.project).filter(
    (chunk) => chunk.host === ctx.host && !ctx.state.seen.has(`${chunk.host}/${chunk.name}`),
  );
  for (const chunk of pending) {
    const text = readFileSync(chunk.path, "utf8");
    await pushBlobs(ctx, blobRefsOf(text, chunk.path), chunk.path);
    const key = `${ledgerPrefix(ctx)}${chunk.host}/${chunk.name}`;
    const result = await ctx.s3.put(key, text, { ifNoneMatch: true, contentType: JSONL_CONTENT });
    if (!("conflict" in result)) ctx.report.pushedChunks += 1;
    ctx.state.seen.add(`${chunk.host}/${chunk.name}`);
    saveSyncState(ctx.project, ctx.state);
  }
}

/**
 * The complete push of a reseed (see the file header). Every local blob goes
 * first, then every closed chunk of every host. Each PUT is If-None-Match, so
 * an object the bucket still holds is never rewritten and never counted.
 * `seen` gains every chunk name; it is saved once at the end, because a crash
 * only means the next reseed gets a 412 for the same objects.
 */
async function pushEverything(ctx: SyncContext): Promise<void> {
  closeOpenChunk(ctx.project);
  const blobs = listBlobs(ctx.project);
  const stored = new Set(blobs);
  const chunks = listChunks(ctx.project);
  const texts = new Map(chunks.map((chunk) => [chunk, readFileSync(chunk.path, "utf8")]));
  for (const [chunk, text] of texts) {
    for (const sha of blobRefsOf(text, chunk.path)) {
      if (!stored.has(sha)) throw new Error(`${chunk.path}: names blob ${sha}, which is not in the local store`);
    }
  }
  await pushBlobs(ctx, blobs, "reseed");
  await forEachLimited(chunks, BLOB_CONCURRENCY, async (chunk) => {
    const text = texts.get(chunk) ?? "";
    const key = `${ledgerPrefix(ctx)}${chunk.host}/${chunk.name}`;
    const result = await ctx.s3.put(key, text, { ifNoneMatch: true, contentType: JSONL_CONTENT });
    if (!("conflict" in result)) ctx.report.pushedChunks += 1;
    ctx.state.seen.add(`${chunk.host}/${chunk.name}`);
  });
  saveSyncState(ctx.project, ctx.state);
}

// --- lease -------------------------------------------------------------------

function decodeLease(text: string, where: string): Lease {
  const parsed = parseJson(text, where);
  if (!isJsonRecord(parsed)) throw new Error(`${where}: a lease must be a JSON object`);
  const { holder, host, pid, expires } = parsed;
  if (!isJsonText(holder) || !isJsonText(host) || !isJsonInteger(pid) || !isJsonText(expires)) {
    throw new Error(`${where}: lease needs holder, host, pid and expires; delete the object if no sync is running`);
  }
  if (Number.isNaN(Date.parse(expires))) throw new Error(`${where}: lease 'expires' is not a date`);
  return { holder, host, pid, expires };
}

async function readLease(ctx: SyncContext): Promise<Lease | null> {
  const got = await ctx.s3.get(leaseKey(ctx));
  if (got === null) return null;
  return decodeLease(textOf(got.body, leaseKey(ctx)), leaseKey(ctx));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return !(cause instanceof Error && "code" in cause && cause.code === "ESRCH");
  }
}

/** Expired, or held by a process of this host that no longer exists. */
function isLeaseStale(lease: Lease, host: string): boolean {
  if (Date.parse(lease.expires) <= Date.now()) return true;
  return lease.host === host && !isProcessAlive(lease.pid);
}

/**
 * Takes `lease.json` with If-None-Match:*. A stale lease is taken over with
 * a claim (src/core/lease.ts, takeOverBucketLease, 0.87.0), never deleted, so
 * two hosts that see the same stale lease cannot both hold it. Returns the
 * lease taken, or the holder that blocks.
 */
async function takeLease(ctx: SyncContext): Promise<{ taken: Lease } | { heldBy: string }> {
  let blocker = "unknown";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const lease: Lease = {
      holder: `${ctx.host}:${process.pid}`,
      host: ctx.host,
      pid: process.pid,
      expires: new Date(Date.now() + LEASE_TTL_MS).toISOString(),
    };
    const result = await ctx.s3.put(leaseKey(ctx), `${JSON.stringify(lease)}\n`, {
      ifNoneMatch: true,
      contentType: JSON_CONTENT,
    });
    if (!("conflict" in result)) return { taken: lease };
    const got = await ctx.s3.get(leaseKey(ctx));
    if (got === null) continue;
    const text = textOf(got.body, leaseKey(ctx));
    const current = decodeLease(text, leaseKey(ctx));
    blocker = `${current.holder} until ${current.expires}`;
    if (!isLeaseStale(current, ctx.host)) return { heldBy: blocker };
    const taken = await takeOverBucketLease(ctx.s3, leaseKey(ctx), text, `${JSON.stringify(lease)}\n`, ctx.host);
    if ("taken" in taken) return { taken: lease };
    if ("blocked" in taken) return { heldBy: taken.blocked };
  }
  return { heldBy: blocker };
}

/** Deletes the lease when it is still ours; a lease taken over after expiry is left alone. */
async function releaseLease(ctx: SyncContext, lease: Lease): Promise<void> {
  const current = await readLease(ctx);
  if (current?.holder !== lease.holder || current.expires !== lease.expires) return;
  await ctx.s3.del(leaseKey(ctx));
}

// --- manifest ----------------------------------------------------------------

function decodeManifest(text: string, where: string): Manifest {
  const parsed = parseJson(text, where);
  if (!isJsonRecord(parsed) || parsed.v !== 1 || !isJsonRecord(parsed.items)) {
    throw new Error(`${where}: expected {"v":1,"items":{...}}`);
  }
  const manifest: Manifest = new Map();
  for (const [ref, entry] of Object.entries(parsed.items)) {
    parseRef(ref);
    if (!isJsonRecord(entry) || !isJsonText(entry.sha) || !SHA256_HEX.test(entry.sha) || !isJsonText(entry.updated)) {
      throw new Error(`${where}: item '${ref}' needs sha and updated`);
    }
    manifest.set(ref, { sha: entry.sha, updated: entry.updated });
  }
  return manifest;
}

function encodeManifest(manifest: Manifest): string {
  const items = Object.fromEntries([...manifest.entries()].toSorted(([a], [b]) => (a < b ? -1 : 1)));
  return `${JSON.stringify({ v: 1, items }, null, 2)}\n`;
}

async function readManifest(ctx: SyncContext): Promise<Manifest> {
  const got = await ctx.s3.get(manifestKey(ctx));
  if (got === null) return new Map();
  return decodeManifest(textOf(got.body, manifestKey(ctx)), manifestKey(ctx));
}

// --- compat floor ------------------------------------------------------------

/**
 * Decodes `compat.json`. Only `compat` must be readable, so a later version
 * of the object with more fields still refuses an old binary. An object
 * whose `compat` cannot be read throws: guessing 0 could let an old binary
 * sync over a newer format.
 */
export function decodeCompatFloor(text: string, where: string): CompatFloor {
  const parsed = parseJson(text, where);
  if (!isJsonRecord(parsed) || !isJsonInteger(parsed.compat) || parsed.compat < 0) {
    throw new Error(`${where}: no readable "compat"; sync refuses until the object is fixed by a host on the newest darius`);
  }
  const floor: CompatFloor = { compat: parsed.compat };
  if (isJsonText(parsed.min_version)) floor.minVersion = parsed.min_version;
  if (isJsonText(parsed.host)) floor.host = parsed.host;
  if (isJsonText(parsed.at)) floor.at = parsed.at;
  return floor;
}

/** The bucket's floor; compat 0 when the object is absent. A failed read throws, as every bucket read does. */
async function readCompatFloor(ctx: SyncContext): Promise<CompatFloor> {
  const got = await ctx.s3.get(compatKey(ctx));
  if (got === null) return { compat: 0 };
  return decodeCompatFloor(textOf(got.body, compatKey(ctx)), compatKey(ctx));
}

/** Marks the report refused when the floor is above this binary's compat. True when it refused. */
function refusedBy(ctx: SyncContext, floor: CompatFloor): boolean {
  if (decideCompat(floor.compat, ctx.compat.compat) !== "refuse") return false;
  const outdated: OutdatedFloor = { bucketCompat: floor.compat, ownCompat: ctx.compat.compat };
  if (floor.minVersion !== undefined) outdated.minVersion = floor.minVersion;
  if (floor.host !== undefined) outdated.raisedBy = floor.host;
  ctx.report.skipped = "darius-outdated";
  ctx.report.outdated = outdated;
  return true;
}

/** Raises the floor to this binary's compat. Called under the lease, after the items and the manifest went out. */
async function raiseCompatFloor(ctx: SyncContext): Promise<void> {
  const document = { v: 1, compat: ctx.compat.compat, min_version: ctx.compat.minVersion, host: ctx.host, at: new Date().toISOString() };
  await ctx.s3.put(compatKey(ctx), `${JSON.stringify(document)}\n`, { contentType: JSON_CONTENT });
  ctx.report.compatRaised = ctx.compat.compat;
}

// --- host version ------------------------------------------------------------

/** True when this host's newest own `host.version` line is missing or names another version. Pure. */
export function needsHostVersion(ownLines: readonly { type: string; id: string; version?: JsonValue }[], version: string): boolean {
  let newest: { id: string; version?: JsonValue } | undefined;
  for (const line of ownLines) {
    if (line.type !== HOST_VERSION_TYPE) continue;
    if (newest === undefined || line.id > newest.id) newest = line;
  }
  return newest?.version !== version;
}

/** Appends `host.version {version, compat}` when this host's newest one names another version. Local only: the push carries it. */
function noteHostVersion(ctx: SyncContext): void {
  ctx.project.withLock(() => {
    if (!needsHostVersion(readHostLines(ctx.project, ctx.host), VERSION)) return;
    appendLine(ctx.project, { who: SYNC_WHO, type: HOST_VERSION_TYPE, version: VERSION, compat: ctx.compat.compat });
    ctx.report.hostVersionNoted = true;
  });
}

// --- items -------------------------------------------------------------------

/** What to do with one item, from three shas. Pure. */
export function decideItem(shas: ItemShas): ItemAction {
  const { localSha, baseSha, remoteSha } = shas;
  if (remoteSha === null) return localSha === null ? "none" : "push";
  if (localSha === remoteSha) return "same";
  if (localSha === null || localSha === baseSha) return "pull";
  if (remoteSha === baseSha) return "push";
  return "conflict";
}

/**
 * True when the local version wins a conflict: the later `updated`; on a tie
 * the larger sha, so both hosts of a conflict pick the same winner.
 */
export function isLocalNewer(versions: { local: ManifestEntry; remote: ManifestEntry }): boolean {
  const { local, remote } = versions;
  const localTime = Date.parse(local.updated);
  const remoteTime = Date.parse(remote.updated);
  const isComparable = !Number.isNaN(localTime) && !Number.isNaN(remoteTime);
  if (isComparable && localTime !== remoteTime) return localTime > remoteTime;
  if (!isComparable && local.updated !== remote.updated) return local.updated > remote.updated;
  return local.sha > remote.sha;
}

interface ItemPlan {
  readonly ref: string;
  readonly kind: Kind;
  readonly slug: string;
  /** The text to PUT to the bucket; null when the bucket already has the local version. */
  push: string | null;
  /** The sha both sides agree on after this sync, once the manifest is written. */
  agreed: string | null;
}

function localRefs(project: Project): string[] {
  return KINDS.flatMap((kind) => project.listItems(kind).map((slug) => itemRef(kind, slug)));
}

async function fetchItem(ctx: SyncContext, kind: Kind, slug: string): Promise<string> {
  const key = itemKey(ctx, kind, slug);
  const got = await ctx.s3.get(key);
  if (got === null) throw new Error(`${key}: the manifest lists this item, but the bucket has no object`);
  return textOf(got.body, key);
}

function entryOf(text: string, where: string): ManifestEntry {
  return { sha: sha256Hex(text), updated: decodeItem(text, where).header.updated };
}

/** Resolves a both-sides change: the loser goes to blobs/ and a `conflict` line is appended. */
function resolveConflict(ctx: SyncContext, plan: ItemPlan, texts: { local: string; remote: string }): void {
  const where = itemKey(ctx, plan.kind, plan.slug);
  const local = entryOf(texts.local, where);
  const remote = entryOf(texts.remote, where);
  const isLocalWinner = isLocalNewer({ local, remote });
  const shaLost = putBlob(ctx.project, isLocalWinner ? texts.remote : texts.local);
  if (!isLocalWinner) writeItemText(ctx.project, { kind: plan.kind, slug: plan.slug, text: texts.remote, who: SYNC_WHO });
  appendLine(ctx.project, {
    who: SYNC_WHO,
    type: "conflict",
    item: plan.ref,
    sha_lost: shaLost,
    sha_won: isLocalWinner ? local.sha : remote.sha,
  });
  ctx.report.conflicts.push(plan.ref);
  plan.push = isLocalWinner ? texts.local : null;
  plan.agreed = isLocalWinner ? local.sha : remote.sha;
}

/**
 * Reconciles one item. Fetches the remote object only when the manifest says
 * it moved, then decides again on the sha actually fetched: an item object
 * can be newer than the manifest after a crash (file header, "Crash safety").
 */
async function reconcileItem(ctx: SyncContext, ref: string, remote: ManifestEntry | undefined, isPullOnly: boolean): Promise<ItemPlan> {
  const { kind, slug } = parseRef(ref);
  const plan: ItemPlan = { ref, kind, slug, push: null, agreed: null };
  const localText = readItemText(ctx.project, kind, slug);
  const localSha = localText === null ? null : sha256Hex(localText);
  const baseSha = ctx.state.base.get(ref) ?? null;
  let action = decideItem({ localSha, baseSha, remoteSha: remote?.sha ?? null });
  let remoteText: string | null = null;
  if (action === "pull" || action === "conflict") {
    remoteText = await fetchItem(ctx, kind, slug);
    action = decideItem({ localSha, baseSha, remoteSha: sha256Hex(remoteText) });
  }
  if (action === "same") plan.agreed = localSha;
  if (action === "pull" && remoteText !== null) {
    writeItemText(ctx.project, { kind, slug, text: remoteText, who: SYNC_WHO });
    ctx.report.itemsPulled += 1;
    plan.agreed = sha256Hex(remoteText);
  }
  if (isPullOnly) return plan;
  if (action === "push" && localText !== null) {
    plan.push = localText;
    plan.agreed = localSha;
  }
  if (action === "conflict" && localText !== null && remoteText !== null) {
    resolveConflict(ctx, plan, { local: localText, remote: remoteText });
  }
  return plan;
}

async function reconcileItems(ctx: SyncContext, manifest: Manifest, isPullOnly: boolean): Promise<ItemPlan[]> {
  const refs = [...new Set([...localRefs(ctx.project), ...manifest.keys()])].toSorted();
  const plans: ItemPlan[] = [];
  for (const ref of refs) plans.push(await reconcileItem(ctx, ref, manifest.get(ref), isPullOnly));
  return plans;
}

/** PUTs changed items, then the manifest when it differs from the bucket's. Advances `base` after both. */
async function pushItems(ctx: SyncContext, plans: readonly ItemPlan[], remoteManifest: Manifest): Promise<void> {
  const next: Manifest = new Map(remoteManifest);
  for (const plan of plans) {
    const text = readItemText(ctx.project, plan.kind, plan.slug);
    if (text !== null) next.set(plan.ref, entryOf(text, itemKey(ctx, plan.kind, plan.slug)));
    if (plan.push === null) continue;
    await ctx.s3.put(itemKey(ctx, plan.kind, plan.slug), plan.push, { contentType: MARKDOWN_CONTENT });
    ctx.report.itemsPushed += 1;
  }
  const encoded = encodeManifest(next);
  if (encoded !== encodeManifest(remoteManifest)) {
    await ctx.s3.put(manifestKey(ctx), encoded, { contentType: JSON_CONTENT });
  }
}

function recordAgreed(ctx: SyncContext, plans: readonly ItemPlan[]): void {
  for (const plan of plans) {
    if (plan.agreed !== null) ctx.state.base.set(plan.ref, plan.agreed);
  }
}

// --- the sync ----------------------------------------------------------------

async function runPullOnly(ctx: SyncContext): Promise<void> {
  await pullChunks(ctx);
  const plans = await reconcileItems(ctx, await readManifest(ctx), true);
  recordAgreed(ctx, plans);
}

/**
 * Steps 4 to 6. The floor is read again first: a host that raised it since
 * step 0 may have written items this binary would misread, so a higher floor
 * skips the items. A lower one is raised once the manifest is out.
 */
async function runUnderLease(ctx: SyncContext): Promise<void> {
  const floor = await readCompatFloor(ctx);
  if (refusedBy(ctx, floor)) return;
  const manifest = await readManifest(ctx);
  const plans = await reconcileItems(ctx, manifest, false);
  await pushChunks(ctx);
  await pushItems(ctx, plans, manifest);
  recordAgreed(ctx, plans);
  if (decideCompat(floor.compat, ctx.compat.compat) === "raise") await raiseCompatFloor(ctx);
}

async function runFull(ctx: SyncContext): Promise<void> {
  await pullChunks(ctx);
  await pushChunks(ctx);
  const lease = await takeLease(ctx);
  if ("heldBy" in lease) {
    ctx.report.skipped = "lease-held";
    ctx.report.leaseHolder = lease.heldBy;
    return;
  }
  try {
    await runUnderLease(ctx);
  } catch (cause) {
    // Best effort: the lease expires in 60 s anyway, and the first error is
    // the one to report, not a second one from the release.
    await releaseLease(ctx, lease.taken).catch(() => undefined);
    throw cause;
  }
  await releaseLease(ctx, lease.taken);
}

/** A full sync preceded by the complete push: pull what the bucket still has, put back everything else, then sync as usual. */
async function runReseed(ctx: SyncContext): Promise<void> {
  await pullChunks(ctx);
  await pushEverything(ctx);
  await runFull(ctx);
}

/** Step 0, then the sync `opts` asks for. Nothing is pulled or pushed when the floor refuses. */
async function runChecked(ctx: SyncContext, opts: SyncOptions): Promise<void> {
  if (refusedBy(ctx, await readCompatFloor(ctx))) return;
  if (opts.pullOnly === true) {
    await runPullOnly(ctx);
    return;
  }
  noteHostVersion(ctx);
  if (opts.reseed === true) await runReseed(ctx);
  else await runFull(ctx);
}

/**
 * Syncs `project` with the bucket behind `s3`. Returns a report; `skipped`
 * is set when the network is down, another process holds the lease, or the
 * bucket's compat floor is above this binary's. Any other failure throws.
 */
export async function syncProject(project: Project, s3: S3, cfg: Config, opts: SyncOptions = {}): Promise<SyncReport> {
  if (opts.reseed === true && opts.pullOnly === true) throw new Error("reseed pushes to the bucket, so it cannot be pull-only");
  const host = hostId();
  if (cfg.host !== host) throw new Error(`config host '${cfg.host}' differs from the ledger host id '${host}'`);
  const report: SyncReport = {
    project: project.name,
    pulledChunks: 0,
    pushedChunks: 0,
    itemsPulled: 0,
    itemsPushed: 0,
    conflicts: [],
    blobsPulled: 0,
    blobsPushed: 0,
  };
  if (opts.reseed === true) report.reseed = true;
  const compat = opts.compat ?? { compat: SYNC_COMPAT, minVersion: SYNC_COMPAT_SINCE };
  const ctx: SyncContext = { project, s3, host, prefix: `${project.name}/`, state: readSyncState(project), report, compat };
  try {
    await runChecked(ctx, opts);
  } catch (cause) {
    if (!(cause instanceof S3NetworkError)) throw cause;
    // A refusal stays the answer when the lease release after it failed.
    report.skipped ??= "offline";
  }
  if (report.skipped === undefined) ctx.state.lastSync = new Date().toISOString();
  saveSyncState(project, ctx.state);
  return report;
}
