/**
 * The host strip, Fleet, Machines and the workspace header (0.139.0,
 * reworked in 0.140.0), drawn by the committed build with the demo data
 * (web/server/demo.ts): this host, host-b online on another darius, host-c
 * unreachable, and ten workspaces of every health. Run under Node and Bun alike.
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
const { demoContext, demoFleet, demoPeers, demoWorkspaces } = await import("../web/server/demo.ts");
const { webContext } = await import("../src/web/context.ts");
const { pageLabel } = await import("../web/app/lib/paths.ts");
const { groupByWorkspace, headlineOf } = await import("../web/app/lib/fleet.ts");

const context = demoContext(webContext("owner on phone"));

async function page(path: string, cookie = ""): Promise<{ status: number; body: string; location: string | null }> {
  const response = await built.default(new Request(`http://darius.test${path}`, { headers: cookie === "" ? {} : { cookie } }), context);
  return { status: response.status, body: (await response.text()).replaceAll("<!-- -->", ""), location: response.headers.get("location") };
}

/** The markup before the scripts: what the server drew, without the loader data. */
function markup(body: string): string {
  return body.slice(0, body.indexOf("<script"));
}

/** The host strip of a page. */
function stripOf(body: string): string {
  const start = body.indexOf('<nav aria-label="Hosts"');
  return start === -1 ? "" : body.slice(start, body.indexOf("</nav>", start));
}

const NOW = Date.parse("2026-11-25T10:00:00.000Z");

test("demo: two other hosts, one online and one unreachable; workspaces of every health", () => {
  assert.deepEqual(
    demoPeers(NOW).map((peer) => [peer.host, peer.state]),
    [
      ["demo", "self"],
      ["host-b", "online"],
      ["host-c", "unreachable"],
    ],
  );
  assert.deepEqual(
    demoFleet(NOW).hosts.map((host) => host.host),
    ["demo", "host-b", "host-c"],
  );
  const fleet = demoWorkspaces(NOW);
  const byHealth = (health: string): string[] => fleet.workspaces.filter((one) => one.health === health).map((one) => one.name);
  assert.deepEqual(byHealth("unreadable"), ["broken-store"]);
  assert.deepEqual(byHealth("failing"), ["demo-shop", "mail-relay"]);
  assert.ok(byHealth("needs-you").length >= 3, "several need you");
  assert.deepEqual(byHealth("ok"), ["field-notes", "status-page"]);
  assert.deepEqual(byHealth("quiet"), ["archive-2025", "old-site"]);
  assert.deepEqual(fleet.hosts, ["demo", "host-b", "host-c"]);
  assert.deepEqual(fleet.workspaces.find((one) => one.name === "infra-notes")?.reasons, ["copy not synced in 45 min"]);
  assert.deepEqual(fleet.workspaces.find((one) => one.name === "mail-relay")?.reasons, ["1 ritual failed twice"]);
});

test("the host strip is a sticky bar on every page: state dot, name, run count; no version, only the versions-differ mark", async () => {
  for (const path of ["/all", "/w/demo-shop/rituals", "/status", "/fleet"]) {
    const strip = stripOf((await page(path)).body);
    assert.ok(strip !== "", `${path}: the strip`);
    for (const host of ["demo", "host-b", "host-c"]) assert.ok(strip.includes(`href="/hosts/${host}"`), `${path}: ${host} links to its page`);
    assert.match(strip, /, this host<\/span>/u);
    assert.match(strip, /, online<\/span>/u);
    assert.match(strip, /, unreachable<\/span>/u);
    assert.match(strip, /title="host-c: Unreachable: it syncs, but its darius serve did not answer \(connection refused\)\."/u);
    assert.match(strip, /class="hs-runs"><span aria-hidden="true">\d+<\/span><span class="sr-only">, \d+ open runs?<\/span>/u, "this host has open runs");
    assert.match(strip, /versions differ/u, "host-b runs another darius");
    const chips = strip.slice(0, strip.indexOf("</ul>"));
    assert.doesNotMatch(chips, /demo-next|hs-ver/u, "no version on a chip");
  }
});

test("the loading line: the gem's text names the page a path opens", () => {
  const cases: ReadonlyArray<readonly [string, string | null]> = [
    ["/fleet", "Fleet"],
    ["/hosts", "Machines"],
    ["/hosts/host-b", "machine host-b"],
    ["/vigils", "Vigils"],
    ["/w/demo-shop/vigils", "Vigils"],
    ["/w/demo-shop/vigils/odds-empty-record", "vigil odds-empty-record"],
    ["/w/demo-shop/rituals/site-report", "ritual site-report"],
    ["/w/demo-shop", "demo-shop"],
    ["/all", "All workspaces"],
    ["/settings/backups", "Settings"],
    ["/nope", null],
  ];
  for (const [path, label] of cases) assert.equal(pageLabel(path), label, path);
});

test("Places: the Fleet group holds Fleet and Machines, and the head with the gem holds a polite live region", async () => {
  const { body } = await page("/fleet");
  const places = body.slice(body.indexOf('<nav aria-label="Places"'), body.indexOf("</nav>", body.indexOf('<nav aria-label="Places"')));
  assert.match(places, /<p class="places-group">Fleet<\/p>/u);
  assert.ok(places.includes('href="/fleet"') && places.includes('href="/hosts"'));
  assert.doesNotMatch(places, /Topology|All hosts/u);
  assert.match(places, /<span class="busy-text" aria-live="polite">/u);
  assert.match(markup(body), /<span class="busy-text topbar-busy" aria-live="polite">/u, "the phone top bar too");
});

test("/fleet: the headline with linked counts, the workspace table worst first, the placement matrix and the failed mirror", async () => {
  const { status, body } = await page("/fleet");
  assert.equal(status, 200);
  const html = markup(body);
  assert.match(html, /8 workspaces on 3 hosts: <span><a [^>]*href="\/fleet\?health=ok#workspaces"[^>]*>2 OK<\/a><\/span>/u);
  for (const link of ["/fleet?health=needs-you#workspaces", "/fleet?health=failing#workspaces", "/fleet?health=unreadable#workspaces", "/fleet?health=quiet#workspaces"]) assert.ok(html.includes(`href="${link}"`), link);
  assert.match(html, /Also <span|Also <a/u, "the quiet ones are counted apart");
  const names = [...html.matchAll(/class="fl-name">([^<]+)</gu)].map((match) => match[1]);
  assert.deepEqual(names.slice(0, 3), ["broken-store", "demo-shop", "mail-relay"], "unreadable, then failing");
  assert.deepEqual(names.slice(-2), ["archive-2025", "old-site"], "quiet last");
  assert.match(html, /<a class="fl-row" href="\/w\/demo-shop"/u, "the whole row is a link");
  assert.match(html, /\+\d+<\/span>/u, "more than two reasons end in +n");
  assert.match(html, /fl-chip-host">host-b<\/span><span class="fl-chip-kind">checkout/u, "the where chips");
  assert.match(html, /id="placement"/u);
  assert.match(html, /<td class="is-checkout">checkout<span class="fl-pins">1 pinned<\/span><\/td>/u, "a pinned ritual in the matrix");
  assert.match(html, /Not mirrored here/u);
  assert.match(html, /big-media/u);
});

test("/fleet?health=failing filters the table, with a way back to all", async () => {
  const html = markup((await page("/fleet?health=failing")).body);
  const names = [...html.matchAll(/class="fl-name">([^<]+)</gu)].map((match) => match[1]);
  assert.deepEqual(names, ["demo-shop", "mail-relay"]);
  assert.match(html, /Only Failing\. Show all/u);
});

test("/topology redirects to the placement matrix of /fleet", async () => {
  const { status, location } = await page("/topology");
  assert.equal(status, 301);
  assert.equal(location, "/fleet#placement");
});

test("the workspace header: health and reasons, lives on, five count links, the djinns with where they run", async () => {
  const html = markup((await page("/w/demo-shop")).body);
  assert.match(html, /class="fl-head panel"/u);
  assert.match(html, /<span class="fl-word">Failing<\/span>/u);
  assert.match(html, /2 vigils flagged/u);
  assert.match(html, /Lives on/u);
  for (const label of ["Djinns", "Rituals", "Vigils", "Candles lit", "Findings"]) assert.ok(html.includes(`fl-count-label">${label}<`), label);
  assert.match(html, /id="djinns"/u);
  assert.match(html, /runs on host-b<\/span><span class="text-muted"> \(pinned\)/u, "a pinned djinn names its host");
  assert.match(html, /<span>here<\/span><span class="text-muted"> \(checkout\)/u);
  const copy = markup((await page("/w/infra-notes")).body);
  assert.match(copy, /copy here, synced/u, "a copy says how old it is");
  assert.match(copy, /runs on host-b/u, "a copy's djinn runs on the checkout host");
});

test("/hosts: equal cards, with version, uptime, load, box check, last seen, running now, checkouts and pinned djinns", async () => {
  const { status, body } = await page("/hosts");
  assert.equal(status, 200);
  const html = markup(body);
  assert.equal([...html.matchAll(/class="mc panel"/gu)].length, 3);
  for (const text of ["Machines", "Uptime", "Load", "Box check", "Last seen", "Running now", "Checkouts here", "Pinned djinns", "0.42 0.31 0.27", "demo-next, differs", "The hosts run different darius versions: demo, demo-next."]) assert.ok(html.includes(text) || (text === "Uptime" && html.includes("<dt>Up</dt>")), text);
  assert.ok(html.includes('href="/fleet"'));
});

test("/hosts/:host: the card, then grouped and bounded lists, details folded; an unknown host is a 404", async () => {
  const self = await page("/hosts/demo");
  assert.equal(self.status, 200);
  const html = markup(self.body);
  for (const text of ["Running now", "Djinns that run here", "Workspaces", "Details: live facts, ledgers, versions, backup", "demo-old", "bun 1.3.0"]) assert.ok(html.includes(text), text);
  assert.match(html, /<h3 class="fl-group-name"><a href="\/w\/demo-shop"[^>]*>demo-shop<\/a><\/h3>/u, "grouped by workspace");
  assert.match(html, /<details[^>]*class="fold/u, "details are folded");
  const b = markup((await page("/hosts/host-b")).body);
  assert.ok(b.includes("Price sync (djinn)"), "the djinn pinned to host-b");
  assert.ok(b.includes("Certificate scan (djinn)"), "the djinn of a checkout on host-b");
  const c = markup((await page("/hosts/host-c")).body);
  assert.ok(c.includes("Its darius serve did not answer: connection refused."));
  assert.equal((await page("/hosts/nowhere")).status, 404);
});

test("every list of the fleet pages shows at most five rows per workspace, then the total", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({ ws: index < 9 ? "one" : "two", n: index }));
  const groups = groupByWorkspace(rows, (row) => row.ws);
  assert.deepEqual(
    groups.map((group) => [group.workspace, group.rows.length, group.total]),
    [
      ["one", 5, 9],
      ["two", 3, 3],
    ],
  );
  const line = headlineOf(demoWorkspaces(NOW).workspaces, 3);
  assert.equal(line.lead, "8 workspaces on 3 hosts");
  assert.deepEqual(line.quiet?.text, "2 quiet");
});
