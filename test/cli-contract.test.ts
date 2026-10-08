/**
 * The CLI contract of 0.77.0 (docs/concept.md, "CLI contract"): `--help` never
 * acts, usage errors exit 2, a named item that is not there exits 1, `--json`
 * keeps stdout pure also on errors, an unknown verb gets a suggestion, and
 * `darius root --json` reports the mode and makes a missing store link.
 *
 * Each test runs the real CLI in a throwaway home, under both runtimes where
 * the runtime could matter (Bun's console bypasses process.stdout).
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { commitAll, initRepo, NO_GIT } from "./helpers/git.ts";

const BIN = join(import.meta.dirname, "..", "bin", "darius");
const SANDBOX = mkdtempSync(join(tmpdir(), "darius-contract-"));
after(() => rmSync(SANDBOX, { recursive: true, force: true }));

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

type Runtime = "node" | "bun";

let homes = 0;

interface Host {
  home: string;
  env: NodeJS.ProcessEnv;
}

function host(): Host {
  homes += 1;
  const home = join(SANDBOX, `host-${String(homes)}`);
  mkdirSync(home, { recursive: true });
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
  return { home, env };
}

function darius(at: Host, argv: string[], cwd: string, runtime?: Runtime): Run {
  const env = runtime === undefined ? at.env : { ...at.env, DARIUS_RUNTIME: runtime };
  const result = spawnSync(BIN, argv, { cwd, env, encoding: "utf8", input: "", timeout: 30_000 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Every entry under `dir` with its bytes, in one sha256. */
function treeHash(dir: string): string {
  const hash = createHash("sha256");
  const walk = (at: string): void => {
    if (!existsSync(at)) return;
    for (const name of readdirSync(at).toSorted()) {
      const path = join(at, name);
      const stats = lstatSync(path);
      hash.update(`${relative(dir, path)}\0`);
      if (stats.isDirectory()) walk(path);
      else if (stats.isFile()) hash.update(readFileSync(path));
    }
  };
  walk(dir);
  return hash.digest("hex");
}

/** A git repo with a marker and `.tracker/` in git (git mode, nothing linked). */
function gitRepo(at: Host, name: string): string {
  const dir = join(at.home, name);
  mkdirSync(join(dir, ".tracker"), { recursive: true });
  initRepo(dir);
  writeFileSync(join(dir, ".darius.toml"), `v = 3\nproject = "${name}"\ntz = "UTC"\n`);
  writeFileSync(join(dir, ".tracker", "00-INDEX.md"), "# index\n");
  commitAll(dir, "seed");
  return dir;
}

/** A repo set up by `darius init`: the store owns the tracker, `.tracker` is a link. */
function storeRepo(at: Host, name: string): string {
  const dir = join(at.home, name);
  mkdirSync(dir, { recursive: true });
  initRepo(dir);
  writeFileSync(join(dir, "README.md"), "# repo\n");
  const init = darius(at, ["init", "--project", name], dir);
  assert.equal(init.code, 0, init.stderr);
  return dir;
}

test("--help prints the usage and does nothing: init, link, onboard, due, skill", { skip: NO_GIT }, () => {
  const at = host();
  const dir = join(at.home, "plain");
  mkdirSync(dir, { recursive: true });
  initRepo(dir);
  const before = [treeHash(dir), treeHash(join(at.home, "state")), treeHash(join(at.home, "config")), treeHash(join(at.home, ".claude"))];
  for (const verb of ["init", "link", "onboard", "due", "skill"]) {
    for (const flag of ["--help", "-h"]) {
      const run = darius(at, [verb, flag], dir);
      assert.equal(run.code, 0, `${verb} ${flag}: ${run.stderr}`);
      assert.match(run.stdout, new RegExp(`darius ${verb}`, "u"), `${verb} ${flag} prints its usage`);
      assert.doesNotMatch(run.stdout, /^name: darius$/mu, "skill --help does not print the skill");
    }
  }
  const now = [treeHash(dir), treeHash(join(at.home, "state")), treeHash(join(at.home, "config")), treeHash(join(at.home, ".claude"))];
  assert.deepEqual(now, before, "nothing was written");
  assert.equal(existsSync(join(dir, ".darius.toml")), false);
});

test("--help works anywhere in the arguments, for sub-verbs and legacy verbs too", { skip: NO_GIT }, () => {
  const at = host();
  const dir = storeRepo(at, "helpful");
  const before = treeHash(join(at.home, "state"));
  const cases: Array<[string[], RegExp]> = [
    [["ritual", "add", "--help"], /darius ritual/u],
    [["vigil", "add", "--help"], /darius vigil/u],
    [["tree", "restore", "--help"], /tree restore/u],
    [["milestone", "archive", "x", "--help"], /milestone archive/u],
    [["add", "milestone", "--help"], /Usage: darius add milestone/u],
    [["worklog", "distill", "--help"], /Usage: darius worklog distill/u],
    [["status", "--help"], /Usage: darius status/u],
    [["mark", "--help"], /Usage: darius mark/u],
    [["hook-stop", "--help"], /Usage: darius hook-stop/u],
    [["root", "-h"], /darius root/u],
    [["help", "due"], /darius due/u],
  ];
  for (const [argv, pattern] of cases) {
    const run = darius(at, argv, dir);
    assert.equal(run.code, 0, `${argv.join(" ")}: ${run.stderr}`);
    assert.match(run.stdout, pattern, argv.join(" "));
  }
  assert.equal(treeHash(join(at.home, "state")), before, "the store is unchanged");
});

test("usage errors exit 2 across native and legacy verbs; a missing item exits 1", { skip: NO_GIT }, () => {
  const at = host();
  const dir = storeRepo(at, "usage");
  const usage: string[][] = [
    ["list"],
    ["list", "milestones", "--bogus"],
    ["add", "milestone"],
    ["add", "spec", "--milestone", "x", "--name", "y", "--template", "nope"],
    ["set-status", "x", "bogus"],
    ["index"],
    ["verify"],
    ["verify-item", "x", "y"],
    ["status", "--bogus"],
    ["show"],
    ["worklog"],
    ["worklog", "close", "x", "--status", "bogus"],
    ["scan"],
    ["doctor", "--bogus"],
    ["ritual", "add", "--name", "n", "--slug", "s", "--cadence", "whenever"],
    ["vigil", "close", "x", "--verdict", "maybe"],
    ["archive-check"],
    ["loop-check", "--bogus"],
    ["hook-stop", "--bogus"],
    ["root", "--bogus"],
    ["due", "--bogus"],
    ["tree", "restore", "--bogus"],
    ["link", "--bogus"],
    ["init", "--bogus"],
    ["spec", "check"],
  ];
  for (const argv of usage) {
    const run = darius(at, argv, dir);
    assert.equal(run.code, 2, `darius ${argv.join(" ")}: ${run.stdout}${run.stderr}`);
  }
  const missing: string[][] = [
    ["ritual", "show", "nope"],
    ["run", "show", "nope"],
    ["profile", "show", "nope"],
    ["finding", "show", "nope"],
    ["spec", "check", ".tracker/nope.md"],
    ["tree", "log", ".tracker/nope/never.md"],
    ["show", "nope.md"],
    ["verify", "nope.md"],
  ];
  for (const argv of missing) {
    const run = darius(at, argv, dir);
    assert.equal(run.code, 1, `darius ${argv.join(" ")}: ${run.stdout}${run.stderr}`);
  }
});

test("an unknown flag says 'unknown option', not 'needs a value'", { skip: NO_GIT }, () => {
  const at = host();
  const dir = storeRepo(at, "unknown-flag");
  for (const argv of [["due", "--bogus"], ["tree", "restore", "--bogus"], ["due", "--bogus", "x"]]) {
    const run = darius(at, argv, dir);
    assert.equal(run.code, 2);
    assert.match(run.stderr, /unknown option --bogus/u, argv.join(" "));
    assert.doesNotMatch(run.stderr, /needs a value/u);
  }
});

test("--json keeps stdout pure on errors: one {ok:false,error,code} object, the right exit code", { skip: NO_GIT }, () => {
  const at = host();
  const dir = storeRepo(at, "json-errors");
  const cases: Array<[string[], number]> = [
    [["status", "--bogus", "--json"], 2],
    [["list", "--json"], 2],
    [["due", "--bogus", "--json"], 2],
    [["ritual", "show", "nope", "--json"], 1],
    [["run", "show", "nope", "--json"], 1],
    [["spec", "check", ".tracker/nope.md", "--json"], 1],
    [["tree", "restore", ".tracker/nope.md", "--json"], 1],
    [["no-such-verb", "--json"], 2],
  ];
  for (const runtime of ["node", "bun"] as const) {
    for (const [argv, code] of cases) {
      const run = darius(at, argv, dir, runtime);
      assert.equal(run.code, code, `${runtime} darius ${argv.join(" ")}: ${run.stdout}${run.stderr}`);
      const parsed: { ok: boolean; error: string; code: number } = JSON.parse(run.stdout);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.code, code);
      assert.ok(parsed.error.length > 0);
      assert.equal(run.stdout.trim().split("\n").length, 1, "one line of JSON, nothing else");
    }
  }
  // A success keeps its own shape, and a failure that printed its own JSON adds no second object.
  const ok = darius(at, ["status", "--json"], dir);
  assert.equal(ok.code, 0);
  assert.equal(JSON.parse(ok.stdout).projectName, "Project");
  // Store mode: the spec is in the store tree, the checkout has no .tracker (0.78.0).
  const tree = join(at.home, "state", "json-errors", "tracker");
  mkdirSync(join(tree, "M1-x"), { recursive: true });
  writeFileSync(join(tree, "M1-x", "02-bad.md"), "---\nupdated: 2026-01-01\nagent: a\ndepends_on: []\n---\n\n# Bad\n\n## Verification Checklist\n\n- [ ] bad\n  - Command: `test -d src`\n  - Expected: `exits zero`\n");
  const failed = darius(at, ["spec", "check", "M1-x/02-bad.md", "--json"], dir);
  assert.equal(failed.code, 1);
  assert.equal(failed.stdout.trim().split("\n").length > 0 && JSON.parse(failed.stdout).ok, false, "the spec's own result");
  assert.equal(failed.stdout.includes('"code"'), false, "no second error object");
});

test("a verb without --json refuses it with exit 2", { skip: NO_GIT }, () => {
  const at = host();
  const dir = storeRepo(at, "no-json");
  const run = darius(at, ["mark", "M1-x/01-y.md", "0", "--verified", "--json"], dir);
  assert.equal(run.code, 2);
  assert.equal(JSON.parse(run.stdout).code, 2);
});

test("an unknown verb names the closest verbs, exit 2", () => {
  const at = host();
  const dir = join(at.home, "typo");
  mkdirSync(dir, { recursive: true });
  const cases: Array<[string, string]> = [
    ["stauts", "status"],
    ["ritaul", "ritual"],
    ["onbaord", "onboard"],
    ["verfy", "verify"],
    ["snapshto", "snapshot"],
  ];
  for (const [typo, wanted] of cases) {
    const run = darius(at, [typo], dir);
    assert.equal(run.code, 2);
    assert.match(run.stderr, new RegExp(`unknown command: ${typo}\\. Did you mean: .*${wanted}`, "u"));
  }
  const far = darius(at, ["qqqqqqqq"], dir);
  assert.equal(far.code, 2);
  assert.match(far.stderr, /unknown command: qqqqqqqq\. Run 'darius help'\./u);
});

test("root --json reports git, none and store mode and changes nothing on disk", { skip: NO_GIT }, () => {
  const at = host();
  const git = gitRepo(at, "gitmode");
  const inGit = JSON.parse(darius(at, ["root", "--json"], git).stdout);
  assert.deepEqual(inGit, { mode: "git", trackerRoot: join(git, ".tracker"), project: "gitmode", linked: false });
  assert.equal(darius(at, ["root"], git).stdout.trim(), join(git, ".tracker"));

  const bare = join(at.home, "bare");
  mkdirSync(bare, { recursive: true });
  const none = darius(at, ["root", "--json"], bare);
  assert.equal(none.code, 0);
  assert.deepEqual(JSON.parse(none.stdout), { mode: "none", trackerRoot: null, project: null, linked: false });
  assert.equal(darius(at, ["root"], bare).code, 1, "the plain form still fails without a tracker");

  const store = storeRepo(at, "storemode");
  commitAll(store, "marker");
  const tree = join(at.home, "state", "storemode", "tracker");
  assert.deepEqual(JSON.parse(darius(at, ["root", "--json"], store).stdout), { mode: "store", trackerRoot: tree, project: "storemode", linked: false });
  assert.equal(existsSync(join(store, ".tracker")), false, "store mode makes no link (0.78.0)");
  // An old link (before 0.78.0) is reported, and root leaves it alone.
  symlinkSync(tree, join(store, ".tracker"));
  assert.deepEqual(JSON.parse(darius(at, ["root", "--json"], store).stdout), { mode: "store", trackerRoot: tree, project: "storemode", linked: true });
  assert.equal(lstatSync(join(store, ".tracker")).isSymbolicLink(), true, "root never migrates");
  rmSync(join(store, ".tracker"));

  // A new worktree has the marker and no link. root reports that and makes nothing.
  const worktree = join(at.home, "storemode-wt");
  const added = spawnSync("git", ["worktree", "add", "-q", worktree, "-b", "wt"], { cwd: store, env: at.env, encoding: "utf8" });
  assert.equal(added.status, 0, added.stderr);
  const stateBefore = treeHash(join(at.home, "state"));
  const checkoutBefore = treeHash(worktree);
  assert.deepEqual(JSON.parse(darius(at, ["root", "--json"], worktree).stdout), { mode: "store", trackerRoot: tree, project: "storemode", linked: false });
  assert.equal(existsSync(join(worktree, ".tracker")), false, "no link was made");
  assert.equal(treeHash(worktree), checkoutBefore);
  assert.equal(treeHash(join(at.home, "state")), stateBefore);
  assert.equal(darius(at, ["root"], worktree).stdout.trim(), tree, "every worktree names the same tree");
});
