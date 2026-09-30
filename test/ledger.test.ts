/**
 * `src/core/ledger.ts`: line filling, concurrent appends from separate
 * processes, the multi-host read (dedupe + sort), and the chunk helpers sync
 * uses.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  appendLine,
  closeOpenChunk,
  hostId,
  listChunks,
  parseLedgerText,
  readLedger,
  writeRemoteChunk,
} from "../src/core/ledger.ts";
import { openProject } from "../src/core/store.ts";
import { ulidTime } from "../src/core/ulid.ts";

// Paths are read from the environment on every call, so setting them here,
// after the imports, still keeps every write inside this throwaway dir.
const sandbox = mkdtempSync(join(tmpdir(), "darius-ledger-test-"));
process.env.DARIUS_STATE_DIR = join(sandbox, "state");
process.env.DARIUS_CONFIG_DIR = join(sandbox, "config");

const CHILD_COUNT = 20;
const SHORT_HOST = hostname().split(".")[0] ?? hostname();

test("appendLine fills v, id, at, host and project, with the id time equal to at", () => {
  const project = openProject("fill", { create: true });
  const line = appendLine(project, { who: "test", type: "run.started", item: "ritual/heartbeat", run: "r1" });
  assert.equal(line.v, 1);
  assert.equal(line.project, "fill");
  assert.equal(line.host, SHORT_HOST);
  assert.equal(ulidTime(line.id), Date.parse(line.at));
  assert.deepEqual(readLedger(project), [line]);
  assert.throws(() => appendLine(project, { who: "test", type: "x", id: "forged" }), /id/u);
});

test("a backdated line carries an id whose time is its at", () => {
  const project = openProject("backdate", { create: true });
  const line = appendLine(project, { who: "import", type: "evidence", at: "2026-08-01T10:00:00Z" });
  assert.equal(line.at, "2026-08-01T10:00:00.000Z");
  assert.equal(ulidTime(line.id), Date.parse("2026-08-01T10:00:00Z"));
});

test("hostId reads host from config.toml when one exists", () => {
  const previous = process.env.DARIUS_CONFIG_DIR;
  const dir = mkdtempSync(join(tmpdir(), "darius-ledger-config-"));
  writeFileSync(join(dir, "config.toml"), 'host = "testhost"\n');
  process.env.DARIUS_CONFIG_DIR = dir;
  try {
    assert.equal(hostId(), "testhost");
  } finally {
    process.env.DARIUS_CONFIG_DIR = previous;
  }
  assert.equal(hostId(), SHORT_HOST);
});

function runChild(script: string, env: NodeJS.ProcessEnv): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--no-warnings", script], { env, stdio: ["ignore", "ignore", "inherit"] });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code));
  });
}

test(`${CHILD_COUNT} concurrent appendLine calls from separate processes leave ${CHILD_COUNT} well-formed lines`, async () => {
  const project = openProject("concurrent", { create: true });
  const script = join(sandbox, "append-child.mjs");
  const ledgerUrl = pathToFileURL(join(import.meta.dirname, "../src/core/ledger.ts")).href;
  const storeUrl = pathToFileURL(join(import.meta.dirname, "../src/core/store.ts")).href;
  writeFileSync(
    script,
    [
      `import { appendLine } from ${JSON.stringify(ledgerUrl)};`,
      `import { openProject } from ${JSON.stringify(storeUrl)};`,
      "const wait = Number(process.env.START_AT) - Date.now();",
      "if (wait > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);",
      'appendLine(openProject("concurrent"), { who: "test", type: "test.concurrent", n: Number(process.env.N) });',
    ].join("\n"),
  );
  const startAt = String(Date.now() + 1500);
  const exits = await Promise.all(
    Array.from({ length: CHILD_COUNT }, (_, n) => runChild(script, { ...process.env, START_AT: startAt, N: String(n) })),
  );
  assert.deepEqual(exits, Array.from({ length: CHILD_COUNT }, () => 0));

  const raw = readFileSync(join(project.root, "ledger", SHORT_HOST, "open.jsonl"), "utf8");
  const rows = raw.split("\n").filter((row) => row !== "");
  assert.equal(rows.length, CHILD_COUNT);
  const lines = parseLedgerText(raw, "open.jsonl");
  const numbers = lines.map((line) => line.n).toSorted((a, b) => Number(a) - Number(b));
  assert.deepEqual(numbers, Array.from({ length: CHILD_COUNT }, (_, n) => n));
  assert.equal(new Set(lines.map((line) => line.id)).size, CHILD_COUNT);
  assert.equal(existsSync(join(project.root, ".lock")), false);
});

test("the same chunk under two host dirs reads back once, sorted by id", () => {
  const project = openProject("dedupe", { create: true });
  for (let n = 0; n < 5; n += 1) appendLine(project, { who: "test", type: "test.dedupe", n });
  const name = closeOpenChunk(project);
  assert.ok(name !== null);
  assert.equal(existsSync(join(project.root, "ledger", SHORT_HOST, "open.jsonl")), false);
  appendLine(project, { who: "test", type: "test.dedupe", n: 5 });

  const copyDir = join(project.root, "ledger", "host-b");
  mkdirSync(copyDir, { recursive: true });
  copyFileSync(join(project.root, "ledger", SHORT_HOST, name), join(copyDir, name));

  const lines = readLedger(project);
  assert.equal(lines.length, 6);
  assert.equal(new Set(lines.map((line) => line.id)).size, 6);
  const ids = lines.map((line) => line.id);
  assert.deepEqual(ids, ids.toSorted());
  assert.deepEqual(
    lines.map((line) => line.n),
    [0, 1, 2, 3, 4, 5],
  );
  assert.equal(listChunks(project).length, 2);
});

test("closeOpenChunk returns null when nothing is open", () => {
  const project = openProject("empty-close", { create: true });
  assert.equal(closeOpenChunk(project), null);
});

test("writeRemoteChunk validates lines, is idempotent, and refuses different content", () => {
  const source = openProject("remote-source", { create: true });
  appendLine(source, { who: "test", type: "test.remote" });
  const name = closeOpenChunk(source);
  assert.ok(name !== null);
  const text = readFileSync(join(source.root, "ledger", SHORT_HOST, name), "utf8");

  const target = openProject("remote-target", { create: true });
  assert.equal(writeRemoteChunk(target, { host: "host-b", name, text }), "written");
  assert.equal(writeRemoteChunk(target, { host: "host-b", name, text }), "exists");
  assert.equal(readLedger(target).length, 1);
  assert.throws(() => writeRemoteChunk(target, { host: "host-b", name, text: `${text}${text}` }), /different/u);
  assert.throws(
    () => writeRemoteChunk(target, { host: "host-b", name: "01K5Z8QK5Q9S1N1B5N9S1N1B5Q.jsonl", text: "{not json\n" }),
    /:1: not valid JSON/u,
  );
  assert.throws(() => writeRemoteChunk(target, { host: "../x", name, text }), /host id/u);
});

test("readLedger names the file and line of a malformed line", () => {
  const project = openProject("malformed", { create: true });
  appendLine(project, { who: "test", type: "ok" });
  const open = join(project.root, "ledger", SHORT_HOST, "open.jsonl");
  writeFileSync(open, `${readFileSync(open, "utf8")}{"v":1}\n`, "utf8");
  assert.throws(() => readLedger(project), /open\.jsonl:2/u);
});
