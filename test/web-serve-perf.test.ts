/**
 * What `darius serve` does for speed (0.104.0): the 10 s status cache that a write POST clears, and gzip
 * for text bodies, and since 0.141.4 the ledger cache, over a store of many big projects. The serve
 * parts are a real listen on 127.0.0.1 against the committed app build; the rest calls the pure helpers.
 *
 * SAFETY: the state and config dirs are `mkdtemp` dirs; nothing leaves the machine.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { freePort } from "./helpers/free-port.ts";
import { untilListening } from "./helpers/listening.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-web-perf-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
process.env.DARIUS_TAILSCALE = join(SANDBOX, "no-tailscale");
delete process.env.DARIUS_WEB_BIND;
delete process.env.DARIUS_WEB_ALLOW;
delete process.env.DARIUS_WEB_URL;

const { parseArgs } = await import("../src/cli/args.ts");
const { GZIP_MIN_BYTES, acceptsGzip, compressedReply, serveCommand } = await import("../src/cli/serve.ts");
const { STATUS_TTL_MS, cachedStatus, clearStatusCache, useStatusCache } = await import("../src/web/context.ts");
const { openProject } = await import("../src/core/store.ts");
const { appendLine, hostId, readLedger, useLedgerCache, closeOpenChunk } = await import("../src/core/ledger.ts");
const { ulid } = await import("../src/core/ulid.ts");

const PORT = await freePort();
const BIG = "x".repeat(1025);
const PAGE = "/all";

interface Answer {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

let stopped = false;
function stop(): void {
  if (stopped) return;
  stopped = true;
  process.emit("SIGTERM");
}

function call(method: string, path: string, headers: Record<string, string> = {}): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: PORT, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end(method === "POST" ? "{}" : "");
  });
}

test("the status cache: a read inside the TTL is reused, a clear or the end of the TTL reads again, and it is off unless serve turns it on", () => {
  openProject("perf-unit", { create: true });
  assert.notEqual(cachedStatus(), cachedStatus(), "off: every read is fresh");
  useStatusCache(true);
  try {
    const first = cachedStatus(1_000);
    assert.equal(cachedStatus(1_000 + STATUS_TTL_MS - 1), first, "inside the TTL");
    assert.notEqual(cachedStatus(1_000 + STATUS_TTL_MS), first, "after the TTL");
    const again = cachedStatus(50_000);
    clearStatusCache();
    assert.notEqual(cachedStatus(50_001), again, "cleared");
  } finally {
    useStatusCache(false);
  }
});

test("serve: pages come from the status cache for 10 s, any write POST clears it, and /api/status.json is always fresh", async () => {
  const log = console.log;
  console.log = () => undefined;
  stopped = false;
  try {
    const serving = serveCommand.run(parseArgs(["--port", String(PORT), "--bind", "127.0.0.1"]));
    await untilListening(PORT);
    openProject("perf-before", { create: true });
    const page = async (): Promise<string> => (await call("GET", PAGE)).body.toString("utf8");
    assert.ok((await page()).includes("perf-before"));
    openProject("perf-after", { create: true });
    assert.equal((await page()).includes("perf-after"), false, "inside the TTL the page does not read the store again");
    assert.ok((await call("GET", "/api/status.json")).body.toString("utf8").includes("perf-after"), "the JSON status is never cached");
    // The loopback viewer is refused, but a POST under an API prefix is a write attempt: it clears the cache.
    for (const path of ["/api/run/ack", "/api/finding/close", "/api/vigil/check", "/api/snapshots/check"]) {
      openProject(`perf-${path.split("/").at(-1) ?? "x"}`, { create: true });
      await call("POST", path, { "content-type": "application/json" });
      assert.ok((await page()).includes("perf-after"), `after POST ${path} the page reads the store again`);
      clearStatusCache();
    }
    stop();
    assert.equal(await serving, 0);
  } finally {
    stop();
    console.log = log;
  }
});

test("serve: gzip for text over 1 KB when the caller accepts it; HEAD, a small body and a caller without gzip stay plain", async () => {
  const log = console.log;
  console.log = () => undefined;
  stopped = false;
  try {
    const serving = serveCommand.run(parseArgs(["--port", String(PORT), "--bind", "127.0.0.1"]));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const plain = await call("GET", PAGE);
    assert.equal(plain.status, 200);
    assert.ok(plain.body.length > GZIP_MIN_BYTES);
    assert.equal(plain.headers["content-encoding"], undefined);
    assert.match(String(plain.headers.vary), /Accept-Encoding/u);
    const zipped = await call("GET", PAGE, { "accept-encoding": "gzip, deflate, br" });
    assert.equal(zipped.headers["content-encoding"], "gzip");
    assert.match(String(zipped.headers.vary), /Accept-Encoding/u);
    assert.ok(zipped.body.length < plain.body.length);
    const unzipped = gunzipSync(zipped.body).toString("utf8");
    assert.ok(unzipped.startsWith("<!DOCTYPE html>") && unzipped.includes("Overview | darius"), "the body is the page");
    const head = await call("HEAD", PAGE, { "accept-encoding": "gzip" });
    assert.equal(head.headers["content-encoding"], undefined);
    assert.equal(head.body.length, 0);
    const small = await call("GET", "/healthz", { "accept-encoding": "gzip" });
    assert.equal(small.headers["content-encoding"], undefined);
    assert.equal(small.body.toString("utf8"), "ok\n");
    stop();
    assert.equal(await serving, 0);
  } finally {
    stop();
    console.log = log;
  }
});

function reply(type: string, status = 200, body: string | Uint8Array = BIG): Parameters<typeof compressedReply>[0] {
  return { status, headers: new Headers({ "content-type": type }), body };
}

test("compressedReply: text, JSON and turbo-stream over the limit; never binary, 304, an encoded body or q=0", () => {
  for (const type of ["text/html; charset=utf-8", "application/json; charset=utf-8", "text/x-script", "text/javascript", "application/manifest+json"]) {
    const out = compressedReply(reply(type), "gzip", false);
    assert.equal(out.headers.get("content-encoding"), "gzip", type);
    assert.equal(out.headers.get("vary"), "Accept-Encoding", type);
    assert.equal(gunzipSync(out.body).toString("utf8"), BIG, type);
  }
  assert.equal(compressedReply(reply("image/png"), "gzip", false).headers.get("content-encoding"), null);
  assert.equal(compressedReply(reply("font/woff2"), "gzip", false).headers.get("vary"), null);
  assert.equal(compressedReply(reply("text/html", 304, ""), "gzip", false).headers.get("content-encoding"), null);
  assert.equal(compressedReply(reply("text/html"), "gzip;q=0", false).headers.get("content-encoding"), null);
  assert.equal(compressedReply(reply("text/html"), undefined, false).headers.get("content-encoding"), null);
  assert.equal(compressedReply(reply("text/html", 200, "short"), "gzip", false).headers.get("content-encoding"), null);
  const encoded = reply("text/html");
  encoded.headers.set("content-encoding", "br");
  assert.equal(compressedReply(encoded, "gzip", false).headers.get("content-encoding"), "br");
  assert.equal(acceptsGzip("br, gzip;q=0.5"), true);
  assert.equal(acceptsGzip("identity"), false);
});

test("serve: GET /api/pending answers the light poll, POST is 405", async () => {
  const log = console.log;
  console.log = () => undefined;
  stopped = false;
  try {
    const serving = serveCommand.run(parseArgs(["--port", String(PORT), "--bind", "127.0.0.1"]));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const ghost = "01JGHOST0000000000000000AA";
    const polled = await call("GET", `/api/pending?ids=${ghost}`);
    assert.equal(polled.status, 200);
    assert.match(String(polled.headers["content-type"]), /^application\/json/u);
    assert.deepEqual(JSON.parse(polled.body.toString("utf8")), { ok: true, starts: [{ id: ghost, state: "unknown" }] });
    assert.equal((await call("GET", "/api/pending?ids=nope")).status, 400);
    assert.equal((await call("POST", `/api/pending?ids=${ghost}`)).status, 405);
    stop();
    assert.equal(await serving, 0);
  } finally {
    stop();
    console.log = log;
  }
});

// --- a store of many big projects (0.141.4) ------------------------------------------------

const DAY_MS = 24 * 60 * 60_000;

/**
 * A project like a busy workspace: `vigils` vigils and `rituals` rituals, and a ledger of
 * `lines` lines of their sweeps and runs over the last 30 days, written as this host's.
 */
function bigProject(name: string, load: { vigils: number; rituals: number; lines: number }): void {
  const project = openProject(name, { create: true });
  const stamp = new Date().toISOString();
  for (let index = 0; index < load.vigils; index += 1) {
    writeFileSync(join(project.root, "items", "vigils", `v${String(index)}.md`), `---\nid: ${ulid()}\nkind: vigil\nslug: v${String(index)}\ntitle: Vigil ${String(index)}\ncreated: ${stamp}\nupdated: ${stamp}\ntags: []\n---\n# Vigil ${String(index)}\n`);
  }
  for (let index = 0; index < load.rituals; index += 1) {
    writeFileSync(join(project.root, "items", "rituals", `r${String(index)}.md`), `---\nid: ${ulid()}\nkind: ritual\nslug: r${String(index)}\ntitle: Ritual ${String(index)}\ncreated: ${stamp}\nupdated: ${stamp}\ncadence: 1d\nanchor: due\ntags: []\npolicy:\n  mode: report\n---\n# Ritual ${String(index)}\n`);
  }
  const host = hostId();
  const dir = join(project.root, "ledger", host);
  mkdirSync(dir, { recursive: true });
  const start = Date.now() - 30 * DAY_MS;
  const step = Math.floor((30 * DAY_MS) / load.lines);
  const rows: string[] = [];
  for (let index = 0; index < load.lines; index += 2) {
    const at = start + index * step;
    const base = { v: 1, host, who: "timer", project: name };
    if (index % 4 === 0) {
      const item = `vigil/v${String((index / 4) % Math.max(1, load.vigils))}`;
      rows.push(JSON.stringify({ ...base, id: ulid(at), at: new Date(at).toISOString(), type: "evidence", item, check: `${item}#1`, outcome: "pass", exit: 0, command: "true" }));
      rows.push(JSON.stringify({ ...base, id: ulid(at + 1), at: new Date(at + 1).toISOString(), type: "vigil.swept", item, outcome: "held" }));
      continue;
    }
    const item = `ritual/r${String((index / 2) % Math.max(1, load.rituals))}`;
    const run = ulid(at);
    rows.push(JSON.stringify({ ...base, id: run, at: new Date(at).toISOString(), type: "run.started", item, run }));
    rows.push(JSON.stringify({ ...base, id: ulid(at + 1), at: new Date(at + 1).toISOString(), type: "run.completed", item, run, outcome: "complete" }));
  }
  writeFileSync(join(dir, "open.jsonl"), `${rows.join("\n")}\n`);
}

test("the ledger cache: an append, a closed chunk and a cleared cache all read right; off, every read parses", () => {
  const project = openProject("perf-cache", { create: true });
  appendLine(project, { who: "test", type: "note", item: "vigil/x" });
  useLedgerCache(true);
  try {
    const first = readLedger(project);
    assert.equal(first.length, 1);
    assert.notEqual(readLedger(project), first, "each read is a new array");
    assert.equal(readLedger(project)[0], first[0], "of the same lines");
    appendLine(project, { who: "test", type: "note", item: "vigil/x" });
    assert.equal(readLedger(project).length, 2, "an append is read at once");
    closeOpenChunk(project);
    assert.equal(readLedger(project).length, 2, "a closed chunk holds the same lines");
    appendLine(project, { who: "test", type: "note", item: "vigil/x" });
    assert.equal(readLedger(project).length, 3, "a new open file after the close");
  } finally {
    useLedgerCache(false);
  }
  assert.notEqual(readLedger(project)[0], readLedger(project)[0], "off: each read parses the files again");
});

test("serve with many big projects (0.141.4): warm pages and /api/host.json stay fast, and a new line shows on the next /api/host.json", async () => {
  bigProject("perf-big", { vigils: 200, rituals: 20, lines: 100_000 });
  for (let index = 0; index < 12; index += 1) bigProject(`perf-many-${String(index)}`, { vigils: 10, rituals: 4, lines: 8_000 });
  const log = console.log;
  console.log = () => undefined;
  stopped = false;
  try {
    const serving = serveCommand.run(parseArgs(["--port", String(PORT), "--bind", "127.0.0.1"]));
    await untilListening(PORT);
    const pages = ["/all", "/machines", "/workspaces", "/vigils", "/activity", "/w/perf-big", "/w/perf-big/vigils", "/api/host.json"];
    for (const path of pages) assert.equal((await call("GET", path)).status, 200, path);
    const took: Record<string, number> = {};
    for (const path of pages) {
      const started = performance.now();
      await call("GET", path);
      took[path] = performance.now() - started;
    }
    // Before 0.141.4 these pages took about 9 s in all on this store, and /api/host.json 0.5 s:
    // each vigil read the whole ledger, and every reader parsed every ledger again. Now they
    // take about 1.5 s and 20 ms. The bounds are loose, for a loaded machine.
    const total = Object.values(took).reduce((sum, ms) => sum + ms, 0);
    const shown = JSON.stringify(Object.fromEntries(Object.entries(took).map(([path, ms]) => [path, Math.round(ms)])));
    assert.ok(total < 4_000, `the warm pages took ${total.toFixed(0)} ms in all: ${shown}`);
    assert.ok((took["/api/host.json"] ?? Infinity) < 250, `/api/host.json: ${shown}`);
    const before = JSON.parse((await call("GET", "/api/host.json")).body.toString("utf8"));
    assert.equal(before.openRuns.length, 0);
    const run = ulid();
    appendLine(openProject("perf-big"), { who: "timer", type: "run.started", item: "ritual/r0", run });
    const after = JSON.parse((await call("GET", "/api/host.json")).body.toString("utf8"));
    assert.deepEqual(after.openRuns.map((open: { run: string }) => open.run), [run], "the cache saw the new line");
    stop();
    assert.equal(await serving, 0);
  } finally {
    stop();
    console.log = log;
  }
});
