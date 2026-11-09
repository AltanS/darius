/**
 * `src/core/sync.ts` and `darius sync`, against a real SeaweedFS container.
 *
 * Two local stores ("hosta", "hostb") share one throwaway bucket. The tests
 * switch between them by pointing DARIUS_STATE_DIR and DARIUS_CONFIG_DIR at
 * each host's dirs; every path in darius is read from the environment per
 * call. Each test uses its own project name, so the tests share the bucket
 * without seeing each other.
 *
 * The container tests skip loudly when podman or the pinned image is
 * missing; that is an inconclusive environment, not a pass.
 */

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { syncCommand } from "../src/cli/sync.ts";
import { loadConfig } from "../src/core/config.ts";
import { appendLine, closeOpenChunk, listChunks, parseLedgerText, readLedger } from "../src/core/ledger.ts";
import type { Document, Profile, Ritual } from "../src/core/model.ts";
import { createS3, S3Error, S3NetworkError } from "../src/core/s3.ts";
import type { ListedObject, S3 } from "../src/core/s3.ts";
import { decodeItem, encodeItem, getBlobText, GLOBAL_PROJECT, listBlobs, openProject, putBlob, readItemText, sha256Hex } from "../src/core/store.ts";
import type { Project } from "../src/core/store.ts";
import { decideCompat, decodeCompatFloor, decideItem, HOST_VERSION_TYPE, isLocalNewer, needsHostVersion, SYNC_COMPAT, SYNC_COMPAT_SINCE, syncProject } from "../src/core/sync.ts";
import type { CompatFloor, SyncOptions, SyncReport } from "../src/core/sync.ts";
import { seaweedfsUnavailable, startSeaweedFs, TEST_CREDENTIALS } from "./helpers/seaweedfs.ts";
import type { SeaweedFs } from "./helpers/seaweedfs.ts";
import { VERSION } from "../src/version.ts";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const sandbox = mkdtempSync(join(tmpdir(), "darius-sync-test-"));

interface Host {
  readonly name: string;
  readonly state: string;
  readonly config: string;
}

function makeHost(name: string, endpoint: string): Host {
  const host: Host = { name, state: join(sandbox, name, "state"), config: join(sandbox, name, "config") };
  mkdirSync(host.state, { recursive: true });
  mkdirSync(host.config, { recursive: true });
  const credentials = join(host.config, "credentials");
  writeFileSync(
    credentials,
    `[default]\naws_access_key_id = ${TEST_CREDENTIALS.accessKeyId}\naws_secret_access_key = ${TEST_CREDENTIALS.secretAccessKey}\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    join(host.config, "config.toml"),
    [
      `host = "${name}"`,
      "",
      "[remote]",
      `endpoint = "${endpoint}"`,
      'bucket = "darius-test"',
      'region = "us-east-1"',
      "path_style = true",
      "allow_http = true",
      "sse = true",
      `credentials = "${credentials}"`,
      "",
      "[notify]",
      'webhook = ""',
      "",
    ].join("\n"),
  );
  return host;
}

function useHost(host: Host): void {
  process.env.DARIUS_STATE_DIR = host.state;
  process.env.DARIUS_CONFIG_DIR = host.config;
}

function projectOf(host: Host, name: string): Project {
  useHost(host);
  return openProject(name, { create: true });
}

async function syncAs(host: Host, name: string, server: SeaweedFs, opts: SyncOptions = {}): Promise<SyncReport> {
  const project = projectOf(host, name);
  return syncProject(project, server.s3, loadConfig(), opts);
}

function ritual(overrides: Partial<Ritual>): Document<Ritual> {
  return {
    header: {
      id: "01K5Z8QK5Q9S1N1B5N9S1N1B5N",
      kind: "ritual",
      slug: "heartbeat",
      title: "Heartbeat",
      created: "2026-09-28T03:00:00.000Z",
      updated: "2026-09-28T03:00:00.000Z",
      tags: [],
      anchor: "due",
      cadence: "1d",
      policy: { mode: "off", may: [], hold: [] },
      ...overrides,
    },
    body: "\n## Procedure\n\nRun `darius --version`.\n",
  };
}

function uniqueProject(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}`;
}

/** Runs `syncCommand` in-process and returns its exit code and the one JSON object it printed. */
async function runSyncCli(host: Host, flags: Record<string, string | boolean>): Promise<{ code: number; output: string; errors: string[] }> {
  useHost(host);
  const printed: string[] = [];
  const errors: string[] = [];
  const original = console.log;
  const originalError = console.error;
  console.log = (line: string) => {
    printed.push(line);
  };
  console.error = (line: string) => {
    errors.push(line);
  };
  try {
    const code = await syncCommand.run({ positional: [], flags, json: true, repeated: {} });
    return { code, output: printed.join("\n"), errors };
  } finally {
    console.log = original;
    console.error = originalError;
  }
}

/** An in-memory S3 that honours If-None-Match, for the push selection. It counts the PUTs that stored something. */
function memoryS3(): S3 & { objects: Map<string, Uint8Array>; stored: string[] } {
  const objects = new Map<string, Uint8Array>();
  const stored: string[] = [];
  return {
    objects,
    stored,
    put(key, body, o) {
      if (o?.ifNoneMatch === true && objects.has(key)) return Promise.resolve({ conflict: true });
      const content = Buffer.from(body);
      objects.set(key, content);
      stored.push(key);
      return Promise.resolve({ etag: sha256Hex(content) });
    },
    get(key) {
      const body = objects.get(key);
      return Promise.resolve(body === undefined ? null : { body, etag: sha256Hex(body) });
    },
    head(key) {
      const body = objects.get(key);
      return Promise.resolve(body === undefined ? null : { etag: sha256Hex(body), size: body.length });
    },
    del(key) {
      objects.delete(key);
      return Promise.resolve();
    },
    list(prefix) {
      const listed: ListedObject[] = [...objects]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, body]) => ({ key, etag: sha256Hex(body), size: body.length }));
      return Promise.resolve(listed);
    },
    ensureBucket: () => Promise.resolve("exists"),
  };
}

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("decideItem and isLocalNewer (pure)", () => {
  const a = "a".repeat(64);
  const b = "b".repeat(64);
  const c = "c".repeat(64);

  test("classifies the five cases from three shas", () => {
    assert.equal(decideItem({ localSha: null, baseSha: null, remoteSha: null }), "none");
    assert.equal(decideItem({ localSha: a, baseSha: null, remoteSha: null }), "push");
    assert.equal(decideItem({ localSha: a, baseSha: b, remoteSha: a }), "same");
    assert.equal(decideItem({ localSha: null, baseSha: null, remoteSha: a }), "pull");
    assert.equal(decideItem({ localSha: a, baseSha: a, remoteSha: b }), "pull");
    assert.equal(decideItem({ localSha: b, baseSha: a, remoteSha: a }), "push");
    assert.equal(decideItem({ localSha: b, baseSha: a, remoteSha: c }), "conflict");
    assert.equal(decideItem({ localSha: b, baseSha: null, remoteSha: c }), "conflict");
  });

  test("picks the later updated, and on a tie the same winner from both sides", () => {
    const early = { sha: a, updated: "2026-09-28T04:00:00.000Z" };
    const late = { sha: b, updated: "2026-09-28T05:00:00.000Z" };
    assert.equal(isLocalNewer({ local: late, remote: early }), true);
    assert.equal(isLocalNewer({ local: early, remote: late }), false);
    const tieA = { sha: a, updated: "2026-09-28" };
    const tieB = { sha: b, updated: "2026-09-28" };
    assert.notEqual(isLocalNewer({ local: tieA, remote: tieB }), isLocalNewer({ local: tieB, remote: tieA }));
  });
});

test("an unreachable bucket skips as offline and keeps the local line for later", async () => {
  const host = makeHost("hostoff", "http://127.0.0.1:1");
  const project = projectOf(host, "offline-project");
  appendLine(project, { who: "test", type: "note", item: "ritual/heartbeat" });
  const cfg = loadConfig();
  const remote = cfg.remote;
  assert.ok(remote !== undefined);
  const report = await syncProject(project, createS3(remote, TEST_CREDENTIALS), cfg);
  assert.equal(report.skipped, "offline");
  assert.equal(readLedger(project).length, 1, "the line stays local for the next sync");

  const cli = await runSyncCli(host, { project: "offline-project" });
  assert.equal(cli.code, 3);
  assert.equal(JSON.parse(cli.output).projects[0].skipped, "offline");
});

describe("reseed push selection (in-memory S3)", () => {
  const hostA = makeHost("hosta", "http://127.0.0.1:1");
  const hostB = makeHost("hostb", "http://127.0.0.1:1");

  /** Host B writes a line that names a blob; its chunk and blob are put where a sync of B would have put them. */
  async function seedFromB(s3: S3, name: string): Promise<{ chunkKey: string; blobSha: string }> {
    const b = projectOf(hostB, name);
    const blobSha = putBlob(b, "output of host b\n");
    appendLine(b, { who: "test", type: "run.completed", item: "ritual/heartbeat", run: "rb", outcome: "complete", output_sha: blobSha });
    closeOpenChunk(b);
    const chunk = listChunks(b).find((one) => one.host === "hostb");
    assert.ok(chunk !== undefined);
    await s3.put(`${name}/ledger/hostb/${chunk.name}`, readFileSync(chunk.path, "utf8"), { ifNoneMatch: true });
    await s3.put(`${name}/blobs/${blobSha}`, "output of host b\n", { ifNoneMatch: true });
    return { chunkKey: `${name}/ledger/hostb/${chunk.name}`, blobSha };
  }

  test("pushes the chunks of every host and every blob, ignores seen, and does not count a 412", async () => {
    const name = uniqueProject("reseedsel");
    const s3 = memoryS3();
    const { chunkKey, blobSha } = await seedFromB(s3, name);
    const a = projectOf(hostA, name);
    const ownSha = putBlob(a, "output of host a\n");
    appendLine(a, { who: "test", type: "run.completed", item: "ritual/heartbeat", run: "ra", outcome: "complete", output_sha: ownSha });
    const strayBlob = putBlob(a, "a tree file version no line names\n");
    const first = await syncProject(a, s3, loadConfig());
    assert.equal(first.pulledChunks, 1);
    assert.equal(first.pushedChunks, 1);
    const keysBefore = [...s3.objects.keys()].filter((key) => key.includes("/ledger/") || key.includes("/blobs/")).toSorted();
    assert.ok(keysBefore.includes(chunkKey) && keysBefore.includes(`${name}/blobs/${ownSha}`) && keysBefore.includes(`${name}/blobs/${blobSha}`));
    assert.ok(!keysBefore.includes(`${name}/blobs/${strayBlob}`), "a blob no line names is not pushed by a plain sync");

    const lost = [...s3.objects.keys()];
    for (const key of lost) s3.objects.delete(key);
    const plain = await syncProject(a, s3, loadConfig());
    assert.equal(plain.pushedChunks, 0, "a plain sync trusts seen and pushes no chunk");

    // One chunk survives with other content: If-None-Match must leave it alone.
    s3.objects.set(chunkKey, new TextEncoder().encode("kept\n"));
    s3.stored.length = 0;
    const reseed = await syncProject(a, s3, loadConfig(), { reseed: true });
    assert.equal(reseed.reseed, true);
    assert.equal(reseed.skipped, undefined);
    assert.equal(reseed.pulledChunks, 0, "the bucket's surviving chunk is already seen");
    assert.equal(reseed.pushedChunks, listChunks(a).length - 1, "every chunk of every host but the one present");
    assert.equal(reseed.blobsPushed, listBlobs(a).length, "every blob of the store, named or not");
    assert.deepEqual([...s3.objects.keys()].filter((key) => key.includes("/ledger/") || key.includes("/blobs/")).toSorted(), keysBefore.toSorted().concat(`${name}/blobs/${strayBlob}`).toSorted());
    assert.equal(new TextDecoder().decode(s3.objects.get(chunkKey)), "kept\n", "an existing object is never overwritten");
    assert.equal(new TextDecoder().decode(s3.objects.get(`${name}/blobs/${blobSha}`)), "output of host b\n");

    s3.stored.length = 0;
    const again = await syncProject(a, s3, loadConfig(), { reseed: true });
    assert.equal(again.pushedChunks, 0);
    assert.equal(again.blobsPushed, 0);
    assert.ok(!s3.stored.some((key) => key.includes("/ledger/") || key.includes("/blobs/")), "no chunk or blob PUT stored anything");
  });

  test("a chunk that names a blob the store lacks stops the reseed", async () => {
    const name = uniqueProject("reseedmiss");
    const a = projectOf(hostA, name);
    appendLine(a, { who: "test", type: "run.completed", item: "ritual/heartbeat", run: "rx", outcome: "complete", output_sha: "b".repeat(64) });
    await assert.rejects(syncProject(a, memoryS3(), loadConfig(), { reseed: true }), /not in the local store/);
  });

  test("a local blob whose content does not hash to its name stops the push and is never PUT", async () => {
    const name = uniqueProject("reseedbad");
    const a = projectOf(hostA, name);
    const sha = putBlob(a, "a tree file version\n");
    writeFileSync(join(a.root, "blobs", sha), "bit rot\n");
    const s3 = memoryS3();
    await assert.rejects(syncProject(a, s3, loadConfig(), { reseed: true }), new RegExp(`blob ${sha} .*does not hash to its name`, "u"));
    assert.equal(s3.objects.has(`${name}/blobs/${sha}`), false);
  });

  test("reseed and pullOnly together are refused", async () => {
    const a = projectOf(hostA, uniqueProject("reseedpull"));
    await assert.rejects(syncProject(a, memoryS3(), loadConfig(), { reseed: true, pullOnly: true }), /cannot be pull-only/);
  });
});


type MemoryS3 = ReturnType<typeof memoryS3>;

/** The S3 with its GET of `key` replaced by a throw. */
function failingGet(s3: MemoryS3, key: string, error: Error): MemoryS3 {
  return {
    ...s3,
    get(asked) {
      return asked === key ? Promise.reject(error) : s3.get(asked);
    },
  };
}

/** The bucket's `compat.json`, decoded, or null when absent. */
function floorOf(s3: MemoryS3, name: string): CompatFloor | null {
  const body = s3.objects.get(`${name}/compat.json`);
  return body === undefined ? null : decodeCompatFloor(new TextDecoder().decode(body), "compat.json");
}

function versionLines(project: Project): number {
  return readLedger(project).filter((line) => line.type === HOST_VERSION_TYPE).length;
}

/** A `host.version` line as `needsHostVersion` reads it. */
interface VersionLine {
  type: string;
  id: string;
  version: string;
}

function versionLine(id: string, version: string): VersionLine {
  return { type: HOST_VERSION_TYPE, id, version };
}

describe("compat floor and host version (in-memory S3)", () => {
  const hostA = makeHost("hosta", "http://127.0.0.1:1");

  test("decideCompat: absent and lower raise, equal does nothing, higher refuses", () => {
    assert.equal(decideCompat(0, 1), "raise", "absent reads as 0");
    assert.equal(decideCompat(1, 2), "raise");
    assert.equal(decideCompat(2, 2), "same");
    assert.equal(decideCompat(3, 2), "refuse");
  });

  test("decodeCompatFloor needs a readable compat and keeps the rest when present", () => {
    assert.deepEqual(decodeCompatFloor('{"v":1,"compat":2,"min_version":"0.130.0","host":"host-a","at":"2026-11-09T00:00:00.000Z"}', "f"), {
      compat: 2,
      minVersion: "0.130.0",
      host: "host-a",
      at: "2026-11-09T00:00:00.000Z",
    });
    assert.deepEqual(decodeCompatFloor('{"v":2,"compat":5,"more":true}', "f"), { compat: 5 }, "a later object version still refuses by compat");
    assert.throws(() => decodeCompatFloor('{"v":1}', "f"), /no readable "compat"/u);
    assert.throws(() => decodeCompatFloor('{"compat":"2"}', "f"), /no readable "compat"/u);
    assert.throws(() => decodeCompatFloor("not json", "f"), /not valid JSON/u);
  });

  test("absent: a full sync raises the floor to this binary's compat, under the lease, after the manifest", async () => {
    const name = uniqueProject("compatabsent");
    const a = projectOf(hostA, name);
    a.writeItem(ritual({}), { who: "test" });
    const s3 = memoryS3();
    const report = await syncProject(a, s3, loadConfig());
    assert.equal(report.skipped, undefined);
    assert.equal(report.compatRaised, SYNC_COMPAT);
    const floor = floorOf(s3, name);
    assert.deepEqual({ ...floor, at: "x" }, { compat: SYNC_COMPAT, minVersion: SYNC_COMPAT_SINCE, host: "hosta", at: "x" });
    assert.match(new TextDecoder().decode(s3.objects.get(`${name}/compat.json`)), /^\{"v":1,"compat":\d+,"min_version":"[^"]+","host":"hosta","at":"[^"]+"\}\n$/u);
    assert.ok(s3.stored.indexOf(`${name}/compat.json`) > s3.stored.indexOf(`${name}/manifest.json`), "the floor goes up after the items");
    assert.equal(s3.objects.has(`${name}/lease.json`), false, "the lease is released");
    const again = await syncProject(a, s3, loadConfig());
    assert.equal(again.compatRaised, undefined, "an equal floor is left alone");
  });

  test("lower: raised; equal: not written; higher: refused with nothing pulled or pushed", async () => {
    const name = uniqueProject("compatfloor");
    const a = projectOf(hostA, name);
    appendLine(a, { who: "test", type: "note" });
    const s3 = memoryS3();
    s3.objects.set(`${name}/compat.json`, new TextEncoder().encode('{"v":1,"compat":0}'));
    assert.equal((await syncProject(a, s3, loadConfig())).compatRaised, SYNC_COMPAT);

    s3.objects.set(`${name}/compat.json`, new TextEncoder().encode(`{"v":1,"compat":${String(SYNC_COMPAT)},"host":"elsewhere"}`));
    s3.stored.length = 0;
    const equal = await syncProject(a, s3, loadConfig());
    assert.equal(equal.compatRaised, undefined);
    assert.equal(floorOf(s3, name)?.host, "elsewhere", "an equal floor is never rewritten");
    assert.ok(!s3.stored.includes(`${name}/compat.json`));

    const higher = `{"v":1,"compat":${String(SYNC_COMPAT + 1)},"min_version":"9.0.0","host":"host-z","at":"2026-11-09T00:00:00.000Z"}`;
    s3.objects.set(`${name}/compat.json`, new TextEncoder().encode(higher));
    s3.objects.set(`${name}/ledger/host-z/01K5Z8QK5Q9S1N1B5N9S1N1B5N.jsonl`, new TextEncoder().encode(""));
    appendLine(a, { who: "test", type: "note" });
    const linesBefore = readLedger(a).length;
    const syncBefore = readFileSync(join(a.root, "sync.json"), "utf8");
    s3.stored.length = 0;
    const refused = await syncProject(a, s3, loadConfig());
    assert.equal(refused.skipped, "darius-outdated");
    assert.deepEqual(refused.outdated, { bucketCompat: SYNC_COMPAT + 1, ownCompat: SYNC_COMPAT, minVersion: "9.0.0", raisedBy: "host-z" });
    assert.deepEqual(s3.stored, [], "nothing was written to the bucket");
    assert.equal(refused.pulledChunks + refused.pushedChunks, 0);
    assert.equal(readLedger(a).length, linesBefore, "no chunk pulled, no host.version line added");
    assert.equal(readFileSync(join(a.root, "sync.json"), "utf8"), syncBefore, "last_sync stays: the sync did not happen");
    assert.equal(new TextDecoder().decode(s3.objects.get(`${name}/compat.json`)), higher, "the floor is never lowered");

    const pullOnly = await syncProject(a, s3, loadConfig(), { pullOnly: true });
    assert.equal(pullOnly.skipped, "darius-outdated", "pull-only refuses too: it would misread what it pulls");
    await assert.rejects(syncProject(a, failingGet(s3, `${name}/compat.json`, new Error("boom")), loadConfig()), /boom/u);
  });

  test("a failed read of compat.json is not compat 0: offline skips, a server error throws, and nothing is written", async () => {
    const name = uniqueProject("compatread");
    const a = projectOf(hostA, name);
    a.writeItem(ritual({}), { who: "test" });
    const base = memoryS3();
    const offline = await syncProject(a, failingGet(base, `${name}/compat.json`, new S3NetworkError("connection refused", {})), loadConfig());
    assert.equal(offline.skipped, "offline");
    assert.equal(offline.compatRaised, undefined);
    assert.deepEqual(base.stored, []);
    assert.equal(versionLines(a), 0, "a sync that never read the floor notes no version");

    await assert.rejects(syncProject(a, failingGet(base, `${name}/compat.json`, new S3Error("S3 GET: 503", 503)), loadConfig()), /503/u);
    assert.deepEqual(base.stored, []);
  });

  test("a pull-only sync never raises the floor", async () => {
    const name = uniqueProject("compatpull");
    const a = projectOf(hostA, name);
    const s3 = memoryS3();
    const report = await syncProject(a, s3, loadConfig(), { pullOnly: true });
    assert.equal(report.compatRaised, undefined);
    assert.deepEqual(s3.stored, []);
    assert.equal(versionLines(a), 0, "pull-only appends nothing either");
  });

  test("needsHostVersion: first, same, changed, and the newest line wins", () => {
    assert.equal(needsHostVersion([], "0.126.0"), true, "first");
    assert.equal(needsHostVersion([{ type: "note", id: "01A" }], "0.126.0"), true, "other lines do not count");
    assert.equal(needsHostVersion([versionLine("01A", "0.126.0")], "0.126.0"), false, "same");
    assert.equal(needsHostVersion([versionLine("01A", "0.126.0")], "0.127.0"), true, "changed");
    assert.equal(needsHostVersion([versionLine("01B", "0.127.0"), versionLine("01A", "0.126.0")], "0.126.0"), true, "the newest names 0.127.0: a rollback is a change too");
    assert.equal(needsHostVersion([versionLine("01A", "0.125.9"), versionLine("01B", "0.126.0")], "0.126.0"), false);
  });

  test("a sync appends one host.version line per version change, never one per sync", async () => {
    const name = uniqueProject("hostversion");
    const a = projectOf(hostA, name);
    const s3 = memoryS3();
    const first = await syncProject(a, s3, loadConfig());
    assert.equal(first.hostVersionNoted, true);
    assert.equal(first.pushedChunks, 1, "the line goes out with the same sync");
    const noted = readLedger(a).find((line) => line.type === HOST_VERSION_TYPE);
    assert.equal(noted?.version, VERSION);
    assert.equal(noted?.compat, SYNC_COMPAT);
    assert.equal(noted?.host, "hosta");
    await syncProject(a, s3, loadConfig());
    await syncProject(a, s3, loadConfig());
    assert.equal(versionLines(a), 1, "same version: no new line");
    appendLine(a, { who: "test", type: HOST_VERSION_TYPE, version: "0.0.1", compat: 0 });
    const changed = await syncProject(a, s3, loadConfig());
    assert.equal(changed.hostVersionNoted, true);
    assert.equal(versionLines(a), 3);
  });
});

const unavailable = await seaweedfsUnavailable();
if (unavailable !== null) console.error(`\n!!! SKIPPED: sync tests against SeaweedFS: ${unavailable}\n`);

describe("two hosts on one bucket", { skip: unavailable ?? false }, () => {
  let server: SeaweedFs;
  let hostA: Host;
  let hostB: Host;

  before(async () => {
    server = await startSeaweedFs();
    hostA = makeHost("hosta", server.endpoint);
    hostB = makeHost("hostb", server.endpoint);
  });

  after(async () => {
    await server.stop();
  });

  test("a run.started line with skill_hash travels as it is; the key is not a blob reference", async () => {
    const name = uniqueProject("skillhash");
    const a = projectOf(hostA, name);
    const skillHash = "a".repeat(64);
    const written = appendLine(a, { who: "test", type: "run.started", item: "ritual/heartbeat", run: "r1", skill_hash: skillHash });
    const pushed = await syncAs(hostA, name, server);
    assert.equal(pushed.pushedChunks, 1);
    assert.equal(pushed.blobsPushed, 0, "skill_hash names no blob");
    const pulled = await syncAs(hostB, name, server);
    assert.equal(pulled.blobsPulled, 0);
    const line = readLedger(projectOf(hostB, name)).find((one) => one.id === written.id);
    assert.equal(line?.skill_hash, skillHash);
  });

  test("a line and the blob it names travel from A to B", async () => {
    const name = uniqueProject("roundtrip");
    const a = projectOf(hostA, name);
    const findingsSha = putBlob(a, "all green\n");
    const written = appendLine(a, { who: "test", type: "run.completed", item: "ritual/heartbeat", run: "r1", outcome: "complete", findings_sha: findingsSha });

    const pushed = await syncAs(hostA, name, server);
    assert.equal(pushed.skipped, undefined);
    assert.equal(pushed.pushedChunks, 1);
    assert.equal(pushed.blobsPushed, 1);

    const pulled = await syncAs(hostB, name, server);
    assert.equal(pulled.pulledChunks, 1);
    assert.equal(pulled.blobsPulled, 1);
    const b = projectOf(hostB, name);
    // 0.126.0: each host's first sync also writes its host.version line.
    assert.deepEqual(readLedger(b).filter((line) => line.type !== HOST_VERSION_TYPE).map((line) => line.id), [written.id]);
    assert.deepEqual(readLedger(b).filter((line) => line.type === HOST_VERSION_TYPE).map((line) => line.host).toSorted(), ["hosta", "hostb"]);
    assert.equal(getBlobText(b, findingsSha), "all green\n");

    const again = await syncAs(hostB, name, server);
    assert.equal(again.pulledChunks + again.pushedChunks + again.itemsPulled + again.itemsPushed, 0, "a second sync moves nothing");
  });

  test("both hosts edit one item: the newer updated wins, the loser is a blob with a conflict line", async () => {
    const name = uniqueProject("conflict");
    projectOf(hostA, name).writeItem(ritual({}), { who: "test" });
    await syncAs(hostA, name, server);
    const first = await syncAs(hostB, name, server);
    assert.equal(first.itemsPulled, 1);

    const aEdit = ritual({ title: "A edit", updated: "2026-09-28T04:00:00.000Z" });
    const bEdit = ritual({ title: "B edit", updated: "2026-09-28T05:00:00.000Z" });
    projectOf(hostA, name).writeItem(aEdit, { who: "test" });
    projectOf(hostB, name).writeItem(bEdit, { who: "test" });
    const aPush = await syncAs(hostA, name, server);
    assert.equal(aPush.itemsPushed, 1);

    // B's edit is newer: B keeps it and pushes it; A's text is B's loser blob.
    const bSync = await syncAs(hostB, name, server);
    assert.deepEqual(bSync.conflicts, ["ritual/heartbeat"]);
    assert.equal(bSync.itemsPushed, 1);
    const b = projectOf(hostB, name);
    assert.equal(b.readItem<Ritual>("ritual", "heartbeat")?.header.title, "B edit");
    const aText = encodeItem(aEdit);
    assert.equal(getBlobText(b, sha256Hex(aText)), aText);
    const conflict = readLedger(b).find((line) => line.type === "conflict");
    assert.equal(conflict?.sha_lost, sha256Hex(aText));
    assert.equal(conflict?.sha_won, sha256Hex(encodeItem(bEdit)));

    // A pulls the winner and the conflict line, with no conflict of its own.
    const aPull = await syncAs(hostA, name, server);
    assert.deepEqual(aPull.conflicts, []);
    assert.equal(aPull.itemsPulled, 1);
    const a = projectOf(hostA, name);
    assert.equal(a.readItem<Ritual>("ritual", "heartbeat")?.header.title, "B edit");
    assert.ok(readLedger(a).some((line) => line.type === "conflict"));

    // The other direction: the remote edit is newer, so the local one loses.
    const aLater = ritual({ title: "A later", updated: "2026-09-28T07:00:00.000Z" });
    const bOlder = ritual({ title: "B older", updated: "2026-09-28T06:00:00.000Z" });
    projectOf(hostA, name).writeItem(aLater, { who: "test" });
    projectOf(hostB, name).writeItem(bOlder, { who: "test" });
    await syncAs(hostA, name, server);
    const bLoses = await syncAs(hostB, name, server);
    assert.deepEqual(bLoses.conflicts, ["ritual/heartbeat"]);
    assert.equal(bLoses.itemsPushed, 0);
    const bAfter = projectOf(hostB, name);
    assert.equal(bAfter.readItem<Ritual>("ritual", "heartbeat")?.header.title, "A later");
    const bOlderText = encodeItem(bOlder);
    assert.equal(getBlobText(bAfter, sha256Hex(bOlderText)), bOlderText);
  });

  test("a fresh lease held by another host skips with lease-held and exit 0", async () => {
    const name = uniqueProject("lease");
    projectOf(hostA, name).writeItem(ritual({}), { who: "test" });
    const lease = { holder: "elsewhere:4242", host: "elsewhere", pid: 4242, expires: new Date(Date.now() + 60_000).toISOString() };
    await server.s3.put(`${name}/lease.json`, JSON.stringify(lease), { ifNoneMatch: true });

    const report = await syncAs(hostA, name, server);
    assert.equal(report.skipped, "lease-held");
    assert.equal(report.pushedChunks, 1, "chunks never wait for the lease");
    assert.equal(await server.s3.head(`${name}/manifest.json`), null, "items wait for the lease");

    const cli = await runSyncCli(hostA, { project: name });
    assert.equal(cli.code, 0, "another host's lease is a normal skip, not a unit failure");
    assert.equal(JSON.parse(cli.output).ok, true);
    assert.equal(JSON.parse(cli.output).projects[0].skipped, "lease-held");

    // An expired lease is taken over.
    const expired = { ...lease, expires: new Date(Date.now() - 1000).toISOString() };
    await server.s3.del(`${name}/lease.json`);
    await server.s3.put(`${name}/lease.json`, JSON.stringify(expired), { ifNoneMatch: true });
    const cliAfter = await runSyncCli(hostA, { project: name });
    assert.equal(cliAfter.code, 0);
    assert.equal(JSON.parse(cliAfter.output).projects[0].itemsPushed, 1);
    assert.equal(await server.s3.head(`${name}/lease.json`), null, "the lease is released");
  });

  test("a process killed between chunk put and manifest put leaves whole objects, and a re-sync completes", async () => {
    const name = uniqueProject("crash");
    const a = projectOf(hostA, name);
    a.writeItem(ritual({}), { who: "test" });
    appendLine(a, { who: "test", type: "note", item: "ritual/heartbeat" });

    const script = join(sandbox, "crash-sync.ts");
    const src = (file: string): string => pathToFileURL(join(REPO, "src", "core", file)).href;
    writeFileSync(
      script,
      [
        `import { loadConfig } from "${src("config.ts")}";`,
        `import { loadCredentials } from "${src("credentials.ts")}";`,
        `import { createS3 } from "${src("s3.ts")}";`,
        `import { openProject } from "${src("store.ts")}";`,
        `import { syncProject } from "${src("sync.ts")}";`,
        "const cfg = loadConfig();",
        "if (cfg.remote === undefined) throw new Error('no remote');",
        "const real = createS3(cfg.remote, loadCredentials(cfg.remote.credentials));",
        "const s3 = { ...real, async put(key, body, o) {",
        "  if (key.endsWith('/manifest.json')) process.kill(process.pid, 'SIGKILL');",
        "  return real.put(key, body, o);",
        "} };",
        "await syncProject(openProject(process.argv[2], { create: true }), s3, cfg);",
        "",
      ].join("\n"),
    );
    const child = spawnSync(process.execPath, ["--no-warnings", script, name], {
      env: { ...process.env, DARIUS_STATE_DIR: hostA.state, DARIUS_CONFIG_DIR: hostA.config },
      encoding: "utf8",
    });
    assert.equal(child.signal, "SIGKILL", `child did not die at the manifest put: ${child.stderr}`);

    // Every object the dead process left is whole; the manifest never landed.
    const keys = (await server.s3.list(`${name}/`)).map((object) => object.key);
    assert.ok(!keys.includes(`${name}/manifest.json`));
    assert.ok(keys.includes(`${name}/lease.json`), "the dead process left its lease");
    for (const key of keys.filter((k) => k.includes("/ledger/"))) {
      const got = await server.s3.get(key);
      assert.ok(got !== null);
      assert.ok(parseLedgerText(new TextDecoder().decode(got.body), key).length > 0);
    }
    const item = await server.s3.get(`${name}/items/rituals/heartbeat.md`);
    assert.ok(item !== null);
    decodeItem(new TextDecoder().decode(item.body), "remote item");

    // Same host, dead holder: the lease is taken over at once and the sync completes.
    const resync = await syncAs(hostA, name, server);
    assert.equal(resync.skipped, undefined);
    assert.ok(await server.s3.head(`${name}/manifest.json`));
    assert.equal(await server.s3.head(`${name}/lease.json`), null);

    const b = await syncAs(hostB, name, server);
    assert.equal(b.itemsPulled, 1);
    const bProject = projectOf(hostB, name);
    assert.equal(readItemText(bProject, "ritual", "heartbeat"), readFileSync(join(hostA.state, name, "items", "rituals", "heartbeat.md"), "utf8"));
    assert.ok(readLedger(bProject).some((line) => line.type === "note"));
  });

  test("sync --all-projects carries the store-wide profiles in _global to a host that never had them", async () => {
    const profile: Document<Profile> = {
      header: {
        id: "01K5Z8QK5Q9S1N1B5N9S1N1B5P",
        kind: "profile",
        slug: "opus-skip",
        title: "opus-skip",
        created: "2026-09-28T03:00:00.000Z",
        updated: "2026-09-28T03:00:00.000Z",
        tags: [],
        model: "opus",
        permissions: "skip",
        args: ["--verbose"],
      },
      body: "",
    };
    projectOf(hostA, GLOBAL_PROJECT).writeItem(profile, { who: "test" });
    const pushed = await runSyncCli(hostA, { "all-projects": true });
    assert.equal(pushed.code, 0, pushed.output);
    assert.ok(JSON.parse(pushed.output).projects.some((report: SyncReport) => report.project === GLOBAL_PROJECT));

    useHost(hostB);
    rmSync(join(hostB.state, GLOBAL_PROJECT), { recursive: true, force: true });
    const pulled = await runSyncCli(hostB, { "all-projects": true });
    assert.equal(pulled.code, 0, pulled.output);
    useHost(hostB);
    const onB = openProject(GLOBAL_PROJECT).readItem<Profile>("profile", "opus-skip");
    assert.deepEqual(onB?.header, profile.header);
  });

  test("pull-only takes remote changes and writes nothing to the bucket", async () => {
    const name = uniqueProject("pullonly");
    projectOf(hostA, name).writeItem(ritual({}), { who: "test" });
    await syncAs(hostA, name, server);
    appendLine(projectOf(hostB, name), { who: "test", type: "note" });
    const objectCount = (await server.s3.list(`${name}/`)).length;

    const report = await syncAs(hostB, name, server, { pullOnly: true });
    assert.equal(report.itemsPulled, 1);
    assert.ok(report.pulledChunks >= 1);
    assert.equal(report.pushedChunks, 0);
    assert.equal((await server.s3.list(`${name}/`)).length, objectCount);
  });

  test("reseed refills a wiped project from one full host; B syncs clean, a fresh C pulls everything, a second reseed is a no-op", async () => {
    const name = uniqueProject("reseed");
    const hostC = makeHost("hostc", server.endpoint);
    const a = projectOf(hostA, name);
    a.writeItem(ritual({}), { who: "test" });
    const sha = putBlob(a, "all green\n");
    appendLine(a, { who: "test", type: "run.completed", item: "ritual/heartbeat", run: "ra", outcome: "complete", findings_sha: sha });
    assert.equal((await syncAs(hostA, name, server)).skipped, undefined);
    await syncAs(hostB, name, server);
    const b = projectOf(hostB, name);
    const shaB = putBlob(b, "output of b\n");
    appendLine(b, { who: "test", type: "run.completed", item: "ritual/heartbeat", run: "rb", outcome: "complete", output_sha: shaB });
    await syncAs(hostB, name, server);
    await syncAs(hostA, name, server);

    const keysBefore = (await server.s3.list(`${name}/`)).map((object) => object.key).toSorted();
    assert.ok(keysBefore.some((key) => key.includes("/ledger/hostb/")) && keysBefore.includes(`${name}/blobs/${shaB}`));
    for (const key of keysBefore) await server.s3.del(key);
    assert.deepEqual(await server.s3.list(`${name}/`), []);

    useHost(hostA);
    const localChunks = listChunks(openProject(name)).length;
    const reseed = await runSyncCli(hostA, { project: name, reseed: true });
    assert.equal(reseed.code, 0, reseed.output);
    const report: SyncReport = JSON.parse(reseed.output).projects[0];
    assert.equal(report.reseed, true);
    assert.ok(report.pushedChunks >= localChunks, "every chunk of both hosts went back");
    assert.equal(report.blobsPushed, 2);
    assert.deepEqual((await server.s3.list(`${name}/`)).map((object) => object.key).toSorted(), keysBefore);

    const plainB = await syncAs(hostB, name, server);
    assert.equal(plainB.skipped, undefined);
    assert.equal(plainB.pushedChunks + plainB.pulledChunks + plainB.blobsPushed + plainB.blobsPulled, 0, "B has all of it and pushes nothing");

    const onC = await syncAs(hostC, name, server);
    assert.equal(onC.pulledChunks, localChunks);
    assert.equal(onC.blobsPulled, 2);
    assert.equal(onC.itemsPulled, 1);
    const c = projectOf(hostC, name);
    assert.equal(getBlobText(c, sha), "all green\n");
    assert.equal(getBlobText(c, shaB), "output of b\n");
    assert.equal(readItemText(c, "ritual", "heartbeat"), readItemText(projectOf(hostA, name), "ritual", "heartbeat"));

    const again = await syncAs(hostA, name, server, { reseed: true });
    assert.equal(again.pushedChunks, 0);
    assert.equal(again.blobsPushed, 0);
    assert.equal(again.itemsPushed, 0);
  });
  test("a host with a lower compat refuses once another host raised the floor, writes nothing, and darius sync exits 1 with one line", async () => {
    const name = uniqueProject("compattwo");
    const a = projectOf(hostA, name);
    a.writeItem(ritual({}), { who: "test" });
    appendLine(a, { who: "test", type: "note" });
    const raised = await syncAs(hostA, name, server);
    assert.equal(raised.compatRaised, SYNC_COMPAT);

    const b = projectOf(hostB, name);
    appendLine(b, { who: "test", type: "note", item: "ritual/heartbeat" });
    const objectsBefore = (await server.s3.list(`${name}/`)).map((object) => `${object.key} ${object.etag}`).toSorted();
    const older = { compat: SYNC_COMPAT - 1, minVersion: "0.125.0" };
    const refused = await syncAs(hostB, name, server, { compat: older });
    assert.equal(refused.skipped, "darius-outdated");
    assert.deepEqual(refused.outdated, { bucketCompat: SYNC_COMPAT, ownCompat: SYNC_COMPAT - 1, minVersion: SYNC_COMPAT_SINCE, raisedBy: "hosta" });
    assert.equal(refused.pulledChunks + refused.pushedChunks + refused.itemsPulled + refused.itemsPushed, 0);
    assert.deepEqual((await server.s3.list(`${name}/`)).map((object) => `${object.key} ${object.etag}`).toSorted(), objectsBefore, "not one object added or changed");
    assert.equal(readItemText(b, "ritual", "heartbeat"), null, "nothing was pulled");
    assert.deepEqual(readLedger(b).map((line) => line.type), ["note"], "only its own line, and no host.version");

    // The same host updated: it syncs, and its waiting line goes out.
    const updated = await syncAs(hostB, name, server);
    assert.equal(updated.skipped, undefined);
    assert.equal(updated.itemsPulled, 1);
    assert.equal(updated.compatRaised, undefined, "an equal floor stays");

    // The CLI: one clear line with min_version and the update command, exit 1.
    await server.s3.put(`${name}/compat.json`, JSON.stringify({ v: 1, compat: SYNC_COMPAT + 1, min_version: "9.9.0", host: "hosta", at: new Date().toISOString() }));
    const cli = await runSyncCli(hostB, { project: name });
    assert.equal(cli.code, 1);
    assert.equal(JSON.parse(cli.output).ok, false);
    assert.equal(JSON.parse(cli.output).projects[0].skipped, "darius-outdated");
    const lines = cli.errors.filter((line) => line.includes(name));
    assert.equal(lines.length, 1, cli.errors.join("\n"));
    assert.match(lines[0] ?? "", /needs darius 9\.9\.0 or newer .*Update it: darius update$/u);
  });
});
