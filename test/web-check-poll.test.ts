/**
 * The words and small rules of a "Check now" (web/app/lib/check-poll.ts):
 * which pending start a vigil shows, and every sentence of the check, as the
 * state-words table of the ui-next design names them. The follower that looks
 * for the end of a check is proved in test/web-follow-starts.test.ts; the
 * component itself is checked in a browser.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import type { PendingStart } from "../src/web/api.ts";

const poll = await import("../web/app/lib/check-poll.ts");

const ASKED = "2026-10-15T10:00:00.000Z";

function start(extra: Partial<PendingStart>): PendingStart {
  return { id: "a", at: ASKED, who: "web:altan", kind: "vigil-check", project: "demo", vigil: "guard", host: "host-b", state: "starting", ...extra };
}

test("startingCheck names the newest starting check of one vigil; other kinds, states and vigils do not count", () => {
  const starts = [
    start({ id: "old", at: "2026-10-15T09:00:00.000Z" }),
    start({ id: "new", at: "2026-10-15T09:30:00.000Z" }),
    start({ id: "done", state: "started", at: "2026-10-15T09:45:00.000Z" }),
    start({ id: "other", vigil: "soak", at: "2026-10-15T09:50:00.000Z" }),
    start({ id: "elsewhere", project: "atlas", at: "2026-10-15T09:55:00.000Z" }),
    start({ id: "follow", kind: "follow-up", at: "2026-10-15T09:56:00.000Z" }),
  ];
  assert.equal(poll.startingCheck(starts, "demo", "guard")?.id, "new");
  assert.equal(poll.startingCheck(starts, "demo", "soak")?.id, "other");
  assert.equal(poll.startingCheck(starts, "demo", "none"), null);
  assert.equal(poll.checkKey("demo", "guard"), "demo/guard");
});

test("the checking line ticks in seconds, then minutes, and changes its promise after 3 minutes", () => {
  assert.equal(poll.checkingText("host-b", 40_000), "Checking on host-b, 40 s so far. Most checks end within a minute.");
  assert.equal(poll.checkingText("host-b", 0), "Checking on host-b, 0 s so far. Most checks end within a minute.");
  assert.equal(poll.checkingText("host-b", 179_999), "Checking on host-b, 2 min so far. Most checks end within a minute.");
  assert.equal(poll.checkingText("host-b", 4 * 60_000 + 5000), "Still checking on host-b, 4 min so far. The result shows here.");
  assert.equal(poll.LONG_CHECK_MS, 180_000);
});

test("a finished check says when and how: passed, still failing, or only the time", () => {
  assert.equal(poll.checkedText("07:24", "held"), "Checked 07:24: passed.");
  assert.equal(poll.checkedText("07:24", "failed"), "Checked 07:24: still failing.");
  assert.equal(poll.checkedText("07:24", null), "Checked 07:24.");
  assert.equal(poll.checkedText("07:24", "awaiting-manual"), "Checked 07:24.");
});

test("the cooldown label counts minutes, names the time to check again, and ends after 2 minutes", () => {
  const checked = "2026-10-15T07:24:00.000Z";
  const at = (ms: number): number => Date.parse(checked) + ms;
  assert.equal(poll.COOLDOWN_MS, 120_000);
  assert.equal(poll.cooldownText(checked, at(30_000), 0), "Checked 1 min ago. Check again at 07:26.");
  assert.equal(poll.cooldownText(checked, at(90_000), 0), "Checked 2 min ago. Check again at 07:26.");
  assert.equal(poll.cooldownText(checked, at(119_999), 0), "Checked 2 min ago. Check again at 07:26.");
  assert.equal(poll.cooldownText(checked, at(120_000), 0), null);
  assert.equal(poll.cooldownText(checked, at(30_000), 120), "Checked 1 min ago. Check again at 09:26.", "the host's clock offset");
  assert.equal(poll.cooldownText(checked, at(30_000), 0, "2026-10-15T07:27:00.000Z"), "Checked 1 min ago. Check again at 07:27.", "the server's time wins");
  assert.equal(poll.cooldownText("not a time", at(0), 0), null);
});

test("a check that did not start or shows no sign says so without a file path or a flag", () => {
  assert.equal(poll.refusedText("host-b", "another check runs."), "host-b did not start it: another check runs.");
  assert.equal(poll.refusedText("host-b", "the vigil is paused"), "host-b did not start it: the vigil is paused.");
  assert.equal(poll.refusedText("host-b", undefined), "host-b did not start the check.");
  assert.equal(poll.lostText("host-b", "check"), "No sign of this check on host-b after 15 minutes.");
  assert.equal(poll.lostText("host-b", "run"), "No sign of this run on host-b after 15 minutes. Start it again from the ritual.");
});

test("the newer of two asks wins; none gives the other", () => {
  const old = { id: "a", host: "h", at: "2026-10-15T10:00:00.000Z" };
  const fresh = { id: "b", host: "h", at: "2026-10-15T10:01:00.000Z" };
  assert.equal(poll.newerAsk(old, fresh), fresh);
  assert.equal(poll.newerAsk(fresh, old), fresh);
  assert.equal(poll.newerAsk(null, old), old);
  assert.equal(poll.newerAsk(old, null), old);
  assert.equal(poll.newerAsk(null, null), null);
});
