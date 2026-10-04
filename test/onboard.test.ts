/**
 * `darius onboard` (src/cli/onboard.ts) against the real vendored legacy CLI,
 * in temp git repos: the move, that every tracker verb answers the same
 * before and after it, that a write verb then changes only the store, the
 * refusals, and that `--dry-run` writes nothing.
 *
 * The fixture tracker is made by the legacy CLI itself, then committed. It
 * has no `vigils/` folder: the vigil import is another module's work.
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { withKinds } from "../src/cli/onboard.ts";
import { NO_GIT } from "./helpers/git.ts";

const BIN = join(import.meta.dirname, "..", "bin", "darius");
const SANDBOX = mkdtempSync(join(tmpdir(), "darius-onboard-"));
after(() => rmSync(SANDBOX, { recursive: true, force: true }));

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface Host {
  env: NodeJS.ProcessEnv;
  state: string;
}

let count = 0;

function host(): Host {
  count += 1;
  const home = join(SANDBOX, `host-${String(count)}`);
  mkdirSync(home, { recursive: true });
  const state = join(home, "state");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    DARIUS_STATE_DIR: state,
    DARIUS_CONFIG_DIR: join(home, "config"),
    DARIUS_WHO: "dev@example.com",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    NO_COLOR: "1",
  };
  delete env.DARIUS_PROJECT;
  return { env, state };
}

function darius(at: Host, argv: string[], cwd: string): Run {
  const result = spawnSync(BIN, argv, { cwd, env: at.env, encoding: "utf8", input: "", timeout: 30_000 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function git(at: Host, dir: string, args: readonly string[]): string {
  const identity = ["-c", "user.name=darius-test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false"];
  const result = spawnSync("git", [...identity, ...args], { cwd: dir, env: at.env, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

/** Every entry under `dir`: relative path, mode, and the bytes of files, in one sha256. Skips `.git` when asked. */
function treeHash(dir: string, skip: readonly string[] = []): string {
  const hash = createHash("sha256");
  const walk = (at: string): void => {
    for (const name of readdirSync(at).toSorted()) {
      const path = join(at, name);
      if (skip.includes(relative(dir, path))) continue;
      const stats = lstatSync(path);
      hash.update(`${relative(dir, path)}\0${String(stats.mode)}\0`);
      if (stats.isDirectory()) walk(path);
      else if (stats.isSymbolicLink()) hash.update(readlinkSync(path));
      else hash.update(readFileSync(path));
    }
  };
  walk(dir);
  return hash.digest("hex");
}

const MARKER = [
  "# acme-web: the darius marker",
  "v = 3",
  'project = "PROJECT"',
  "",
  "# the zone of every ritual",
  'tz = "Europe/Berlin"',
  "",
  "[rituals.weekly-review]",
  'title = "Weekly review"',
  'skill = "weekly-review"',
  'cadence = "7d"',
  "",
].join("\n");

const SPEC = ".tracker/M1-alpha/01-spec-one.md";

/** A committed legacy repo, linked on `at`: a tracker made by the legacy CLI, a v3 marker without kinds. */
function legacyRepo(at: Host, name: string): string {
  const dir = join(SANDBOX, name);
  mkdirSync(join(dir, ".tracker"), { recursive: true });
  git(at, dir, ["init", "--quiet", "--initial-branch=main"]);
  writeFileSync(join(dir, ".tracker", "00-INDEX.md"), "---\nschema_version: 9\n---\n# Index\n");
  for (const argv of [
    ["add", "milestone", "--name", "Alpha", "--slug", "alpha", "--owner", "dev@example.com"],
    ["add", "spec", "--milestone", "alpha", "--name", "Spec one", "--template", "generic"],
    ["add", "milestone", "--name", "Beta", "--slug", "beta", "--owner", "dev@example.com"],
  ]) {
    const made = darius(at, argv, dir);
    assert.equal(made.code, 0, `${argv.join(" ")}: ${made.stderr}`);
  }
  mkdirSync(join(dir, ".tracker", "worklog"), { recursive: true });
  writeFileSync(join(dir, ".tracker", "worklog", "M1-alpha.md"), "# M1 worklog\n\nA note.\n");
  mkdirSync(join(dir, ".tracker", "archive", "M0-old"), { recursive: true });
  writeFileSync(join(dir, ".tracker", "archive", "M0-old", "summary.md"), "# Old\n");
  writeFileSync(join(dir, ".tracker", "M1-alpha", "diagram.bin"), new Uint8Array([0, 159, 146, 150, 255, 0, 10]));
  writeFileSync(join(dir, ".tracker", "M1-alpha", "check.sh"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(dir, ".tracker", "M1-alpha", "check.sh"), 0o755);
  writeFileSync(join(dir, ".darius.toml"), MARKER.replace("PROJECT", name));
  writeFileSync(join(dir, "README.md"), "# acme\n");
  git(at, dir, ["add", "--all"]);
  git(at, dir, ["commit", "--quiet", "--message", "legacy tracker"]);
  const linked = darius(at, ["link"], dir);
  assert.equal(linked.code, 0, linked.stderr);
  return dir;
}

/** What the read verbs print, to compare before and after the move. */
function readViews(at: Host, dir: string): string[] {
  return [["status"], ["status", "--json"], ["list", "specs", "--json"], ["show", SPEC], ["show", SPEC, "--json"], ["next"]].map((argv) => {
    const result = darius(at, argv, dir);
    assert.equal(result.code, 0, `${argv.join(" ")}: ${result.stderr}`);
    return `${argv.join(" ")}\n${result.stdout}`;
  });
}

test("onboard moves the tracker into the store; every read verb answers the same; a write verb changes only the store", { skip: NO_GIT }, () => {
  const at = host();
  const name = "acme-web";
  const dir = legacyRepo(at, name);
  const sourceHash = treeHash(join(dir, ".tracker"));
  const views = readViews(at, dir);
  const head = git(at, dir, ["rev-parse", "HEAD"]).trim();

  const scan = darius(at, ["onboard", "scan", "--json"], dir);
  assert.equal(scan.code, 0, scan.stdout + scan.stderr);
  const report = JSON.parse(scan.stdout);
  assert.equal(report.tracker, "folder");
  assert.deepEqual(report.git, { repo: true, tracked: true, clean: true, dirty: [] });
  assert.deepEqual(report.blockers, []);

  const moved = darius(at, ["onboard"], dir);
  assert.equal(moved.code, 0, moved.stdout + moved.stderr);
  assert.match(moved.stdout, /^✓ 1 vigils: none in \.tracker\/vigils$/mu);
  assert.match(moved.stdout, /^✓ 2 copy: 8 files, \d+ bytes into .*, every sha256 checked$/mu);
  assert.match(moved.stdout, /^ {2}git add \.darius\.toml \.gitignore$/mu);
  assert.match(moved.stdout, /update darius first, pull, and run darius sync/u);

  // The store tree is byte for byte the old folder, and the checkout holds a link to it.
  const tree = join(at.state, name, "tracker");
  assert.equal(readlinkSync(join(dir, ".tracker")), tree);
  assert.equal(treeHash(tree), sourceHash);
  // The removal is staged; the marker kept every comment and got one line.
  const staged = git(at, dir, ["diff", "--cached", "--name-status"]).trim().split("\n");
  assert.equal(staged.length, 8);
  assert.ok(staged.every((line) => line.startsWith("D\t.tracker/")), staged.join("\n"));
  assert.equal(readFileSync(join(dir, ".darius.toml"), "utf8"), MARKER.replace("PROJECT", name).replace('tz = "Europe/Berlin"\n', 'tz = "Europe/Berlin"\nkinds = ["ritual", "vigil", "milestone"]\n'));
  assert.equal(readFileSync(join(dir, ".gitignore"), "utf8"), "/.tracker\n");
  const ledger = readdirSync(join(at.state, name, "ledger"), { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".jsonl"))
    .flatMap((file) => readFileSync(join(at.state, name, "ledger", file), "utf8").trim().split("\n"))
    .map((line) => JSON.parse(line));
  const cutover = ledger.filter((line) => line.type === "project.cutover");
  assert.equal(cutover.length, 1);
  assert.deepEqual([cutover[0].kinds, cutover[0].source_commit, cutover[0].files], [["vigil", "milestone"], head, 8]);
  assert.equal(ledger.filter((line) => line.type === "tree.put").length, 7, "every file but the derived 00-INDEX.md");

  assert.deepEqual(readViews(at, dir), views);

  git(at, dir, ["add", ".darius.toml", ".gitignore"]);
  git(at, dir, ["commit", "--quiet", "--message", "the store owns the tracker"]);
  assert.equal(git(at, dir, ["status", "--porcelain"]), "");

  const before = readFileSync(join(tree, "M1-alpha", "01-spec-one.md"), "utf8");
  const marked = darius(at, ["mark", SPEC, "0", "--in-progress"], dir);
  assert.equal(marked.code, 0, marked.stderr);
  assert.notEqual(readFileSync(join(tree, "M1-alpha", "01-spec-one.md"), "utf8"), before);
  const open = readFileSync(join(at.state, name, "ledger", readdirSync(join(at.state, name, "ledger"))[0] ?? "", "open.jsonl"), "utf8").trim().split("\n");
  const last = JSON.parse(open.at(-1) ?? "{}");
  assert.deepEqual([last.type, last.path], ["tree.put", "M1-alpha/01-spec-one.md"]);
  assert.equal(git(at, dir, ["status", "--porcelain"]), "", "the checkout stays clean");

  const again = darius(at, ["onboard"], dir);
  assert.equal(again.code, 1);
  assert.match(again.stderr, /already onboarded: the store owns the tracker here/u);
  const rescan = darius(at, ["onboard", "scan"], dir);
  assert.equal(rescan.code, 3, rescan.stdout);
  assert.match(rescan.stdout, /^pending tree changes: none$/mu);
});

test("onboard --dry-run writes nothing to the repo or the store", { skip: NO_GIT }, () => {
  const at = host();
  const dir = legacyRepo(at, "acme-dry");
  const repoBefore = treeHash(dir);
  const stateBefore = treeHash(at.state);
  const dry = darius(at, ["onboard", "--dry-run", "--json"], dir);
  assert.equal(dry.code, 0, dry.stdout + dry.stderr);
  const report = JSON.parse(dry.stdout);
  assert.equal(report.copy.length, 8);
  assert.ok(report.copy.includes("M1-alpha/01-spec-one.md"));
  assert.equal(darius(at, ["onboard", "--dry-run"], dir).code, 0);
  assert.equal(darius(at, ["onboard", "scan"], dir).code, 0);
  assert.equal(treeHash(dir), repoBefore);
  assert.equal(treeHash(at.state), stateBefore);
});

test("onboard refuses a dirty .tracker/, an untracked file, a store that already holds the tree, and no marker", { skip: NO_GIT }, () => {
  const at = host();
  const dir = legacyRepo(at, "acme-refuse");
  const unchanged = (): void => {
    assert.equal(lstatSync(join(dir, ".tracker")).isDirectory(), true);
    assert.doesNotMatch(readFileSync(join(dir, ".darius.toml"), "utf8"), /kinds/u);
  };

  writeFileSync(join(dir, SPEC), "edited\n", { flag: "a" });
  const dirty = darius(at, ["onboard"], dir);
  assert.equal(dirty.code, 1);
  assert.match(dirty.stderr, /\.tracker\/ has uncommitted changes: M \.tracker\/M1-alpha\/01-spec-one\.md\. Commit or remove them first\./u);
  unchanged();
  git(at, dir, ["checkout", "--", SPEC]);

  writeFileSync(join(dir, ".tracker", "M1-alpha", "new.md"), "new\n");
  const untracked = darius(at, ["onboard"], dir);
  assert.equal(untracked.code, 1);
  assert.match(untracked.stderr, /\?\? \.tracker\/M1-alpha\/new\.md/u);
  const scan = darius(at, ["onboard", "scan", "--json"], dir);
  assert.equal(scan.code, 1);
  assert.equal(JSON.parse(scan.stdout).git.clean, false);
  rmSync(join(dir, ".tracker", "M1-alpha", "new.md"));

  // Host-local files may be dirty: the hooks write them all the time.
  writeFileSync(join(dir, ".tracker", ".pending-sync"), "src/a.ts\n");
  writeFileSync(join(dir, ".tracker", "00-INDEX.md"), "regenerated\n");
  assert.equal(darius(at, ["onboard", "scan"], dir).code, 0);

  mkdirSync(join(at.state, "acme-refuse", "tracker"), { recursive: true });
  writeFileSync(join(at.state, "acme-refuse", "tracker", "x.md"), "x\n");
  const onboarded = darius(at, ["onboard"], dir);
  assert.equal(onboarded.code, 1);
  assert.match(onboarded.stderr, /already onboarded: pull the marker commit and run darius sync/u);
  unchanged();

  const bare = join(SANDBOX, "no-marker");
  mkdirSync(bare);
  const none = darius(at, ["onboard"], bare);
  assert.equal(none.code, 1);
  assert.match(none.stderr, /no \.darius\.toml in .* or above it/u);
});

test("onboard refuses an unlinked checkout and a marker that is not v3; --only vigil refuses dirty vigils", { skip: NO_GIT }, () => {
  const at = host();
  const dir = legacyRepo(at, "acme-only");
  const other = host();
  const unlinked = darius(other, ["onboard"], dir);
  assert.equal(unlinked.code, 1);
  assert.match(unlinked.stderr, /this checkout is not linked to acme-only on this host: run darius link here/u);

  mkdirSync(join(dir, ".tracker", "vigils"));
  writeFileSync(join(dir, ".tracker", "vigils", "soak.md"), "---\ntype: vigil\nname: soak\n---\n");
  const vigil = darius(at, ["onboard", "--only", "vigil"], dir);
  assert.equal(vigil.code, 1);
  assert.match(vigil.stderr, /\?\? \.tracker\/vigils\/soak\.md/u);
  const usage = darius(at, ["onboard", "--only", "milestone"], dir);
  assert.equal(usage.code, 2);

  writeFileSync(join(dir, ".darius.toml"), 'v = 2\nproject = "acme-only"\n');
  const v2 = darius(at, ["onboard", "scan"], dir);
  assert.equal(v2.code, 1);
  assert.match(v2.stdout, /\.darius\.toml is v = 2; darius onboard needs v = 3/u);
});

test("withKinds sets or inserts the root kinds line and keeps every other byte", () => {
  const file = "/x/.darius.toml";
  const plain = '# head\nv = 3\nproject = "a"\ntz = "UTC"\n\n# rituals\n[rituals.x]\ntitle = "X"\n';
  assert.equal(withKinds(plain, file, ["ritual", "vigil"]), '# head\nv = 3\nproject = "a"\ntz = "UTC"\nkinds = ["ritual", "vigil"]\n\n# rituals\n[rituals.x]\ntitle = "X"\n');
  const set = 'v = 3\nproject = "a"\nkinds = ["ritual", "vigil"]  # phase 3\ntz = "UTC"\n';
  assert.equal(withKinds(set, file, ["ritual", "vigil", "milestone"]), 'v = 3\nproject = "a"\nkinds = ["ritual", "vigil", "milestone"]  # phase 3\ntz = "UTC"\n');
  const crlf = 'v = 3\r\nproject = "a"\r\ntz = "UTC"\r\n';
  assert.equal(withKinds(crlf, file, ["ritual", "vigil", "milestone"]), 'v = 3\r\nproject = "a"\r\ntz = "UTC"\r\nkinds = ["ritual", "vigil", "milestone"]\r\n');
  assert.equal(existsSync(file), false);
});
