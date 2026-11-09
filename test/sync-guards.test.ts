/**
 * The cross-host guards of 0.126.0 that need no bucket: the behind check
 * against temp git repos (src/core/checkout-behind.ts), the host version
 * comparison and the doctor lines (src/core/host-versions.ts), and the
 * `[run] behind` key. The compat floor and the `host.version` line rule are
 * in test/sync.test.ts; run-due's use of both guards is in
 * test/runner.test.ts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { behindDoctorLine, behindLine, checkBehind, fetchOutcome, readBehindRecord, writeBehindRecord } from "../src/core/checkout-behind.ts";
import { stripUrlUserinfo } from "../src/core/redact.ts";
import { loadConfig } from "../src/core/config.ts";
import { compareHostVersions, hostVersionLines, RETIRED_AFTER_MS, syncGuardLines } from "../src/core/host-versions.ts";
import { appendLine, hostId } from "../src/core/ledger.ts";
import type { JsonValue, LedgerLine } from "../src/core/model.ts";
import { openProject } from "../src/core/store.ts";
import { ulid } from "../src/core/ulid.ts";
import { NO_GIT } from "./helpers/git.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-guards-"));
// The production git calls inherit this env: no operator config, no prompt.
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";

/** bash by full path. The Nix build sandbox has no /usr/bin/env for a shebang to use. */
const BASH =
  (process.env.PATH ?? "")
    .split(":")
    .map((dir) => join(dir, "bash"))
    .find((candidate) => candidate.startsWith("/") && existsSync(candidate)) ?? "/bin/bash";

const IDENTITY = ["-c", "user.name=darius-test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false"];

function git(dir: string, args: readonly string[]): string {
  const result = spawnSync("git", [...IDENTITY, ...args], { cwd: dir, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} in ${dir}: ${result.stderr}`);
  return result.stdout.trim();
}

function commit(dir: string, file: string): void {
  writeFileSync(join(dir, file), `${file}\n`);
  git(dir, ["add", "--all"]);
  git(dir, ["commit", "--quiet", "--message", file]);
}

let counter = 0;

/** A bare upstream, the clone under test, and another clone that pushes to the upstream. */
interface Repos {
  bare: string;
  clone: string;
  other: string;
}

/** A bare upstream with one commit on main, and a clone of it that tracks origin/main. */
function upstreamAndClone(): Repos {
  counter += 1;
  const root = join(SANDBOX, `repo-${String(counter)}`);
  const bare = join(root, "upstream.git");
  const seed = join(root, "seed");
  mkdirSync(seed, { recursive: true });
  git(root, ["init", "--quiet", "--bare", "--initial-branch=main", bare]);
  git(seed, ["init", "--quiet", "--initial-branch=main"]);
  commit(seed, "first");
  git(seed, ["remote", "add", "origin", bare]);
  git(seed, ["push", "--quiet", "origin", "main"]);
  const clone = join(root, "clone");
  const other = join(root, "other");
  git(root, ["clone", "--quiet", bare, clone]);
  git(root, ["clone", "--quiet", bare, other]);
  return { bare, clone, other };
}

/** Two commits on the upstream that `clone` has not fetched. */
function pushTwo(other: string): void {
  commit(other, "second");
  commit(other, "third");
  git(other, ["push", "--quiet", "origin", "main"]);
}

function lockFiles(dir: string): string[] {
  return readdirSync(join(dir, ".git"), { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith(".lock"));
}

// --- the behind check -----------------------------------------------------------------

test("behind: a dir that is no git work tree, a repo with no upstream, and a detached HEAD are unchecked", { skip: NO_GIT }, async () => {
  const plain = join(SANDBOX, "plain");
  mkdirSync(plain, { recursive: true });
  const none = await checkBehind(plain);
  assert.equal(none.state, "unchecked");
  assert.match(none.state === "unchecked" ? none.reason : "", /not a git work tree/u);

  const local = join(SANDBOX, "local");
  mkdirSync(local, { recursive: true });
  git(local, ["init", "--quiet", "--initial-branch=main"]);
  commit(local, "first");
  assert.deepEqual(await checkBehind(local), { state: "unchecked", reason: "branch main has no upstream" });

  const { clone } = upstreamAndClone();
  git(clone, ["checkout", "--quiet", "--detach"]);
  assert.deepEqual(await checkBehind(clone), { state: "unchecked", reason: "detached HEAD: no branch to compare" });

  const { bare } = upstreamAndClone();
  const inBare = await checkBehind(bare);
  assert.equal(inBare.state, "unchecked", "a bare repo has no work tree");
});

test("behind: up to date, behind after the fetch, ahead only, and diverged", { skip: NO_GIT }, async () => {
  const { clone, other } = upstreamAndClone();
  assert.deepEqual(await checkBehind(clone), { state: "checked", upstream: "origin/main", behind: 0, ahead: 0 });

  pushTwo(other);
  const behind = await checkBehind(clone);
  assert.deepEqual(behind, { state: "checked", upstream: "origin/main", behind: 2, ahead: 0 }, "the fetch brought the two commits");
  assert.equal(behindLine("acme", behind), "checkout of acme is 2 commits behind origin/main");
  assert.equal(git(clone, ["status", "--porcelain"]), "", "the work tree is untouched");
  assert.equal(git(clone, ["rev-list", "--count", "HEAD"]), "1", "nothing was pulled or merged");

  git(clone, ["merge", "--quiet", "--ff-only", "origin/main"]);
  commit(clone, "local");
  const ahead = await checkBehind(clone);
  assert.deepEqual(ahead, { state: "checked", upstream: "origin/main", behind: 0, ahead: 1 });
  assert.equal(behindLine("acme", ahead), null, "ahead only is not behind");

  commit(other, "fourth");
  git(other, ["push", "--quiet", "origin", "main"]);
  const diverged = await checkBehind(clone);
  assert.deepEqual(diverged, { state: "checked", upstream: "origin/main", behind: 1, ahead: 1 });
  assert.equal(behindLine("acme", diverged), "checkout of acme is 1 commit behind origin/main, and 1 ahead");
});

test("behind: a fetch that fails is unchecked and never counts the stale ref", { skip: NO_GIT }, async () => {
  const { clone, other } = upstreamAndClone();
  pushTwo(other);
  git(clone, ["remote", "set-url", "origin", join(SANDBOX, "gone.git")]);
  const failed = await checkBehind(clone);
  assert.equal(failed.state, "unchecked");
  assert.match(failed.state === "unchecked" ? failed.reason : "", /^the fetch of origin failed: /u);
});

test("behind: a failed fetch's reason never carries the userinfo of a URL git quotes", { skip: NO_GIT }, async () => {
  const token = "placeholder-token-not-a-secret";
  const stderr = `fatal: unable to access 'https://ci-user:${token}@git.example.com/acme.git/': Could not resolve host: git.example.com\n`;
  const reason = fetchOutcome({ remote: "origin" }, { code: 128, timedOut: false, stderr, timeoutMs: 10_000 }) ?? "";
  assert.equal(reason, "the fetch of origin failed: fatal: unable to access 'https://git.example.com/acme.git/': Could not resolve host: git.example.com");
  assert.equal(stripUrlUserinfo(`ssh://deploy@host-a/x and https://${token}@host-b/y`), "ssh://host-a/x and https://host-b/y");
  assert.equal(stripUrlUserinfo("no url, user@example.com stays"), "no url, user@example.com stays");

  const { clone } = upstreamAndClone();
  git(clone, ["remote", "set-url", "origin", `https://ci-user:${token}@127.0.0.1:1/acme.git`]);
  const failed = await checkBehind(clone, { timeoutMs: 5_000 });
  assert.equal(failed.state, "unchecked");
  assert.ok(!(failed.state === "unchecked" ? failed.reason : token).includes(token), "a real failed fetch keeps the token out too");
});

test("behind: a fetch that hangs is stopped at the timeout, its process group is gone, and no lock is left", { skip: NO_GIT }, async () => {
  const { clone } = upstreamAndClone();
  const pidFile = join(SANDBOX, "hang.pid");
  const hang = join(SANDBOX, "hang-ssh");
  writeFileSync(hang, `#!${BASH}\necho $$ > ${pidFile}\nexec sleep 30\n`);
  chmodSync(hang, 0o755);
  git(clone, ["remote", "set-url", "origin", "ssh://git.example.invalid/acme.git"]);
  git(clone, ["config", "core.sshCommand", hang]);
  const started = Date.now();
  const timedOut = await checkBehind(clone, { timeoutMs: 700 });
  const took = Date.now() - started;
  assert.equal(timedOut.state, "unchecked");
  assert.match(timedOut.state === "unchecked" ? timedOut.reason : "", /^the fetch of origin timed out after 0\.7 s$/u);
  assert.ok(took < 5_000, `bounded: ${String(took)} ms`);
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.throws(() => process.kill(pid, 0), "the ssh stand-in got the group's signal");
  assert.deepEqual(lockFiles(clone), []);
});

test("behind: an upstream on remote '.' (a local branch) needs no fetch", { skip: NO_GIT }, async () => {
  const local = join(SANDBOX, "dot");
  mkdirSync(local, { recursive: true });
  git(local, ["init", "--quiet", "--initial-branch=main"]);
  commit(local, "first");
  git(local, ["branch", "--quiet", "work"]);
  commit(local, "second");
  git(local, ["checkout", "--quiet", "work"]);
  git(local, ["branch", "--quiet", "--set-upstream-to=main"]);
  assert.deepEqual(await checkBehind(local), { state: "checked", upstream: "main", behind: 1, ahead: 0 });
});

test("the behind record round-trips, and doctor says it in one line without a fetch", () => {
  const project = openProject("guards-behind", { create: true });
  assert.equal(readBehindRecord(project), null);
  assert.equal(behindDoctorLine(project.name, null), null);
  const at = "2026-11-09T07:05:00.000Z";
  writeBehindRecord(project, { at, checkout: "/srv/acme", check: { state: "checked", upstream: "origin/main", behind: 3, ahead: 0 } });
  const record = readBehindRecord(project);
  assert.deepEqual(record, { at, checkout: "/srv/acme", check: { state: "checked", upstream: "origin/main", behind: 3, ahead: 0 } });
  assert.match(behindDoctorLine(project.name, record) ?? "", /^WARN: checkout of guards-behind is 3 commits behind origin\/main \(run-due, 2026-11-09T07:05:00\.000Z\)/u);
  writeBehindRecord(project, { at, checkout: "/srv/acme", check: { state: "unchecked", reason: "branch main has no upstream" } });
  assert.match(behindDoctorLine(project.name, readBehindRecord(project)) ?? "", /^NOTE: run-due could not check .*: branch main has no upstream/u);
  writeBehindRecord(project, { at, checkout: "/srv/acme", check: { state: "checked", upstream: "origin/main", behind: 0, ahead: 2 } });
  assert.match(behindDoctorLine(project.name, readBehindRecord(project)) ?? "", /^checkout of guards-behind was up to date with origin\/main/u);
  writeFileSync(join(project.root, "behind.json"), "{broken");
  assert.equal(readBehindRecord(project), null, "a broken record reads as none");
});

// --- host versions ----------------------------------------------------------------------

const NOW = new Date("2026-11-09T12:00:00.000Z");

function line(host: string, at: string, type: string, payload: Record<string, JsonValue> = {}): LedgerLine {
  return { v: 1, id: ulid(Date.parse(at)), at, host, who: "sync", project: "acme", type, ...payload };
}

function version(host: string, at: string, darius: string, compat = 1): LedgerLine {
  return line(host, at, "host.version", { version: darius, compat });
}

test("host versions: same version is ok, one line per host with since", () => {
  const report = compareHostVersions([[version("host-a", "2026-11-08T10:00:00.000Z", "0.126.0"), version("host-b", "2026-11-09T10:00:00.000Z", "0.126.0")]], NOW);
  assert.equal(report.level, "ok");
  assert.deepEqual(hostVersionLines(report), [
    "host-a: darius 0.126.0 (sync compat 1), since 2026-11-08T10:00:00.000Z",
    "host-b: darius 0.126.0 (sync compat 1), since 2026-11-09T10:00:00.000Z",
  ]);
});

test("host versions: the newest line per host counts; versions that differ warn", () => {
  const lines = [
    version("host-a", "2026-11-01T10:00:00.000Z", "0.126.0"),
    version("host-a", "2026-11-08T10:00:00.000Z", "0.126.1"),
    version("host-b", "2026-11-02T10:00:00.000Z", "0.126.0"),
  ];
  const report = compareHostVersions([lines], NOW);
  assert.equal(report.level, "warn");
  assert.equal(report.hosts.find((entry) => entry.host === "host-a")?.version, "0.126.1");
  assert.match(hostVersionLines(report).at(-1) ?? "", /^WARN: the hosts run different darius versions \(0\.126\.1, 0\.126\.0\)/u);
});

test("host versions: a compat that differs is a problem that names the host to update", () => {
  const report = compareHostVersions([[version("host-a", "2026-11-08T10:00:00.000Z", "0.140.0", 2), version("host-b", "2026-11-08T11:00:00.000Z", "0.126.0", 1)]], NOW);
  assert.equal(report.level, "problem");
  assert.match(hostVersionLines(report).at(-1) ?? "", /^PROBLEM: the hosts differ in sync compat\. Once a host with compat 2 has synced, host-b stop syncing/u);
});

test("host versions: a host with no line is unknown and not compared; a retired host is left out", () => {
  const lines = [
    version("host-a", "2026-11-08T10:00:00.000Z", "0.126.0"),
    line("host-old", "2026-11-09T09:00:00.000Z", "run.started"),
    version("host-gone", "2026-09-01T10:00:00.000Z", "0.90.0", 0),
    line("host-gone", "2026-09-20T10:00:00.000Z", "note"),
  ];
  const report = compareHostVersions([lines, lines], NOW);
  assert.equal(report.level, "ok", "unknown is not a difference; the retired host's compat 0 is not either");
  assert.deepEqual(report.hosts.map((entry) => entry.host), ["host-a", "host-old"]);
  assert.equal(hostVersionLines(report)[1], "host-old: unknown (before 0.126.0), last seen 2026-11-09T09:00:00.000Z");
  const edge = new Date(Date.parse("2026-09-20T10:00:00.000Z") + RETIRED_AFTER_MS);
  assert.ok(compareHostVersions([lines], edge).hosts.some((entry) => entry.host === "host-gone"), "30 days to the ms still counts");
  assert.deepEqual(hostVersionLines(compareHostVersions([], NOW)), []);
});

test("syncGuardLines reads the project at cwd and _global, and the behind record", () => {
  const name = "guards-doctor";
  const project = openProject(name, { create: true });
  appendLine(project, { who: "sync", type: "host.version", version: "0.126.0", compat: 1 });
  writeBehindRecord(project, { at: NOW.toISOString(), checkout: "/srv/acme", check: { state: "checked", upstream: "origin/main", behind: 1, ahead: 0 } });
  process.env.DARIUS_PROJECT = name;
  try {
    const found = syncGuardLines(SANDBOX, NOW);
    assert.equal(found.hosts.length, 1);
    assert.match(found.hosts[0] ?? "", new RegExp(`^${hostId()}: darius 0\\.126\\.0 \\(sync compat 1\\)`, "u"));
    assert.match(found.checkout[0] ?? "", /^WARN: checkout of guards-doctor is 1 commit behind origin\/main/u);
  } finally {
    delete process.env.DARIUS_PROJECT;
  }
  assert.deepEqual(syncGuardLines(SANDBOX, NOW).checkout, [], "no project at cwd: no checkout line");
});

// --- [run] behind -------------------------------------------------------------------------

test("[run] behind: warn by default, refuse when set, anything else is an error that names it", () => {
  const dir = mkdtempSync(join(SANDBOX, "config-"));
  const before = process.env.DARIUS_CONFIG_DIR;
  process.env.DARIUS_CONFIG_DIR = dir;
  try {
    writeFileSync(join(dir, "config.toml"), 'host = "host-a"\n');
    assert.equal(loadConfig().run.behind, "warn");
    writeFileSync(join(dir, "config.toml"), 'host = "host-a"\n\n[run]\nbehind = "refuse"\n');
    assert.equal(loadConfig().run.behind, "refuse");
    writeFileSync(join(dir, "config.toml"), 'host = "host-a"\n\n[run]\nbehind = "block"\n');
    assert.throws(() => loadConfig(), /\[run\] behind must be "warn" or "refuse", found "block"/u);
  } finally {
    process.env.DARIUS_CONFIG_DIR = before;
  }
});
