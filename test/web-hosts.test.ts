/**
 * The host strip, Machines and Topology (0.139.0), drawn by the committed
 * build with the demo data (web/server/demo.ts): this host, host-b online
 * on another darius, and host-c unreachable. Run under Node and Bun alike.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-web-hosts-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");

import type { WebHandler } from "../src/web/api.ts";

const built: { default: WebHandler } = await import("../web/build/server/index.js");
const { demoContext, demoFleet, demoPeers } = await import("../web/server/demo.ts");
const { webContext } = await import("../src/web/context.ts");

const context = demoContext(webContext("owner on phone"));

async function page(path: string): Promise<{ status: number; body: string }> {
  const response = await built.default(new Request(`http://darius.test${path}`), context);
  return { status: response.status, body: (await response.text()).replaceAll("<!-- -->", "") };
}

/** The host strip of a page. */
function stripOf(body: string): string {
  const start = body.indexOf('<nav aria-label="Hosts"');
  return start === -1 ? "" : body.slice(start, body.indexOf("</nav>", start));
}

test("demo: two other hosts, one online and one unreachable, and a fleet with the same three", () => {
  const now = Date.parse("2026-11-25T10:00:00.000Z");
  assert.deepEqual(
    demoPeers(now).map((peer) => [peer.host, peer.state]),
    [
      ["demo", "self"],
      ["host-b", "online"],
      ["host-c", "unreachable"],
    ],
  );
  assert.deepEqual(
    demoFleet(now).hosts.map((host) => host.host),
    ["demo", "host-b", "host-c"],
  );
});

test("the host strip is on every page: a chip per host with its state in words, version and runs, each a link to its machine page", async () => {
  for (const path of ["/all", "/w/demo-shop/rituals", "/status", "/settings"]) {
    const strip = stripOf((await page(path)).body);
    assert.ok(strip !== "", `${path}: the strip`);
    for (const host of ["demo", "host-b", "host-c"]) assert.ok(strip.includes(`href="/hosts/${host}"`), `${path}: ${host} links to its page`);
    assert.match(strip, /, this host<\/span>/u);
    assert.match(strip, /, online<\/span>/u);
    assert.match(strip, /, unreachable<\/span>/u);
    assert.match(strip, /title="Unreachable: it syncs, but its darius serve did not answer \(connection refused\)\."/u);
    assert.match(strip, /class="hs-runs">\d+ runs?</u, "this host has open runs");
    assert.match(strip, /versions differ/u, "host-b runs another darius");
  }
});

test("/hosts lists the machines with live and ledger facts, and warns about different versions", async () => {
  const { status, body } = await page("/hosts");
  assert.equal(status, 200);
  for (const text of ["Machines", "host-b", "host-c", "darius demo-next", "connection refused", "last seen", "box check passed", "The hosts run different darius versions: demo, demo-next."]) assert.ok(body.includes(text), text);
  assert.ok(body.includes('href="/topology"'));
});

test("/hosts/:host shows one machine; an unknown host is a 404", async () => {
  const self = await page("/hosts/demo");
  assert.equal(self.status, 200);
  for (const text of ["Live", "Open runs", "Pinned here", "Docs link audit (djinn)", "Rituals that last ran here", "Vigils last swept here", "darius versions", "demo-old", "checkout here", "bun 1.3.0"]) assert.ok(self.body.includes(text), text);
  const b = await page("/hosts/host-b");
  assert.equal(b.status, 200);
  assert.ok(b.body.includes("Price sync (djinn)"), "the ritual pinned to host-b");
  const c = await page("/hosts/host-c");
  assert.ok(c.body.includes("Its darius serve did not answer: connection refused."));
  assert.equal((await page("/hosts/nowhere")).status, 404);
});

test("/topology: one column per host, with projects, rituals and djinns with their pins, vigils and the box checks", async () => {
  const { status, body } = await page("/topology");
  assert.equal(status, 200);
  const words: readonly string[] = ["Topology", "Projects", "Rituals and djinns", "Vigils", "Box check", "checkout", "writes chunks", "pinned", "any", "djinn", "last run", "last sweep", "tp-wrap"];
  for (const text of words) assert.ok(body.includes(text), text);
  const head = body.slice(body.indexOf("<thead>"), body.indexOf("</thead>"));
  assert.deepEqual([...head.matchAll(/href="\/hosts\/([^"]+)"/gu)].map((match) => match[1]), ["demo", "host-b", "host-c"]);
  const markup = body.slice(0, body.indexOf("<script"));
  assert.doesNotMatch(markup, /Old cleanup/u, "a retired ritual is left out");
  assert.match(markup, /Price sync \(djinn\)/u);
});
