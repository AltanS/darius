/**
 * The box's post-run check (src/core/box-work.ts `checkPlants`): after the
 * run, with the box reaped, the work dir is walked again, and each `.git`,
 * `.claude`, `.darius.toml` and bare repo whose (dev, ino) the launch scan did
 * not record is renamed, so a later unboxed git, Claude Code or darius does
 * not trust it. What it cannot settle comes back as unresolved, which taints
 * the work dir. All in a temp dir.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkPlants, scanWork, type PlantCheck } from "../src/core/box-work.ts";

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

function scan(work: string): ReturnType<typeof scanWork> {
  return scanWork({ workDir: work, capMs: 30_000 });
}

function check(work: string, launch = scan(work)): PlantCheck {
  return checkPlants({ workDir: work, launch, capMs: 30_000 });
}

/** The one entry next to `path` whose name is `<name>.darius-blocked-<8 hex>`. */
function blockedOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dir = path.slice(0, path.lastIndexOf("/"));
  const pattern = new RegExp(`^${name.replaceAll(".", String.raw`\.`)}\\.darius-blocked-[0-9a-f]{8}$`, "u");
  const found = readdirSync(dir).filter((entry) => pattern.test(entry));
  assert.equal(found.length, 1, `${path}: ${readdirSync(dir).join(", ")}`);
  return join(dir, found[0] ?? "");
}

function escape(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\/]/gu, String.raw`\$&`);
}

/** The run.log line of a rename, with the random part as a pattern. */
function line(path: string, what: string, name = path.slice(path.lastIndexOf("/") + 1)): RegExp {
  return new RegExp(`^${escape(path)}, ${escape(what)}, ${escape(name)} renamed to ${escape(name)}\\.darius-blocked-[0-9a-f]{8}`, "u");
}

function assertLines(result: PlantCheck, patterns: readonly RegExp[]): void {
  assert.equal(result.blocked.length, patterns.length, result.blocked.join("\n"));
  for (const pattern of patterns) assert.ok(result.blocked.some((entry) => pattern.test(entry)), `${String(pattern)} in\n${result.blocked.join("\n")}`);
}

test("a new nested .git folder, .git file, .claude folder and nested .darius.toml are renamed, with a random part; a pre-existing one is left alone", () => {
  const { base, work } = workDir();
  try {
    plantRepo(join(work, "old"));
    put(join(work, "old-claude", ".claude", "settings.json"), "{}\n");
    put(join(work, "old-co", ".darius.toml"), "v = 3\n");
    const launch = scan(work);
    plantRepo(join(work, "sub"));
    put(join(work, "wt", ".git"), "gitdir: /elsewhere/.git/worktrees/wt\n");
    put(join(work, "deep", "er", ".claude", "settings.json"), '{"hooks":{}}\n');
    put(join(work, "nested", ".darius.toml"), 'v = 3\n[rituals.x]\nnet = "public"\n');
    const result = check(work, launch);
    assert.deepEqual(result.unresolved, []);
    assertLines(result, [
      line(join(work, "sub", ".git"), "a .git made in the run"),
      line(join(work, "wt", ".git"), "a .git made in the run"),
      line(join(work, "deep", "er", ".claude"), "a .claude made in the run"),
      line(join(work, "nested", ".darius.toml"), "a .darius.toml made in the run"),
    ]);
    assert.equal(existsSync(join(work, "sub", ".git")), false);
    assert.match(readFileSync(join(blockedOf(join(work, "sub", ".git")), "config"), "utf8"), /fsmonitor/u, "the rename keeps the content: reversible");
    assert.equal(readFileSync(blockedOf(join(work, "wt", ".git")), "utf8"), "gitdir: /elsewhere/.git/worktrees/wt\n");
    for (const kept of [join(work, "old", ".git", "config"), join(work, "old-claude", ".claude", "settings.json"), join(work, "old-co", ".darius.toml"), join(work, ".git", "config")]) assert.ok(existsSync(kept), kept);
    assert.deepEqual(check(work).blocked, [], "a second check finds nothing new");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a top .darius.toml that was missing at launch is a plant; one that was there stays", () => {
  const { base, work } = workDir();
  try {
    const launch = scan(work);
    put(join(work, ".darius.toml"), 'v = 3\nproject = "x"\n');
    assertLines(check(work, launch), [line(join(work, ".darius.toml"), "a .darius.toml made in the run")]);
    put(join(work, ".darius.toml"), "v = 3\n");
    assert.deepEqual(check(work, scan(work)).blocked, []);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("F2: a run that moves the parent of a known repo and makes a new one in its place: the new one is renamed, the moved one is known by dev:ino and stays", () => {
  const { base, work } = workDir();
  try {
    plantRepo(join(work, "sub"));
    const launch = scan(work);
    renameSync(join(work, "sub"), join(work, "sub-old"));
    plantRepo(join(work, "sub"));
    assertLines(check(work, launch), [line(join(work, "sub", ".git"), "a .git made in the run")]);
    assert.ok(existsSync(join(work, "sub-old", ".git", "config")), "the operator's repo, moved by the run, is not renamed");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("F3: the check looks inside a new guard and renames the deepest first: a new bare repo does not hide a .git in it", () => {
  const { base, work } = workDir();
  try {
    mkdirSync(join(work, "src", "components"), { recursive: true });
    const launch = scan(work);
    for (const name of ["objects", "refs"]) mkdirSync(join(work, "src", name));
    put(join(work, "src", "HEAD"), "ref: refs/heads/main\n");
    plantRepo(join(work, "src", "components"));
    put(join(work, "src", "components", ".git", "inner", ".claude", "settings.json"), "{}\n");
    const result = check(work, launch);
    assert.deepEqual(result.unresolved, []);
    assertLines(result, [
      line(join(work, "src"), "a bare repo made in the run", "HEAD"),
      line(join(work, "src", "components", ".git"), "a .git made in the run"),
      line(join(work, "src", "components", ".git", "inner", ".claude"), "a .claude made in the run"),
    ]);
    const git = blockedOf(join(work, "src", "components", ".git"));
    assert.ok(existsSync(blockedOf(join(git, "inner", ".claude"))), "the deepest was renamed first, at its path then");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a new bare repo, also by commondir, gets its HEAD renamed; a work dir that turns into one too; a known bare repo stays", () => {
  const { base, work } = workDir();
  try {
    const known = join(work, "fixtures", "repo.git");
    for (const name of ["objects", "refs"]) mkdirSync(join(known, name), { recursive: true });
    put(join(known, "HEAD"), "ref: refs/heads/main\n");
    const launch = scan(work);
    const bare = join(work, "cache", "x");
    for (const name of ["objects", "refs"]) mkdirSync(join(bare, name), { recursive: true });
    put(join(bare, "HEAD"), "ref: refs/heads/main\n");
    const viaCommondir = join(work, "wt2");
    put(join(viaCommondir, "HEAD"), "ref: refs/heads/main\n");
    put(join(viaCommondir, "commondir"), "../cache/x\n");
    for (const name of ["objects", "refs"]) mkdirSync(join(work, name));
    put(join(work, "HEAD"), "ref: refs/heads/main\n");
    assertLines(check(work, launch), [
      line(bare, "a bare repo made in the run", "HEAD"),
      line(viaCommondir, "a bare repo made in the run", "HEAD"),
      line(work, "a bare repo made in the run", "HEAD"),
    ]);
    for (const dir of [bare, viaCommondir, work]) assert.equal(existsSync(join(dir, "HEAD")), false, dir);
    assert.ok(existsSync(join(known, "HEAD")), "the bare repo from before stays");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a planted .git or .claude link is renamed itself; its target is not followed or touched", () => {
  const { base, work } = workDir();
  try {
    const target = join(base, "outside");
    plantRepo(target);
    const launch = scan(work);
    mkdirSync(join(work, "l"));
    symlinkSync(join(target, ".git"), join(work, "l", ".git"));
    symlinkSync(target, join(work, "l", ".claude"));
    assertLines(check(work, launch), [line(join(work, "l", ".claude"), "a .claude made in the run"), line(join(work, "l", ".git"), "a .git made in the run")]);
    const moved = blockedOf(join(work, "l", ".git"));
    assert.ok(lstatSync(moved).isSymbolicLink(), "the link itself moved");
    assert.equal(readlinkSync(moved), join(target, ".git"));
    assert.ok(existsSync(join(target, ".git", "HEAD")) && existsSync(join(target, ".git", "config")), "the target is not touched");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("F1: a read-only parent and an unreadable folder get chmod u+rwx and one more try; the plant in each is renamed", { skip: process.getuid?.() === 0 }, () => {
  const { base, work } = workDir();
  try {
    const launch = scan(work);
    plantRepo(join(work, "ro"));
    chmodSync(join(work, "ro"), 0o555);
    plantRepo(join(work, "locked"));
    chmodSync(join(work, "locked"), 0o000);
    const result = check(work, launch);
    assert.deepEqual(result.unresolved, []);
    assert.equal(result.blocked.length, 2, result.blocked.join("\n"));
    assert.ok(result.blocked.some((entry) => entry.startsWith(`${join(work, "ro", ".git")}, a .git made in the run, .git renamed to`) && entry.endsWith(`after chmod u+rwx on ${join(work, "ro")}`)), result.blocked.join("\n"));
    assert.ok(result.blocked.some((entry) => entry.startsWith(`${join(work, "locked", ".git")}, a .git made in the run`)), result.blocked.join("\n"));
    assert.equal(existsSync(join(work, "ro", ".git")), false);
    assert.equal(statSync(join(work, "locked")).mode & 0o700, 0o700, "the check made the folder readable to look in it");
  } finally {
    for (const dir of ["ro", "locked"]) chmodSync(join(work, dir), 0o755);
    rmSync(base, { recursive: true, force: true });
  }
});

test("F1: what the check cannot settle is unresolved: a name that is not UTF-8, its time cap", () => {
  const { base, work } = workDir();
  try {
    const launch = scan(work);
    const bad = Buffer.concat([Buffer.from(`${work}/`), Buffer.from([0xff, 0x41])]);
    mkdirSync(bad);
    mkdirSync(Buffer.concat([bad, Buffer.from("/.git")]));
    assert.deepEqual(check(work, launch).unresolved, [`${work} holds a name that is not valid UTF-8`]);
    rmSync(Buffer.concat([bad, Buffer.from("/.git")]).toString("latin1"), { force: true });
    let clock = 0;
    const capped = checkPlants({ workDir: work, launch, capMs: 5, now: () => (clock += 10) });
    assert.equal(capped.isUnfinished, true);
    assert.deepEqual(capped.unresolved, ["the check did not finish within 0 s"]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("node_modules stays out of the check, as at launch; a mount point is not entered", () => {
  const { base, work } = workDir();
  try {
    const launch = scan(work);
    plantRepo(join(work, "node_modules", "pkg"));
    plantRepo(join(work, "mnt"));
    const result = checkPlants({ workDir: work, launch, capMs: 30_000, mountinfo: `36 35 98:0 / ${work}/mnt rw - tmpfs tmpfs rw\n` });
    assert.deepEqual(result.blocked, []);
    assert.ok(existsSync(join(work, "node_modules", "pkg", ".git")), "the documented limit: a .git under node_modules is not guarded");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

/** True when `btrfs subvolume create` works for this user at `dir`. */
function makeSubvolume(path: string): boolean {
  const made = spawnSync("btrfs", ["subvolume", "create", path], { encoding: "utf8" });
  return made.status === 0 && statSync(path).dev !== statSync(join(path, "..")).dev;
}

test("F4: a btrfs subvolume the run makes is walked: it has its own st_dev, but it is not a mount point", (t) => {
  const { base, work } = workDir();
  try {
    plantRepo(join(work, "known"));
    const launch = scan(work);
    if (!makeSubvolume(join(work, "vol"))) {
      t.skip("no btrfs subvolume for this user here");
      return;
    }
    plantRepo(join(work, "vol"));
    assertLines(check(work, launch), [line(join(work, "vol", ".git"), "a .git made in the run")]);
    // And the launch scan finds a nested .git in a subvolume, for its read-only mount.
    assert.ok(scan(work).bares.length + scan(work).gits.length > 0);
    assert.ok(scan(work).gits.includes(join(work, "known", ".git")));
  } finally {
    spawnSync("btrfs", ["subvolume", "delete", join(work, "vol")], { encoding: "utf8" });
    rmSync(base, { recursive: true, force: true });
  }
});
