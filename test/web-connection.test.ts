/**
 * The connection store of the web app (web/app/lib/connection.ts): what a
 * stale copy, a fresh answer and a failed send do to the state, when new
 * root data proves the host answered, and which time the strip names.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const connection = await import("../web/app/lib/connection.ts");
const { CONNECTED, nextConnection, isFreshAdvance, shownTime } = connection;

const NOW = Date.parse("2026-10-19T07:30:00.000Z");
const SAVED = "2026-10-19T07:24:00.000Z";

test("a stale copy marks the page lost, with the time it was saved and the start of the outage", () => {
  const lost = nextConnection(CONNECTED, { type: "stale", savedAt: SAVED }, NOW);
  assert.deepEqual(lost, { lost: true, savedAt: SAVED, since: NOW, justConnected: false });
  const later = nextConnection(lost, { type: "stale", savedAt: "2026-10-19T07:20:00.000Z" }, NOW + 5000);
  assert.equal(later.since, NOW, "the outage keeps its start");
  assert.equal(later.savedAt, "2026-10-19T07:20:00.000Z", "the copy on screen names its own time");
  assert.equal(nextConnection(lost, { type: "stale", savedAt: SAVED }, NOW + 1), lost, "the same copy again changes nothing");
  assert.equal(nextConnection(lost, { type: "stale", savedAt: null }, NOW + 1), lost, "a copy with no time keeps the known one");
});

test("a send with no answer marks the page lost and keeps a saved time it has", () => {
  const lost = nextConnection(CONNECTED, { type: "sendFailed" }, NOW);
  assert.deepEqual(lost, { lost: true, savedAt: null, since: NOW, justConnected: false });
  assert.equal(nextConnection(lost, { type: "sendFailed" }, NOW + 1), lost);
  const stale = nextConnection(CONNECTED, { type: "stale", savedAt: SAVED }, NOW);
  assert.equal(nextConnection(stale, { type: "sendFailed" }, NOW + 1).savedAt, SAVED);
});

test("a fresh answer after an outage clears it and says connected; a fresh answer while connected changes nothing", () => {
  const lost = nextConnection(CONNECTED, { type: "stale", savedAt: SAVED }, NOW);
  const back = nextConnection(lost, { type: "fresh" }, NOW + 9000);
  assert.deepEqual(back, { lost: false, savedAt: null, since: null, justConnected: true });
  assert.equal(nextConnection(CONNECTED, { type: "fresh" }, NOW), CONNECTED);
  assert.equal(nextConnection(back, { type: "fresh" }, NOW), back, "a second answer does not restart the green line");
  assert.deepEqual(nextConnection(back, { type: "settled" }, NOW + 1800), CONNECTED);
  assert.equal(nextConnection(CONNECTED, { type: "settled" }, NOW), CONNECTED);
});

test("a new outage during the green line ends it at once", () => {
  const back = nextConnection(nextConnection(CONNECTED, { type: "sendFailed" }, NOW), { type: "fresh" }, NOW + 1);
  const again = nextConnection(back, { type: "sendFailed" }, NOW + 2);
  assert.deepEqual(again, { lost: true, savedAt: null, since: NOW + 2, justConnected: false });
});

test("without a worker any newer data is live; with one it must also be newer than the outage", () => {
  const before = "2026-10-19T07:24:00.000Z";
  const after = "2026-10-19T07:31:00.000Z";
  assert.equal(isFreshAdvance(before, after, NOW, false), true);
  assert.equal(isFreshAdvance(before, before, NOW, false), false, "the same data is not an answer");
  assert.equal(isFreshAdvance(after, before, NOW, false), false, "older data is not an answer");
  assert.equal(isFreshAdvance(before, after, NOW, true), true, "07:31 is after the outage began at 07:30");
  assert.equal(isFreshAdvance(before, "2026-10-19T07:29:00.000Z", NOW, true), false, "a saved copy from before the outage");
  assert.equal(isFreshAdvance(before, after, null, true), false, "no outage, nothing to prove");
  assert.equal(isFreshAdvance(before, "not a time", NOW, false), false);
});

test("the strip names the saved time of the copy, else the read time of the page", () => {
  const lost = nextConnection(CONNECTED, { type: "stale", savedAt: SAVED }, NOW);
  assert.equal(shownTime(lost, "2026-10-19T07:00:00.000Z"), SAVED);
  assert.equal(shownTime(nextConnection(CONNECTED, { type: "sendFailed" }, NOW), "2026-10-19T07:00:00.000Z"), "2026-10-19T07:00:00.000Z");
});

test("the store: markStale, markFresh and markSendFailed move the state; the green line ends by itself", async () => {
  assert.equal(connection.connectionNow(), CONNECTED);
  connection.markStale(SAVED);
  assert.equal(connection.connectionNow().lost, true);
  connection.markFresh();
  assert.equal(connection.connectionNow().justConnected, true);
  await new Promise((resolve) => setTimeout(resolve, connection.CONNECTED_MS + 50));
  assert.deepEqual(connection.connectionNow(), CONNECTED);
  connection.markSendFailed();
  assert.equal(connection.connectionNow().lost, true);
  connection.markFresh();
  connection.markSendFailed();
  assert.equal(connection.connectionNow().justConnected, false, "the timer of the green line is gone");
  await new Promise((resolve) => setTimeout(resolve, connection.CONNECTED_MS + 50));
  assert.equal(connection.connectionNow().lost, true, "the old timer does not clear a new outage");
});
