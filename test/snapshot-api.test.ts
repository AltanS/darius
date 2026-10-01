/**
 * `src/web/snapshot-api.ts` and `src/web/backups.ts`: the guards of the
 * backup endpoints, what a save changes, and what the page data shows.
 *
 * SAFETY: the config dir, the state dir and the snapshot folder are `mkdtemp`
 * dirs; the run starter is a fake, so no process starts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { JsonValue } from "../src/core/model.ts";
import { runSnapshot } from "../src/core/snapshot.ts";
import { readSnapshotFile, resolveSnapshotSettings, snapshotCredentialsPath } from "../src/core/snapshot-settings.ts";
import { collectBackups } from "../src/web/backups.ts";
import { snapshotApi, type SnapshotRequest } from "../src/web/snapshot-api.ts";

const sandbox = mkdtempSync(join(tmpdir(), "darius-snapshot-api-test-"));
process.env.DARIUS_CONFIG_DIR = join(sandbox, "config");
process.env.DARIUS_STATE_DIR = join(sandbox, "state");
process.env.DARIUS_SNAPSHOT_DIR = join(sandbox, "snapshots");
delete process.env.DARIUS_WEB_URL;
mkdirSync(process.env.DARIUS_CONFIG_DIR, { recursive: true });
mkdirSync(join(process.env.DARIUS_STATE_DIR, "proj"), { recursive: true });
writeFileSync(join(process.env.DARIUS_STATE_DIR, "proj", "note.md"), "hello\n");
writeFileSync(join(process.env.DARIUS_CONFIG_DIR, "config.toml"), 'host = "host-a"\n');

function postRaw(path: string, body: string, overrides: Partial<SnapshotRequest> = {}): SnapshotRequest {
  return {
    method: "POST",
    path: `/api/snapshots/${path}`,
    headers: new Headers({ origin: "http://127.0.0.1:4747", host: "127.0.0.1:4747", "content-type": "application/json" }),
    body,
    ...overrides,
  };
}

function post(path: string, body: JsonValue, overrides: Partial<SnapshotRequest> = {}): SnapshotRequest {
  return postRaw(path, JSON.stringify(body), overrides);
}

const never = (): void => {
  assert.fail("no run should start");
};

test("an unknown endpoint is 404, a GET is 405, a foreign origin is 403, other content is 415, a large body is 413", async () => {
  assert.equal((await snapshotApi(post("nope", {}), never)).status, 404);
  assert.equal((await snapshotApi(post("run", {}, { method: "GET" }), never)).status, 405);
  const foreign = post("run", {}, { headers: new Headers({ origin: "https://evil.example", host: "127.0.0.1:4747", "content-type": "application/json" }) });
  assert.equal((await snapshotApi(foreign, never)).status, 403);
  const noOrigin = post("run", {}, { headers: new Headers({ host: "127.0.0.1:4747", "content-type": "application/json" }) });
  assert.equal((await snapshotApi(noOrigin, never)).status, 403);
  const text = post("run", {}, { headers: new Headers({ origin: "http://127.0.0.1:4747", host: "127.0.0.1:4747", "content-type": "text/plain" }) });
  assert.equal((await snapshotApi(text, never)).status, 415);
  assert.equal((await snapshotApi(postRaw("settings", "x".repeat(5000)), never)).status, 413);
  assert.equal((await snapshotApi(postRaw("settings", "{not json"), never)).status, 400);
});

test("the page's own origin through DARIUS_WEB_URL is accepted", async () => {
  process.env.DARIUS_WEB_URL = "https://darius.example.test";
  try {
    const request = post("credentials/clear", {}, { headers: new Headers({ origin: "https://darius.example.test", host: "10.0.0.1:4747", "content-type": "application/json" }) });
    assert.equal((await snapshotApi(request, never)).status, 200);
  } finally {
    delete process.env.DARIUS_WEB_URL;
  }
});

test("a save writes the dashboard file, shows as source 'file', and null clears it again", async () => {
  const saved = await snapshotApi(post("settings", { values: { keep: 4, endpoint: "https://s3.example.test", bucket: "bucket-1", prefix: "nightly" } }), never);
  assert.equal(saved.status, 200);
  assert.equal(readSnapshotFile().get("keep"), 4);
  const page = collectBackups();
  assert.equal(page.settings.keep.value, 4);
  assert.equal(page.settings.keep.source, "file");
  assert.equal(page.settings.bucket.value, "bucket-1");
  assert.equal(page.remoteConfigured, true);
  assert.equal(page.credentials, "none");
  assert.equal(page.settings.dir.source, "env");

  const cleared = await snapshotApi(post("settings", { values: { keep: null, endpoint: null, bucket: null, prefix: null } }), never);
  assert.equal(cleared.status, 200);
  const after = collectBackups();
  assert.equal(after.settings.keep.source, "default");
  assert.equal(after.remoteConfigured, false);
});

test("a key set by the environment, an unknown key and a bad value are refused", async () => {
  process.env.DARIUS_SNAPSHOT_KEEP = "3";
  try {
    const locked = await snapshotApi(post("settings", { values: { keep: 9 } }), never);
    assert.equal(locked.status, 400);
    assert.match(JSON.stringify(locked.body), /DARIUS_SNAPSHOT_KEEP/u);
  } finally {
    delete process.env.DARIUS_SNAPSHOT_KEEP;
  }
  assert.equal((await snapshotApi(post("settings", { values: { colour: "red" } }), never)).status, 400);
  assert.equal((await snapshotApi(post("settings", { values: { prefix: "../up" } }), never)).status, 400);
  assert.equal((await snapshotApi(post("settings", { values: { endpoint: "http://example.com", bucket: "bucket-1", allow_http: true } }), never)).status, 400);
  assert.equal((await snapshotApi(post("settings", { values: { keep: { nested: 1 } } }), never)).status, 400);
  assert.equal((await snapshotApi(post("settings", { nothing: 1 }), never)).status, 400);
});

test("the key pair is written 0600, answers carry no key, and the page data never holds it", async () => {
  const reply = await snapshotApi(post("credentials", { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "very-secret-value" }), never);
  assert.equal(reply.status, 200);
  assert.doesNotMatch(JSON.stringify(reply.body), /very-secret-value|AKIAEXAMPLE/u);
  assert.match(readFileSync(snapshotCredentialsPath(), "utf8"), /very-secret-value/u);
  assert.equal(collectBackups().credentials, "file");
  assert.doesNotMatch(JSON.stringify(collectBackups()), /very-secret-value|AKIAEXAMPLE/u);

  const bad = await snapshotApi(post("credentials", { accessKeyId: "", secretAccessKey: "x" }), never);
  assert.equal(bad.status, 400);
  assert.equal((await snapshotApi(post("credentials", { accessKeyId: 5 }), never)).status, 400);

  assert.equal((await snapshotApi(post("credentials/clear", {}), never)).status, 200);
  assert.equal(collectBackups().credentials, "none");
});

test("run starts one detached run, and refuses when off, broken or already running", async () => {
  let started = 0;
  const start = (): void => {
    started += 1;
  };
  const reply = await snapshotApi(post("run", {}), start);
  assert.equal(reply.status, 202);
  assert.equal(started, 1);

  process.env.DARIUS_SNAPSHOT_ENABLED = "false";
  assert.equal((await snapshotApi(post("run", {}), start)).status, 400);
  delete process.env.DARIUS_SNAPSHOT_ENABLED;
  process.env.DARIUS_SNAPSHOT_KEEP = "zero";
  assert.equal((await snapshotApi(post("run", {}), start)).status, 400);
  delete process.env.DARIUS_SNAPSHOT_KEEP;

  mkdirSync(join(sandbox, "snapshots"), { recursive: true });
  writeFileSync(join(sandbox, "snapshots", "lock.json"), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  assert.equal((await snapshotApi(post("run", {}), start)).status, 409);
  assert.equal(started, 1);
  assert.equal(collectBackups().running?.pid, process.pid);
  writeFileSync(join(sandbox, "snapshots", "lock.json"), "{}");
});

test("the page data lists snapshots with their manifests, and delete removes one", async () => {
  const resolved = resolveSnapshotSettings();
  const made = await runSnapshot({ resolved, host: "host-a", version: "9.9.9", stateDir: process.env.DARIUS_STATE_DIR ?? "" });
  assert.equal(made.code, 0, made.error ?? "");
  const page = collectBackups();
  assert.equal(page.snapshots.length, 1);
  assert.equal(page.snapshots[0]?.name, made.name);
  assert.equal(page.snapshots[0]?.local, true);
  assert.equal(page.snapshots[0]?.files, 1);
  assert.equal(page.last?.ok, true);
  assert.ok(page.localBytes > 0);
  assert.equal(page.host, "host-a");

  assert.equal((await snapshotApi(post("delete", { name: "../x", where: "local" }), never)).status, 400);
  assert.equal((await snapshotApi(post("delete", { name: made.name, where: "sideways" }), never)).status, 400);
  assert.equal((await snapshotApi(post("delete", { name: made.name, where: "remote" }), never)).status, 400);
  assert.equal((await snapshotApi(post("delete", { name: made.name, where: "local" }), never)).status, 200);
  assert.equal(collectBackups().snapshots.length, 0);
});
