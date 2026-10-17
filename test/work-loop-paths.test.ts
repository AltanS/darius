/**
 * One path resolver for the Work Loop verbs (0.100.3).
 *
 * Real transcripts showed agents running `darius show M2-x/02-y.md` in a
 * git-mode repo and getting `file not found: <cwd>/M2-x/02-y.md`, because the
 * old resolver read a git-mode path from the cwd only. Now every verb that
 * takes a spec path accepts the tracker-relative form, the `.tracker/` form,
 * an absolute path inside the tree and a bare unambiguous file name, in both
 * modes, and every "not found" names the tracker-relative form and the tracker
 * root. Every case runs in its own sandbox: never the real store.
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { NO_GIT } from "./helpers/git.ts";
import { darius, makeHost, makeWorkRepo, ok, removeHost, type WorkRepo } from "./helpers/work-repo.ts";

const host = makeHost("darius-wl-paths");
after(() => removeHost(host));

const MODES = ["store", "git"] as const;
const repos = new Map<string, WorkRepo>();

function repoOf(mode: "store" | "git"): WorkRepo {
  const known = repos.get(mode);
  if (known !== undefined) return known;
  const made = makeWorkRepo(host, mode, `paths-${mode}`);
  repos.set(mode, made);
  return made;
}

/** The forms of one spec every verb must accept. */
function forms(repo: WorkRepo, spec: string, bare: string | null): string[] {
  const list = [spec, `./${spec}`, `.tracker/${spec}`, join(repo.tree, spec)];
  if (bare !== null) list.push(bare);
  return list;
}

for (const mode of MODES) {
  test(`${mode} mode: show, spec check, verify and verify-item take every path form`, { skip: NO_GIT }, () => {
    const repo = repoOf(mode);
    mkdirSync(join(repo.dir, "sub"), { recursive: true });
    for (const cwd of [repo.dir, join(repo.dir, "sub")]) {
      for (const form of forms(repo, repo.alpha2, "02-spec-two.md")) {
        const label = `${mode} ${form} from ${cwd === repo.dir ? "root" : "subdir"}`;
        assert.match(ok(host, ["show", form], cwd), /^Title:  Spec two$/mu, label);
        assert.match(ok(host, ["spec", "check", form], cwd), /^PASS /u, label);
        assert.match(ok(host, ["verify", form, "--dry-run"], cwd), /Create `out\.txt`/u, label);
        assert.match(ok(host, ["verify-item", form, "0", "--dry-run"], cwd), /Create `out\.txt`/u, label);
      }
    }
  });

  test(`${mode} mode: mark takes the tracker-relative form and the bare name`, { skip: NO_GIT }, () => {
    const repo = repoOf(mode);
    for (const form of [repo.alpha2, "02-spec-two.md", `.tracker/${repo.alpha2}`]) {
      assert.match(ok(host, ["mark", form, "0", "--in-progress"], repo.dir), /marked as in-progress/u, form);
      ok(host, ["mark", form, "0", "--pending"], repo.dir);
    }
  });

  test(`${mode} mode: a bare name held by two milestones is refused and lists both`, { skip: NO_GIT }, () => {
    const repo = repoOf(mode);
    for (const argv of [["show", "01-spec-one.md"], ["spec", "check", "01-spec-one.md"], ["verify-item", "01-spec-one.md", "0", "--dry-run"], ["mark", "01-spec-one.md", "0", "--pending"]]) {
      const run = darius(host, argv, repo.dir);
      assert.equal(run.code, 1, argv.join(" "));
      assert.match(run.stderr, /ambiguous: 01-spec-one\.md matches M1-alpha\/01-spec-one\.md, M2-beta\/01-spec-one\.md/u, argv.join(" "));
      assert.match(run.stderr, /tracker root /u);
    }
    if (mode === "store") assert.equal(existsSync(join(repo.dir, ".tracker")), false, "no verb made a .tracker path in a store-mode checkout");
  });

  test(`${mode} mode: a missing spec names the tracker-relative form, the tracker root and the next command`, { skip: NO_GIT }, () => {
    const repo = repoOf(mode);
    const expected = `spec not found: M1-alpha/nope.md (tracker root ${repo.tree}; paths are tracker-relative, e.g. M1-x/01-y.md)\n  next: darius list specs`;
    for (const argv of [["verify", "M1-alpha/nope.md"], ["verify-item", ".tracker/M1-alpha/nope.md", "0"], ["mark", "M1-alpha/nope.md", "0", "--pending"], ["spec", "check", "M1-alpha/nope.md"], ["claim", "M1-alpha/nope.md", "--session", "s1"]]) {
      const run = darius(host, argv, repo.dir);
      assert.equal(run.code, 1, argv.join(" "));
      assert.ok(run.stderr.includes(expected), `${argv.join(" ")}: ${run.stderr}`);
    }
    const show = darius(host, ["show", "M1-alpha/nope.md"], repo.dir);
    assert.equal(show.code, 1);
    assert.match(show.stderr, /darius show: file not found: M1-alpha\/nope\.md \(tracker root .+; paths are tracker-relative, e\.g\. M1-x\/01-y\.md\)/u);
    // The error text carries no cwd-joined path (the old `<cwd>/M1-alpha/nope.md`).
    assert.equal(show.stderr.includes(`${repo.dir}/M1-alpha`), false, show.stderr);
    const json = darius(host, ["show", "M1-alpha/nope.md", "--json"], repo.dir);
    assert.equal(json.code, 1);
    assert.equal(JSON.parse(json.stdout).ok, false);
  });
}

test("git mode: the next --json spec path works in the next verb unchanged (the M2 transcript case)", { skip: NO_GIT }, () => {
  const repo = repoOf("git");
  const next = JSON.parse(ok(host, ["next", "--json"], repo.dir));
  assert.equal(next.status, "task");
  const shown = JSON.parse(ok(host, ["show", next.spec, "--json"], repo.dir));
  assert.equal(shown.title.length > 0, true);
  assert.match(ok(host, ["spec", "check", next.spec], repo.dir), /^PASS /u);
});

test("a directory outside any project says which directory has no .darius.toml and to cd into the repo", { skip: NO_GIT }, () => {
  const outside = join(host.root, "outside");
  mkdirSync(outside, { recursive: true });
  for (const argv of [["show", "M1-alpha/01-spec-one.md"], ["next"], ["verify", "M1-alpha/01-spec-one.md"]]) {
    const run = darius(host, argv, outside);
    assert.equal(run.code, 1, argv.join(" "));
    assert.ok(run.stderr.includes(`${outside} has no .darius.toml`), `${argv.join(" ")}: ${run.stderr}`);
    assert.match(run.stderr, /cd into the repo that holds the tracker/u);
  }
  const spec = darius(host, ["spec", "check", "M1-alpha/01-spec-one.md"], outside);
  assert.equal(spec.code, 1);
  assert.ok(spec.stderr.includes(`${outside} has no .darius.toml`), spec.stderr);
});

test("a project that keeps its tracker in a nested clone says so (the darius-workspace case)", { skip: NO_GIT }, () => {
  const workspace = join(host.root, "workspace");
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, ".darius.toml"), 'v = 2\nproject = "wsx"\n');
  const run = darius(host, ["show", "M1-alpha/01-spec-one.md"], workspace);
  assert.equal(run.code, 1);
  assert.ok(run.stderr.includes(`${workspace} is the darius project wsx but has no tracker`), run.stderr);
  assert.match(run.stderr, /cd into the repo that holds the tracker/u);
  assert.match(run.stderr, /then run: darius root/u);
});

test("milestone arguments take the tracker folder path too", { skip: NO_GIT }, () => {
  for (const mode of MODES) {
    const repo = repoOf(mode);
    for (const form of ["M1-alpha", "alpha", ".tracker/M1-alpha/", join(repo.tree, "M1-alpha")]) {
      assert.match(ok(host, ["archive-check", form], repo.dir), /clear/u, `${mode} ${form}`);
    }
    const thread = ok(host, ["worklog", "open", ".tracker/M1-alpha/", "--message", "start", "--session", "s1"], repo.dir).trim();
    assert.match(thread, /-m1-alpha$/u, mode);
  }
});
