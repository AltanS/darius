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
import { coolVigilSweepLease, heldVigilChecks, pruneSweepLeases, takeSweepLease, takeVigilSweepLease, vigilLeaseTtlMs } from "../src/core/sweep-lease.ts";

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

test("a one-vigil lease stands aside for a held daily lease, never writes it, and is released at the end", async () => {
  const project = openProject("lease-vigil", { create: true });
  const s3 = memoryS3();
  const today = "2026-09-28";
  const target = { s3, host: "hostA", today, slug: "soak", ttlMs: vigilLeaseTtlMs(2, 120_000) };
  assert.equal(vigilLeaseTtlMs(2, 120_000), 300_000, "checks x timeout + 60 s");
  assert.equal(vigilLeaseTtlMs(0, 120_000), 180_000, "at least one Command");

  const daily = await takeSweepLease(project, { s3, host: "hostB", today });
  assert.ok("handle" in daily);
  const refused = await takeVigilSweepLease(project, target);
  assert.ok("blocked" in refused && refused.blocked === "lease-held");
  assert.equal(refused.detail, "the daily sweep runs on hostB");
  assert.equal(s3.objects.has("lease-vigil/leases/vigil-soak.json"), false, "nothing was taken");

  await daily.handle.finish();
  const doneDaily = decodeLease(s3.objects.get("lease-vigil/leases/sweep-2026-09-28.json") ?? "");
  const mine = await takeVigilSweepLease(project, target);
  assert.ok("handle" in mine, "allowed once the daily sweep is done");
  assert.deepEqual(decodeLease(s3.objects.get("lease-vigil/leases/sweep-2026-09-28.json") ?? ""), doneDaily, "the daily lease is untouched");
  const body = decodeLease(s3.objects.get("lease-vigil/leases/vigil-soak.json") ?? "");
  assert.ok(Date.parse(body?.expires ?? "") - Date.now() > 290_000 && Date.parse(body?.expires ?? "") - Date.now() <= 300_000);

  const second = await takeVigilSweepLease(project, { ...target, host: "hostC" });
  assert.ok("blocked" in second && second.blocked === "lease-held");
  assert.match(second.detail, /a check of 'soak' is already running \(held by hostA:/u);
  const other = await takeVigilSweepLease(project, { ...target, slug: "other" });
  assert.ok("handle" in other, "another vigil is not blocked");

  await mine.handle.release();
  assert.equal(s3.objects.has("lease-vigil/leases/vigil-soak.json"), false);
  assert.ok("handle" in (await takeVigilSweepLease(project, { ...target, host: "hostC" })));
});

test("a one-vigil lease works on a local lock file and reads an offline bucket as lease-offline", async () => {
  const local = openProject("lease-vigil-local", { create: true });
  const target = { s3: null, host: "hostA", today: "2026-09-28", slug: "soak", ttlMs: 60_000 };
  const first = await takeVigilSweepLease(local, target);
  assert.ok("handle" in first);
  assert.ok(existsSync(join(local.root, "leases", "vigil-soak.lock")));
  assert.ok("blocked" in (await takeVigilSweepLease(local, target)));
  await first.handle.release();
  assert.equal(existsSync(join(local.root, "leases", "vigil-soak.lock")), false);
  assert.equal(existsSync(join(local.root, "leases", "sweep-2026-09-28.lock")), false, "the daily lock file was never written");

  const offline = await takeVigilSweepLease(local, { ...target, s3: memoryS3({ isOffline: true }) });
  assert.ok("blocked" in offline && offline.blocked === "lease-offline");
});

test("cross-host cooldown in the bucket: host A's ended check keeps host B out for 2 minutes; --force takes it over (0.86.2)", async () => {
  const project = openProject("lease-cool", { create: true });
  const s3 = memoryS3();
  const key = "lease-cool/leases/vigil-soak.json";
  const target = { s3, host: "hostA", today: "2026-09-28", slug: "soak", ttlMs: 60_000 };
  const mine = await takeVigilSweepLease(project, target);
  assert.ok("handle" in mine);
  await coolVigilSweepLease(mine.handle);
  const cooled = decodeLease(s3.objects.get(key) ?? "");
  assert.equal(cooled?.cooldown, true);
  const left = Date.parse(cooled?.expires ?? "") - Date.now();
  assert.ok(left > 110_000 && left <= 120_000, String(left));
  assert.equal(isLeaseStale(cooled, "hostA"), false, "a cooldown lease is not stale on its own host, though its process has ended");

  const refused = await takeVigilSweepLease(project, { ...target, host: "hostB" });
  assert.ok("blocked" in refused && refused.blocked === "lease-cooldown");
  assert.match(refused.detail, /^vigil 'soak' was checked less than 2 minutes ago \(ended on hostA, cooling down until .+\); wait or pass --force$/u);
  assert.deepEqual(await heldVigilChecks(project, { s3, host: "hostB" }), new Map(), "a cooldown is no running check");

  const forced = await takeVigilSweepLease(project, { ...target, host: "hostB", force: true });
  assert.ok("handle" in forced, "--force takes the cooldown over");
  assert.equal(decodeLease(s3.objects.get(key) ?? "")?.host, "hostB");
  const busy = await takeVigilSweepLease(project, { ...target, host: "hostC", force: true });
  assert.ok("blocked" in busy && busy.blocked === "lease-held", "--force never takes a running check");

  await forced.handle.release();
  s3.objects.set(key, JSON.stringify({ ...cooled, expires: new Date(Date.now() - 1000).toISOString() }));
  assert.ok("handle" in (await takeVigilSweepLease(project, { ...target, host: "hostB" })), "an expired cooldown is free");
});

test("heldVigilChecks: host B's daily sweep sees host A's running check in the bucket; expired and other leases do not count (0.86.2)", async () => {
  const project = openProject("lease-held", { create: true });
  const s3 = memoryS3();
  const running = await takeVigilSweepLease(project, { s3, host: "hostA", today: "2026-09-28", slug: "soak", ttlMs: 60_000 });
  assert.ok("handle" in running);
  s3.objects.set("lease-held/leases/vigil-old.json", JSON.stringify({ holder: "hostA:1", host: "hostA", pid: 1, run: "", expires: "2026-01-01T00:00:00.000Z" }));
  assert.ok("handle" in (await takeSweepLease(project, { s3, host: "hostB", today: "2026-09-28" })));
  const held = await heldVigilChecks(project, { s3, host: "hostB" });
  assert.deepEqual([...held.keys()], ["soak"]);
  assert.match(held.get("soak") ?? "", /^a check of 'soak' runs on hostA until /u);
  assert.deepEqual(await heldVigilChecks(project, { s3: memoryS3({ isOffline: true }), host: "hostB" }), new Map(), "unreadable leases: sweep every vigil");
  assert.deepEqual(await heldVigilChecks(openProject("lease-held-none", { create: true }), { s3: null, host: "hostB" }), new Map(), "no lease directory");
});
