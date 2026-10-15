/**
 * `POST /api/finding/reopen` (0.96.0): the guards it shares with the close
 * (test/action-api.test.ts), the body it takes, the findings it refuses, and
 * the argv it runs. The CLI is a stub here; one test runs the real CLI
 * against the sandbox store and reads the history it leaves.
 *
 * SAFETY: the state and config dirs are `mkdtemp` dirs; no process starts
 * but the sandboxed CLI of the last test.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectFindings } from "../src/core/finding-index.ts";
import { readLedger } from "../src/core/ledger.ts";
import type { JsonValue } from "../src/core/model.ts";
import { openProject } from "../src/core/store.ts";
import { findingApi, LOOPBACK_REOPEN, runCli, type ActionRequest, type CliAnswer, type FindingDeps } from "../src/web/action-api.ts";
import type { PushApiReply } from "../src/web/push-api.ts";
import { Seeder } from "./helpers/finding-seed.ts";

const sandbox = mkdtempSync(join(tmpdir(), "darius-web-finding-api-test-"));
process.env.DARIUS_CONFIG_DIR = join(sandbox, "config");
process.env.DARIUS_STATE_DIR = join(sandbox, "state");
delete process.env.DARIUS_WEB_URL;
mkdirSync(process.env.DARIUS_CONFIG_DIR, { recursive: true });
writeFileSync(join(process.env.DARIUS_CONFIG_DIR, "config.toml"), 'host = "host-a"\n');

const PROJECT = "reopening";
const seed = new Seeder(PROJECT);
seed.run("check", [
  { key: "shut-1", title: "Shut thing", severity: "low" },
  { key: "open-1", title: "Open thing", severity: "high", state: "needs-code" },
  { key: "done-1", title: "Done thing", severity: "low", state: "fixed" },
  { key: "--odd", title: "A key that looks like a flag", severity: "low" },
]);
seed.close("check", "shut-1", "known issue");
seed.close("check", "--odd");

function isRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorOf(body: JsonValue): string {
  const error = isRecord(body) ? body.error : undefined;
  return String(error ?? "");
}

function postRaw(body: string, overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    method: "POST",
    path: "/api/finding/reopen",
    headers: new Headers({ origin: "http://127.0.0.1:4747", host: "127.0.0.1:4747", "content-type": "application/json" }),
    body,
    ...overrides,
  };
}

function reopenRequest(body: JsonValue, overrides: Partial<ActionRequest> = {}): ActionRequest {
  return postRaw(JSON.stringify(body), overrides);
}

/** The real findings of the seeded project, and a CLI that records its argv. */
function reopenDeps(answer: CliAnswer = { code: 0, error: "" }): FindingDeps & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    findings: (project) => {
      const opened = openProject(project);
      return collectFindings(opened, readLedger(opened));
    },
    run: (argv) => {
      calls.push([...argv]);
      return Promise.resolve(answer);
    },
  };
}

const REOPEN = { project: PROJECT, ritual: "check", key: "shut-1" };
const OWNER = { who: "owner" };

test("reopen: path 404, method 405, no or foreign Origin 403, other content 415, a large body 413, bad JSON 400, the loopback viewer 403", async () => {
  const stub = reopenDeps();
  assert.equal((await findingApi(reopenRequest(REOPEN, { path: "/api/finding/open" }), OWNER, stub)).status, 404);
  assert.equal((await findingApi(reopenRequest(REOPEN, { method: "GET" }), OWNER, stub)).status, 405);
  const noOrigin = reopenRequest(REOPEN, { headers: new Headers({ host: "127.0.0.1:4747", "content-type": "application/json" }) });
  assert.equal((await findingApi(noOrigin, OWNER, stub)).status, 403);
  const foreign = reopenRequest(REOPEN, { headers: new Headers({ origin: "http://evil.example", host: "127.0.0.1:4747", "content-type": "application/json" }) });
  const refused = await findingApi(foreign, OWNER, stub);
  assert.equal(refused.status, 403);
  assert.match(errorOf(refused.body), /must come from the darius page/u);
  const text = reopenRequest(REOPEN, { headers: new Headers({ origin: "http://127.0.0.1:4747", host: "127.0.0.1:4747", "content-type": "text/plain" }) });
  assert.equal((await findingApi(text, OWNER, stub)).status, 415);
  assert.equal((await findingApi(reopenRequest({ ...REOPEN, note: "x".repeat(5000) }), OWNER, stub)).status, 413);
  assert.equal((await findingApi(postRaw("{not json"), OWNER, stub)).status, 400);
  const local = await findingApi(reopenRequest(REOPEN), { who: "this host", local: true }, stub);
  assert.equal(local.status, 403);
  assert.equal(errorOf(local.body), LOOPBACK_REOPEN);
  assert.match(LOOPBACK_REOPEN, /^reopening a finding needs a tailnet identity/u);
  assert.deepEqual(stub.calls, [], "nothing ran");
});

test("reopen: a body that is not project, ritual, key and a note is 400", async () => {
  const stub = reopenDeps();
  const cases: [JsonValue, RegExp][] = [
    [{ ...REOPEN, project: "../etc" }, /project must be a project name/u],
    [{ ...REOPEN, ritual: "a b" }, /ritual must be a ritual slug/u],
    [{ ...REOPEN, key: "" }, /key must be one line/u],
    [{ ...REOPEN, key: 5 }, /key must be one line/u],
    [{ ...REOPEN, note: 7 }, /note must be text/u],
    [{ ...REOPEN, note: "a\u0007b" }, /no control characters/u],
    [{ ...REOPEN, who: "admin" }, /unknown field who/u],
    [[1], /send \{ project, ritual, key, note\? \}/u],
  ];
  for (const [body, reason] of cases) {
    const answer = await findingApi(reopenRequest(body), OWNER, stub);
    assert.equal(answer.status, 400, JSON.stringify(body));
    assert.match(errorOf(answer.body), reason, JSON.stringify(body));
  }
  assert.deepEqual(stub.calls, []);
});

test("reopen: an unknown project or finding is 400, and a finding that is not closed is 409; nothing runs", async () => {
  const stub = reopenDeps();
  const unknownProject = await findingApi(reopenRequest({ ...REOPEN, project: "nope" }), OWNER, stub);
  assert.equal(unknownProject.status, 400);
  assert.match(errorOf(unknownProject.body), /no project nope/u);
  const unknownKey = await findingApi(reopenRequest({ ...REOPEN, key: "ghost" }), OWNER, stub);
  assert.equal(unknownKey.status, 400);
  assert.match(errorOf(unknownKey.body), /no finding 'ghost' in ritual 'check'/u);
  const otherRitual = await findingApi(reopenRequest({ ...REOPEN, ritual: "other" }), OWNER, stub);
  assert.equal(otherRitual.status, 400, "a key is scoped to its ritual");
  const open = await findingApi(reopenRequest({ ...REOPEN, key: "open-1" }), OWNER, stub);
  assert.equal(open.status, 409);
  assert.match(errorOf(open.body), /not closed \(status: needs-you\)/u);
  const fixed = await findingApi(reopenRequest({ ...REOPEN, key: "done-1" }), OWNER, stub);
  assert.equal(fixed.status, 409);
  assert.match(errorOf(fixed.body), /not closed \(status: fixed\)/u);
  assert.deepEqual(stub.calls, []);
});

test("reopen: it runs finding reopen with the ritual, the project, the note and the viewer, and the key after --", async () => {
  const stub = reopenDeps();
  const answer: PushApiReply = await findingApi(reopenRequest({ ...REOPEN, note: "  fixed\nit was wrong " }), { who: "owner on phone" }, stub);
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.body, { ok: true });
  assert.deepEqual(stub.calls, [["finding", "reopen", "--ritual", "check", "--project", PROJECT, "--note", "fixed it was wrong", "--who", "web:owner on phone", "--json", "--", "shut-1"]]);
  const flagLike = await findingApi(reopenRequest({ ...REOPEN, key: "--odd" }), OWNER, stub);
  assert.equal(flagLike.status, 200);
  assert.deepEqual(stub.calls[1]?.slice(-2), ["--", "--odd"], "a key that looks like a flag stays a key");
  assert.ok(!(stub.calls[1] ?? []).includes("--note"), "no note, no flag");
});

test("reopen: when the CLI refuses, the answer is 409 with its reason", async () => {
  const stub = reopenDeps({ code: 1, error: "finding 'shut-1' of ritual 'check' is not closed (status: open)" });
  const answer = await findingApi(reopenRequest(REOPEN), OWNER, stub);
  assert.equal(answer.status, 409);
  assert.match(errorOf(answer.body), /is not closed/u);
});

test("reopen: with the real CLI the finding opens again, and its history lists the close and the reopen with who and note", async () => {
  const real: FindingDeps = { ...reopenDeps(), run: runCli };
  const answer = await findingApi(reopenRequest({ ...REOPEN, key: "--odd", note: "was wrong" }), { who: "altan" }, real);
  assert.equal(answer.status, 200, errorOf(answer.body));
  const found = seed.find("check", "--odd");
  assert.equal(found.status, "open");
  assert.deepEqual(
    found.history.map((step) => [step.kind, step.who, step.note]),
    [
      ["report", undefined, undefined],
      ["closed", "op", undefined],
      ["reopened", "web:altan", "was wrong"],
    ],
  );
  const again = await findingApi(reopenRequest({ ...REOPEN, key: "--odd" }), OWNER, real);
  assert.equal(again.status, 409, "a second press finds it open");
});
