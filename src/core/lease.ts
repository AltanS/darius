/**
 * Leases: one holder at a time for a piece of unattended work, across every
 * host that shares the bucket (docs/concept.md, "Write path"). With no
 * remote, a lease is an O_EXCL file in the project's store instead.
 *
 * Two users:
 *
 *   run-due   `<project>/leases/ritual-<slug>.json`, RELEASED (deleted) when
 *             the run ends.
 *   sweep     `<project>/leases/sweep-<YYYY-MM-DD>.json`, FINISHED when the
 *             sweep ends: the body gets `done: true` and stays, so every other
 *             host sees that the project was swept today and skips it.
 *   vigil     `<project>/leases/vigil-<slug>.json`, COOLED when a one-vigil
 *             sweep ends (0.86.2, src/core/sweep-lease.ts): the body gets
 *             `cooldown: true` and expires 2 minutes later, so no host checks
 *             the vigil again before then. A taker with `force` may take it over.
 *
 * Take: PUT with If-None-Match: * (or an O_EXCL create). When the key exists,
 * a lease that is expired, unreadable, or held by a dead process of this host
 * is stale. A finished lease is never stale. A cooldown lease is stale only
 * once it expires: its process has ended by design.
 *
 * Takeover (0.87.0): a stale lease, or a cooldown lease under `force`, is
 * never deleted. Before 0.87.0 two takers could both delete it, and the
 * second delete removed the lease the first had just written; both then held
 * it. Now a taker first creates a claim next to the lease,
 * `<key>.takeover-<sha256 of the stale body>`, with the same conditional PUT.
 * Exactly one taker per stale body wins the claim. The winner reads the lease
 * again and overwrites it only while it still holds that same stale body,
 * then deletes the claim. A loser is blocked as `lease-held`. The backend
 * needs nothing beyond If-None-Match: * (docs/concept.md, "Write path").
 * A claim older than CLAIM_TTL_MS is from a taker that died: the next taker
 * deletes it and is blocked once, and the taker after that can claim again.
 *
 * Release, finish and cool change the lease only while this holder still owns it,
 * and a network error there is swallowed: the lease expires on its own.
 */

import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { dirname } from "node:path";

import { errorMessage } from "../runtime.ts";
import type { JsonValue } from "./model.ts";
import { S3NetworkError, type S3 } from "./s3.ts";

const JSON_CONTENT = "application/json";
/** A takeover is two reads and one write; a claim this old belongs to a taker that died. */
export const CLAIM_TTL_MS = 60_000;
const CLAIM_SUFFIX = ".takeover-";

export interface LeaseBody {
  holder: string;
  host: string;
  pid: number;
  run: string;
  expires: string;
  done?: boolean;
  finished?: string;
  /** Set by `cool`: the work ended, and the lease only keeps others out until `expires`. */
  cooldown?: boolean;
}

export interface LeaseSpec {
  /** The bucket key, used when `s3` is set. */
  key: string;
  /** The lock file, used when `s3` is null. */
  file: string;
  s3: S3 | null;
  host: string;
  ttlMs: number;
  /** The run the lease guards; empty for a sweep. */
  run?: string;
  /** Take over a cooldown lease (a one-vigil sweep's `--force`). */
  force?: boolean;
}

export interface LeaseHandle {
  /** Deletes the lease. */
  release(): Promise<void>;
  /** Marks the lease done and keeps it, so nobody takes it again. */
  finish(): Promise<void>;
  /** Keeps the lease as a cooldown that expires `ms` from now, so nobody takes it before then. */
  cool(ms: number): Promise<void>;
}

export type LeaseBlock = "lease-held" | "lease-done" | "lease-offline" | "lease-cooldown";

export type LeaseOutcome = { handle: LeaseHandle } | { blocked: LeaseBlock; detail: string };

/** Where a lease lives: the bucket or a local file. */
interface LeaseSlot {
  /** Creates the lease unless it exists. False when it exists. */
  create(text: string): Promise<boolean>;
  read(): Promise<string | null>;
  overwrite(text: string): Promise<void>;
  remove(): Promise<void>;
  /** The slot of the takeover claim for the stale body with this digest. */
  claim(digest: string): LeaseSlot;
}

// --- body ------------------------------------------------------------------------

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isNumber(value: JsonValue | undefined): value is number {
  return typeof value === "number";
}

function isRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function decodeLease(text: string): LeaseBody | null {
  try {
    const parsed: JsonValue = JSON.parse(text);
    if (!isRecord(parsed)) return null;
    const { holder, host, pid, run, expires, done, finished, cooldown } = parsed;
    if (!isText(holder) || !isText(host) || !isNumber(pid) || !isText(expires)) return null;
    const lease: LeaseBody = { holder, host, pid, run: isText(run) ? run : "", expires };
    if (done === true) lease.done = true;
    if (isText(finished)) lease.finished = finished;
    if (cooldown === true) lease.cooldown = true;
    return lease;
  } catch {
    return null;
  }
}

function encodeLease(lease: LeaseBody): string {
  return `${JSON.stringify(lease)}\n`;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return !(cause instanceof Error && "code" in cause && cause.code === "ESRCH");
  }
}

/** Expired, unreadable, or held by a process of this host that no longer exists. A done lease never is; a cooldown lease only by expiry. */
export function isLeaseStale(lease: LeaseBody | null, host: string): boolean {
  if (lease === null) return true;
  if (lease.done === true) return false;
  const expires = Date.parse(lease.expires);
  if (Number.isNaN(expires) || expires <= Date.now()) return true;
  return lease.cooldown !== true && lease.host === host && !isProcessAlive(lease.pid);
}

function isSameLease(current: LeaseBody | null, mine: LeaseBody): boolean {
  return current?.holder === mine.holder && current.expires === mine.expires;
}

// --- slots -----------------------------------------------------------------------

function hasErrnoCode(cause: unknown, code: string): boolean {
  return cause instanceof Error && "code" in cause && cause.code === code;
}

function fileSlot(path: string): LeaseSlot {
  return {
    async create(text) {
      mkdirSync(dirname(path), { recursive: true });
      try {
        const fd = openSync(path, "wx");
        try {
          writeSync(fd, text);
        } finally {
          closeSync(fd);
        }
        return true;
      } catch (cause) {
        if (hasErrnoCode(cause, "EEXIST")) return false;
        throw cause;
      }
    },
    async read() {
      try {
        return readFileSync(path, "utf8");
      } catch (cause) {
        if (hasErrnoCode(cause, "ENOENT")) return null;
        throw cause;
      }
    },
    async overwrite(text) {
      writeFileSync(path, text);
    },
    async remove() {
      try {
        unlinkSync(path);
      } catch (cause) {
        if (!hasErrnoCode(cause, "ENOENT")) throw cause;
      }
    },
    claim: (digest) => fileSlot(`${path}${CLAIM_SUFFIX}${digest}`),
  };
}

function bucketSlot(s3: S3, key: string): LeaseSlot {
  return {
    async create(text) {
      const put = await s3.put(key, text, { ifNoneMatch: true, contentType: JSON_CONTENT });
      return !("conflict" in put);
    },
    async read() {
      const got = await s3.get(key);
      return got === null ? null : new TextDecoder().decode(got.body);
    },
    async overwrite(text) {
      await s3.put(key, text, { contentType: JSON_CONTENT });
    },
    async remove() {
      await s3.del(key);
    },
    claim: (digest) => bucketSlot(s3, `${key}${CLAIM_SUFFIX}${digest}`),
  };
}

// --- take ------------------------------------------------------------------------

/** Runs `fn`, ignoring a network error: an unreleased lease expires on its own. */
async function quietly(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (cause) {
    if (!(cause instanceof S3NetworkError)) throw cause;
  }
}

function handleFor(slot: LeaseSlot, mine: LeaseBody): LeaseHandle {
  return {
    release: () =>
      quietly(async () => {
        if (isSameLease(decodeLease((await slot.read()) ?? ""), mine)) await slot.remove();
      }),
    finish: () =>
      quietly(async () => {
        if (!isSameLease(decodeLease((await slot.read()) ?? ""), mine)) return;
        await slot.overwrite(encodeLease({ ...mine, done: true, finished: new Date().toISOString() }));
      }),
    cool: (ms) =>
      quietly(async () => {
        if (!isSameLease(decodeLease((await slot.read()) ?? ""), mine)) return;
        const now = Date.now();
        await slot.overwrite(encodeLease({ ...mine, expires: new Date(now + ms).toISOString(), finished: new Date(now).toISOString(), cooldown: true }));
      }),
  };
}

function blockedBy(current: LeaseBody): LeaseOutcome {
  if (current.done === true) {
    const when = current.finished === undefined ? "" : ` at ${current.finished}`;
    return { blocked: "lease-done", detail: `done by ${current.host}${when}` };
  }
  if (current.cooldown === true) return { blocked: "lease-cooldown", detail: `ended on ${current.host}, cooling down until ${current.expires}` };
  return { blocked: "lease-held", detail: `held by ${current.holder} until ${current.expires}` };
}

/** A claim that cannot be read, or is older than CLAIM_TTL_MS, belongs to a taker that died. */
function isClaimStale(text: string | null): boolean {
  if (text === null) return false;
  try {
    const parsed: JsonValue = JSON.parse(text);
    const at = isRecord(parsed) && isText(parsed.at) ? Date.parse(parsed.at) : Number.NaN;
    return Number.isNaN(at) || Date.now() - at > CLAIM_TTL_MS;
  } catch {
    return true;
  }
}

/** What a takeover gave: the lease is now `next`, the stale body was already gone, or why another taker has it. */
export type TakeoverResult = { taken: true } | { gone: true } | { blocked: string };

/**
 * Replaces the stale lease whose text is `stale` with `next`. Only the taker
 * that creates the claim for this stale body may write; it checks that the
 * lease still holds that body before it overwrites it, then deletes the claim.
 */
async function replaceStale(slot: LeaseSlot, stale: string, next: string, host: string): Promise<TakeoverResult> {
  const claim = slot.claim(createHash("sha256").update(stale).digest("hex").slice(0, 32));
  if (!(await claim.create(`${JSON.stringify({ host, pid: process.pid, at: new Date().toISOString() })}\n`))) {
    if (isClaimStale(await claim.read())) {
      await claim.remove();
      return { blocked: "an earlier takeover of this lease stopped half way; its claim is removed, try again" };
    }
    return { blocked: "another taker is taking over this lease" };
  }
  try {
    if ((await slot.read()) !== stale) return { gone: true };
    await slot.overwrite(next);
    return { taken: true };
  } finally {
    await claim.remove();
  }
}

/** The same takeover for a lease of another shape in the bucket (the sync's `lease.json`, src/core/sync.ts). */
export function takeOverBucketLease(s3: S3, key: string, stale: string, next: string, host: string): Promise<TakeoverResult> {
  return replaceStale(bucketSlot(s3, key), stale, next, host);
}

async function takeFrom(slot: LeaseSlot, spec: LeaseSpec): Promise<LeaseOutcome> {
  const mine: LeaseBody = {
    holder: `${spec.host}:${String(process.pid)}`,
    host: spec.host,
    pid: process.pid,
    run: spec.run ?? "",
    expires: new Date(Date.now() + spec.ttlMs).toISOString(),
  };
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (await slot.create(encodeLease(mine))) return { handle: handleFor(slot, mine) };
    const text = await slot.read();
    if (text === null) continue;
    const current = decodeLease(text);
    const isForced = spec.force === true && current?.cooldown === true;
    if (current !== null && !isLeaseStale(current, spec.host) && !isForced) return blockedBy(current);
    const taken = await replaceStale(slot, text, encodeLease(mine), spec.host);
    if ("taken" in taken) return { handle: handleFor(slot, mine) };
    if ("blocked" in taken) return { blocked: "lease-held", detail: taken.blocked };
  }
  return { blocked: "lease-held", detail: "lost the takeover race" };
}

/** The lease as it stands, or null when there is none. Takes nothing. A bucket error reaches the caller. */
export async function readLease(spec: Pick<LeaseSpec, "key" | "file" | "s3">): Promise<LeaseBody | null> {
  const text = await (spec.s3 === null ? fileSlot(spec.file) : bucketSlot(spec.s3, spec.key)).read();
  return text === null ? null : decodeLease(text);
}

/** Takes the lease in the bucket when `spec.s3` is set, else as a local file. */
export async function takeLease(spec: LeaseSpec): Promise<LeaseOutcome> {
  if (spec.s3 === null) return takeFrom(fileSlot(spec.file), spec);
  try {
    return await takeFrom(bucketSlot(spec.s3, spec.key), spec);
  } catch (cause) {
    if (cause instanceof S3NetworkError) return { blocked: "lease-offline", detail: errorMessage(cause) };
    throw cause;
  }
}
