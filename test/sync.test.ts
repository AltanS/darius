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
import { appendLine, parseLedgerText, readLedger } from "../src/core/ledger.ts";
import type { Document, Profile, Ritual } from "../src/core/model.ts";
import { createS3 } from "../src/core/s3.ts";
import { decodeItem, encodeItem, getBlobText, GLOBAL_PROJECT, openProject, putBlob, readItemText, sha256Hex } from "../src/core/store.ts";
import type { Project } from "../src/core/store.ts";
import { decideItem, isLocalNewer, syncProject } from "../src/core/sync.ts";
import type { SyncOptions, SyncReport } from "../src/core/sync.ts";
import { seaweedfsUnavailable, startSeaweedFs, TEST_CREDENTIALS } from "./helpers/seaweedfs.ts";
import type { SeaweedFs } from "./helpers/seaweedfs.ts";

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
async function runSyncCli(host: Host, flags: Record<string, string | boolean>): Promise<{ code: number; output: string }> {
  useHost(host);
  const printed: string[] = [];
  const original = console.log;
  console.log = (line: string) => {
    printed.push(line);
  };
  try {
    const code = await syncCommand.run({ positional: [], flags, json: true, repeated: {} });
    return { code, output: printed.join("\n") };
  } finally {
    console.log = original;
  }
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
    assert.deepEqual(readLedger(b).map((line) => line.id), [written.id]);
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
});
