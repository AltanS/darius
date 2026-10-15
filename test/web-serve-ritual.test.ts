/**
 * The ritual page over a real store (0.91.0): the real WebContext reads a
 * seeded `darius-selftest` project, and the committed app build renders
 * `/w/darius-selftest/rituals/heartbeat`. The page must show the Starting
 * card for a start without a run, the Last decision line, the Activity
 * timeline with "Show older", and History with a follow-up under its parent.
 * test/web-app.test.ts draws the same page from literals; this one proves the
 * loader and the context agree.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs } from "../src/cli/args.ts";
import type { Command, ParsedArgs } from "../src/cli/registry.ts";
import { ritualCommand } from "../src/cli/ritual.ts";
import { runCommand } from "../src/cli/run.ts";
import { writeFileSync } from "node:fs";

import { appendLine } from "../src/core/ledger.ts";
import { openProject } from "../src/core/store.ts";
import { ulid } from "../src/core/ulid.ts";
import type { WebHandler } from "../src/web/api.ts";
import { markEnded, recordPending } from "../src/web/pending.ts";
import { webContext } from "../src/web/context.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-web-serve-ritual-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
process.env.DARIUS_TAILSCALE = join(SANDBOX, "no-tailscale");

const built: { default: WebHandler } = await import("../web/build/server/index.js");

const PROJECT = "darius-selftest";
const EVIL = "<script>alert(1)</script>";

async function cli(command: Command, argv: string[], stdin?: string): Promise<string> {
  const args: ParsedArgs = parseArgs([...argv, "--project", PROJECT]);
  if (stdin !== undefined) args.stdin = stdin;
  const out: string[] = [];
  const { log } = console;
  console.log = (...parts: string[]) => out.push(parts.join(" "));
  try {
    assert.equal(await command.run(args), 0, argv.join(" "));
  } finally {
    console.log = log;
  }
  return out.join("\n");
}

/** A ritual with one answered ask, the follow-up it started, and a start that shows no run. */
async function seed(): Promise<{ parent: string; child: string }> {
  await cli(ritualCommand, ["add", "heartbeat", "--title", "Heartbeat", "--cadence", "1d"]);
  const parent = JSON.parse(await cli(runCommand, ["start", "heartbeat", "--json"])).run;
  const block = JSON.stringify({ v: 1, status: "attention", summary: "checked", questions: [{ text: "Apply it?" }, { text: "Which branch?" }] });
  await cli(runCommand, ["complete", parent, "--outcome", "complete", "--findings-stdin"], `done\n\`\`\`darius-result\n${block}\n\`\`\`\n`);
  await cli(runCommand, ["ack", parent, "--who", "web:altan", "--answer", "1=Yes", "--answer", "2=main", "--json"]);
  const project = openProject(PROJECT);
  const child = ulid();
  appendLine(project, { who: "web:altan", type: "run.started", item: "ritual/heartbeat", run: child, follow_up_of: parent, approved: [1] });
  appendLine(project, { who: "web:altan", type: "run.completed", item: "ritual/heartbeat", run: child, outcome: "complete" });
  recordPending({ at: new Date().toISOString(), who: "web:altan", kind: "run-now", project: PROJECT, ritual: "heartbeat", parent, host: "host-b", log: join(SANDBOX, "none.log"), offset: 0 });
  recordPending({ at: new Date(Date.now() - 60_000).toISOString(), who: "web:altan", kind: "follow-up", project: PROJECT, ritual: "other", parent, host: "host-b", log: join(SANDBOX, "none.log"), offset: 0 });
  return { parent, child };
}

const { parent, child } = await seed();

async function page(path: string): Promise<string> {
  const response = await built.default(new Request(`http://darius.test${path}`), webContext("owner on phone", "bm9uY2U="));
  assert.equal(response.status, 200, path);
  return response.text();
}

const text = (html: string): string => html.replaceAll(/<script\b[\s\S]*?<\/script>/gu, " ").replaceAll(/<[^>]*>/gu, " ").replaceAll("&quot;", '"').replaceAll(/\s+/gu, " ");

test("the ritual page shows the Starting card for a start without a run, and not one of another ritual", async () => {
  const body = text(await page("/w/darius-selftest/rituals/heartbeat"));
  assert.match(body, /Starting .*Starting a run on host-b, asked \d\d:\d\d by web:altan/u);
  assert.equal(body.includes("follow-up on host-b"), false, "the start of the other ritual stays off");
});

test("Last decision names the answer, when it was given, and what comes next", async () => {
  const body = text(await page("/w/darius-selftest/rituals/heartbeat"));
  assert.match(body, /Last decision: Follow-up of \w{8} started by web:altan at \d\d:\d\d: approved Q1, done \./u, "the follow-up is the newest decision");
});

test("Activity lists every event of the ritual, newest first, grouped by day, with a link to the run", async () => {
  const html = await page("/w/darius-selftest/rituals/heartbeat");
  const body = text(html);
  assert.match(body, /Activity Today /u);
  assert.match(body, /\d\d:\d\d Answered by web:altan/u);
  assert.match(body, /Run completed with 2 questions for you/u);
  assert.ok(html.includes(`/w/darius-selftest/runs/${parent}`), "a link to the run");
  assert.equal(html.includes("Show older"), false, "nothing older to load");
  const trail = body.slice(body.indexOf("Activity Today"));
  assert.equal(trail.indexOf("Answered by web:altan") > trail.indexOf("Follow-up of"), true, "newest first: the follow-up comes before the answer");
  assert.equal(/Follow-up of [0-9A-Z]{26}/u.test(body), false, "a run id shows its last eight characters");
  assert.equal(html.includes(EVIL), false);
});

test("History puts the follow-up under its parent and says who started it and what it was told", async () => {
  const html = await page("/w/darius-selftest/rituals/heartbeat");
  const parentAt = html.indexOf(`/runs/${parent}"`);
  const childAt = html.indexOf(`/runs/${child}"`);
  assert.ok(parentAt > 0 && childAt > 0, "both runs are listed");
  const history = html.slice(html.indexOf(">History<"));
  assert.ok(history.indexOf(`/runs/${parent}"`) < history.indexOf(`/runs/${child}"`), "the follow-up sits right after its parent");
  assert.match(html, /class="rw rw-nested/u);
  assert.match(text(html), /follow-up by web:altan, approved Q1/u);
});

test("a ritual with no activity draws no Activity section, and ?days= falls back to 30", async () => {
  await cli(ritualCommand, ["add", "quiet", "--title", "Quiet", "--cadence", "1d"]);
  const body = text(await page("/w/darius-selftest/rituals/quiet?days=banana"));
  assert.equal(body.includes("Activity Today"), false, "no Activity section; the sidebar row of the same name is not one");
  assert.equal(body.includes("Last decision"), false);
  assert.equal(body.includes("Starting"), false);
});

// --- the window, "Show older" and a start that was refused ------------------------------------

const DAY_MS = 24 * 3_600_000;

async function seedAged(): Promise<void> {
  await cli(ritualCommand, ["add", "aged", "--title", "Aged", "--cadence", "1d"]);
  const project = openProject(PROJECT);
  const note = (daysAgo: number, said: string): void => {
    appendLine(project, { who: "web:altan", type: "run.acknowledged", item: "ritual/aged", run: ulid(), note: said, at: new Date(Date.now() - daysAgo * DAY_MS).toISOString() });
  };
  note(10, "ten days old");
  note(45, "forty-five days old");
  const log = join(SANDBOX, "refused.log");
  writeFileSync(log, "darius run follow-up: run 01PARENTRUN is still running.\n");
  const id = recordPending({ at: new Date().toISOString(), who: "web:altan", kind: "follow-up", project: PROJECT, ritual: "aged", parent: "01PARENTRUN", host: "host-b", log, offset: 0 });
  markEnded(id, 1);
}

await seedAged();

test("the window is 30 days, Show older adds 30 through ?days=, and a bad value falls back to 30", async () => {
  const first = await page("/w/darius-selftest/rituals/aged");
  assert.ok(text(first).includes("ten days old"));
  assert.equal(text(first).includes("forty-five days old"), false, "outside the first 30 days");
  assert.ok(first.includes('href="?days=60#activity"') || first.includes('href="/w/darius-selftest/rituals/aged?days=60#activity"'), "Show older asks for 60 days");
  assert.ok(text(first).includes("Show older"));
  const second = await page("/w/darius-selftest/rituals/aged?days=60");
  assert.ok(text(second).includes("forty-five days old"));
  assert.equal(text(second).includes("Show older"), false, "nothing older is left");
  for (const bad of ["45", "999", "0", "-30", "30.5", "banana", ""]) {
    const body = text(await page(`/w/darius-selftest/rituals/aged?days=${bad}`));
    assert.equal(body.includes("forty-five days old"), false, `?days=${bad} keeps the 30 day window`);
  }
});

test("a refused start shows the CLI's sentence and a Try again link to the parent run", async () => {
  const html = await page("/w/darius-selftest/rituals/aged");
  assert.match(text(html), /Starting A follow-up was not started: run 01PARENTRUN is still running\. Asked \d\d:\d\d by web:altan\./u);
  assert.ok(html.includes('href="/w/darius-selftest/runs/01PARENTRUN"'), "the link goes to the parent run");
  assert.ok(text(html).includes("Try again"));
  assert.ok(html.includes("edge-bad"), "a refusal has the bad edge");
});

test("Last decision and the History notes read past the 30 day window", async () => {
  await cli(ritualCommand, ["add", "slow", "--title", "Slow", "--cadence", "1d"]);
  const project = openProject(PROJECT);
  appendLine(project, { who: "web:altan", type: "run.acknowledged", item: "ritual/slow", run: ulid(), note: "decided long ago", at: new Date(Date.now() - 50 * DAY_MS).toISOString() });
  const body = text(await page("/w/darius-selftest/rituals/slow"));
  assert.match(body, /Last decision: Noted by web:altan at \d\d:\d\d: decided long ago/u);
  assert.equal(body.includes("Activity Today"), false, "the timeline keeps its 30 day window");
});
