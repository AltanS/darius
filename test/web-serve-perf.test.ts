/**
 * What `darius serve` does for speed (0.104.0): the 10 s status cache that a write POST clears, and gzip
 * for text bodies. The first part is a real listen on 127.0.0.1 against the committed app build; the
 * rest calls the pure helpers.
 *
 * SAFETY: the state and config dirs are `mkdtemp` dirs; nothing leaves the machine.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

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

const PORT = 47_998;
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
    await new Promise((resolve) => setTimeout(resolve, 200));
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
