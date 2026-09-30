/**
 * `src/core/store.ts`: project layout, the typed item codec, `writeItem`'s
 * blob + `item.changed` rule, and the O_EXCL lock (re-entrancy, stale
 * takeover, timeout on a fresh foreign lock).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readLedger } from "../src/core/ledger.ts";
import { UsageError } from "../src/core/model.ts";
import type { Document, Ritual, Vigil } from "../src/core/model.ts";
import {
  decodeItem,
  encodeItem,
  getBlobText,
  listProjects,
  openProject,
  sha256Hex,
  withFileLock,
} from "../src/core/store.ts";

// Paths are read from the environment on every call, so setting them here,
// after the imports, still keeps every write inside this throwaway dir.
const sandbox = mkdtempSync(join(tmpdir(), "darius-store-test-"));
process.env.DARIUS_STATE_DIR = join(sandbox, "state");
process.env.DARIUS_CONFIG_DIR = join(sandbox, "config");

function ritualDoc(overrides: Partial<Ritual> = {}): Document<Ritual> {
  return {
    header: {
      id: "01K5Z8QK5Q9S1N1B5N9S1N1B5N",
      kind: "ritual",
      slug: "heartbeat",
      title: "Heartbeat",
      created: "2026-09-28T03:00:00.000Z",
      updated: "2026-09-28T03:00:00.000Z",
      tags: ["selftest"],
      cadence: "1d",
      anchor: "due",
      policy: { mode: "report", may: ["Bash(darius *)", "Bash(date)"], hold: ["git push"], model: "haiku", max_turns: 6 },
      ...overrides,
    },
    body: "\n## Procedure\n\nRun `darius --version`.\n",
  };
}

function vigilDoc(): Document<Vigil> {
  return {
    header: {
      id: "01K5Z8QK5Q9S1N1B5N9S1N1B5P",
      kind: "vigil",
      slug: "date-held",
      title: "Date held",
      created: "2026-09-28T03:00:00.000Z",
      updated: "2026-09-28T03:00:00.000Z",
      tags: [],
      due: "2026-09-27",
      heavy: true,
    },
    body: "\n- [ ] it holds\n  - Command: `true`\n  - Expected: `exit 0`\n",
  };
}

test("openProject refuses a missing project and creates the layout on request", () => {
  assert.throws(() => openProject("nope"), UsageError);
  const project = openProject("layout", { create: true });
  for (const dir of ["items/rituals", "items/vigils", "ledger", "blobs"]) {
    assert.ok(existsSync(join(project.root, dir)), dir);
  }
  assert.ok(listProjects().includes("layout"));
  assert.throws(() => openProject("../escape", { create: true }), UsageError);
});

test("a ritual and a vigil round-trip through writeItem and readItem with typed fields", () => {
  const project = openProject("roundtrip", { create: true });
  project.writeItem(ritualDoc(), { who: "test" });
  project.writeItem(vigilDoc(), { who: "test" });
  assert.deepEqual(project.readItem<Ritual>("ritual", "heartbeat"), ritualDoc());
  assert.deepEqual(project.readItem<Vigil>("vigil", "date-held"), vigilDoc());
  assert.deepEqual(project.listItems("ritual"), ["heartbeat"]);
  assert.equal(project.readItem("ritual", "missing"), null);
});

test("writeItem keeps the previous version as a blob and appends item.changed", () => {
  const project = openProject("history", { create: true });
  project.writeItem(ritualDoc(), { who: "test" });
  const path = join(project.root, "items", "rituals", "heartbeat.md");
  const first = readFileSync(path, "utf8");
  project.writeItem(ritualDoc({ title: "Heartbeat v2" }), { who: "test" });
  project.writeItem(ritualDoc({ title: "Heartbeat v2" }), { who: "test" });

  const changes = readLedger(project).filter((line) => line.type === "item.changed");
  assert.equal(changes.length, 2, "an identical rewrite appends nothing");
  assert.equal(changes[0]?.sha_before, null);
  assert.equal(changes[1]?.sha_before, sha256Hex(first));
  assert.equal(changes[1]?.sha_after, sha256Hex(readFileSync(path, "utf8")));
  assert.equal(changes[1]?.item, "ritual/heartbeat");
  assert.equal(getBlobText(project, sha256Hex(first)), first);
});

test("decodeItem rejects unknown keys and bad values, naming the file", () => {
  const text = encodeItem(vigilDoc());
  assert.throws(() => decodeItem(text.replace("heavy: true", "heavy: yes"), "x.md"), /x\.md.*heavy/u);
  assert.throws(() => decodeItem(text.replace("heavy: true", "heavy: true\nlinks: []"), "x.md"), /x\.md.*links/u);
  assert.throws(() => decodeItem(text.replace("kind: vigil", "kind: spec"), "x.md"), /x\.md.*kind/u);
});

test("readItem refuses a file whose header names another slug", () => {
  const project = openProject("mismatch", { create: true });
  const text = encodeItem(ritualDoc());
  writeFileSync(join(project.root, "items", "rituals", "other.md"), text);
  assert.throws(() => project.readItem("ritual", "other"), /heartbeat/u);
});

test("withLock is re-entrant and refuses an async body", () => {
  const project = openProject("locks", { create: true });
  const result = project.withLock(() => project.withLock(() => 42));
  assert.equal(result, 42);
  assert.equal(existsSync(join(project.root, ".lock")), false);
  assert.throws(() => project.withLock(async () => 1), /synchronous/u);
});

test("a lock older than the stale limit is taken over", () => {
  const project = openProject("stale", { create: true });
  const lock = join(project.root, ".lock");
  writeFileSync(lock, "999999 crashed-host 2026-01-01T00:00:00.000Z\n");
  const old = new Date(Date.now() - 60_000);
  utimesSync(lock, old, old);
  assert.equal(project.withLock(() => "ran"), "ran");
  assert.equal(existsSync(lock), false);
});

test("a fresh foreign lock blocks until the timeout and is left in place", () => {
  const project = openProject("fresh", { create: true });
  const lock = join(project.root, ".lock");
  writeFileSync(lock, "1 other-process now\n");
  const started = Date.now();
  assert.throws(() => withFileLock(lock, () => "never", { timeoutMs: 300, staleMs: 30_000 }), /still locked/u);
  assert.ok(Date.now() - started >= 300);
  assert.equal(readFileSync(lock, "utf8"), "1 other-process now\n");
});
