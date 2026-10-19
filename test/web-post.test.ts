/**
 * The one write path of the web app (web/app/lib/post.ts) against a fake
 * fetch: a POST with no answer says "No connection. Nothing was sent." and
 * marks the connection lost; while lost, nothing is sent at all; a real POST
 * carries a deadline; the other answers read as before.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const { postJson, NOT_SENT } = await import("../web/app/lib/post.ts");
const connection = await import("../web/app/lib/connection.ts");

interface Sent {
  path: string;
  signal: AbortSignal | null;
}

const sent: Sent[] = [];
let answer: () => Promise<Response> = () => Promise.resolve(Response.json({ ok: true }));

globalThis.fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  sent.push({ path: String(input), signal: init?.signal ?? null });
  return answer();
};

test("a POST the host answers reads as before, and carries a deadline", async () => {
  answer = () => Promise.resolve(Response.json({ ok: true, started: true }));
  const reply = await postJson("/api/run", { project: "demo" });
  assert.equal(reply.ok, true);
  assert.equal(sent.at(-1)?.signal instanceof AbortSignal, true, "the POST can be cut off after 20 s");
  answer = () => Promise.resolve(Response.json({ ok: false, error: "Refused." }, { status: 409 }));
  assert.deepEqual(await postJson("/api/run", { project: "demo" }), { ok: false, status: 409, error: "Refused." });
});

test("a POST with no answer says nothing was sent and marks the connection lost; then nothing is sent until the host is back", async () => {
  answer = () => Promise.reject(new TypeError("Failed to fetch"));
  assert.deepEqual(await postJson("/api/run", { project: "demo" }), { ok: false, status: 0, error: NOT_SENT });
  assert.equal(NOT_SENT, "No connection. Nothing was sent.");
  assert.equal(connection.connectionNow().lost, true);
  const before = sent.length;
  answer = () => Promise.resolve(Response.json({ ok: true }));
  assert.deepEqual(await postJson("/api/run", { project: "demo" }), { ok: false, status: 0, error: NOT_SENT });
  assert.equal(sent.length, before, "no fetch while lost");
  connection.markFresh();
  assert.equal((await postJson("/api/run", { project: "demo" })).ok, true);
  assert.equal(sent.length, before + 1);
});

test("a POST cut off by its deadline says the same", async () => {
  answer = () => Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
  connection.markFresh();
  assert.deepEqual(await postJson("/api/run", { project: "demo" }), { ok: false, status: 0, error: NOT_SENT });
});
