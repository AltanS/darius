/**
 * The light poll that follows a start (web/app/lib/follow-starts.ts): the
 * schedule (1.5 s, every 3 s to 1 minute after the ask, every 10 s to 15
 * minutes), the stop rule, what counts as a change, and how the answer of
 * `GET /api/pending` is read. The timer and the hook run in a browser.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { PendingPollEntry } from "../src/web/api.ts";

const follow = await import("../web/app/lib/follow-starts.ts");

const ASKED = "2026-10-19T07:18:00.000Z";
const at = (ms: number): number => Date.parse(ASKED) + ms;

function entry(id: string, state: "starting" | "started" | "refused" | "lost", extra: Partial<Extract<PendingPollEntry, { host: string }>> = {}): PendingPollEntry {
  return { id, state, host: "host-b", at: ASKED, kind: "vigil-check", project: "demo", item: "guard", ...extra };
}

const MIN = 60_000;

test("the first look comes 1.5 s after an id is followed, whatever its age", () => {
  assert.equal(follow.lookDelay(0, 0), 1500);
  assert.equal(follow.lookDelay(0, 5 * MIN), 1500);
});

test("then a look every 3 s until 1 minute after the ask, and every 10 s after", () => {
  assert.equal(follow.lookDelay(1, 0), 3000);
  assert.equal(follow.lookDelay(7, 59_999), 3000);
  assert.equal(follow.lookDelay(8, 60_000), 10_000);
  assert.equal(follow.lookDelay(30, 14 * MIN), 10_000);
});

test("no look is planned once the ask is 15 minutes old", () => {
  assert.equal(follow.lookDelay(0, 15 * MIN - 1), 1500);
  assert.equal(follow.lookDelay(0, 15 * MIN), null);
  assert.equal(follow.lookDelay(40, 20 * MIN), null);
});

test("an id with no answer or a `starting` one is open; every other state, `unknown` too, is decided", () => {
  assert.equal(follow.isOpen(undefined), true);
  assert.equal(follow.isOpen(entry("a", "starting")), true);
  for (const state of ["started", "refused", "lost"] as const) assert.equal(follow.isOpen(entry("a", state)), false, state);
  assert.equal(follow.isOpen({ id: "a", state: "unknown" }), false);
});

test("the poll stops when every id has left `starting`; an id with no answer keeps it going", () => {
  const some = new Map([entry("a", "started"), entry("b", "starting")].map((one) => [one.id, one]));
  assert.equal(follow.isSettled(["a", "b"], some), false);
  assert.equal(follow.isSettled(["a", "c"], some), false, "c has no answer yet");
  const done = new Map([entry("a", "started"), { id: "b", state: "unknown" as const }].map((one) => [one.id, one]));
  assert.equal(follow.isSettled(["a", "b"], done), true);
  assert.equal(follow.isSettled([], new Map()), true, "nothing to follow");
});

test("the age that sets the pace is the earliest ask among the open ids", () => {
  const entries = new Map([entry("a", "starting", { at: "2026-10-19T07:18:00.000Z" }), entry("b", "starting", { at: "2026-10-19T07:10:00.000Z" }), entry("c", "started", { at: "2026-10-19T06:00:00.000Z" })].map((one) => [one.id, one]));
  assert.equal(follow.earliestAge(["a", "b", "c"], entries, at(0)), 8 * MIN, "a decided id does not count");
  assert.equal(follow.earliestAge(["a"], entries, at(30_000)), 30_000);
  assert.equal(follow.earliestAge(["z"], entries, at(0)), 0, "no answer yet: the ask is new");
  assert.equal(follow.earliestAge(["a"], entries, at(-5000)), 0, "a clock behind the host never gives a negative age");
});

test("a state that differs from the known one is a change; an id with no answer was `starting`", () => {
  const known = new Map([entry("a", "starting")].map((one) => [one.id, one]));
  assert.equal(follow.hasChanged(known, [entry("a", "starting")]), false);
  assert.equal(follow.hasChanged(known, [entry("a", "started")]), true);
  assert.equal(follow.hasChanged(known, [entry("z", "starting")]), false, "z had no answer: still starting");
  assert.equal(follow.hasChanged(known, [entry("z", "refused")]), true);
  assert.equal(follow.hasChanged(known, [{ id: "a", state: "unknown" }]), true);
});

test("readPoll reads the entries of the answer and leaves out what it cannot read", () => {
  const body = JSON.stringify({
    ok: true,
    starts: [
      { id: "a", state: "started", host: "host-b", at: ASKED, kind: "run-now", project: "demo", item: "daily", run: "01KRUN" },
      { id: "b", state: "unknown" },
      { id: "c", state: "weird", host: "h", at: ASKED, kind: "run-now", project: "demo", item: "x" },
      { id: "d", state: "starting", host: "h", at: ASKED, kind: "nope", project: "demo", item: "x" },
      { id: "e", state: "starting", host: "h", at: ASKED, kind: "resume", project: "demo", item: "x" },
      "text",
    ],
  });
  assert.deepEqual(follow.readPoll(body), [
    { id: "a", state: "started", host: "host-b", at: ASKED, kind: "run-now", project: "demo", item: "daily", run: "01KRUN" },
    { id: "b", state: "unknown" },
    { id: "e", state: "starting", host: "h", at: ASKED, kind: "resume", project: "demo", item: "x" },
  ]);
  assert.equal(follow.readPoll("not json"), null);
  assert.equal(follow.readPoll('{"ok":false,"error":"no"}'), null);
  assert.equal(follow.readPoll('{"ok":true}'), null);
});

test("a Now row id maps to its registry id", () => {
  assert.equal(follow.startIdOf("start-01KABC"), "01KABC");
  assert.equal(follow.startIdOf("01KABC"), "01KABC");
});

test("the limits match the design: 1.5 s, 3 s, 1 minute, 10 s, 15 minutes, 50 ids", () => {
  assert.deepEqual([follow.FIRST_LOOK_MS, follow.FAST_LOOK_MS, follow.FAST_WINDOW_MS, follow.SLOW_LOOK_MS, follow.GIVE_UP_MS, follow.MAX_IDS], [1500, 3000, 60_000, 10_000, 900_000, 50]);
});

// --- what is gone from the client ---------------------------------------------------------------

const APP = fileURLToPath(new URL("../web/app/", import.meta.url));

/** The `.ts` and `.tsx` files of web/app, with their text. */
function sources(): Array<{ file: string; code: string }> {
  return readdirSync(APP, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/u.test(file))
    .map((file) => ({ file, code: readFileSync(`${APP}${file}`, "utf8") }));
}

test("lib/reload.ts and every timed reload are gone", () => {
  assert.equal(existsSync(`${APP}lib/reload.ts`), false);
  for (const { file, code } of sources()) {
    assert.equal(/useReloadSoon|reloadSoon|RELOAD_STEPS/u.test(code), false, `${file} has no timed reload`);
  }
});

test("no client sentence names a file path, a flag, a reload or a stalled check", () => {
  for (const { file, code } of sources().filter((one) => !one.file.endsWith("app.css"))) {
    for (const bad of ["--force", "follow-up.log", "Look again", "No result yet after", "after this page answers", "Reload in a moment"]) {
      assert.equal(code.includes(bad), false, `${file} says "${bad}"`);
    }
  }
});
