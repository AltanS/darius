/**
 * The tracker tree in the store (src/core/tree.ts): capture, apply, the index,
 * the host-local exclusions, two hosts, and the checkout link.
 *
 * Two hosts ("host-a", "host-b") each get a state dir and a config dir with
 * their own `host`. A test switches between them with DARIUS_STATE_DIR and
 * DARIUS_CONFIG_DIR, and moves ledger chunks and blobs between them by hand,
 * the way `darius sync` would through the bucket.
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { closeOpenChunk, readLedger } from "../src/core/ledger.ts";
import { getBlob, openProject, sha256Hex, type Project } from "../src/core/store.ts";
import { applyTree, captureTree, ensureTreeLink, hasTree, isLocalTreePath, isMergeablePath, mergeLines, syncTree, treeDir } from "../src/core/tree.ts";
import { sleepSync } from "../src/runtime.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-tree-"));
after(() => rmSync(SANDBOX, { recursive: true, force: true }));

interface Host {
  name: string;
  state: string;
  config: string;
}

function makeHost(name: string): Host {
  const host: Host = { name, state: join(SANDBOX, name, "state"), config: join(SANDBOX, name, "config") };
  mkdirSync(host.state, { recursive: true });
  mkdirSync(host.config, { recursive: true });
  writeFileSync(join(host.config, "config.toml"), `host = "${name}"\n`);
  return host;
}

const hostA = makeHost("host-a");
const hostB = makeHost("host-b");
let projects = 0;

function useHost(host: Host): void {
  process.env.DARIUS_STATE_DIR = host.state;
  process.env.DARIUS_CONFIG_DIR = host.config;
}

function projectOn(host: Host, name: string): Project {
  useHost(host);
  return openProject(name, { create: true });
}

function newProject(): string {
  projects += 1;
  return `tree-${String(projects)}`;
}

/** Writes `content` at `path` in the host's working copy. */
function put(host: Host, name: string, path: string, content: string | Uint8Array, mode = 0o644): void {
  const file = join(treeDir(projectOn(host, name)), path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  chmodSync(file, mode);
}

function read(host: Host, name: string, path: string): Buffer {
  return readFileSync(join(treeDir(projectOn(host, name)), path));
}

function exists(host: Host, name: string, path: string): boolean {
  return existsSync(join(treeDir(projectOn(host, name)), path));
}

/** Moves the sender's closed chunks (and, unless `blobs` is false, its blobs) to the receiver, as sync would. */
function ship(from: Host, to: Host, name: string, options: { blobs?: boolean } = {}): void {
  const sender = projectOn(from, name);
  closeOpenChunk(sender);
  const receiver = projectOn(to, name);
  const chunks = join(sender.root, "ledger", from.name);
  if (existsSync(chunks)) cpSync(chunks, join(receiver.root, "ledger", from.name), { recursive: true });
  if (options.blobs !== false) cpSync(join(sender.root, "blobs"), join(receiver.root, "blobs"), { recursive: true });
}

function treeLines(host: Host, name: string): string[] {
  return readLedger(projectOn(host, name))
    .filter((line) => line.type === "tree.put" || line.type === "tree.removed")
    .map((line) => `${line.type} ${String(line.path)}`);
}

/** Every regular file under the working copy, with its bytes and exec bit, for comparing two hosts. */
function snapshot(host: Host, name: string): Map<string, string> {
  const root = treeDir(projectOn(host, name));
  const files = new Map<string, string>();
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir).toSorted()) {
      const path = prefix === "" ? entry : `${prefix}/${entry}`;
      if (isLocalTreePath(path)) continue;
      const full = join(dir, entry);
      const stats = lstatSync(full);
      if (stats.isDirectory()) walk(full, path);
      else files.set(path, `${sha256Hex(readFileSync(full))} ${(stats.mode & 0o111) === 0 ? "-" : "x"}`);
    }
  };
  if (existsSync(root)) walk(root, "");
  return files;
}

const BINARY = new Uint8Array([0, 1, 2, 255, 254, 0, 10, 13, 128]);

test("capture then apply: new files, nested dirs, the exec bit and a binary file reach the other host byte for byte", () => {
  const name = newProject();
  put(hostA, name, "M1-alpha/00-README.md", "# Alpha\n");
  put(hostA, name, "M1-alpha/01-spec.md", "- [ ] one\n");
  put(hostA, name, "archive/deep/er/notes.md", "old\n");
  put(hostA, name, "tools/run.sh", "#!/bin/sh\necho hi\n", 0o755);
  put(hostA, name, "M1-alpha/data.bin", BINARY);

  const captured = captureTree(projectOn(hostA, name));
  assert.equal(captured.put, 5);
  assert.equal(captured.removed, 0);
  assert.deepEqual(captured.changed, ["M1-alpha/00-README.md", "M1-alpha/01-spec.md", "M1-alpha/data.bin", "archive/deep/er/notes.md", "tools/run.sh"]);
  const execLine = readLedger(projectOn(hostA, name)).find((line) => line.path === "tools/run.sh");
  assert.equal(execLine?.exec, true);
  assert.equal(execLine?.prev_sha, null);
  assert.equal(captureTree(projectOn(hostA, name)).put, 0, "a second capture finds nothing new");

  ship(hostA, hostB, name);
  const applied = applyTree(projectOn(hostB, name));
  assert.deepEqual(applied.problems, []);
  assert.equal(applied.written, 5);
  assert.deepEqual(snapshot(hostB, name), snapshot(hostA, name));
  assert.deepEqual(new Uint8Array(read(hostB, name, "M1-alpha/data.bin")), BINARY);
  assert.notEqual(statSync(join(treeDir(projectOn(hostB, name)), "tools/run.sh")).mode & 0o100, 0);
  assert.equal(applyTree(projectOn(hostB, name)).written, 0, "a second apply changes nothing");
  assert.equal(captureTree(projectOn(hostB, name)).put, 0, "what apply wrote is not captured again");

  // An edit, a delete that empties nested dirs, and an exec bit taken away.
  put(hostA, name, "M1-alpha/01-spec.md", "- [x] one\n");
  rmSync(join(treeDir(projectOn(hostA, name)), "archive"), { recursive: true });
  chmodSync(join(treeDir(projectOn(hostA, name)), "tools/run.sh"), 0o644);
  const second = captureTree(projectOn(hostA, name));
  assert.equal(second.put, 2);
  assert.equal(second.removed, 1);
  const edit = readLedger(projectOn(hostA, name)).findLast((line) => line.path === "M1-alpha/01-spec.md");
  assert.equal(edit?.prev_sha, sha256Hex("- [ ] one\n"), "prev_sha is the version this host had");
  const removal = readLedger(projectOn(hostA, name)).findLast((line) => line.type === "tree.removed");
  assert.equal(removal?.path, "archive/deep/er/notes.md");
  assert.equal(removal?.prev_sha, sha256Hex("old\n"));

  ship(hostA, hostB, name);
  const again = applyTree(projectOn(hostB, name));
  assert.deepEqual(again.problems, []);
  assert.deepEqual(again.changed, ["M1-alpha/01-spec.md", "archive/deep/er/notes.md", "tools/run.sh"]);
  assert.deepEqual(snapshot(hostB, name), snapshot(hostA, name));
  assert.equal(exists(hostB, name, "archive"), false, "empty dirs are pruned");
  assert.ok(existsSync(treeDir(projectOn(hostB, name))), "never the tree root");
});

test("host-local and derived files are never captured, and apply never touches them", () => {
  const name = newProject();
  const local = [
    "00-INDEX.md",
    "worklog/00-INDEX.md",
    ".pending-sync",
    ".loop-bounces.json",
    ".fc-vigil-sweep-latest.json",
    "vigils/some-vigil.md",
    "vigils/deep/x.md",
    ".enrich/scratch.md",
    "M1-alpha/01-spec.md.lock",
    "M1-alpha/01-spec.md.tmp.12345.abc12",
  ];
  for (const path of local) {
    assert.equal(isLocalTreePath(path), true, path);
    put(hostA, name, path, `local ${path}\n`);
  }
  for (const path of ["M1-alpha/01-spec.md", "worklog/M1-alpha.md", "vigil.md", "M1-alpha/00-INDEX.md", ".verification-log.jsonl", ".session-claims.json"]) {
    assert.equal(isLocalTreePath(path), false, path);
  }
  put(hostA, name, "M1-alpha/01-spec.md", "spec\n");
  symlinkSync("01-spec.md", join(treeDir(projectOn(hostA, name)), "M1-alpha/alias.md"));

  const captured = captureTree(projectOn(hostA, name));
  assert.deepEqual(captured.changed, ["M1-alpha/01-spec.md"]);
  assert.equal(captured.files, 1);
  assert.deepEqual(captured.problems, ["skipped M1-alpha/alias.md: a symlink, the tree keeps regular files only"]);

  // B has its own local files; apply leaves them as they are.
  put(hostB, name, "00-INDEX.md", "B's own index\n");
  put(hostB, name, ".pending-sync", "b\n");
  ship(hostA, hostB, name);
  assert.deepEqual(applyTree(projectOn(hostB, name)).changed, ["M1-alpha/01-spec.md"]);
  assert.equal(read(hostB, name, "00-INDEX.md").toString(), "B's own index\n");
  assert.equal(read(hostB, name, ".pending-sync").toString(), "b\n");
  assert.equal(exists(hostB, name, "vigils"), false);
});

test("the index: a file whose size and mtime match is not hashed again; a lost index is rebuilt from the ledger", () => {
  const name = newProject();
  put(hostA, name, "spec.md", "aaaa\n");
  put(hostA, name, "other.md", "other\n");
  const file = join(treeDir(projectOn(hostA, name)), "spec.md");
  const old = new Date("2026-01-01T00:00:00Z");
  utimesSync(file, old, old);
  utimesSync(join(treeDir(projectOn(hostA, name)), "other.md"), old, old);
  assert.equal(captureTree(projectOn(hostA, name)).put, 2);

  // Same size, same mtime, other bytes: the index vouches, so capture does not read the file.
  writeFileSync(file, "bbbb\n");
  utimesSync(file, old, old);
  assert.equal(captureTree(projectOn(hostA, name)).put, 0);

  // A lost index: capture hashes everything and compares with the ledger.
  const index = join(projectOn(hostA, name).root, "tracker-index.json");
  rmSync(index);
  const rebuilt = captureTree(projectOn(hostA, name));
  assert.deepEqual(rebuilt.changed, ["spec.md"], "only the file that really differs from the ledger");
  assert.ok(existsSync(index));
  writeFileSync(index, "{ not json");
  assert.equal(captureTree(projectOn(hostA, name)).put, 0, "an unreadable index is no error");

  // A file changed just now is hashed again next time (racily clean).
  writeFileSync(file, "cccc\n");
  assert.equal(captureTree(projectOn(hostA, name)).put, 1);
  const entry = JSON.parse(readFileSync(index, "utf8")).files["spec.md"];
  assert.equal(entry.mtimeMs, -1);
});

test("two hosts: an edit on A reaches B; a concurrent edit keeps the later line, reports it, and keeps the other blob", () => {
  const name = newProject();
  put(hostA, name, "spec.md", "v0\n");
  captureTree(projectOn(hostA, name));
  ship(hostA, hostB, name);
  applyTree(projectOn(hostB, name));
  assert.equal(read(hostB, name, "spec.md").toString(), "v0\n");

  put(hostA, name, "spec.md", "v1 from A\n");
  captureTree(projectOn(hostA, name));
  sleepSync(5);
  put(hostB, name, "spec.md", "v2 from B\n");
  captureTree(projectOn(hostB, name));
  ship(hostA, hostB, name);
  ship(hostB, hostA, name);

  const onA = syncTree(projectOn(hostA, name));
  assert.equal(onA.capture.put, 0);
  assert.equal(read(hostA, name, "spec.md").toString(), "v2 from B\n", "the later line wins");
  assert.deepEqual(onA.apply.problems, [`concurrent edit of spec.md: kept the version of host-b, the other version is blob ${sha256Hex("v1 from A\n")}`]);
  assert.notEqual(getBlob(projectOn(hostA, name), sha256Hex("v1 from A\n")), null, "the lost version stays a blob");

  const onB = syncTree(projectOn(hostB, name));
  assert.deepEqual(onB.apply.problems, []);
  assert.equal(read(hostB, name, "spec.md").toString(), "v2 from B\n");
  assert.deepEqual(treeLines(hostA, name), treeLines(hostB, name));
});

test("apply never clobbers a local edit that capture has not recorded; syncTree records it first", () => {
  const name = newProject();
  put(hostA, name, "spec.md", "v0\n");
  put(hostA, name, "gone.md", "remove me on A\n");
  captureTree(projectOn(hostA, name));
  ship(hostA, hostB, name);
  applyTree(projectOn(hostB, name));

  put(hostA, name, "spec.md", "v1 from A\n");
  rmSync(join(treeDir(projectOn(hostA, name)), "gone.md"));
  captureTree(projectOn(hostA, name));
  ship(hostA, hostB, name);

  // B edits both files and captures nothing yet.
  put(hostB, name, "spec.md", "local on B\n");
  put(hostB, name, "gone.md", "kept on B\n");
  // A file B created that A also created: not in B's index.
  put(hostA, name, "new.md", "A's new\n");
  captureTree(projectOn(hostA, name));
  ship(hostA, hostB, name);
  put(hostB, name, "new.md", "B's new\n");

  const alone = applyTree(projectOn(hostB, name));
  assert.equal(alone.written + alone.removed, 0);
  assert.deepEqual(alone.problems.toSorted(), [
    "local change not captured yet: gone.md; left as it is (run the verb again or darius sync)",
    "local change not captured yet: new.md; left as it is (run the verb again or darius sync)",
    "local change not captured yet: spec.md; left as it is (run the verb again or darius sync)",
  ]);
  assert.equal(read(hostB, name, "spec.md").toString(), "local on B\n");
  assert.equal(read(hostB, name, "gone.md").toString(), "kept on B\n");
  assert.equal(read(hostB, name, "new.md").toString(), "B's new\n");

  const synced = syncTree(projectOn(hostB, name));
  assert.equal(synced.capture.put, 3);
  assert.equal(read(hostB, name, "spec.md").toString(), "local on B\n", "B's later line wins");
  assert.equal(read(hostB, name, "gone.md").toString(), "kept on B\n");
  assert.equal(read(hostB, name, "new.md").toString(), "B's new\n");
});

test("a line whose blob has not arrived leaves the file alone with a problem", () => {
  const name = newProject();
  put(hostA, name, "spec.md", "needs a blob\n");
  captureTree(projectOn(hostA, name));
  ship(hostA, hostB, name, { blobs: false });
  const applied = applyTree(projectOn(hostB, name));
  assert.deepEqual(applied.problems, ["blob not synced yet: spec.md"]);
  assert.equal(exists(hostB, name, "spec.md"), false);
  ship(hostA, hostB, name);
  assert.deepEqual(applyTree(projectOn(hostB, name)).changed, ["spec.md"]);
});

test("hasTree: the working copy or a tree line", () => {
  const name = newProject();
  const project = projectOn(hostA, name);
  assert.equal(hasTree(project), false);
  mkdirSync(treeDir(project));
  assert.equal(hasTree(project), true);
  put(hostA, name, "a.md", "a\n");
  captureTree(project);
  ship(hostA, hostB, name);
  assert.equal(hasTree(projectOn(hostB, name)), true, "a tree line is enough");
});

test("ensureTreeLink: missing, a link to the tree, a link elsewhere, a folder of local files, any other folder", () => {
  const name = newProject();
  const project = projectOn(hostA, name);
  const checkout = join(SANDBOX, "checkout");
  mkdirSync(checkout);
  const link = join(checkout, ".tracker");

  ensureTreeLink(checkout, project);
  assert.equal(readlinkSync(link), treeDir(project));
  assert.ok(statSync(treeDir(project)).isDirectory());

  ensureTreeLink(checkout, project);
  assert.equal(readlinkSync(link), treeDir(project), "a link to the tree is fine");

  unlinkSync(link);
  const elsewhere = join(SANDBOX, "elsewhere");
  mkdirSync(elsewhere);
  symlinkSync(elsewhere, link);
  assert.throws(() => {
    ensureTreeLink(checkout, project);
  }, new RegExp(`links to ${elsewhere}, but the darius store keeps the tracker of ${name} in ${treeDir(project)}`, "u"));
  unlinkSync(link);

  // What git pull of the cutover commit leaves: ignored, host-local files.
  put(hostA, name, "00-INDEX.md", "the store's index\n");
  mkdirSync(join(link, "worklog"), { recursive: true });
  writeFileSync(join(link, "00-INDEX.md"), "checkout index\n");
  writeFileSync(join(link, ".pending-sync"), "x\n");
  writeFileSync(join(link, "worklog", "00-INDEX.md"), "wl index\n");
  ensureTreeLink(checkout, project);
  assert.equal(lstatSync(link).isSymbolicLink(), true);
  assert.equal(read(hostA, name, "00-INDEX.md").toString(), "the store's index\n", "a file the tree has stays");
  assert.equal(read(hostA, name, ".pending-sync").toString(), "x\n", "a file the tree lacks moves in");
  assert.equal(read(hostA, name, "worklog/00-INDEX.md").toString(), "wl index\n");

  unlinkSync(link);
  mkdirSync(join(link, "M1-alpha"), { recursive: true });
  writeFileSync(join(link, "M1-alpha", "01-spec.md"), "real data\n");
  assert.throws(() => {
    ensureTreeLink(checkout, project);
  }, new RegExp(`the darius store owns the tracker of ${name}, but a \\.tracker/ folder is in this checkout\\. Remove it from git \\(git rm -r \\.tracker\\) or merge the commit that did\\.`, "u"));
  assert.equal(readFileSync(join(link, "M1-alpha", "01-spec.md"), "utf8"), "real data\n", "a refusal moves nothing");
});

/** What one simulated sync applied. */
interface Round {
  merged: number;
  problems: string[];
}

/** One `darius sync` of `host`, as the CLI orders it: capture, pull, push, apply, and a merged file captured and pushed at once. */
function syncRound(host: Host, other: Host, name: string): Round {
  captureTree(projectOn(host, name));
  ship(other, host, name);
  ship(host, other, name);
  const applied = applyTree(projectOn(host, name));
  if (applied.merged > 0) {
    captureTree(projectOn(host, name));
    ship(host, other, name);
  }
  return { merged: applied.merged, problems: applied.problems };
}

test("a concurrent edit of a .jsonl file is merged line by line; both hosts converge after two syncs each, with no ping-pong", () => {
  const name = newProject();
  const log = ".verification-log.jsonl";
  put(hostA, name, log, '{"n":1}\n{"n":2}\n');
  put(hostA, name, "spec.md", "v0\n");
  syncRound(hostA, hostB, name);
  syncRound(hostB, hostA, name);
  assert.equal(read(hostB, name, log).toString(), '{"n":1}\n{"n":2}\n');

  // Both hosts append, and both edit an .md file: only the .jsonl file merges.
  put(hostA, name, log, '{"n":1}\n{"n":2}\n{"a":1}\n');
  put(hostA, name, "spec.md", "from A\n");
  sleepSync(5);
  put(hostB, name, log, '{"n":1}\n{"n":2}\n{"b":1}\n{"b":2}\n');
  put(hostB, name, "spec.md", "from B\n");

  assert.equal(syncRound(hostA, hostB, name).merged, 0, "A's first sync sees nothing from B yet");
  assert.equal(syncRound(hostB, hostA, name).merged, 0, "B's own line wins on B: nothing to merge there");
  const second = syncRound(hostA, hostB, name);
  assert.equal(second.merged, 1);
  assert.deepEqual(second.problems.toSorted(), [
    `concurrent edit of ${log}: merged the lines of both versions (host-b and host-a) into one file`,
    `concurrent edit of spec.md: kept the version of host-b, the other version is blob ${sha256Hex("from A\n")}`,
  ]);
  assert.deepEqual(syncRound(hostB, hostA, name).problems, []);

  const merged = '{"n":1}\n{"n":2}\n{"b":1}\n{"b":2}\n{"a":1}\n';
  assert.equal(read(hostA, name, log).toString(), merged, "the winner's lines, then the lines only the other had");
  assert.equal(read(hostB, name, log).toString(), merged);
  assert.equal(read(hostA, name, "spec.md").toString(), "from B\n", "every other path keeps last-writer-wins");
  assert.equal(read(hostB, name, "spec.md").toString(), "from B\n");

  const lines = treeLines(hostA, name).length;
  for (let round = 0; round < 2; round += 1) {
    assert.equal(syncRound(hostA, hostB, name).merged, 0);
    assert.equal(syncRound(hostB, hostA, name).merged, 0);
  }
  assert.equal(treeLines(hostA, name).length, lines, "no new lines once both hosts agree");
  assert.deepEqual(treeLines(hostA, name), treeLines(hostB, name));
});

const bytes = (text: string): Uint8Array => Buffer.from(text, "latin1");
const text = (value: Uint8Array): string => Buffer.from(value).toString("latin1");

test("mergeLines keeps the winner's order, adds the other's missing lines in order, and is byte exact", () => {
  assert.equal(text(mergeLines(bytes("a\nb\n"), bytes("a\nc\nb\nd"))), "a\nb\nc\nd\n");
  assert.equal(text(mergeLines(bytes(""), bytes(""))), "");
  assert.equal(text(mergeLines(bytes("x\xff\n"), bytes("\x80y\n"))), "x\xff\n\x80y\n");
  assert.equal(isMergeablePath("archive/x.jsonl"), true);
  assert.equal(isMergeablePath("spec.md"), false);
});
