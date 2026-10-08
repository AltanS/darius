/**
 * `src/core/snapshot.ts`, `src/core/snapshot-settings.ts` and the multipart
 * upload of `src/core/s3.ts`.
 *
 * SAFETY: every store, snapshot folder and config dir is a `mkdtemp` dir, and
 * the "bucket" is an in-process server on a loopback port
 * (test/helpers/fake-s3.ts). Nothing here reaches a real bucket or the
 * operator's store.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { UsageError } from "../src/cli/registry.ts";
import { runSnapshotCommand, snapshotCommand, type SnapshotDeps } from "../src/cli/snapshot.ts";
import { createS3, S3Error, type RemoteConfig, type UploadSource } from "../src/core/s3.ts";
import {
  checkRemote,
  deleteLocalSnapshot,
  deleteRemoteSnapshot,
  fetchRemoteSnapshot,
  listLocalSnapshots,
  parseSnapshotName,
  readSnapshotState,
  runningSnapshot,
  runSnapshot,
  type SnapshotRunOptions,
} from "../src/core/snapshot.ts";
import {
  clearSnapshotCredentials,
  credentialsSource,
  maskPingUrl,
  planSnapshotSave,
  readSnapshotCredentials,
  readSnapshotFile,
  resolveSnapshotSettings,
  snapshotCredentialsPath,
  writeSnapshotCredentials,
  writeSnapshotFile,
} from "../src/core/snapshot-settings.ts";
import { pingKindFor, pingTarget } from "../src/core/snapshot-ping.ts";
import { startFakeS3 } from "./helpers/fake-s3.ts";

const sandbox = mkdtempSync(join(tmpdir(), "darius-snapshot-test-"));
process.env.DARIUS_CONFIG_DIR = join(sandbox, "config");
process.env.DARIUS_STATE_DIR = join(sandbox, "state");
mkdirSync(process.env.DARIUS_CONFIG_DIR, { recursive: true });
mkdirSync(process.env.DARIUS_STATE_DIR, { recursive: true });

const stateRoot = process.env.DARIUS_STATE_DIR;
const configRoot = process.env.DARIUS_CONFIG_DIR;

function put(root: string, path: string, data: string | Buffer): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, data);
}

function folder(name: string): string {
  return join(sandbox, name);
}

function options(dir: string, overrides: NodeJS.ProcessEnv = {}, extra: Partial<SnapshotRunOptions> = {}): SnapshotRunOptions {
  const env = { DARIUS_SNAPSHOT_DIR: dir, ...overrides };
  return { resolved: resolveSnapshotSettings({ env, config: {}, file: new Map() }), host: "host-a", version: "9.9.9", stateDir: stateRoot, ...extra };
}

function at(second: number): Date {
  return new Date(Date.UTC(2026, 9, 1, 4, 0, second));
}

put(stateRoot, "_global/ledger/host-a/open.jsonl", '{"type":"x"}\n');
put(stateRoot, "proj/items/rituals/daily.md", "# daily\n");

// --- settings ---------------------------------------------------------------------------------

test("the environment beats the dashboard file, which beats config.toml, which beats the default", () => {
  const resolved = resolveSnapshotSettings({
    env: { DARIUS_SNAPSHOT_KEEP: "3", DARIUS_SNAPSHOT_DIR: folder("a") },
    file: new Map([
      ["keep", 5],
      ["keep_remote", 9],
      ["region", "eu-west-1"],
    ]),
    config: { keep: 8, keep_remote: 11, region: "x", prefix: "from-config" },
  });
  assert.equal(resolved.settings.keep, 3);
  assert.equal(resolved.sources.get("keep"), "env");
  assert.equal(resolved.settings.keepRemote, 9);
  assert.equal(resolved.sources.get("keep_remote"), "file");
  assert.equal(resolved.sources.get("region"), "file");
  assert.equal(resolved.values.get("prefix"), "from-config");
  assert.equal(resolved.sources.get("prefix"), "config");
  assert.equal(resolved.sources.get("enabled"), "default");
  assert.deepEqual(resolved.problems, []);
});

test("a bad value is reported and the next layer is used", () => {
  const resolved = resolveSnapshotSettings({ env: { DARIUS_SNAPSHOT_KEEP: "many", DARIUS_SNAPSHOT_DIR: folder("a") }, file: new Map([["keep", 4]]), config: {} });
  assert.equal(resolved.settings.keep, 4);
  assert.ok(resolved.problems.some((problem) => problem.startsWith("DARIUS_SNAPSHOT_KEEP:")));
});

test("the folder must lie outside the store and the config folder", () => {
  const inside = resolveSnapshotSettings({ env: { DARIUS_SNAPSHOT_DIR: join(stateRoot, "snaps") }, file: new Map(), config: {} });
  assert.ok(inside.problems.some((problem) => problem.includes("overlaps")));
});

test("the remote copy needs an endpoint and a bucket, and plain http only on loopback or the tailnet", () => {
  const half = resolveSnapshotSettings({ env: { DARIUS_SNAPSHOT_DIR: folder("a"), DARIUS_SNAPSHOT_BUCKET: "bucket-1" }, file: new Map(), config: {} });
  assert.equal(half.settings.remote, null);
  assert.ok(half.problems.some((problem) => problem.includes("both an endpoint and a bucket")));

  const publicHttp = resolveSnapshotSettings({
    env: { DARIUS_SNAPSHOT_DIR: folder("a"), DARIUS_SNAPSHOT_BUCKET: "bucket-1", DARIUS_SNAPSHOT_ENDPOINT: "http://example.com", DARIUS_SNAPSHOT_ALLOW_HTTP: "true" },
    file: new Map(),
    config: {},
  });
  assert.equal(publicHttp.settings.remote, null);
  assert.ok(publicHttp.problems.length > 0);

  const ok = resolveSnapshotSettings({
    env: { DARIUS_SNAPSHOT_DIR: folder("a"), DARIUS_SNAPSHOT_BUCKET: "bucket-1", DARIUS_SNAPSHOT_ENDPOINT: "https://s3.example.com" },
    file: new Map(),
    config: {},
  });
  assert.equal(ok.settings.remote?.bucket, "bucket-1");
  assert.equal(ok.settings.remote?.prefix, "darius");
});

test("a save from the page refuses env-locked keys, unknown keys and bad values, and null clears a key", () => {
  const env = { DARIUS_SNAPSHOT_KEEP: "3" };
  const locked = planSnapshotSave(new Map([["keep", 9]]), new Map(), env);
  assert.equal(locked.ok, false);
  const unknown = planSnapshotSave(new Map([["colour", "red"]]), new Map(), {});
  assert.equal(unknown.ok, false);
  const bad = planSnapshotSave(new Map([["prefix", "../up"]]), new Map(), {});
  assert.equal(bad.ok, false);
  const saved = planSnapshotSave(new Map([["keep", 9]]), new Map([["region", "eu-west-1"]]), {});
  assert.ok(saved.ok);
  assert.equal(saved.values.get("keep"), 9);
  const cleared = planSnapshotSave(new Map([["keep", null]]), saved.ok ? saved.values : new Map(), {});
  assert.ok(cleared.ok);
  assert.equal(cleared.values.has("keep"), false);
});

test("the dashboard file round-trips and drops invalid entries", () => {
  writeSnapshotFile(new Map([["keep", 6]]));
  assert.equal(readSnapshotFile().get("keep"), 6);
  writeFileSync(join(configRoot, "snapshot.json"), JSON.stringify({ v: 1, values: { keep: 0, colour: "red", region: "eu-west-1" } }));
  const read = readSnapshotFile();
  assert.equal(read.has("keep"), false);
  assert.equal(read.get("region"), "eu-west-1");
  writeSnapshotFile(new Map());
  assert.equal(existsSync(join(configRoot, "snapshot.json")), false);
});

test("the credentials file is written 0600, found, read and never echoed in an error", () => {
  clearSnapshotCredentials();
  assert.equal(credentialsSource({}), "none");
  writeSnapshotCredentials("AKIAEXAMPLE", "s3cr3t-value");
  assert.equal(statSync(snapshotCredentialsPath()).mode & 0o777, 0o600);
  assert.equal(credentialsSource({}), "file");
  const read = readSnapshotCredentials({});
  assert.ok(read.ok);
  assert.equal(read.credentials.accessKeyId, "AKIAEXAMPLE");
  assert.equal(credentialsSource({ DARIUS_SNAPSHOT_ACCESS_KEY_ID: "a", DARIUS_SNAPSHOT_SECRET_ACCESS_KEY: "b" }), "env");
  assert.throws(() => {
    writeSnapshotCredentials("", "x");
  });
  clearSnapshotCredentials();
});

// --- a local run ------------------------------------------------------------------------------

test("a run makes an archive that restores with tar, and a manifest with its SHA-256", async () => {
  const dir = folder("local-1");
  const result = await runSnapshot(options(dir, {}, { now: at(0) }));
  assert.equal(result.code, 0, result.error ?? "");
  assert.equal(result.name, "darius-host-a-20261001T040000Z.tar.gz");
  const archive = join(dir, result.name ?? "");
  const manifest: { sha256: string; bytes: number; files: number; host: string } = JSON.parse(readFileSync(`${archive}.json`, "utf8"));
  assert.equal(manifest.sha256, createHash("sha256").update(readFileSync(archive)).digest("hex"));
  assert.equal(manifest.bytes, statSync(archive).size);
  assert.equal(manifest.files, 2);
  assert.equal(manifest.host, "host-a");

  const restored = mkdtempSync(join(sandbox, "restore-"));
  const untar = spawnSync("tar", ["-xzf", archive, "-C", restored]);
  assert.equal(untar.status, 0);
  assert.equal(readFileSync(join(restored, "proj/items/rituals/daily.md"), "utf8"), "# daily\n");
  assert.equal(existsSync(join(dir, "lock.json")), false);
  assert.equal(readSnapshotState(dir).last?.ok, true);
});

test("retention keeps the newest N local snapshots and only touches names it makes", async () => {
  const dir = folder("local-2");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "notes.txt"), "mine");
  for (const second of [0, 1, 2]) {
    const result = await runSnapshot(options(dir, { DARIUS_SNAPSHOT_KEEP: "2" }, { now: at(second) }));
    assert.equal(result.code, 0, result.error ?? "");
  }
  const names = listLocalSnapshots(dir).map((row) => row.name);
  assert.deepEqual(names, ["darius-host-a-20261001T040002Z.tar.gz", "darius-host-a-20261001T040001Z.tar.gz"]);
  assert.equal(readFileSync(join(dir, "notes.txt"), "utf8"), "mine");
  assert.equal(existsSync(join(dir, "darius-host-a-20261001T040000Z.tar.gz.json")), false);
});

test("a name that looks like a secret stops the run before anything is archived", async () => {
  put(stateRoot, "proj/credentials", "oops");
  const dir = folder("local-3");
  const result = await runSnapshot(options(dir, {}, { now: at(0) }));
  assert.equal(result.code, 1);
  assert.match(result.error ?? "", /secret/u);
  assert.deepEqual(listLocalSnapshots(dir), []);
  assert.equal(existsSync(join(dir, "lock.json")), false);
  assert.equal(readSnapshotState(dir).last?.ok, false);
  rmSync(join(stateRoot, "proj/credentials"));
});

test("a live lock stops a second run, a dead one is taken over", async () => {
  const dir = folder("local-4");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "lock.json"), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  assert.equal(runningSnapshot(dir)?.pid, process.pid);
  const busy = await runSnapshot(options(dir, {}, { now: at(0) }));
  assert.equal(busy.code, 1);
  assert.match(busy.error ?? "", /already running/u);

  writeFileSync(join(dir, "lock.json"), JSON.stringify({ pid: 2_147_483_000, startedAt: new Date().toISOString() }));
  assert.equal(runningSnapshot(dir), null);
  const taken = await runSnapshot(options(dir, {}, { now: at(1) }));
  assert.equal(taken.code, 0, taken.error ?? "");
});

test("a partial file left by a dead run is removed by the next run", async () => {
  const dir = folder("local-7");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".darius-host-a-20260101T000000Z.tar.gz.partial"), "half");
  const result = await runSnapshot(options(dir, {}, { now: at(0) }));
  assert.equal(result.code, 0, result.error ?? "");
  assert.equal(existsSync(join(dir, ".darius-host-a-20260101T000000Z.tar.gz.partial")), false);
});

test("off, or a problem in the settings, refuses", async () => {
  const off = await runSnapshot(options(folder("local-5"), { DARIUS_SNAPSHOT_ENABLED: "false" }));
  assert.equal(off.code, 1);
  const broken = await runSnapshot(options(folder("local-5"), { DARIUS_SNAPSHOT_KEEP: "zero" }));
  assert.equal(broken.code, 1);
});

test("list reads names, sizes and manifests, and delete refuses a name it did not make", async () => {
  const dir = folder("local-6");
  const made = await runSnapshot(options(dir, {}, { now: at(0) }));
  const rows = listLocalSnapshots(dir);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.files, 2);
  assert.equal(rows[0]?.remote, false);
  assert.equal(deleteLocalSnapshot(dir, "../etc/passwd").ok, false);
  assert.equal(deleteLocalSnapshot(dir, "notes.txt").ok, false);
  assert.equal(deleteLocalSnapshot(dir, made.name ?? "").ok, true);
  assert.deepEqual(listLocalSnapshots(dir), []);
  assert.deepEqual(parseSnapshotName("darius-host-b-1-20261001T040000Z.tar.gz")?.host, "host-b-1");
  assert.equal(parseSnapshotName("darius-x.tar.gz"), null);
});

// --- the bucket ---------------------------------------------------------------------------------

function remoteEnv(fake: { endpoint: string; bucket: string }, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DARIUS_SNAPSHOT_ENDPOINT: fake.endpoint,
    DARIUS_SNAPSHOT_BUCKET: fake.bucket,
    DARIUS_SNAPSHOT_ALLOW_HTTP: "true",
    DARIUS_SNAPSHOT_PREFIX: "darius",
    ...extra,
  };
}

function useCredentials(): void {
  writeSnapshotCredentials("test-access", "test-secret");
}

test("a run copies the archive to the bucket, verifies its size and records the listing", async () => {
  useCredentials();
  const fake = await startFakeS3();
  try {
    const dir = folder("remote-1");
    const result = await runSnapshot(options(dir, remoteEnv(fake), { now: at(0) }));
    assert.equal(result.code, 0, result.error ?? "");
    const key = `darius/host-a/${result.name ?? ""}`;
    assert.equal(result.remote?.key, key);
    assert.equal(fake.objects.get(key)?.length, result.bytes);
    assert.ok(fake.objects.has(`${key}.json`));
    const row = listLocalSnapshots(dir)[0];
    assert.equal(row?.remote, true);
    assert.equal(readSnapshotState(dir).remote?.objects[0]?.name, result.name);
    const manifest: { uploaded?: { key: string } } = JSON.parse(readFileSync(join(dir, `${result.name ?? ""}.json`), "utf8"));
    assert.equal(manifest.uploaded?.key, key);
  } finally {
    await fake.stop();
  }
});

test("remote retention keeps the newest N objects of this host and leaves other hosts alone", async () => {
  useCredentials();
  const fake = await startFakeS3();
  try {
    fake.objects.set("darius/host-b/darius-host-b-20260101T000000Z.tar.gz", Buffer.from("other host"));
    const dir = folder("remote-2");
    for (const second of [0, 1, 2]) {
      const result = await runSnapshot(options(dir, remoteEnv(fake, { DARIUS_SNAPSHOT_KEEP_REMOTE: "2" }), { now: at(second) }));
      assert.equal(result.code, 0, result.error ?? "");
    }
    const mine = [...fake.objects.keys()].filter((key) => key.startsWith("darius/host-a/") && key.endsWith(".tar.gz"));
    assert.deepEqual(mine.toSorted(), ["darius/host-a/darius-host-a-20261001T040001Z.tar.gz", "darius/host-a/darius-host-a-20261001T040002Z.tar.gz"]);
    assert.ok(fake.objects.has("darius/host-b/darius-host-b-20260101T000000Z.tar.gz"));
  } finally {
    await fake.stop();
  }
});

test("a bucket that cannot be reached leaves the local snapshot and exits 3", async () => {
  useCredentials();
  const fake = await startFakeS3();
  const env = remoteEnv(fake);
  await fake.stop();
  const dir = folder("remote-3");
  const result = await runSnapshot(options(dir, env, { now: at(0) }));
  assert.equal(result.code, 3);
  assert.equal(result.ok, false);
  assert.equal(listLocalSnapshots(dir).length, 1);
  assert.equal(readSnapshotState(dir).remote?.ok, false);
});

test("no key pair is a failure with a plain message, and --no-upload skips the bucket", async () => {
  clearSnapshotCredentials();
  const fake = await startFakeS3();
  try {
    const dir = folder("remote-4");
    const refused = await runSnapshot(options(dir, remoteEnv(fake), { now: at(0) }));
    assert.equal(refused.code, 1);
    assert.match(refused.error ?? "", /no access key/u);
    assert.equal(fake.objects.size, 0);
    const local = await runSnapshot(options(dir, remoteEnv(fake), { now: at(1), upload: false }));
    assert.equal(local.code, 0);
    assert.equal(local.remote, null);
  } finally {
    await fake.stop();
  }
});

test("check lists the bucket, proves a write and a delete, and delete removes one snapshot", async () => {
  useCredentials();
  const fake = await startFakeS3();
  try {
    const dir = folder("remote-5");
    const made = await runSnapshot(options(dir, remoteEnv(fake), { now: at(0) }));
    const resolved = options(dir, remoteEnv(fake)).resolved;
    const checked = await checkRemote(resolved, "host-a");
    assert.ok(checked.ok, checked.error ?? "");
    assert.equal(checked.objects.length, 1);
    assert.equal(checked.delete, "deleted");
    assert.equal(checked.versioning, "unknown", "the fake answers 501 to ?versioning by default");
    assert.deepEqual(checked.warnings, []);
    assert.equal(fake.objects.has("darius/.darius-check"), false);
    assert.equal((await deleteRemoteSnapshot(resolved, "host-b", made.name ?? "")).ok, false);
    assert.equal((await deleteRemoteSnapshot(resolved, "host-a", made.name ?? "")).ok, true);
    assert.equal(fake.objects.size, 0);
    assert.equal(readSnapshotState(dir).remote?.objects.length, 0);
  } finally {
    await fake.stop();
  }
});

// --- the no-delete mode (remote_prune = false) ---------------------------------------------------

/** Every DELETE of an object the fake saw; an abort of a multipart upload (`?uploadId=`) is not one. */
function objectDeletes(fake: { log: string[] }): string[] {
  return fake.log.filter((line) => line.startsWith("DELETE ") && !line.includes("uploadId="));
}

test("remote_prune = false: a run never sends a DELETE, keeps every object, and still records the listing", async () => {
  useCredentials();
  const fake = await startFakeS3();
  fake.deleteStatus = 403;
  try {
    const dir = folder("noprune-1");
    for (const second of [0, 1, 2]) {
      const result = await runSnapshot(options(dir, remoteEnv(fake, { DARIUS_SNAPSHOT_KEEP_REMOTE: "1", DARIUS_SNAPSHOT_REMOTE_PRUNE: "false" }), { now: at(second) }));
      assert.equal(result.code, 0, result.error ?? "");
      assert.deepEqual(result.pruned, { local: 0, remote: 0 });
    }
    assert.deepEqual(objectDeletes(fake), []);
    const archives = [...fake.objects.keys()].filter((key) => key.endsWith(".tar.gz"));
    assert.equal(archives.length, 3, "keep_remote is ignored: the bucket keeps all three");
    assert.equal(readSnapshotState(dir).remote?.objects.length, 3);

    // The same key with remote_prune on: the prune DELETE is refused and the run fails.
    const pruning = await runSnapshot(options(dir, remoteEnv(fake, { DARIUS_SNAPSHOT_KEEP_REMOTE: "1" }), { now: at(3) }));
    assert.equal(pruning.code, 1);
    assert.match(pruning.error ?? "", /HTTP 403/u);
  } finally {
    await fake.stop();
  }
});

test("remote_prune = false: delete --remote refuses before it reaches the bucket", async () => {
  useCredentials();
  const fake = await startFakeS3();
  try {
    const dir = folder("noprune-2");
    const env = remoteEnv(fake, { DARIUS_SNAPSHOT_REMOTE_PRUNE: "off" });
    const made = await runSnapshot(options(dir, env, { now: at(0) }));
    assert.equal(made.code, 0, made.error ?? "");
    const refused = await deleteRemoteSnapshot(options(dir, env).resolved, "host-a", made.name ?? "");
    assert.deepEqual(refused, { ok: false, error: "remote_prune is off: delete in the bucket by hand" });
    assert.deepEqual(objectDeletes(fake), []);
    assert.ok(fake.objects.has(`darius/host-a/${made.name ?? ""}`));
  } finally {
    await fake.stop();
  }
});

test("a failed multipart upload whose abort is refused warns with the right and the lifecycle rule", async () => {
  useCredentials();
  const fake = await startFakeS3();
  fake.abortStatus = 403;
  try {
    const s3 = createS3(remoteConfig(fake), { accessKeyId: "a", secretAccessKey: "b" });
    const failing = { size: 11 * 1024 * 1024, read: (): Promise<Uint8Array> => Promise.reject(new Error("disk went away")) };
    const warnings: string[] = [];
    await assert.rejects(s3.upload("broken", failing, { partSize: 5 * 1024 * 1024, onAbortFailed: (message) => warnings.push(message) }), /disk went away/u);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /HTTP 403/u);
    assert.match(warnings[0] ?? "", /s3:AbortMultipartUpload/u);
    assert.match(warnings[0] ?? "", /AbortIncompleteMultipartUpload/u);
  } finally {
    await fake.stop();
  }
});

interface CheckCase {
  name: string;
  prune: boolean;
  deleteStatus: number;
  versioning: string;
  /** The error status of `GET ?versioning`; 0 answers 200 with `versioning`. */
  versioningStatus: number;
  outcome: "deleted" | "refused";
  state: string;
  warnings: RegExp[];
}

const CHECK_CASES: CheckCase[] = [
  { name: "no-delete key, versioning on: ok", prune: false, deleteStatus: 403, versioning: "Enabled", versioningStatus: 0, outcome: "refused", state: "enabled", warnings: [] },
  { name: "remote_prune off but the key may delete, versioning unknown", prune: false, deleteStatus: 0, versioning: "", versioningStatus: 501, outcome: "deleted", state: "unknown", warnings: [/the key may delete objects.*s3:DeleteObjectVersion/u, /versioning is unknown: an overwrite loses the old copy/u] },
  { name: "no-delete key, versioning never turned on", prune: false, deleteStatus: 403, versioning: "", versioningStatus: 0, outcome: "refused", state: "off", warnings: [/versioning is off/u] },
  { name: "no-delete key, versioning suspended", prune: false, deleteStatus: 403, versioning: "Suspended", versioningStatus: 0, outcome: "refused", state: "suspended", warnings: [/versioning is suspended/u] },
  { name: "remote_prune on with a no-delete key", prune: true, deleteStatus: 403, versioning: "Enabled", versioningStatus: 0, outcome: "refused", state: "enabled", warnings: [/the key cannot delete, but remote_prune is on: pruning will fail/u] },
  { name: "remote_prune on, the key may delete, a backend without versioning (405)", prune: true, deleteStatus: 0, versioning: "", versioningStatus: 405, outcome: "deleted", state: "unknown", warnings: [] },
  { name: "the key may not read versioning (403)", prune: false, deleteStatus: 403, versioning: "", versioningStatus: 403, outcome: "refused", state: "unknown", warnings: [/versioning is unknown/u, /s3:GetBucketVersioning/u] },
];

for (const item of CHECK_CASES) {
  test(`check: ${item.name}`, async () => {
    useCredentials();
    const fake = await startFakeS3();
    fake.deleteStatus = item.deleteStatus;
    fake.versioning = item.versioning;
    fake.versioningStatus = item.versioningStatus;
    try {
      const dir = folder(`check-${item.name.replace(/[^a-z0-9]+/gu, "-")}`);
      const resolved = options(dir, remoteEnv(fake, { DARIUS_SNAPSHOT_REMOTE_PRUNE: String(item.prune) })).resolved;
      const checked = await checkRemote(resolved, "host-a");
      assert.ok(checked.ok, checked.error ?? "");
      assert.equal(checked.delete, item.outcome);
      assert.equal(checked.versioning, item.state);
      assert.equal(checked.remotePrune, item.prune);
      assert.equal(checked.warnings.length, item.warnings.length, checked.warnings.join(" | "));
      item.warnings.forEach((pattern, index) => assert.match(checked.warnings[index] ?? "", pattern));
      assert.equal(fake.objects.has("darius/.darius-check"), item.outcome === "refused", "a refused delete leaves the probe");
      const stored = readSnapshotState(dir).check;
      assert.deepEqual(stored === null ? null : { ...stored, at: "" }, { at: "", delete: item.outcome, versioning: item.state, remotePrune: item.prune, warnings: checked.warnings });
    } finally {
      await fake.stop();
    }
  });
}

test("check: the probe has a fixed key, so a no-delete key overwrites it and never piles objects up", async () => {
  useCredentials();
  const fake = await startFakeS3();
  fake.deleteStatus = 403;
  try {
    const resolved = options(folder("check-fixed"), remoteEnv(fake, { DARIUS_SNAPSHOT_REMOTE_PRUNE: "false" })).resolved;
    for (let round = 0; round < 3; round += 1) assert.equal((await checkRemote(resolved, "host-a")).delete, "refused");
    assert.deepEqual([...fake.objects.keys()], ["darius/.darius-check"]);
  } finally {
    await fake.stop();
  }
});

test("check: a DELETE answered with another status, or a failed write, is a failed check", async () => {
  useCredentials();
  const fake = await startFakeS3();
  fake.deleteStatus = 500;
  try {
    const dir = folder("check-500");
    const checked = await checkRemote(options(dir, remoteEnv(fake)).resolved, "host-a");
    assert.equal(checked.ok, false);
    assert.equal(checked.delete, null);
    assert.match(checked.error ?? "", /HTTP 500/u);
    assert.equal(readSnapshotState(dir).remote?.ok, false);
    assert.equal(readSnapshotState(dir).check, null);
  } finally {
    await fake.stop();
  }
});

// --- multipart --------------------------------------------------------------------------------------

function remoteConfig(fake: { endpoint: string; bucket: string }): RemoteConfig {
  return { endpoint: fake.endpoint, bucket: fake.bucket, region: "us-east-1", path_style: true, allow_http: true, sse: false, credentials: "" };
}

function memorySource(data: Buffer): UploadSource {
  return { size: data.length, read: (offset, length) => Promise.resolve(data.subarray(offset, offset + length)) };
}

test("a source over one part goes up in one PUT, a larger one in parts that assemble to the same bytes", async () => {
  const fake = await startFakeS3();
  try {
    const s3 = createS3(remoteConfig(fake), { accessKeyId: "a", secretAccessKey: "b" });
    const small = randomBytes(1000);
    const one = await s3.upload("small", memorySource(small));
    assert.equal(one.parts, 1);
    assert.deepEqual(fake.objects.get("small"), small);

    const large = randomBytes(11 * 1024 * 1024);
    const many = await s3.upload("large", memorySource(large), { partSize: 5 * 1024 * 1024 });
    assert.equal(many.parts, 3);
    assert.equal(many.size, large.length);
    assert.ok(fake.objects.get("large")?.equals(large));
    assert.equal(fake.uploads.size, 0);
  } finally {
    await fake.stop();
  }
});

test("a part that fails once is tried again, and a part that keeps failing aborts the upload", async () => {
  const fake = await startFakeS3();
  try {
    const s3 = createS3(remoteConfig(fake), { accessKeyId: "a", secretAccessKey: "b" });
    const data = randomBytes(11 * 1024 * 1024);
    fake.failPart = 2;
    const retried = await s3.upload("retry", memorySource(data), { partSize: 5 * 1024 * 1024 });
    assert.equal(retried.parts, 3);
    assert.ok(fake.objects.get("retry")?.equals(data));

    const failing = { size: data.length, read: (): Promise<Uint8Array> => Promise.reject(new Error("disk went away")) };
    await assert.rejects(s3.upload("broken", failing, { partSize: 5 * 1024 * 1024 }), /disk went away/u);
    assert.equal(fake.uploads.size, 0);
    assert.equal(fake.objects.has("broken"), false);
    assert.ok(fake.log.some((line) => line.startsWith("DELETE /backups/broken?uploadId=")));
  } finally {
    await fake.stop();
  }
});

test("a part answered with a client error is not retried", async () => {
  const fake = await startFakeS3();
  try {
    const s3 = createS3(remoteConfig(fake), { accessKeyId: "a", secretAccessKey: "b" });
    fake.uploads.clear();
    const data = randomBytes(6 * 1024 * 1024);
    // An upload id the server does not know: the first part gets a 404.
    const original = fake.uploads.set.bind(fake.uploads);
    fake.uploads.set = (id, parts) => original(`${id}-gone`, parts);
    await assert.rejects(s3.upload("nope", memorySource(data), { partSize: 5 * 1024 * 1024 }), S3Error);
    assert.equal(fake.log.filter((line) => line.startsWith("PUT /backups/nope?partNumber=1")).length, 1);
  } finally {
    await fake.stop();
  }
});

/** No systemd user session: status must never ask the real one. */
const noSystemd: SnapshotDeps = {
  systemctl: () => {
    throw new Error("systemctl: not found");
  },
  stdinIsTTY: () => false,
  readStdin: () => "",
};

// --- the command -----------------------------------------------------------------------------------------

test("the command refuses an unknown verb and reports status as JSON", async () => {
  await assert.rejects(snapshotCommand.run({ positional: ["nope"], flags: {}, json: false, repeated: {} }), UsageError);
  const lines: string[] = [];
  const log = console.log;
  console.log = (line: string) => lines.push(line);
  process.env.DARIUS_SNAPSHOT_DIR = folder("cli");
  try {
    const code = await runSnapshotCommand({ positional: ["status"], flags: {}, json: true, repeated: {} }, noSystemd);
    assert.equal(code, 0);
  } finally {
    console.log = log;
    delete process.env.DARIUS_SNAPSHOT_DIR;
  }
  const parsed: { enabled: boolean; credentials: string; settings: { keep: { value: number; source: string } } } = JSON.parse(lines.join(""));
  assert.equal(parsed.enabled, true);
  assert.equal(parsed.settings.keep.value, 7);
  assert.ok(readdirSync(sandbox).length > 0);
});

test("create with enabled = false does nothing and exits 0; status shows a failed bucket on its own line", async () => {
  const lines: string[] = [];
  const log = console.log;
  console.log = (line: string) => lines.push(line);
  process.env.DARIUS_SNAPSHOT_DIR = folder("cli-off");
  process.env.DARIUS_SNAPSHOT_ENABLED = "false";
  try {
    assert.equal(await snapshotCommand.run({ positional: ["create"], flags: {}, json: false, repeated: {} }), 0);
    assert.match(lines.join("\n"), /snapshots are off/u);
    assert.deepEqual(listLocalSnapshots(folder("cli-off")), []);

    delete process.env.DARIUS_SNAPSHOT_ENABLED;
    mkdirSync(folder("cli-off"), { recursive: true });
    writeFileSync(join(folder("cli-off"), "status.json"), JSON.stringify({ v: 1, last: { at: "2026-10-01T04:00:00.000Z", ok: true, name: "x", error: null }, remote: { at: "2026-10-01T04:00:01.000Z", ok: false, error: "no response", objects: [] } }));
    lines.length = 0;
    await runSnapshotCommand({ positional: ["status"], flags: {}, json: false, repeated: {} }, noSystemd);
    assert.match(lines.join("\n"), /last run .*ok/u);
    assert.match(lines.join("\n"), /bucket, last contact .*failed, no response/u);
  } finally {
    console.log = log;
    delete process.env.DARIUS_SNAPSHOT_DIR;
    delete process.env.DARIUS_SNAPSHOT_ENABLED;
  }
});

/** Runs one snapshot verb with the given env set, and gives back the exit code and what it printed. */
async function runVerb(positional: string[], flags: Record<string, string | boolean>, json: boolean, env: NodeJS.ProcessEnv): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (line: string) => lines.push(line);
  console.error = (line: string) => lines.push(line);
  const saved = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
  Object.assign(process.env, env);
  try {
    const code = await runSnapshotCommand({ positional, flags, json, repeated: {} }, noSystemd);
    return { code, out: lines.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("the CLI with remote_prune = false: create exits 0 on a no-delete key, delete --remote exits 1, status says the bucket keeps them", async () => {
  useCredentials();
  const fake = await startFakeS3();
  fake.deleteStatus = 403;
  fake.versioning = "Enabled";
  fake.versioningStatus = 0;
  try {
    const env = { DARIUS_SNAPSHOT_DIR: folder("cli-noprune"), DARIUS_SNAPSHOT_REMOTE_PRUNE: "false", DARIUS_SNAPSHOT_KEEP_REMOTE: "1", ...remoteEnv(fake) };
    const first = await runVerb(["create"], {}, true, env);
    assert.equal(first.code, 0, first.out);
    assert.equal((await runVerb(["create"], {}, false, env)).code, 0);
    assert.deepEqual(objectDeletes(fake), []);
    const name: string = JSON.parse(first.out).name;
    const removed = await runVerb(["delete", name], { remote: true }, false, env);
    assert.equal(removed.code, 1);
    assert.match(removed.out, /remote_prune is off: delete in the bucket by hand/u);

    const checked = await runVerb(["check"], {}, false, env);
    assert.equal(checked.code, 0, checked.out);
    assert.match(checked.out, /delete: refused \(HTTP 403\)\. The probe darius\/\.darius-check stays; the next check overwrites it/u);
    assert.match(checked.out, /versioning: enabled/u);
    assert.match(checked.out, /^ok: the key cannot delete, the bucket keeps history$/mu);

    const status = await runVerb(["status"], {}, false, env);
    assert.match(status.out, /remote: kept by the bucket \(remote_prune off\)/u);
    assert.match(status.out, /keep_remote \(1\) is ignored/u);
    assert.match(status.out, /bucket check .*: delete refused, versioning enabled/u);
    const statusJson: { check: { delete: string; versioning: string; warnings: string[] } } = JSON.parse((await runVerb(["status"], {}, true, env)).out);
    assert.deepEqual({ ...statusJson.check, at: undefined, remotePrune: undefined }, { at: undefined, remotePrune: undefined, delete: "refused", versioning: "enabled", warnings: [] });

    const config = await runVerb(["config"], {}, false, env);
    assert.match(config.out, /^remote_prune += false {2}\(env DARIUS_SNAPSHOT_REMOTE_PRUNE\)$/mu);
  } finally {
    await fake.stop();
  }
});

test("the CLI check: warnings exit 0, print one line each, and --json carries delete, versioning and warnings", async () => {
  useCredentials();
  const fake = await startFakeS3();
  fake.deleteStatus = 403;
  try {
    const env = { DARIUS_SNAPSHOT_DIR: folder("cli-check-warn"), ...remoteEnv(fake) };
    const text = await runVerb(["check"], {}, false, env);
    assert.equal(text.code, 0, text.out);
    assert.match(text.out, /^! the key cannot delete, but remote_prune is on: pruning will fail\. Set remote_prune false$/mu);
    assert.match(text.out, /^1 warning: /mu);
    const json: { ok: boolean; delete: string; versioning: string; warnings: string[] } = JSON.parse((await runVerb(["check"], {}, true, env)).out);
    assert.equal(json.ok, true);
    assert.equal(json.delete, "refused");
    assert.equal(json.versioning, "unknown");
    assert.equal(json.warnings.length, 1);

    const status = await runVerb(["status"], {}, false, { ...env, DARIUS_SNAPSHOT_REMOTE_PRUNE: "false" });
    assert.match(status.out, /remote_prune changed since the last check/u);
  } finally {
    await fake.stop();
  }
});

// --- fetch ----------------------------------------------------------------------------------------

test("fetch copies a snapshot and its manifest from the bucket with GET only, and checks size and SHA-256", async () => {
  useCredentials();
  const fake = await startFakeS3();
  try {
    const made = await runSnapshot(options(folder("fetch-src"), remoteEnv(fake), { now: at(0) }));
    assert.equal(made.code, 0, made.error ?? "");
    const name = made.name ?? "";
    const key = `darius/host-a/${name}`;
    const into = options(folder("fetch-dst"), remoteEnv(fake)).resolved;
    fake.log.length = 0;
    const done = await fetchRemoteSnapshot(into, name);
    assert.equal(done.code, 0, done.ok ? "" : done.error);
    const archive = join(folder("fetch-dst"), name);
    assert.ok(readFileSync(archive).equals(fake.objects.get(key) ?? Buffer.alloc(0)));
    const manifest: { sha256: string; bytes: number } = JSON.parse(readFileSync(`${archive}.json`, "utf8"));
    assert.equal(manifest.sha256, createHash("sha256").update(readFileSync(archive)).digest("hex"));
    assert.ok(fake.log.length >= 2);
    assert.deepEqual(fake.log.filter((line) => !line.startsWith("GET ")), []);

    // Already here: no request at all.
    fake.log.length = 0;
    const again = await fetchRemoteSnapshot(into, name);
    assert.equal(again.ok && again.already, true);
    assert.deepEqual(fake.log, []);

    // A bucket copy that does not match its manifest is refused and leaves no file.
    fake.objects.set(key, (fake.objects.get(key) ?? Buffer.alloc(0)).subarray(1));
    const other = options(folder("fetch-bad"), remoteEnv(fake)).resolved;
    const bad = await fetchRemoteSnapshot(other, name);
    assert.equal(bad.code, 1);
    assert.match(bad.ok ? "" : bad.error, /bytes, the manifest says/u);
    assert.equal(existsSync(join(folder("fetch-bad"), name)), false);
    assert.equal((await fetchRemoteSnapshot(other, "not-a-snapshot.tar.gz")).code, 1);
    assert.equal((await fetchRemoteSnapshot(other, "darius-host-a-20200101T000000Z.tar.gz")).code, 1);
  } finally {
    await fake.stop();
  }
  const env = remoteEnv(fake);
  const offline = await fetchRemoteSnapshot(options(folder("fetch-off"), env).resolved, "darius-host-a-20261001T040000Z.tar.gz");
  assert.equal(offline.code, 3);
  await assert.rejects(runSnapshotCommand({ positional: ["fetch"], flags: {}, json: false, repeated: {} }, noSystemd), UsageError);
});

// --- monthly copies (keep_monthly) ---------------------------------------------------------------

/** A run time in 2026: `month` is 1 to 12, `day` the day of that month. */
function inMonth(month: number, day = 1, second = 0): Date {
  return new Date(Date.UTC(2026, month - 1, day, 4, 0, second));
}

function monthlyKeys(fake: { objects: Map<string, Buffer> }): string[] {
  return [...fake.objects.keys()].filter((key) => key.includes("/monthly/") && key.endsWith(".tar.gz")).toSorted();
}

test("keep_monthly copies the first good snapshot of a UTC month on the server, once, with its manifest", async () => {
  useCredentials();
  const fake = await startFakeS3();
  try {
    const dir = folder("monthly-1");
    const env = remoteEnv(fake, { DARIUS_SNAPSHOT_KEEP_MONTHLY: "3" });
    const first = await runSnapshot(options(dir, env, { now: inMonth(10, 1) }));
    assert.equal(first.code, 0, first.error ?? "");
    assert.deepEqual(first.warnings, []);
    const daily = `darius/host-a/${first.name ?? ""}`;
    const monthly = `darius/host-a/monthly/${first.name ?? ""}`;
    assert.equal(first.monthly.copied, monthly);
    assert.ok(fake.objects.get(monthly)?.equals(fake.objects.get(daily) ?? Buffer.alloc(0)));
    const manifest: { sha256: string; uploaded: { key: string } } = JSON.parse(fake.objects.get(`${monthly}.json`)?.toString("utf8") ?? "{}");
    assert.equal(manifest.sha256, createHash("sha256").update(fake.objects.get(monthly) ?? Buffer.alloc(0)).digest("hex"));
    assert.equal(manifest.uploaded.key, monthly);
    assert.ok(fake.log.some((line) => line.startsWith(`PUT /backups/${monthly}`)));

    // The daily listing and its record do not see the monthly folder.
    const state = readSnapshotState(dir).remote;
    assert.deepEqual(state?.objects.map((object) => object.name), [first.name]);
    assert.deepEqual(state?.monthly?.map((object) => object.name), [first.name]);

    // Later the same month: no second copy.
    const before = fake.log.length;
    const second = await runSnapshot(options(dir, env, { now: inMonth(10, 20) }));
    assert.equal(second.code, 0, second.error ?? "");
    assert.equal(second.monthly.copied, null);
    assert.deepEqual(monthlyKeys(fake), [monthly]);
    assert.equal(fake.log.slice(before).some((line) => line.includes("/monthly/") && line.startsWith("PUT ")), false);

    // The next month copies again.
    const third = await runSnapshot(options(dir, env, { now: inMonth(11, 2) }));
    assert.equal(third.monthly.copied, `darius/host-a/monthly/${third.name ?? ""}`);
    assert.equal(monthlyKeys(fake).length, 2);
  } finally {
    await fake.stop();
  }
});

test("a monthly copy without its manifest is not done: the next run of that month redoes it", async () => {
  useCredentials();
  const fake = await startFakeS3();
  try {
    const dir = folder("monthly-half");
    const env = remoteEnv(fake, { DARIUS_SNAPSHOT_KEEP_MONTHLY: "3" });
    const first = await runSnapshot(options(dir, env, { now: inMonth(10, 1) }));
    assert.equal(first.code, 0, first.error ?? "");
    const half = `darius/host-a/monthly/${first.name ?? ""}`;
    // The run stopped after the copy, before the manifest.
    fake.objects.delete(`${half}.json`);

    const second = await runSnapshot(options(dir, env, { now: inMonth(10, 20) }));
    assert.equal(second.code, 0, second.error ?? "");
    assert.deepEqual(second.warnings, []);
    const monthly = `darius/host-a/monthly/${second.name ?? ""}`;
    assert.equal(second.monthly.copied, monthly);
    assert.ok(fake.objects.has(`${monthly}.json`));
    assert.deepEqual(monthlyKeys(fake), [monthly], "remote_prune removes the copy that had no manifest");
    assert.deepEqual(readSnapshotState(dir).remote?.monthly?.map((object) => object.name), [second.name]);

    const third = await runSnapshot(options(dir, env, { now: inMonth(10, 21) }));
    assert.equal(third.monthly.copied, null, "a copy with its manifest is done");
  } finally {
    await fake.stop();
  }
});

test("keep_monthly = 0 (the default) makes no monthly copy and lists nothing extra", async () => {
  useCredentials();
  const fake = await startFakeS3();
  try {
    const result = await runSnapshot(options(folder("monthly-off"), remoteEnv(fake), { now: inMonth(10) }));
    assert.equal(result.code, 0, result.error ?? "");
    assert.deepEqual(result.monthly, { copied: null, pruned: 0 });
    assert.deepEqual(monthlyKeys(fake), []);
    assert.equal(fake.log.some((line) => line.includes("monthly")), false);
  } finally {
    await fake.stop();
  }
});

test("with remote_prune on, the monthly folder is pruned to keep_monthly and the daily prune leaves it alone", async () => {
  useCredentials();
  const fake = await startFakeS3();
  try {
    const dir = folder("monthly-2");
    const env = remoteEnv(fake, { DARIUS_SNAPSHOT_KEEP_MONTHLY: "2", DARIUS_SNAPSHOT_KEEP_REMOTE: "1" });
    const names: string[] = [];
    for (const month of [8, 9, 10, 11]) {
      const result = await runSnapshot(options(dir, env, { now: inMonth(month) }));
      assert.equal(result.code, 0, result.error ?? "");
      names.push(result.name ?? "");
    }
    assert.deepEqual(monthlyKeys(fake), names.slice(2).map((name) => `darius/host-a/monthly/${name}`));
    assert.ok(fake.objects.has(`darius/host-a/monthly/${names[2] ?? ""}.json`));
    assert.equal(fake.objects.has(`darius/host-a/monthly/${names[0] ?? ""}.json`), false, "the manifest goes with its archive");
    const daily = [...fake.objects.keys()].filter((key) => key.startsWith("darius/host-a/darius-") && key.endsWith(".tar.gz"));
    assert.deepEqual(daily, [`darius/host-a/${names[3] ?? ""}`]);
    assert.deepEqual(readSnapshotState(dir).remote?.monthly?.map((object) => object.name), [names[3], names[2]]);
  } finally {
    await fake.stop();
  }
});

test("remote_prune = false: monthly copies are made and never deleted", async () => {
  useCredentials();
  const fake = await startFakeS3();
  fake.deleteStatus = 403;
  try {
    const dir = folder("monthly-3");
    const env = remoteEnv(fake, { DARIUS_SNAPSHOT_KEEP_MONTHLY: "1", DARIUS_SNAPSHOT_REMOTE_PRUNE: "false" });
    for (const month of [9, 10, 11]) {
      const result = await runSnapshot(options(dir, env, { now: inMonth(month) }));
      assert.equal(result.code, 0, result.error ?? "");
      assert.deepEqual(result.monthly.pruned, 0);
      assert.deepEqual(result.warnings, []);
    }
    assert.equal(monthlyKeys(fake).length, 3, "keep_monthly is not a delete order without remote_prune");
    assert.deepEqual(objectDeletes(fake), []);
    assert.equal(readSnapshotState(dir).remote?.monthly?.length, 3);
  } finally {
    await fake.stop();
  }
});

test("a backend that answers 400 to CopyObject gets an upload of the archive; another failure is a warning, not a failed run", async () => {
  useCredentials();
  const fake = await startFakeS3();
  try {
    const env = remoteEnv(fake, { DARIUS_SNAPSHOT_KEEP_MONTHLY: "2" });
    fake.copyStatus = 400;
    const viaUpload = await runSnapshot(options(folder("monthly-4"), env, { now: inMonth(10) }));
    assert.equal(viaUpload.code, 0, viaUpload.error ?? "");
    assert.deepEqual(viaUpload.warnings, []);
    const key = `darius/host-a/monthly/${viaUpload.name ?? ""}`;
    assert.ok(fake.objects.get(key)?.equals(fake.objects.get(`darius/host-a/${viaUpload.name ?? ""}`) ?? Buffer.alloc(0)));

    fake.copyStatus = 500;
    const failed = await runSnapshot(options(folder("monthly-4"), env, { now: inMonth(11) }));
    assert.equal(failed.code, 0, "the daily copy is safe");
    assert.equal(failed.remote?.ok, true);
    assert.equal(failed.monthly.copied, null);
    assert.match(failed.warnings.join("; "), /the monthly copy failed: .*HTTP 500/u);
    assert.deepEqual(monthlyKeys(fake), [key]);

    // The next run of that month tries again.
    fake.copyStatus = 0;
    const retried = await runSnapshot(options(folder("monthly-4"), env, { now: inMonth(11, 2) }));
    assert.equal(retried.monthly.copied, `darius/host-a/monthly/${retried.name ?? ""}`);
  } finally {
    await fake.stop();
  }
});

test("a run that fails to upload makes no monthly copy", async () => {
  useCredentials();
  const fake = await startFakeS3();
  const env = remoteEnv(fake, { DARIUS_SNAPSHOT_KEEP_MONTHLY: "2" });
  await fake.stop();
  const result = await runSnapshot(options(folder("monthly-5"), env, { now: inMonth(10) }));
  assert.equal(result.code, 3);
  assert.equal(result.monthly.copied, null);
});

test("snapshot fetch takes monthly/<name>, and list --remote tags the monthly copies", async () => {
  useCredentials();
  const fake = await startFakeS3();
  try {
    const env = remoteEnv(fake, { DARIUS_SNAPSHOT_KEEP_MONTHLY: "2" });
    const made = await runSnapshot(options(folder("monthly-6"), env, { now: inMonth(10) }));
    assert.equal(made.code, 0, made.error ?? "");
    const name = made.name ?? "";
    const into = options(folder("monthly-6-dst"), env).resolved;
    const done = await fetchRemoteSnapshot(into, `monthly/${name}`);
    assert.equal(done.ok, true, done.ok ? "" : done.error);
    assert.equal(done.ok ? done.name : "", name);
    assert.ok(readFileSync(join(folder("monthly-6-dst"), name)).equals(fake.objects.get(`darius/host-a/monthly/${name}`) ?? Buffer.alloc(0)));
    assert.equal((await fetchRemoteSnapshot(options(folder("monthly-6-none"), env).resolved, "monthly/darius-host-a-20200101T000000Z.tar.gz")).code, 1);

    // The CLI names the host itself, so it makes its own snapshot.
    const cli = { ...env, DARIUS_SNAPSHOT_DIR: folder("monthly-6-cli") };
    const created = await runVerb(["create"], {}, true, cli);
    assert.equal(created.code, 0, created.out);
    const cliName: string = JSON.parse(created.out).name;
    assert.equal(JSON.parse(created.out).monthly.copied.endsWith(`/monthly/${cliName}`), true);
    const json = await runVerb(["list"], { remote: true }, true, cli);
    assert.equal(json.code, 0, json.out);
    const listed: { remote: Array<{ name: string; monthly: boolean }> } = JSON.parse(json.out);
    assert.deepEqual(listed.remote.map((row) => [row.name, row.monthly]), [[cliName, false], [`monthly/${cliName}`, true]]);
    const text = await runVerb(["list"], { remote: true }, false, cli);
    assert.match(text.out, new RegExp(`^monthly/${cliName.replaceAll(".", "\\.")}  .* MiB  also here  monthly$`, "mu"));
    const status = await runVerb(["status"], {}, false, cli);
    assert.match(status.out, new RegExp(`monthly copies: keep 2, newest monthly/${cliName.replaceAll(".", "\\.")}`, "u"));
  } finally {
    await fake.stop();
  }
});

// --- the dead-man ping ----------------------------------------------------------------------------

interface PingServer {
  base: string;
  /** Every request path, in order. */
  paths: string[];
  /** The status to answer; 0 never answers. */
  status: number;
  /** A Location header for a 3xx answer. */
  location: string;
  stop(): Promise<void>;
}

const PING_PATH = "/ping-secret-uuid-1234";

async function startPingServer(): Promise<PingServer> {
  const sockets = new Set<Socket>();
  const paths: string[] = [];
  const state = { status: 200, location: "" };
  const server = createServer((request, response) => {
    paths.push(request.url ?? "");
    if (state.status === 0) return;
    response.writeHead(state.status, state.location === "" ? {} : { location: state.location });
    response.end("OK");
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  // SAFETY: a server listening on a TCP port reports an AddressInfo, never a pipe name or null.
  const port = (server.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${String(port)}`,
    paths,
    get status() {
      return state.status;
    },
    set status(value: number) {
      state.status = value;
    },
    get location() {
      return state.location;
    },
    set location(value: string) {
      state.location = value;
    },
    stop: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => {
          resolve();
        });
      }),
  };
}

function pingEnv(ping: PingServer, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { DARIUS_SNAPSHOT_PING_URL: `${ping.base}${PING_PATH}`, DARIUS_SNAPSHOT_ALLOW_HTTP: "true", ...extra };
}

test("a good run sends one GET to ping_url; the exit code and the result are the run's own", async () => {
  const ping = await startPingServer();
  try {
    const result = await runSnapshot(options(folder("ping-1"), pingEnv(ping), { now: at(0) }));
    assert.equal(result.code, 0, result.error ?? "");
    assert.deepEqual(ping.paths, [PING_PATH]);
    assert.deepEqual(result.warnings, []);
  } finally {
    await ping.stop();
  }
});

test("a trailing slash in ping_url does not double: the ok ping keeps the address, the fail ping adds /fail", () => {
  assert.equal(pingTarget("https://hc.example.com/abc/", "ok"), "https://hc.example.com/abc");
  assert.equal(pingTarget("https://hc.example.com/abc/", "fail"), "https://hc.example.com/abc/fail");
  assert.equal(pingKindFor({ code: 0, remote: null }), "ok");
  assert.equal(pingKindFor({ code: 0, remote: { ok: true, key: "k", error: null } }), "ok");
  assert.equal(pingKindFor({ code: 0, remote: { ok: false, key: null, error: "x" } }), "fail");
  assert.equal(pingKindFor({ code: 3, remote: { ok: false, key: null, error: "x" } }), "fail");
  assert.equal(pingKindFor({ code: 1, remote: null }), "fail");
});

test("a failed run, and a run whose bucket copy failed, send /fail", async () => {
  const ping = await startPingServer();
  try {
    const missing = options(folder("ping-2"), pingEnv(ping), { now: at(0), stateDir: join(sandbox, "no-such-store") });
    const failed = await runSnapshot(missing);
    assert.equal(failed.code, 1);
    assert.deepEqual(ping.paths, [`${PING_PATH}/fail`]);

    useCredentials();
    const fake = await startFakeS3();
    const env = pingEnv(ping, remoteEnv(fake));
    await fake.stop();
    const offline = await runSnapshot(options(folder("ping-3"), env, { now: at(1) }));
    assert.equal(offline.code, 3);
    assert.deepEqual(ping.paths, [`${PING_PATH}/fail`, `${PING_PATH}/fail`]);
  } finally {
    await ping.stop();
  }
});

test("a run whose bucket copy worked pings ok, and --no-upload on a host with a bucket sends nothing", async () => {
  useCredentials();
  const ping = await startPingServer();
  const fake = await startFakeS3();
  try {
    const env = pingEnv(ping, remoteEnv(fake));
    assert.equal((await runSnapshot(options(folder("ping-4"), env, { now: at(0) }))).code, 0);
    assert.equal((await runSnapshot(options(folder("ping-4"), env, { now: at(1), upload: false }))).code, 0);
    assert.deepEqual(ping.paths, [PING_PATH], "a run without the upload proves nothing about the bucket");
  } finally {
    await fake.stop();
    await ping.stop();
  }
});

test("a ping that fails is a warning without the address, and the run still succeeds", async () => {
  const ping = await startPingServer();
  try {
    ping.status = 500;
    const http500 = await runSnapshot(options(folder("ping-5"), pingEnv(ping), { now: at(0) }));
    assert.equal(http500.code, 0);
    assert.equal(http500.ok, true);
    assert.equal(http500.warnings.length, 1);
    assert.match(http500.warnings[0] ?? "", /^the dead-man ping to 127\.0\.0\.1:\d+ answered HTTP 500$/u);

    ping.status = 302;
    ping.location = "http://127.0.0.1:1/elsewhere";
    const redirect = await runSnapshot(options(folder("ping-5"), pingEnv(ping), { now: at(1) }));
    assert.equal(redirect.code, 0);
    assert.equal(redirect.warnings.length, 1, "a redirect is refused, not followed");

    ping.status = 0;
    const slow = await runSnapshot(options(folder("ping-5"), pingEnv(ping), { now: at(2), pingTimeoutMs: 150 }));
    assert.equal(slow.code, 0);
    assert.equal(slow.warnings.length, 1);

    await ping.stop();
    const refused = await runSnapshot(options(folder("ping-5"), pingEnv(ping), { now: at(3) }));
    assert.equal(refused.code, 0);
    assert.equal(refused.warnings.length, 1);
    for (const warning of [...http500.warnings, ...redirect.warnings, ...slow.warnings, ...refused.warnings]) {
      assert.equal(warning.includes("ping-secret"), false, warning);
      assert.equal(warning.includes(PING_PATH), false, warning);
      assert.match(warning, /^the dead-man ping to 127\.0\.0\.1:\d+ /u);
    }
  } finally {
    await ping.stop();
  }
});

test("no ping_url, a refused run (lock held) and snapshots off send nothing", async () => {
  const ping = await startPingServer();
  try {
    await runSnapshot(options(folder("ping-6"), {}, { now: at(0) }));
    assert.deepEqual(ping.paths, []);

    const dir = folder("ping-7");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "lock.json"), JSON.stringify({ pid: process.pid, startedAt: at(0).toISOString() }));
    const busy = await runSnapshot(options(dir, pingEnv(ping), { now: at(1) }));
    assert.equal(busy.busy, true);
    assert.deepEqual(ping.paths, []);

    const off = await runSnapshot(options(folder("ping-8"), pingEnv(ping, { DARIUS_SNAPSHOT_ENABLED: "false" }), { now: at(2) }));
    assert.equal(off.code, 1);
    assert.deepEqual(ping.paths, []);
  } finally {
    await ping.stop();
  }
});

test("ping_url: empty by default, checked in every layer, plain http only with allow_http on loopback or the tailnet", () => {
  const resolve = (env: NodeJS.ProcessEnv, file: Map<"ping_url", string> = new Map(), config: Record<string, string> = {}) =>
    resolveSnapshotSettings({ env, file, config, stateDir: stateRoot, configDir: configRoot });
  assert.equal(resolve({}).settings.pingUrl, null);
  assert.equal(resolve({}).values.get("ping_url"), "");
  assert.equal(resolve({ DARIUS_SNAPSHOT_PING_URL: "https://hc.example.com/abc" }).settings.pingUrl, "https://hc.example.com/abc");
  assert.equal(resolve({}, new Map([["ping_url", "https://hc.example.com/file"]]), { ping_url: "https://hc.example.com/config" }).settings.pingUrl, "https://hc.example.com/file");
  assert.equal(resolve({}, new Map(), { ping_url: "https://hc.example.com/config" }).sources.get("ping_url"), "config");

  for (const bad of ["ftp://hc.example.com/abc", "not a url", "https://hc.example.com/abc?x=1", "https://user@hc.example.com/abc", "https://hc.example.com/abc#frag", "https://hc.example.com/..."]) {
    const found = resolve({ DARIUS_SNAPSHOT_PING_URL: bad });
    assert.equal(found.problems.length, 1, bad);
    assert.equal(found.settings.pingUrl, null, bad);
    assert.equal(found.problems[0]?.includes("hc.example.com"), false, `the problem does not repeat the address: ${bad}`);
  }

  const http = resolve({ DARIUS_SNAPSHOT_PING_URL: "http://hc.example.com/abc" });
  assert.equal(http.settings.pingUrl, null);
  assert.match(http.problems.join(";"), /plain http/u);
  assert.equal(http.problems.join(";").includes("hc.example.com"), false);
  assert.equal(resolve({ DARIUS_SNAPSHOT_PING_URL: "http://hc.example.com/abc", DARIUS_SNAPSHOT_ALLOW_HTTP: "true" }).settings.pingUrl, null, "allow_http limits plain http to loopback and the tailnet");
  assert.equal(resolve({ DARIUS_SNAPSHOT_PING_URL: "http://127.0.0.1:8080/abc", DARIUS_SNAPSHOT_ALLOW_HTTP: "true" }).settings.pingUrl, "http://127.0.0.1:8080/abc");
  assert.equal(resolve({ DARIUS_SNAPSHOT_PING_URL: "http://100.64.1.2/abc", DARIUS_SNAPSHOT_ALLOW_HTTP: "true" }).settings.pingUrl, "http://100.64.1.2/abc");
  assert.equal(maskPingUrl("https://hc.example.com/abc-secret?x=1"), "https://hc.example.com/...");
  assert.equal(maskPingUrl(""), "");
});
