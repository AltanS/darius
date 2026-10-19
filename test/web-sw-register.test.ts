/**
 * The registration helper of the web app (web/app/lib/sw.ts): the worker
 * address names the version, a worker message is read safely, and the page
 * reloads for a new version once, never while the host is away.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const sw = await import("../web/app/lib/sw.ts");

test("the worker address carries the darius version", () => {
  assert.equal(sw.workerUrl("0.103.0"), "/sw.js?v=0.103.0");
  assert.equal(sw.workerUrl("1.0.0+a b"), "/sw.js?v=1.0.0%2Ba%20b");
});

test("a worker message: stale with its time, fresh, or nothing", () => {
  assert.deepEqual(sw.readWorkerMessage({ type: "stale", savedAt: "2026-10-19T07:24:00.000Z" }), { type: "stale", savedAt: "2026-10-19T07:24:00.000Z" });
  assert.deepEqual(sw.readWorkerMessage({ type: "stale" }), { type: "stale", savedAt: null });
  assert.deepEqual(sw.readWorkerMessage({ type: "stale", savedAt: "" }), { type: "stale", savedAt: null });
  assert.deepEqual(sw.readWorkerMessage({ type: "fresh" }), { type: "fresh" });
  assert.equal(sw.readWorkerMessage({ type: "precache-progress" }), null);
  assert.equal(sw.readWorkerMessage(null), null);
});

test("a new version reloads the page once, and never while the host is away", () => {
  assert.equal(sw.needsReload("0.103.0", "0.104.0", null, false), true);
  assert.equal(sw.needsReload("0.103.0", "0.104.0", "0.104.0", false), false, "already reloaded for it");
  assert.equal(sw.needsReload("0.103.0", "0.104.0", "0.103.0", false), true, "a guard of an older version does not count");
  assert.equal(sw.needsReload("0.103.0", "0.104.0", null, true), false, "a reload with no connection would lose the page");
  assert.equal(sw.needsReload("0.103.0", "0.103.0", null, false), false);
  assert.equal(sw.needsReload(null, "0.104.0", null, false), false, "no worker registered: nothing to match");
});
