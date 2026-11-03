/**
 * The box's post-run check (src/core/box-host.ts `checkPlants`): after the
 * run, with the box closed, the work dir is walked again, and each `.git`,
 * `.claude` and bare repo the launch scan did not find is renamed, so a later
 * unboxed git or Claude Code session does not trust it. All in a temp dir.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkPlants, scanWork } from "../src/core/box-host.ts";

const RUN = "01JRUNPLANTCHECK0000000000";

/** A throwaway base and the work dir in it. */
interface Fixture {
  base: string;
  work: string;
}

function workDir(): Fixture {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "darius-box-plants-")));
  const work = join(base, "w");
  mkdirSync(join(work, ".git"), { recursive: true });
  writeFileSync(join(work, ".git", "config"), "[core]\n");
  return { base, work };
}

function put(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

/** A planted repo: a .git folder with a config that a later `git status` there runs. */
function plantRepo(dir: string): void {
  put(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
  mkdirSync(join(dir, ".git", "objects"), { recursive: true });
  mkdirSync(join(dir, ".git", "refs"), { recursive: true });
  put(join(dir, ".git", "config"), '[core]\n\tfsmonitor = "touch /tmp/pwned"\n');
}

function check(work: string, launch = scanWork({ workDir: work, capMs: 30_000 })): ReturnType<typeof checkPlants> {
  return checkPlants({ workDir: work, launch, run: RUN, capMs: 30_000 });
}

test("a new nested .git folder, .git file and .claude folder are renamed; a pre-existing one is left alone", () => {
  const { base, work } = workDir();
  try {
    plantRepo(join(work, "old"));
    put(join(work, "old-claude", ".claude", "settings.json"), "{}\n");
    const launch = scanWork({ workDir: work, capMs: 30_000 });
    plantRepo(join(work, "sub"));
    put(join(work, "wt", ".git"), "gitdir: /elsewhere/.git/worktrees/wt\n");
    put(join(work, "deep", "er", ".claude", "settings.json"), '{"hooks":{}}\n');
    const result = check(work, launch);
    assert.equal(result.isUnfinished, false);
    assert.deepEqual(result.blocked.toSorted(), [
      `${join(work, "deep", "er", ".claude")}, a .claude made in the run, .claude renamed to .claude.darius-blocked`,
      `${join(work, "sub", ".git")}, a .git made in the run, .git renamed to .git.darius-blocked`,
      `${join(work, "wt", ".git")}, a .git made in the run, .git renamed to .git.darius-blocked`,
    ]);
    assert.equal(existsSync(join(work, "sub", ".git")), false);
    assert.match(readFileSync(join(work, "sub", ".git.darius-blocked", "config"), "utf8"), /fsmonitor/u, "the rename keeps the content: reversible");
    assert.equal(readFileSync(join(work, "wt", ".git.darius-blocked"), "utf8"), "gitdir: /elsewhere/.git/worktrees/wt\n");
    assert.ok(existsSync(join(work, "deep", "er", ".claude.darius-blocked", "settings.json")));
    assert.ok(existsSync(join(work, "old", ".git", "config")), "a nested repo that was there at launch stays");
    assert.ok(existsSync(join(work, "old-claude", ".claude", "settings.json")));
    assert.ok(existsSync(join(work, ".git", "config")), "the top .git is never touched");
    assert.deepEqual(check(work).blocked, [], "a second check finds nothing new");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a new bare repo gets its HEAD renamed, git then sees no repo there; a work dir that turns into one too", () => {
  const { base, work } = workDir();
  try {
    const launch = scanWork({ workDir: work, capMs: 30_000 });
    const bare = join(work, "cache", "x");
    for (const name of ["objects", "refs"]) mkdirSync(join(bare, name), { recursive: true });
    put(join(bare, "HEAD"), "ref: refs/heads/main\n");
    put(join(bare, "config"), '[core]\n\tbare = false\n\tworktree = ..\n\tfsmonitor = "touch /tmp/pwned"\n');
    const viaCommondir = join(work, "wt2");
    put(join(viaCommondir, "HEAD"), "ref: refs/heads/main\n");
    put(join(viaCommondir, "commondir"), "../cache/x\n");
    for (const name of ["objects", "refs"]) mkdirSync(join(work, name));
    put(join(work, "HEAD"), "ref: refs/heads/main\n");
    const result = check(work, launch);
    assert.deepEqual(result.blocked.toSorted(), [
      `${bare}, a bare repo made in the run, HEAD renamed to HEAD.darius-blocked`,
      `${work}, a bare repo made in the run, HEAD renamed to HEAD.darius-blocked`,
      `${viaCommondir}, a bare repo made in the run, HEAD renamed to HEAD.darius-blocked`,
    ].toSorted());
    for (const dir of [bare, viaCommondir, work]) {
      assert.equal(existsSync(join(dir, "HEAD")), false, dir);
      assert.ok(existsSync(join(dir, "HEAD.darius-blocked")), dir);
    }
    assert.ok(existsSync(join(bare, "config")), "only HEAD moves");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a bare repo or a work dir that looked like one at launch is left alone", () => {
  const { base, work } = workDir();
  try {
    const bare = join(work, "fixtures", "repo.git");
    for (const dir of [bare, work]) {
      for (const name of ["objects", "refs"]) mkdirSync(join(dir, name), { recursive: true });
      put(join(dir, "HEAD"), "ref: refs/heads/main\n");
    }
    const launch = scanWork({ workDir: work, capMs: 30_000 });
    assert.equal(launch.isBareTop, true);
    assert.deepEqual(check(work, launch).blocked, []);
    assert.ok(existsSync(join(bare, "HEAD")) && existsSync(join(work, "HEAD")));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a taken name gets the run id; when both names are taken nothing moves and the line says so", () => {
  const { base, work } = workDir();
  try {
    const launch = scanWork({ workDir: work, capMs: 30_000 });
    plantRepo(join(work, "a"));
    put(join(work, "a", ".git.darius-blocked"), "an earlier block\n");
    plantRepo(join(work, "b"));
    put(join(work, "b", ".git.darius-blocked"), "an earlier block\n");
    put(join(work, "b", `.git.darius-blocked-${RUN}`), "taken too\n");
    const result = check(work, launch);
    assert.deepEqual(result.blocked.toSorted(), [
      `${join(work, "a", ".git")}, a .git made in the run, .git renamed to .git.darius-blocked-${RUN}`,
      `${join(work, "b", ".git")}, a .git made in the run, not renamed: .git.darius-blocked and .git.darius-blocked-${RUN} are both taken`,
    ]);
    assert.equal(readFileSync(join(work, "a", ".git.darius-blocked"), "utf8"), "an earlier block\n", "an existing file is never overwritten");
    assert.ok(existsSync(join(work, "a", `.git.darius-blocked-${RUN}`, "config")));
    assert.ok(existsSync(join(work, "b", ".git", "config")));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a planted .git or .claude link is renamed itself; its target is not followed or touched", () => {
  const { base, work } = workDir();
  try {
    const target = join(base, "outside");
    plantRepo(target);
    const launch = scanWork({ workDir: work, capMs: 30_000 });
    mkdirSync(join(work, "l"));
    symlinkSync(join(target, ".git"), join(work, "l", ".git"));
    symlinkSync(target, join(work, "l", ".claude"));
    const result = check(work, launch);
    assert.deepEqual(result.blocked.toSorted(), [
      `${join(work, "l", ".claude")}, a .claude made in the run, .claude renamed to .claude.darius-blocked`,
      `${join(work, "l", ".git")}, a .git made in the run, .git renamed to .git.darius-blocked`,
    ]);
    assert.ok(lstatSync(join(work, "l", ".git.darius-blocked")).isSymbolicLink(), "the link itself moved");
    assert.equal(readlinkSync(join(work, "l", ".git.darius-blocked")), join(target, ".git"));
    assert.ok(existsSync(join(target, ".git", "HEAD")), "the target's HEAD is not renamed through the link");
    assert.ok(existsSync(join(target, ".git", "config")));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("node_modules stays out of the check, as at launch; a walk that hits its cap says it did not finish", () => {
  const { base, work } = workDir();
  try {
    const launch = scanWork({ workDir: work, capMs: 30_000 });
    plantRepo(join(work, "node_modules", "pkg"));
    assert.deepEqual(check(work, launch).blocked, []);
    assert.ok(existsSync(join(work, "node_modules", "pkg", ".git")), "the documented limit: a .git under node_modules is not guarded");
    plantRepo(join(work, "sub"));
    let clock = 0;
    const capped = checkPlants({ workDir: work, launch, run: RUN, capMs: 5, now: () => (clock += 10) });
    assert.equal(capped.isUnfinished, true);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
