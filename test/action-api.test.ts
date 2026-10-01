/**
 * `src/web/action-api.ts`: the run page's follow-up button (0.48.0). The
 * guards of `POST /api/run/follow-up`, the body it accepts, and what it
 * starts. Readiness and the spawn are stubs here; the real readiness is
 * covered in test/runner.test.ts, next to the CLI it mirrors.
 *
 * SAFETY: the state and config dirs are `mkdtemp` dirs; no process starts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendLine } from "../src/core/ledger.ts";
import type { JsonValue } from "../src/core/model.ts";
import { openProject } from "../src/core/store.ts";
import { actionApi, LOOPBACK_FOLLOW_UP, type ActionDeps, type ActionRequest } from "../src/web/action-api.ts";
import { webContext } from "../src/web/context.ts";
import type { FollowUpReadiness } from "../src/web/api.ts";

const sandbox = mkdtempSync(join(tmpdir(), "darius-action-api-test-"));
process.env.DARIUS_CONFIG_DIR = join(sandbox, "config");
process.env.DARIUS_STATE_DIR = join(sandbox, "state");
delete process.env.DARIUS_WEB_URL;
mkdirSync(process.env.DARIUS_CONFIG_DIR, { recursive: true });
writeFileSync(join(process.env.DARIUS_CONFIG_DIR, "config.toml"), 'host = "host-a"\n');

const PROJECT = "demo";
const RUN = "01JPARENT0000000000000000A";
appendLine(openProject(PROJECT, { create: true }), { who: "timer", type: "run.started", item: "ritual/daily", run: RUN });

const READY: FollowUpReadiness = {
  ready: true,
  host: "host-a",
  profile: "opus-skip",
  questions: [
    { n: 1, commands: ["pnpm -C tools cli fc --post 12 --confirm"] },
    { n: 3, commands: ["git push origin main"] },
  ],
};

interface Started {
  argv: readonly string[];
  log: string;
}

/** Stubs that record what would start, with the readiness given. */
function deps(readiness: FollowUpReadiness): ActionDeps & { started: Started[]; asked: string[] } {
  const started: Started[] = [];
  const asked: string[] = [];
  return {
    started,
    asked,
    readiness: (project, run) => {
      asked.push(`${project}/${run}`);
      return Promise.resolve(readiness);
    },
    start: (argv, log) => {
      started.push({ argv, log });
    },
  };
}

function postRaw(body: string, overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    method: "POST",
    path: "/api/run/follow-up",
    headers: new Headers({ origin: "http://127.0.0.1:4747", host: "127.0.0.1:4747", "content-type": "application/json" }),
    body,
    ...overrides,
  };
}

function post(body: JsonValue, overrides: Partial<ActionRequest> = {}): ActionRequest {
  return postRaw(JSON.stringify(body), overrides);
}

function isRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function errorOf(body: JsonValue): string {
  return isRecord(body) && isText(body.error) ? body.error : "";
}

const VALID = { project: PROJECT, run: RUN, approve: [1] };

test("the guards: path 404, method 405, no or foreign Origin 403, other content 415, a large body 413, bad JSON 400", async () => {
  const stub = deps(READY);
  assert.equal((await actionApi(post(VALID, { path: "/api/run/answer" }), { who: "owner" }, stub)).status, 404);
  assert.equal((await actionApi(post(VALID, { method: "GET" }), { who: "owner" }, stub)).status, 405);
  const noOrigin = post(VALID, { headers: new Headers({ host: "127.0.0.1:4747", "content-type": "application/json" }) });
  const refused = await actionApi(noOrigin, { who: "owner" }, stub);
  assert.equal(refused.status, 403);
  assert.match(errorOf(refused.body), /must come from the darius page/u);
  const foreign = post(VALID, { headers: new Headers({ origin: "http://evil.example", host: "127.0.0.1:4747", "content-type": "application/json" }) });
  assert.equal((await actionApi(foreign, { who: "owner" }, stub)).status, 403);
  const text = post(VALID, { headers: new Headers({ origin: "http://127.0.0.1:4747", host: "127.0.0.1:4747", "content-type": "text/plain" }) });
  assert.equal((await actionApi(text, { who: "owner" }, stub)).status, 415);
  assert.equal((await actionApi(postRaw(JSON.stringify({ ...VALID, note: "x".repeat(5000) })), { who: "owner" }, stub)).status, 413);
  assert.equal((await actionApi(postRaw("{not json"), { who: "owner" }, stub)).status, 400);
  assert.deepEqual([stub.started, stub.asked], [[], []], "nothing checked, nothing started");
});

test("a wrong project or run is 400, and so is a body that is not question numbers", async () => {
  const stub = deps(READY);
  const cases: [JsonValue, RegExp][] = [
    [{ ...VALID, project: "nope" }, /no project nope/u],
    [{ ...VALID, project: "../etc" }, /project must be a project name/u],
    [{ ...VALID, run: "01JNOSUCHRUN0000000000000A" }, /no run 01JNOSUCHRUN0000000000000A in demo/u],
    [{ ...VALID, run: "../../x" }, /run must be a run id/u],
    [{ ...VALID, approve: [] }, /approve must list question numbers/u],
    [{ ...VALID, approve: [0] }, /approve must list question numbers/u],
    [{ ...VALID, approve: ["1"] }, /approve must list question numbers/u],
    [{ ...VALID, approve: [1.5] }, /approve must list question numbers/u],
    [{ ...VALID, note: 7 }, /note must be text/u],
    [{ ...VALID, note: "a\u0007b" }, /no control characters/u],
    [[1], /send \{ project, run, approve/u],
  ];
  for (const [body, reason] of cases) {
    const answer = await actionApi(post(body), { who: "owner" }, stub);
    assert.equal(answer.status, 400, JSON.stringify(body));
    assert.match(errorOf(answer.body), reason, JSON.stringify(body));
  }
  assert.deepEqual(stub.started, []);
});

test("grant lines in the body are refused: the page approves question numbers only", async () => {
  const stub = deps(READY);
  for (const body of [
    { ...VALID, grant: ["rm -rf /srv"] },
    { ...VALID, grants: ["rm -rf /srv"] },
    { ...VALID, commands: ["rm -rf /srv"] },
    { project: PROJECT, run: RUN, grant: "date" },
  ]) {
    const answer = await actionApi(post(body), { who: "owner" }, stub);
    assert.equal(answer.status, 400, JSON.stringify(body));
    assert.match(errorOf(answer.body), /the page approves question numbers only, and grant lines are for darius run follow-up on the command line/u);
  }
  assert.deepEqual([stub.started, stub.asked], [[], []]);
});

test("the loopback viewer gets 403: a follow-up needs a tailnet identity, and the run page says so", async () => {
  const stub = deps(READY);
  const answer = await actionApi(post(VALID), { who: "this host", local: true }, stub);
  assert.equal(answer.status, 403);
  assert.equal(errorOf(answer.body), "the follow-up button needs a tailnet identity; open the page by its tailnet address");
  assert.equal(errorOf(answer.body), LOOPBACK_FOLLOW_UP);
  assert.deepEqual([stub.started, stub.asked], [[], []], "nothing starts, readiness is not even asked");
  assert.deepEqual(await webContext("this host", undefined, true).followUp(PROJECT, RUN), { ready: false, host: "host-a", reason: LOOPBACK_FOLLOW_UP });
});

test("not ready here: 409 with the reason, nothing starts", async () => {
  for (const reason of ["gated profile: profile x has permissions gated", "no herdr on host-a: no herdr server is running"]) {
    const stub = deps({ ready: false, host: "host-a", reason });
    const answer = await actionApi(post(VALID), { who: "owner" }, stub);
    assert.equal(answer.status, 409);
    assert.equal(errorOf(answer.body), reason);
    assert.deepEqual(stub.asked, [`${PROJECT}/${RUN}`], "readiness is checked again on the server");
    assert.deepEqual(stub.started, []);
  }
  const stub = deps(READY);
  const answer = await actionApi(post({ ...VALID, approve: [2] }), { who: "owner" }, stub);
  assert.equal(answer.status, 400);
  assert.match(errorOf(answer.body), /question 2 lists no commands to approve/u);
  assert.deepEqual(stub.started, []);
});

test("ready: it starts run follow-up detached with the approved numbers, the note and the viewer, and answers pending", async () => {
  const stub = deps(READY);
  const answer = await actionApi(post({ ...VALID, approve: [3, 1, 3], note: "  push it\nnow " }), { who: "owner on phone" }, stub);
  assert.equal(answer.status, 202);
  assert.deepEqual(answer.body, { ok: true, pending: true });
  assert.equal(stub.started.length, 1);
  const [started] = stub.started;
  assert.deepEqual(started?.argv, ["run", "follow-up", RUN, "--project", PROJECT, "--approve", "3", "--approve", "1", "--note", "push it now", "--who", "web:owner on phone"]);
  const runDir = join(openProject(PROJECT).root, "runs", RUN);
  assert.equal(started?.log, join(runDir, "follow-up.log"));
  assert.ok(existsSync(runDir), "the parent's run dir exists for the log");
  assert.ok(!(started?.argv ?? []).includes("--grant"), "never a grant line");
  assert.ok(!(started?.argv ?? []).includes("--headless"), "attended: the CLI opens a herdr tab");
});
