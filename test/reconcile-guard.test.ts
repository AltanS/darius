/**
 * The reconcile guard (0.129.0, src/core/reconcile-guard.ts): a host
 * reconciles a project's marker into the store only when its checkout is not
 * older than the marker the store was last reconciled from.
 *
 * The two-host test runs the real CLI for two hosts ("host-a", "host-b")
 * that share a fake bucket and clone one upstream repo, as the incident of
 * 2026-11-09 did: host-a at C2 adopts a ritual, host-b at C1 runs run-due.
 * The unit tests judge the decision against temp git repos.
 */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs } from "../src/cli/args.ts";
import { ritualCommand } from "../src/cli/ritual.ts";
import { ritualLifecycle } from "../src/core/due.ts";
import { appendLine, readLedger } from "../src/core/ledger.ts";
import type { LedgerLine, Ritual } from "../src/core/model.ts";
import { reconcileProject, RITUAL_DEFINED } from "../src/core/reconcile.ts";
import {
  commitRelation,
  decideReconcile,
  headFacts,
  heldDoctorLine,
  latestRecord,
  markerHash,
  readHeldRecord,
  readStaleRecord,
  staleDoctorLine,
  type GuardDecision,
  type ReconcileRecord,
} from "../src/core/reconcile-guard.ts";
import { formatReport, type BatchReport, type ProjectEntry } from "../src/runner/report.ts";
import { openProject, type Project } from "../src/core/store.ts";
import { startFakeS3, type FakeS3 } from "./helpers/fake-s3.ts";
import { NO_GIT } from "./helpers/git.ts";

const BIN = join(import.meta.dirname, "..", "bin", "darius");
const SANDBOX = mkdtempSync(join(tmpdir(), "darius-reconcile-guard-"));
// The unit tests' own store, as host "host-u". The two-host test gives each CLI host its own.
process.env.DARIUS_STATE_DIR = join(SANDBOX, "unit", "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "unit", "config");
mkdirSync(process.env.DARIUS_CONFIG_DIR, { recursive: true });
writeFileSync(join(process.env.DARIUS_CONFIG_DIR, "config.toml"), 'host = "host-u"\n');
delete process.env.DARIUS_PROJECT;
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
let bucket: FakeS3 | undefined;

before(async () => {
  bucket = await startFakeS3("darius-test");
});
after(async () => {
  await bucket?.stop();
  rmSync(SANDBOX, { recursive: true, force: true });
});

const IDENTITY = ["-c", "user.name=darius-test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false"];

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", [...IDENTITY, ...args], { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} in ${cwd}: ${result.stderr}`);
  return result.stdout.trim();
}

/** Writes the marker, commits it and returns the short commit. */
function commitMarker(dir: string, text: string, message: string): string {
  writeFileSync(join(dir, ".darius.toml"), text);
  git(dir, ["add", "--all"]);
  git(dir, ["commit", "--quiet", "--message", message]);
  return git(dir, ["rev-parse", "--short=12", "HEAD"]);
}

// --- two hosts ------------------------------------------------------------------------

interface Host {
  name: string;
  env: NodeJS.ProcessEnv;
  state: string;
  config: string;
}

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** A host with its own store and config, on the shared fake bucket, with no harness and no box. */
function makeHost(name: string, endpoint: string): Host {
  const home = join(SANDBOX, name);
  const config = join(home, "config");
  mkdirSync(config, { recursive: true });
  const credentials = join(config, "credentials");
  writeFileSync(credentials, "[default]\naws_access_key_id = test-key\naws_secret_access_key = test-secret\n", { mode: 0o600 });
  writeFileSync(
    join(config, "config.toml"),
    [
      `host = "${name}"`,
      "",
      "[remote]",
      `endpoint = "${endpoint}"`,
      'bucket = "darius-test"',
      'region = "us-east-1"',
      "path_style = true",
      "allow_http = true",
      "sse = false",
      `credentials = "${credentials}"`,
      "",
      "[runner]",
      `claude = "${join(home, "no-claude")}"`,
      "",
      "[run]",
      'sandbox = "off"',
      "",
      "[notify]",
      'webhook = ""',
      "",
    ].join("\n"),
  );
  const state = join(home, "state");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    DARIUS_STATE_DIR: state,
    DARIUS_CONFIG_DIR: config,
    DARIUS_WHO: "dev@example.com",
  };
  delete env.DARIUS_PROJECT;
  return { name, env, state, config };
}

function darius(at: Host, argv: string[], cwd: string): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(BIN, argv, { cwd, env: at.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function ok(at: Host, argv: string[], cwd: string): Promise<string> {
  const result = await darius(at, argv, cwd);
  assert.equal(result.code, 0, `${at.name}: darius ${argv.join(" ")}: ${result.stdout}${result.stderr}`);
  return result.stdout;
}

/** Reads `host`'s own store in this process: the store paths come from the environment per call. */
function onHost<T>(host: Host, read: () => T): T {
  const saved = { state: process.env.DARIUS_STATE_DIR, config: process.env.DARIUS_CONFIG_DIR };
  process.env.DARIUS_STATE_DIR = host.state;
  process.env.DARIUS_CONFIG_DIR = host.config;
  try {
    return read();
  } finally {
    process.env.DARIUS_STATE_DIR = saved.state;
    process.env.DARIUS_CONFIG_DIR = saved.config;
  }
}

function twoHostMarker(project: string, rituals: { dailyTitle: string; withExtra: boolean }): string {
  const lines = [
    "v = 3",
    `project = "${project}"`,
    'max_mode = "act"',
    'tz = "UTC"',
    "",
    "[rituals.daily]",
    `title = "${rituals.dailyTitle}"`,
    'cadence = "1d"',
    'skill = "daily"',
    'mode = "report"',
    'may = ["Bash(date)"]',
    "",
    "[rituals.weekly]",
    'title = "Weekly"',
    'cadence = "1w"',
    'skill = "daily"',
    'mode = "off"',
    "",
  ];
  if (rituals.withExtra) lines.push("[rituals.extra]", 'title = "Extra"', 'cadence = "1w"', 'skill = "daily"', 'mode = "off"', "");
  return lines.join("\n");
}

test("two hosts: a host at an older commit neither retires the newer host's ritual nor rewrites the others, and says so; after a pull it is a no-op", { skip: NO_GIT }, async () => {
  const endpoint = bucket?.endpoint ?? "";
  const hostA = makeHost("host-a", endpoint);
  const hostB = makeHost("host-b", endpoint);
  const project = "acme-web";

  // One upstream, seeded at C1: daily and weekly.
  const bare = join(SANDBOX, "upstream.git");
  const seed = join(SANDBOX, "seed");
  mkdirSync(seed);
  git(SANDBOX, ["init", "--quiet", "--bare", "--initial-branch=main", bare]);
  git(seed, ["init", "--quiet", "--initial-branch=main"]);
  mkdirSync(join(seed, ".claude", "skills", "daily"), { recursive: true });
  writeFileSync(join(seed, ".claude", "skills", "daily", "SKILL.md"), "---\nname: daily\ndescription: daily\n---\nDo it.\n");
  const c1 = commitMarker(seed, twoHostMarker(project, { dailyTitle: "Daily", withExtra: false }), "C1");
  git(seed, ["remote", "add", "origin", bare]);
  git(seed, ["push", "--quiet", "origin", "main"]);
  const cloneA = join(SANDBOX, "clone-a");
  const cloneB = join(SANDBOX, "clone-b");
  git(SANDBOX, ["clone", "--quiet", bare, cloneA]);
  git(SANDBOX, ["clone", "--quiet", bare, cloneB]);

  await ok(hostA, ["link"], cloneA);
  await ok(hostA, ["ritual", "reconcile"], cloneA);
  await ok(hostA, ["sync", "--project", project], cloneA);
  await ok(hostB, ["link"], cloneB);
  await ok(hostB, ["sync", "--project", project], cloneB);
  await ok(hostB, ["ritual", "reconcile"], cloneB);
  await ok(hostB, ["sync", "--project", project], cloneB);

  // host-a pulls C2: a new ritual and a new title for daily. Its reconcile adopts and updates.
  const c2 = commitMarker(cloneA, twoHostMarker(project, { dailyTitle: "Daily, new", withExtra: true }), "C2");
  git(cloneA, ["push", "--quiet", "origin", "main"]);
  const adopted = await ok(hostA, ["ritual", "reconcile"], cloneA);
  assert.match(adopted, /1 adopted, 2 updated/u, adopted);
  await ok(hostA, ["sync", "--project", project], cloneA);

  // Five minutes later host-b runs the timer from its checkout at C1.
  const stale = await darius(hostB, ["run-due", "--unattended", "--project", project, "--json"], cloneB);
  const report = JSON.parse(stale.stdout.trim().split("\n").at(-1) ?? "{}");
  const entry = report.projects?.[0];
  assert.equal(entry?.syncBefore, "ok", stale.stdout + stale.stderr);

  const seen = onHost(hostB, () => {
    const store = openProject(project);
    const ledger = readLedger(store);
    return {
      lifecycle: ritualLifecycle(ledger, "extra"),
      daily: store.readItem<Ritual>("ritual", "daily")?.header,
      weekly: store.readItem<Ritual>("ritual", "weekly")?.header,
      hostBDefined: ledger.filter((line) => line.type === "ritual.defined" && line.host === "host-b" && line.commit !== c1).length,
    };
  });
  assert.equal(seen.lifecycle, "active", "the stale host must not retire the newer host's ritual");
  assert.equal(seen.daily?.title, "Daily, new", "the definition stays as the newer host left it");
  assert.deepEqual([seen.daily?.def_commit, seen.daily?.def_host], [c2, "host-a"]);
  assert.deepEqual([seen.weekly?.def_commit, seen.weekly?.def_host], [c2, "host-a"], "no flip-flop of the other rituals");
  assert.equal(seen.hostBDefined, 0, "the stale host writes no ritual.defined line");

  const held = `the marker the store holds (reconciled on host-a at ${c2})`;
  assert.equal(entry?.stale?.line, `the checkout of ${project} lacks the commit of ${held}: pull it, or after a rebase run darius ritual reconcile --force`, JSON.stringify(entry));
  assert.equal(entry?.stale?.relation, "unknown", "host-b has not fetched C2");
  const daily = entry?.rituals?.find((ritual: { slug: string }) => ritual.slug === "daily");
  assert.deepEqual([daily?.action, daily?.reason], ["skipped", "checkout-stale"], JSON.stringify(entry));
  assert.equal(daily?.detail, entry?.stale?.line);
  assert.equal(stale.code, 1, "a failing skip: the host must pull");

  // After a fetch C2 is known here, and HEAD is its ancestor: older, proven.
  git(cloneB, ["fetch", "--quiet"]);
  const line = `the checkout of ${project} is older than ${held}: pull it`;
  const text = await darius(hostB, ["run-due", "--unattended", "--project", project], cloneB);
  assert.ok(text.stdout.includes(line), text.stdout);
  const doctor = await darius(hostB, ["doctor"], cloneB);
  assert.ok(doctor.stdout.includes(line), doctor.stdout + doctor.stderr);

  // host-b pulls C2: its reconcile is a no-op, and the stale line is gone.
  git(cloneB, ["pull", "--quiet", "--ff-only"]);
  const ledgerBefore = onHost(hostB, () => readLedger(openProject(project)).filter((ledgerLine) => ledgerLine.type === "ritual.defined").length);
  const pulled = await darius(hostB, ["run-due", "--unattended", "--project", project, "--json"], cloneB);
  const fresh = JSON.parse(pulled.stdout.trim().split("\n").at(-1) ?? "{}").projects?.[0];
  assert.equal(fresh?.stale, undefined, JSON.stringify(fresh));
  assert.equal(fresh?.rituals?.some((ritual: { reason?: string }) => ritual.reason === "checkout-stale"), false, JSON.stringify(fresh));
  const ledgerAfter = onHost(hostB, () => readLedger(openProject(project)).filter((ledgerLine) => ledgerLine.type === "ritual.defined").length);
  assert.equal(ledgerAfter, ledgerBefore, "the same commit and marker: nothing to write");
  const clean = await darius(hostB, ["doctor"], cloneB);
  assert.equal(clean.stdout.includes("older than the marker"), false, clean.stdout);
  assert.equal(existsSync(join(hostB.state, project, "marker-stale.json")), false);
  assert.equal(readFileSync(join(cloneB, ".darius.toml"), "utf8").includes("[rituals.extra]"), true);
});

// --- the decision, against temp git repos -----------------------------------------------

let counter = 0;

/** An upstream with C1, then C2 pushed from clone `a`; clone `b` is still at C1 and has not fetched. */
interface Chain {
  project: string;
  root: string;
  bare: string;
  a: string;
  b: string;
  c1: string;
  c2: string;
}

function chain(opts: { c2Marker?: boolean } = {}): Chain {
  counter += 1;
  const project = `acme-unit-${String(counter)}`;
  const root = join(SANDBOX, `chain-${String(counter)}`);
  const bare = join(root, "upstream.git");
  const a = join(root, "a");
  const b = join(root, "b");
  mkdirSync(a, { recursive: true });
  git(root, ["init", "--quiet", "--bare", "--initial-branch=main", bare]);
  git(a, ["init", "--quiet", "--initial-branch=main"]);
  const c1 = commitMarker(a, twoHostMarker(project, { dailyTitle: "Daily", withExtra: false }), "C1");
  git(a, ["remote", "add", "origin", bare]);
  git(a, ["push", "--quiet", "--set-upstream", "origin", "main"]);
  git(root, ["clone", "--quiet", bare, b]);
  let c2: string;
  if (opts.c2Marker === false) {
    writeFileSync(join(a, "README.md"), "# acme\n");
    git(a, ["add", "--all"]);
    git(a, ["commit", "--quiet", "--message", "C2 readme"]);
    c2 = git(a, ["rev-parse", "--short=12", "HEAD"]);
  } else c2 = commitMarker(a, twoHostMarker(project, { dailyTitle: "Daily, new", withExtra: true }), "C2");
  git(a, ["push", "--quiet", "origin", "main"]);
  return { project, root, bare, a, b, c1, c2 };
}

/** A bare `ritual.defined` line, as the ledger reads it back. */
function definedLine(id: string, commit: string): LedgerLine {
  return { v: 1, id, at: "2026-11-09T06:00:00.000Z", host: "host-x", who: "x", project: "p", type: RITUAL_DEFINED, commit };
}

function record(commit: string | undefined, hash?: string): ReconcileRecord {
  const found: ReconcileRecord = { id: "01JREC0000000000000000000A", host: "host-a", at: "2026-11-09T06:00:00.000Z" };
  if (commit !== undefined) found.commit = commit;
  if (hash !== undefined) found.markerHash = hash;
  return found;
}

/** The decision for `checkout` against `found`, as host-b unless `thisHost` says otherwise (the records are host-a's). */
function judge(checkout: string, found: ReconcileRecord | null, opts: { force?: boolean; hash?: string; thisHost?: string } = {}): GuardDecision {
  return decideReconcile({
    record: found,
    head: headFacts(checkout),
    markerHash: opts.hash ?? markerHash(join(checkout, ".darius.toml")),
    force: opts.force === true,
    relation: (recorded, head) => commitRelation(checkout, recorded, head),
    thisHost: opts.thisHost ?? "host-b",
    project: "acme-web",
  });
}

test("decide: no record, and a record without a commit (an older darius), reconcile as before, also from a stale checkout", { skip: NO_GIT }, () => {
  const { b } = chain();
  assert.deepEqual(judge(b, null), { action: "reconcile", why: "no-record" });
  assert.deepEqual(judge(b, record(undefined)), { action: "reconcile", why: "no-commit" });
  const malformed = latestRecord([definedLine("01JREC0000000000000000000A", "0123456789ab"), definedLine("01JREC0000000000000000000B", "--output=/tmp/x")]);
  assert.deepEqual(malformed, { id: "01JREC0000000000000000000B", host: "host-x", at: "2026-11-09T06:00:00.000Z" }, "the newest line counts; a commit that is no commit id is dropped, never handed to git");
  assert.deepEqual(judge(b, malformed), { action: "reconcile", why: "no-commit" });
});

test("decide: the same commit, and a record that is an ancestor of HEAD (a newer checkout), reconcile", { skip: NO_GIT }, () => {
  const { a, c1, c2 } = chain();
  assert.deepEqual(judge(a, record(c2)), { action: "reconcile", why: "same" });
  assert.deepEqual(judge(a, record(c1)), { action: "reconcile", why: "newer" });
});

test("decide: a checkout that is an ancestor of the record is stale (behind); one that lacks the commit is stale (unknown)", { skip: NO_GIT }, () => {
  const { b, c2 } = chain();
  const unknown = judge(b, record(c2));
  assert.deepEqual(unknown, { action: "stale", stale: { relation: "unknown", host: "host-a", commit: c2, at: "2026-11-09T06:00:00.000Z" } });
  git(b, ["fetch", "--quiet"]);
  const behind = judge(b, record(c2));
  assert.equal(behind.action === "stale" ? behind.stale.relation : behind.action, "behind");
});

test("decide: diverged histories are stale; a person's --force reconciles anyway", { skip: NO_GIT }, () => {
  const { b, c2 } = chain();
  writeFileSync(join(b, "LOCAL.md"), "local\n");
  git(b, ["add", "--all"]);
  git(b, ["commit", "--quiet", "--message", "local"]);
  git(b, ["fetch", "--quiet"]);
  const diverged = judge(b, record(c2));
  assert.equal(diverged.action === "stale" ? diverged.stale.relation : diverged.action, "diverged");
  assert.deepEqual(judge(b, record(c2), { force: true }), { action: "reconcile", why: "force" });
});

test("decide: an equal marker hash writes nothing from an older checkout, and reconciles from a newer one", { skip: NO_GIT }, () => {
  const { a, b, c1, c2 } = chain({ c2Marker: false });
  const hash = markerHash(join(b, ".darius.toml"));
  assert.equal(hash, markerHash(join(a, ".darius.toml")), "C2 changed only the README");
  assert.deepEqual(judge(b, record(c2, hash)), { action: "unchanged", why: "same-marker" });
  assert.deepEqual(judge(a, record(c1, hash)), { action: "reconcile", why: "newer" }, "the newer checkout moves the record forward");
  const other = judge(b, record(c2, "0".repeat(64)));
  assert.equal(other.action, "stale", "another hash: the stale rule applies");
});

test("decide: a dir that is no git work tree reconciles as before; a git error does too, with a note", { skip: NO_GIT }, () => {
  const plain = join(SANDBOX, "plain-checkout");
  mkdirSync(plain, { recursive: true });
  writeFileSync(join(plain, ".darius.toml"), "v = 3\n");
  assert.deepEqual(judge(plain, record("0123456789ab")), { action: "reconcile", why: "no-git" });

  const { b, c2 } = chain();
  const path = process.env.PATH;
  process.env.PATH = join(SANDBOX, "no-bin");
  try {
    const decision = judge(b, record(c2));
    assert.equal(decision.action, "reconcile");
    assert.equal(decision.action === "reconcile" ? decision.why : "", "git-error");
    assert.match(decision.action === "reconcile" ? decision.note ?? "" : "", /git is not installed; reconciled as before$/u);
  } finally {
    process.env.PATH = path;
  }
});

test("decide: a shallow clone that lacks the recorded commit cannot prove it is stale, so it reconciles, with a note", { skip: NO_GIT }, () => {
  const { root, bare, a, c1 } = chain();
  writeFileSync(join(a, "C3.md"), "c3\n");
  git(a, ["add", "--all"]);
  git(a, ["commit", "--quiet", "--message", "C3"]);
  git(a, ["push", "--quiet", "origin", "main"]);
  const shallow = join(root, "shallow");
  git(root, ["clone", "--quiet", "--depth", "1", `file://${bare}`, shallow]);
  const decision = judge(shallow, record(c1));
  assert.equal(decision.action === "reconcile" ? decision.why : decision.action, "shallow");
  assert.match(decision.action === "reconcile" ? decision.note ?? "" : "", /shallow checkout cannot tell/u);
});

// --- reconcileProject with the guard ------------------------------------------------------

const T1 = new Date("2026-11-09T06:00:00.000Z");
const T2 = new Date("2026-11-09T06:05:00.000Z");
const T3 = new Date("2026-11-09T06:10:00.000Z");

/**
 * A reconcile as host `host`: its own ledger id (config.toml) over the one
 * shared store, as two hosts see the store after a sync.
 */
function reconcileAs(host: string, project: Project, checkout: string, now: Date, options: { dryRun?: boolean; force?: boolean } = {}): ReturnType<typeof reconcileProject> {
  const config = join(SANDBOX, "unit", `config-${host}`);
  mkdirSync(config, { recursive: true });
  writeFileSync(join(config, "config.toml"), `host = "${host}"\n`);
  const saved = process.env.DARIUS_CONFIG_DIR;
  process.env.DARIUS_CONFIG_DIR = config;
  try {
    return reconcileProject(project, checkout, host, now, options);
  } finally {
    process.env.DARIUS_CONFIG_DIR = saved;
  }
}

function definedLines(project: Project): LedgerLine[] {
  return readLedger(project).filter((line) => line.type === RITUAL_DEFINED);
}

test("reconcile: a stale checkout writes nothing and returns stale; a dry run does not record it for doctor", { skip: NO_GIT }, () => {
  const { project: name, a, b, c2 } = chain();
  const project = openProject(name, { create: true });
  const adopted = reconcileAs("host-a", project, a, T1);
  assert.deepEqual(adopted.adopted, ["daily", "weekly", "extra"]);
  const lines = definedLines(project);
  assert.ok(lines.every((line) => line.commit === c2 && line.marker_hash === markerHash(join(a, ".darius.toml"))), JSON.stringify(lines));
  assert.equal(latestRecord(readLedger(project))?.commit, c2);

  const dry = reconcileAs("host-b", project, b, T2, { dryRun: true });
  assert.equal(dry.stale?.relation, "unknown");
  assert.equal(readStaleRecord(project), null, "a dry run writes nothing, the doctor record included");

  const stale = reconcileAs("host-b", project, b, T2);
  assert.equal(stale.ok, true);
  assert.deepEqual([stale.adopted, stale.updated, stale.unchanged, stale.retired], [[], [], [], []]);
  assert.match(stale.stale?.line ?? "", /^the checkout of acme-unit-\d+ lacks the commit of the marker the store holds \(reconciled on host-a at [0-9a-f]{12}\): pull it/u);
  assert.equal(definedLines(project).length, lines.length, "no ritual.defined line");
  assert.equal(ritualLifecycle(readLedger(project), "extra"), "active");
  assert.equal(project.readItem<Ritual>("ritual", "daily")?.header.def_commit, c2);
  const kept = readStaleRecord(project);
  assert.equal(kept?.line, stale.stale?.line);
  assert.equal(kept?.checkout, b);
  assert.match(staleDoctorLine(kept) ?? "", /^WARN: the checkout of .* \(reconcile, 2026-11-09T06:05:00\.000Z\)\. Until then/u);

  git(b, ["pull", "--quiet", "--ff-only"]);
  const pulled = reconcileAs("host-b", project, b, T3);
  assert.equal(pulled.stale, undefined);
  assert.deepEqual(pulled.unchanged, ["daily", "weekly", "extra"], "the same commit and hash: nothing to write");
  assert.equal(definedLines(project).length, lines.length);
  assert.equal(readStaleRecord(project), null, "the next reconcile that is not stale clears the record");
});

test("reconcile: the same marker from an older commit writes nothing and lists the rituals as unchanged", { skip: NO_GIT }, () => {
  const { project: name, a, b, c2 } = chain({ c2Marker: false });
  const project = openProject(name, { create: true });
  reconcileAs("host-a", project, a, T1);
  const linesBefore = definedLines(project).length;
  const result = reconcileAs("host-b", project, b, T2);
  assert.equal(result.stale, undefined);
  assert.deepEqual(result.unchanged, ["daily", "weekly"]);
  assert.deepEqual([result.adopted, result.updated, result.retired], [[], [], []]);
  assert.equal(definedLines(project).length, linesBefore, "no flip-flop of def_commit");
  assert.equal(project.readItem<Ritual>("ritual", "daily")?.header.def_commit, c2);
});

test("reconcile: a record written by an older darius (no commit, no marker_hash) does not stop a reconcile", { skip: NO_GIT }, () => {
  const { project: name, a, b } = chain();
  const project = openProject(name, { create: true });
  reconcileAs("host-a", project, a, T1);
  appendLine(project, { who: "old", type: RITUAL_DEFINED, item: "ritual/daily", slug: "daily", change: "updated", dirty: false });
  const result = reconcileAs("host-b", project, b, T2);
  assert.equal(result.stale, undefined);
  assert.deepEqual(result.retired, ["extra"], "as before 0.129.0: the guard has nothing to compare with");
});

test("reconcile --force: a person reconciles a stale checkout, the lines say forced, and the newer checkout follows it again", { skip: NO_GIT }, () => {
  const { project: name, a, b, c1, c2 } = chain();
  const project = openProject(name, { create: true });
  reconcileAs("host-a", project, a, T1);
  const forced = reconcileAs("host-b", project, b, T2, { force: true });
  assert.equal(forced.stale, undefined);
  assert.deepEqual(forced.retired, ["extra"], "force reconciles from this checkout, retire included");
  const written = definedLines(project).filter((line) => line.at === T2.toISOString());
  assert.ok(written.length > 0 && written.every((line) => line.forced === true && line.commit === c1), JSON.stringify(written));
  assert.equal(latestRecord(readLedger(project))?.commit, c1, "the record is this checkout's commit now");

  const back = reconcileAs("host-a", project, a, T3);
  assert.equal(back.stale, undefined, "C1 is an ancestor of C2: the newer checkout reconciles");
  assert.deepEqual(back.warnings, ["extra was retired; use a new slug"]);
  assert.equal(project.readItem<Ritual>("ritual", "daily")?.header.def_commit, c2);
});

// --- the verb and the report ---------------------------------------------------------------

test("ritual reconcile --force is refused inside a run, before it reads anything", async () => {
  const saved = process.env.DARIUS_RUN;
  process.env.DARIUS_RUN = "01RUNINSIDE";
  const errors: string[] = [];
  const original = console.error;
  console.error = (line: string): void => {
    errors.push(line);
  };
  try {
    const code = await ritualCommand.run(parseArgs(["reconcile", "--project", "no-such-project", "--force"]));
    assert.equal(code, 1);
    assert.deepEqual(errors, ["! ritual reconcile --force is for a person; a run does not force a reconcile"]);
  } finally {
    console.error = original;
    if (saved === undefined) delete process.env.DARIUS_RUN;
    else process.env.DARIUS_RUN = saved;
  }
});

test("report: the stale line comes once, not in the news scope, and not next to a checkout-stale skip that says it", () => {
  const line = "the checkout of acme-web is older than the marker the store holds (reconciled on host-a at 0123456789ab): pull it";
  const stale = { checkout: "/srv/acme-web", relation: "behind" as const, host: "host-a", commit: "0123456789ab", line };
  const quiet: ProjectEntry = { project: "acme-web", syncBefore: "ok", syncAfter: "skipped", rituals: [], stale };
  const report: BatchReport = { ok: true, date: "2026-11-09", host: "host-b", dryRun: false, projects: [quiet], errors: [] };
  assert.deepEqual(formatReport(report, "digest"), [`! ${line}`]);
  assert.deepEqual(formatReport(report, "news"), [], "it would come every 15 minutes");
  const skipped: ProjectEntry = { ...quiet, rituals: [{ slug: "daily", action: "skipped", reason: "checkout-stale", detail: line }] };
  const both = formatReport({ ...report, projects: [skipped] }, "news").join("\n");
  assert.equal(both.split(line).length - 1, 1, both);
  assert.match(both, /daily: skipped, checkout-stale, the checkout of acme-web is older/u);
});

test("ritual list advises a pull, not a reconcile, while the stale record is there", { skip: NO_GIT }, async () => {
  const { project: name, a, b } = chain();
  const project = openProject(name, { create: true });
  reconcileAs("host-a", project, a, T1);
  const { writeLink } = await import("../src/core/links.ts");
  writeLink(name, b);
  const listed = async (): Promise<string[]> => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (line: string): void => {
      lines.push(line);
    };
    try {
      await ritualCommand.run(parseArgs(["list", "--project", name]));
    } finally {
      console.log = original;
    }
    return lines.filter((line) => line.startsWith("! mirror is from"));
  };
  assert.ok((await listed()).every((line) => line.endsWith(": darius ritual reconcile")), "no stale record: the old advice");
  reconcileAs("host-b", project, b, T2);
  const advice = await listed();
  assert.ok(advice.length > 0 && advice.every((line) => line.endsWith(": pull the checkout")), advice.join("\n"));
});

// --- own-host records (0.129.1) ------------------------------------------------------------

test("decide: a record this host wrote itself never makes its own checkout stale; it reconciles with a note", { skip: NO_GIT }, () => {
  const { b, c2 } = chain();
  const note = `the checkout of acme-web moved off the commit this host last reconciled (${c2}); reconciling from the checkout`;
  assert.deepEqual(judge(b, record(c2), { thisHost: "host-a" }), { action: "reconcile", why: "own-host", note }, "lacks the commit");
  git(b, ["fetch", "--quiet"]);
  assert.deepEqual(judge(b, record(c2), { thisHost: "host-a" }), { action: "reconcile", why: "own-host", note }, "older");
  writeFileSync(join(b, "LOCAL.md"), "local\n");
  git(b, ["add", "--all"]);
  git(b, ["commit", "--quiet", "--message", "local"]);
  assert.deepEqual(judge(b, record(c2), { thisHost: "host-a" }), { action: "reconcile", why: "own-host", note }, "diverged");
  assert.equal(judge(b, record(c2)).action, "stale", "the same checkout against another host's record stays stale");
});

test("own host: a host that moves its own checkout to an older commit reconciles, with one note, no stale result and no stale record", { skip: NO_GIT }, () => {
  const { project: name, a, c1, c2 } = chain();
  const project = openProject(name, { create: true });
  reconcileAs("host-a", project, a, T1);
  git(a, ["checkout", "--quiet", c1]);
  const moved = reconcileAs("host-a", project, a, T2);
  assert.equal(moved.stale, undefined);
  assert.deepEqual(moved.warnings, [`the checkout of ${name} moved off the commit this host last reconciled (${c2}); reconciling from the checkout`]);
  assert.equal(readStaleRecord(project), null);
  assert.equal(latestRecord(readLedger(project))?.commit, c1, "the record follows the checkout");
  const again = reconcileAs("host-a", project, a, T3);
  assert.deepEqual(again.warnings, [], "the note comes once: the next reconcile is at the recorded commit");
});

test("case b: host-a reconciles from a branch; host-b on main without that commit is blocked, fetched or not", { skip: NO_GIT }, () => {
  const { project: name, a, b, c1 } = chain();
  const project = openProject(name, { create: true });
  git(a, ["checkout", "--quiet", "-b", "x", c1]);
  const cx = commitMarker(a, twoHostMarker(name, { dailyTitle: "Daily, branch x", withExtra: true }), "Cx");
  assert.deepEqual(reconcileAs("host-a", project, a, T1).adopted, ["daily", "weekly", "extra"]);
  const blocked = reconcileAs("host-b", project, b, T2);
  assert.deepEqual([blocked.stale?.relation, blocked.stale?.commit], ["unknown", cx]);
  git(b, ["fetch", "--quiet"]);
  assert.equal(reconcileAs("host-b", project, b, T3).stale?.relation, "unknown", "main does not carry branch x");
  assert.equal(ritualLifecycle(readLedger(project), "extra"), "active");
  assert.equal(project.readItem<Ritual>("ritual", "daily")?.header.title, "Daily, branch x");
});

test("case c: host-a moves back to C1 and retires what C2 added; host-b at C2 does not revive it, and host-a is then blocked: no flip-flop", { skip: NO_GIT }, () => {
  const { project: name, a, b, c1, c2 } = chain();
  const project = openProject(name, { create: true });
  reconcileAs("host-a", project, a, T1);
  git(a, ["checkout", "--quiet", c1]);
  const back = reconcileAs("host-a", project, a, T2);
  assert.deepEqual(back.retired, ["extra"], "the operator's own checkout move retires, as before 0.129.0");
  assert.equal(latestRecord(readLedger(project))?.commit, c1);

  git(b, ["pull", "--quiet", "--ff-only"]);
  const forward = reconcileAs("host-b", project, b, T3);
  assert.equal(forward.stale, undefined, "C1 is an ancestor of C2: host-b reconciles");
  assert.deepEqual(forward.warnings, ["extra was retired; use a new slug"], "a retired slug stays retired");
  assert.equal(ritualLifecycle(readLedger(project), "extra"), "retired");
  assert.deepEqual(forward.updated.toSorted(), ["daily", "weekly"]);
  assert.equal(project.readItem<Ritual>("ritual", "daily")?.header.def_commit, c2);

  const blocked = reconcileAs("host-a", project, a, new Date("2026-11-09T06:15:00.000Z"));
  assert.deepEqual([blocked.stale?.relation, blocked.stale?.host], ["behind", "host-b"], "host-a at C1 is older than host-b's record now");
  assert.equal(project.readItem<Ritual>("ritual", "daily")?.header.def_commit, c2, "no flip-flop back to C1");
});

// --- the dirty hold and the same-commit rule (0.135.0) --------------------------------------

/** The two-host marker plus a `[rituals.<slug>]` table, as an uncommitted edit would add it. */
function withRitual(project: string, slug: string, opts: { dailyTitle: string; withExtra: boolean }): string {
  return `${twoHostMarker(project, opts)}[rituals.${slug}]\ntitle = "New"\ncadence = "1w"\nskill = "daily"\nmode = "off"\n`;
}

test("dirty hold: an uncommitted ritual is not adopted, nothing is written, and doctor says so; the commit adopts it", { skip: NO_GIT }, () => {
  const { project: name, a, c2 } = chain();
  const project = openProject(name, { create: true });
  reconcileAs("host-a", project, a, T1);
  const linesBefore = definedLines(project).length;
  writeFileSync(join(a, ".darius.toml"), withRitual(name, "new-slug", { dailyTitle: "Daily, new", withExtra: true }));

  const held = reconcileAs("host-a", project, a, T2);
  assert.equal(held.dirty, true);
  assert.deepEqual([held.adopted, held.updated, held.retired], [[], [], []]);
  assert.deepEqual(held.held?.adopted, ["new-slug"]);
  assert.equal(held.held?.line, `.darius.toml of ${name} at ${c2} has uncommitted changes, so it is not reconciled: the store keeps the definitions it has. It would adopt new-slug. Commit or revert the change`);
  assert.equal(project.readItem<Ritual>("ritual", "new-slug"), null, "no store item");
  assert.equal(definedLines(project).length, linesBefore, "no ritual.defined line, so no record names this commit for a dirty marker");
  assert.equal(heldDoctorLine(readHeldRecord(project)), `WARN: ${held.held?.line ?? ""} (reconcile, ${T2.toISOString()}). Until then the store keeps the definitions it has.`);

  const c3 = commitMarker(a, withRitual(name, "new-slug", { dailyTitle: "Daily, new", withExtra: true }), "C3 adds new-slug");
  const adopted = reconcileAs("host-a", project, a, T3);
  assert.equal(adopted.held, undefined);
  assert.deepEqual(adopted.adopted, ["new-slug"]);
  assert.deepEqual([project.readItem<Ritual>("ritual", "new-slug")?.header.def_commit, project.readItem<Ritual>("ritual", "new-slug")?.header.def_dirty], [c3, false]);
  assert.equal(readHeldRecord(project), null, "a clean reconcile clears the doctor record");
});

test("dirty hold: an untracked .darius.toml is held too; outside git a marker reconciles as before", { skip: NO_GIT }, () => {
  counter += 1;
  const name = `acme-untracked-${String(counter)}`;
  const dir = join(SANDBOX, `untracked-${String(counter)}`);
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "--quiet", "--initial-branch=main"]);
  writeFileSync(join(dir, "README.md"), "# acme\n");
  git(dir, ["add", "README.md"]);
  git(dir, ["commit", "--quiet", "--message", "readme only"]);
  writeFileSync(join(dir, ".darius.toml"), twoHostMarker(name, { dailyTitle: "Daily", withExtra: false }));
  const project = openProject(name, { create: true });
  const held = reconcileAs("host-a", project, dir, T1);
  assert.deepEqual(held.held?.adopted, ["daily", "weekly"]);
  assert.deepEqual(project.listItems("ritual"), []);

  const plain = join(SANDBOX, `no-git-${String(counter)}`);
  mkdirSync(plain, { recursive: true });
  writeFileSync(join(plain, ".darius.toml"), twoHostMarker(`${name}-plain`, { dailyTitle: "Daily", withExtra: false }));
  const outside = reconcileAs("host-a", openProject(`${name}-plain`, { create: true }), plain, T1);
  assert.equal(outside.held, undefined);
  assert.deepEqual(outside.adopted, ["daily", "weekly"]);
});

test("same commit: host-b at the commit a dirty marker was adopted from never retires the ritual; a newer commit without it does", { skip: NO_GIT }, () => {
  const { project: name, a, b, c2 } = chain();
  const project = openProject(name, { create: true });
  reconcileAs("host-a", project, a, T1);
  // The incident: host-a mirrored its uncommitted marker (a darius before 0.135.0 did, --force does) and recorded C2.
  writeFileSync(join(a, ".darius.toml"), withRitual(name, "new-slug", { dailyTitle: "Daily, new", withExtra: true }));
  const forced = reconcileAs("host-a", project, a, T2, { force: true });
  assert.deepEqual(forced.adopted, ["new-slug"]);
  assert.equal(latestRecord(readLedger(project))?.commit, c2);

  git(b, ["pull", "--quiet", "--ff-only"]);
  const atSame = reconcileAs("host-b", project, b, T3);
  assert.equal(atSame.stale, undefined);
  assert.equal(atSame.held, undefined, "host-b's marker is clean");
  assert.deepEqual(atSame.retired, [], "same commit, other content: someone was dirty, the ritual did not leave git");
  assert.deepEqual(atSame.kept, ["new-slug"]);
  assert.ok(atSame.warnings.includes(`new-slug is not in .darius.toml here, but host-a mirrored it from the same commit ${c2} with uncommitted changes: not retired; a newer commit without it retires it`), JSON.stringify(atSame.warnings));
  assert.equal(ritualLifecycle(readLedger(project), "new-slug"), "active");

  // A genuine removal: C3 drops extra, and new-slug was never committed. Both retire.
  git(b, ["checkout", "--quiet", "--", ".darius.toml"]);
  const c3 = commitMarker(b, twoHostMarker(name, { dailyTitle: "Daily, new", withExtra: false }), "C3 drops extra");
  const removed = reconcileAs("host-b", project, b, new Date("2026-11-09T06:15:00.000Z"));
  assert.deepEqual(removed.retired.toSorted(), ["extra", "new-slug"]);
  assert.equal(removed.kept, undefined);
  const ledger = readLedger(project);
  assert.equal(ritualLifecycle(ledger, "extra"), "retired");
  assert.equal(ledger.findLast((line) => line.type === "ritual.lifecycle" && line.item === "ritual/extra")?.note, `left .darius.toml at ${c3}`);
});

test("same commit: host-a holds its dirty marker, so host-b at the same commit has nothing to retire", { skip: NO_GIT }, () => {
  const { project: name, a, b } = chain();
  const project = openProject(name, { create: true });
  reconcileAs("host-a", project, a, T1);
  writeFileSync(join(a, ".darius.toml"), withRitual(name, "new-slug", { dailyTitle: "Daily, new", withExtra: true }));
  assert.deepEqual(reconcileAs("host-a", project, a, T2).held?.adopted, ["new-slug"]);
  git(b, ["pull", "--quiet", "--ff-only"]);
  const followed = reconcileAs("host-b", project, b, T3);
  assert.deepEqual([followed.adopted, followed.updated, followed.retired], [[], [], []]);
  assert.deepEqual(followed.unchanged, ["daily", "weekly", "extra"]);
  assert.equal(project.readItem<Ritual>("ritual", "new-slug"), null);
});
