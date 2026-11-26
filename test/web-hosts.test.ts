/**
 * The machine bar, Places, Workspaces, Machines, one machine and the head of
 * a workspace (0.139.0, reworked in 0.140.0, 0.141.0 and 0.143.0), drawn
 * by the committed build with the demo data (web/server/demo.ts): this
 * machine, host-b online on another darius, host-c unreachable, host-d
 * online with nothing to look at, and ten workspaces of every health. Run
 * under Node and Bun alike.
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
const { demoContext, demoFleet, demoPeers, demoStatus, demoWorkspaces } = await import("../web/server/demo.ts");
const { needCounts } = await import("../web/app/lib/home.ts");
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

test("demo: three other machines, two online and one unreachable; workspaces of every health; the store facts name the same machines", () => {
  assert.deepEqual(
    demoPeers(NOW).map((peer) => [peer.host, peer.state]),
    [
      ["demo", "self"],
      ["host-b", "online"],
      ["host-c", "unreachable"],
      ["host-d", "online"],
    ],
  );
  assert.deepEqual(
    demoFleet(NOW).hosts.map((host) => host.host),
    ["demo", "host-b", "host-c", "host-d"],
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
    ["demo", "host-b", "host-c", "host-d"],
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
  assert.match(all, /places-count ink-late">4, 1 unreachable</u, "the Machines row names the worst state");
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
  assert.match(html, /8 workspaces on \d machines: <span><a [^>]*href="\/workspaces\?health=ok#workspaces"[^>]*>2 OK<\/a><\/span>/u);
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
  assert.match(html, /<a [^>]*href="\/machines"[^>]*>4 machines: 3 online, 1 unreachable\.<\/a>/u);
});

test("the workspace page: trail, the name as the title with its health, the status sentence, counts and the rituals darius starts, Needs you with its count", async () => {
  const html = markup((await page("/w/demo-shop")).body);
  assert.match(html, /<nav aria-label="Breadcrumb" class="crumbs"><ol class="crumbs-list"><li class="crumb crumb-back"><a href="\/workspaces"[^>]*>Workspaces<\/a><\/li><li class="crumb crumb-here"><span aria-current="page">demo-shop<\/span>/u);
  assert.match(html, /<h1 class="page-title ws-title">.*?<span class="ws-title-name">demo-shop<\/span><span class="fl-health tone-bad">/u);
  assert.match(textOf(html), /Failing: 2 high candles lit, 2 vigils flagged, 1 run failed and 4 more\. Runs on demo\. Copies on host-b and host-c\./u);
  assert.ok(html.indexOf("ws-sentence") < html.indexOf("fl-counts"), "the counts follow the sentence");
  for (const label of ["Rituals", "Vigils", "Candles", "Findings"]) assert.ok(html.includes(`fl-count-label">${label}<`), label);
  assert.match(html, /<span class="fl-runs-on">only on host-b<\/span>/u, "a pinned ritual names its only machine");
  assert.match(html, /<span>runs here<\/span><\/span>/u, "a ritual of this machine says runs here, and nothing about a checkout");
  assert.match(html, /<span class="label">Rituals darius starts<\/span>/u, "the row is a ritual; djinn is no heading");
  assert.doesNotMatch(textOf(html), /lives here|lives on|\(pinned\)|\d+ djinns?\b/u, "no djinn count, no pinned mark");
  assert.doesNotMatch(html, /verdict-h|\(checkout\)|Lives on/u);
  assert.match(html, /Needs you, \d+/u);
  const copy = textOf(markup((await page("/w/infra-notes")).body));
  assert.match(copy, /Runs on host-b\. This machine shows a copy, synced /u);
  const list = markup((await page("/w/demo-shop/vigils")).body);
  assert.match(list, /href="\/workspaces"[^>]*>Workspaces<\/a>/u, "a section page starts its trail with Workspaces");
});

/** Where a piece of markup sits in a block. */
function placeOf(block: string, needle: string): number {
  return block.indexOf(needle);
}

test("/machines: machines then rituals in the headline, words defined in view, then one block per machine: sentence, Needs a look, workspaces with the need-you count, rituals on schedule, facts", async () => {
  const { status, body } = await page("/machines");
  assert.equal(status, 200);
  const html = markup(body);
  const text = textOf(html);
  assert.match(text, /3 of 4 machines are online\. 4 machine problems need a look: host-b, host-c\. 6 rituals need a look: 5 on demo, 1 on host-b\./u);
  assert.match(html, /<a href="\/machines#look-host-c-unreachable"[^>]*>host-c<\/a>/u, "a machine with a problem links to its first item");
  assert.match(html, /<a href="\/machines#machine-demo"[^>]*>5 on demo<\/a>/u, "the rituals by machine, each a link to its block");
  assert.ok(html.includes('id="look-demo-late-atlas-docs-sitemap-check"') && html.includes('id="look-host-c-unreachable"'), "the anchors exist");
  const headline = /<p class="fl-headline">(.*?)<\/p>/su.exec(html)?.[1] ?? "";
  assert.doesNotMatch(textOf(headline), /things? need|workspace/u, "no rival total, no workspace count in the headline");
  assert.match(html, /<\/p><p class="def-line"><span>A <strong class="def-word">ritual<\/strong> is recurring work that darius starts by itself, on a schedule\.<\/span><span> A <strong class="def-word">workspace<\/strong> is a project that darius tracks\.<\/span><\/p>/u, "the two words defined right under the headline, each word in semibold");
  assert.match(html, /The machines run different darius versions: demo, demo-next\./u);
  const blocks = html.split('<li class="mb panel"').slice(1);
  assert.equal(blocks.length, 4, "one block per machine");
  const [demo = "", hostB = "", hostC = "", hostD = ""] = blocks;
  assert.match(demo, /<h2 class="mb-name"><a href="\/machines\/demo"[^>]*>demo<\/a><\/h2><span class="mt-this">this machine<\/span>/u, "the name links to the page, with the mark");
  assert.ok(placeOf(demo, "mb-sentence") < placeOf(demo, "Rituals that need a look (5)") && placeOf(demo, "Rituals that need a look (5)") < placeOf(demo, "Workspaces it runs") && placeOf(demo, "Workspaces it runs") < placeOf(demo, "On schedule") && placeOf(demo, "On schedule") < placeOf(demo, "mb-facts"));
  assert.match(textOf(demo), /demo runs 7 workspaces and starts 10 rituals for them\. 2 runs are running now; the last run started /u, "two short sentences");
  // Needs a look: rituals, then the machine itself; each count is the rows under it; one button each.
  const leads = [...demo.matchAll(/<strong class="nl-lead">([^<]+): <\/strong>/gu)].map((match) => match[1]);
  assert.deepEqual(leads, ["Waits for your answer", "Failed", "Failed", "Failed", "Late"], "no workspace card: health is in the table");
  assert.match(textOf(demo), /Late: Sitemap check, atlas-docs\. It was due on \d+ \w+; it has not run yet\.Open ritual/u);
  assert.match(demo, /<a class="nl-action" href="\/w\/mail-relay\/runs\/[0-9A-Z]+"[^>]*>Open run<\/a>/u, "the next step is a button");
  assert.match(hostB, /Waits for your answer: <\/strong><span>Price sync, demo-shop\. <\/span><span>It asked 2 questions <\/span>.*?<a class="nl-action" href="\/w\/demo-shop\/runs\/[0-9A-Z]+"[^>]*>Answer<\/a>/su, "a held run waits for your answer");
  assert.match(textOf(hostB), /The machine itself \(3\)A sandbox check is a test that the run sandbox on this machine works\./u, "the word is defined before the items that use it");
  assert.match(textOf(hostB), /Sandbox check failed: Its last sandbox check failed\. Run darius box check\.Open machine/u);
  assert.match(textOf(hostC), /Did not answer: Its darius serve did not answer \(connection refused\)\./u);
  assert.match(hostD, /<p class="nl-none">Nothing needs a look here\.<\/p>/u, "a machine with nothing to look at says so in one line");
  // The workspaces: the Why starts with the same count as the badge in Places.
  const places = placesOf(body);
  const shopBadge = /<span class="places-name">demo-shop<\/span><span class="sr-only">[^<]*<\/span><span class="tab-bdg tone-wait" title="(\d+) need you">/u.exec(places)?.[1];
  assert.ok(shopBadge !== undefined, "demo-shop has a badge in Places");
  assert.match(demo, new RegExp(`data-label="Why"><span>${shopBadge ?? "x"} items need you: </span><a class="lt-above lt-why-link" href="/w/demo-shop/runs"[^>]*>2 runs to answer</a>`, "u"), "the Why cell and the badge show one number");
  assert.match(textOf(demo), /demo-shop8 items need you: 2 runs to answer, 1 failed ritual, 2 flagged vigils, 3 lit candles3running/u, "exactly the parts of the count, no health reason");
  assert.match(textOf(demo), /mail-relay1 ritual failed twice1failed/u, "a workspace with nothing that needs you keeps its health reasons");
  assert.match(textOf(demo), /Workspaces it runs \(7\)worst firstA vigil is a one-time check that waits for a date or an event\. A candle is a problem that needs your decision\./u, "the words of the rows, defined before the rows");
  assert.deepEqual([...hostB.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/gu)].map((match) => match[1]), ["Health", "Workspace", "Why", "Rituals", "Last run", "Ritual", "Workspace", "Last run", "Next"]);
  assert.match(hostB, /<td class="lt-c lt-text lt-wrap" data-label="Why"><span>no activity in 14 days<\/span><\/td><td class="lt-c lt-num" data-label="Rituals"><span class="lt-muted">none<\/span><\/td>/u, "no need-you count: only the reasons; none when no ritual");
  assert.match(textOf(hostB), /Also keeps a copy of 1 workspace that runs on other machines: demo-shop\./u, "the copies in one muted line");
  // The rituals on schedule: no State column, never one of Needs a look again, next due first, at most five.
  assert.match(textOf(demo), /On schedule \(5 of 10\)next due first/u);
  const quiet = demo.slice(demo.indexOf("lt-rituals"), demo.indexOf("</table>", demo.indexOf("lt-rituals")));
  assert.doesNotMatch(quiet, /Sitemap check|Bounce scan|lt-state/u);
  assert.match(quiet, /<td class="lt-c lt-name lt-wrap">/u, "a title wraps, never cut");
  assert.match(hostC, /<span class="lt-word-muted">complete<\/span>/u, "complete is muted");
  assert.match(textOf(hostD), /host-d runs no workspace\. Nothing is running now\./u);
  assert.doesNotMatch(text.slice(0, text.indexOf("What do these words mean?")), /[Dd]jinn|lives here|\bpinned\b|[Aa]sks you|\bheld\b|\bok\b|\bBox check|ledger line|shows a copy/u, "the old words are gone, djinn included; only the words list defines it");
  // The foot: facts with meaning, the clock, the words.
  assert.match(demo, /<dt>darius<\/dt><dd><span>demo<\/span><\/dd>/u, "a version that matches is plain");
  assert.match(hostB, /<span class="ink-late">demo-next, differs<\/span>/u);
  assert.match(html, /title="did not answer"/u, "an unknown value is a muted dash");
  for (const label of ["Load (1, 5, 15 min)", "Sandbox check", "Last activity"]) assert.equal(blocks.filter((one) => one.includes(`<dt>${label}</dt>`)).length, 4, label);
  assert.match(html, /<p class="time-note">Times are in UTC[+-]\d\d:\d\d, the zone of the machine that serves this page; now <time[^>]*>\w{3} \d\d:\d\d<\/time>\.<\/p>/u);
  assert.match(html, /<details class="terms"><summary>What do these words mean\?<\/summary>.*<dt>finding<\/dt>/su);
});

test("/machines/:host: trail, title, the sentence, Needs a look first, facts, Runs here, Copies, rituals on schedule, recent runs; this machine adds Store and disks", async () => {
  const b = markup((await page("/machines/host-b")).body);
  assert.match(b, /<a href="\/machines"[^>]*>Machines<\/a>/u);
  assert.match(textOf(b), /host-b runs 2 workspaces and starts 2 rituals for them\. 1 run waits for your answer now; the last run started /u);
  assert.match(b, /<p class="def-line"><span>A <strong class="def-word">ritual<\/strong> is recurring work/u);
  assert.doesNotMatch(textOf(b.slice(0, b.indexOf('<details class="terms">'))), /djinn/iu, "no djinn on a machine page but in the words list");
  assert.match(b, /id="look"/u);
  assert.ok(b.indexOf('id="look"') < b.indexOf("mp-facts"), "Needs a look comes first");
  assert.match(textOf(b), /Other darius version: It runs darius demo-next, and this machine runs demo\. Run darius update --hosts\./u);
  assert.match(textOf(b), /Backup stale: Its backup is stale: no upload for 50 h\./u);
  assert.doesNotMatch(b, /Open machine/u, "a machine item has no link to the page it is on");
  assert.match(textOf(b), /Needs a lookRituals that need a look \(1\).*The machine itself \(3\)/su);
  for (const label of ["darius", "Up", "Load (1, 5, 15 min)", "Sandbox check", "Last activity", "Last backup"]) assert.ok(b.includes(`<dt>${label}</dt>`), label);
  assert.match(b, /Workspaces on this machine/u);
  assert.match(textOf(b), /Runs here \(2\)worst first/u);
  assert.match(textOf(b), /Copies \(1\)by name; they run on other machines/u);
  const runsHere = b.slice(b.indexOf("Runs here"), b.indexOf('id="copies"'));
  assert.deepEqual([...runsHere.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/gu)].map((match) => match[1]), ["Health", "Workspace", "Why", "Rituals", "Open runs", "Last run"]);
  assert.deepEqual([...runsHere.matchAll(/class="lt-title lt-link" title="([^"]+)"/gu)].map((match) => match[1]), ["infra-notes", "archive-2025"], "only the ones it runs, worst first");
  assert.match(b, /<ul class="lt-copies"><li class="tone-bad"><span class="fl-dot" aria-hidden="true"><\/span><a href="\/w\/demo-shop"[^>]*>demo-shop<\/a><span class="lt-copy-word">Failing<\/span><\/li>/u, "a copy: the dot, the name as the link, then the health word when it is not OK");
  const self0 = markup((await page("/machines/demo")).body);
  assert.match(self0, /<li class="tone-ok"><span class="fl-dot" aria-hidden="true"><\/span><a href="\/w\/status-page"[^>]*>status-page<\/a><span class="sr-only">, OK<\/span><\/li>/u, "an OK copy shows no word");
  assert.match(textOf(b), /Rituals that darius starts here \(2\)/u);
  assert.match(textOf(b), /On schedule \(1 of 2\)next due first/u);
  assert.ok(b.includes("Price sync") && b.includes("Certificate scan"));
  assert.match(textOf(b), /Recent runs here/u);
  assert.match(b, /Recent runs on host-b, newest first/u, "the runs that ran on host-b");
  const recent = b.slice(b.indexOf("Recent runs on host-b"));
  assert.match(recent, /<span class="lt-word tone-wait"><span class="fl-dot" aria-hidden="true"><\/span>waits for your answer<\/span>/u, "a held run says the word of the machine lists");
  assert.doesNotMatch(textOf(recent.slice(0, recent.indexOf("</table>"))), /\bHeld\b|Asks you/u);
  assert.match(textOf(recent), /by operator/u, "a run started by hand says who");
  assert.doesNotMatch(b, /Store and disks|checkout/u, "Store and disks is only on the page of this machine");
  assert.match(b, /<details class="terms">/u);

  const c = markup((await page("/machines/host-c")).body);
  assert.match(textOf(c), /host-c did not answer \(connection refused\)\. Its last activity is 12 min old\. /u);
  assert.match(textOf(c), /Did not answer: Its darius serve did not answer \(connection refused\)\./u);

  const d = markup((await page("/machines/host-d")).body);
  assert.match(textOf(d), /Needs a lookNothing needs a look here\./u);

  const self = await page("/machines/demo");
  assert.equal(self.status, 200);
  const html = markup(self.body);
  assert.match(html, /<span class="mt-this">this machine<\/span>/u);
  for (const text of ["Store and disks", "Store disk", "Backups disk", "Projects and syncs", "Open the backups", "Running now", "Rituals that darius starts here", "Details: live facts, ledgers, versions", "demo-old", "bun 1.3.0"]) assert.ok(html.includes(text), text);
  assert.match(html, /<h3 class="fl-group-name"><a href="\/w\/demo-shop"[^>]*>demo-shop<\/a><\/h3>/u, "Running now is grouped by workspace");
  // The rituals on schedule: all of them on a machine page, none of Needs a look.
  const rituals = html.slice(html.indexOf('id="rituals"'));
  const table = rituals.slice(0, rituals.indexOf("</table>"));
  const look = [...html.matchAll(/<li id="look-demo-(?:waits|failed|late)-[^"]+"/gu)].length;
  assert.equal([...table.matchAll(/<tr class="lt-row/gu)].length + look, 10, "every ritual is in one of the two lists");
  assert.doesNotMatch(table, /lt-state|\bok\b/u, "no State column, no ok");
  // Projects and syncs: one table, the largest first, zeros as dashes.
  const projects = html.slice(html.indexOf("Projects and syncs, the largest first"));
  assert.deepEqual([...projects.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/gu)].map((match) => match[1]).slice(0, 6), ["Workspace", "Size", "Rituals", "Vigils", "Runs", "Synced"]);
  const sizes = [...projects.slice(0, projects.indexOf("</table>")).matchAll(/data-label="Size">([^<]+)</gu)].map((match) => match[1] ?? "");
  assert.equal(sizes[0], "30 MiB", "the largest first");
  assert.match(projects, /<span class="lt-dash">-<\/span>/u);
  assert.doesNotMatch(html, /host-a|0\.44\.0/u, "the store facts are of the same demo machine");
  assert.equal((await page("/machines/nowhere")).status, 404);
});

test("the Why of every demo workspace: the parts sum to the need-you count of its badge", () => {
  const counts = needCounts(demoStatus(NOW));
  const names = Object.keys(counts.byProject);
  assert.ok(names.length >= 8);
  for (const name of names) assert.equal((counts.partsByProject[name] ?? []).reduce((sum, part) => sum + part.count, 0), counts.byProject[name], name);
  assert.ok(names.some((name) => (counts.byProject[name] ?? 0) > 1), "a workspace with more than one thing");
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
