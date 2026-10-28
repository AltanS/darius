/**
 * The vigil detail's trail (0.95.0): `VigilDetail.activity` (sweeps, pauses,
 * resumes and the close, with who and why) and `VigilDetail.pending` (the
 * check the web asked for that has no result yet), over a throwaway store and
 * a throwaway pending registry. The real WebContext fills `pending`; the
 * test calls `webContext(...).vigil(...)`. This file was created for spec 08;
 * the spec named it and none existed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-web-vigil-detail-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
process.env.DARIUS_TAILSCALE = join(SANDBOX, "no-tailscale");

const { appendLine } = await import("../src/core/ledger.ts");
const { itemRef, openProject } = await import("../src/core/store.ts");
const { addVigil, closeVigil, pauseVigil, resumeVigil } = await import("../src/core/sweep.ts");
const { markEnded, recordPending, vigilCheckOf } = await import("../src/web/pending.ts");
const { webContext } = await import("../src/web/context.ts");

const PROJECT = "web-vigil-detail";
const BODY = "# checks\n\n## Verification Checklist\n\n- [ ] the page loads\n  - Command: `curl -sf http://localhost/`\n  - Expected: `exit 0`\n";
const MINUTE = 60_000;

function project() {
  return openProject(PROJECT, { create: true });
}

function addOne(slug: string): void {
  addVigil(project(), { slug, title: `Title of ${slug}`, body: BODY, due: "2026-10-01", heavy: false, who: "test" });
}

const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();

function swept(slug: string, who: string, outcome: string, at: string): void {
  appendLine(project(), { who, type: "vigil.swept", item: itemRef("vigil", slug), outcome, checks: [{ index: 0, outcome: outcome === "held" ? "pass" : "fail", exit: outcome === "held" ? 0 : 1 }], at });
}

function ask(slug: string, at: string, log = join(SANDBOX, `${slug}.log`)): string {
  writeFileSync(log, "");
  return recordPending({ at, who: "web:altan", kind: "vigil-check", project: PROJECT, vigil: slug, host: "host-b", log, offset: 0 });
}

const vigil = (slug: string) => webContext("owner on phone").vigil(PROJECT, slug);

test("activity lists sweeps, pauses, resumes and the close, newest first, with who and why", () => {
  addOne("trail");
  swept("trail", "timer", "failed", ago(5 * MINUTE * 60));
  // 30 days ahead of now: a pause whose until has passed is already over.
  const until = new Date(Date.now() + 30 * 24 * 60 * MINUTE).toISOString().slice(0, 10);
  pauseVigil(project(), { slug: "trail", reason: "waiting for the release", until, who: "web:altan" });
  resumeVigil(project(), { slug: "trail", who: "web:altan" });
  swept("trail", "web:altan", "held", new Date().toISOString());
  closeVigil(project(), { slug: "trail", verdict: "held", reason: "the release shipped", who: "web:altan" });
  const entries = vigil("trail")?.activity ?? [];
  assert.deepEqual(
    entries.map((entry) => entry.kind),
    ["vigil-closed", "vigil-swept", "vigil-resumed", "vigil-paused", "vigil-swept"],
  );
  const texts = entries.map((entry) => entry.text);
  assert.match(texts[0] ?? "", /^Closed held by web:altan.*the release shipped/u);
  assert.equal(texts[1], "Checked by web:altan: held");
  assert.equal(texts[2], "Resumed by web:altan");
  assert.equal(texts[3], `Paused by web:altan until ${until}: waiting for the release`);
  assert.equal(texts[4], "Checked by timer: failed");
  assert.deepEqual(
    entries.map((entry) => entry.actor),
    ["web", "web", "web", "web", "timer"],
  );
  assert.equal(
    entries.every((entry) => entry.item.type === "vigil" && entry.item.title === "Title of trail"),
    true,
  );
});

test("activity holds only this vigil's lines and masks a secret typed into a reason", () => {
  addOne("quiet");
  addOne("noisy");
  pauseVigil(project(), { slug: "noisy", reason: "api_key=abc123 was leaked", who: "web:altan" });
  const quiet = vigil("quiet")?.activity ?? [];
  assert.deepEqual(quiet, [], "no line of another vigil, and none of a vigil never swept");
  const noisy = vigil("noisy")?.activity ?? [];
  assert.equal(noisy.length, 1);
  assert.equal(noisy[0]?.text.includes("abc123"), false);
  assert.match(noisy[0]?.text ?? "", /api_key=\[masked\]/u);
});

test("activity is cut to the newest 100", () => {
  addOne("many");
  for (let count = 0; count < 120; count += 1) swept("many", "timer", "held", ago((200 - count) * MINUTE));
  assert.equal(vigil("many")?.activity.length, 100);
});

test("pending is null when no check was asked", () => {
  assert.equal(vigil("quiet")?.pending, null);
});

test("a check that shows no sweep yet is pending as starting, with its host and time", () => {
  addOne("running");
  const id = ask("running", ago(MINUTE));
  const pending = vigil("running")?.pending;
  assert.deepEqual([pending?.id, pending?.state, pending?.host, pending?.vigil, pending?.who], [id, "starting", "host-b", "running", "web:altan"]);
});

test("a vigil.swept line after the ask turns pending into null (the check started and finished)", () => {
  addOne("finished");
  ask("finished", ago(5 * MINUTE));
  assert.equal(vigil("finished")?.pending?.state, "starting");
  swept("finished", "web:altan", "failed", ago(MINUTE));
  assert.equal(vigil("finished")?.pending, null, "the sweep row is in `sweeps` and `activity`");
  assert.equal(vigil("finished")?.sweeps.length, 1);
});

test("a refused check is pending as refused with the CLI's sentence; a later sweep clears it", () => {
  addOne("refused");
  const log = join(SANDBOX, "refused.log");
  const id = ask("refused", ago(10 * MINUTE), log);
  writeFileSync(log, "darius vigil sweep: the daily sweep holds the lease.\n");
  markEnded(id, 1);
  const pending = vigil("refused")?.pending;
  assert.equal(pending?.state, "refused");
  assert.match(pending?.sentence ?? "", /daily sweep holds the lease/u);
  swept("refused", "timer", "held", ago(MINUTE));
  assert.equal(vigil("refused")?.pending, null, "a later sweep overtakes the old refusal");
});

test("a check that a skipped sweep refused stays pending as refused with the sentence; a real sweep after it clears it", () => {
  addOne("skipped");
  ask("skipped", ago(5 * MINUTE));
  appendLine(project(), { who: "web:altan", type: "vigil.swept", item: itemRef("vigil", "skipped"), outcome: "skipped", reason: "manual-only vigil", checks: [], at: ago(4 * MINUTE) });
  const pending = vigil("skipped")?.pending;
  assert.equal(pending?.state, "refused");
  assert.match(pending?.sentence ?? "", /manual-only/u);
  swept("skipped", "timer", "held", ago(MINUTE));
  assert.equal(vigil("skipped")?.pending, null);
});

test("a check with no sign after 15 minutes is pending as lost", () => {
  addOne("lost");
  ask("lost", ago(20 * MINUTE));
  assert.equal(vigil("lost")?.pending?.state, "lost");
});

test("pending is the newest check of this vigil, and a check of another vigil does not count", () => {
  addOne("first");
  addOne("second");
  ask("first", ago(8 * MINUTE));
  const newest = ask("first", ago(2 * MINUTE));
  ask("second", ago(MINUTE));
  assert.equal(vigil("first")?.pending?.id, newest);
  assert.equal(vigil("second")?.pending?.vigil, "second");
});

test("vigilCheckOf: started and other kinds give null; a refusal older than the last sweep gives null", () => {
  const base = { id: "a", at: "2026-10-15T10:00:00.000Z", who: "web:altan", project: PROJECT, host: "h" } as const;
  const started = { ...base, kind: "vigil-check", vigil: "v", state: "started" } as const;
  const starting = { ...base, kind: "vigil-check", vigil: "v", state: "starting" } as const;
  const refused = { ...base, kind: "vigil-check", vigil: "v", state: "refused" } as const;
  const followUp = { ...base, kind: "follow-up", state: "starting" } as const;
  assert.equal(vigilCheckOf([started], "v", null), null);
  assert.equal(vigilCheckOf([followUp], "v", null), null);
  assert.equal(vigilCheckOf([starting], "other", null), null);
  assert.equal(vigilCheckOf([refused], "v", "2026-10-15T10:05:00.000Z"), null);
  assert.equal(vigilCheckOf([refused], "v", "2026-10-15T09:00:00.000Z")?.state, "refused");
  assert.equal(vigilCheckOf([starting], "v", "2026-10-15T10:05:00.000Z")?.state, "starting", "a starting check is shown as it is; the registry resolves it when the sweep lands");
});

test("an unknown vigil is null", () => {
  assert.equal(vigil("ghost"), null);
});
