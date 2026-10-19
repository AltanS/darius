/**
 * The demo's write stubs (web/server/demo.ts, 0.104.0): `bun run web:dev --demo` answers a check, a
 * run start, an answer and a finding close after a pause, and keeps the starts it was asked for in
 * memory, `starting` for 45 s and then `started`. No server is started here; the dev server only wires
 * these functions to HTTP.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { DEMO_REPLY_MS, DEMO_START_MS, DEMO_WRITE_PATHS, createDemoStarts, demoContext, demoWrite } from "../web/server/demo.ts";
import { webContext } from "../src/web/context.ts";

const MESSAGE = "demo has not confirmed the start yet. It shows in Now when it starts.";

test("demo: the pause is one second and a start takes 45 seconds", () => {
  assert.equal(DEMO_REPLY_MS, 1000);
  assert.equal(DEMO_START_MS, 45_000);
  for (const path of ["/api/vigil/check", "/api/run/ack", "/api/run/answer", "/api/run/follow-up", "/api/finding/close", "/api/finding/reopen"]) assert.ok(DEMO_WRITE_PATHS.has(path), path);
});

test("demo: a check answers pending with id, host and time, and the entry turns started after 45 s with no run", () => {
  let now = Date.parse("2026-10-19T10:00:00.000Z");
  const starts = createDemoStarts(() => now);
  const reply = demoWrite("/api/vigil/check", JSON.stringify({ project: "demo-shop", slug: "queue" }), starts);
  assert.equal(reply.status, 202);
  assert.deepEqual(reply.body, { ok: true, pending: true, host: "demo", id: "01DEMOSTART000000000000001", at: "2026-10-19T10:00:00.000Z", message: MESSAGE });
  assert.deepEqual(starts.poll(["01DEMOSTART000000000000001", "01DEMOSTART000000000000009"]), [
    { id: "01DEMOSTART000000000000001", state: "starting", host: "demo", at: "2026-10-19T10:00:00.000Z", kind: "vigil-check", project: "demo-shop", item: "queue" },
    { id: "01DEMOSTART000000000000009", state: "unknown" },
  ]);
  now += DEMO_START_MS - 1;
  assert.equal(starts.list(null)[0]?.state, "starting");
  now += 1;
  const done = starts.list("demo-shop");
  assert.deepEqual([done[0]?.state, done[0]?.run, done[0]?.vigil], ["started", undefined, "queue"]);
  assert.deepEqual(starts.list("atlas-docs"), []);
});

test("demo: a follow-up, Send and run now and Answer and resume start a run with a fake run id; a plain ack and a finding close just answer ok", () => {
  let now = Date.parse("2026-10-19T10:00:00.000Z");
  const starts = createDemoStarts(() => now);
  const run = "01DEMORUNPARENT00000000000A";
  assert.equal(demoWrite("/api/run/follow-up", JSON.stringify({ project: "demo-shop", run, approve: [1] }), starts).status, 202);
  assert.equal(demoWrite("/api/run/ack", JSON.stringify({ project: "demo-shop", run, runNow: true }), starts).body.pending, true);
  assert.equal(demoWrite("/api/run/answer", JSON.stringify({ project: "demo-shop", run, answers: [{ n: 1, text: "yes" }], resume: true }), starts).body.pending, true);
  assert.deepEqual(demoWrite("/api/run/ack", JSON.stringify({ project: "demo-shop", run }), starts), { status: 200, body: { ok: true } });
  assert.deepEqual(demoWrite("/api/finding/close", JSON.stringify({ project: "demo-shop", ritual: "site-report", key: "k" }), starts), { status: 200, body: { ok: true } });
  assert.deepEqual(demoWrite("/api/run/ack-earlier", JSON.stringify({ project: "demo-shop", run, runs: ["a", "b"] }), starts), { status: 200, body: { ok: true, count: 2 } });
  assert.equal(demoWrite("/api/run/ack", "{nope", starts).status, 400);
  assert.deepEqual(starts.list(null).map((one) => [one.kind, one.state]), [["resume", "starting"], ["run-now", "starting"], ["follow-up", "starting"]]);
  now += DEMO_START_MS;
  const started = starts.list(null);
  assert.deepEqual(started.map((one) => one.state), ["started", "started", "started"]);
  assert.equal(started.find((one) => one.kind === "resume")?.run, run, "a resume goes on with the same run");
  for (const one of started.filter((entry) => entry.kind !== "resume")) assert.match(one.run ?? "", /^[0-9A-Z]{26}$/u);
});

function twoIds(): string[] {
  const starts = createDemoStarts(() => 0);
  demoWrite("/api/vigil/check", JSON.stringify({ project: "demo-shop", slug: "a" }), starts);
  demoWrite("/api/vigil/check", JSON.stringify({ project: "demo-shop", slug: "b" }), starts);
  return starts.list(null).map((one) => one.id);
}

test("demo: the same asks give the same ids on each run, and the demo context serves the entries", () => {
  assert.deepEqual(twoIds(), twoIds());
  const starts = createDemoStarts(() => 0);
  const context = demoContext(webContext("demo"), starts);
  assert.deepEqual(context.pending(null), []);
  demoWrite("/api/vigil/check", JSON.stringify({ project: "demo-shop", slug: "a" }), starts);
  assert.equal(context.pending("demo-shop").length, 1);
  assert.equal(context.pending("atlas-docs").length, 0);
});
