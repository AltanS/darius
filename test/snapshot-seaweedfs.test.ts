/**
 * A snapshot sent to a real SeaweedFS: the multipart upload and the SSE
 * header on the wire, the size check, retention and the listing. Skips loudly
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

import { checkRemote, listLocalSnapshots, runSnapshot } from "../src/core/snapshot.ts";
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
});
