/**
 * Mirror sync (0.140.0): the `[sync]` config table (src/core/config.ts), the
 * mirror loop of `darius sync --all-projects` (src/cli/sync.ts), the failure
 * backoff state (src/core/mirror.ts) and the workdir guard that keeps a
 * mirrored copy from running work without a checkout (src/core/workdir.ts).
 *
 * The loop runs against an in-memory bucket, and the command against the
 * in-process fake S3 over HTTP. Two hosts share the bucket ("host-a" mirrors,
 * "host-b" seeds it); the tests switch hosts by pointing DARIUS_STATE_DIR and
 * DARIUS_CONFIG_DIR at their dirs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs } from "../src/cli/args.ts";
import { mirrorMissing, syncCommand, type SyncRun } from "../src/cli/sync.ts";
import { DEFAULT_MIRROR_EXCLUDE, loadConfig } from "../src/core/config.ts";
import { appendLine, readLedger } from "../src/core/ledger.ts";
import { writeLink } from "../src/core/links.ts";
import {
  chooseMirrorProjects,
  isInBackoff,
  isMirroredHere,
  markMirrored,
  MIRRORED_LINE,
  MIRROR_RETRY_MS,
  readMirrorFailures,
  recordMirrorFailure,
  type MirrorFailure,
} from "../src/core/mirror.ts";
import type { Document, LedgerLine, Policy, Ritual } from "../src/core/model.ts";
import { createS3, S3NetworkError, type ListedObject, type S3, type S3Prefixes } from "../src/core/s3.ts";
import { listProjects, openProject } from "../src/core/store.ts";
import { syncProject } from "../src/core/sync.ts";
import { ulid } from "../src/core/ulid.ts";
import { checkoutDir, LINKED_LINE, projectWorkdir, ritualHost } from "../src/core/workdir.ts";
import { startFakeS3 } from "./helpers/fake-s3.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-mirror-"));
delete process.env.DARIUS_PROJECT;

interface Host {
  state: string;
  config: string;
}

function makeHost(name: string, extra: string[] = [], dir: string = name): Host {
  const host: Host = { state: join(SANDBOX, dir, "state"), config: join(SANDBOX, dir, "config") };
  mkdirSync(host.state, { recursive: true });
  mkdirSync(host.config, { recursive: true });
  writeFileSync(join(host.config, "config.toml"), [`host = "${name}"`, "", ...extra, ""].join("\n"));
  return host;
}

const HOST_A = makeHost("host-a", ["[sync]", "mirror = true"]);
const HOST_B = makeHost("host-b");

function useHost(host: Host): void {
  process.env.DARIUS_STATE_DIR = host.state;
  process.env.DARIUS_CONFIG_DIR = host.config;
}

useHost(HOST_A);

// --- an in-memory bucket ---------------------------------------------------------------

interface MemoryS3 extends S3, S3Prefixes {
  objects: Map<string, Uint8Array>;
  /** How many times the top-level listing ran. */
  prefixListings: number;
  /** Every key a get, put, head or list touched whose project is here fails. */
  failing: Set<string>;
  /** Projects whose sync was started (the first touched key). */
  touched: Set<string>;
}

function etagOf(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

function memoryS3(): MemoryS3 {
  const objects = new Map<string, Uint8Array>();
  const failing = new Set<string>();
  const touched = new Set<string>();
  const touch = (key: string): void => {
    const project = key.split("/")[0] ?? "";
    touched.add(project);
    if (failing.has(project)) throw new Error(`boom talking to https://user:secret@bucket.example/${project}/x`);
  };
  const bucket: MemoryS3 = {
    objects,
    prefixListings: 0,
    failing,
    touched,
    async put(key, body, o) {
      touch(key);
      if (o?.ifNoneMatch === true && objects.has(key)) return { conflict: true };
      const bytes = body instanceof Uint8Array ? new Uint8Array(body) : new TextEncoder().encode(body);
      objects.set(key, bytes);
      return { etag: etagOf(bytes) };
    },
    async get(key) {
      touch(key);
      const body = objects.get(key);
      return body === undefined ? null : { body: new Uint8Array(body), etag: etagOf(body) };
    },
    async head(key) {
      touch(key);
      const body = objects.get(key);
      return body === undefined ? null : { etag: etagOf(body), size: body.length };
    },
    async del(key) {
      touch(key);
      objects.delete(key);
    },
    async list(prefix): Promise<ListedObject[]> {
      touch(prefix);
      return [...objects].filter(([key]) => key.startsWith(prefix)).map(([key, body]) => ({ key, etag: etagOf(body), size: body.length }));
    },
    async ensureBucket() {
      return "exists";
    },
    async listPrefixes() {
      bucket.prefixListings += 1;
      return [...new Set([...objects.keys()].map((key) => key.slice(0, key.indexOf("/") + 1)).filter((prefix) => prefix !== ""))].toSorted();
    },
  };
  return bucket;
}

/** Puts a project with one ledger line into `s3`, as host-b. Leaves the env on host-a. */
async function seed(s3: S3, names: readonly string[]): Promise<void> {
  useHost(HOST_B);
  try {
    const cfg = loadConfig();
    for (const name of names) {
      const project = openProject(name, { create: true });
      appendLine(project, { who: "test", type: "note", text: `from host-b: ${name}` });
      await syncProject(project, s3, cfg);
    }
  } finally {
    useHost(HOST_A);
  }
}

function newRun(): SyncRun {
  return { reports: [], errors: [] };
}

function linesOf(project: string, type: string): LedgerLine[] {
  return readLedger(openProject(project)).filter((line) => line.type === type);
}

// --- the config table ------------------------------------------------------------------

function withConfig(text: string, check: () => void): void {
  const previous = process.env.DARIUS_CONFIG_DIR;
  const dir = mkdtempSync(join(SANDBOX, "cfg-"));
  writeFileSync(join(dir, "config.toml"), text);
  process.env.DARIUS_CONFIG_DIR = dir;
  try {
    check();
  } finally {
    if (previous === undefined) delete process.env.DARIUS_CONFIG_DIR;
    else process.env.DARIUS_CONFIG_DIR = previous;
  }
}

test("config: the mirror is off and the exclude list is the default when there is no [sync] table", () => {
  withConfig('host = "host-c"\n', () => {
    const config = loadConfig();
    assert.equal(config.sync.mirror, false);
    assert.deepEqual(config.sync.mirrorExclude, ["demo", "darius-proof", "darius-selftest", "box", "_global"]);
    assert.deepEqual(config.sync.mirrorExclude, DEFAULT_MIRROR_EXCLUDE);
  });
});

test("config: [sync] sets the mirror and replaces the exclude list", () => {
  withConfig('host = "host-c"\n[sync]\nmirror = true\nmirror_exclude = ["a", "b", "a"]\n', () => {
    assert.deepEqual(loadConfig().sync, { mirror: true, mirrorExclude: ["a", "b"] });
  });
  withConfig('host = "host-c"\n[sync]\nmirror = true\nmirror_exclude = []\n', () => {
    assert.deepEqual(loadConfig().sync.mirrorExclude, [], "an empty list excludes nothing");
  });
  withConfig('host = "host-c"\n[sync]\nmirror = true\n', () => {
    assert.deepEqual(loadConfig().sync.mirrorExclude, DEFAULT_MIRROR_EXCLUDE, "the list defaults when only the switch is set");
  });
});

test("config: wrong types and unknown keys in [sync] are refused with a clear error", () => {
  withConfig('host = "host-c"\n[sync]\nmirror = "yes"\n', () => {
    assert.throws(loadConfig, /\[sync\] "mirror" must be true or false/u);
  });
  withConfig('host = "host-c"\n[sync]\nmirror_exclude = "demo"\n', () => {
    assert.throws(loadConfig, /\[sync\] mirror_exclude must be a list of project names/u);
  });
  withConfig('host = "host-c"\n[sync]\nmirror_exclude = ["demo", ""]\n', () => {
    assert.throws(loadConfig, /\[sync\] mirror_exclude must not hold an empty name/u);
  });
  withConfig('host = "host-c"\n[sync]\nmirrors = true\n', () => {
    assert.throws(loadConfig, /\[sync\] has an unknown key "mirrors"/u);
  });
});

// --- choosing prefixes -----------------------------------------------------------------

test("chooseMirrorProjects drops invalid names, excluded names, local projects and projects in backoff", () => {
  const now = Date.parse("2026-11-25T12:00:00Z");
  const recent: MirrorFailure = { project: "recent", error: "x", at: "2026-11-25T01:00:00Z" };
  const old: MirrorFailure = { project: "old", error: "x", at: "2026-11-24T11:59:00Z" };
  const chosen = chooseMirrorProjects({
    prefixes: ["zeta/", "alpha/", "demo/", "mine/", "bad name/", ".hidden/", "recent/", "old/", "_global/"],
    exclude: DEFAULT_MIRROR_EXCLUDE,
    local: ["mine"],
    failures: [recent, old],
    now,
  });
  assert.deepEqual(chosen, ["alpha", "old", "zeta"]);
  assert.equal(isInBackoff([recent], "recent", now), true);
  assert.equal(isInBackoff([old], "old", now), false, "24 h and one minute: tried again");
  assert.equal(isInBackoff([{ ...old, at: new Date(now - MIRROR_RETRY_MS + 1000).toISOString() }], "old", now), true);
  assert.equal(isInBackoff([{ ...old, at: "not a time" }], "old", now), false, "an unreadable time is no backoff");
});

test("readMirrorFailures is empty for a missing or broken file", () => {
  useHost(makeHost("host-f"));
  assert.deepEqual(readMirrorFailures(), []);
  writeFileSync(join(process.env.DARIUS_STATE_DIR ?? "", "mirror-failures.json"), "{not json");
  assert.deepEqual(readMirrorFailures(), []);
  writeFileSync(join(process.env.DARIUS_STATE_DIR ?? "", "mirror-failures.json"), JSON.stringify({ v: 1, failures: [{ project: "p" }, { project: "q", error: "e", at: "2026-01-01T00:00:00Z" }] }));
  assert.deepEqual(readMirrorFailures(), [{ project: "q", error: "e", at: "2026-01-01T00:00:00Z" }], "an entry without all three fields is dropped");
  recordMirrorFailure({ project: "q", error: "again", at: "2026-02-01T00:00:00Z" });
  assert.deepEqual(readMirrorFailures(), [{ project: "q", error: "again", at: "2026-02-01T00:00:00Z" }], "one entry per project");
  useHost(HOST_A);
});

// --- the mirror loop -------------------------------------------------------------------

test("mirror: a missing project is synced in full and gets one project.mirrored line; excluded and local ones are skipped", async () => {
  const s3 = memoryS3();
  await seed(s3, ["m-alpha", "m-beta", "m-local", "demo", "darius-proof"]);
  s3.objects.set("not a project/x", new Uint8Array([1]));
  // The host already has m-local; a mirrored copy of it would be wrong.
  await syncProject(openProject("m-local", { create: true }), s3, loadConfig());
  s3.prefixListings = 0;
  s3.touched.clear();

  const run = newRun();
  await mirrorMissing(s3, loadConfig(), run, Date.parse("2026-11-25T12:00:00Z"));

  assert.deepEqual(run.mirrored, ["m-alpha", "m-beta"]);
  assert.deepEqual(run.mirrorFailed, []);
  assert.deepEqual(run.errors, []);
  assert.equal(s3.prefixListings, 1, "one listing per run");
  assert.deepEqual(run.reports.map((report) => report.project), ["m-alpha", "m-beta"]);
  assert.equal(listProjects().includes("demo"), false);
  assert.equal(listProjects().includes("darius-proof"), false);
  assert.equal(s3.touched.has("demo") || s3.touched.has("darius-proof") || s3.touched.has("not a project"), false, "an excluded or invalid prefix is never opened");
  assert.equal(s3.touched.has("m-local"), false, "a project this host has is left to the normal loop");
  assert.equal(linesOf("m-local", MIRRORED_LINE).length, 0);

  for (const name of ["m-alpha", "m-beta"]) {
    assert.equal(linesOf(name, MIRRORED_LINE).length, 1, name);
    assert.equal(linesOf(name, MIRRORED_LINE)[0]?.host, "host-a");
    assert.equal(linesOf(name, "note").length, 1, "the host-b line came across");
    assert.ok(isMirroredHere(readLedger(openProject(name))));
    // A normal full sync: this host's own lines went back to the bucket.
    assert.ok([...s3.objects.keys()].some((key) => key.startsWith(`${name}/ledger/host-a/`)), `${name} pushed`);
  }
  assert.deepEqual(readMirrorFailures(), []);

  // A second run: both are local now, so nothing is listed as missing and no line is added.
  const again = newRun();
  await mirrorMissing(s3, loadConfig(), again);
  assert.deepEqual(again.mirrored, []);
  assert.equal(linesOf("m-alpha", MIRRORED_LINE).length, 1);
  assert.equal(markMirrored(openProject("m-alpha")), false, "marked once per host");
});

test("mirror: a failing prefix is recorded, removed, skipped for 24 h, retried after, and a success clears it", async () => {
  const s3 = memoryS3();
  await seed(s3, ["m-gamma", "m-delta"]);
  s3.failing.add("m-gamma");
  const t0 = Date.parse("2026-12-01T00:00:00Z");

  const first = newRun();
  await mirrorMissing(s3, loadConfig(), first, t0);
  assert.deepEqual(first.mirrored, ["m-delta"]);
  assert.equal(first.mirrorFailed?.length, 1);
  assert.equal(first.mirrorFailed?.[0]?.project, "m-gamma");
  assert.match(first.mirrorFailed?.[0]?.error ?? "", /boom talking to/u);
  assert.doesNotMatch(first.mirrorFailed?.[0]?.error ?? "", /secret/u, "the message is scrubbed");
  assert.equal(first.errors.length, 1, "a mirror failure is an error of the run, so the command exits 1");
  assert.equal(first.errors[0]?.project, "m-gamma");
  assert.equal(listProjects().includes("m-gamma"), false, "the half-made copy is removed so the next try is clean");
  assert.deepEqual(
    readMirrorFailures().map((failure) => [failure.project, failure.at]),
    [["m-gamma", "2026-12-01T00:00:00.000Z"]],
  );

  // Within 24 h: skipped, never opened again.
  s3.touched.clear();
  const within = newRun();
  await mirrorMissing(s3, loadConfig(), within, t0 + MIRROR_RETRY_MS - 60_000);
  assert.deepEqual(within.mirrored, []);
  assert.deepEqual(within.errors, []);
  assert.equal(s3.touched.has("m-gamma"), false);

  // After 24 h it is tried again, and fails again: the entry moves to the new time.
  const after = newRun();
  await mirrorMissing(s3, loadConfig(), after, t0 + MIRROR_RETRY_MS + 60_000);
  assert.equal(s3.touched.has("m-gamma"), true);
  assert.equal(after.errors.length, 1);
  assert.equal(readMirrorFailures().length, 1);

  // Later, the bucket works again: the project is mirrored and its entry goes.
  s3.failing.clear();
  const fixed = newRun();
  await mirrorMissing(s3, loadConfig(), fixed, t0 + 3 * MIRROR_RETRY_MS);
  assert.deepEqual(fixed.mirrored, ["m-gamma"]);
  assert.deepEqual(readMirrorFailures(), []);
  assert.equal(linesOf("m-gamma", MIRRORED_LINE).length, 1);
});

test("mirror: an unreachable bucket adds nothing, and a refused listing is an error of the run", async () => {
  const s3 = memoryS3();
  const offline = newRun();
  await mirrorMissing({ ...s3, listPrefixes: () => Promise.reject(new S3NetworkError("connection refused", {})) }, loadConfig(), offline);
  assert.deepEqual(offline.errors, [], "the project syncs already say offline");
  assert.deepEqual(offline.mirrored, []);

  const denied = newRun();
  await mirrorMissing({ ...s3, listPrefixes: () => Promise.reject(new Error("S3 GET b: 403 AccessDenied")) }, loadConfig(), denied);
  assert.equal(denied.errors.length, 1);
  assert.match(denied.errors[0]?.error ?? "", /cannot list the bucket: S3 GET b: 403/u);
});

// --- the command, over HTTP ------------------------------------------------------------

interface CliRun {
  code: number;
  stdout: string;
}

async function runSync(argv: string[]): Promise<CliRun> {
  const out: string[] = [];
  const { log, error } = console;
  console.log = (...parts: string[]) => out.push(parts.join(" "));
  console.error = () => undefined;
  try {
    const code = await syncCommand.run(parseArgs(argv));
    return { code, stdout: out.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}

function remoteTable(endpoint: string, credentials: string): string[] {
  return ["[remote]", `endpoint = "${endpoint}"`, 'bucket = "backups"', "path_style = true", "allow_http = true", "sse = false", `credentials = "${credentials}"`];
}

test("darius sync --all-projects: mirror on adds the mirrored fields and lists once; mirror off lists nothing and adds no field", async () => {
  const fake = await startFakeS3();
  try {
    const credentials = join(SANDBOX, "credentials");
    writeFileSync(credentials, "[default]\naws_access_key_id = AKIAEXAMPLE\naws_secret_access_key = example-secret\n", { mode: 0o600 });
    const remote = remoteTable(fake.endpoint, credentials);
    const hostB = makeHost("host-b", remote, "host-b-remote");
    const hostA = makeHost("host-a", [...remote, "", "[sync]", "mirror = true", 'mirror_exclude = ["e-skip"]'], "host-a-remote");
    const hostOff = makeHost("host-a", remote, "host-a-off");

    useHost(hostB);
    const bucket = createS3({ endpoint: fake.endpoint, bucket: "backups", region: "us-east-1", path_style: true, allow_http: true, sse: false, credentials }, { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "example-secret" });
    for (const name of ["e-one", "e-skip"]) {
      const project = openProject(name, { create: true });
      appendLine(project, { who: "test", type: "note", text: name });
      await syncProject(project, bucket, loadConfig());
    }

    // Mirror off: the same host, no [sync] table. No delimiter listing, no new project.
    useHost(hostOff);
    fake.log.length = 0;
    const plain = await runSync(["--all-projects", "--json"]);
    assert.equal(plain.code, 0, plain.stdout);
    const plainKeys: string[] = Object.keys(JSON.parse(plain.stdout));
    assert.equal(plainKeys.includes("mirrored"), false);
    assert.equal(plainKeys.includes("mirrorFailed"), false);
    assert.equal(fake.log.some((line) => line.includes("delimiter")), false, fake.log.join("\n"));
    assert.equal(listProjects().includes("e-one"), false);

    // Mirror on.
    useHost(hostA);
    fake.log.length = 0;
    const mirrored = await runSync(["--all-projects", "--json"]);
    assert.equal(mirrored.code, 0, mirrored.stdout);
    const json: { ok: boolean; mirrored: string[]; mirrorFailed: unknown[]; projects: { project: string }[]; errors: unknown[] } = JSON.parse(mirrored.stdout);
    assert.deepEqual(json.mirrored, ["e-one"]);
    assert.deepEqual(json.mirrorFailed, []);
    assert.ok(json.projects.some((report) => report.project === "e-one"));
    assert.equal(fake.log.filter((line) => line.includes("delimiter")).length, 1, "one listing per run");
    assert.equal(linesOf("e-one", MIRRORED_LINE).length, 1);
    assert.equal(listProjects().includes("e-skip"), false);

    // --pull-only never mirrors.
    fake.log.length = 0;
    const pullOnly = await runSync(["--all-projects", "--pull-only", "--json"]);
    assert.equal(Object.keys(JSON.parse(pullOnly.stdout)).includes("mirrored"), false);
    assert.equal(fake.log.some((line) => line.includes("delimiter")), false);
  } finally {
    useHost(HOST_A);
    await fake.stop();
  }
});

// --- the guard -------------------------------------------------------------------------

const POLICY: Policy = { mode: "report", may: [], hold: [], model: "haiku", max_turns: 3 };

function ritualDoc(host?: string): Document<Ritual> {
  const now = new Date().toISOString();
  const header: Ritual = { id: ulid(), kind: "ritual", slug: "r", title: "R", created: now, updated: now, tags: [], cadence: "1d", anchor: "due", policy: POLICY };
  if (host !== undefined) header.host = host;
  return { header, body: "x\n" };
}

/** A project with an import line whose repo exists on this host, and the repo dir. */
function importedProject(name: string): string {
  const repo = join(SANDBOX, `${name}-repo`);
  mkdirSync(join(repo, ".tracker"), { recursive: true });
  appendLine(openProject(name, { create: true }), { who: "test", type: "import", source: join(repo, ".tracker") });
  return repo;
}

test("guard: a project with no repo is the store dir, and a mirrored copy of it is no workdir", () => {
  const plain = openProject("g-store", { create: true });
  const before = projectWorkdir(plain, readLedger(plain));
  assert.ok("dir" in before && before.from === "store", "an unmirrored project with no repo still runs in its store");

  const mirrored = openProject("g-mirrored", { create: true });
  markMirrored(mirrored);
  const where = projectWorkdir(mirrored, readLedger(mirrored));
  assert.ok("missing" in where, JSON.stringify(where));
  assert.match(where.detail, /mirrored copy on this host.*darius link/u);
  assert.equal(checkoutDir(mirrored, readLedger(mirrored)), undefined);
});

test("guard: a mirrored copy whose import path exists here does not resolve to the import", () => {
  const plain = "g-import-plain";
  const repo = importedProject(plain);
  const unmirrored = openProject(plain);
  const control = projectWorkdir(unmirrored, readLedger(unmirrored));
  assert.ok("dir" in control && control.from === "import" && control.dir === repo);
  assert.equal(checkoutDir(unmirrored, readLedger(unmirrored)), repo);

  const name = "g-import-mirrored";
  const mirroredRepo = importedProject(name);
  assert.ok(existsSync(mirroredRepo));
  const project = openProject(name);
  markMirrored(project);
  const where = projectWorkdir(project, readLedger(project));
  assert.ok("missing" in where, JSON.stringify(where));
  assert.equal(checkoutDir(project, readLedger(project)), undefined);
});

test("guard: a link still wins over the mirrored line, and the other host's mirrored line does not count", () => {
  const name = "g-linked";
  const project = openProject(name, { create: true });
  markMirrored(project);
  const checkout = join(SANDBOX, `${name}-checkout`);
  mkdirSync(checkout, { recursive: true });
  writeLink(name, checkout);
  const where = projectWorkdir(project, readLedger(project));
  assert.ok("dir" in where && where.from === "link" && where.dir === checkout);
  assert.equal(checkoutDir(project, readLedger(project)), checkout);

  const foreign: LedgerLine = { v: 1, id: ulid(), at: new Date().toISOString(), host: "host-b", project: name, who: "test", type: MIRRORED_LINE };
  assert.equal(isMirroredHere([foreign]), false);
  assert.equal(isMirroredHere([{ ...foreign, host: "host-a" }]), true);
});

test("guard: ritualHost treats a mirrored copy without a link as not linked here", () => {
  const name = "g-host";
  const repo = importedProject(name);
  const project = openProject(name);
  assert.ok(existsSync(repo));
  assert.deepEqual(ritualHost(project, readLedger(project), ritualDoc()), { host: "host-a", why: "linked" });

  markMirrored(project);
  assert.equal(ritualHost(project, readLedger(project), ritualDoc()), null, "no checkout here, none known elsewhere");
  assert.deepEqual(ritualHost(project, readLedger(project), ritualDoc("host-z")), { host: "host-z", why: "pinned" }, "a pin still decides");

  const elsewhere = [...readLedger(project), { v: 1, id: ulid(), at: new Date().toISOString(), host: "host-b", project: name, who: "test", type: LINKED_LINE, path: "/srv/checkout" } satisfies LedgerLine];
  assert.deepEqual(ritualHost(project, elsewhere, ritualDoc()), { host: "host-b", why: "linked" }, "falls through to the host that linked it");

  writeLink(name, repo);
  assert.deepEqual(ritualHost(project, readLedger(project), ritualDoc()), { host: "host-a", why: "linked" }, "a link here wins");
});

test("the mirrored line is readable as plain ledger text", () => {
  const name = "g-text";
  const project = openProject(name, { create: true });
  markMirrored(project);
  const text = readFileSync(join(project.root, "ledger", "host-a", "open.jsonl"), "utf8");
  assert.match(text, /"type":"project\.mirrored"/u);
});
