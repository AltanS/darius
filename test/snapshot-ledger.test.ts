/**
 * The `_global` ledger line every `darius snapshot create` leaves
 * (src/cli/snapshot.ts, src/core/backup-state.ts).
 *
 * SAFETY: the state dir, config dir and snapshot folder are `mkdtemp` dirs.
 * The bucket is the in-process fake on a loopback port
 * (test/helpers/fake-s3.ts). Nothing reaches a real bucket or the operator's
 * store.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runSnapshotCommand, type SnapshotDeps } from "../src/cli/snapshot.ts";
import { readBackupStates, readGlobalLines } from "../src/core/backup-state.ts";
import type { LedgerLine } from "../src/core/model.ts";
import type { ParsedArgs } from "../src/cli/registry.ts";
import { VERSION } from "../src/version.ts";
import { clearSnapshotCredentials, writeSnapshotCredentials } from "../src/core/snapshot-settings.ts";
import { startFakeS3 } from "./helpers/fake-s3.ts";

const sandbox = mkdtempSync(join(tmpdir(), "darius-snapshot-ledger-test-"));
const configRoot = join(sandbox, "config");
const stateRoot = join(sandbox, "state");
const snapDir = join(sandbox, "snapshots");
process.env.DARIUS_CONFIG_DIR = configRoot;
process.env.DARIUS_STATE_DIR = stateRoot;
process.env.DARIUS_SNAPSHOT_DIR = snapDir;
mkdirSync(configRoot, { recursive: true });
mkdirSync(join(stateRoot, "proj"), { recursive: true });
writeFileSync(join(stateRoot, "proj", "note.md"), "hello\n");
writeFileSync(join(configRoot, "config.toml"), 'host = "host-a"\n');

const KEY_ID = "test-access-key-id";
const KEY_SECRET = "test-secret-key-value";

const deps: SnapshotDeps = {
  systemctl: () => {
    throw new Error("systemctl: not found");
  },
  stdinIsTTY: () => false,
  readStdin: () => "",
};

interface Ran {
  code: number;
  out: string;
  err: string;
}

async function create(flags: Record<string, string | boolean> = {}): Promise<Ran> {
  const parsed: ParsedArgs = { positional: ["create"], flags, json: flags.json === true, repeated: {} };
  const out: string[] = [];
  const err: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (...items: unknown[]) => out.push(items.join(" "));
  console.error = (...items: unknown[]) => err.push(items.join(" "));
  try {
    return { code: await runSnapshotCommand(parsed, deps), out: out.join("\n"), err: err.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}

function snapshotLines(): LedgerLine[] {
  return readGlobalLines().filter((line) => line.type.startsWith("snapshot."));
}

function withEnv(env: Record<string, string>): () => void {
  Object.assign(process.env, env);
  return () => {
    for (const name of Object.keys(env)) delete process.env[name];
  };
}

test("create without a bucket writes one snapshot.ok line with the fields of the run", async () => {
  const before = snapshotLines().length;
  const ran = await create({ json: true });
  assert.equal(ran.code, 0, ran.out);
  const result: { name: string; bytes: number; files: number; storeBytes: number } = JSON.parse(ran.out);
  const lines = snapshotLines();
  assert.equal(lines.length, before + 1);
  const last = lines.at(-1);
  assert.ok(last);
  assert.equal(last.type, "snapshot.ok");
  assert.equal(last.who, "snapshot");
  assert.equal(last.host, "host-a");
  assert.equal(last.project, "_global");
  assert.equal(last.item, undefined);
  assert.equal(last.name, result.name);
  assert.equal(last.bytes, result.bytes);
  assert.equal(last.files, result.files);
  assert.equal(last.store_bytes, result.storeBytes);
  assert.ok(result.storeBytes > 0);
  assert.equal(last.darius, VERSION);
  assert.equal(last.remote, null);
  assert.equal(last.bucket, null);
});

test("--no-upload with a bucket set up still writes snapshot.ok, remote null, and names the bucket by host", async () => {
  const restore = withEnv({ DARIUS_SNAPSHOT_ENDPOINT: "https://s3.example.com:9000", DARIUS_SNAPSHOT_BUCKET: "backups" });
  writeSnapshotCredentials(KEY_ID, KEY_SECRET);
  try {
    const before = snapshotLines().length;
    const ran = await create({ "no-upload": true });
    assert.equal(ran.code, 0, ran.out);
    const lines = snapshotLines();
    assert.equal(lines.length, before + 1);
    const last = lines.at(-1);
    assert.equal(last?.type, "snapshot.ok");
    assert.equal(last?.remote, null);
    assert.deepEqual(last?.bucket, { endpoint_host: "s3.example.com", bucket: "backups", prefix: "darius" });
    const text = JSON.stringify(last);
    for (const secret of [KEY_ID, KEY_SECRET, "https://s3.example.com", "9000"]) assert.equal(text.includes(secret), false, secret);
  } finally {
    restore();
    clearSnapshotCredentials();
  }
});

test("a run that copied to the bucket records the key; a bucket that cannot be reached is snapshot.ok with remote.ok false and exit 3", async () => {
  const fake = await startFakeS3();
  const restore = withEnv({ DARIUS_SNAPSHOT_ENDPOINT: fake.endpoint, DARIUS_SNAPSHOT_BUCKET: fake.bucket, DARIUS_SNAPSHOT_ALLOW_HTTP: "true" });
  writeSnapshotCredentials(KEY_ID, KEY_SECRET);
  try {
    const good = await create();
    assert.equal(good.code, 0, good.out);
    const lastGood = snapshotLines().at(-1);
    assert.equal(lastGood?.type, "snapshot.ok");
    assert.deepEqual(lastGood?.remote, { ok: true, key: `darius/host-a/${String(lastGood?.name)}`, error: null });
    assert.deepEqual(lastGood?.bucket, { endpoint_host: "127.0.0.1", bucket: fake.bucket, prefix: "darius" });

    await fake.stop();
    const offline = await create();
    assert.equal(offline.code, 3, offline.out);
    const lastOffline = snapshotLines().at(-1);
    assert.equal(lastOffline?.type, "snapshot.ok");
    const state = readBackupStates().find((row) => row.host === "host-a");
    assert.equal(state?.remote?.ok, false);
    assert.equal(state?.name, lastOffline?.name);
    const text = JSON.stringify(lastOffline);
    for (const secret of [KEY_ID, KEY_SECRET, fake.endpoint]) assert.equal(text.includes(secret), false, secret);
  } finally {
    restore();
    clearSnapshotCredentials();
    await fake.stop().catch(() => undefined);
  }
});

test("a run that makes no archive writes snapshot.failed with the error", async () => {
  const restore = withEnv({ DARIUS_SNAPSHOT_KEEP: "many" });
  try {
    const before = snapshotLines().length;
    const ran = await create();
    assert.equal(ran.code, 1);
    const lines = snapshotLines();
    assert.equal(lines.length, before + 1);
    const last = lines.at(-1);
    assert.equal(last?.type, "snapshot.failed");
    assert.match(String(last?.error), /DARIUS_SNAPSHOT_KEEP/u);
    assert.equal(last?.name, undefined);
  } finally {
    restore();
  }
});

test("enabled = false writes snapshot.off, exits 0, and still prints the old words", async () => {
  const restore = withEnv({ DARIUS_SNAPSHOT_ENABLED: "false" });
  try {
    const before = snapshotLines().length;
    const text = await create();
    assert.equal(text.code, 0);
    assert.match(text.out, /snapshots are off/u);
    const json = await create({ json: true });
    assert.equal(json.code, 0);
    assert.equal(JSON.parse(json.out).skipped, "off");
    const lines = snapshotLines();
    assert.equal(lines.length, before + 2);
    assert.deepEqual(
      lines.slice(-2).map((line) => [line.type, line.who]),
      [
        ["snapshot.off", "snapshot"],
        ["snapshot.off", "snapshot"],
      ],
    );
  } finally {
    restore();
  }
});

test("a run refused because another run holds the lock writes no line", async () => {
  mkdirSync(snapDir, { recursive: true });
  writeFileSync(join(snapDir, "lock.json"), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  try {
    const before = snapshotLines().length;
    const ran = await create();
    assert.equal(ran.code, 1);
    assert.match(ran.out, /already running/u);
    assert.equal(snapshotLines().length, before);
  } finally {
    rmSync(join(snapDir, "lock.json"), { force: true });
  }
});

test("a ledger write that fails is a warning: the exit code and the snapshot stay", async () => {
  // `_global` becomes a plain file, so no ledger can be opened or written under it.
  const global = join(stateRoot, "_global");
  const parked = join(stateRoot, "_global.parked");
  renameSync(global, parked);
  writeFileSync(global, "not a directory\n");
  try {
    const text = await create();
    assert.equal(text.code, 0, text.out);
    assert.match(text.err, /snapshot\.ok line could not be written to the _global ledger/u);
    const json = await create({ json: true });
    assert.equal(json.code, 0, json.out);
    const parsed: { ok: boolean; name: string; warnings: string[] } = JSON.parse(json.out);
    assert.equal(parsed.ok, true);
    assert.ok(parsed.warnings.some((warning) => warning.includes("could not be written")));

    const restore = withEnv({ DARIUS_SNAPSHOT_ENABLED: "false" });
    try {
      const off = await create();
      assert.equal(off.code, 0);
      assert.match(off.err, /snapshot\.off line could not be written/u);
    } finally {
      restore();
    }
  } finally {
    rmSync(global, { force: true });
    renameSync(parked, global);
  }
});
