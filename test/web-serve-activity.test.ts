/**
 * The Activity place over a real store (0.94.0): the real WebContext reads
 * seeded projects, and the committed app build renders `/activity` and
 * `/w/<ws>/activity`. Places must list Activity as the seventh place and the
 * phone tab bar must keep its five tabs. The page must lead each entry with
 * its kind word and title, link a run in its own workspace, show a pending
 * start once and on top, validate the query, cap the all-workspaces page at
 * 500 entries, and widen the window through "Show older".
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs } from "../src/cli/args.ts";
import type { ParsedArgs } from "../src/cli/registry.ts";
import { ritualCommand } from "../src/cli/ritual.ts";
import { appendLine, appendLines } from "../src/core/ledger.ts";
import { openProject } from "../src/core/store.ts";
import { addVigil } from "../src/core/sweep.ts";
import { ulid } from "../src/core/ulid.ts";
import type { WebHandler } from "../src/web/api.ts";
import { recordPending } from "../src/web/pending.ts";
import { webContext } from "../src/web/context.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-web-serve-activity-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
process.env.DARIUS_TAILSCALE = join(SANDBOX, "no-tailscale");

const built: { default: WebHandler } = await import("../web/build/server/index.js");

const ALPHA = "m2-alpha";
const BETA = "m2-beta";
const SELFTEST = "darius-selftest";
const DAY_MS = 24 * 3_600_000;
const BULK = 600;

async function ritual(project: string, slug: string, title: string): Promise<void> {
  const args: ParsedArgs = parseArgs(["add", slug, "--title", title, "--cadence", "1d", "--project", project]);
  const { log } = console;
  console.log = () => undefined;
  try {
    assert.equal(await ritualCommand.run(args), 0);
  } finally {
    console.log = log;
  }
}

const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();

/** Two workspaces: alpha has an answered ask, a vigil that was checked and paused, aged events and a start that shows no run; beta has a note and a long run of old notes (past the cap). */
async function seed(): Promise<{ alphaRun: string; betaRun: string }> {
  await ritual(ALPHA, "heartbeat", "Heartbeat");
  await ritual(ALPHA, "aged", "Aged");
  await ritual(BETA, "nightly", "Nightly");
  await ritual(BETA, "bulk", "Bulk");
  const alpha = openProject(ALPHA);
  const beta = openProject(BETA);
  addVigil(alpha, { slug: "guard", title: "Guard", body: "# g\n\n## Verification Checklist\n\n- [ ] up\n  - Command: `true`\n  - Expected: `exit 0`\n", due: "2026-10-01", heavy: false, who: "test" });
  const alphaRun = ulid();
  const betaRun = ulid();
  appendLine(alpha, { who: "timer", type: "run.started", item: "ritual/heartbeat", run: alphaRun, at: ago(2 * 3_600_000) });
  appendLine(alpha, { who: "timer", type: "run.completed", item: "ritual/heartbeat", run: alphaRun, outcome: "complete", at: ago(3_600_000) });
  appendLine(alpha, { who: "web:altan", type: "run.acknowledged", item: "ritual/heartbeat", run: alphaRun, note: "looked fine", at: ago(1_800_000) });
  appendLine(alpha, { who: "web:altan", type: "vigil.paused", item: "vigil/guard", until: "2026-10-20", reason: "waiting for the release", at: ago(900_000) });
  appendLine(alpha, { who: "web:altan", type: "run.acknowledged", item: "ritual/aged", run: ulid(), note: "twenty days old", at: ago(20 * DAY_MS) });
  appendLine(alpha, { who: "web:altan", type: "run.acknowledged", item: "ritual/aged", run: ulid(), note: "sixty days old", at: ago(60 * DAY_MS) });
  appendLine(beta, { who: "cli", type: "run.started", item: "ritual/nightly", run: betaRun, at: ago(600_000) });
  appendLine(beta, { who: "cli", type: "run.completed", item: "ritual/nightly", run: betaRun, outcome: "failed", at: ago(300_000) });
  // Old notes of the bulk ritual: BULK lines, each a minute older than the last, from 2 days ago.
  appendLines(
    beta,
    Array.from({ length: BULK }, (_, index) => ({ who: "web:altan", type: "run.acknowledged", item: "ritual/bulk", run: ulid(), note: `bulk note ${index}`, at: ago(2 * DAY_MS + index * 60_000) })),
  );
  // A start the web asked for that shows no run yet.
  recordPending({ at: new Date().toISOString(), who: "web:altan", kind: "run-now", project: ALPHA, ritual: "heartbeat", host: "host-b", log: join(SANDBOX, "none.log"), offset: 0 });
  // The self-test workspace has one event; the plain page leaves it out.
  await ritual(SELFTEST, "probe", "Probe");
  appendLine(openProject(SELFTEST), { who: "web:altan", type: "run.acknowledged", item: "ritual/probe", run: ulid(), note: "selftest event", at: ago(60_000) });
  return { alphaRun, betaRun };
}

const { alphaRun, betaRun } = await seed();

async function page(path: string, cookie?: string): Promise<string> {
  const headers = cookie === undefined ? undefined : { cookie };
  const response = await built.default(new Request(`http://darius.test${path}`, { headers }), webContext("owner on phone", "bm9uY2U="));
  assert.equal(response.status, 200, path);
  return response.text();
}

const text = (html: string): string => html.replaceAll(/<script\b[\s\S]*?<\/script>/gu, " ").replaceAll(/<[^>]*>/gu, " ").replaceAll("&quot;", '"').replaceAll(/\s+/gu, " ").replaceAll(" :", ":");
const count = (haystack: string, needle: RegExp): number => haystack.match(needle)?.length ?? 0;
const tabs = (html: string): string => /<nav aria-label="Tabs"[\s\S]*?<\/nav>/u.exec(html)?.[0] ?? "";
const places = (html: string): string => /<nav aria-label="Places"[\s\S]*?<\/nav>/u.exec(html)?.[0] ?? "";

test("Places lists Activity after Runs for the scope you are in, and lights it on the page", async () => {
  const html = await page(`/w/${ALPHA}/activity`);
  const nav = places(html);
  const labels = [...nav.matchAll(/class="places-row places-leaf( lit)?"[^>]*>[\s\S]*?<span class="places-name">([^<]+)<\/span>/gu)].map((match) => `${match[2]}${match[1] === undefined ? "" : "*"}`);
  assert.deepEqual(labels.slice(0, 7), ["Overview", "Vigils", "Rituals", "Findings", "Milestones", "Runs", "Activity*"]);
  assert.ok(nav.includes(`href="/w/${ALPHA}/activity"`));
  const all = places(await page("/activity"));
  assert.ok(all.includes('href="/activity"'), "all workspaces has the row too");
  assert.ok(places(await page(`/w/${ALPHA}`)).includes(`href="/w/${ALPHA}/activity"`), "an overview lists it, not lit");
});

test("the phone tab bar keeps its five tabs, and Activity lights none of them", async () => {
  const bar = tabs(await page(`/w/${ALPHA}/activity`));
  assert.equal(count(bar, /<a /gu), 5);
  assert.equal(bar.includes("/activity"), false);
  assert.equal(bar.includes("tab on"), false, "no tab is lit");
});

test("an entry starts with the kind word and the title, and the sentence follows in lower case", async () => {
  const body = text(await page(`/w/${ALPHA}/activity`));
  assert.match(body, /\d\d:\d\d ritual Heartbeat: noted by web:altan: looked fine/u);
  assert.match(body, /\d\d:\d\d vigil Guard: paused by web:altan until 2026-10-20: waiting for the release/u);
  assert.match(body, /ritual Heartbeat: run completed/u);
  assert.equal(body.includes("(m2-alpha)"), false, "a workspace page does not repeat the workspace");
  assert.equal(body.includes("twenty days old"), false, "outside the 7 days");
});

test("the title links to its ritual or vigil, and a run link opens the run in the entry's own workspace", async () => {
  const html = await page("/activity");
  assert.ok(html.includes(`href="/w/${ALPHA}/rituals/heartbeat"`));
  assert.ok(html.includes(`href="/w/${ALPHA}/vigils/guard"`));
  assert.ok(html.includes(`href="/w/${ALPHA}/runs/${alphaRun}"`));
  assert.ok(html.includes(`href="/w/${BETA}/runs/${betaRun}"`), "a run of beta opens in beta, not in the page's scope");
  assert.equal(html.includes(`href="/w/${ALPHA}/runs/${betaRun}"`), false);
  assert.match(text(html), /ritual Nightly \(m2-beta\): run failed/u, "all workspaces name the workspace");
});

test("a workspace page holds only its own events, and an unknown workspace is a 404", async () => {
  const body = text(await page(`/w/${BETA}/activity`));
  assert.ok(body.includes("ritual Nightly"));
  assert.equal(body.includes("Heartbeat"), false);
  const response = await built.default(new Request("http://darius.test/w/nowhere/activity"), webContext("owner on phone", "bm9uY2U="));
  assert.equal(response.status, 404);
});

test("a pending start shows once, on top, as starting", async () => {
  const body = text(await page("/activity"));
  assert.equal(count(body, /asked by web:altan on host-b: starting/gu), 1);
  assert.ok(body.indexOf("Starting") < body.indexOf("Today"), "the Starting block comes before the first day");
  assert.match(body, /Starting \d\d:\d\d ritual Heartbeat \(m2-alpha\): run now of heartbeat asked by web:altan on host-b: starting/u);
  const kept = text(await page(`/w/${ALPHA}/activity?kind=run-completed`));
  assert.equal(kept.includes("Starting"), false, "a filter that leaves the start out drops the block too");
});

test("kind and by narrow the list; a value that is not one of the words gives the plain page", async () => {
  const plain = text(await page(`/w/${ALPHA}/activity`));
  const completed = text(await page(`/w/${ALPHA}/activity?kind=run-completed`));
  assert.ok(completed.includes("run completed"));
  assert.equal(completed.includes("paused by"), false);
  const timer = text(await page(`/w/${ALPHA}/activity?by=timer`));
  assert.ok(timer.includes("ritual Heartbeat: run started by timer"));
  assert.equal(timer.includes("looked fine"), false);
  for (const bad of ["kind=nonsense", "by=robot", "days=45", "days=0", "kind=all", "kind=RUN-HELD&by=&days=banana"]) {
    assert.equal(text(await page(`/w/${ALPHA}/activity?${bad}`)).replace(/\s*(Filter|Window|Done by|Kind).*$/u, ""), plain.replace(/\s*(Filter|Window|Done by|Kind).*$/u, ""), bad);
  }
  assert.ok(text(await page(`/w/${ALPHA}/activity?kind=run-held`)).includes("Nothing happened in the last 7 days that matches this filter"));
});

test("Show older widens the window from 7 to 30 to 90 days, and is gone at 90", async () => {
  const week = await page(`/w/${ALPHA}/activity`);
  assert.equal(text(week).includes("twenty days old"), false);
  assert.ok(week.includes(`href="/w/${ALPHA}/activity?days=30"`) && text(week).includes("Show older"));
  const month = await page(`/w/${ALPHA}/activity?days=30`);
  assert.ok(text(month).includes("twenty days old"));
  assert.equal(text(month).includes("sixty days old"), false);
  assert.ok(month.includes(`href="/w/${ALPHA}/activity?days=90"`));
  const quarter = await page(`/w/${ALPHA}/activity?days=90`);
  assert.ok(text(quarter).includes("sixty days old"));
  assert.equal(text(quarter).includes("Show older"), false);
});

test("the all-workspaces page caps at 500 entries and says so; a workspace page does not", async () => {
  const all = text(await page("/activity?days=30"));
  assert.ok(all.includes("This list shows the newest 500 events."));
  assert.equal(all.includes("Show older"), false, "a longer window would add nothing");
  assert.equal(count(all, /bulk note \d+/gu) < BULK, true);
  const one = text(await page(`/w/${BETA}/activity?days=30`));
  assert.equal(count(one, /bulk note \d+/gu), BULK);
  assert.equal(one.includes("newest 500 events"), false);
});

test("the self-test workspace stays out of the all-workspaces page unless the settings show it", async () => {
  assert.equal(text(await page("/activity")).includes("selftest event"), false);
  assert.equal(text(await page(`/w/${SELFTEST}/activity`)).includes("selftest event"), true, "its own address shows it");
  const shown = text(await page("/activity", "darius-settings=theme%3Ddark%26selftest%3D1"));
  assert.equal(shown.includes("selftest event"), true);
});

test("a workspace with no events says so, draws no Starting block and no empty section", async () => {
  await ritual("m2-quiet", "still", "Still");
  const body = text(await page("/w/m2-quiet/activity"));
  assert.ok(body.includes("Nothing happened in the last 7 days."));
  assert.equal(body.includes("Starting"), false);
  assert.equal(body.includes("Show older"), false);
});
