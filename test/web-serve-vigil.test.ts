/**
 * The vigil pages over a real store (0.95.0): the real WebContext reads a
 * seeded project and the committed app build renders the vigil page, the
 * Vigils list and the Overview. A check that runs shows as "Checking" with
 * the busy gem (0.98.0), the vigil page lists its pauses and sweeps, and the
 * flagged card of the Overview offers "Check now" to a viewer who may write.
 * The in-flight timer is in the component; check-poll.test.ts covers its rules.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendLine } from "../src/core/ledger.ts";
import { itemRef, openProject } from "../src/core/store.ts";
import { addVigil, pauseVigil } from "../src/core/sweep.ts";
import type { WebHandler } from "../src/web/api.ts";
import { markEnded, recordPending } from "../src/web/pending.ts";
import { webContext } from "../src/web/context.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-web-serve-vigil-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
process.env.DARIUS_TAILSCALE = join(SANDBOX, "no-tailscale");

const built: { default: WebHandler } = await import("../web/build/server/index.js");

const PROJECT = "m2-vig";
const BODY = "# checks\n\n## Verification Checklist\n\n- [ ] the page loads\n  - Command: `curl -sf http://localhost/`\n  - Expected: `exit 0`\n";
const MINUTE = 60_000;
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();

function flagged(slug: string, title: string): void {
  const project = openProject(PROJECT, { create: true });
  addVigil(project, { slug, title, body: BODY, due: "2026-10-01", heavy: false, who: "test" });
  const item = itemRef("vigil", slug);
  appendLine(project, { who: "timer", type: "evidence", item, check: `${item}#0`, exit: 1, outcome: "fail", output_sha: "f".repeat(64), duration_ms: 10, command: "curl -sf http://localhost/", expected: "exit 0" });
  appendLine(project, { who: "timer", type: "vigil.swept", item, outcome: "failed", fail_kind: "broken", gate: "n/a", checks: [{ index: 0, outcome: "fail", exit: 1, fail_kind: "broken" }], at: ago(60 * MINUTE) });
}

function ask(slug: string, at: string): string {
  const log = join(SANDBOX, `${slug}.log`);
  writeFileSync(log, "");
  return recordPending({ at, who: "web:altan", kind: "vigil-check", project: PROJECT, vigil: slug, host: "host-b", log, offset: 0 });
}

flagged("running", "Soak test");
flagged("idle", "Queue empty");
flagged("refused", "Backups fresh");
flagged("paused", "Cert renewed");
pauseVigil(openProject(PROJECT), { slug: "paused", reason: "waiting for the release", until: "2026-10-20", who: "web:altan" });
addVigil(openProject(PROJECT), { slug: "calm", title: "Calm one", body: BODY, due: "2999-01-01", heavy: false, who: "test" });
ask("running", ago(2 * MINUTE));
ask("calm", ago(MINUTE));
const refusedLog = join(SANDBOX, "refused.log");
const refusedId = ask("refused", ago(10 * MINUTE));
writeFileSync(refusedLog, "darius vigil sweep: another check of this vigil runs.\n");
markEnded(refusedId, 1);

async function page(path: string, local = false): Promise<string> {
  const response = await built.default(new Request(`http://darius.test${path}`), webContext("owner on phone", "bm9uY2U=", local));
  assert.equal(response.status, 200, path);
  return response.text();
}

const text = (html: string): string => html.replaceAll(/<script\b[\s\S]*?<\/script>/gu, " ").replaceAll(/<[^>]*>/gu, " ").replaceAll("&quot;", '"').replaceAll(/\s+/gu, " ").replaceAll(" :", ":");

/** The card of a flagged vigil on the Overview, by its title. */
function cardOf(html: string, title: string): string {
  const articles = html.split("<article ").slice(1);
  const found = articles.find((article) => article.includes(`>${title}<`));
  assert.ok(found, `no card for ${title}`);
  return found.split("</article>")[0] ?? "";
}

test("the vigil page of a running check shows the busy gem and the host, not the button", async () => {
  const html = await page(`/w/${PROJECT}/vigils/running`);
  assert.match(text(html), /Checking on host-b, asked \d\d:\d\d/u);
  assert.match(html, /<div role="status"><p class="gem-line"><svg[^>]*class="gem gem-busy"/u, "0.98.0: the busy gem, not the running light");
  assert.equal(html.includes("live-bar"), false);
  assert.equal(html.includes("Check now: Soak test"), false, "the button is off while the check runs");
  assert.equal(html.includes("Reload to see the result"), false);
});

test("a vigil with no check running keeps its button; a refused check says why and keeps the button", async () => {
  const idle = await page(`/w/${PROJECT}/vigils/idle`);
  assert.ok(idle.includes("Check now: Queue empty"));
  assert.equal(text(idle).includes("Checking on"), false);
  const refused = await page(`/w/${PROJECT}/vigils/refused`);
  assert.ok(refused.includes("Check now: Backups fresh"));
  assert.match(text(refused), /A check was not started: .*another check of this vigil runs/u);
});

test("the vigil page lists its sweeps and pauses in an Activity section, and the table stays", async () => {
  const body = text(await page(`/w/${PROJECT}/vigils/paused`));
  assert.match(body, /Activity Today \d\d:\d\d Paused by web:altan until 20 Oct: waiting for the release/u);
  assert.match(body, /Checked by timer: failed/u);
  assert.ok(body.includes("Last sweeps"));
  assert.equal(body.includes("Paused by web:altan until 2026-10-20"), false, "the date reads as a short date");
});

test("a vigil never swept draws no Activity section", async () => {
  openProject(PROJECT);
  addVigil(openProject(PROJECT), { slug: "fresh", title: "Fresh one", body: BODY, due: "2999-01-01", heavy: false, who: "test" });
  const body = text(await page(`/w/${PROJECT}/vigils/fresh`));
  assert.equal(body.includes("Activity Today"), false);
  assert.equal(/Activity \d\d:\d\d/u.test(body), false);
});

test("the Vigils list says Checking, with the busy gem, for a vigil with a check; the other rows keep their words", async () => {
  const html = await page(`/w/${PROJECT}/vigils`);
  const rows = html.split("<li ").filter((row) => row.includes('class="rw'));
  const running = rows.find((row) => row.includes("Soak test")) ?? "";
  assert.match(running, /<span class="rw-seg"><svg[^>]*class="gem gem-busy"/u, "the busy gem before the state word");
  assert.equal(running.includes("live-bar"), false, "no running light");
  assert.match(text(running), /Checking/u);
  const idle = rows.find((row) => row.includes("Queue empty")) ?? "";
  assert.equal(text(idle).includes("Checking"), false);
  assert.ok(idle.includes("Check now: Queue empty"));
  assert.equal((running.match(/Check now: Soak test/gu) ?? []).length, 0, "no button while it runs");
});

test("a row of a vigil that is not flagged still says Checking while its check runs, and has no button", async () => {
  const html = await page(`/w/${PROJECT}/vigils`);
  const row = html.split("<li ").find((part) => part.includes('class="rw') && part.includes("Calm one")) ?? "";
  assert.match(text(row), /Checking/u);
  assert.ok(row.includes("gem-busy"));
  assert.equal(row.includes("Check now"), false);
});

test("the Overview card of a flagged vigil offers Check now, and shows a check that runs", async () => {
  const html = await page(`/w/${PROJECT}`);
  assert.ok(cardOf(html, "Queue empty").includes("Check now: Queue empty"));
  assert.match(text(cardOf(html, "Soak test")), /Checking on host-b, asked \d\d:\d\d/u);
  assert.equal(cardOf(html, "Soak test").includes("Check now: Soak test"), false);
});

test("the loopback viewer gets no Check now on any card", async () => {
  const html = await page(`/w/${PROJECT}`);
  assert.ok(html.includes("Check now:"), "a viewer who may write has it");
  const local = await page(`/w/${PROJECT}`, true);
  assert.equal(local.includes("Check now:"), false, "the server would refuse the POST");
});
