/**
 * `darius sync` carries the tracker tree between two hosts (src/cli/sync.ts,
 * src/core/tree.ts): a capture before the push, an apply after the pull.
 *
 * Two hosts share one in-process fake bucket (test/helpers/fake-s3.ts). Each
 * host has its own state, config and checkout; the second checkout is a git
 * clone of the first. Everything runs through the real CLI, spawned without
 * blocking, so the fake bucket in this process can answer.
 */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startFakeS3, type FakeS3 } from "./helpers/fake-s3.ts";
import { NO_GIT } from "./helpers/git.ts";

const BIN = join(import.meta.dirname, "..", "bin", "darius");
const SANDBOX = mkdtempSync(join(tmpdir(), "darius-tree-sync-"));
let bucket: FakeS3 | undefined;

before(async () => {
  bucket = await startFakeS3("darius-test");
});
after(async () => {
  await bucket?.stop();
  rmSync(SANDBOX, { recursive: true, force: true });
});

interface Host {
  name: string;
  env: NodeJS.ProcessEnv;
  state: string;
}

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

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
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  delete env.DARIUS_PROJECT;
  return { name, env, state };
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

function git(cwd: string, args: readonly string[]): string {
  const identity = ["-c", "user.name=darius-test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false"];
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const result = spawnSync("git", [...identity, ...args], { cwd, env, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

const SPEC = ".tracker/M1-alpha/01-spec-one.md";

test("darius sync captures the tree before the push and applies it after the pull, both ways", { skip: NO_GIT }, async () => {
  const endpoint = bucket?.endpoint ?? "";
  const hostA = makeHost("host-a", endpoint);
  const hostB = makeHost("host-b", endpoint);
  const project = "acme-sync";

  const first = join(SANDBOX, "checkout-a");
  mkdirSync(first);
  git(first, ["init", "--quiet", "--initial-branch=main"]);
  await ok(hostA, ["init", "--project", project], first);
  git(first, ["add", "--all"]);
  git(first, ["commit", "--quiet", "--message", "darius init"]);
  await ok(hostA, ["add", "milestone", "--name", "Alpha", "--slug", "alpha", "--owner", "dev@example.com"], first);
  await ok(hostA, ["add", "spec", "--milestone", "alpha", "--name", "Spec one", "--template", "generic"], first);
  // A file written by hand, outside any verb: only the sync's capture sees it.
  writeFileSync(join(first, ".tracker", "M1-alpha", "notes.md"), "by hand\n");

  const pushed = JSON.parse(await ok(hostA, ["sync", "--project", project, "--json"], first));
  assert.equal(pushed.projects[0].tree.captured, 1, "the hand-written file");
  assert.deepEqual(pushed.projects[0].tree.problems, []);

  // A new host whose first act is a sync: the pull brings the first tree lines, and the same sync applies them.
  const hostE = makeHost("host-e", endpoint);
  const fresh = JSON.parse(await ok(hostE, ["sync", "--project", project, "--json"], SANDBOX));
  assert.ok(fresh.projects[0].tree.applied > 0, JSON.stringify(fresh.projects[0]));
  assert.equal(readFileSync(join(hostE.state, project, "tracker", "M1-alpha", "notes.md"), "utf8"), "by hand\n");
  assert.equal(existsSync(join(hostE.state, project, "tracker", "00-INDEX.md")), true, "the first sync rebuilt the index");

  const second = join(SANDBOX, "checkout-b");
  git(SANDBOX, ["clone", "--quiet", first, second]);
  const linked = await ok(hostB, ["init"], second);
  assert.match(linked, /^✓ \.tracker links to the tracker in the darius store$/mu);
  const pulled = JSON.parse(await ok(hostB, ["sync", "--project", project, "--json"], second));
  assert.equal(pulled.projects[0].tree.applied, 3);
  assert.equal(readFileSync(join(second, SPEC), "utf8"), readFileSync(join(first, SPEC), "utf8"));
  assert.equal(readFileSync(join(second, ".tracker", "M1-alpha", "notes.md"), "utf8"), "by hand\n");
  assert.equal(git(second, ["status", "--porcelain"]), "");

  // 00-INDEX.md is derived and never synced: sync rebuilds it, and so does any tracker verb.
  const index = join(hostB.state, project, "tracker", "00-INDEX.md");
  assert.equal(existsSync(index), true, "sync rebuilt the index");
  rmSync(index);
  const status = await darius(hostB, ["status"], second);
  assert.equal(status.code, 0, status.stderr);
  assert.equal(status.stdout, await ok(hostA, ["status"], first), "the same status as the first host");
  assert.equal(existsSync(index), true, "the verb rebuilt the index");
  assert.doesNotMatch(status.stdout, /tracker index: rebuilt/u, "quietly");
  const quick = await ok(hostB, ["doctor", "--quick"], second);
  assert.equal(quick, await ok(hostA, ["doctor", "--quick"], first), "doctor --quick sees a tracker on both hosts");

  await ok(hostB, ["mark", SPEC, "0", "--in-progress"], second);
  const text = await ok(hostB, ["sync", "--project", project], second);
  assert.match(text, /^ {2}tree: 0 captured, 0 applied$/mu, "the verb already captured its change");
  await ok(hostA, ["sync", "--project", project], first);
  assert.equal(readFileSync(join(first, SPEC), "utf8"), readFileSync(join(second, SPEC), "utf8"));
  assert.match(readFileSync(join(first, SPEC), "utf8"), /in-progress|\[~\]|\[-\]/u);
});

test("darius sync merges a .jsonl file both hosts appended to; each host syncs twice and both hold the same file", { skip: NO_GIT }, async () => {
  const endpoint = bucket?.endpoint ?? "";
  const hostA = makeHost("host-c", endpoint);
  const hostB = makeHost("host-d", endpoint);
  const project = "acme-merge";
  const first = join(SANDBOX, "merge-a");
  mkdirSync(first);
  git(first, ["init", "--quiet", "--initial-branch=main"]);
  await ok(hostA, ["init", "--project", project], first);
  git(first, ["add", "--all"]);
  git(first, ["commit", "--quiet", "--message", "darius init"]);
  const log = join(".tracker", "evidence.jsonl");
  writeFileSync(join(first, log), '{"n":1}\n');
  await ok(hostA, ["sync", "--project", project], first);
  const second = join(SANDBOX, "merge-b");
  git(SANDBOX, ["clone", "--quiet", first, second]);
  await ok(hostB, ["init"], second);
  await ok(hostB, ["sync", "--project", project], second);
  assert.equal(readFileSync(join(second, log), "utf8"), '{"n":1}\n');

  writeFileSync(join(first, log), '{"n":1}\n{"host":"a"}\n');
  writeFileSync(join(second, log), '{"n":1}\n{"host":"b"}\n');
  await ok(hostA, ["sync", "--project", project], first);
  await ok(hostB, ["sync", "--project", project], second);
  const merging = JSON.parse(await ok(hostA, ["sync", "--project", project, "--json"], first));
  assert.equal(merging.projects[0].tree.merged, 1);
  assert.match(merging.projects[0].tree.problems.join("\n"), /concurrent edit of evidence\.jsonl: merged the lines of both versions \(host-d and host-c\)/u);
  await ok(hostB, ["sync", "--project", project], second);
  const merged = '{"n":1}\n{"host":"b"}\n{"host":"a"}\n';
  assert.equal(readFileSync(join(first, log), "utf8"), merged);
  assert.equal(readFileSync(join(second, log), "utf8"), merged);
  for (const [at, dir] of [[hostA, first], [hostB, second]] as const) {
    const quiet = JSON.parse(await ok(at, ["sync", "--project", project, "--json"], dir));
    assert.deepEqual([quiet.projects[0].tree.captured, quiet.projects[0].tree.merged], [0, 0], "no ping-pong");
  }
});

test("two hosts work in one milestone: threads, ticks and claims merge; a text clash shows in doctor and due until resolved", { skip: NO_GIT }, async () => {
  const endpoint = bucket?.endpoint ?? "";
  const hostA = makeHost("host-f", endpoint);
  const hostB = makeHost("host-g", endpoint);
  const project = "acme-multi";
  const first = join(SANDBOX, "multi-a");
  mkdirSync(first);
  git(first, ["init", "--quiet", "--initial-branch=main"]);
  await ok(hostA, ["init", "--project", project], first);
  git(first, ["add", "--all"]);
  git(first, ["commit", "--quiet", "--message", "darius init"]);
  await ok(hostA, ["add", "milestone", "--name", "Alpha", "--slug", "alpha", "--owner", "dev@example.com"], first);
  await ok(hostA, ["add", "spec", "--milestone", "alpha", "--name", "Spec one", "--template", "generic"], first);
  await ok(hostA, ["add", "spec", "--milestone", "alpha", "--name", "Spec two", "--template", "generic"], first);
  await ok(hostA, ["sync", "--project", project], first);
  const second = join(SANDBOX, "multi-b");
  git(SANDBOX, ["clone", "--quiet", first, second]);
  await ok(hostB, ["init"], second);
  await ok(hostB, ["sync", "--project", project], second);
  const specTwo = ".tracker/M1-alpha/02-spec-two.md";

  // Both hosts work before either syncs: a thread each, a different tick each, a claim each.
  const threadA = (await ok(hostA, ["worklog", "open", "alpha", "--spec", SPEC, "--message", "note from A", "--session", "sess-a"], first)).trim();
  const threadB = (await ok(hostB, ["worklog", "open", "alpha", "--spec", specTwo, "--message", "note from B", "--session", "sess-b"], second)).trim();
  await ok(hostA, ["mark", SPEC, "0", "--in-progress"], first);
  await ok(hostB, ["mark", SPEC, "1", "--in-progress"], second);
  await ok(hostA, ["claim", SPEC, "--session", "sess-a"], first);
  await ok(hostB, ["claim", specTwo, "--session", "sess-b"], second);
  for (const [at, dir] of [[hostA, first], [hostB, second], [hostA, first], [hostB, second]] as const) await ok(at, ["sync", "--project", project], dir);

  for (const dir of [first, second]) {
    const log = readFileSync(join(dir, ".tracker", "worklog", "alpha.md"), "utf8");
    assert.match(log, new RegExp(`## ${threadA}`, "u"));
    assert.match(log, new RegExp(`## ${threadB}`, "u"));
    assert.match(log, /note from A/u);
    assert.match(log, /note from B/u);
    assert.equal((readFileSync(join(dir, SPEC), "utf8").match(/- \[~\]/gu) ?? []).length, 2, "both ticks");
  }
  assert.equal(readFileSync(join(first, ".tracker", "worklog", "alpha.md"), "utf8"), readFileSync(join(second, ".tracker", "worklog", "alpha.md"), "utf8"));
  const refused = await darius(hostA, ["claim", specTwo, "--session", "sess-a"], first);
  assert.equal(refused.code, 1, "a claim from the other host blocks");
  assert.match(refused.stderr, /claimed by session sess-b/u);
  const listed = (await ok(hostA, ["worklog", "list", "--json"], first)).trim();
  assert.match(listed, new RegExp(threadB, "u"), "the legacy reader reads the merged file");
  const clean = JSON.parse(await ok(hostA, ["due", "--project", project, "--json"], first));
  assert.deepEqual(clean.treeConflicts, [], "merges record no conflict");

  // A text change on both sides: last writer wins, the conflict is recorded and shown.
  writeFileSync(join(first, specTwo), `${readFileSync(join(first, specTwo), "utf8")}\nA's paragraph\n`);
  await ok(hostA, ["sync", "--project", project], first);
  writeFileSync(join(second, specTwo), `${readFileSync(join(second, specTwo), "utf8")}\nB's paragraph\n`);
  // A sees the clash on its apply and records it; its next sync pushes the line.
  for (const [at, dir] of [[hostB, second], [hostA, first], [hostA, first], [hostB, second]] as const) await ok(at, ["sync", "--project", project], dir);
  assert.match(readFileSync(join(first, specTwo), "utf8"), /B's paragraph/u);
  const due = JSON.parse(await ok(hostB, ["due", "--project", project, "--json"], second));
  assert.equal(due.treeConflicts.length, 1);
  assert.equal(due.treeConflicts[0].path, "M1-alpha/02-spec-two.md");
  assert.equal(due.treeConflicts[0].loserHost, "host-f");
  assert.match(await ok(hostB, ["due", "--project", project], second), /^tree: acme-multi has 1 open conflict\(s\) in the tracker tree; darius doctor shows how to get the lost version back$/mu);
  const doctor = await darius(hostB, ["doctor"], second);
  assert.match(doctor.stdout, /## Tree conflicts/u);
  const restoreLine = `darius tree restore .tracker/M1-alpha/02-spec-two.md --at ${String(due.treeConflicts[0].loserSha)} --force`;
  assert.ok(doctor.stdout.includes(restoreLine), doctor.stdout);
  await ok(hostB, ["tree", "resolve", ".tracker/M1-alpha/02-spec-two.md"], second);
  assert.doesNotMatch((await darius(hostB, ["doctor"], second)).stdout, /Tree conflicts/u);
  await ok(hostB, ["sync", "--project", project], second);
  await ok(hostA, ["sync", "--project", project], first);
  assert.deepEqual(JSON.parse(await ok(hostA, ["due", "--project", project, "--json"], first)).treeConflicts, [], "the resolve line syncs");
});
