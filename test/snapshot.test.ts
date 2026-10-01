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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { UsageError } from "../src/cli/registry.ts";
import { snapshotCommand } from "../src/cli/snapshot.ts";
import { createS3, S3Error, type RemoteConfig, type UploadSource } from "../src/core/s3.ts";
import {
  checkRemote,
  deleteLocalSnapshot,
  deleteRemoteSnapshot,
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
  planSnapshotSave,
  readSnapshotCredentials,
  readSnapshotFile,
  resolveSnapshotSettings,
  snapshotCredentialsPath,
  writeSnapshotCredentials,
  writeSnapshotFile,
} from "../src/core/snapshot-settings.ts";
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
    assert.equal(fake.objects.has("darius/.darius-check"), false);
    assert.equal((await deleteRemoteSnapshot(resolved, "host-b", made.name ?? "")).ok, false);
    assert.equal((await deleteRemoteSnapshot(resolved, "host-a", made.name ?? "")).ok, true);
    assert.equal(fake.objects.size, 0);
    assert.equal(readSnapshotState(dir).remote?.objects.length, 0);
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

// --- the command -----------------------------------------------------------------------------------------

test("the command refuses an unknown verb and reports status as JSON", async () => {
  await assert.rejects(snapshotCommand.run({ positional: ["nope"], flags: {}, json: false, repeated: {} }), UsageError);
  const lines: string[] = [];
  const log = console.log;
  console.log = (line: string) => lines.push(line);
  process.env.DARIUS_SNAPSHOT_DIR = folder("cli");
  try {
    const code = await snapshotCommand.run({ positional: ["status"], flags: {}, json: true, repeated: {} });
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
    await snapshotCommand.run({ positional: ["status"], flags: {}, json: false, repeated: {} });
    assert.match(lines.join("\n"), /last run .*ok/u);
    assert.match(lines.join("\n"), /bucket, last contact .*failed, no response/u);
  } finally {
    console.log = log;
    delete process.env.DARIUS_SNAPSHOT_DIR;
    delete process.env.DARIUS_SNAPSHOT_ENABLED;
  }
});
