/**
 * The machine bar, Places, Workspaces, Machines, one machine and the head of
 * a workspace (0.139.0, reworked in 0.140.0 and 0.141.0), drawn by the
 * committed build with the demo data (web/server/demo.ts): this machine,
 * host-b online on another darius, host-c unreachable, and ten workspaces of
 * every health. Run under Node and Bun alike.
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

/** The machine bar of a page. */
function stripOf(body: string): string {
  const start = body.indexOf('<nav aria-label="Machines"');
  return start === -1 ? "" : body.slice(start, body.indexOf("</nav>", start));
}

/** Places of a page. */
function placesOf(body: string): string {
  const start = body.indexOf('<nav aria-label="Places"');
  return body.slice(start, body.indexOf("</nav>", start));
}

/** The text of some markup, tags dropped. */
function textOf(html: string): string {
  return html.replaceAll(/<[^>]+>/gu, "").replaceAll("&#x27;", "'");
}

const NOW = Date.parse("2026-11-25T10:00:00.000Z");

test("demo: two other machines, one online and one unreachable; workspaces of every health; the store facts name the same machines", () => {
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
  // Every machine holds what the workspaces place on it, and the system facts agree.
  for (const host of demoFleet(NOW).hosts) {
    const holds = fleet.workspaces.filter((one) => one.places.some((place) => place.host === host.host)).map((one) => one.name);
    assert.deepEqual(host.projects.toSorted(), holds.toSorted(), host.host);
  }
  const system = context.system();
  assert.equal(system.host, "demo");
  assert.equal(system.version, "demo");
  assert.deepEqual(
    system.hosts.map((one) => one.host),
    ["demo", "host-b", "host-c"],
  );
});

test("the machine bar: the label Machines, then state dot, name, this mark and n running; only the versions-differ mark", async () => {
  for (const path of ["/all", "/w/demo-shop/rituals", "/machines", "/workspaces"]) {
    const strip = stripOf((await page(path)).body);
    assert.ok(strip !== "", `${path}: the bar`);
    assert.match(strip, /<span class="hs-label">Machines<\/span>/u, `${path}: the label`);
    for (const host of ["demo", "host-b", "host-c"]) assert.ok(strip.includes(`href="/machines/${host}"`), `${path}: ${host} links to its page`);
    assert.match(strip, /class="hs-this" aria-hidden="true">this<\/span><span class="sr-only">, online, this machine<\/span>/u);
    assert.match(strip, /, online<\/span>/u);
    assert.match(strip, /, unreachable<\/span>/u);
    assert.match(strip, /title="host-c: Unreachable: its darius serve did not answer \(connection refused\)\."/u);
    assert.match(strip, /class="hs-runs"><span aria-hidden="true">\d+<\/span><span class="hs-runs-word" aria-hidden="true"> running<\/span><span class="sr-only">, \d+ open runs?<\/span>/u, "this machine has open runs");
    assert.match(strip, /versions differ/u, "host-b runs another darius");
    const chips = strip.slice(0, strip.indexOf("</ul>"));
    assert.doesNotMatch(chips, /demo-next|hs-ver/u, "no version on a chip");
    assert.doesNotMatch(strip, /aria-current|is-lit|is-self/u, `${path}: no chip is lit`);
    assert.match(strip, /class="hs-check" title="something to check"><span aria-hidden="true">!<\/span><span class="sr-only">, something to check<\/span>/u, `${path}: a machine with something to check shows the mark, no number`);
  }
});

/** The opening tags of the lit chips of a machine bar. */
function lit(strip: string): string[] {
  return [...strip.matchAll(/<a [^>]*class="hs-chip[^"]* is-lit"[^>]*>/gu)].map((match) => match[0]);
}

test("the machine bar lights the chip of the machine whose page is open, and only that one", async () => {
  const strip = stripOf((await page("/machines/host-b")).body);
  const chips = lit(strip);
  assert.equal(chips.length, 1);
  assert.match(chips[0] ?? "", /href="\/machines\/host-b"/u);
  assert.match(chips[0] ?? "", /aria-current="page"/u);
  assert.equal([...strip.matchAll(/aria-current="page"/gu)].length, 1);
  const own = stripOf((await page("/machines/demo")).body);
  assert.match(lit(own).join(""), /href="\/machines\/demo"/u, "this machine is lit on its own page");
  assert.equal(lit(own).length, 1);
  const demo = own.slice(own.indexOf('href="/machines/demo"'), own.indexOf('href="/machines/host-b"'));
  assert.match(demo, /class="hs-this"/u, "this machine keeps its mark");
});

test("Places: three primary rows in order, one lit row, one open branch, one-line workspaces worst first, a foot", async () => {
  const all = placesOf((await page("/all")).body);
  const order = ["Overview", "Machines", "Workspaces"].map((label) => all.indexOf(`<span class="places-name">${label}</span>`));
  assert.ok(order.every((index, at) => index > -1 && (at === 0 || index > (order[at - 1] ?? 0))), "Overview, Machines, Workspaces");
  assert.equal([...all.matchAll(/aria-current="page"/gu)].length, 1, "one lit row");
  assert.match(all, /class="places-row places-primary lit" aria-current="page" href="\/all"|href="\/all"[^>]*class="places-row places-primary lit"/u, "Overview is lit on /all");
  assert.ok(all.includes('href="/vigils"'), "the Overview branch is open on /all");
  assert.match(all, /places-count ink-late">3, 1 unreachable</u, "the Machines row names the worst state");
  assert.doesNotMatch(all, /all clear|places-group|This host/u);
  const names = [...all.matchAll(/class="places-row places-ws[^"]*"[^>]*>.*?<span class="places-name">([^<]+)</gu)].map((match) => match[1]);
  assert.deepEqual(names.slice(0, 3), ["broken-store", "demo-shop", "mail-relay"], "worst health first");
  assert.match(all, /places-dot tone-bad" aria-hidden="true"><\/span>.*?broken-store<\/span><span class="sr-only">, Unreadable<\/span><span class="places-word tone-bad">unreadable<\/span>/u, "unreadable keeps its word");
  assert.match(all, /title="demo-shop: Failing"/u, "the dot has the same health as the Workspaces table");
  assert.match(all, /class="places-foot"><ul class="places-foot-rows">.*Profiles.*Settings/u, "Profiles and Settings sit in the foot");

  const machine = placesOf((await page("/machines/host-b")).body);
  assert.equal([...machine.matchAll(/aria-current="page"/gu)].length, 1);
  assert.match(machine, /class="places-row places-primary lit" aria-current="page"[^>]*>|aria-current="page" href="\/machines"/u);
  assert.doesNotMatch(machine, /href="\/vigils"|href="\/w\/demo-shop\/vigils"/u, "no branch is open on a machine page");

  const ws = placesOf((await page("/w/demo-shop/vigils")).body);
  assert.equal([...ws.matchAll(/aria-current="page"/gu)].length, 1);
  assert.ok(ws.includes('href="/w/demo-shop/vigils"') && !ws.includes('href="/vigils"'), "only the workspace branch is open");
  assert.match(ws, /class="places-row places-ws open"/u);
  assert.match(ws, /class="places-row places-leaf lit" aria-current="page" href="\/w\/demo-shop\/vigils"|href="\/w\/demo-shop\/vigils"[^>]*lit/u);

  const settings = placesOf((await page("/settings")).body);
  assert.doesNotMatch(settings, /places-ws open|href="\/vigils"/u, "Settings opens no branch");
});

test("old addresses answer 301 to the new ones", async () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["/fleet", "/workspaces"],
    ["/fleet?health=failing", "/workspaces?health=failing"],
    ["/topology", "/workspaces"],
    ["/hosts", "/machines"],
    ["/hosts/host-b", "/machines/host-b"],
    ["/status", "/machines/demo"],
  ];
  for (const [from, to] of cases) {
    const { status, location } = await page(from);
    assert.equal(status, 301, from);
    assert.equal(location, to, from);
  }
});

test("/workspaces: the headline with linked counts, the legend, Runs on with the copies, zeros muted, no matrix", async () => {
  const { status, body } = await page("/workspaces");
  assert.equal(status, 200);
  const html = markup(body);
  assert.match(html, /<h1 class="page-title">Workspaces<\/h1>/u);
  assert.match(html, /8 workspaces on 3 machines: <span><a [^>]*href="\/workspaces\?health=ok#workspaces"[^>]*>2 OK<\/a><\/span>/u);
  assert.match(html, /A machine runs a workspace when its project folder is linked there\. A copy only shows the workspace and starts nothing\./u);
  const names = [...html.matchAll(/class="fl-name">([^<]+)</gu)].map((match) => match[1]);
  assert.deepEqual(names.slice(0, 3), ["broken-store", "demo-shop", "mail-relay"], "unreadable, then failing");
  assert.deepEqual(names.slice(-2), ["archive-2025", "old-site"], "quiet last");
  assert.match(html, /<span>Runs on<\/span>/u);
  assert.match(html, /<span class="fl-runs-names">demo<\/span><span class="fl-copies" title="Copies on host-b and host-c"> \+2 copies<\/span>/u);
  assert.match(html, /fl-n is-zero/u, "a zero is muted");
  assert.doesNotMatch(html, /checkout|Placement|fl-matrix|Where</u);
  assert.match(html, /Not copied to this machine yet/u);
  assert.match(html, /big-media/u);
  const failing = markup((await page("/workspaces?health=failing")).body);
  assert.deepEqual(
    [...failing.matchAll(/class="fl-name">([^<]+)</gu)].map((match) => match[1]),
    ["demo-shop", "mail-relay"],
  );
  assert.match(failing, /Only Failing\. Show all/u);
});

test("/all: the Overview line under the date links the health split and the machines", async () => {
  const html = markup((await page("/all")).body);
  assert.match(textOf(html), /10 workspaces: 2 OK, 3 need you, 2 failing, 1 unreadable, 2 quiet\./u);
  assert.ok(html.includes('href="/workspaces?health=failing"'));
  assert.match(html, /<a [^>]*href="\/machines"[^>]*>3 machines: 2 online, 1 unreachable\.<\/a>/u);
});

test("the workspace page: trail, the name as the title with its health, the status sentence, counts and djinns, Needs you with its count", async () => {
  const html = markup((await page("/w/demo-shop")).body);
  assert.match(html, /<nav aria-label="Breadcrumb" class="crumbs"><ol class="crumbs-list"><li class="crumb crumb-back"><a href="\/workspaces"[^>]*>Workspaces<\/a><\/li><li class="crumb crumb-here"><span aria-current="page">demo-shop<\/span>/u);
  assert.match(html, /<h1 class="page-title ws-title">.*?<span class="ws-title-name">demo-shop<\/span><span class="fl-health tone-bad">/u);
  assert.match(textOf(html), /Failing: 2 high candles lit, 2 vigils flagged, 1 run failed and 4 more\. Runs on demo\. Copies on host-b and host-c\./u);
  assert.ok(html.indexOf("ws-sentence") < html.indexOf("fl-counts"), "the counts follow the sentence");
  for (const label of ["Rituals", "Vigils", "Candles", "Findings"]) assert.ok(html.includes(`fl-count-label">${label}<`), label);
  assert.match(html, /lives on host-b<\/span><span class="text-muted"> \(pinned\)/u, "a pinned djinn names its machine");
  assert.match(html, /<span>lives here<\/span><\/span>/u, "a djinn of this machine says lives here, and nothing about a checkout");
  assert.doesNotMatch(textOf(html), /runs here|runs on host-b/u, "a djinn lives on a machine; it does not run there");
  assert.doesNotMatch(html, /verdict-h|\(checkout\)|Lives on/u);
  assert.match(html, /Needs you, \d+/u);
  const copy = textOf(markup((await page("/w/infra-notes")).body));
  assert.match(copy, /Runs on host-b\. This machine shows a copy, synced /u);
  const list = markup((await page("/w/demo-shop/vigils")).body);
  assert.match(list, /href="\/workspaces"[^>]*>Workspaces<\/a>/u, "a section page starts its trail with Workspaces");
});

test("/machines: the sentence, the versions warning, one block per machine with the workspaces it runs and the djinns that live there", async () => {
  const { status, body } = await page("/machines");
  assert.equal(status, 200);
  const html = markup(body);
  assert.match(textOf(html), /3 machines: 2 online, 1 unreachable\. 3 runs are open now on the machines that answered\./u);
  assert.match(html, /The machines run different darius versions: demo, demo-next\./u);
  const blocks = html.split('<li class="mb panel">').slice(1);
  assert.equal(blocks.length, 3, "one block per machine");
  const [demo = "", hostB = "", hostC = ""] = blocks;
  assert.match(demo, /<h2 class="mb-name"><a href="\/machines\/demo"[^>]*>demo<\/a><\/h2><span class="mt-this">this machine<\/span>/u, "the name links to the page, with the mark");
  assert.match(hostB, /<a class="mb-check" href="\/machines\/host-b#attention"[^>]*>3 to check<\/a>/u, "the count links to the list on the machine page");
  assert.doesNotMatch(demo, /to check/u, "nothing to check on this machine");
  assert.match(textOf(hostB), /host-b is online\. It runs 2 workspaces \(infra-notes, archive-2025\) and shows a copy of 1\./u, "the machine sentence");
  // The two lists: a heading with the count and the order, then a table with header cells.
  assert.match(textOf(hostB), /Workspaces it runs \(2\)worst first/u);
  assert.match(textOf(hostB), /Djinns that live here \(2\)needs a look first, then last run, newest first/u);
  assert.deepEqual([...hostB.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/gu)].map((match) => match[1]), ["State", "Workspace", "Djinns here", "Last run here", "State", "Djinn", "Last run", "Next"]);
  assert.match(hostB, /<span class="lt-word tone-wait"><span class="fl-dot" aria-hidden="true"><\/span>Needs you<\/span>.*?<a class="lt-title lt-link" title="infra-notes" href="\/w\/infra-notes"/su, "a workspace with its health dot and word, the row links to it");
  assert.match(textOf(hostB), /Also shows a copy of 1: demo-shop\./u, "the copies in one muted line");
  assert.match(hostB, /<span class="lt-word tone-wait"><span class="fl-dot" aria-hidden="true"><\/span>held<\/span>.*?<a class="lt-title lt-link" title="Price sync \(djinn\)" href="\/w\/demo-shop\/rituals\/price-sync"/su, "a djinn links to its ritual with its state word");
  assert.match(textOf(hostB), /Price sync \(djinn\)demo-shop pinned/u, "the workspace beside the title, and the pinned mark");
  assert.doesNotMatch(hostB, /and \d+ more/u, "two djinns fit");
  assert.match(demo, /and 1 more<\/a>/u, "this machine runs more than six workspaces");
  assert.match(demo, /href="\/machines\/demo#djinns"[^>]*>and 2 more<\/a>/u, "and more than eight djinns");
  // The order of the djinns: the ones that need a look first, the oldest due first.
  const djinns = demo.slice(demo.indexOf("Djinns that live here"));
  const states = [...djinns.matchAll(/<td class="lt-c lt-state"><span class="lt-word tone-[a-z]+"><span class="fl-dot[^"]*" aria-hidden="true"><\/span>([^<]+)<\/span>/gu)].map((match) => match[1]);
  assert.deepEqual(states.slice(0, 2), ["late", "due today"]);
  assert.ok(states.includes("asks you") && states.includes("failed") && states.includes("running"), states.join(", "));
  assert.match(textOf(hostC), /host-c did not answer/u);
  assert.match(hostC, /title="status-page" href="\/w\/status-page"/u, "host-c runs one workspace");
  assert.match(demo, /<dt>darius<\/dt><dd><span>demo<\/span><\/dd>/u, "a version that matches is plain");
  assert.match(hostB, /<span class="ink-late">demo-next, differs<\/span>/u);
  assert.match(html, /title="did not answer"/u, "an unknown value is a muted dash");
  assert.doesNotMatch(textOf(html), /\bnone\b/u, "an empty cell is a dash, never the word none");
  assert.match(html, /<dt>Last ledger line<\/dt>/u);
  assert.equal(blocks.filter((one) => one.includes("<dt>Load</dt>")).length, 3);
});

test("/machines/:host: trail, title, the sentence, needs attention, facts, Runs here, Copies, recent runs, djinns; this machine adds Store and disks", async () => {
  const b = markup((await page("/machines/host-b")).body);
  assert.match(b, /<a href="\/machines"[^>]*>Machines<\/a>/u);
  assert.match(textOf(b), /host-b is online\. It runs 2 workspaces \(infra-notes, archive-2025\) and shows a copy of 1\. 1 run is open now\. 2 djinns live here; the last one ran /u);
  assert.match(b, /Needs attention/u);
  assert.match(textOf(b), /It runs darius demo-next, and this machine runs demo\. Run darius update --hosts\./u);
  assert.match(textOf(b), /Its backup is stale: no upload for 50 h\./u);
  for (const label of ["darius", "Up", "Load", "Box check", "Last seen", "Last backup"]) assert.ok(b.includes(`<dt>${label}</dt>`), label);
  assert.match(b, /Workspaces on this machine/u);
  assert.match(textOf(b), /Runs here \(2\)worst first/u);
  assert.match(textOf(b), /Copies \(1\)by name/u);
  const runsHere = b.slice(b.indexOf("Runs here"), b.indexOf('id="copies"'));
  assert.deepEqual([...runsHere.matchAll(/class="lt-title lt-link" title="([^"]+)"/gu)].map((match) => match[1]), ["infra-notes", "archive-2025"], "only the ones it runs, worst first");
  assert.match(b, /<ul class="lt-copies"><li class="tone-bad"><span class="fl-dot" aria-hidden="true"><\/span><a href="\/w\/demo-shop"[^>]*>demo-shop<\/a><span class="lt-copy-word">Failing<\/span><\/li>/u, "a copy: the dot, the name as the link, then the health word when it is not OK");
  const self0 = markup((await page("/machines/demo")).body);
  assert.match(self0, /<li class="tone-ok"><span class="fl-dot" aria-hidden="true"><\/span><a href="\/w\/status-page"[^>]*>status-page<\/a><span class="sr-only">, OK<\/span><\/li>/u, "an OK copy shows no word");
  assert.ok(b.includes("Price sync (djinn)") && b.includes("Certificate scan (djinn)"));
  assert.match(textOf(b), /Recent runs here/u);
  assert.match(b, /Recent runs on host-b, newest first/u, "the runs that ran on host-b");
  assert.match(textOf(b.slice(b.indexOf("Recent runs here"))), /by operator/u, "a run started by hand says who");
  assert.doesNotMatch(b, /Store and disks|checkout/u, "Store and disks is only on the page of this machine");

  const c = markup((await page("/machines/host-c")).body);
  assert.match(textOf(c), /host-c did not answer \(connection refused\)\. Its last ledger line is 12 min old\. /u);
  assert.match(textOf(c), /Its darius serve did not answer \(connection refused\)\./u);

  const self = await page("/machines/demo");
  assert.equal(self.status, 200);
  const html = markup(self.body);
  assert.match(textOf(html), /demo is this machine, the one that serves this page\./u);
  assert.doesNotMatch(html, /Needs attention/u, "nothing needs attention on this machine");
  for (const text of ["Store and disks", "Store disk", "Backups disk", "Projects and syncs", "Open the backups", "Running now", "Djinns that live here", "Details: live facts, ledgers, versions", "demo-old", "bun 1.3.0"]) assert.ok(html.includes(text), text);
  assert.match(html, /<h3 class="fl-group-name"><a href="\/w\/demo-shop"[^>]*>demo-shop<\/a><\/h3>/u, "Running now is grouped by workspace");
  // One djinn list, every djinn of the machine, the workspace under the title.
  const djinns = html.slice(html.indexOf('id="djinns"'));
  assert.equal([...djinns.slice(0, djinns.indexOf("</table>")).matchAll(/<tr class="lt-row/gu)].length, 10, "all ten, no limit per workspace");
  assert.doesNotMatch(djinns.slice(0, djinns.indexOf("</table>")), /lt-below/u, "one line per djinn on a desktop");
  assert.doesNotMatch(textOf(djinns.slice(0, djinns.indexOf("</table>"))), /\bcomplete\b[^|]*\bcomplete\b \d/u);
  assert.match(djinns, /<span class="lt-word tone-idle"><span class="fl-dot is-hollow" aria-hidden="true"><\/span>ok<\/span>/u, "a djinn with nothing to say is a muted ok");
  // Projects and syncs: one table, the largest first, zeros as dashes.
  const projects = html.slice(html.indexOf("Projects and syncs, the largest first"));
  assert.deepEqual([...projects.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/gu)].map((match) => match[1]).slice(0, 6), ["Workspace", "Size", "Rituals", "Vigils", "Runs", "Synced"]);
  const sizes = [...projects.slice(0, projects.indexOf("</table>")).matchAll(/data-label="Size">([^<]+)</gu)].map((match) => match[1] ?? "");
  assert.equal(sizes[0], "30 MiB", "the largest first");
  assert.match(projects, /<span class="lt-dash">-<\/span>/u);
  assert.doesNotMatch(html, /host-a|0\.44\.0/u, "the store facts are of the same demo machine");
  assert.equal((await page("/machines/nowhere")).status, 404);
});

test("every list of the machine pages shows at most five rows per workspace, then the total", () => {
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
  assert.equal(line.lead, "8 workspaces on 3 machines");
  assert.deepEqual(line.quiet?.text, "2 quiet");
});

test("/runs: a short mark sits beside the title, a long one on a muted line under it, both inside the Run cell", async () => {
  const html = markup((await page("/runs")).body);
  assert.match(html, /<span class="lt-marks"><span class="lt-mark">by operator<\/span><\/span><\/div><\/td>/u, "a short mark beside the title");
  assert.match(html, /<div class="lt-sub"><span class="lt-sub-text"><span class="lt-mark">follow-up of <a class="lt-above" href="\/w\/demo-shop\/runs\/[0-9A-Z]+"[^>]*>[0-9A-Z]{8}<\/a><\/span><span class="lt-mark">, from the web<\/span><\/span><\/div><\/td>/u, "a long mark under it, in the same cell");
});
