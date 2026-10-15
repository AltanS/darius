/**
 * How the page follows a "Check now" (web/app/lib/check-poll.ts, 0.95.0): the
 * look schedule, the phase a pending start is in, and which pending start a
 * vigil shows. The timer itself lives in the component and is checked in a
 * browser; this file proves the rules it follows.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import type { PendingStart } from "../src/web/api.ts";

const poll = await import("../web/app/lib/check-poll.ts");

const ASKED = "2026-10-15T10:00:00.000Z";
const at = (ms: number): number => Date.parse(ASKED) + ms;

function start(extra: Partial<PendingStart>): PendingStart {
  return { id: "a", at: ASKED, who: "web:altan", kind: "vigil-check", project: "demo", vigil: "guard", host: "host-b", state: "starting", ...extra };
}

test("the page looks at 1.5 s, 5 s, then every 5 s", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((step) => poll.lookAt(step)), [1500, 5000, 10000, 15000, 20000]);
});

test("the window is 3 minutes, so the schedule ends after the 36th look", () => {
  assert.equal(poll.CHECK_WINDOW_MS, 180_000);
  assert.equal(poll.lookAt(36), poll.CHECK_WINDOW_MS);
});

test("a starting check is `checking` until 3 minutes after it was asked, then `stalled`", () => {
  assert.equal(poll.checkPhase(start({}), at(0)), "checking");
  assert.equal(poll.checkPhase(start({}), at(179_999)), "checking");
  assert.equal(poll.checkPhase(start({}), at(180_000)), "stalled");
  assert.equal(poll.checkPhase(start({}), at(10 * 60_000)), "stalled");
});

test("no pending start, or a started one, is `idle`: the button comes back and nothing looks", () => {
  assert.equal(poll.checkPhase(null, at(0)), "idle");
  assert.equal(poll.checkPhase(start({ state: "started" }), at(0)), "idle");
});

test("a refused or a lost check stops the looking and keeps its sentence", () => {
  assert.equal(poll.checkPhase(start({ state: "refused", sentence: "no" }), at(1000)), "refused");
  assert.equal(poll.checkPhase(start({ state: "lost" }), at(1000)), "lost");
});

test("only a `checking` phase keeps the timer: every other phase ends it", () => {
  const phases = [poll.checkPhase(null, 0), poll.checkPhase(start({ state: "started" }), 0), poll.checkPhase(start({ state: "refused" }), 0), poll.checkPhase(start({ state: "lost" }), 0), poll.checkPhase(start({}), at(180_000))];
  assert.deepEqual(phases.filter((phase) => phase === "checking"), []);
});

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
