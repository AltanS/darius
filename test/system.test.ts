/**
 * `src/web/system.ts`: the machine and store numbers for the status page,
 * read from a throwaway state dir.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendLine, hostId } from "../src/core/ledger.ts";
import type { Ritual } from "../src/core/model.ts";
import { openProject } from "../src/core/store.ts";
import { ulid } from "../src/core/ulid.ts";
import { collectSystem, resetSystemCache } from "../src/web/system.ts";

// Paths are read from the environment on every call, so setting them after
// the imports still keeps every write inside this throwaway dir.
const sandbox = mkdtempSync(join(tmpdir(), "darius-system-test-"));
process.env.DARIUS_STATE_DIR = join(sandbox, "state");
process.env.DARIUS_CONFIG_DIR = join(sandbox, "config");
mkdirSync(process.env.DARIUS_CONFIG_DIR, { recursive: true });
writeFileSync(join(process.env.DARIUS_CONFIG_DIR, "config.toml"), 'host = "host-self"\n');

const stateRoot = process.env.DARIUS_STATE_DIR;

function addRitual(name: string, slug: string): void {
  const now = new Date().toISOString();
  const header: Ritual = { id: ulid(), kind: "ritual", slug, title: slug, created: now, updated: now, tags: [], anchor: "due", policy: { mode: "off", may: [], hold: [] } };
  openProject(name, { create: true }).writeItem({ header, body: "Do the thing.\n" }, { who: "test" });
}

test("counts items and runs per project and for the store", () => {
  resetSystemCache();
  const one = openProject("project-one", { create: true });
  addRitual("project-one", "daily");
  addRitual("project-one", "weekly");
  appendLine(one, { who: "test", type: "run.started", item: "ritual/daily", run: "r1" });
  appendLine(one, { who: "test", type: "run.completed", item: "ritual/daily", run: "r1" });
  appendLine(one, { who: "test", type: "run.started", item: "ritual/weekly", run: "r2" });
  openProject("project-two", { create: true });

  const status = collectSystem();
  assert.equal(status.host, "host-self");
  assert.equal(status.store.path, stateRoot);
  assert.equal(status.store.projects, 2);
  const row = status.projects.find((project) => project.project === "project-one");
  assert.ok(row);
  assert.equal(row.rituals, 2);
  assert.equal(row.vigils, 0);
  assert.equal(row.profiles, 0);
  assert.equal(row.runs, 2);
  assert.ok(row.bytes > 0);
  assert.equal(status.store.rituals, 2);
  assert.equal(status.store.runs, 2);
  assert.equal(status.disks[0]?.label, "store");
  assert.equal(status.syncRemote, null);
});

test("bytes and files total the regular files of the state dir", () => {
  resetSystemCache();
  const before = collectSystem();
  writeFileSync(join(stateRoot, "project-two", "extra.bin"), "x".repeat(1000));
  assert.equal(collectSystem().store.bytes, before.store.bytes, "the walk is remembered");
  resetSystemCache();
  const after = collectSystem();
  assert.equal(after.store.bytes, before.store.bytes + 1000);
  assert.equal(after.store.files, before.store.files + 1);
  const two = after.projects.find((project) => project.project === "project-two");
  assert.ok(two && two.bytes >= 1000);
});

test("lastSync comes from sync.json, and a broken file does not throw", () => {
  resetSystemCache();
  writeFileSync(join(stateRoot, "project-one", "sync.json"), JSON.stringify({ last_sync: "2026-09-30T10:00:00.000Z" }));
  writeFileSync(join(stateRoot, "project-two", "sync.json"), "{ not json");
  const { projects } = collectSystem();
  assert.equal(projects.find((project) => project.project === "project-one")?.lastSync, "2026-09-30T10:00:00.000Z");
  assert.equal(projects.find((project) => project.project === "project-two")?.lastSync, null);
});

test("a second host shows up from a foreign chunk, and this host is first", () => {
  resetSystemCache();
  const foreignTime = Date.parse("2026-09-20T08:30:00Z");
  const dir = join(stateRoot, "project-one", "ledger", "host-other");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${ulid(foreignTime)}.jsonl`), "");
  const { hosts } = collectSystem();
  assert.equal(hosts.length, 2);
  assert.equal(hosts[0]?.host, hostId());
  assert.equal(hosts[0]?.self, true);
  assert.equal(hosts[0]?.chunks, 0);
  assert.ok(hosts[0]?.lastSeen !== null, "the open chunk of this host counts");
  assert.deepEqual(hosts[1], { host: "host-other", self: false, lastSeen: "2026-09-20T08:30:00.000Z", chunks: 1, projects: ["project-one"] });
});

test("this host is listed with no chunks and no lastSeen in an empty store", () => {
  resetSystemCache();
  const previous = process.env.DARIUS_STATE_DIR;
  process.env.DARIUS_STATE_DIR = join(sandbox, "empty-state");
  try {
    const status = collectSystem({ backupDir: join(sandbox, "missing", "backups") });
    assert.deepEqual(status.hosts, [{ host: "host-self", self: true, lastSeen: null, chunks: 0, projects: [] }]);
    assert.equal(status.store.bytes, 0);
    assert.deepEqual(status.disks.map((disk) => disk.label), ["store", "backups"]);
  } finally {
    process.env.DARIUS_STATE_DIR = previous;
    resetSystemCache();
  }
});
