/**
 * `darius tree log|restore` and `darius milestone archive` (0.73.0,
 * src/core/tree-history.ts, src/cli/tree.ts, src/cli/milestone.ts).
 *
 * Each test builds its own checkout and runs the real CLI. A store-mode repo
 * comes from `darius init` in a git repo (the marker then lists milestone);
 * a git-mode repo has a v1 marker and a `.tracker/` folder. The archive and
 * restore round trip runs under both runtimes.
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { initRepo, NO_GIT } from "./helpers/git.ts";

const BIN = join(import.meta.dirname, "..", "bin", "darius");
const SANDBOX = mkdtempSync(join(tmpdir(), "darius-tree-history-"));
after(() => rmSync(SANDBOX, { recursive: true, force: true }));

let repos = 0;

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface Repo {
  dir: string;
  project: string;
  runtime: "node" | "bun";
}

function darius(repo: Repo, argv: string[]): Run {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DARIUS_STATE_DIR: join(SANDBOX, "state"),
    DARIUS_CONFIG_DIR: join(SANDBOX, "config"),
    DARIUS_WHO: "dev@example.com",
    DARIUS_RUNTIME: repo.runtime,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  delete env.DARIUS_PROJECT;
  const result = spawnSync(BIN, argv, { cwd: repo.dir, env, encoding: "utf8", input: "", timeout: 30_000 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function ok(repo: Repo, argv: string[]): string {
  const run = darius(repo, argv);
  assert.equal(run.code, 0, `darius ${argv.join(" ")}: ${run.stderr}${run.stdout}`);
  return run.stdout;
}

/** A store-mode repo with milestone M1-alpha (README and one spec) and its worklog thread open. */
function storeRepo(runtime: Repo["runtime"] = "node"): Repo {
  repos += 1;
  const project = `history-${String(repos)}`;
  const repo: Repo = { dir: join(SANDBOX, project), project, runtime };
  mkdirSync(repo.dir, { recursive: true });
  initRepo(repo.dir);
  writeFileSync(join(repo.dir, "README.md"), "# acme-web\n");
  ok(repo, ["init", "--project", project]);
  ok(repo, ["add", "milestone", "--name", "Alpha", "--slug", "alpha", "--owner", "dev@example.com"]);
  ok(repo, ["add", "spec", "--milestone", "alpha", "--name", "Spec one", "--template", "generic"]);
  ok(repo, ["worklog", "open", "alpha", "--spec", ".tracker/M1-alpha/01-spec-one.md", "--message", "start"]);
  return repo;
}

function tracker(repo: Repo): string {
  return join(repo.dir, ".tracker");
}

function closeThreads(repo: Repo): void {
  const { threads }: { threads: { threadId: string }[] } = JSON.parse(ok(repo, ["worklog", "list", "--active", "--json"]));
  for (const thread of threads) ok(repo, ["worklog", "close", thread.threadId, "--status", "done"]);
}

function writeArchiveDoc(repo: Repo, text = "---\nname: Alpha\nslug: M1-alpha\narchived: 2026-10-08\n---\n# Alpha\n"): void {
  mkdirSync(join(tracker(repo), "archive"), { recursive: true });
  writeFileSync(join(tracker(repo), "archive", "M1-alpha.md"), text);
}

/** Every file under `dir`: path and bytes, in one sha256. */
function dirHash(dir: string): string {
  const hash = createHash("sha256");
  const walk = (at: string): void => {
    for (const name of readdirSync(at).toSorted()) {
      const path = join(at, name);
      hash.update(`${relative(dir, path)}\0`);
      if (statSync(path).isDirectory()) walk(path);
      else hash.update(readFileSync(path));
    }
  };
  if (existsSync(dir)) walk(dir);
  return hash.digest("hex");
}

/** The ledger line fields these tests read. */
interface LedgerRow {
  type: string;
  path?: string;
  at?: string;
  body_sha?: string;
  prev_sha?: string | null;
}

function ledgerLines(repo: Repo): LedgerRow[] {
  const root = join(SANDBOX, "state", repo.project, "ledger");
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".jsonl"))
    .flatMap((file) => readFileSync(join(root, file), "utf8").trim().split("\n"))
    .filter((line) => line !== "")
    .map((line): LedgerRow => JSON.parse(line));
}

function treeLinesOf(repo: Repo, type: string, path: string): LedgerRow[] {
  return ledgerLines(repo).filter((line) => line.type === type && line.path === path);
}

/** Records local edits in the store: any tracker verb captures the tree when it ends. */
function capture(repo: Repo): void {
  ok(repo, ["index", "--rebuild"]);
}

interface LogLine {
  id: string;
  type: string;
  path: string;
  sha: string;
}

test("tree log lists the lines of a file and of a folder, newest first", { skip: NO_GIT }, () => {
  const repo = storeRepo();
  const spec = join(tracker(repo), "M1-alpha", "01-spec-one.md");
  writeFileSync(spec, `${readFileSync(spec, "utf8")}\nmore\n`);
  capture(repo);

  const file: { folder: boolean; lines: LogLine[] } = JSON.parse(ok(repo, ["tree", "log", ".tracker/M1-alpha/01-spec-one.md", "--json"]));
  assert.equal(file.folder, false);
  assert.deepEqual(file.lines.map((line) => line.type), ["tree.put", "tree.put"]);
  assert.ok(file.lines[0] !== undefined && file.lines[1] !== undefined && file.lines[0].id > file.lines[1].id);

  const folder: { folder: boolean; lines: LogLine[] } = JSON.parse(ok(repo, ["tree", "log", ".tracker/M1-alpha/", "--json"]));
  assert.equal(folder.folder, true);
  assert.deepEqual([...new Set(folder.lines.map((line) => line.path))].toSorted(), ["M1-alpha/00-README.md", "M1-alpha/01-spec-one.md"]);
  const text = ok(repo, ["tree", "log", "M1-alpha"]);
  assert.match(text, /put .* M1-alpha\/00-README\.md/u);
});

test("tree restore brings back a deleted file and records a tree.put", { skip: NO_GIT }, () => {
  const repo = storeRepo();
  const spec = join(tracker(repo), "M1-alpha", "01-spec-one.md");
  const bytes = readFileSync(spec);
  unlinkSync(spec);
  capture(repo);
  assert.equal(treeLinesOf(repo, "tree.removed", "M1-alpha/01-spec-one.md").length, 1);
  const puts = treeLinesOf(repo, "tree.put", "M1-alpha/01-spec-one.md").length;

  ok(repo, ["tree", "restore", ".tracker/M1-alpha/01-spec-one.md"]);
  assert.deepEqual(readFileSync(spec), bytes);
  const written = treeLinesOf(repo, "tree.put", "M1-alpha/01-spec-one.md");
  assert.equal(written.length, puts + 1);
  assert.equal(written.at(-1)?.body_sha, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(written.at(-1)?.prev_sha, null);
});

test("tree restore of a folder brings back every file of the last delete, not older deletes", { skip: NO_GIT }, () => {
  const repo = storeRepo();
  const folder = join(tracker(repo), "M1-alpha");
  writeFileSync(join(folder, "02-old.md"), "old\n");
  capture(repo);
  unlinkSync(join(folder, "02-old.md"));
  capture(repo);
  const before = dirHash(folder);
  rmSync(folder, { recursive: true });
  capture(repo);

  ok(repo, ["tree", "restore", ".tracker/M1-alpha/"]);
  assert.equal(dirHash(folder), before);
  assert.equal(existsSync(join(folder, "02-old.md")), false, "a file removed by an earlier delete stays removed");
});

test("tree restore refuses a differing file without --force, and --dry-run writes nothing", { skip: NO_GIT }, () => {
  const repo = storeRepo();
  const spec = join(tracker(repo), "M1-alpha", "01-spec-one.md");
  const bytes = readFileSync(spec);
  unlinkSync(spec);
  capture(repo);
  writeFileSync(spec, "a new version\n");
  capture(repo);

  const ledger = ledgerLines(repo).length;
  const dry = darius(repo, ["tree", "restore", ".tracker/M1-alpha/01-spec-one.md", "--dry-run", "--json"]);
  assert.equal(dry.code, 1, "the dry run reports the refusal");
  const plan: { steps: { state: string }[]; refusal: string } = JSON.parse(dry.stdout);
  assert.deepEqual(plan.steps.map((step) => step.state), ["differs"]);
  assert.match(plan.refusal, /--force/u);
  assert.equal(readFileSync(spec, "utf8"), "a new version\n");
  assert.equal(ledgerLines(repo).length, ledger, "a dry run writes no ledger line");

  const refused = darius(repo, ["tree", "restore", ".tracker/M1-alpha/01-spec-one.md"]);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /another version is in the working copy/u);
  assert.equal(readFileSync(spec, "utf8"), "a new version\n");

  ok(repo, ["tree", "restore", ".tracker/M1-alpha/01-spec-one.md", "--force"]);
  assert.deepEqual(readFileSync(spec), bytes);
});

test("tree restore --dry-run of a delete lists the plan and writes nothing", { skip: NO_GIT }, () => {
  const repo = storeRepo();
  const folder = join(tracker(repo), "M1-alpha");
  rmSync(folder, { recursive: true });
  capture(repo);
  const ledger = ledgerLines(repo).length;
  const out = ok(repo, ["tree", "restore", ".tracker/M1-alpha/", "--dry-run"]);
  assert.match(out, /restore .*\.tracker\/M1-alpha\/00-README\.md/u);
  assert.equal(existsSync(folder), false);
  assert.equal(ledgerLines(repo).length, ledger);
});

test("tree restore --at takes a blob sha or a ledger id", { skip: NO_GIT }, () => {
  const repo = storeRepo();
  const spec = join(tracker(repo), "M1-alpha", "01-spec-one.md");
  const first = readFileSync(spec);
  writeFileSync(spec, "second\n");
  capture(repo);
  const logged: { lines: LogLine[] } = JSON.parse(ok(repo, ["tree", "log", ".tracker/M1-alpha/01-spec-one.md", "--json"]));
  const log = logged.lines;
  const oldest = log.at(-1);
  assert.ok(oldest !== undefined);

  ok(repo, ["tree", "restore", ".tracker/M1-alpha/01-spec-one.md", "--at", oldest.sha.slice(0, 12), "--force"]);
  assert.deepEqual(readFileSync(spec), first);
  writeFileSync(spec, "third\n");
  capture(repo);
  ok(repo, ["tree", "restore", ".tracker/M1-alpha/", "--at", oldest.id, "--force"]);
  assert.deepEqual(readFileSync(spec), first);
  assert.equal(darius(repo, ["tree", "restore", ".tracker/M1-alpha/", "--at", oldest.sha.slice(0, 12)]).code, 2, "a sha names one file");
});

test("milestone archive refuses without an archive doc and while a thread is open", { skip: NO_GIT }, () => {
  const repo = storeRepo();
  const first = darius(repo, ["milestone", "archive", "alpha", "--json"]);
  assert.equal(first.code, 1);
  const result: { outcome: string; checks: { name: string; ok: boolean; detail: string }[] } = JSON.parse(first.stdout);
  assert.equal(result.outcome, "refused");
  assert.equal(result.checks.find((check) => check.name === "archive doc")?.ok, false);
  const threads = result.checks.find((check) => check.name === "open threads");
  assert.equal(threads?.ok, false);
  assert.match(threads?.detail ?? "", /alpha\.md/u);

  writeArchiveDoc(repo, "");
  const empty = darius(repo, ["milestone", "archive", "M1-alpha"]);
  assert.equal(empty.code, 1);
  assert.match(empty.stdout, /archive\/M1-alpha\.md is empty/u);

  writeArchiveDoc(repo);
  const open = darius(repo, ["milestone", "archive", "M1"]);
  assert.equal(open.code, 1);
  assert.match(open.stdout, /refused {2}open threads: 1 open/u);
  assert.ok(existsSync(join(tracker(repo), "M1-alpha")));
});

test("milestone archive in store mode: --dry-run writes nothing, the run records tree.removed, tree restore brings it back byte for byte", { skip: NO_GIT }, async (t) => {
  for (const runtime of ["node", "bun"] as const) {
    await t.test(runtime, () => {
      const repo = storeRepo(runtime);
      closeThreads(repo);
      writeArchiveDoc(repo);
      capture(repo);
      const folder = join(tracker(repo), "M1-alpha");
      const before = dirHash(folder);
      const state = dirHash(join(SANDBOX, "state", repo.project, "ledger"));

      const dry: { outcome: string; files: string[]; undo: string } = JSON.parse(ok(repo, ["milestone", "archive", "alpha", "--dry-run", "--json"]));
      assert.equal(dry.outcome, "dry-run");
      assert.deepEqual(dry.files, [".tracker/M1-alpha/00-README.md", ".tracker/M1-alpha/01-spec-one.md"]);
      assert.equal(dry.undo, "darius tree restore .tracker/M1-alpha/");
      assert.equal(dirHash(folder), before);
      assert.equal(dirHash(join(SANDBOX, "state", repo.project, "ledger")), state, "a dry run writes no ledger line");

      const out = ok(repo, ["milestone", "archive", "alpha"]);
      assert.match(out, /undo: darius tree restore \.tracker\/M1-alpha\//u);
      assert.equal(existsSync(folder), false);
      const removed = ledgerLines(repo).filter((line) => line.type === "tree.removed" && String(line.path).startsWith("M1-alpha/"));
      assert.equal(removed.length, 2);
      assert.equal(new Set(removed.map((line) => line.at)).size, 1, "one delete, one time");
      assert.doesNotMatch(readFileSync(join(tracker(repo), "00-INDEX.md"), "utf8"), /\| *M1-alpha/u);

      ok(repo, ["tree", "restore", ".tracker/M1-alpha/"]);
      assert.equal(dirHash(folder), before);
    });
  }
});

test("milestone archive --keep checks and removes nothing", { skip: NO_GIT }, () => {
  const repo = storeRepo();
  closeThreads(repo);
  writeArchiveDoc(repo);
  const out: { outcome: string; removed: string[] } = JSON.parse(ok(repo, ["milestone", "archive", "alpha", "--keep", "--json"]));
  assert.equal(out.outcome, "kept");
  assert.deepEqual(out.removed, []);
  assert.ok(existsSync(join(tracker(repo), "M1-alpha", "00-README.md")));
});

test("git mode: milestone archive runs the checks, deletes nothing and prints the git command; the tree verbs refuse", () => {
  repos += 1;
  const repo: Repo = { dir: join(SANDBOX, `legacy-${String(repos)}`), project: `legacy-${String(repos)}`, runtime: "node" };
  mkdirSync(join(repo.dir, ".tracker", "M1-alpha"), { recursive: true });
  writeFileSync(join(repo.dir, ".darius.toml"), `project = "${repo.project}"\n`);
  writeFileSync(join(repo.dir, ".tracker", "M1-alpha", "00-README.md"), "# Alpha\n");
  writeFileSync(join(repo.dir, ".tracker", "M1-alpha", "01-one.md"), "# One\n");

  for (const argv of [["tree", "log", ".tracker/M1-alpha/"], ["tree", "restore", ".tracker/M1-alpha/"]]) {
    const run = darius(repo, argv);
    assert.equal(run.code, 1, argv.join(" "));
    assert.match(run.stderr, /is in git/u);
  }

  const missing = darius(repo, ["milestone", "archive", "alpha", "--json"]);
  assert.equal(missing.code, 1, "the same checks refuse in git mode");
  writeArchiveDoc(repo);
  const before = dirHash(join(repo.dir, ".tracker"));

  const dry = ok(repo, ["milestone", "archive", "alpha", "--dry-run"]);
  assert.match(dry, /tracker in git/u);
  const result: { outcome: string; action: string; command: string; undo: string; removed: string[] } = JSON.parse(ok(repo, ["milestone", "archive", "alpha", "--json"]));
  assert.equal(result.outcome, "ready");
  assert.equal(result.action, "print");
  assert.equal(result.command, "git rm -r -q .tracker/M1-alpha/");
  assert.equal(result.undo, "git checkout HEAD -- .tracker/M1-alpha/");
  assert.deepEqual(result.removed, []);
  const out = ok(repo, ["milestone", "archive", "alpha"]);
  assert.match(out, /run: git rm -r -q \.tracker\/M1-alpha\//u);
  assert.equal(dirHash(join(repo.dir, ".tracker")), before, "darius writes nothing to a tracker in git");
});

test("milestone archive: usage errors exit 2, an unknown milestone exits 1", { skip: NO_GIT }, () => {
  const repo = storeRepo();
  assert.equal(darius(repo, ["milestone", "archive"]).code, 2);
  assert.equal(darius(repo, ["milestone", "close", "alpha"]).code, 2);
  assert.equal(darius(repo, ["tree", "restore"]).code, 2);
  const missing = darius(repo, ["milestone", "archive", "beta"]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /no active milestone beta/u);
});
