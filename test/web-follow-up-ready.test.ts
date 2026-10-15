/**
 * The follow-up readiness read (0.98.0): `GET /api/run/follow-up/ready`, the
 * check the run page asks after it renders, and the pure rules the card uses
 * with the answer (web/app/lib/follow-up-load.ts, busy.ts). The guards are the
 * POST's except the Origin check; the loopback viewer gets `ready: false` with
 * its reason. Readiness is a stub here; the real one is covered in
 * test/runner.test.ts.
 *
 * SAFETY: the state and config dirs are `mkdtemp` dirs; no process starts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendLine } from "../src/core/ledger.ts";
import type { JsonValue } from "../src/core/model.ts";
import { openProject } from "../src/core/store.ts";
import { actionApi, FOLLOW_UP_READY_PATH, LOOPBACK_FOLLOW_UP, type ActionDeps, type ActionRequest } from "../src/web/action-api.ts";
import type { FollowUpReadiness } from "../src/web/api.ts";

const sandbox = mkdtempSync(join(tmpdir(), "darius-follow-up-ready-test-"));
process.env.DARIUS_CONFIG_DIR = join(sandbox, "config");
process.env.DARIUS_STATE_DIR = join(sandbox, "state");
delete process.env.DARIUS_WEB_URL;
mkdirSync(process.env.DARIUS_CONFIG_DIR, { recursive: true });
writeFileSync(join(process.env.DARIUS_CONFIG_DIR, "config.toml"), 'host = "host-a"\n');

const loadFile = await import("../web/app/lib/follow-up-load.ts");
const busy = await import("../web/app/lib/busy.ts");

const PROJECT = "demo";
const RUN = "01JPARENT0000000000000000A";
appendLine(openProject(PROJECT, { create: true }), { who: "timer", type: "run.started", item: "ritual/daily", run: RUN });

const READY: FollowUpReadiness = {
  ready: true,
  host: "host-b",
  via: "host-a",
  profile: "opus-skip",
  surface: "headless",
  questions: [{ n: 1, commands: ["git push origin main"] }],
  items: [{ key: "post-12/title", title: "Title misses the query" }],
};

/** Stubs that count what happens; a read must start nothing and run no CLI. */
interface Counting extends ActionDeps {
  asked: string[];
  started: number;
}

function deps(readiness: FollowUpReadiness): Counting {
  const asked: string[] = [];
  const stub: Counting = {
    asked,
    started: 0,
    readiness: (project, run) => {
      asked.push(`${project}/${run}`);
      return Promise.resolve(readiness);
    },
    start: () => {
      stub.started += 1;
      return { exited: Promise.resolve(0) };
    },
    run: () => Promise.reject(new Error("a readiness read must not run the CLI")),
  };
  return stub;
}

function get(query: string, overrides: Partial<ActionRequest> = {}): ActionRequest {
  return { method: "GET", path: FOLLOW_UP_READY_PATH, headers: new Headers({ host: "127.0.0.1:4747" }), body: "", query, ...overrides };
}

/** The `error` of a refusal body. */
function errorOf(value: JsonValue): string {
  assert.ok(isRecord(value), "an object body");
  return String(value.error);
}

function isRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

test("the path is under the action prefix", () => {
  assert.equal(FOLLOW_UP_READY_PATH, "/api/run/follow-up/ready");
});

test("a ready check answers 200 with the readiness and the ok flag, and starts nothing", async () => {
  const stub = deps(READY);
  const answer = await actionApi(get(`?project=${PROJECT}&run=${RUN}`), { who: "owner" }, stub);
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.body, { ok: true, ...READY });
  assert.deepEqual(stub.asked, [`${PROJECT}/${RUN}`]);
  assert.equal(stub.started, 0);
});

test("an off check answers 200 too, with the reason and the ritual's host", async () => {
  const off: FollowUpReadiness = { ready: false, host: "host-a", reason: "on host-b: ssh to host-b failed", rightHost: "host-b" };
  const answer = await actionApi(get(`project=${PROJECT}&run=${RUN}`), { who: "owner" }, deps(off));
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.body, { ok: true, ...off });
});

test("a read needs no Origin: no header, a foreign one and a matching one all pass; the POST still refuses a foreign one", async () => {
  for (const headers of [{}, { origin: "https://evil.example" }, { origin: "http://127.0.0.1:4747" }]) {
    const stub = deps(READY);
    const answer = await actionApi(get(`?project=${PROJECT}&run=${RUN}`, { headers: new Headers({ host: "127.0.0.1:4747", ...headers }) }), { who: "owner" }, stub);
    assert.equal(answer.status, 200, JSON.stringify(headers));
  }
  const post = await actionApi(
    { method: "POST", path: "/api/run/follow-up", headers: new Headers({ origin: "https://evil.example", host: "127.0.0.1:4747", "content-type": "application/json" }), body: JSON.stringify({ project: PROJECT, run: RUN, approve: [1] }) },
    { who: "owner" },
    deps(READY),
  );
  assert.equal(post.status, 403, "the write keeps its Origin guard");
});

test("a read that a page of another site starts is refused; the same site and a plain client pass", async () => {
  for (const [site, status] of [["cross-site", 403], ["same-origin", 200], ["same-site", 200], ["none", 200]] as const) {
    const stub = deps(READY);
    const headers = new Headers({ host: "127.0.0.1:4747", "sec-fetch-site": site });
    const answer = await actionApi(get(`?project=${PROJECT}&run=${RUN}`, { headers }), { who: "owner" }, stub);
    assert.equal(answer.status, status, site);
    assert.equal(stub.asked.length, status === 200 ? 1 : 0, `${site}: readiness is asked only for an allowed read`);
  }
});

test("only GET reads: a POST or a PUT to the read path is 405", async () => {
  for (const method of ["POST", "PUT", "DELETE"]) {
    const stub = deps(READY);
    const answer = await actionApi(get(`?project=${PROJECT}&run=${RUN}`, { method }), { who: "owner" }, stub);
    assert.equal(answer.status, 405, method);
    assert.deepEqual(stub.asked, []);
  }
});

test("the loopback viewer gets ready: false with the reason of the POST, and readiness is not asked", async () => {
  const stub = deps(READY);
  const answer = await actionApi(get(`?project=${PROJECT}&run=${RUN}`), { who: "this host", local: true }, stub);
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.body, { ok: true, ready: false, host: "host-a", reason: LOOPBACK_FOLLOW_UP });
  assert.deepEqual(stub.asked, []);
});

test("names that are not names, a project that does not exist and a run that does not exist are 400, and readiness is not asked", async () => {
  for (const [query, expected] of [
    ["", /project must be a project name/u],
    [`?project=${PROJECT}`, /run must be a run id/u],
    ["?project=../etc&run=" + RUN, /project must be a project name/u],
    [`?project=${PROJECT}&run=a%20b`, /run must be a run id/u],
    [`?project=nope&run=${RUN}`, /no project nope/u],
    [`?project=${PROJECT}&run=01JNOSUCHRUN00000000000000`, /no run 01JNOSUCHRUN00000000000000 in demo/u],
  ] as const) {
    const stub = deps(READY);
    const answer = await actionApi(get(query), { who: "owner" }, stub);
    assert.equal(answer.status, 400, query);
    assert.match(errorOf(answer.body), expected, query);
    assert.deepEqual(stub.asked, [], query);
  }
});

// --- the card's rules ---------------------------------------------------------------------

test("readReadiness reads the body of the endpoint, off or ready, and fails on anything else", () => {
  const ready = loadFile.readReadiness(200, JSON.stringify({ ok: true, ...READY }));
  assert.deepEqual(ready, { state: "done", readiness: READY });
  const off = loadFile.readReadiness(200, JSON.stringify({ ok: true, ready: false, host: "host-a", reason: "x", rightHost: "host-b" }));
  assert.deepEqual(off, { state: "done", readiness: { ready: false, host: "host-a", reason: "x", rightHost: "host-b" } });
  assert.deepEqual(loadFile.readReadiness(409, JSON.stringify({ ok: false, error: "no run" })), { state: "failed", message: "no run" });
  assert.equal(loadFile.readReadiness(502, "<html>bad gateway</html>").state, "failed");
  assert.equal(loadFile.readReadiness(200, JSON.stringify({ ok: true, ready: true, host: "host-a" })).state, "failed", "a ready body without a profile, questions and items");
  assert.equal(loadFile.readReadiness(200, "[]").state, "failed");
});

test("a run with commands or proposals holds its card while the check runs; any other followable run draws nothing", () => {
  const certain = { host: "host-b", certain: true };
  const maybe = { host: "host-b", certain: false };
  assert.deepEqual(loadFile.cardView(certain, { state: "loading" }), { view: "waiting" });
  assert.deepEqual(loadFile.cardView(maybe, { state: "loading" }), { view: "none" }, "no card that shows and then vanishes");
});

test("a certain card shows when the check is off or failed, with the reason; a possible card shows only when ready", () => {
  const certain = { host: "host-b", certain: true };
  const maybe = { host: "host-b", certain: false };
  const off: FollowUpReadiness = { ready: false, host: "host-a", reason: "gated profile" };
  assert.deepEqual(loadFile.cardView(certain, { state: "done", readiness: off }), { view: "card", readiness: off });
  assert.deepEqual(loadFile.cardView(maybe, { state: "done", readiness: off }), { view: "none" });
  assert.deepEqual(loadFile.cardView(maybe, { state: "done", readiness: READY }), { view: "card", readiness: READY });
  assert.deepEqual(loadFile.cardView(certain, { state: "failed", message: "The host did not answer." }), { view: "card", readiness: { ready: false, host: "host-b", reason: "The host did not answer." } });
  assert.deepEqual(loadFile.cardView(maybe, { state: "failed", message: "x" }), { view: "none" });
});

test("the waiting texts: the host first, the honest sentence after 10 s", () => {
  assert.equal(loadFile.checkingText("host-b"), "Checking whether a follow-up can start on host-b…");
  assert.equal(loadFile.waitingText("host-b", 0), "Waiting for host-b…");
  assert.equal(loadFile.waitingText("host-b", 9_999), "Waiting for host-b…");
  assert.equal(loadFile.waitingText("host-b", 10_000), "Still waiting. The run may start after this page answers.");
});

test("the shell's gem blinks for navigation or a reload, and only after 300 ms", () => {
  assert.equal(busy.BUSY_AFTER_MS, 300);
  assert.equal(busy.isLoading("idle", "idle"), false);
  assert.equal(busy.isLoading("loading", "idle"), true);
  assert.equal(busy.isLoading("submitting", "idle"), true);
  assert.equal(busy.isLoading("idle", "loading"), true);
});
