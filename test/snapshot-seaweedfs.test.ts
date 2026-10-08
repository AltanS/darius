/**
 * A snapshot sent to a real SeaweedFS: the multipart upload and the SSE
 * header on the wire, the size check, retention and the listing. Then the
 * no-delete mode against an identity bound to the sample policy of
 * docs/backups.md, on a bucket with versioning on. Skips loudly
 * when podman or the pinned image is missing (inconclusive environment, as in
 * test/s3.test.ts).
 *
 * SAFETY: the server is a throwaway container on a free loopback port
 * (test/helpers/seaweedfs.ts); the store, the folder and the config dir are
 * `mkdtemp` dirs.
 */

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkRemote, deleteRemoteSnapshot, listLocalSnapshots, readSnapshotState, runSnapshot } from "../src/core/snapshot.ts";
import { createS3, S3Error } from "../src/core/s3.ts";
import { resolveSnapshotSettings } from "../src/core/snapshot-settings.ts";
import { seaweedfsUnavailable, startSeaweedFs, type SeaweedFs } from "./helpers/seaweedfs.ts";

const sandbox = mkdtempSync(join(tmpdir(), "darius-snapshot-sw-test-"));
process.env.DARIUS_CONFIG_DIR = join(sandbox, "config");
process.env.DARIUS_STATE_DIR = join(sandbox, "state");
mkdirSync(process.env.DARIUS_CONFIG_DIR, { recursive: true });
mkdirSync(join(process.env.DARIUS_STATE_DIR, "proj"), { recursive: true });

const unavailable = await seaweedfsUnavailable();
if (unavailable !== null) console.error(`\n!!! SKIPPED: snapshot tests against SeaweedFS: ${unavailable}\n`);

describe("a snapshot against a real SeaweedFS", { skip: unavailable ?? false }, () => {
  let server: SeaweedFs;

  before(async () => {
    server = await startSeaweedFs();
  });

  after(async () => {
    await server.stop();
  });

  test("a 40 MiB store goes up in parts with SSE, matches its SHA-256 and is pruned to the newest", async () => {
    const blob = randomBytes(40 * 1024 * 1024);
    writeFileSync(join(process.env.DARIUS_STATE_DIR ?? "", "proj", "blob.bin"), blob);
    const env = {
      DARIUS_SNAPSHOT_DIR: join(sandbox, "snapshots"),
      DARIUS_SNAPSHOT_ENDPOINT: server.endpoint,
      DARIUS_SNAPSHOT_BUCKET: server.remote.bucket,
      DARIUS_SNAPSHOT_REGION: server.remote.region,
      DARIUS_SNAPSHOT_ALLOW_HTTP: "true",
      DARIUS_SNAPSHOT_SSE: "true",
      DARIUS_SNAPSHOT_KEEP_REMOTE: "1",
      DARIUS_SNAPSHOT_ACCESS_KEY_ID: server.credentials.accessKeyId,
      DARIUS_SNAPSHOT_SECRET_ACCESS_KEY: server.credentials.secretAccessKey,
    };
    Object.assign(process.env, env);
    const resolved = resolveSnapshotSettings({ config: {}, file: new Map() });
    assert.deepEqual(resolved.problems, []);

    const first = await runSnapshot({ resolved, host: "host-a", version: "9.9.9", stateDir: process.env.DARIUS_STATE_DIR ?? "", now: new Date(Date.UTC(2026, 9, 1, 4, 0, 0)) });
    assert.equal(first.code, 0, first.error ?? "");
    assert.ok(first.bytes > 40 * 1024 * 1024, "random data does not compress");

    const key = `darius/host-a/${first.name ?? ""}`;
    const stored = await server.s3.get(key);
    assert.ok(stored !== null);
    const local = readFileSync(join(sandbox, "snapshots", first.name ?? ""));
    assert.equal(createHash("sha256").update(stored.body).digest("hex"), createHash("sha256").update(local).digest("hex"));
    assert.ok(stored.etag.includes("-") || stored.body.length === local.length);

    const second = await runSnapshot({ resolved, host: "host-a", version: "9.9.9", stateDir: process.env.DARIUS_STATE_DIR ?? "", now: new Date(Date.UTC(2026, 9, 1, 4, 0, 1)) });
    assert.equal(second.code, 0, second.error ?? "");
    assert.equal(second.pruned.remote, 1);
    assert.equal(await server.s3.head(key), null);
    assert.ok(await server.s3.head(`darius/host-a/${second.name ?? ""}`));
    assert.equal(listLocalSnapshots(join(sandbox, "snapshots"))[0]?.remote, true);

    const checked = await checkRemote(resolved, "host-a");
    assert.ok(checked.ok, checked.error ?? "");
    assert.equal(checked.objects.length, 1);
  });

  test("keep_monthly: CopyObject copies a multipart archive inside the bucket, with SSE, and the monthly prune touches only monthly/", async () => {
    const stateDir = process.env.DARIUS_STATE_DIR ?? "";
    const resolved = resolveSnapshotSettings({ env: { ...process.env, DARIUS_SNAPSHOT_KEEP_MONTHLY: "1" }, config: {}, file: new Map() });
    assert.deepEqual(resolved.problems, []);
    const run = (month: number): ReturnType<typeof runSnapshot> => runSnapshot({ resolved, host: "host-a", version: "9.9.9", stateDir, now: new Date(Date.UTC(2026, month, 1, 4, 0, 0)) });

    const november = await run(10);
    assert.equal(november.code, 0, november.error ?? "");
    assert.deepEqual(november.warnings, []);
    const monthlyKey = `darius/host-a/monthly/${november.name ?? ""}`;
    assert.equal(november.monthly.copied, monthlyKey);
    const daily = await server.s3.get(`darius/host-a/${november.name ?? ""}`);
    const copy = await server.s3.get(monthlyKey);
    assert.ok(daily !== null && copy !== null);
    assert.equal(createHash("sha256").update(copy.body).digest("hex"), createHash("sha256").update(daily.body).digest("hex"));
    assert.ok(await server.s3.head(`${monthlyKey}.json`));
    assert.deepEqual(readSnapshotState(join(sandbox, "snapshots")).remote?.monthly?.map((object) => object.name), [november.name]);

    // The wire call itself, with no fallback to hide behind: a copy of a multipart object, and a missing source.
    const client = createS3({ ...server.remote, sse: true }, server.credentials);
    await client.copy(`darius/host-a/${november.name ?? ""}`, "darius/copy-probe");
    assert.equal((await server.s3.head("darius/copy-probe"))?.size, daily.body.length);
    const missing = await client.copy("darius/no-such-object", "darius/copy-probe-2").then(
      () => null,
      (error: Error) => error,
    );
    assert.ok(missing instanceof S3Error && (missing.status === 404 || missing.status === 400), "SeaweedFS answers 400 for a missing source");

    // A second month replaces the first copy (keep_monthly = 1); the daily folder keeps its own newest.
    const december = await run(11);
    assert.equal(december.code, 0, december.error ?? "");
    assert.equal(december.monthly.pruned, 1);
    assert.equal(await server.s3.head(monthlyKey), null);
    assert.equal(await server.s3.head(`${monthlyKey}.json`), null);
    assert.ok(await server.s3.head(`darius/host-a/monthly/${december.name ?? ""}`));
    assert.ok(await server.s3.head(`darius/host-a/${december.name ?? ""}`));
  });
});

describe("the no-delete mode against a real SeaweedFS", { skip: unavailable ?? false }, () => {
  let server: SeaweedFs;
  const store = join(sandbox, "small-store");
  const dir = join(sandbox, "noprune-snapshots");

  before(async () => {
    server = await startSeaweedFs({ noDeletePrefix: "darius" });
    await server.setVersioning("Enabled");
    mkdirSync(join(store, "proj"), { recursive: true });
    writeFileSync(join(store, "proj", "item.md"), "# item\n");
    const keys = server.noDeleteCredentials;
    assert.ok(keys !== null);
    // The key the runs use is the no-delete one. makeBucket reads it from the environment.
    process.env.DARIUS_SNAPSHOT_ACCESS_KEY_ID = keys.accessKeyId;
    process.env.DARIUS_SNAPSHOT_SECRET_ACCESS_KEY = keys.secretAccessKey;
  });

  after(async () => {
    await server.stop();
  });

  function resolvedWith(prune: boolean): ReturnType<typeof resolveSnapshotSettings> {
    const env = {
      DARIUS_SNAPSHOT_DIR: dir,
      DARIUS_SNAPSHOT_ENDPOINT: server.endpoint,
      DARIUS_SNAPSHOT_BUCKET: server.remote.bucket,
      DARIUS_SNAPSHOT_REGION: server.remote.region,
      DARIUS_SNAPSHOT_ALLOW_HTTP: "true",
      DARIUS_SNAPSHOT_SSE: "true",
      DARIUS_SNAPSHOT_KEEP_REMOTE: "1",
      DARIUS_SNAPSHOT_REMOTE_PRUNE: String(prune),
    };
    const resolved = resolveSnapshotSettings({ env, config: {}, file: new Map(), stateDir: store });
    assert.deepEqual(resolved.problems, []);
    return resolved;
  }

  test("the sample policy really refuses a delete, and the runs, the check and delete --remote respect it", async () => {
    const keys = server.noDeleteCredentials;
    assert.ok(keys !== null);

    const off = resolvedWith(false);
    for (const second of [0, 1]) {
      const result = await runSnapshot({ resolved: off, host: "host-a", version: "9.9.9", stateDir: store, now: new Date(Date.UTC(2026, 9, 2, 4, 0, second)) });
      assert.equal(result.code, 0, result.error ?? "");
      assert.equal(result.pruned.remote, 0);
    }
    const listed = await server.s3.list("darius/host-a/");
    assert.equal(listed.filter((object) => object.key.endsWith(".tar.gz")).length, 2, "keep_remote = 1 is ignored: both stay");

    const checked = await checkRemote(off, "host-a");
    assert.ok(checked.ok, checked.error ?? "");
    assert.equal(checked.delete, "refused");
    assert.equal(checked.versioning, "enabled");
    assert.deepEqual(checked.warnings, []);
    assert.ok(await server.s3.head("darius/.darius-check"), "a refused delete leaves the probe");
    assert.equal(readSnapshotState(dir).check?.delete, "refused");

    const name = listLocalSnapshots(dir)[0]?.name ?? "";
    assert.deepEqual(await deleteRemoteSnapshot(off, "host-a", name), { ok: false, error: "remote_prune is off: delete in the bucket by hand" });

    // remote_prune on with the same key: the check warns, and a run's prune is refused by the server.
    const on = resolvedWith(true);
    const warned = await checkRemote(on, "host-a");
    assert.ok(warned.ok, warned.error ?? "");
    assert.match(warned.warnings.join(" | "), /pruning will fail/u);
    const refused = await deleteRemoteSnapshot(on, "host-a", name);
    assert.equal(refused.ok, false);
    assert.match(refused.ok ? "" : refused.error, /HTTP 403/u);
    assert.ok(await server.s3.head(`darius/host-a/${name}`), "the object is still there");
  });

  test("keep_monthly under the sample policy: the no-delete key may copy into monthly/, and nothing is deleted", async () => {
    const off = resolveSnapshotSettings({
      env: {
        DARIUS_SNAPSHOT_DIR: dir,
        DARIUS_SNAPSHOT_ENDPOINT: server.endpoint,
        DARIUS_SNAPSHOT_BUCKET: server.remote.bucket,
        DARIUS_SNAPSHOT_REGION: server.remote.region,
        DARIUS_SNAPSHOT_ALLOW_HTTP: "true",
        DARIUS_SNAPSHOT_SSE: "true",
        DARIUS_SNAPSHOT_REMOTE_PRUNE: "false",
        DARIUS_SNAPSHOT_KEEP_MONTHLY: "1",
      },
      config: {},
      file: new Map(),
      stateDir: store,
    });
    assert.deepEqual(off.problems, []);
    const results = [];
    for (const month of [10, 11]) {
      results.push(await runSnapshot({ resolved: off, host: "host-a", version: "9.9.9", stateDir: store, now: new Date(Date.UTC(2026, month, 1, 4, 0, 0)) }));
    }
    for (const result of results) {
      assert.equal(result.code, 0, result.error ?? "");
      assert.deepEqual(result.warnings, []);
      assert.equal(result.monthly.pruned, 0);
      assert.ok(await server.s3.head(`darius/host-a/monthly/${result.name ?? ""}`));
      assert.ok(await server.s3.head(`darius/host-a/monthly/${result.name ?? ""}.json`));
    }
    const listed = await server.s3.list("darius/host-a/monthly/");
    assert.equal(listed.filter((object) => object.key.endsWith(".tar.gz")).length, 2, "keep_monthly = 1 is ignored without remote_prune");
  });
});
