/**
 * `src/web/action-api.ts`: the run page's follow-up button (0.48.0) and the
 * Acknowledge button (0.68.0). The guards of `POST /api/run/follow-up`, the
 * body it accepts, and what it starts. Readiness and the spawn are stubs
 * here; the real readiness is covered in test/runner.test.ts, next to the CLI
 * it mirrors. `POST /api/run/ack` runs the CLI and waits: most tests stub the
 * runner, and one runs the real CLI against the sandbox store.
 *
 * SAFETY: the state and config dirs are `mkdtemp` dirs; no process starts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendLine, readLedger } from "../src/core/ledger.ts";
import type { JsonValue } from "../src/core/model.ts";
import { openProject } from "../src/core/store.ts";
import { NOW_STARTED_PREFIX } from "../src/cli/run-due.ts";
import { actionApi, findingApi, NOW_STARTED_LINE, followUpArgv, LOOPBACK_ACK, LOOPBACK_CLOSE, runCli, startDetachedFollowUp, waitForOutcome, type ActionDeps, type ActionRequest, type CliAnswer, type FindingDeps, LOOPBACK_FOLLOW_UP } from "../src/web/action-api.ts";
import { collectFindings } from "../src/core/finding-index.ts";
import { Seeder } from "./helpers/finding-seed.ts";
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
  surface: "herdr",
  questions: [
    { n: 1, commands: ["pnpm -C tools cli fc --post 12 --confirm"] },
    { n: 3, commands: ["git push origin main"] },
  ],
  items: [
    { key: "post-12/title", title: "Title misses the query" },
    { key: "it's $(odd) `key` \\", title: "A key with shell characters" },
  ],
};

const CHILD = "01JCHILD000000000000000000";

interface Started {
  argv: readonly string[];
  log: string;
}

/** What the stub CLI does once started: the lines it writes to the log, and its exit code (undefined: still running). */
interface Script {
  output: string;
  code?: number | null;
}

const STARTS: Script = { output: `darius run follow-up: started run ${CHILD} on host-a\n` };

/** Stubs that record what would start, with the readiness given; the started CLI follows `script`. */
function deps(readiness: FollowUpReadiness, script: Script = STARTS): ActionDeps & { started: Started[]; asked: string[] } {
  const started: Started[] = [];
  const asked: string[] = [];
  return {
    started,
    asked,
    waitMs: 300,
    readiness: (project, run) => {
      asked.push(`${project}/${run}`);
      return Promise.resolve(readiness);
    },
    start: (argv, log) => {
      started.push({ argv, log });
      appendFileSync(log, script.output);
      return { exited: script.code === undefined ? new Promise(() => undefined) : Promise.resolve(script.code) };
    },
    // The follow-up tests start no CLI that waits; a call here is a bug in the test.
    run: () => Promise.reject(new Error("the follow-up must not run the CLI and wait")),
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
    [{ ...VALID, approve: [] }, /approve question numbers or proposals, or give a note with the operator's decision/u],
    [{ ...VALID, approve: [], note: " \n " }, /approve question numbers or proposals, or give a note with the operator's decision/u],
    [{ ...VALID, items: [] }, /items must list 1 to 20 item keys/u],
    [{ ...VALID, items: "post-12/title" }, /items must list 1 to 20 item keys/u],
    [{ ...VALID, items: Array.from({ length: 21 }, (_, n) => `k${String(n)}`) }, /items must list 1 to 20 item keys/u],
    [{ ...VALID, items: [7] }, /each key is one line of plain text, at most 120 characters/u],
    [{ ...VALID, items: [" "] }, /each key is one line of plain text/u],
    [{ ...VALID, items: ["a\nb"] }, /each key is one line of plain text/u],
    [{ ...VALID, items: ["k".repeat(121)] }, /at most 120 characters/u],
    [{ ...VALID, items: ["post-12/title", "post-12/title"] }, /the key 'post-12\/title' is given twice/u],
    [{ project: PROJECT, run: RUN }, /approve must list question numbers/u],
    [{ ...VALID, approve: "1" }, /approve must list question numbers/u],
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

test("ready: it starts run follow-up detached with the approved numbers, the note and the viewer, and answers with the new run", async () => {
  const stub = deps(READY);
  const answer = await actionApi(post({ ...VALID, approve: [3, 1, 3], note: "  push it\nnow " }), { who: "owner on phone" }, stub);
  assert.equal(answer.status, 202);
  assert.deepEqual(answer.body, { ok: true, run: CHILD, host: "host-a" });
  assert.equal(stub.started.length, 1);
  const [started] = stub.started;
  assert.deepEqual(started?.argv, ["run", "follow-up", RUN, "--project", PROJECT, "--approve", "3", "--approve", "1", "--note", "push it now", "--who", "web:owner on phone"]);
  const runDir = join(openProject(PROJECT).root, "runs", RUN);
  assert.equal(started?.log, join(runDir, "follow-up.log"));
  assert.ok(existsSync(runDir), "the parent's run dir exists for the log");
  assert.ok(!(started?.argv ?? []).includes("--grant"), "never a grant line");
  assert.ok(!(started?.argv ?? []).includes("--headless"), "attended: the CLI opens a herdr tab");
});

test("decision follow-up: approve [] with a note starts the CLI with --note and no --approve (0.65.0)", async () => {
  const stub = deps({ ready: true, host: "host-a", profile: "opus-skip", surface: "herdr", questions: [], items: [] });
  const answer = await actionApi(post({ ...VALID, approve: [], note: "  fix the five\nposts " }), { who: "owner" }, stub);
  assert.equal(answer.status, 202);
  assert.deepEqual(stub.started[0]?.argv, ["run", "follow-up", RUN, "--project", PROJECT, "--note", "fix the five posts", "--who", "web:owner"]);
  assert.ok(!(stub.started[0]?.argv ?? []).includes("--approve"), "no --approve");
  const noNote = await actionApi(post({ ...VALID, approve: [] }), { who: "owner" }, deps(READY));
  assert.equal(noNote.status, 400, "neither numbers nor a note is refused");
  const grant = await actionApi(post({ ...VALID, approve: [], note: "x", grant: ["date"] }), { who: "owner" }, stub);
  assert.equal(grant.status, 400, "the key allowlist stands");
});

// --- approve proposals by key, forward, wait for the outcome (0.69.0) -------------------------

test("items: approved keys go to the CLI as --item words, after the numbers, never through a shell", async () => {
  const stub = deps(READY);
  const odd = "it's $(odd) `key` \\";
  const answer = await actionApi(post({ ...VALID, approve: [], items: ["post-12/title", odd] }), { who: "owner" }, stub);
  assert.equal(answer.status, 202, JSON.stringify(answer.body));
  assert.deepEqual(stub.started[0]?.argv, ["run", "follow-up", RUN, "--project", PROJECT, "--item", "post-12/title", "--item", odd, "--who", "web:owner"]);
  const both = deps(READY);
  await actionApi(post({ ...VALID, approve: [1], items: ["post-12/title"], note: "go" }), { who: "owner" }, both);
  assert.deepEqual(both.started[0]?.argv, ["run", "follow-up", RUN, "--project", PROJECT, "--approve", "1", "--item", "post-12/title", "--note", "go", "--who", "web:owner"]);
});

test("items: a key that is not an approvable item of the parent is 400 with a sentence, and nothing starts", async () => {
  const stub = deps(READY);
  const answer = await actionApi(post({ ...VALID, approve: [], items: ["post-99/title"] }), { who: "owner" }, stub);
  assert.equal(answer.status, 400);
  assert.equal(errorOf(answer.body), `run ${RUN} has no needs-decision item with the key 'post-99/title' to approve`);
  assert.deepEqual(stub.started, []);
});

test("forwarded: when readiness ran on the ritual's host, the CLI gets --on <host> last", async () => {
  const stub = deps({ ...READY, host: "minibuch", via: "host-a" }, { output: `darius run follow-up: started run ${CHILD} on minibuch\n` });
  const note = `it's "done"; $(rm -rf ~) \`id\` \\`;
  const answer = await actionApi(post({ ...VALID, items: ["post-12/title"], note }), { who: "owner" }, stub);
  assert.deepEqual(answer, { status: 202, body: { ok: true, run: CHILD, host: "minibuch" } });
  assert.deepEqual(stub.started[0]?.argv, ["run", "follow-up", RUN, "--project", PROJECT, "--approve", "1", "--item", "post-12/title", "--note", note, "--who", "web:owner", "--on", "minibuch"]);
  assert.deepEqual(followUpArgv({ project: "p", run: "r", approve: [], items: [], note: "n" }, { who: "w" }, undefined), ["run", "follow-up", "r", "--project", "p", "--note", "n", "--who", "web:w"], "no --on for this host");
});

test("outcome: a refusal or a skip is 409 with the CLI's sentence; an ssh failure is 503; nothing comes in time is 202 pending with a message", async () => {
  const cases: [Script, number, RegExp][] = [
    [{ output: "! follow-up 01X of run 'R' is still open; finish it first\n", code: 1 }, 409, /^follow-up 01X of run 'R' is still open; finish it first$/u],
    [{ output: "heartbeat: skipped\ndarius run follow-up: lease-held: host-b holds the lease\n", code: 1 }, 409, /^lease-held: host-b holds the lease$/u],
    [{ output: "darius: run follow-up: item 'k' of run 'R' is fixed; only a needs-decision item can be approved\n", code: 2 }, 409, /^run follow-up: item 'k' of run 'R' is fixed/u],
    [{ output: "ssh: connect to host minibuch port 22: No route to host\n", code: 255 }, 503, /^host-a did not answer: ssh: connect to host minibuch port 22: No route to host$/u],
    [{ output: "", code: 0 }, 409, /ended without starting a run/u],
  ];
  for (const [script, status, reason] of cases) {
    const answer = await actionApi(post(VALID), { who: "owner" }, deps(READY, script));
    assert.equal(answer.status, status, script.output);
    assert.match(errorOf(answer.body), reason, script.output);
  }
  const slow = await actionApi(post(VALID), { who: "owner" }, deps(READY, { output: "" }));
  assert.equal(slow.status, 202);
  assert.ok(isRecord(slow.body) && slow.body.pending === true && isText(slow.body.message) && /did not start within 10 s/u.test(slow.body.message), JSON.stringify(slow.body));
});

test("outcome: the wait reads only what this start wrote, and a started line before the exit wins", async () => {
  const dir = mkdtempSync(join(sandbox, "outcome-"));
  const log = join(dir, "follow-up.log");
  writeFileSync(log, `darius run follow-up: started run ${"01JOLDRUN0000000000000000A"} on host-a\n`);
  const offset = Buffer.byteLength(`darius run follow-up: started run ${"01JOLDRUN0000000000000000A"} on host-a\n`);
  appendFileSync(log, "! run 'R' ended failed; a follow-up needs a complete run\n");
  assert.deepEqual(await waitForOutcome({ exited: Promise.resolve(1) }, { log, offset, waitMs: 500 }), { ended: 1, sentence: "run 'R' ended failed; a follow-up needs a complete run" });
  appendFileSync(log, `darius run follow-up: started run ${CHILD} on host-a\n`);
  assert.deepEqual(await waitForOutcome({ exited: Promise.resolve(0) }, { log, offset, waitMs: 500 }), { started: CHILD, host: "host-a" });
});

test("the real starter: the CLI runs detached with argv as given, and its exit code comes back", async () => {
  const dir = mkdtempSync(join(sandbox, "starter-"));
  const log = join(dir, "follow-up.log");
  const started = startDetachedFollowUp(["run", "follow-up", "01JNORUN00000000000000000A", "--project", "nope-project", "--note", "it's $(id)"], log);
  const code = await started.exited;
  assert.notEqual(code, 0);
  const outcome = await waitForOutcome({ exited: Promise.resolve(code) }, { log, offset: 0, waitMs: 500 });
  assert.ok("ended" in outcome && outcome.sentence !== "", JSON.stringify(outcome));
});

// --- close a finding (0.62.0) --------------------------------------------------------------

const FINDING_PROJECT = "closing";
const seed = new Seeder(FINDING_PROJECT);
seed.run("check", [
  { key: "link-12", title: "Broken link", severity: "high", state: "needs-code" },
  { key: "banner-3", title: "Old banner", severity: "medium" },
  { key: "done-1", title: "Done thing", severity: "low", state: "fixed" },
  { key: "shut-1", title: "Shut thing", severity: "low" },
  { key: "--odd", title: "A key that looks like a flag", severity: "low" },
]);
seed.close("check", "shut-1");

/** The real findings of the seeded project, and a CLI that records its argv. */
function closeDeps(answer: CliAnswer = { code: 0, error: "" }): FindingDeps & { calls: string[][] } {
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

function closeRequest(body: JsonValue, overrides: Partial<ActionRequest> = {}): ActionRequest {
  return post(body, { path: "/api/finding/close", ...overrides });
}

const CLOSE = { project: FINDING_PROJECT, ritual: "check", key: "link-12" };

test("close: path 404, method 405, no or foreign Origin 403, other content 415, a large body 413, bad JSON 400, the loopback viewer 403", async () => {
  const stub = closeDeps();
  assert.equal((await findingApi(closeRequest(CLOSE, { path: "/api/finding/open" }), { who: "owner" }, stub)).status, 404);
  assert.equal((await findingApi(closeRequest(CLOSE, { method: "GET" }), { who: "owner" }, stub)).status, 405);
  const noOrigin = closeRequest(CLOSE, { headers: new Headers({ host: "127.0.0.1:4747", "content-type": "application/json" }) });
  assert.equal((await findingApi(noOrigin, { who: "owner" }, stub)).status, 403);
  const foreign = closeRequest(CLOSE, { headers: new Headers({ origin: "http://evil.example", host: "127.0.0.1:4747", "content-type": "application/json" }) });
  const refused = await findingApi(foreign, { who: "owner" }, stub);
  assert.equal(refused.status, 403);
  assert.match(errorOf(refused.body), /must come from the darius page/u);
  const text = closeRequest(CLOSE, { headers: new Headers({ origin: "http://127.0.0.1:4747", host: "127.0.0.1:4747", "content-type": "text/plain" }) });
  assert.equal((await findingApi(text, { who: "owner" }, stub)).status, 415);
  assert.equal((await findingApi(closeRequest({ ...CLOSE, note: "x".repeat(5000) }), { who: "owner" }, stub)).status, 413);
  assert.equal((await findingApi(postRaw("{not json", { path: "/api/finding/close" }), { who: "owner" }, stub)).status, 400);
  const local = await findingApi(closeRequest(CLOSE), { who: "this host", local: true }, stub);
  assert.equal(local.status, 403);
  assert.equal(errorOf(local.body), LOOPBACK_CLOSE);
  assert.deepEqual(stub.calls, [], "nothing ran");
});

test("close: a body that is not project, ritual, key and a note is 400", async () => {
  const stub = closeDeps();
  const cases: [JsonValue, RegExp][] = [
    [{ ...CLOSE, project: "../etc" }, /project must be a project name/u],
    [{ ...CLOSE, ritual: "a b" }, /ritual must be a ritual slug/u],
    [{ ...CLOSE, key: "" }, /key must be one line/u],
    [{ ...CLOSE, key: "a\nb" }, /key must be one line/u],
    [{ ...CLOSE, key: 5 }, /key must be one line/u],
    [{ ...CLOSE, note: 7 }, /note must be text/u],
    [{ ...CLOSE, note: "a\u0007b" }, /no control characters/u],
    [{ ...CLOSE, who: "admin" }, /unknown field who/u],
    [[1], /send \{ project, ritual, key, note\? \}/u],
  ];
  for (const [body, reason] of cases) {
    const answer = await findingApi(closeRequest(body), { who: "owner" }, stub);
    assert.equal(answer.status, 400, JSON.stringify(body));
    assert.match(errorOf(answer.body), reason, JSON.stringify(body));
  }
  assert.deepEqual(stub.calls, []);
});

test("close: an unknown project or finding is 400, a fixed or an already closed one is 409, and nothing runs", async () => {
  const stub = closeDeps();
  const unknownProject = await findingApi(closeRequest({ ...CLOSE, project: "nope" }), { who: "owner" }, stub);
  assert.equal(unknownProject.status, 400);
  assert.match(errorOf(unknownProject.body), /no project nope/u);
  const unknownKey = await findingApi(closeRequest({ ...CLOSE, key: "ghost" }), { who: "owner" }, stub);
  assert.equal(unknownKey.status, 400);
  assert.match(errorOf(unknownKey.body), /no finding 'ghost' in ritual 'check'/u);
  const otherRitual = await findingApi(closeRequest({ ...CLOSE, ritual: "other" }), { who: "owner" }, stub);
  assert.equal(otherRitual.status, 400, "a key is scoped to its ritual");
  const fixed = await findingApi(closeRequest({ ...CLOSE, key: "done-1" }), { who: "owner" }, stub);
  assert.equal(fixed.status, 409);
  assert.match(errorOf(fixed.body), /is fixed/u);
  const closed = await findingApi(closeRequest({ ...CLOSE, key: "shut-1" }), { who: "owner" }, stub);
  assert.equal(closed.status, 409);
  assert.match(errorOf(closed.body), /already closed by op/u);
  assert.deepEqual(stub.calls, []);
});

test("close: it runs finding close with the ritual, the project, the note and the viewer, and the key after --", async () => {
  const stub = closeDeps();
  const answer = await findingApi(closeRequest({ ...CLOSE, note: "  known\nissue " }), { who: "owner on phone" }, stub);
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.body, { ok: true });
  assert.deepEqual(stub.calls, [["finding", "close", "--ritual", "check", "--project", FINDING_PROJECT, "--note", "known issue", "--who", "web:owner on phone", "--json", "--", "link-12"]]);
  const flagLike = await findingApi(closeRequest({ ...CLOSE, key: "--odd" }), { who: "owner" }, stub);
  assert.equal(flagLike.status, 200);
  assert.deepEqual(stub.calls[1]?.slice(-2), ["--", "--odd"], "a key that looks like a flag stays a key");
  assert.ok(!(stub.calls[1] ?? []).includes("--note"), "no note, no flag");
});

test("close: when the CLI refuses, the answer is 409 with its reason", async () => {
  const stub = closeDeps({ code: 1, error: "finding 'link-12' of ritual 'check' is already closed by someone" });
  const answer = await findingApi(closeRequest(CLOSE), { who: "owner" }, stub);
  assert.equal(answer.status, 409);
  assert.match(errorOf(answer.body), /already closed by someone/u);
});

// --- acknowledge a run (0.68.0) ------------------------------------------------------------

const ACK = { project: PROJECT, run: RUN };

/** The follow-up stubs plus a CLI that records its argv; nothing starts. */
function ackDeps(answer: CliAnswer = { code: 0, error: "" }): ActionDeps & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    ...deps(READY),
    calls,
    run: (argv) => {
      calls.push([...argv]);
      return Promise.resolve(answer);
    },
  };
}

function ackRequest(body: JsonValue, overrides: Partial<ActionRequest> = {}): ActionRequest {
  return post(body, { path: "/api/run/ack", ...overrides });
}

test("ack: method 405, no or foreign Origin 403, other content 415, a large body 413, bad JSON 400, the loopback viewer 403; nothing runs", async () => {
  const stub = ackDeps();
  const who = { who: "owner" };
  assert.equal((await actionApi(ackRequest(ACK, { method: "GET" }), who, stub)).status, 405);
  const noOrigin = ackRequest(ACK, { headers: new Headers({ host: "127.0.0.1:4747", "content-type": "application/json" }) });
  const refused = await actionApi(noOrigin, who, stub);
  assert.equal(refused.status, 403);
  assert.match(errorOf(refused.body), /must come from the darius page/u);
  const foreign = ackRequest(ACK, { headers: new Headers({ origin: "http://evil.example", host: "127.0.0.1:4747", "content-type": "application/json" }) });
  assert.equal((await actionApi(foreign, who, stub)).status, 403);
  const text = ackRequest(ACK, { headers: new Headers({ origin: "http://127.0.0.1:4747", host: "127.0.0.1:4747", "content-type": "text/plain" }) });
  assert.equal((await actionApi(text, who, stub)).status, 415);
  assert.equal((await actionApi(ackRequest({ ...ACK, note: "x".repeat(5000) }), who, stub)).status, 413);
  assert.equal((await actionApi(postRaw("{not json", { path: "/api/run/ack" }), who, stub)).status, 400);
  const local = await actionApi(ackRequest(ACK), { who: "this host", local: true }, stub);
  assert.equal(local.status, 403);
  assert.equal(errorOf(local.body), LOOPBACK_ACK);
  assert.match(LOOPBACK_ACK, /tailnet identity/u);
  assert.deepEqual(stub.calls, [], "no guard that failed ran the CLI");
});

test("ack: a body that is not project, run and a plain note is 400, and nothing runs", async () => {
  const stub = ackDeps();
  const cases: [JsonValue, RegExp][] = [
    ["ack", /send \{ project, run, note\?, answers\?, runNow\? \}/u],
    [[ACK], /send \{ project, run, note\?, answers\?, runNow\? \}/u],
    [{ ...ACK, approve: [1] }, /unknown field approve/u],
    [{ ...ACK, grant: ["date"] }, /unknown field grant/u],
    [{ project: PROJECT }, /run must be a run id/u],
    [{ run: RUN }, /project must be a project name/u],
    [{ ...ACK, project: "../etc" }, /project must be a project name/u],
    [{ ...ACK, run: "../../x" }, /run must be a run id/u],
    [{ ...ACK, run: "--note" }, /run must be a run id/u],
    [{ ...ACK, run: 7 }, /run must be a run id/u],
    [{ ...ACK, note: 7 }, /note must be text/u],
    [{ ...ACK, note: "x".repeat(501) }, /note: at most 500 characters/u],
    [{ ...ACK, note: "bell\u0007here" }, /note: plain text only, no control characters/u],
  ];
  for (const [body, message] of cases) {
    const answer = await actionApi(ackRequest(body), { who: "owner" }, stub);
    assert.equal(answer.status, 400, JSON.stringify(body));
    assert.match(errorOf(answer.body), message);
  }
  assert.deepEqual(stub.calls, [], "no bad body reached the CLI");
  const edge = await actionApi(ackRequest({ ...ACK, note: "x".repeat(500) }), { who: "owner" }, stub);
  assert.equal(edge.status, 200, "500 characters fit");
});

test("ack: an unknown project or run is 400, and nothing runs", async () => {
  const stub = ackDeps();
  const project = await actionApi(ackRequest({ ...ACK, project: "nope" }), { who: "owner" }, stub);
  assert.equal(project.status, 400);
  assert.match(errorOf(project.body), /no project nope/u);
  const run = await actionApi(ackRequest({ ...ACK, run: "01JNOSUCHRUN0000000000000A" }), { who: "owner" }, stub);
  assert.equal(run.status, 400);
  assert.match(errorOf(run.body), /no run 01JNOSUCHRUN0000000000000A in demo/u);
  assert.deepEqual(stub.calls, []);
});

test("ack: it runs run ack with the project, the viewer, the note and the run after --, and answers 200", async () => {
  const stub = ackDeps();
  const bare = await actionApi(ackRequest(ACK), { who: "owner on phone" }, stub);
  assert.equal(bare.status, 200);
  assert.deepEqual(bare.body, { ok: true });
  assert.deepEqual(stub.calls[0], ["run", "ack", "--project", PROJECT, "--who", "web:owner on phone", "--json", "--", RUN]);
  const noted = await actionApi(ackRequest({ ...ACK, note: "  seen\nit, skip " }), { who: "owner" }, stub);
  assert.equal(noted.status, 200);
  assert.deepEqual(stub.calls[1], ["run", "ack", "--project", PROJECT, "--who", "web:owner", "--json", "--note", "seen it, skip", "--", RUN]);
  const blank = await actionApi(ackRequest({ ...ACK, note: " \n " }), { who: "owner" }, stub);
  assert.equal(blank.status, 200);
  assert.ok(!(stub.calls[2] ?? []).includes("--note"), "a blank note is no note");
  assert.deepEqual([stub.started, stub.asked], [[], []], "an acknowledgement starts no follow-up");
});

test("ack: when the CLI refuses (held, already acknowledged, wrong outcome), the answer is 409 with its sentence", async () => {
  const refusals = [
    `run '${RUN}' is held: answer and resume it`,
    `run '${RUN}' is already acknowledged by owner at 2026-10-05T10:00:00.000Z`,
    `run '${RUN}' is closed (complete); only a failed or abandoned run, or a complete one with questions, can be acknowledged`,
  ];
  for (const error of refusals) {
    const stub = ackDeps({ code: 1, error });
    const answer = await actionApi(ackRequest(ACK), { who: "owner" }, stub);
    assert.equal(answer.status, 409);
    assert.deepEqual(answer.body, { ok: false, error });
  }
});

test("ack: against the real CLI, a failed run is acknowledged once, with the viewer and the note; a held and a complete run are refused", async () => {
  const project = openProject(PROJECT);
  const failed = "01JFAILED000000000000000AA";
  const held = "01JHELD00000000000000000AA";
  const complete = "01JCOMPLETE0000000000000AA";
  appendLine(project, { who: "timer", type: "run.started", item: "ritual/daily", run: failed });
  appendLine(project, { who: "timer", type: "run.completed", item: "ritual/daily", run: failed, outcome: "failed" });
  appendLine(project, { who: "timer", type: "run.started", item: "ritual/daily", run: held });
  appendLine(project, { who: "claude:1", type: "run.held", item: "ritual/daily", run: held, questions: ["may I push?"] });
  appendLine(project, { who: "timer", type: "run.started", item: "ritual/daily", run: complete });
  appendLine(project, { who: "timer", type: "run.completed", item: "ritual/daily", run: complete, outcome: "complete" });
  const real: ActionDeps = { ...deps(READY), run: runCli };
  const viewer = { who: "owner on phone" };

  const first = await actionApi(ackRequest({ project: PROJECT, run: failed, note: "known, skip" }), viewer, real);
  assert.deepEqual(first, { status: 200, body: { ok: true } });
  const line = readLedger(project).find((candidate) => candidate.type === "run.acknowledged" && candidate.run === failed);
  assert.equal(line?.who, "web:owner on phone");
  assert.equal(line?.note, "known, skip");

  const again = await actionApi(ackRequest({ project: PROJECT, run: failed }), viewer, real);
  assert.equal(again.status, 409);
  assert.match(errorOf(again.body), /already acknowledged by web:owner on phone/u);

  const refusedHeld = await actionApi(ackRequest({ project: PROJECT, run: held }), viewer, real);
  assert.equal(refusedHeld.status, 409);
  assert.match(errorOf(refusedHeld.body), /is held: answer and resume it/u);

  const refusedComplete = await actionApi(ackRequest({ project: PROJECT, run: complete }), viewer, real);
  assert.equal(refusedComplete.status, 409);
  assert.match(errorOf(refusedComplete.body), /closed \(complete\); only a failed or abandoned run/u);

  const acknowledged = readLedger(project).filter((candidate) => candidate.type === "run.acknowledged");
  assert.equal(acknowledged.length, 1, "only the first acknowledgement was written");
});

test("the web context lets a tailnet viewer write and refuses the loopback viewer (0.68.0)", () => {
  assert.equal(webContext("owner on phone").canWrite, true);
  assert.equal(webContext("this host", undefined, true).canWrite, false);
});

// --- answers, run now and earlier asks (0.80.0) --------------------------------------------

const ASKED = { status: "attention", questions: 2, open: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }, fixed: 0 };

/** Seeds a closed run of `item` that asked `questions` questions. */
function seedAsk(run: string, item = "ritual/daily", questions = 2): string {
  const project = openProject(PROJECT);
  appendLine(project, { who: "timer", type: "run.started", item, run });
  appendLine(project, { who: "timer", type: "run.completed", item, run, outcome: "complete", result: { ...ASKED, questions } });
  return run;
}

const ASK_OLD = seedAsk("01JASKOLD00000000000000AAA");
const ASK_MID = seedAsk("01JASKMID00000000000000AAA");
const ASK_NEW = seedAsk("01JASKNEW00000000000000AAA");
const OTHER_RITUAL = seedAsk("01JASKOTHER000000000000AAA", "ritual/weekly");
const VIGIL_ASK = seedAsk("01JASKVIGIL000000000000AAA", "vigil/check");

/** The follow-up stubs, a CLI that records its argv, and a started CLI that follows `script`. */
function nowDeps(script: Script = { output: `${NOW_STARTED_PREFIX}${CHILD} on host-a\n` }, answer: CliAnswer = { code: 0, error: "" }): ActionDeps & { calls: string[][]; started: Started[] } {
  const base = ackDeps(answer);
  const started: Started[] = [];
  return {
    ...base,
    started,
    start: (argv, log) => {
      started.push({ argv, log });
      appendFileSync(log, script.output);
      return { exited: script.code === undefined ? new Promise(() => undefined) : Promise.resolve(script.code) };
    },
  };
}

test("run now: the start line of the CLI is the one the server waits for", () => {
  assert.equal(NOW_STARTED_LINE.exec(`${NOW_STARTED_PREFIX}${CHILD} on host-a`)?.[1], CHILD);
  assert.equal(NOW_STARTED_LINE.exec("darius run follow-up: started run 01JCHILD000000000000000000 on host-a"), null);
});

test("ack answers: a bad answers list or runNow is 400 with a sentence, and nothing runs or starts", async () => {
  const stub = nowDeps();
  const answers = (list: JsonValue): JsonValue => ({ ...ACK_NEW_BODY, answers: list });
  const cases: [JsonValue, RegExp][] = [
    [answers("yes"), /answers must list at most 10 entries/u],
    [answers(Array.from({ length: 11 }, (_, n) => ({ n: (n % 10) + 1, text: "x" }))), /answers must list at most 10 entries/u],
    [answers(["yes"]), /each entry is \{ n, text \}/u],
    [answers([{ n: 0, text: "x" }]), /n must be a question number, 1 to 10/u],
    [answers([{ n: 11, text: "x" }]), /n must be a question number, 1 to 10/u],
    [answers([{ n: 1.5, text: "x" }]), /n must be a question number/u],
    [answers([{ n: "1", text: "x" }]), /n must be a question number/u],
    [answers([{ text: "x" }]), /n must be a question number/u],
    [answers([{ n: 1, text: 7 }]), /text of question 1 must be text/u],
    [answers([{ n: 1, text: "  \n " }]), /text of question 1 is empty/u],
    [answers([{ n: 1, text: "a\u0007b" }]), /text of question 1 must be one line with no control characters/u],
    [answers([{ n: 1, text: "x".repeat(501) }]), /text of question 1 is 501 characters; at most 500 fit/u],
    [answers([{ n: 1, text: "a" }, { n: 1, text: "b" }]), /question 1 is answered twice/u],
    [answers([{ n: 1, text: "a", host: "x" }]), /unknown field host/u],
    [{ ...ACK_NEW_BODY, runNow: "yes" }, /runNow must be true or false/u],
    [{ ...ACK_NEW_BODY, runNow: true, host: "host-z" }, /unknown field host/u],
    [{ ...ACK_NEW_BODY, runNow: true, ritual: "daily" }, /unknown field ritual/u],
    [{ ...ACK_NEW_BODY, runNow: true, on: "host-z" }, /unknown field on/u],
  ];
  for (const [body, reason] of cases) {
    const answer = await actionApi(ackRequest(body), { who: "owner" }, stub);
    assert.equal(answer.status, 400, JSON.stringify(body));
    assert.match(errorOf(answer.body), reason, JSON.stringify(body));
  }
  const vigil = await actionApi(ackRequest({ project: PROJECT, run: VIGIL_ASK, runNow: true }), { who: "owner" }, stub);
  assert.equal(vigil.status, 400);
  assert.match(errorOf(vigil.body), /only a run of a ritual can start the ritual again/u);
  assert.deepEqual([stub.calls, stub.started], [[], []], "a refused body writes no ack and starts nothing");
});

const ACK_NEW_BODY = { project: PROJECT, run: ASK_NEW };

test("ack answers: they reach the CLI as --answer N=TEXT words, trimmed to one line, before the run after --; ten fit", async () => {
  const stub = nowDeps();
  const sent = await actionApi(ackRequest({ ...ACK_NEW_BODY, answers: [{ n: 2, text: " go\n ahead " }, { n: 1, text: "no=yes" }] }), { who: "owner on phone" }, stub);
  assert.deepEqual(sent, { status: 200, body: { ok: true } });
  assert.deepEqual(stub.calls[0], ["run", "ack", "--project", PROJECT, "--who", "web:owner on phone", "--json", "--answer", "2=go ahead", "--answer", "1=no=yes", "--", ASK_NEW]);
  assert.deepEqual(stub.started, [], "no runNow, no run");
  const ten = Array.from({ length: 10 }, (_, index) => ({ n: index + 1, text: "ok" }));
  assert.equal((await actionApi(ackRequest({ ...ACK_NEW_BODY, answers: ten }), { who: "owner" }, stub)).status, 200);
  assert.equal((await actionApi(ackRequest({ ...ACK_NEW_BODY, answers: [] }), { who: "owner" }, stub)).status, 200, "an empty list is a bare ack");
  assert.ok(!(stub.calls[2] ?? []).includes("--answer"));
  assert.equal((await actionApi(ackRequest({ ...ACK_NEW_BODY, answers: [{ n: 1, text: "x".repeat(500) }] }), { who: "owner" }, stub)).status, 200, "500 characters fit");
});

test("run now: after the ack the server starts run now for the ritual of the run, detached, and answers with the new run", async () => {
  const stub = nowDeps();
  const sent = await actionApi(ackRequest({ ...ACK_NEW_BODY, answers: [{ n: 1, text: "yes" }], runNow: true }), { who: "owner" }, stub);
  assert.deepEqual(sent, { status: 200, body: { ok: true, run: CHILD, host: "host-a" } });
  assert.equal(stub.calls.length, 1, "the ack ran first");
  assert.equal(stub.started.length, 1);
  assert.deepEqual(stub.started[0]?.argv, ["run", "now", "daily", "--project", PROJECT, "--who", "web:owner"], "the slug comes from the run's item; this host is right, so no --on");
  assert.ok(stub.started[0]?.log.endsWith(join("runs", ASK_NEW, "run-now.log")));
  assert.deepEqual([stub.asked], [[]], "no follow-up readiness is asked");
});

test("run now: when the ritual belongs to another host, the argv ends with --on <host>, taken from the server, never from the body", async () => {
  const asked: string[] = [];
  const stub = { ...nowDeps(), nowHost: (project: string, slug: string) => (asked.push(`${project}/${slug}`), "host-b") };
  const sent = await actionApi(ackRequest({ ...ACK_NEW_BODY, runNow: true }), { who: "owner" }, stub);
  assert.equal(sent.status, 200);
  assert.deepEqual(stub.started[0]?.argv, ["run", "now", "daily", "--project", PROJECT, "--who", "web:owner", "--on", "host-b"]);
  assert.deepEqual(asked, [`${PROJECT}/daily`]);
});

test("run now: the default host rule reads the ritual; a ritual the store does not have gives no --on", async () => {
  const stub = nowDeps();
  await actionApi(ackRequest({ project: PROJECT, run: OTHER_RITUAL, runNow: true }), { who: "owner" }, stub);
  assert.deepEqual(stub.started[0]?.argv, ["run", "now", "weekly", "--project", PROJECT, "--who", "web:owner"]);
});

test("run now: no ack, no run. A refused ack (also the second click on an acknowledged run) starts nothing", async () => {
  const refused = nowDeps(undefined, { code: 1, error: `run '${ASK_NEW}' is already acknowledged by owner at 2026-10-09T08:00:00.000Z` });
  const answer = await actionApi(ackRequest({ ...ACK_NEW_BODY, runNow: true, answers: [{ n: 1, text: "yes" }] }), { who: "owner" }, refused);
  assert.equal(answer.status, 409);
  assert.match(errorOf(answer.body), /already acknowledged/u);
  assert.deepEqual(refused.started, []);

  // The real CLI: the first click acks and starts, the second is refused and starts nothing more.
  const asked = seedAsk("01JASKDOUBLE0000000000AAAA");
  const stub: ActionDeps & { started: Started[] } = { ...nowDeps(), run: runCli };
  const first = await actionApi(ackRequest({ project: PROJECT, run: asked, runNow: true, answers: [{ n: 1, text: "yes" }, { n: 2, text: "later" }] }), { who: "owner on phone" }, stub);
  assert.deepEqual(first, { status: 200, body: { ok: true, run: CHILD, host: "host-a" } });
  const line = readLedger(openProject(PROJECT)).find((candidate) => candidate.type === "run.acknowledged" && candidate.run === asked);
  assert.deepEqual(line?.answers, [{ n: 1, text: "yes" }, { n: 2, text: "later" }]);
  assert.equal(line?.who, "web:owner on phone");
  const second = await actionApi(ackRequest({ project: PROJECT, run: asked, runNow: true, answers: [{ n: 1, text: "yes" }] }), { who: "owner on phone" }, stub);
  assert.equal(second.status, 409);
  assert.match(errorOf(second.body), /already acknowledged by web:owner on phone/u);
  assert.equal(stub.started.length, 1, "one start for two clicks");
  const unfit = await actionApi(ackRequest({ project: PROJECT, run: ASK_MID, runNow: true, answers: [{ n: 3, text: "yes" }] }), { who: "owner" }, stub);
  assert.equal(unfit.status, 409, "an answer to a question the run did not ask is refused by the CLI");
  assert.match(errorOf(unfit.body), /there is no question 3/u);
  assert.equal(stub.started.length, 1);
});

test("run now: an exit without a start line is reported as runNow.error, and the ack stays written", async () => {
  const scripts: [Script, RegExp, string?][] = [
    [{ output: "", code: 0 }, /^no run started: darius ended with exit code 0 and no message$/u],
    [{ output: "! daily runs on host-b (pinned): ssh host-b darius run now daily\n", code: 1 }, /^daily runs on host-b \(pinned\)/u],
    [{ output: "darius run now: lease-held: another host runs it\n", code: 0 }, /^no run started: lease-held: another host runs it$/u],
    [{ output: "ssh: connect to host host-b port 22: no route\n", code: 255 }, /^the ritual's host did not answer: ssh: connect/u, "host-b"],
    [{ output: "", code: null }, /^the ritual's host did not answer/u, "host-b"],
    [{ output: "darius: something broke\n", code: 255 }, /^something broke$/u],
    [{ output: "", code: null }, /^darius ended with exit code null and no message$/u],
  ];
  for (const [script, reason, host] of scripts) {
    const stub: ActionDeps & { calls: string[][] } = { ...nowDeps(script), nowHost: () => host };
    const sent = await actionApi(ackRequest({ ...ACK_NEW_BODY, runNow: true, answers: [{ n: 1, text: "yes" }] }), { who: "owner" }, stub);
    assert.equal(sent.status, 200, "the ack worked, so the status is 200");
    assert.ok(isRecord(sent.body) && sent.body.ok === true);
    const failure = isRecord(sent.body) && isRecord(sent.body.runNow) ? sent.body.runNow.error : undefined;
    assert.match(String(failure), reason);
    assert.equal(stub.calls.length, 1, "the ack ran once and was not rolled back");
  }
});

test("run now: a start that throws is runNow.error; a CLI that neither starts nor ends in time is pending", async () => {
  const broken: ActionDeps = {
    ...nowDeps(),
    start: () => {
      throw new Error("disk full");
    },
  };
  const failed = await actionApi(ackRequest({ ...ACK_NEW_BODY, runNow: true }), { who: "owner" }, broken);
  assert.equal(failed.status, 200);
  assert.deepEqual(failed.body, { ok: true, runNow: { error: "the run could not be started: disk full" } });

  const slow = nowDeps({ output: "" });
  const pending = await actionApi(ackRequest({ ...ACK_NEW_BODY, runNow: true }), { who: "owner" }, slow);
  assert.equal(pending.status, 200);
  assert.ok(isRecord(pending.body) && pending.body.ok === true && pending.body.pending === true);
  assert.match(String(isRecord(pending.body) ? pending.body.message : ""), /Your answer is saved\. The run did not start within 10 s/u);
});

test("ack and ack-earlier: the loopback viewer 403, no or foreign Origin 403, other content 415, a large body 413; nothing runs", async () => {
  const stub = nowDeps();
  const earlier = (overrides: Partial<ActionRequest> = {}): ActionRequest => post({ project: PROJECT, run: ASK_NEW, runs: [ASK_OLD] }, { path: "/api/run/ack-earlier", ...overrides });
  const requests = [
    (overrides: Partial<ActionRequest>): ActionRequest => ackRequest({ ...ACK_NEW_BODY, runNow: true, answers: [{ n: 1, text: "yes" }] }, overrides),
    earlier,
  ];
  for (const make of requests) {
    const local = await actionApi(make({}), { who: "this host", local: true }, stub);
    assert.equal(local.status, 403);
    assert.equal(errorOf(local.body), LOOPBACK_ACK);
    const noOrigin = await actionApi(make({ headers: new Headers({ host: "127.0.0.1:4747", "content-type": "application/json" }) }), { who: "owner" }, stub);
    assert.equal(noOrigin.status, 403);
    assert.match(errorOf(noOrigin.body), /must come from the darius page/u);
    const foreign = await actionApi(make({ headers: new Headers({ origin: "http://evil.example", host: "127.0.0.1:4747", "content-type": "application/json" }) }), { who: "owner" }, stub);
    assert.equal(foreign.status, 403);
    const text = await actionApi(make({ headers: new Headers({ origin: "http://127.0.0.1:4747", host: "127.0.0.1:4747", "content-type": "text/plain" }) }), { who: "owner" }, stub);
    assert.equal(text.status, 415);
    assert.equal((await actionApi(make({ method: "GET" }), { who: "owner" }, stub)).status, 405);
    assert.equal((await actionApi(make({ body: "x".repeat(70_000) }), { who: "owner" }, stub)).status, 413);
    assert.equal((await actionApi(make({ body: "{no" }), { who: "owner" }, stub)).status, 400);
  }
  assert.deepEqual([stub.calls, stub.started], [[], []]);
});

test("ack-earlier: a body that is not project, run and 1 to 10 run ids is 400, and nothing runs", async () => {
  const stub = ackDeps();
  const send = (body: JsonValue) => actionApi(post(body, { path: "/api/run/ack-earlier" }), { who: "owner" }, stub);
  const base = { project: PROJECT, run: ASK_NEW };
  const cases: [JsonValue, RegExp][] = [
    ["x", /send \{ project, run, runs: \[ID\] \}/u],
    [{ ...base }, /runs must list 1 to 10 run ids/u],
    [{ ...base, runs: [] }, /runs must list 1 to 10 run ids/u],
    [{ ...base, runs: Array.from({ length: 11 }, (_, n) => `01JX${String(n).padStart(22, "0")}`) }, /runs must list 1 to 10 run ids/u],
    [{ ...base, runs: ["../x"] }, /each entry must be a run id/u],
    [{ ...base, runs: [7] }, /each entry must be a run id/u],
    [{ ...base, runs: [ASK_OLD, ASK_OLD] }, /is given twice/u],
    [{ ...base, runs: [ASK_OLD], note: "x" }, /unknown field note/u],
    [{ ...base, runs: [ASK_OLD], ritual: "weekly" }, /unknown field ritual/u],
    [{ ...base, project: "nope", runs: [ASK_OLD] }, /no project nope/u],
    [{ ...base, run: "01JNOSUCHRUN0000000000000A", runs: [ASK_OLD] }, /no run 01JNOSUCHRUN0000000000000A in demo/u],
  ];
  for (const [body, reason] of cases) {
    const answer = await send(body);
    assert.equal(answer.status, 400, JSON.stringify(body));
    assert.match(errorOf(answer.body), reason);
  }
  assert.deepEqual(stub.calls, []);
});

test("ack-earlier: an id that is not an earlier open ask of the same ritual refuses the whole call with 409, and nothing is dismissed", async () => {
  const project = openProject(PROJECT);
  const acked = seedAsk("01JASKACKED0000000000AAAAA");
  appendLine(project, { who: "owner", type: "run.acknowledged", item: "ritual/daily", run: acked });
  const silent = seedAsk("01JASKSILENT000000000AAAAA", "ritual/daily", 0);
  const failed = "01JASKFAILED00000000AAAAAA";
  appendLine(project, { who: "timer", type: "run.started", item: "ritual/daily", run: failed });
  appendLine(project, { who: "timer", type: "run.completed", item: "ritual/daily", run: failed, outcome: "failed" });
  const later = seedAsk("01JASKLATER0000000000AAAAA");
  const stub = ackDeps();
  const cases: [string, RegExp][] = [
    [OTHER_RITUAL, /is not a run of the same ritual/u],
    [VIGIL_ASK, /is not a run of the same ritual/u],
    [ASK_NEW, /did not start before run/u],
    [later, /did not start before run/u],
    [acked, /is already acknowledged by owner/u],
    [silent, /is not a completed run with questions/u],
    [failed, /is not a completed run with questions/u],
    ["01JNOSUCHRUN0000000000000A", /no run 01JNOSUCHRUN0000000000000A/u],
  ];
  for (const [id, reason] of cases) {
    const answer = await actionApi(post({ project: PROJECT, run: id === ASK_NEW || id === later ? ASK_MID : later, runs: [ASK_OLD, id] }, { path: "/api/run/ack-earlier" }), { who: "owner" }, stub);
    assert.equal(answer.status, 409, id);
    assert.match(errorOf(answer.body), /^nothing dismissed: /u);
    assert.match(errorOf(answer.body), reason, id);
  }
  assert.deepEqual(stub.calls, [], "one bad id stops the call before any ack");
});

test("ack-earlier: it acks each id bare, once, as the viewer, and counts them; a CLI refusal in the middle is 409 with the count", async () => {
  const stub = ackDeps();
  const sent = await actionApi(post({ project: PROJECT, run: ASK_NEW, runs: [ASK_MID, ASK_OLD] }, { path: "/api/run/ack-earlier" }), { who: "owner on phone" }, stub);
  assert.deepEqual(sent, { status: 200, body: { ok: true, count: 2 } });
  assert.deepEqual(stub.calls, [
    ["run", "ack", "--project", PROJECT, "--who", "web:owner on phone", "--json", "--", ASK_MID],
    ["run", "ack", "--project", PROJECT, "--who", "web:owner on phone", "--json", "--", ASK_OLD],
  ]);
  let n = 0;
  const flaky: ActionDeps = { ...ackDeps(), run: () => Promise.resolve(++n === 1 ? { code: 1, error: "run is already acknowledged by owner" } : { code: 0, error: "" }) };
  const partial = await actionApi(post({ project: PROJECT, run: ASK_NEW, runs: [ASK_MID, ASK_OLD] }, { path: "/api/run/ack-earlier" }), { who: "owner" }, flaky);
  assert.equal(partial.status, 409);
  assert.equal(errorOf(partial.body), "1 of 2 dismissed; run is already acknowledged by owner");
});

test("ack-earlier: against the real CLI the asks are acknowledged bare, and a second call refuses (they are no longer open)", async () => {
  const one = seedAsk("01JASKREAL1000000000AAAAAA");
  const two = seedAsk("01JASKREAL2000000000AAAAAA");
  const head = seedAsk("01JASKREAL3000000000AAAAAA");
  const real: ActionDeps = { ...ackDeps(), run: runCli };
  const body = { project: PROJECT, run: head, runs: [one, two] };
  const sent = await actionApi(post(body, { path: "/api/run/ack-earlier" }), { who: "owner" }, real);
  assert.deepEqual(sent, { status: 200, body: { ok: true, count: 2 } });
  const lines = readLedger(openProject(PROJECT)).filter((line) => line.type === "run.acknowledged" && (line.run === one || line.run === two));
  assert.equal(lines.length, 2);
  assert.ok(lines.every((line) => line.who === "web:owner" && line.answers === undefined));
  const again = await actionApi(post(body, { path: "/api/run/ack-earlier" }), { who: "owner" }, real);
  assert.equal(again.status, 409);
  assert.match(errorOf(again.body), /nothing dismissed: run .* is already acknowledged by web:owner/u);
});

test("run now: anything that throws after the ack (the host lookup, the store) is a runNow.error, never a 500", async () => {
  const stub = { ...nowDeps(), nowHost: () => { throw new Error("links.toml is unreadable"); } };
  const sent = await actionApi(ackRequest({ ...ACK_NEW_BODY, runNow: true }), { who: "owner" }, stub);
  assert.deepEqual(sent, { status: 200, body: { ok: true, runNow: { error: "the run could not be started: links.toml is unreadable" } } });
  assert.equal(stub.calls.length, 1, "the ack ran and stays");
  assert.deepEqual(stub.started, []);
});

test("run now: a host name that is not a plain host name is refused with a sentence, and nothing starts", async () => {
  for (const host of ["-oProxyCommand=x", "host b", "host;rm", "", ".x"]) {
    const stub = { ...nowDeps(), nowHost: () => host };
    const sent = await actionApi(ackRequest({ ...ACK_NEW_BODY, runNow: true }), { who: "owner" }, stub);
    assert.deepEqual(sent, { status: 200, body: { ok: true, runNow: { error: "the ritual's host name is not valid" } } }, JSON.stringify(host));
    assert.deepEqual(stub.started, []);
  }
  const fine = { ...nowDeps(), nowHost: () => "host-b.tail1234.ts.net" };
  await actionApi(ackRequest({ ...ACK_NEW_BODY, runNow: true }), { who: "owner" }, fine);
  assert.deepEqual(fine.started[0]?.argv.slice(-2), ["--on", "host-b.tail1234.ts.net"]);
});

test("run now: the default host rule sends a ritual pinned to another host there with --on, and none for this host", async () => {
  const store = openProject(PROJECT);
  const now = new Date().toISOString();
  const header = { id: "01JPINNED00000000000000000", kind: "ritual" as const, slug: "pinned", title: "Pinned", created: now, updated: now, tags: [], cadence: "1d", anchor: "due" as const, host: "host-b", policy: { mode: "report" as const, may: [], hold: [] } };
  store.writeItem({ header, body: "Do it.\n" }, { who: "test" });
  const pinned = seedAsk("01JASKPINNED0000000000AAAA", "ritual/pinned");
  const stub = nowDeps();
  const sent = await actionApi(ackRequest({ project: PROJECT, run: pinned, runNow: true }), { who: "owner" }, stub);
  assert.equal(sent.status, 200);
  assert.deepEqual(stub.started[0]?.argv, ["run", "now", "pinned", "--project", PROJECT, "--who", "web:owner", "--on", "host-b"], "the server read the pin from the store; this host is host-a");
  store.writeItem({ header: { ...header, host: "host-a", updated: new Date().toISOString() }, body: "Do it.\n" }, { who: "test" });
  const here = seedAsk("01JASKPINNED2000000000AAAA", "ritual/pinned");
  const local = nowDeps();
  await actionApi(ackRequest({ project: PROJECT, run: here, runNow: true }), { who: "owner" }, local);
  assert.deepEqual(local.started[0]?.argv, ["run", "now", "pinned", "--project", PROJECT, "--who", "web:owner"], "a ritual pinned to this host needs no --on");
});

test("ack-earlier: earlier means an earlier start time, like the page; the ledger order breaks a tie", async () => {
  const project = openProject(PROJECT);
  const item = "ritual/ordered";
  const line = (run: string, at: string): void => {
    appendLine(project, { who: "timer", type: "run.started", item, run, at });
    appendLine(project, { who: "timer", type: "run.completed", item, run, outcome: "complete", result: ASKED });
  };
  // Appended newest first: the ledger order is the reverse of the start times.
  line("01JORDERNEW00000000000AAAA", "2026-10-02T08:00:00.000Z");
  line("01JORDEROLD00000000000AAAA", "2026-10-01T08:00:00.000Z");
  line("01JORDERTIE00000000000AAAA", "2026-10-02T08:00:00.000Z");
  const stub = ackDeps();
  const send = (run: string, id: string) => actionApi(post({ project: PROJECT, run, runs: [id] }, { path: "/api/run/ack-earlier" }), { who: "owner" }, stub);
  assert.equal((await send("01JORDERNEW00000000000AAAA", "01JORDEROLD00000000000AAAA")).status, 200, "older by time, though later in the ledger");
  assert.equal((await send("01JORDEROLD00000000000AAAA", "01JORDERNEW00000000000AAAA")).status, 409, "newer by time, though earlier in the ledger");
  assert.equal((await send("01JORDERTIE00000000000AAAA", "01JORDERNEW00000000000AAAA")).status, 200, "same time: the earlier ledger line is earlier");
  assert.equal((await send("01JORDERNEW00000000000AAAA", "01JORDERTIE00000000000AAAA")).status, 409);
});
