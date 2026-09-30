/**
 * src/core/lease.ts and the daily sweep lease (src/core/sweep-lease.ts), on
 * a local lock file and on an in-memory bucket with If-None-Match.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decodeLease, isLeaseStale, takeLease, type LeaseSpec } from "../src/core/lease.ts";
import { S3NetworkError, type ListedObject, type S3 } from "../src/core/s3.ts";
import { openProject } from "../src/core/store.ts";
import { pruneSweepLeases, takeSweepLease } from "../src/core/sweep-lease.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-lease-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");

interface MemoryS3 extends S3 {
  objects: Map<string, string>;
}

function memoryS3(opts: { isOffline?: boolean } = {}): MemoryS3 {
  const objects = new Map<string, string>();
  const offline = (): void => {
    if (opts.isOffline === true) throw new S3NetworkError("connection refused", {});
  };
  return {
    objects,
    async put(key, body, o) {
      offline();
      if (o?.ifNoneMatch === true && objects.has(key)) return { conflict: true };
      objects.set(key, body instanceof Uint8Array ? new TextDecoder().decode(body) : body);
      return { etag: "e" };
    },
    async get(key) {
      offline();
      const text = objects.get(key);
      return text === undefined ? null : { body: new TextEncoder().encode(text), etag: "e" };
    },
    async head(key) {
      return objects.has(key) ? { etag: "e", size: 1 } : null;
    },
    async del(key) {
      offline();
      objects.delete(key);
    },
    async list(prefix): Promise<ListedObject[]> {
      return [...objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key, etag: "e", size: 1 }));
    },
    async ensureBucket() {
      return "exists";
    },
  };
}

function spec(s3: S3 | null, host: string, file: string): LeaseSpec {
  return { key: "p/leases/x.json", file, s3, host, ttlMs: 60_000 };
}

test("a finished lease blocks every later taker as lease-done and is never stale", async () => {
  const s3 = memoryS3();
  const file = join(SANDBOX, "unused.lock");
  const first = await takeLease(spec(s3, "hostA", file));
  assert.ok("handle" in first);
  const held = await takeLease(spec(s3, "hostB", file));
  assert.ok("blocked" in held && held.blocked === "lease-held");
  await first.handle.finish();
  const body = decodeLease(s3.objects.get("p/leases/x.json") ?? "");
  assert.equal(body?.done, true);
  assert.ok(body?.finished !== undefined);
  const done = await takeLease(spec(s3, "hostB", file));
  assert.ok("blocked" in done && done.blocked === "lease-done");
  assert.match(done.detail, /done by hostA/u);
  // Even long expired, a done lease stays.
  assert.equal(isLeaseStale({ holder: "h", host: "hostA", pid: 1, run: "", expires: "2000-01-01T00:00:00Z", done: true }, "hostB"), false);
});

test("a released lease is gone; an expired one is taken over; offline is reported", async () => {
  const s3 = memoryS3();
  const file = join(SANDBOX, "unused2.lock");
  const first = await takeLease(spec(s3, "hostA", file));
  assert.ok("handle" in first);
  await first.handle.release();
  assert.equal(s3.objects.size, 0);

  s3.objects.set("p/leases/x.json", JSON.stringify({ holder: "hostB:9", host: "hostB", pid: 9, run: "", expires: "2000-01-01T00:00:00.000Z" }));
  const takeover = await takeLease(spec(s3, "hostA", file));
  assert.ok("handle" in takeover);
  assert.match(s3.objects.get("p/leases/x.json") ?? "", /hostA/u);

  const offline = await takeLease(spec(memoryS3({ isOffline: true }), "hostA", file));
  assert.ok("blocked" in offline && offline.blocked === "lease-offline");
});

test("a holder that lost its lease to a takeover neither finishes nor releases the new one", async () => {
  const s3 = memoryS3();
  const file = join(SANDBOX, "unused3.lock");
  const first = await takeLease(spec(s3, "hostA", file));
  assert.ok("handle" in first);
  const theirs = JSON.stringify({ holder: "hostB:9", host: "hostB", pid: 9, run: "", expires: "2999-01-01T00:00:00.000Z" });
  s3.objects.set("p/leases/x.json", theirs);
  await first.handle.finish();
  await first.handle.release();
  assert.equal(s3.objects.get("p/leases/x.json"), theirs);
});

test("with no bucket the lease is a local file with the same rules", async () => {
  const file = join(SANDBOX, "leases", "sweep.lock");
  const first = await takeLease(spec(null, "hostA", file));
  assert.ok("handle" in first);
  const held = await takeLease(spec(null, "hostA", file));
  assert.ok("blocked" in held && held.blocked === "lease-held");
  await first.handle.finish();
  const done = await takeLease(spec(null, "hostA", file));
  assert.ok("blocked" in done && done.blocked === "lease-done");
  assert.equal(decodeLease(readFileSync(file, "utf8"))?.done, true);
});

test("the sweep lease is per project and per day, and old days are pruned", async () => {
  const project = openProject("lease-sweep", { create: true });
  const s3 = memoryS3();
  const today = "2026-09-28";
  const first = await takeSweepLease(project, { s3, host: "hostA", today });
  assert.ok("handle" in first);
  await first.handle.finish();
  assert.ok(s3.objects.has("lease-sweep/leases/sweep-2026-09-28.json"));
  const second = await takeSweepLease(project, { s3, host: "hostB", today });
  assert.ok("blocked" in second && second.blocked === "lease-done");
  const tomorrow = await takeSweepLease(project, { s3, host: "hostB", today: "2026-09-29" });
  assert.ok("handle" in tomorrow);

  for (const day of ["2026-09-20", "2026-09-25", "2026-09-26"]) s3.objects.set(`lease-sweep/leases/sweep-${day}.json`, "{}");
  s3.objects.set("lease-sweep/leases/ritual-x.json", "{}");
  await pruneSweepLeases(project, { s3, today });
  assert.deepEqual([...s3.objects.keys()].toSorted(), [
    "lease-sweep/leases/ritual-x.json",
    "lease-sweep/leases/sweep-2026-09-26.json",
    "lease-sweep/leases/sweep-2026-09-28.json",
    "lease-sweep/leases/sweep-2026-09-29.json",
  ]);

  const local = openProject("lease-sweep-local", { create: true });
  const mine = await takeSweepLease(local, { s3: null, host: "hostA", today });
  assert.ok("handle" in mine);
  await mine.handle.finish();
  writeFileSync(join(local.root, "leases", "sweep-2026-09-01.lock"), "{}");
  await pruneSweepLeases(local, { s3: null, today });
  assert.deepEqual(readdirSync(join(local.root, "leases")), ["sweep-2026-09-28.lock"]);
  assert.equal(existsSync(join(local.root, "leases", "sweep-2026-09-01.lock")), false);
});
