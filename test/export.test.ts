/**
 * `src/core/export.ts` and `src/cli/export.ts`: the mirror, the secret-name
 * refusal, and the whole export against a local bare repo.
 *
 * NETWORK AND STORE SAFETY: every store, clone and "remote" here is a
 * `mkdtemp` dir. The backup repo is a local bare repo named by a file path,
 * so clone, commit and push run for real with no network. Git reads no
 * global or system config (GIT_CONFIG_GLOBAL points at an empty file), so
 * the operator's identity, signing and hooks never apply.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { exportCommand } from "../src/cli/export.ts";
import { UsageError } from "../src/cli/registry.ts";
import type { Config } from "../src/core/config.ts";
import { describeExport, findSecretNames, MANIFEST_NAME, mirrorTree, runExport } from "../src/core/export.ts";
import type { ExportOptions } from "../src/core/export.ts";

const emptyGitConfig = join(mkdtempSync(join(tmpdir(), "darius-export-gitconfig-")), "gitconfig");
writeFileSync(emptyGitConfig, "");
process.env.GIT_CONFIG_GLOBAL = emptyGitConfig;
process.env.GIT_CONFIG_NOSYSTEM = "1";

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function write(root: string, path: string, text: string): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}

function gitOut(cwd: string, args: readonly string[]): string {
  const ran = spawnSync("git", [...args], { cwd, encoding: "utf8" });
  assert.equal(ran.status, 0, ran.stderr);
  return ran.stdout.trim();
}

/** A bare repo in a temp dir: the backup "remote". */
function bareRepo(): string {
  const dir = join(tempDir("darius-export-remote-"), "backup.git");
  gitOut(tmpdir(), ["init", "--quiet", "--bare", dir]);
  return dir;
}

/** A small store: `_global`, one project with an item, a ledger and a blob, and a digest. */
function sampleStore(): string {
  const state = join(tempDir("darius-export-state-"), "darius");
  write(state, "_global/sync.json", "{}\n");
  write(state, "demo/items/rituals/r1.md", "# ritual\n");
  write(state, "demo/ledger/host-a.jsonl", '{"t":"run.started"}\n');
  write(state, "demo/blobs/ab/abcdef", "blob bytes");
  write(state, "run-due-digest.json", "{}\n");
  return state;
}

interface Setup {
  state: string;
  configDir: string;
  repo: string;
  clone: string;
}

function setupExport(): Setup {
  return { state: sampleStore(), configDir: tempDir("darius-export-config-"), repo: bareRepo(), clone: join(tempDir("darius-export-clone-"), "backup") };
}

function config(host: string, repo: string, clone: string): Config {
  return {
    host,
    notify: { webhook: "" },
    runner: { claude: "" },
    setup: { units: [] },
    backup: { repo, dir: clone },
  };
}

function options(setup: Setup, host = "host-a", extra: Partial<ExportOptions> = {}): ExportOptions {
  return {
    config: config(host, setup.repo, setup.clone),
    stateDir: setup.state,
    configDir: setup.configDir,
    version: "0.43.0",
    now: new Date("2026-10-01T03:30:00.000Z"),
    ...extra,
  };
}

/** The files the bare repo's newest commit holds, sorted. */
function remoteFiles(repo: string): string[] {
  return gitOut(repo, ["ls-tree", "-r", "--name-only", "HEAD"]).split("\n").toSorted();
}

// --- the mirror ----------------------------------------------------------------------

test("mirrorTree copies every file, deletes stale files and dirs, keeps the manifest, and a re-run copies nothing", () => {
  const source = sampleStore();
  const dest = join(tempDir("darius-export-dest-"), "host-a");
  write(dest, "gone/old.md", "stale");
  write(dest, "demo/items/rituals/removed.md", "stale");
  write(dest, MANIFEST_NAME, "{}");

  const first = mirrorTree(source, dest, { keep: [MANIFEST_NAME] });
  assert.equal(first.files, 5);
  assert.equal(first.copied, 5);
  assert.equal(first.deleted, 2);
  assert.equal(first.bytes, 3 + 9 + 20 + 10 + 3);
  assert.deepEqual(first.other, []);
  assert.equal(readFileSync(join(dest, "demo/blobs/ab/abcdef"), "utf8"), "blob bytes");
  assert.equal(readFileSync(join(dest, "run-due-digest.json"), "utf8"), "{}\n");
  assert.equal(existsSync(join(dest, "gone")), false);
  assert.equal(existsSync(join(dest, "demo/items/rituals/removed.md")), false);
  assert.equal(existsSync(join(dest, MANIFEST_NAME)), true);

  const second = mirrorTree(source, dest, { keep: [MANIFEST_NAME] });
  assert.equal(second.copied, 0);
  assert.equal(second.deleted, 0);

  write(source, "demo/items/rituals/r1.md", "# ritual, edited\n");
  const third = mirrorTree(source, dest, { keep: [MANIFEST_NAME] });
  assert.equal(third.copied, 1);
  assert.equal(readFileSync(join(dest, "demo/items/rituals/r1.md"), "utf8"), "# ritual, edited\n");
});

test("mirrorTree with dryRun counts and writes nothing", () => {
  const source = sampleStore();
  const dest = join(tempDir("darius-export-dest-"), "host-a");
  write(dest, "gone.md", "stale");
  const plan = mirrorTree(source, dest, { dryRun: true });
  assert.equal(plan.copied, 5);
  assert.equal(plan.deleted, 1);
  assert.equal(existsSync(join(dest, "gone.md")), true);
  assert.equal(existsSync(join(dest, "_global")), false);
});

// --- the secret-name scan --------------------------------------------------------------

test("findSecretNames flags credentials, keys, *.pem, *.key and *.credentials, and passes blobs and ledgers", () => {
  assert.deepEqual(
    findSecretNames([
      "demo/credentials",
      "keys/host-b.credentials",
      "demo/tls/server.pem",
      "demo/id.KEY",
      "demo/blobs/ab/abcdef",
      "demo/ledger/host-a.jsonl",
      "demo/items/rituals/keys-rotation.md",
    ]),
    ["demo/credentials", "keys/host-b.credentials", "demo/tls/server.pem", "demo/id.KEY"],
  );
});

test("runExport refuses a store that holds a secret-looking name, before it clones", () => {
  const setup = setupExport();
  write(setup.state, "demo/server.pem", "-----BEGIN");
  assert.throws(() => runExport(options(setup)), /names that look like secrets: demo\/server\.pem/);
  assert.equal(existsSync(setup.clone), false);
});

test("runExport refuses when the store and the config dir overlap", () => {
  const setup = setupExport();
  assert.throws(() => runExport({ ...options(setup), configDir: join(setup.state, "config") }), /never exported/);
});

// --- the export against a local bare repo ------------------------------------------------

test("runExport clones, mirrors into <host>/, writes EXPORT.json, commits and pushes; a re-run changes nothing", () => {
  const setup = setupExport();
  const first = runExport(options(setup));
  assert.equal(first.code, 0, first.warnings.join("; "));
  assert.equal(first.files, 5);
  assert.notEqual(first.commit, null);
  assert.equal(first.pushed, 1);
  assert.match(describeExport(first), /^✓ export: 5 files, 45 B, committed [0-9a-f]+ and pushed$/u);

  assert.deepEqual(remoteFiles(setup.repo), [
    "host-a/EXPORT.json",
    "host-a/_global/sync.json",
    "host-a/demo/blobs/ab/abcdef",
    "host-a/demo/items/rituals/r1.md",
    "host-a/demo/ledger/host-a.jsonl",
    "host-a/run-due-digest.json",
  ]);
  assert.equal(gitOut(setup.repo, ["log", "-1", "--format=%s"]), "export host-a 2026-10-01T03:30:00.000Z");
  const manifest: unknown = JSON.parse(gitOut(setup.repo, ["show", "HEAD:host-a/EXPORT.json"]));
  assert.deepEqual(manifest, { v: 1, host: "host-a", at: "2026-10-01T03:30:00.000Z", darius: "0.43.0", files: 5, bytes: 45 });

  const second = runExport(options(setup, "host-a", { now: new Date("2026-10-02T03:30:00.000Z") }));
  assert.equal(second.code, 0);
  assert.equal(second.commit, null);
  assert.equal(second.pushed, 0);
  assert.equal(describeExport(second), "· export: nothing changed (5 files, 45 B)");
  assert.equal(gitOut(setup.repo, ["rev-list", "--count", "HEAD"]), "1");
});

test("runExport commits a deleted store file as a deletion", () => {
  const setup = setupExport();
  assert.equal(runExport(options(setup)).code, 0);
  renameSync(join(setup.state, "run-due-digest.json"), join(tempDir("darius-export-moved-"), "digest.json"));
  const next = runExport(options(setup));
  assert.equal(next.code, 0);
  assert.equal(next.deleted, 1);
  assert.notEqual(next.commit, null);
  assert.equal(remoteFiles(setup.repo).includes("host-a/run-due-digest.json"), false);
});

test("runExport --dry-run counts and changes nothing, not even a clone", () => {
  const setup = setupExport();
  const plan = runExport(options(setup, "host-a", { dryRun: true }));
  assert.equal(plan.code, 0);
  assert.equal(plan.wouldClone, true);
  assert.equal(plan.copied, 5);
  assert.equal(existsSync(setup.clone), false);
  assert.match(describeExport(plan), /^· export \(dry run\): 5 files, 45 B in the store; would copy 5, delete 0 in .*host-a, would clone /u);
});

test("runExport refuses a dir that is not a clone of [backup] repo", () => {
  const setup = setupExport();
  write(setup.clone, "notes.md", "not a clone");
  assert.throws(() => runExport(options(setup)), /is not a git clone/);

  const other = setupExport();
  assert.equal(runExport(options(other)).code, 0);
  assert.throws(() => runExport({ ...options(setup), config: config("host-a", setup.repo, other.clone) }), /not of \[backup\] repo/);
});

test("offline: the commit stays local and the exit code is 3; the next run pushes it", () => {
  const setup = setupExport();
  assert.equal(runExport(options(setup)).code, 0);
  const away = `${setup.repo}.away`;
  renameSync(setup.repo, away);

  write(setup.state, "demo/items/rituals/r2.md", "# second\n");
  const offline = runExport(options(setup));
  assert.equal(offline.code, 3);
  assert.notEqual(offline.commit, null);
  assert.equal(offline.warnings.length, 2);
  assert.match(offline.warnings[0] ?? "", /cannot fetch from origin, continuing with the local clone/);
  assert.match(offline.warnings[1] ?? "", /push failed, the commit stays local/);
  assert.match(describeExport(offline), /^! export: 6 files, .*, committed [0-9a-f]+, not pushed$/u);

  renameSync(away, setup.repo);
  const back = runExport(options(setup));
  assert.equal(back.code, 0, back.warnings.join("; "));
  assert.equal(back.commit, null);
  assert.equal(back.pushed, 1);
  assert.equal(describeExport(back), "✓ export: nothing changed, pushed 1 earlier commit");
  assert.equal(remoteFiles(setup.repo).includes("host-a/demo/items/rituals/r2.md"), true);
});

test("two hosts export into one repo, each into its own directory, and neither overwrites the other", () => {
  const a = setupExport();
  const b: Setup = { ...setupExport(), repo: a.repo };
  write(b.state, "demo/ledger/host-b.jsonl", '{"t":"x"}\n');

  // host-b clones while the repo is still empty, then host-a pushes first.
  assert.equal(runExport(options(b, "host-b", { dryRun: true })).wouldClone, true);
  mkdirSync(dirname(b.clone), { recursive: true });
  gitOut(dirname(b.clone), ["clone", "--quiet", b.repo, b.clone]);
  assert.equal(runExport(options(a, "host-a")).code, 0);
  const second = runExport(options(b, "host-b"));
  assert.equal(second.code, 0, second.warnings.join("; "));

  // host-a again, now behind host-b: its new commit is rebased on top.
  write(a.state, "demo/items/rituals/r3.md", "# third\n");
  const third = runExport(options(a, "host-a"));
  assert.equal(third.code, 0, third.warnings.join("; "));

  const files = remoteFiles(a.repo);
  assert.equal(files.includes("host-a/demo/items/rituals/r3.md"), true);
  assert.equal(files.includes("host-b/demo/ledger/host-b.jsonl"), true);
  assert.equal(files.includes("host-a/demo/ledger/host-b.jsonl"), false);
  assert.equal(gitOut(a.repo, ["rev-list", "--count", "HEAD"]), "3");
});

// --- the command ----------------------------------------------------------------------------

test("darius export without [backup] is a usage error (exit 2)", async () => {
  const configDir = tempDir("darius-export-cmd-config-");
  writeFileSync(join(configDir, "config.toml"), 'host = "host-a"\n');
  const previous = process.env.DARIUS_CONFIG_DIR;
  process.env.DARIUS_CONFIG_DIR = configDir;
  try {
    await assert.rejects(exportCommand.run({ positional: [], flags: {}, json: false, repeated: {} }), UsageError);
    await assert.rejects(exportCommand.run({ positional: [], flags: {}, json: false, repeated: {} }), /backup not configured/);
  } finally {
    if (previous === undefined) delete process.env.DARIUS_CONFIG_DIR;
    else process.env.DARIUS_CONFIG_DIR = previous;
  }
});
