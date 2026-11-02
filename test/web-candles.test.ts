/**
 * The web side of candles (0.112.0): the pure words of the Candles place
 * (web/app/lib/candles.ts) and what the host hands the page over a real store:
 * the candle detail with its body parsed and the state of each channel of its
 * newest notice, and the email line of Settings. The pages themselves are
 * checked in test/web-app.test.ts, the activity kinds in
 * test/web-activity.test.ts.
 *
 * SAFETY: the state and config dirs are `mkdtemp` dirs. Nothing is sent.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sandbox = mkdtempSync(join(tmpdir(), "darius-web-candles-test-"));
process.env.DARIUS_STATE_DIR = join(sandbox, "state");
process.env.DARIUS_CONFIG_DIR = join(sandbox, "config");
process.env.DARIUS_TAILSCALE = join(sandbox, "no-tailscale");

const words = await import("../web/app/lib/candles.ts");
const { emailSettingsFile, writeEmailSettings, parseEmailInput } = await import("../src/core/email.ts");
const { CANDLE_ACCEPTED, CANDLE_LIT } = await import("../src/core/candle-index.ts");
const { appendLine } = await import("../src/core/ledger.ts");
const { openProject, putBlob } = await import("../src/core/store.ts");
const { webContext } = await import("../src/web/context.ts");

import type { CandleDelivery, CandleRow, CandleStep } from "../src/web/api.ts";

function row(key: string, extra: Partial<CandleRow> = {}): CandleRow {
  return {
    project: "shop",
    key,
    title: `Title of ${key}`,
    severity: "high",
    status: "lit",
    source: "ci:nightly",
    firstSeen: { at: "2026-10-20T08:00:00.000Z", line: "01A" },
    lastSeen: { at: "2026-10-21T08:00:00.000Z", line: "01B" },
    reports: 2,
    stillReported: false,
    history: [],
    ...extra,
  };
}

const LIT = row("lit-high");
const SEVERE = row("lit-critical", { severity: "critical" });
const OLD = row("lit-high-old", { lastSeen: { at: "2026-10-19T08:00:00.000Z", line: "01C" } });
const ANSWERED = row("answered", { status: "answered", severity: "critical" });
const ACCEPTED = row("accepted", { status: "accepted" });
const OUT = row("out", { status: "out" });
const ALL = [OUT, ACCEPTED, LIT, ANSWERED, OLD, SEVERE];

function step(kind: CandleStep["kind"], extra: Partial<CandleStep> = {}): CandleStep {
  return { at: "2026-10-21T10:00:00.000Z", kind, severity: "high", line: "01X", ...extra };
}

test("view: only the word all widens the list; anything else is the lit view", () => {
  assert.equal(words.readView(new URLSearchParams("view=all")), "all");
  assert.equal(words.readView(new URLSearchParams("view=lit")), "lit");
  assert.equal(words.readView(new URLSearchParams("view=whatever")), "lit");
  assert.equal(words.readView(new URLSearchParams("")), "lit");
  assert.equal(words.candlesHref(null, "lit"), "/candles");
  assert.equal(words.candlesHref("demo", "all"), "/w/demo/candles?view=all");
});

test("the lit view keeps the lit candles, worst first then newest; the all view puts lit before answered, accepted and out", () => {
  assert.deepEqual(
    words.filterCandles(ALL, "lit").map((one) => one.key),
    ["lit-critical", "lit-high", "lit-high-old"],
  );
  assert.deepEqual(
    words.filterCandles(ALL, "all").map((one) => one.key),
    ["lit-critical", "lit-high", "lit-high-old", "answered", "accepted", "out"],
  );
  assert.equal(words.litCount(ALL), 3);
  assert.deepEqual(ALL.map((one) => one.key).slice(0, 2), ["out", "accepted"], "the input is not changed");
});

test("the empty lines say what is missing and where the rest is", () => {
  assert.equal(words.emptyText("lit", false), "No candle has been lit.");
  assert.equal(words.emptyText("lit", true), "No candle is lit.");
  assert.equal(words.emptyText("all", false), "No candles yet.");
  assert.equal(words.viewText("lit", null), "The lit candles in every workspace, worst first.");
  assert.equal(words.viewText("all", "demo"), "All candles in demo, the lit ones first.");
});

test("state words, seen counts and ages", () => {
  assert.deepEqual(words.statusBadge("lit"), { tone: "wait", label: "Lit" });
  assert.deepEqual(words.statusBadge("out"), { tone: "ok", label: "Out" });
  assert.equal(words.seenText(1), "seen 1 time");
  assert.equal(words.seenText(5), "seen 5 times");
  const now = Date.parse("2026-10-20T11:00:00.000Z");
  assert.equal(words.firstSeenText(LIT, now, 0), "first seen 3 h ago");
  assert.equal(words.firstSeenText(LIT, Date.parse("2026-10-30T11:00:00.000Z"), 0), "first seen 20 Oct");
});

test("a source of a vigil or a ritual names its slug; any other source names none", () => {
  assert.equal(words.vigilOfSource("vigil:cache-flip"), "cache-flip");
  assert.equal(words.vigilOfSource("ritual:site-report"), null);
  assert.equal(words.ritualOfSource("ritual:site-report"), "site-report");
  assert.equal(words.vigilOfSource("vigil:"), null);
  assert.equal(words.vigilOfSource("ci:nightly"), null);
  assert.equal(words.cameFromRun({ run: "01R", ritual: "site-report" }), true);
  assert.equal(words.cameFromRun({}), false, "a script has no run to follow up");
});

test("what the person can do: answer a lit candle, accept a lit or an answered one, nothing else", () => {
  assert.deepEqual(
    (["lit", "answered", "accepted", "out"] as const).map((status) => [words.canAnswer({ status }), words.canAccept({ status })]),
    [
      [true, true],
      [false, true],
      [false, false],
      [false, false],
    ],
  );
});

test("the accept of a vigil's candle says before the tap that it also closes the vigil; any other candle says nothing", () => {
  assert.equal(words.acceptWarning({ source: "vigil:cache-flip" }), "Accepting this risk also closes the vigil cache-flip.");
  assert.equal(words.acceptWarning({ source: "ritual:site-report" }), null);
  assert.equal(words.acceptWarning({ source: "ci:nightly" }), null);
});

test("the bodies of the two writes: the note is trimmed, an empty accept note and a false follow-up are left out", () => {
  assert.deepEqual(words.answerBody(LIT, "  patched  ", false), { project: "shop", key: "lit-high", note: "patched" });
  assert.deepEqual(words.answerBody(LIT, "patched", true), { project: "shop", key: "lit-high", note: "patched", followUp: true });
  assert.deepEqual(words.acceptBody(LIT, "   "), { project: "shop", key: "lit-high" });
  assert.deepEqual(words.acceptBody(LIT, " known "), { project: "shop", key: "lit-high", note: "known" });
});

test("the words of the detail: decisions, still reported, out, history steps", () => {
  const answered = row("a", { status: "answered", answered: { at: "2026-10-21T10:00:00.000Z", who: "web:op", note: "patched", severity: "high", followUpRun: "01RUN" } });
  assert.deepEqual(words.decisionLines(answered, 0), ["Answered by web:op on 21 Oct: patched"]);
  assert.equal(words.followUpRun(answered), "01RUN");
  assert.equal(words.followUpRun(LIT), null);
  const accepted = row("b", { status: "accepted", accepted: { at: "2026-10-21T10:00:00.000Z", who: "web:op", severity: "high" } });
  assert.deepEqual(words.decisionLines(accepted, 0), ["Risk accepted by web:op on 21 Oct"], "no note, no colon");
  assert.deepEqual(words.decisionLines(LIT, 0), []);
  assert.equal(words.stillReportedText({ stillReported: true, status: "accepted" }), "The problem was reported again after you closed this candle. The report was not worse, so the candle stays closed.");
  assert.equal(words.stillReportedText({ stillReported: true, status: "lit" }), null, "a lit candle is not closed");
  assert.equal(words.stillReportedText({ stillReported: false, status: "answered" }), null);
  assert.equal(words.outText({ status: "out" }), "The runs that watch for this problem stopped reporting it.");
  assert.equal(words.outText({ status: "out", blownOut: { at: "2026-10-21T10:00:00.000Z", who: "op" } }), null, "a blow-out has its own decision line");
  assert.equal(words.outText({ status: "lit" }), null);
  assert.equal(words.stepText(step("lit"), 0), "21 Oct, lit at high");
  assert.equal(words.stepText(step("report"), 0), "21 Oct, reported again, high");
  assert.equal(words.stepText(step("raised", { severity: "critical" }), 0), "21 Oct, raised to critical");
  assert.equal(words.stepText(step("answered", { who: "web:op", note: "patched" }), 0), "21 Oct, answered by web:op: patched");
  assert.equal(words.stepText(step("accepted", { who: "web:op" }), 0), "21 Oct, risk accepted by web:op");
  assert.equal(words.stepText(step("blown-out"), 0), "21 Oct, blown out by a run that reported it fixed");
  assert.equal(words.stepText(step("blown-out", { who: "op", note: "fixed by hand" }), 0), "21 Oct, blown out by op: fixed by hand");
  assert.equal(words.stepText(step("relit", { who: "op" }), 0), "21 Oct, relit by op");
  assert.equal(words.stepText(step("out"), 0), "21 Oct, out: the runs that watch for it stopped reporting it");
  assert.equal(words.stepText(step("lit"), 120), "21 Oct, lit at high", "the host's offset moves the date, not the sentence");
});

test("delivery, one sentence per channel: sent, waiting, not set up, failed and given up", () => {
  const sent: CandleDelivery = { channel: "push", state: "sent", host: "host-a", at: "2026-10-21T10:00:00.000Z", tries: 0 };
  assert.equal(words.deliveryText(sent, 0), "Push: sent from host-a on 21 Oct.");
  assert.equal(words.deliveryText({ channel: "email", state: "waiting", tries: 0 }, 0), "Email: not sent yet.");
  assert.equal(words.deliveryText({ channel: "email", state: "failed", host: "host-b", tries: 1, reason: "not set up on host" }, 0), "Email: not set up on host-b.");
  assert.equal(words.deliveryText({ channel: "push", state: "failed", host: "host-a", tries: 1, reason: "no device took it" }, 0), "Push: not sent yet, 1 try so far. no device took it.");
  assert.equal(words.deliveryText({ channel: "push", state: "failed", host: "host-a", tries: 3, reason: "no device took it." }, 0), "Push: not sent after 3 tries. no device took it.");
  assert.equal(words.deliveryText({ channel: "email", state: "failed", tries: 2 }, 0), "Email: not sent yet, 2 tries so far.");
  assert.equal(words.APP_ONLY_TEXT, "App only. No alert goes out.");
});

test("no sentence of the Candles place names a path, a flag, or an internal key", () => {
  const all = [words.NO_WRITE_TEXT, words.APP_ONLY_TEXT, words.RECEIPTS.answer, words.RECEIPTS.accept, words.emptyText("lit", true), words.viewText("lit", "demo"), words.acceptWarning({ source: "vigil:x" }) ?? ""];
  for (const sentence of all) {
    assert.equal(/--|\.ts\b|\/api\/|\bruns\/|ledger|alert\.(?:sent|failed)|—/u.test(sentence), false, sentence);
  }
});

// --- over a real store -------------------------------------------------------------------------

const shop = openProject("shop", { create: true });

test("the detail of a candle: the body parsed as markdown, and the channels of the newest notice with their state", () => {
  const body = putBlob(shop, "Update **now**.\n\n- the first step\n- the second step\n");
  const lit = appendLine(shop, { who: "ci", type: CANDLE_LIT, key: "cert", title: "Certificate expires", severity: "high", source: "ci:nightly", target: "shop.example.com", body_sha: body, deliver: ["push", "email"] });
  const context = webContext("owner");
  const waiting = context.candle("shop", "cert");
  assert.ok(waiting !== null);
  assert.equal(waiting.row.title, "Certificate expires");
  assert.equal(waiting.body, "Update **now**.\n\n- the first step\n- the second step\n");
  assert.deepEqual(
    waiting.blocks?.map((block) => block.kind),
    ["paragraph", "list"],
  );
  assert.deepEqual(waiting.delivery, [
    { channel: "push", state: "waiting", tries: 0 },
    { channel: "email", state: "waiting", tries: 0 },
  ]);

  appendLine(shop, { who: "darius:alerts", type: "alert.sent", key: `line:${lit.id}:push`, channel: "push", devices: 2 });
  appendLine(shop, { who: "darius:alerts", type: "alert.failed", key: `line:${lit.id}:email`, channel: "email", error: "not set up on host", title: "t", body: "b", url: "/u" });
  const settled = context.candle("shop", "cert");
  const [push, email] = settled?.delivery ?? [];
  assert.equal(push?.state, "sent");
  assert.ok(push?.host !== undefined && push.host !== "", "the host that sent it");
  assert.equal(push?.tries, 0);
  assert.deepEqual({ channel: email?.channel, state: email?.state, tries: email?.tries, reason: email?.reason }, { channel: "email", state: "failed", tries: 1, reason: "not set up on host" });
});

test("a candle that delivers to the app only has no channel; an unknown key or project is null", () => {
  appendLine(shop, { who: "ci", type: CANDLE_LIT, key: "quiet", title: "Quiet one", severity: "low", source: "script", deliver: [] });
  const context = webContext("owner");
  const quiet = context.candle("shop", "quiet");
  assert.deepEqual(quiet?.delivery, []);
  assert.equal(quiet?.body, null);
  assert.equal(quiet?.blocks, null);
  assert.equal(context.candle("shop", "nope"), null);
  assert.equal(context.candle("nowhere", "quiet"), null);
});

test("a newer notice replaces the older one: a worse report is a new line, so the channels show its state", () => {
  const first = appendLine(shop, { who: "ci", type: CANDLE_LIT, key: "grow", title: "Grows", severity: "low", source: "script", deliver: ["push"] });
  appendLine(shop, { who: "darius:alerts", type: "alert.sent", key: `line:${first.id}:push`, channel: "push", devices: 1 });
  const second = appendLine(shop, { who: "ci", type: CANDLE_LIT, key: "grow", title: "Grows", severity: "high", source: "script", deliver: ["push"] });
  const context = webContext("owner");
  assert.deepEqual(context.candle("shop", "grow")?.delivery, [{ channel: "push", state: "waiting", tries: 0 }], "the new notice has not gone out yet");
  appendLine(shop, { who: "darius:alerts", type: "alert.sent", key: `line:${second.id}:push`, channel: "push", devices: 1 });
  assert.equal(context.candle("shop", "grow")?.delivery[0]?.state, "sent");
});

test("the status counts the lit candles of a project, and an accepted one no more", () => {
  appendLine(shop, { who: "web:op", type: CANDLE_ACCEPTED, key: "quiet", severity: "low" });
  const context = webContext("owner");
  const status = context.status();
  const project = status.projects.find((one) => one.name === "shop");
  assert.equal(project?.candles.lit, 2, "cert and grow are lit; quiet is accepted");
});

test("the email line of Settings: false without the file, true with it, and it says nothing else", () => {
  const context = webContext("owner");
  assert.equal(context.emailSetUp(), false);
  writeEmailSettings(parseEmailInput(JSON.stringify({ url: "https://mail.example.test/send", token: "token-placeholder", from: "darius@example.test", to: ["ops@example.test"] })));
  assert.equal(context.emailSetUp(), true);
});

test("a broken email file is a problem on the context, with the reason and no value", () => {
  rmSync(emailSettingsFile(), { force: true });
  const context = webContext("owner");
  assert.equal(context.emailProblem(), null);
  writeFileSync(emailSettingsFile(), '{"token":"token-placeholder"', { mode: 0o600 });
  try {
    assert.equal(context.emailSetUp(), false);
    assert.equal(context.emailProblem(), "email.json is not valid JSON");
  } finally {
    rmSync(emailSettingsFile(), { force: true });
  }
});
