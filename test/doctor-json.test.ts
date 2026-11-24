/**
 * `darius doctor --json` carries every part (0.138.0): one JSON object on
 * stdout with the new top-level `darius` field, also with stderr merged in,
 * in a store-mode project with a tree conflict, and also when the legacy
 * doctor ends the process itself. Text that is no JSON object passes through.
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendLine } from "../src/core/ledger.ts";
import { openProject } from "../src/core/store.ts";
import { TREE_CONFLICT } from "../src/core/tree-conflicts.ts";
import { commitAll, initRepo, NO_GIT } from "./helpers/git.ts";

const BIN = join(import.meta.dirname, "..", "bin", "darius");
const SANDBOX = mkdtempSync(join(tmpdir(), "darius-doctor-json-"));
after(() => rmSync(SANDBOX, { recursive: true, force: true }));

type Runtime = "node" | "bun";

interface Ran {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface Repo {
  env: NodeJS.ProcessEnv;
  dir: string;
}

function hostEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    DARIUS_STATE_DIR: join(home, "state"),
    DARIUS_CONFIG_DIR: join(home, "config"),
    DARIUS_WHO: "dev@example.com",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    NO_COLOR: "1",
  };
  delete env.DARIUS_PROJECT;
  return env;
}

function run(env: NodeJS.ProcessEnv, argv: string[], cwd: string, runtime: Runtime, mergeStderr = false): Ran {
  const full = { ...env, DARIUS_RUNTIME: runtime };
  if (mergeStderr) {
    const result = spawnSync("/bin/sh", ["-c", `exec "$0" "$@" 2>&1`, BIN, ...argv], { cwd, env: full, encoding: "utf8", input: "", timeout: 30_000 });
    return { code: result.status, stdout: result.stdout, stderr: "" };
  }
  const result = spawnSync(BIN, argv, { cwd, env: full, encoding: "utf8", input: "", timeout: 30_000 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** A store-mode repo with one open tree conflict. */
function storeRepoWithConflict(name: string): Repo {
  const home = join(SANDBOX, `home-${name}`);
  const dir = join(home, name);
  mkdirSync(dir, { recursive: true });
  const env = hostEnv(home);
  initRepo(dir);
  writeFileSync(join(dir, "README.md"), "# repo\n");
  const init = spawnSync(BIN, ["init", "--project", name], { cwd: dir, env, encoding: "utf8", input: "" });
  assert.equal(init.status, 0, init.stderr);
  commitAll(dir, "marker");
  const before = process.env.DARIUS_STATE_DIR;
  process.env.DARIUS_STATE_DIR = join(home, "state");
  try {
    appendLine(openProject(name), { who: "t", type: TREE_CONFLICT, path: "M1-x/01-a.md", winner_sha: "b".repeat(64), loser_sha: "a".repeat(64), winner_host: "h2", loser_host: "h1" });
  } finally {
    if (before === undefined) delete process.env.DARIUS_STATE_DIR;
    else process.env.DARIUS_STATE_DIR = before;
  }
  return { env, dir };
}

for (const runtime of ["node", "bun"] as const) {
  test(`doctor --json is one JSON object with a darius field, a tree conflict inside, stderr merged too (${runtime})`, { skip: NO_GIT }, () => {
    const { env, dir } = storeRepoWithConflict(`dj-${runtime}`);
    const split = run(env, ["doctor", "--json"], dir, runtime);
    const report = JSON.parse(split.stdout);
    assert.ok("ok" in report && "healthy" in report, "the legacy fields stay");
    assert.equal(split.code, report.ok === true ? 0 : 1, "the exit code is the legacy one");
    assert.deepEqual(Object.keys(report.darius).toSorted(), ["box", "channels", "checkout", "hosts", "notes", "treeConflicts"]);
    assert.match(report.darius.treeConflicts.join("\n"), /WARN: .*M1-x\/01-a\.md/u);
    assert.doesNotMatch(split.stdout, /## Tree conflicts/u);
    assert.doesNotMatch(split.stderr, /^darius: (box|hosts|checkout): /mu, "the parts no longer go to stderr");

    const merged = run(env, ["doctor", "--json"], dir, runtime, true);
    const again = JSON.parse(merged.stdout);
    assert.deepEqual(again.darius.treeConflicts, report.darius.treeConflicts);
    assert.equal(merged.code, split.code);
  });
}

function fakeLegacy(name: string, source: string): string {
  const file = join(SANDBOX, `${name}.mjs`);
  writeFileSync(file, source);
  return file;
}

for (const runtime of ["node", "bun"] as const) {
  test(`doctor --json merges when the legacy doctor ends the process itself, and passes other text through (${runtime})`, { skip: NO_GIT }, () => {
    const { env, dir } = storeRepoWithConflict(`dx-${runtime}`);
    const exiting = fakeLegacy(`exit-${runtime}`, `export async function main() {\n  process.stdout.write(JSON.stringify({ ok: false, healthy: false }, null, 2) + "\\n");\n  process.exit(1);\n}\n`);
    const merged = run({ ...env, DARIUS_LEGACY_ENTRY: exiting }, ["doctor", "--json"], dir, runtime);
    assert.equal(merged.code, 1);
    const report = JSON.parse(merged.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.healthy, false);
    assert.equal(report.darius.treeConflicts.length > 0, true);

    const plain = fakeLegacy(`plain-${runtime}`, `export async function main() {\n  process.stdout.write("not json\\n");\n  return 0;\n}\n`);
    const through = run({ ...env, DARIUS_LEGACY_ENTRY: plain }, ["doctor", "--json"], dir, runtime);
    assert.equal(through.stdout, "not json\n");
    assert.match(through.stderr, /^darius: tree conflicts: WARN: /mu, "the old stderr lines stay");
  });
}

for (const runtime of ["node", "bun"] as const) {
  test(`doctor --json over 64 KB is complete for a slow reader, also when the legacy doctor exits (${runtime})`, { skip: NO_GIT }, () => {
    const { env, dir } = storeRepoWithConflict(`ds-${runtime}`);
    const big = fakeLegacy(`big-${runtime}`, `export async function main() {\n  process.stdout.write(JSON.stringify({ ok: false, pad: "x".repeat(300000) }) + "\\n");\n  process.exit(1);\n}\n`);
    const result = spawnSync("/bin/sh", ["-c", `"$0" doctor --json | { sleep 2; cat; }`, BIN], {
      cwd: dir,
      env: { ...env, DARIUS_RUNTIME: runtime, DARIUS_LEGACY_ENTRY: big },
      encoding: "utf8",
      input: "",
      timeout: 30_000,
    });
    const report = JSON.parse(result.stdout);
    assert.equal(report.pad.length, 300_000);
    assert.ok("darius" in report, "one merged object, and no error object after it");
  });
}
