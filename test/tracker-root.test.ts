/**
 * Store mode has no `.tracker` link (0.78.0, src/core/tracker-root.ts).
 *
 * The resolver, the migration of an old link (only a link into this
 * project's own store tree goes), the path forms a verb takes, the doctor
 * notes, the hooks without a link, and a whole Work Loop in a checkout that
 * never holds a `.tracker` path. Every test uses its own temp dirs; the CLI
 * runs with its own state and config dirs.
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { commitAll, initRepo, NO_GIT } from "./helpers/git.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-tracker-root-"));
after(() => rmSync(SANDBOX, { recursive: true, force: true }));
// The module reads the state dir from the env when it runs: point it here first.
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
delete process.env.DARIUS_PROJECT;

const { doctorNotes, removeOwnTreeLink, resolveTrackerRoot, resolveTreeArg, treeLinkState, treeRelative } = await import("../src/core/tracker-root.ts");

const BIN = join(import.meta.dirname, "..", "bin", "darius");
let dirs = 0;

/** A checkout and its store tree. */
interface StoreCheckout {
  checkout: string;
  tree: string;
}

/** A dir with a store-mode marker for `project`, and the store tree. */
function storeCheckout(project: string): StoreCheckout {
  dirs += 1;
  const checkout = join(SANDBOX, `checkout-${String(dirs)}`);
  mkdirSync(checkout, { recursive: true });
  writeFileSync(join(checkout, ".darius.toml"), `v = 3\nproject = "${project}"\ntz = "UTC"\nkinds = ["ritual", "vigil", "milestone"]\n`);
  const tree = join(SANDBOX, "state", project, "tracker");
  mkdirSync(join(tree, "M1-alpha"), { recursive: true });
  writeFileSync(join(tree, "M1-alpha", "01-one.md"), "# One\n");
  return { checkout, tree };
}

test("resolveTrackerRoot: store mode from the marker, git mode from a folder, none", () => {
  const { checkout, tree } = storeCheckout("rt-store");
  mkdirSync(join(checkout, "deep"));
  assert.deepEqual(resolveTrackerRoot(join(checkout, "deep")), { mode: "store", trackerRoot: tree, checkout, project: "rt-store" });

  const gitMode = join(SANDBOX, "gitmode");
  mkdirSync(join(gitMode, ".tracker"), { recursive: true });
  assert.deepEqual(resolveTrackerRoot(gitMode), { mode: "git", trackerRoot: join(gitMode, ".tracker"), checkout: gitMode, project: null });

  const bare = join(SANDBOX, "bare");
  mkdirSync(bare);
  assert.equal(resolveTrackerRoot(bare).mode, "none");
});

test("migration removes only an own link: a real folder and a foreign link stay", () => {
  const own = storeCheckout("rt-own");
  symlinkSync(own.tree, join(own.checkout, ".tracker"));
  assert.equal(treeLinkState(own.checkout, own.tree).kind, "own-link");
  const notice = removeOwnTreeLink(own.checkout);
  assert.match(notice ?? "", /^darius: removed the old \.tracker link in .+; the tracker tree is in .+ \(darius root\)$/u);
  assert.equal(lstatSync(join(own.checkout, ".tracker"), { throwIfNoEntry: false }), undefined);
  assert.equal(readFileSync(join(own.tree, "M1-alpha", "01-one.md"), "utf8"), "# One\n", "the tree itself is untouched");
  assert.equal(removeOwnTreeLink(own.checkout), null, "nothing to do the second time");

  const real = storeCheckout("rt-real");
  mkdirSync(join(real.checkout, ".tracker", "M1-x"), { recursive: true });
  writeFileSync(join(real.checkout, ".tracker", "M1-x", "01.md"), "real data\n");
  assert.equal(treeLinkState(real.checkout, real.tree).kind, "real");
  assert.equal(removeOwnTreeLink(real.checkout), null);
  assert.equal(readFileSync(join(real.checkout, ".tracker", "M1-x", "01.md"), "utf8"), "real data\n", "a real folder is never removed");

  const foreign = storeCheckout("rt-foreign");
  const elsewhere = join(SANDBOX, "elsewhere");
  mkdirSync(elsewhere);
  symlinkSync(elsewhere, join(foreign.checkout, ".tracker"));
  assert.equal(treeLinkState(foreign.checkout, foreign.tree).kind, "foreign-link");
  assert.equal(removeOwnTreeLink(foreign.checkout), null);
  assert.equal(readlinkSync(join(foreign.checkout, ".tracker")), elsewhere, "a link elsewhere is never removed");

  // Another project's store tree is foreign too.
  const other = storeCheckout("rt-other");
  symlinkSync(own.tree, join(other.checkout, ".tracker"));
  assert.equal(removeOwnTreeLink(other.checkout), null);
  assert.equal(lstatSync(join(other.checkout, ".tracker")).isSymbolicLink(), true);

  // Git mode: a link is not darius's to remove.
  const gitMode = join(SANDBOX, "git-linked");
  mkdirSync(gitMode);
  writeFileSync(join(gitMode, ".darius.toml"), 'v = 2\nproject = "rt-git"\n');
  symlinkSync(own.tree, join(gitMode, ".tracker"));
  assert.equal(removeOwnTreeLink(gitMode), null);
  assert.equal(lstatSync(join(gitMode, ".tracker")).isSymbolicLink(), true);
});

test("path forms: tracker-relative, the old .tracker/ form, and absolute store or checkout paths name one file", () => {
  const { checkout, tree } = storeCheckout("rt-paths");
  const where = { trackerRoot: tree, checkout };
  const file = join(tree, "M1-alpha", "01-one.md");
  for (const form of ["M1-alpha/01-one.md", "./M1-alpha/01-one.md", ".tracker/M1-alpha/01-one.md", "./.tracker/M1-alpha/01-one.md", file, join(checkout, ".tracker", "M1-alpha", "01-one.md")]) {
    assert.equal(treeRelative(form, where), "M1-alpha/01-one.md", form);
    assert.equal(resolveTreeArg(form, checkout), file, form);
  }
  mkdirSync(join(checkout, "src"));
  assert.equal(resolveTreeArg("../.tracker/M1-alpha/01-one.md", join(checkout, "src")), file, "from a subdirectory");
  assert.equal(treeRelative(".tracker", where), "");
  assert.equal(treeRelative("/somewhere/else.md", where), null);
  // A checkout file keeps its meaning.
  writeFileSync(join(checkout, "README.md"), "# readme\n");
  assert.equal(resolveTreeArg("README.md", checkout), join(checkout, "README.md"));

  // Git mode: relative to the cwd, as always.
  const gitMode = join(SANDBOX, "git-paths");
  mkdirSync(join(gitMode, ".tracker"), { recursive: true });
  assert.equal(resolveTreeArg(".tracker/M1-x/01.md", gitMode), join(gitMode, ".tracker", "M1-x", "01.md"));
  assert.equal(resolveTreeArg("M1-x/01.md", gitMode), join(gitMode, "M1-x", "01.md"));
});

test("doctor notes: a stale /.tracker line and a leftover .tracker in store mode; git mode is deprecated", () => {
  const { checkout } = storeCheckout("rt-doctor");
  assert.deepEqual(doctorNotes(checkout), []);
  writeFileSync(join(checkout, ".gitignore"), "node_modules\n/.tracker\n");
  mkdirSync(join(checkout, ".tracker"));
  const notes = doctorNotes(checkout);
  assert.equal(notes.length, 2);
  assert.match(notes[0] ?? "", /^NOTE: \.gitignore has a \/\.tracker line\. darius no longer makes a \.tracker link, so you can remove the line\.$/u);
  assert.match(notes[1] ?? "", /\.tracker is in this checkout\. darius does not read it/u);
  assert.equal(readFileSync(join(checkout, ".gitignore"), "utf8"), "node_modules\n/.tracker\n", "darius never edits .gitignore");

  const gitMode = join(SANDBOX, "git-doctor");
  mkdirSync(join(gitMode, ".tracker"), { recursive: true });
  assert.deepEqual(doctorNotes(gitMode), [
    "NOTE: this tracker is in git (.tracker/). Git mode is deprecated. Run darius onboard scan, then darius onboard, to move it into the darius store.",
  ]);
});

// --- the CLI -----------------------------------------------------------------

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface Host {
  home: string;
  state: string;
  env: NodeJS.ProcessEnv;
}

function host(): Host {
  dirs += 1;
  const home = join(SANDBOX, `host-${String(dirs)}`);
  mkdirSync(join(home, "config"), { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    DARIUS_STATE_DIR: join(home, "state"),
    DARIUS_CONFIG_DIR: join(home, "config"),
    DARIUS_WHO: "dev@example.com",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  for (const name of ["DARIUS_PROJECT", "DARIUS_TRACKER_ROOT", "DARIUS_CHECKOUT_ROOT", "CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID"]) delete env[name];
  return { home, state: join(home, "state"), env };
}

function darius(at: Host, argv: string[], cwd: string, input = "", runtime: "node" | "bun" = "node"): Run {
  const result = spawnSync(BIN, argv, { cwd, env: { ...at.env, DARIUS_RUNTIME: runtime }, encoding: "utf8", input, timeout: 60_000 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function ok(at: Host, argv: string[], cwd: string, input = ""): string {
  const run = darius(at, argv, cwd, input);
  assert.equal(run.code, 0, `darius ${argv.join(" ")}: ${run.stdout}${run.stderr}`);
  return run.stdout;
}

/** A git repo set up by `darius init`: store mode. */
function initRepoAt(at: Host, name: string): string {
  const dir = join(at.home, name);
  mkdirSync(dir, { recursive: true });
  initRepo(dir);
  writeFileSync(join(dir, "README.md"), "# repo\n");
  ok(at, ["init", "--project", name], dir);
  commitAll(dir, "darius init");
  return dir;
}

test("the next verb removes an own link with one stderr line; --json stdout stays pure; root never migrates", { skip: NO_GIT }, () => {
  const at = host();
  const dir = initRepoAt(at, "mig-cli");
  const tree = join(at.state, "mig-cli", "tracker");
  symlinkSync(tree, join(dir, ".tracker"));
  assert.equal(JSON.parse(ok(at, ["root", "--json"], dir)).linked, true);
  assert.equal(lstatSync(join(dir, ".tracker")).isSymbolicLink(), true, "root reads only");

  const status = darius(at, ["status", "--json"], dir);
  assert.equal(status.code, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).projectName !== undefined, true, "stdout is the verb's JSON only");
  assert.equal(status.stderr.match(/removed the old \.tracker link/gu)?.length, 1, status.stderr);
  assert.equal(existsSync(join(dir, ".tracker")), false);
  assert.doesNotMatch(darius(at, ["status"], dir).stderr, /removed the old/u, "once");

  // A foreign link and a real folder survive any verb.
  const elsewhere = join(at.home, "elsewhere");
  mkdirSync(elsewhere);
  symlinkSync(elsewhere, join(dir, ".tracker"));
  ok(at, ["status"], dir);
  assert.equal(readlinkSync(join(dir, ".tracker")), elsewhere);
  rmSync(join(dir, ".tracker"));
  mkdirSync(join(dir, ".tracker"));
  writeFileSync(join(dir, ".tracker", "keep.md"), "keep\n");
  ok(at, ["list", "specs", "--json"], dir);
  assert.equal(readFileSync(join(dir, ".tracker", "keep.md"), "utf8"), "keep\n");
  const doctor = darius(at, ["doctor"], dir);
  assert.match(doctor.stdout, /## Tracker location/u);
  assert.match(doctor.stdout, /\.tracker is in this checkout\. darius does not read it/u);
});

/** A checkout, its store tree, and the tracker-relative path of its one spec. */
interface WorkRepo {
  dir: string;
  tree: string;
  spec: string;
}

/** A store-mode repo with milestone alpha and one spec whose one task is real. */
function workRepo(at: Host, name: string): WorkRepo {
  const dir = initRepoAt(at, name);
  ok(at, ["add", "milestone", "--name", "Alpha", "--slug", "alpha", "--owner", "dev@example.com"], dir);
  ok(at, ["add", "spec", "--milestone", "alpha", "--name", "Spec one", "--template", "generic"], dir);
  const tree = join(at.state, name, "tracker");
  const spec = "M1-alpha/01-spec-one.md";
  writeFileSync(
    join(tree, spec),
    [
      "---",
      "updated: 2026-10-08",
      "depends_on: []",
      "agent: unassigned",
      "template: generic",
      "---",
      "",
      "# Spec one",
      "",
      "## Goal",
      "",
      "Create `out.txt`.",
      "",
      "## Ground Truth",
      "",
      "The repo has README.md only.",
      "",
      "## Verification Checklist",
      "",
      "- [ ] Create `out.txt`",
      "  - Command: `test -f out.txt`",
      "  - Expected: `exit 0`",
      "",
    ].join("\n"),
  );
  ok(at, ["index", "--rebuild"], dir);
  return { dir, tree, spec };
}

test("a whole Work Loop in a checkout with no .tracker: open, mark, verify in the checkout, set-stage, counsel-gate, next", { skip: NO_GIT }, () => {
  const at = host();
  const { dir, tree, spec } = workRepo(at, "flow");
  const absSpec = join(tree, spec);

  const listed: { path: string; absPath: string }[] = JSON.parse(ok(at, ["list", "specs", "--json"], dir));
  assert.deepEqual(listed.map((entry) => [entry.path, entry.absPath]), [[spec, absSpec]]);
  for (const form of [spec, `.tracker/${spec}`, absSpec]) {
    const shown = JSON.parse(ok(at, ["show", form, "--json"], dir));
    assert.deepEqual([shown.path, shown.absPath], [spec, absSpec], form);
  }

  const next = JSON.parse(ok(at, ["next", "--json"], dir));
  assert.deepEqual([next.status, next.spec, next.absPath], ["task", spec, absSpec]);

  const thread = ok(at, ["worklog", "open", "alpha", "--spec", `.tracker/${spec}`, "--message", "start", "--session", "s1"], dir).trim();
  assert.match(thread, /alpha$/u);
  // 0.78.1: the thread was opened with the old form; the listing shows it tracker-relative.
  const listedThreads: { threads: { threadId: string; specPath: string }[] } = JSON.parse(ok(at, ["worklog", "list", "--json"], dir));
  assert.deepEqual(listedThreads.threads.map((entry) => [entry.threadId, entry.specPath]), [[thread, spec]]);
  ok(at, ["mark", `.tracker/${spec}`, "0", "--in-progress"], dir);
  assert.match(readFileSync(absSpec, "utf8"), /- \[~\] Create `out\.txt`/u);
  ok(at, ["worklog", "dispatch", thread, "--agent", "general-purpose", "--reason", "test", "--session", "s1"], dir);

  // The Command runs in the checkout, not in the store.
  writeFileSync(join(dir, "out.txt"), "hello\n");
  ok(at, ["verify-item", spec, "0"], dir);
  assert.match(readFileSync(absSpec, "utf8"), /- \[x\] Create `out\.txt`/u);
  ok(at, ["worklog", "append", thread, "--section", "Artifacts", "--message", "out.txt"], dir);
  ok(at, ["worklog", "set-stage", thread, "verified"], dir);
  const debts: { path: string; source: string }[] = JSON.parse(ok(at, ["uncommitted-verified", "--json"], dir));
  assert.deepEqual(debts.map((debt) => [debt.path, debt.source]), [[spec, "thread"]]);

  // The verification ledger keeps the `.tracker/...` key, so old lines still match.
  const ledger = readFileSync(join(tree, ".verification-log.jsonl"), "utf8");
  assert.match(ledger, /"spec":"\.tracker\/M1-alpha\/01-spec-one\.md"/u);

  // counsel-gate reads a transcript in the tree and stamps the spec.
  mkdirSync(join(tree, "_counsel"), { recursive: true });
  const items = Object.fromEntries(["data-loss", "irreversible", "hidden-scope", "missing-test", "rollback"].map((name) => [name, { verdict: "ok", reason: `${name} checked` }]));
  writeFileSync(join(tree, "_counsel", "spec-one.md"), `# Review\n\n\`\`\`darius-review\n${JSON.stringify({ reviewer: "opus", items })}\n\`\`\`\n`);
  const gate = JSON.parse(ok(at, ["counsel-gate", "_counsel/spec-one.md", "--spec", spec, "--json"], dir));
  assert.equal(gate.status, "ready", JSON.stringify(gate));
  assert.match(readFileSync(absSpec, "utf8"), /^counsel_transcript: _counsel\/spec-one\.md$/mu);

  assert.equal(JSON.parse(ok(at, ["next", "--json"], dir)).status, "complete");
  assert.equal(JSON.parse(ok(at, ["root", "--json"], dir)).linked, false);
  assert.equal(existsSync(join(dir, ".tracker")), false, "no verb made a .tracker path");
  assert.equal(existsSync(join(dir, ".gitignore")), false, "and no .gitignore");
});

test("the hooks find the store tree without a link: hook-stop blocks, hook-drift logs into the tree", { skip: NO_GIT }, () => {
  const at = host();
  const { dir, tree } = workRepo(at, "hooks");
  ok(at, ["worklog", "open", "alpha", "--stage", "planned", "--session", "sess-1", "--message", "start"], dir);
  for (const runtime of ["node", "bun"] as const) {
    const stop = darius(at, ["hook-stop"], dir, JSON.stringify({ hook_event_name: "Stop", session_id: "sess-1", cwd: dir }), runtime);
    assert.equal(stop.code, 0, stop.stderr);
    assert.equal(JSON.parse(stop.stdout).decision, "block", runtime);
  }

  const drift = darius(at, ["hook-drift"], dir, JSON.stringify({ hook_event_name: "PostToolUse", tool_input: { file_path: join(dir, "out.txt") } }));
  assert.equal(drift.code, 0, drift.stderr);
  assert.equal(readFileSync(join(tree, ".pending-sync"), "utf8"), "out.txt\n");
  // An edit inside the tree is tracker work, not drift.
  darius(at, ["hook-drift"], dir, JSON.stringify({ tool_input: { file_path: join(tree, "M1-alpha", "01-spec-one.md") } }));
  assert.equal(readFileSync(join(tree, ".pending-sync"), "utf8"), "out.txt\n");
  assert.equal(existsSync(join(dir, ".tracker")), false);

  // A payload cwd outside the checkout does not see this tree.
  const elsewhere = join(at.home, "elsewhere");
  mkdirSync(elsewhere);
  const outside = darius(at, ["hook-stop"], dir, JSON.stringify({ hook_event_name: "Stop", session_id: "sess-1", cwd: elsewhere }));
  assert.equal(outside.stdout, "");
  assert.deepEqual(readdirSync(elsewhere), []);
});
