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
 *
 * Take: PUT with If-None-Match: * (or an O_EXCL create). When the key exists,
 * a lease that is expired, unreadable, or held by a dead process of this host
 * is stale: delete it and try once more. Two takers race on the conditional
 * PUT and exactly one wins. A finished lease is never stale.
 *
 * Release and finish change the lease only while this holder still owns it,
 * and a network error there is swallowed: the lease expires on its own.
 */

import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { dirname } from "node:path";

import { errorMessage } from "../runtime.ts";
import type { JsonValue } from "./model.ts";
import { S3NetworkError, type S3 } from "./s3.ts";

const JSON_CONTENT = "application/json";

export interface LeaseBody {
  holder: string;
  host: string;
  pid: number;
  run: string;
  expires: string;
  done?: boolean;
  finished?: string;
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
}

export interface LeaseHandle {
  /** Deletes the lease. */
  release(): Promise<void>;
  /** Marks the lease done and keeps it, so nobody takes it again. */
  finish(): Promise<void>;
}

export type LeaseBlock = "lease-held" | "lease-done" | "lease-offline";

export type LeaseOutcome = { handle: LeaseHandle } | { blocked: LeaseBlock; detail: string };

/** Where a lease lives: the bucket or a local file. */
interface LeaseSlot {
  /** Creates the lease unless it exists. False when it exists. */
  create(text: string): Promise<boolean>;
  read(): Promise<string | null>;
  overwrite(text: string): Promise<void>;
  remove(): Promise<void>;
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
    const { holder, host, pid, run, expires, done, finished } = parsed;
    if (!isText(holder) || !isText(host) || !isNumber(pid) || !isText(expires)) return null;
    const lease: LeaseBody = { holder, host, pid, run: isText(run) ? run : "", expires };
    if (done === true) lease.done = true;
    if (isText(finished)) lease.finished = finished;
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

/** Expired, unreadable, or held by a process of this host that no longer exists. A done lease never is. */
export function isLeaseStale(lease: LeaseBody | null, host: string): boolean {
  if (lease === null) return true;
  if (lease.done === true) return false;
  const expires = Date.parse(lease.expires);
  if (Number.isNaN(expires) || expires <= Date.now()) return true;
  return lease.host === host && !isProcessAlive(lease.pid);
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
  };
}

function blockedBy(current: LeaseBody): LeaseOutcome {
  if (current.done === true) {
    const when = current.finished === undefined ? "" : ` at ${current.finished}`;
    return { blocked: "lease-done", detail: `done by ${current.host}${when}` };
  }
  return { blocked: "lease-held", detail: `held by ${current.holder} until ${current.expires}` };
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
    const current = decodeLease((await slot.read()) ?? "");
    if (current !== null && !isLeaseStale(current, spec.host)) return blockedBy(current);
    await slot.remove();
  }
  return { blocked: "lease-held", detail: "lost the takeover race" };
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
