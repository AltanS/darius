/**
 * The candle endpoints (src/web/action-api.ts, candleApi; 0.111.0): every guard
 * and their order, the argv and the stdin of the CLI call, the reads, the
 * follow-up on this host and on the ritual's host, and the routing of
 * `darius serve`. The CLI is a stub for the guards; the tests that say "real
 * CLI" run bin/darius against the sandbox store.
 *
 * SAFETY: the state and config dirs are `mkdtemp` dirs, ssh is a fake that runs
 * nothing, and tailscale points at a missing file. No test touches the network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const sandbox = mkdtempSync(join(tmpdir(), "darius-candle-api-test-"));
process.env.DARIUS_CONFIG_DIR = join(sandbox, "config");
process.env.DARIUS_STATE_DIR = join(sandbox, "state");
process.env.DARIUS_TAILSCALE = join(sandbox, "no-tailscale");
process.env.DARIUS_HERDR = join(sandbox, "no-herdr");
process.env.DARIUS_SSH = join(sandbox, "no-ssh");
delete process.env.DARIUS_WEB_URL;
delete process.env.DARIUS_RUN;
delete process.env.DARIUS_RUN_POLICY;
mkdirSync(process.env.DARIUS_CONFIG_DIR, { recursive: true });
writeFileSync(join(process.env.DARIUS_CONFIG_DIR, "config.toml"), 'host = "host-a"\n');

const { parseArgs } = await import("../src/cli/args.ts");
const { serveCommand } = await import("../src/cli/serve.ts");
const { collectCandles, CANDLE_LIT } = await import("../src/core/candle-index.ts");
const { appendLine, readLedger } = await import("../src/core/ledger.ts");
const { getBlobText, openProject } = await import("../src/core/store.ts");
const { candleApi, isCandlePath, LOOPBACK_CANDLE_LIGHT, LOOPBACK_CANDLE_SETTLE, runCli, startDetachedFollowUp } = await import("../src/web/action-api.ts");
const { webContext } = await import("../src/web/context.ts");
const { collectStatus } = await import("../src/web/status.ts");
const { Seeder } = await import("./helpers/finding-seed.ts");

import type { JsonValue } from "../src/core/model.ts";
import type { ActionRequest, CandleDeps, FollowUpStarter } from "../src/web/action-api.ts";
import type { FollowUpReadiness } from "../src/web/api.ts";

const BIN = fileURLToPath(new URL("../bin/darius", import.meta.url));
const HOST = "127.0.0.1:4747";
const ORIGIN = `http://${HOST}`;
const TAILNET = { who: "owner on phone" };
const LOCAL = { who: "this host", local: true };
const STARTED = "01ABCDEFGHJKMNPQRSTVWXYZ01";

function isRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorOf(body: JsonValue): string {
  return isRecord(body) ? String(body.error ?? "") : "";
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isList(value: JsonValue | undefined): value is readonly JsonValue[] {
  return Array.isArray(value);
}

/** The rows of a list reply. */
function rowsOf(body: JsonValue): { readonly [key: string]: JsonValue }[] {
  const rows = isRecord(body) ? body.candles : undefined;
  assert.ok(isList(rows), "the reply has a list of candles");
  return rows.filter((row) => isRecord(row));
}

interface Stub extends CandleDeps {
  runs: { argv: string[]; input: string | undefined }[];
  starts: string[][];
}

function ready(items: string[], host = "host-a", via?: string): FollowUpReadiness {
  const base: FollowUpReadiness = { ready: true, host, profile: "built-in", surface: "headless", questions: [], items: items.map((key) => ({ key, title: "t" })) };
  return via === undefined ? base : { ...base, via };
}

/** A CLI, a readiness and a start that only record. The start appends `log` lines to the log and ends with `exit`, or keeps running. */
function stub(options: { code?: number; error?: string; readiness?: FollowUpReadiness; log?: string[]; exit?: number | "running" } = {}): Stub {
  const runs: Stub["runs"] = [];
  const starts: string[][] = [];
  const start: FollowUpStarter = (argv, log) => {
    starts.push([...argv]);
    appendFileSync(log, (options.log ?? []).map((line) => `${line}\n`).join(""));
    const exit = options.exit ?? 0;
    if (exit === "running") return { exited: new Promise<number | null>(() => undefined) };
    return { exited: Promise.resolve(exit) };
  };
  return {
    runs,
    starts,
    start,
    waitMs: 150,
    readiness: () => Promise.resolve(options.readiness ?? { ready: false, host: "host-a", reason: "readiness was not set up" }),
    run: (argv, input) => {
      runs.push({ argv: [...argv], input });
      return Promise.resolve({ code: options.code ?? 0, error: options.error ?? "" });
    },
  };
}

function post(path: string, body: JsonValue, overrides: Partial<ActionRequest> = {}): ActionRequest {
  return { method: "POST", path, headers: new Headers({ origin: ORIGIN, host: HOST, "content-type": "application/json" }), body: JSON.stringify(body), ...overrides };
}

/** A POST with exactly these headers, and the host. */
function withHeaders(path: string, body: JsonValue, headers: Record<string, string>): ActionRequest {
  return post(path, body, { headers: new Headers({ host: HOST, ...headers }) });
}

function get(path: string, query: string, headers: Record<string, string> = {}): ActionRequest {
  return { method: "GET", path, headers: new Headers({ host: HOST, ...headers }), body: "", query };
}

const JSON_TYPE = { "content-type": "application/json" };
const LIGHT_PATH = "/api/candle/light";
const ANSWER_PATH = "/api/candle/answer";
const ACCEPT_PATH = "/api/candle/accept";

const LIT = "lighting";
openProject(LIT, { create: true });
const LIGHT = { project: LIT, key: "dep/cve-1", title: "Vulnerable dependency", severity: "high" };

// --- light: each guard ----------------------------------------------------------------

test("light: a method that is not POST is 405", async () => {
  const deps = stub();
  assert.equal((await candleApi(post(LIGHT_PATH, LIGHT, { method: "GET" }), TAILNET, deps)).status, 405);
  assert.deepEqual(deps.runs, []);
});

test("light: the loopback viewer is refused, whatever the headers say", async () => {
  const deps = stub();
  const refused = await candleApi(withHeaders(LIGHT_PATH, LIGHT, JSON_TYPE), LOCAL, deps);
  assert.equal(refused.status, 403);
  assert.equal(errorOf(refused.body), LOOPBACK_CANDLE_LIGHT);
  assert.deepEqual(deps.runs, []);
});

test("light: Origin null is refused", async () => {
  const deps = stub();
  const refused = await candleApi(withHeaders(LIGHT_PATH, LIGHT, { ...JSON_TYPE, origin: "null" }), TAILNET, deps);
  assert.equal(refused.status, 403);
  assert.match(errorOf(refused.body), /Origin: null/u);
  assert.deepEqual(deps.runs, []);
});

test("light: an Origin that does not match is refused, and so is one that is not an origin", async () => {
  const deps = stub();
  for (const origin of ["http://evil.example", "http://127.0.0.1:9999", "https://evil.example", "NULL", "not a url", "file:///etc/passwd"]) {
    const refused = await candleApi(withHeaders(LIGHT_PATH, LIGHT, { ...JSON_TYPE, origin }), TAILNET, deps);
    assert.equal(refused.status, 403, origin);
    assert.match(errorOf(refused.body), /must come from the darius page/u, origin);
  }
  assert.deepEqual(deps.runs, []);
});

test("light: an Origin that matches the host or DARIUS_WEB_URL passes", async () => {
  const deps = stub();
  assert.equal((await candleApi(withHeaders(LIGHT_PATH, LIGHT, { ...JSON_TYPE, origin: ORIGIN }), TAILNET, deps)).status, 200);
  process.env.DARIUS_WEB_URL = "https://darius.example.com";
  try {
    assert.equal((await candleApi(withHeaders(LIGHT_PATH, LIGHT, { ...JSON_TYPE, origin: "https://darius.example.com" }), TAILNET, deps)).status, 200);
  } finally {
    delete process.env.DARIUS_WEB_URL;
  }
  assert.equal(deps.runs.length, 2);
});

test("light: no Origin passes, as a CI job on the tailnet sends none", async () => {
  const deps = stub();
  assert.equal((await candleApi(withHeaders(LIGHT_PATH, LIGHT, JSON_TYPE), TAILNET, deps)).status, 200);
  assert.equal(deps.runs.length, 1);
});

test("light: Sec-Fetch-Site cross-site and same-site are refused; same-origin and none pass", async () => {
  const deps = stub();
  for (const site of ["cross-site", "same-site"]) {
    const refused = await candleApi(withHeaders(LIGHT_PATH, LIGHT, { ...JSON_TYPE, "sec-fetch-site": site }), TAILNET, deps);
    assert.equal(refused.status, 403, site);
    assert.match(errorOf(refused.body), /another site/u);
  }
  assert.deepEqual(deps.runs, []);
  for (const site of ["same-origin", "none"]) assert.equal((await candleApi(withHeaders(LIGHT_PATH, LIGHT, { ...JSON_TYPE, "sec-fetch-site": site }), TAILNET, deps)).status, 200, site);
});

test("light: a JSON content type is required, which keeps out the forms a page sends without a preflight", async () => {
  const deps = stub();
  for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
    assert.equal((await candleApi(withHeaders(LIGHT_PATH, LIGHT, { "content-type": type }), TAILNET, deps)).status, 415, type);
  }
  assert.equal((await candleApi(withHeaders(LIGHT_PATH, LIGHT, {}), TAILNET, deps)).status, 415, "no content type");
  assert.deepEqual(deps.runs, []);
});

test("light: a body over MAX_BODY is 413, and one at MAX_BODY passes the size check", async () => {
  const deps = stub();
  const padded = (size: number): string => {
    const empty = JSON.stringify({ ...LIGHT, body: "" });
    return JSON.stringify({ ...LIGHT, body: "x".repeat(size - empty.length) });
  };
  assert.equal((await candleApi(post(LIGHT_PATH, null, { headers: new Headers({ host: HOST, ...JSON_TYPE }), body: padded(4097) }), TAILNET, deps)).status, 413);
  assert.deepEqual(deps.runs, []);
  assert.equal((await candleApi(post(LIGHT_PATH, null, { headers: new Headers({ host: HOST, ...JSON_TYPE }), body: padded(4096) }), TAILNET, deps)).status, 200);
});

test("light: bad JSON and a body that is no object are 400", async () => {
  const deps = stub();
  assert.equal((await candleApi(post(LIGHT_PATH, null, { body: "{not json" }), TAILNET, deps)).status, 400);
  assert.equal((await candleApi(post(LIGHT_PATH, [1, 2]), TAILNET, deps)).status, 400);
  assert.equal((await candleApi(post(LIGHT_PATH, "text"), TAILNET, deps)).status, 400);
  assert.deepEqual(deps.runs, []);
});

test("light: a body with an unknown key is refused", async () => {
  const deps = stub();
  for (const extra of ["who", "stdin", "follow-up", "on", "--note"]) {
    const refused = await candleApi(post(LIGHT_PATH, { ...LIGHT, [extra]: "x" }), TAILNET, deps);
    assert.equal(refused.status, 400, extra);
    assert.match(errorOf(refused.body), /unknown field/u, extra);
  }
  assert.deepEqual(deps.runs, []);
});

test("light: an unknown project is refused", async () => {
  const deps = stub();
  const refused = await candleApi(post(LIGHT_PATH, { ...LIGHT, project: "nobody-here" }), TAILNET, deps);
  assert.equal(refused.status, 400);
  assert.match(errorOf(refused.body), /no project nobody-here/u);
  assert.deepEqual(deps.runs, []);
});

// --- light: the order ------------------------------------------------------------------

test("light: the guards run in the order of the spec; each step repairs one fault and the next guard answers", async () => {
  const deps = stub();
  const oversized = JSON.stringify({ ...LIGHT, project: "nobody-here", bogus: "x".repeat(5000) });
  const bad = { project: "nobody-here", key: "k", title: "t", severity: "high", bogus: true };
  const steps: { name: string; viewer: { who: string; local?: boolean }; request: ActionRequest; status: number; error: RegExp }[] = [
    {
      name: "method first",
      viewer: LOCAL,
      request: { method: "PUT", path: LIGHT_PATH, headers: new Headers({ host: HOST, origin: "null", "sec-fetch-site": "cross-site", "content-type": "text/plain" }), body: oversized },
      status: 405,
      error: /POST only/u,
    },
    {
      name: "then the loopback viewer",
      viewer: LOCAL,
      request: { method: "POST", path: LIGHT_PATH, headers: new Headers({ host: HOST, origin: "null", "sec-fetch-site": "cross-site", "content-type": "text/plain" }), body: oversized },
      status: 403,
      error: /tailnet identity/u,
    },
    {
      name: "then Origin null",
      viewer: TAILNET,
      request: { method: "POST", path: LIGHT_PATH, headers: new Headers({ host: HOST, origin: "null", "sec-fetch-site": "cross-site", "content-type": "text/plain" }), body: oversized },
      status: 403,
      error: /Origin: null/u,
    },
    {
      name: "then an Origin that does not match",
      viewer: TAILNET,
      request: { method: "POST", path: LIGHT_PATH, headers: new Headers({ host: HOST, origin: "http://evil.example", "sec-fetch-site": "cross-site", "content-type": "text/plain" }), body: oversized },
      status: 403,
      error: /must come from the darius page/u,
    },
    {
      name: "then Sec-Fetch-Site",
      viewer: TAILNET,
      request: { method: "POST", path: LIGHT_PATH, headers: new Headers({ host: HOST, "sec-fetch-site": "cross-site", "content-type": "text/plain" }), body: oversized },
      status: 403,
      error: /another site/u,
    },
    { name: "then the content type", viewer: TAILNET, request: { method: "POST", path: LIGHT_PATH, headers: new Headers({ host: HOST, "content-type": "text/plain" }), body: oversized }, status: 415, error: /send JSON/u },
    { name: "then the size", viewer: TAILNET, request: { method: "POST", path: LIGHT_PATH, headers: new Headers({ host: HOST, ...JSON_TYPE }), body: oversized }, status: 413, error: /too large/u },
    { name: "then JSON", viewer: TAILNET, request: { method: "POST", path: LIGHT_PATH, headers: new Headers({ host: HOST, ...JSON_TYPE }), body: "{not json" }, status: 400, error: /not valid JSON/u },
    { name: "then the unknown key", viewer: TAILNET, request: withHeaders(LIGHT_PATH, bad, JSON_TYPE), status: 400, error: /unknown field bogus/u },
    { name: "then the known project", viewer: TAILNET, request: withHeaders(LIGHT_PATH, { project: "nobody-here", key: "k", title: "t", severity: "high" }, JSON_TYPE), status: 400, error: /no project nobody-here/u },
  ];
  for (const step of steps) {
    const answer = await candleApi(step.request, step.viewer, deps);
    assert.equal(answer.status, step.status, step.name);
    assert.match(errorOf(answer.body), step.error, step.name);
  }
  assert.deepEqual(deps.runs, [], "no step reached the CLI");
  assert.equal((await candleApi(withHeaders(LIGHT_PATH, LIGHT, JSON_TYPE), TAILNET, deps)).status, 200, "with no fault left it passes");
});

// --- light: the fields -----------------------------------------------------------------

test("light: each field is checked before the CLI runs", async () => {
  const deps = stub();
  const cases: [JsonValue, RegExp][] = [
    [{ ...LIGHT, project: "../etc" }, /project must be a project name/u],
    [{ ...LIGHT, project: "-x" }, /project must be a project name/u],
    [{ ...LIGHT, key: "" }, /key must be one line/u],
    [{ ...LIGHT, key: "   " }, /key must be one line/u],
    [{ ...LIGHT, key: "a\nb" }, /key must be one line/u],
    [{ ...LIGHT, key: "a\u0000b" }, /key must be one line/u],
    [{ ...LIGHT, key: "k".repeat(121) }, /key must be one line/u],
    [{ ...LIGHT, key: 7 }, /key must be one line/u],
    [{ ...LIGHT, key: "vigil:nightly" }, /belong to vigils/u],
    [{ ...LIGHT, title: undefined }, /title is required/u],
    [{ ...LIGHT, title: "   " }, /title is required/u],
    [{ ...LIGHT, title: "a\nb" }, /title: one line/u],
    [{ ...LIGHT, title: "t".repeat(201) }, /title: at most 200/u],
    [{ ...LIGHT, title: 7 }, /title must be text/u],
    [{ ...LIGHT, severity: "urgent" }, /severity must be one of/u],
    [{ ...LIGHT, severity: "--help" }, /severity must be one of/u],
    [{ ...LIGHT, target: "a\u0000b" }, /target: one line/u],
    [{ ...LIGHT, target: "t".repeat(201) }, /target: at most 200/u],
    [{ ...LIGHT, source: "s".repeat(201) }, /source: at most 200/u],
    [{ ...LIGHT, source: "vigil:nightly" }, /darius's own/u],
    [{ ...LIGHT, source: "  vigil:nightly" }, /darius's own/u],
    [{ ...LIGHT, source: "ritual:scan" }, /darius's own/u],
    [{ ...LIGHT, body: 7 }, /body must be text/u],
  ];
  for (const [body, expected] of cases) {
    const refused = await candleApi(post(LIGHT_PATH, body), TAILNET, deps);
    assert.equal(refused.status, 400, JSON.stringify(body));
    assert.match(errorOf(refused.body), expected, JSON.stringify(body));
  }
  assert.deepEqual(deps.runs, []);
});

test("light: deliver is push, email or none at the API, before the CLI", async () => {
  const deps = stub();
  for (const deliver of ["sms", "", "push,", ",push", "push, email", "none,push", "--help", "-h", "PUSH", ["push"], 7, true]) {
    const refused = await candleApi(post(LIGHT_PATH, { ...LIGHT, deliver }), TAILNET, deps);
    assert.equal(refused.status, 400, JSON.stringify(deliver));
    assert.match(errorOf(refused.body), /deliver must be/u);
  }
  assert.deepEqual(deps.runs, []);
  for (const deliver of ["push", "email", "none", "push,email", "email,push"]) {
    const answer = await candleApi(post(LIGHT_PATH, { ...LIGHT, deliver }), TAILNET, deps);
    assert.equal(answer.status, 200, deliver);
    assert.ok(deps.runs.at(-1)?.argv.includes(`--deliver=${deliver}`), deliver);
  }
});

test("light: the argv has -- before the key, free text as --flag=value, and no body", async () => {
  const deps = stub();
  const secret = "the body text";
  await candleApi(post(LIGHT_PATH, { ...LIGHT, key: "--help", target: "web/app", source: "ci:nightly", deliver: "email", body: secret }), TAILNET, deps);
  const sent = deps.runs[0];
  assert.ok(sent !== undefined);
  assert.deepEqual(sent.argv, [
    "candle", "light", `--project=${LIT}`, "--who=web:owner on phone", "--title=Vulnerable dependency", "--severity=high", "--source=ci:nightly", "--json",
    "--target=web/app", "--deliver=email", "--stdin", "--", "--help",
  ]);
  assert.equal(sent.input, secret, "the body goes on stdin");
  assert.ok(!sent.argv.some((word) => word.includes(secret)), "the body is not in argv");
});

test("light: with no body there is no --stdin, and a blank body is no body; a report with no source says api", async () => {
  const deps = stub();
  await candleApi(post(LIGHT_PATH, LIGHT), TAILNET, deps);
  await candleApi(post(LIGHT_PATH, { ...LIGHT, body: "  \n " }), TAILNET, deps);
  for (const sent of deps.runs) {
    assert.ok(!sent.argv.includes("--stdin"));
    assert.equal(sent.input, undefined);
    assert.ok(sent.argv.includes("--source=api"));
  }
});

test("light: a CLI refusal is 409 with its sentence, and a CLI a signal ended is 502", async () => {
  const refused = await candleApi(post(LIGHT_PATH, LIGHT), TAILNET, stub({ code: 1, error: "the store is locked" }));
  assert.equal(refused.status, 409);
  assert.equal(errorOf(refused.body), "the store is locked");
  const deps = stub();
  deps.run = () => Promise.resolve({ code: 1, killed: true, error: "the command failed" });
  assert.equal((await candleApi(post(LIGHT_PATH, LIGHT), TAILNET, deps)).status, 502);
});

// --- light through the real CLI -----------------------------------------------------------

/** The API with the real CLI: what the flag parser does to the values is what counts here. */
const REAL_RUN: CandleDeps = { ...stub(), run: runCli };

test("real CLI: values and keys that look like flags stay data, and nothing prints the help instead of writing", async () => {
  const name = "flag-values";
  const store = openProject(name, { create: true });
  const marker = join(sandbox, "a-shell-ran");
  const words = ["-h", "--help", "--json", "--stdin", "--follow-up", "--", "-", "--project", "--project=other", "--title=x", `$(touch ${marker})`];
  for (const word of words) {
    const reply = await candleApi(post(LIGHT_PATH, { project: name, key: word, title: word, severity: "low", target: word, source: word }), TAILNET, REAL_RUN);
    assert.equal(reply.status, 200, `${word}: ${errorOf(reply.body)}`);
    const candle = collectCandles(store).find((candidate) => candidate.key === word);
    assert.ok(candle !== undefined, `no candle with the key ${word}`);
    assert.equal(candle.title, word);
    assert.equal(candle.target, word);
    assert.equal(candle.source, word);
    assert.equal(candle.status, "lit");
  }
  assert.equal(existsSync(marker), false, "no shell ran the value");
  assert.ok(!collectCandles(openProject(name)).some((candle) => candle.key === "other"));
});

test("real CLI: the body reaches the blob through stdin, as it is", async () => {
  const name = "candle-body";
  const store = openProject(name, { create: true });
  const body = "--note -h\n\n<script>alert(1)</script>\n";
  const reply = await candleApi(post(LIGHT_PATH, { project: name, key: "k", title: "t", severity: "high", body, deliver: "none" }), TAILNET, REAL_RUN);
  assert.equal(reply.status, 200, errorOf(reply.body));
  const [candle] = collectCandles(store);
  assert.ok(candle?.bodySha !== undefined);
  assert.equal(getBlobText(store, candle.bodySha), body);
  assert.deepEqual(candle.deliver, []);
});

test("real CLI: a repeat report at the same severity is 200 and counts", async () => {
  const name = "candle-repeat";
  const store = openProject(name, { create: true });
  for (let n = 0; n < 2; n += 1) assert.equal((await candleApi(post(LIGHT_PATH, { project: name, key: "k", title: "t", severity: "high", deliver: "none" }), TAILNET, REAL_RUN)).status, 200);
  assert.equal(collectCandles(store)[0]?.reports, 2);
});

// --- answer and accept: the guards of findingApi -----------------------------------------

const SETTLING = "settling";
function freshCandle(key: string, project = SETTLING): void {
  appendLine(openProject(project, { create: true }), { who: "t", type: CANDLE_LIT, key, title: "A problem", severity: "high", source: "ci:nightly" });
}
freshCandle("open-1");

for (const [path, body] of [
  [ANSWER_PATH, { project: SETTLING, key: "open-1", note: "decided" }],
  [ACCEPT_PATH, { project: SETTLING, key: "open-1", note: "decided" }],
] as const) {
  test(`${path}: path, method, loopback viewer, Origin, content type, size and JSON`, async () => {
    const deps = stub();
    assert.equal((await candleApi(post(path, body, { method: "GET" }), TAILNET, deps)).status, 405);
    const local = await candleApi(post(path, body), LOCAL, deps);
    assert.equal(local.status, 403);
    assert.equal(errorOf(local.body), LOOPBACK_CANDLE_SETTLE);
    const noOrigin = await candleApi(withHeaders(path, body, JSON_TYPE), TAILNET, deps);
    assert.equal(noOrigin.status, 403, "unlike light, these need the page's Origin");
    assert.match(errorOf(noOrigin.body), /must come from the darius page/u);
    assert.equal((await candleApi(withHeaders(path, body, { ...JSON_TYPE, origin: "http://evil.example" }), TAILNET, deps)).status, 403);
    assert.equal((await candleApi(withHeaders(path, body, { ...JSON_TYPE, origin: "null" }), TAILNET, deps)).status, 403);
    assert.equal((await candleApi(withHeaders(path, body, { origin: ORIGIN, "content-type": "text/plain" }), TAILNET, deps)).status, 415);
    assert.equal((await candleApi(post(path, { ...body, note: "x".repeat(5000) }), TAILNET, deps)).status, 413);
    assert.equal((await candleApi(post(path, null, { body: "{not json" }), TAILNET, deps)).status, 400);
    assert.deepEqual(deps.runs, [], "nothing ran");
  });

  test(`${path}: unknown keys, a bad key, a bad note, an unknown project and an unknown candle are 400`, async () => {
    const deps = stub();
    const cases: [JsonValue, RegExp][] = [
      [{ ...body, who: "someone" }, /unknown field who/u],
      [{ ...body, severity: "low" }, /unknown field severity/u],
      [[1], /send \{/u],
      [{ ...body, project: "../etc" }, /project must be a project name/u],
      [{ ...body, key: "a\nb" }, /key must be one line/u],
      [{ ...body, key: "k".repeat(121) }, /key must be one line/u],
      [{ ...body, note: 7 }, /note must be text/u],
      [{ ...body, note: "n".repeat(501) }, /note: at most 500/u],
      [{ ...body, project: "nobody-here" }, /no project nobody-here/u],
      [{ ...body, key: "no-such-key" }, /no candle 'no-such-key'/u],
    ];
    for (const [sent, expected] of cases) {
      const refused = await candleApi(post(path, sent), TAILNET, deps);
      assert.equal(refused.status, 400, JSON.stringify(sent));
      assert.match(errorOf(refused.body), expected, JSON.stringify(sent));
    }
    assert.deepEqual(deps.runs, []);
  });
}

test("accept takes no followUp, and an answer needs a note", async () => {
  const deps = stub();
  assert.match(errorOf((await candleApi(post(ACCEPT_PATH, { project: SETTLING, key: "open-1", followUp: true }), TAILNET, deps)).body), /unknown field followUp/u);
  for (const note of [undefined, "", "   "]) {
    const refused = await candleApi(post(ANSWER_PATH, { project: SETTLING, key: "open-1", note }), TAILNET, deps);
    assert.equal(refused.status, 400);
    assert.match(errorOf(refused.body), /note is required/u);
  }
  assert.match(errorOf((await candleApi(post(ANSWER_PATH, { project: SETTLING, key: "open-1", note: "n", followUp: "yes" }), TAILNET, deps)).body), /followUp must be true or false/u);
  assert.deepEqual(deps.runs, []);
});

test("the relight endpoint is not there in this version, and an unknown candle path is 404", async () => {
  const deps = stub();
  for (const path of ["/api/candle/relight", "/api/candle/blow-out", "/api/candle/"]) assert.equal((await candleApi(post(path, {}), TAILNET, deps)).status, 404, path);
  assert.deepEqual(deps.runs, []);
});

test("answer and accept: the argv has -- before the key and the note as --note=value, and no stdin", async () => {
  const deps = stub();
  freshCandle("--help");
  assert.equal((await candleApi(post(ANSWER_PATH, { project: SETTLING, key: "--help", note: "-h" }), TAILNET, deps)).status, 200);
  assert.equal((await candleApi(post(ACCEPT_PATH, { project: SETTLING, key: "--help", note: "--follow-up" }), TAILNET, deps)).status, 200);
  assert.deepEqual(deps.runs[0], { argv: ["candle", "answer", `--project=${SETTLING}`, "--who=web:owner on phone", "--json", "--note=-h", "--", "--help"], input: undefined });
  assert.deepEqual(deps.runs[1], { argv: ["candle", "accept", `--project=${SETTLING}`, "--who=web:owner on phone", "--json", "--note=--follow-up", "--", "--help"], input: undefined });
});

test("real CLI: answer and accept write their line with --who web:, and a note or key that looks like a flag stays data", async () => {
  const name = "settle-real";
  freshCandle("-h", name);
  freshCandle("--follow-up", name);
  const store = openProject(name);
  const answered = await candleApi(post(ANSWER_PATH, { project: name, key: "-h", note: "--help" }), TAILNET, REAL_RUN);
  assert.equal(answered.status, 200, errorOf(answered.body));
  const accepted = await candleApi(post(ACCEPT_PATH, { project: name, key: "--follow-up", note: "-h" }), TAILNET, REAL_RUN);
  assert.equal(accepted.status, 200, errorOf(accepted.body));
  const candles = collectCandles(store);
  const one = candles.find((candle) => candle.key === "-h");
  assert.equal(one?.status, "answered");
  assert.equal(one?.answered?.note, "--help");
  assert.equal(one?.answered?.who, "web:owner on phone");
  const two = candles.find((candle) => candle.key === "--follow-up");
  assert.equal(two?.status, "accepted");
  assert.equal(two?.accepted?.note, "-h");

  const again = await candleApi(post(ANSWER_PATH, { project: name, key: "-h", note: "again" }), TAILNET, REAL_RUN);
  assert.equal(again.status, 409, "the second answer is refused");
  assert.match(errorOf(again.body), /already answered by web:owner on phone/u);
  const twice = await candleApi(post(ACCEPT_PATH, { project: name, key: "--follow-up" }), TAILNET, REAL_RUN);
  assert.equal(twice.status, 409);
});

test("real CLI: a note of --project=other is text on the candle of its own project (0.113.3)", async () => {
  const name = "settle-inject";
  freshCandle("k", name);
  freshCandle("k", "settle-inject-other");
  const accepted = await candleApi(post(ACCEPT_PATH, { project: name, key: "k", note: "--project=settle-inject-other" }), TAILNET, REAL_RUN);
  assert.equal(accepted.status, 200, errorOf(accepted.body));
  assert.equal(collectCandles(openProject(name)).find((candle) => candle.key === "k")?.accepted?.note, "--project=settle-inject-other");
  assert.equal(collectCandles(openProject("settle-inject-other")).find((candle) => candle.key === "k")?.status, "lit", "the other project is untouched");
});

test("accept: a refused status is 409 and the CLI does not run; a CLI refusal comes back as 409", async () => {
  const name = "settle-refused";
  freshCandle("k", name);
  appendLine(openProject(name), { who: "t", type: "candle.accepted", key: "k", severity: "high" });
  const deps = stub();
  const refused = await candleApi(post(ACCEPT_PATH, { project: name, key: "k" }), TAILNET, deps);
  assert.equal(refused.status, 409);
  assert.match(errorOf(refused.body), /already accepted/u);
  assert.deepEqual(deps.runs, []);
  freshCandle("k2", name);
  const fromCli = await candleApi(post(ACCEPT_PATH, { project: name, key: "k2" }), TAILNET, stub({ code: 1, error: "vigil 'x' was not closed" }));
  assert.equal(fromCli.status, 409);
  assert.equal(errorOf(fromCli.body), "vigil 'x' was not closed");
});

// --- answer with a follow-up --------------------------------------------------------------

const FOLLOWING = "following";
const seed = new Seeder(FOLLOWING);
seed.run("scan", [{ key: "vuln", title: "A hole", severity: "high", state: "needs-decision", candle: true }]);
const FOLLOW = { project: FOLLOWING, key: "vuln", note: "--help", followUp: true };

function answeredLines(project: string): number {
  return readLedger(openProject(project)).filter((line) => line.type === "candle.answered").length;
}

test("follow-up: on this host it starts the CLI detached, with no --on, the key after --, and answers 202 with the run", async () => {
  const deps = stub({ readiness: ready(["vuln"]), log: [`darius run follow-up: started run ${STARTED} on host-a`] });
  const started = await candleApi(post(ANSWER_PATH, FOLLOW), TAILNET, deps);
  assert.equal(started.status, 202, errorOf(started.body));
  assert.ok(isRecord(started.body));
  assert.equal(started.body.run, STARTED);
  assert.equal(started.body.host, "host-a");
  assert.deepEqual(deps.runs, [], "it does not wait for the run");
  assert.deepEqual(deps.starts, [["candle", "answer", "--follow-up", `--project=${FOLLOWING}`, "--note=--help", "--who=web:owner on phone", "--", "vuln"]]);
  assert.equal(answeredLines(FOLLOWING), 0, "the API writes no answer; the CLI does when the run started");
});

test("follow-up: on a ritual of another host it passes --on <host>", async () => {
  const deps = stub({ readiness: ready(["vuln"], "host-b", "host-a"), log: [`darius run follow-up: started run ${STARTED} on host-b`] });
  const started = await candleApi(post(ANSWER_PATH, FOLLOW), TAILNET, deps);
  assert.equal(started.status, 202, errorOf(started.body));
  assert.ok(isRecord(started.body));
  assert.equal(started.body.host, "host-b");
  assert.deepEqual(deps.starts, [["candle", "answer", "--follow-up", `--project=${FOLLOWING}`, "--note=--help", "--who=web:owner on phone", "--on=host-b", "--", "vuln"]]);
});

test("follow-up: a host name that could act as an ssh option starts nothing", async () => {
  const deps = stub({ readiness: ready(["vuln"], "-oProxyCommand=x", "host-a") });
  const refused = await candleApi(post(ANSWER_PATH, FOLLOW), TAILNET, deps);
  assert.equal(refused.status, 409);
  assert.match(errorOf(refused.body), /host name is not valid/u);
  assert.deepEqual(deps.starts, []);
});

test("follow-up: a candle from outside has no run, so it is 409 with a sentence and nothing starts", async () => {
  const name = "outside-follow";
  freshCandle("k", name);
  const deps = stub({ readiness: ready(["k"]) });
  const refused = await candleApi(post(ANSWER_PATH, { project: name, key: "k", note: "n", followUp: true }), TAILNET, deps);
  assert.equal(refused.status, 409);
  assert.match(errorOf(refused.body), /has no run to follow up: its newest report came from ci:nightly/u);
  assert.deepEqual(deps.starts, []);
  assert.equal(answeredLines(name), 0);
});

test("follow-up: not ready is 409 with the reason, nothing starts, no answer is written", async () => {
  const deps = stub({ readiness: { ready: false, host: "host-a", reason: "on host-b: ssh to host-b failed: no answer" } });
  const refused = await candleApi(post(ANSWER_PATH, FOLLOW), TAILNET, deps);
  assert.equal(refused.status, 409);
  assert.equal(errorOf(refused.body), "on host-b: ssh to host-b failed: no answer");
  assert.deepEqual(deps.starts, []);
  assert.equal(answeredLines(FOLLOWING), 0);
});

test("follow-up: a run with no open item of that key is 409, and nothing starts", async () => {
  const deps = stub({ readiness: ready(["another-key"]) });
  const refused = await candleApi(post(ANSWER_PATH, FOLLOW), TAILNET, deps);
  assert.equal(refused.status, 409);
  assert.match(errorOf(refused.body), /no open decision on candle 'vuln'/u);
  assert.deepEqual(deps.starts, []);
});

test("follow-up: a CLI that ends without a run is 409 with the reason, not the closing line, and the id of the start", async () => {
  const log = ["! the lease is held by host-b", "darius candle answer: the follow-up did not start, so candle 'vuln' stays lit"];
  const deps = stub({ readiness: ready(["vuln"]), log, exit: 1 });
  const refused = await candleApi(post(ANSWER_PATH, FOLLOW), TAILNET, deps);
  assert.equal(refused.status, 409);
  assert.equal(errorOf(refused.body), "host-a did not start it: the lease is held by host-b.");
  assert.ok(isRecord(refused.body));
  assert.ok(isText(refused.body.id));
  assert.equal(answeredLines(FOLLOWING), 0);
});

test("follow-up: ssh that fails after the check is 503, as POST /api/run/follow-up answers", async () => {
  const deps = stub({ readiness: ready(["vuln"], "host-b", "host-a"), log: ["ssh: connect to host host-b: refused"], exit: 255 });
  assert.equal((await candleApi(post(ANSWER_PATH, FOLLOW), TAILNET, deps)).status, 503);
});

test("follow-up: no line in time is 202 pending with a message", async () => {
  const deps = stub({ readiness: ready(["vuln"]), exit: "running" });
  const pending = await candleApi(post(ANSWER_PATH, FOLLOW), TAILNET, deps);
  assert.equal(pending.status, 202);
  assert.ok(isRecord(pending.body));
  assert.equal(pending.body.pending, true);
  assert.ok(isText(pending.body.message));
});

test("follow-up: a start that throws is 409, and writes nothing", async () => {
  const deps = stub({ readiness: ready(["vuln"]) });
  deps.start = () => {
    throw new Error("no such file");
  };
  const refused = await candleApi(post(ANSWER_PATH, FOLLOW), TAILNET, deps);
  assert.equal(refused.status, 409);
  assert.match(errorOf(refused.body), /no such file/u);
  assert.equal(answeredLines(FOLLOWING), 0);
});

test("real CLI: a follow-up the CLI refuses is 409 with its sentence, and no candle.answered is written", async () => {
  // The seeder writes runs of a ritual with no item, so the real CLI refuses it after the readiness stub said yes.
  const deps: CandleDeps = { ...stub({ readiness: ready(["vuln"]) }), start: startDetachedFollowUp, waitMs: 30_000 };
  const refused = await candleApi(post(ANSWER_PATH, FOLLOW), TAILNET, deps);
  assert.equal(refused.status, 409, errorOf(refused.body));
  assert.match(errorOf(refused.body), /^host-a did not start it: .*no ritual 'scan'/u);
  assert.equal(answeredLines(FOLLOWING), 0);
  assert.equal(collectCandles(openProject(FOLLOWING))[0]?.status, "lit");
});

test("real CLI: a ritual with no checkout here skips the follow-up: 409 names the reason, and no candle.answered is written", async () => {
  const name = "follow-skip";
  const seeded = new Seeder(name);
  seeded.run("scan", [{ key: "vuln", title: "A hole", severity: "high", state: "needs-decision", candle: true }]);
  const added = spawnSync(BIN, ["ritual", "add", "scan", "--project", name, "--title", "Scan", "--cadence", "7d", "--stdin"], { input: "Check it.\n", encoding: "utf8" });
  assert.equal(added.status, 0, added.stderr);
  const deps: CandleDeps = { ...stub({ readiness: ready(["vuln"]) }), start: startDetachedFollowUp, waitMs: 30_000 };
  const refused = await candleApi(post(ANSWER_PATH, { project: name, key: "vuln", note: "fix it", followUp: true }), TAILNET, deps);
  assert.equal(refused.status, 409, errorOf(refused.body));
  assert.match(errorOf(refused.body), /^host-a did not start it: /u);
  assert.doesNotMatch(errorOf(refused.body), /the follow-up did not start/u, "the reason, not the closing line");
  assert.equal(answeredLines(name), 0);
  assert.equal(collectCandles(openProject(name))[0]?.status, "lit");
});

// --- candle answer --on: the CLI -------------------------------------------------------------

const FAKE_SSH = join(sandbox, "fake-ssh");
const FAKE_SSH_LOG = join(sandbox, "ssh-log");
const BASH = (process.env.PATH ?? "").split(":").map((dir) => join(dir, "bash")).find((candidate) => candidate.startsWith("/") && existsSync(candidate)) ?? "/bin/bash";
writeFileSync(
  FAKE_SSH,
  `#!${BASH}
# A fake ssh: it parses the remote line the way a login shell would and logs the words. It never runs them.
shift 4
host="$1"; shift
eval "set -- $*"
printf '%s\\0' "$host" "$@" > "${FAKE_SSH_LOG}"
echo "remote output from $host"
exit "\${FAKE_SSH_EXIT:-0}"
`,
);
chmodSync(FAKE_SSH, 0o755);

function sshWords(): string[] {
  return readFileSync(FAKE_SSH_LOG, "utf8").split("\0").slice(0, -1);
}

function darius(argv: string[], exit = "0", env: Record<string, string> = {}) {
  rmSync(FAKE_SSH_LOG, { force: true });
  const ran = spawnSync(BIN, argv, { env: { ...process.env, DARIUS_SSH: FAKE_SSH, FAKE_SSH_EXIT: exit, ...env }, encoding: "utf8" });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

const REMOTE_HEAD = ["host-b", "bash", "-l", "-c", 'exec darius "$@"', "darius"];

test("candle answer --follow-up --on forwards the verb: the exit code passes through and no answer is written here", () => {
  const ran = darius(["candle", "answer", "vuln", "--note", "update it", "--follow-up", "--on", "host-b", "--project", FOLLOWING, "--who", "web:owner"], "3");
  assert.equal(ran.status, 3, ran.stderr);
  assert.match(ran.stdout, /remote output from host-b/u);
  assert.deepEqual(sshWords(), [...REMOTE_HEAD, "candle", "answer", "vuln", "--note", "update it", "--follow-up", "--project", FOLLOWING, "--who", "web:owner"]);
  assert.equal(answeredLines(FOLLOWING), 0);
});

test("--on: a key and a note that start with - stay data on the other host", () => {
  for (const key of ["-h", "--help"]) {
    const ran = darius(["candle", "answer", "--note=-h", "--follow-up", "--on", "host-b", "--project", FOLLOWING, "--who=web:owner", "--", key]);
    assert.equal(ran.status, 0, ran.stderr);
    assert.deepEqual(sshWords(), [...REMOTE_HEAD, "candle", "--note=-h", "--follow-up", "--project", FOLLOWING, "--who", "web:owner", "--", "answer", key], key);
  }
});

test("--on: the words the other host gets parse there as the verb, not as a call for help", () => {
  const name = "forwarded-words";
  freshCandle("-h", name);
  const ran = darius(["candle", "--note=-h", "--follow-up", "--project", name, "--who", "web:owner", "--", "answer", "-h"]);
  assert.equal(ran.status, 1, ran.stderr);
  assert.match(ran.stdout, /candle '-h' has no run to follow up/u);
});

test("--on goes only with candle answer --follow-up, and a run may not forward", () => {
  for (const argv of [["answer", "vuln", "--note", "n"], ["accept", "vuln"], ["blow-out", "vuln"], ["relight", "vuln"], ["light", "vuln", "--title", "t", "--severity", "low"]]) {
    const ran = darius(["candle", ...argv, "--on", "host-b", "--project", FOLLOWING]);
    assert.equal(ran.status, 2, argv.join(" "));
    assert.match(ran.stderr, /takes no --on/u, argv.join(" "));
    assert.equal(existsSync(FAKE_SSH_LOG), false, "no ssh call");
  }
  const inRun = darius(["candle", "answer", "vuln", "--note", "n", "--follow-up", "--on", "host-b", "--project", FOLLOWING], "0", { DARIUS_RUN: "01INSIDE" });
  assert.equal(inRun.status, 1);
  assert.match(inRun.stdout, /is for a person or a script/u);
  assert.equal(existsSync(FAKE_SSH_LOG), false, "no ssh call");
});

test("--on with this host's own name runs the verb here", () => {
  const ran = darius(["candle", "answer", "no-such-key", "--note", "n", "--follow-up", "--on", "host-a", "--project", FOLLOWING]);
  assert.equal(existsSync(FAKE_SSH_LOG), false, "no ssh call");
  assert.equal(ran.status, 1);
  assert.match(ran.stderr, /no candle 'no-such-key'/u);
});

// --- the reads --------------------------------------------------------------------------

const READING = "reading";
const NASTY = "<img src=x onerror=alert(1)>\"'";
appendLine(openProject(READING, { create: true }), { who: "t", type: CANDLE_LIT, key: "lit-1", title: NASTY, severity: "critical", source: "ci:nightly", target: NASTY });
appendLine(openProject(READING), { who: "t", type: CANDLE_LIT, key: "-closed", title: "Closed", severity: "low", source: "script" });
appendLine(openProject(READING), { who: "op", type: "candle.accepted", key: "-closed", severity: "low" });

test("GET /api/candles: every project and status with no query, each filter narrows, and rows carry the project", async () => {
  const deps = stub();
  const all = await candleApi(get("/api/candles", ""), TAILNET, deps);
  assert.equal(all.status, 200);
  const everywhere = rowsOf(all.body);
  assert.ok(everywhere.some((row) => row.project === FOLLOWING && row.key === "vuln"));
  assert.ok(everywhere.some((row) => row.project === READING && row.key === "lit-1"));

  const one = rowsOf((await candleApi(get("/api/candles", `?project=${READING}&status=`), TAILNET, deps)).body);
  assert.deepEqual(one.map((row) => row.key).toSorted(), ["-closed", "lit-1"]);
  assert.ok(one.every((row) => row.project === READING));

  const lit = rowsOf((await candleApi(get("/api/candles", `?project=${READING}&status=lit`), TAILNET, deps)).body);
  assert.deepEqual(lit.map((row) => row.key), ["lit-1"]);
  const accepted = rowsOf((await candleApi(get("/api/candles", `project=${READING}&status=accepted`), TAILNET, deps)).body);
  assert.deepEqual(accepted.map((row) => row.key), ["-closed"]);
  assert.deepEqual(rowsOf((await candleApi(get("/api/candles", `project=${READING}&status=out`), TAILNET, deps)).body), []);
  assert.deepEqual(deps.runs, [], "a read runs no CLI");
});

test("GET /api/candles: a bad filter is 400, a write method 405, a page of another site 403", async () => {
  const deps = stub();
  assert.equal((await candleApi(get("/api/candles", "project=../etc"), TAILNET, deps)).status, 400);
  assert.equal((await candleApi(get("/api/candles", "project=nobody-here"), TAILNET, deps)).status, 400);
  assert.equal((await candleApi(get("/api/candles", "status=burning"), TAILNET, deps)).status, 400);
  assert.equal((await candleApi(post("/api/candles", {}), TAILNET, deps)).status, 405);
  assert.equal((await candleApi(get("/api/candles", "", { "sec-fetch-site": "cross-site" }), TAILNET, deps)).status, 403);
  assert.equal((await candleApi(get("/api/candles", "", { "sec-fetch-site": "same-origin" }), TAILNET, deps)).status, 200);
});

test("the reads answer the loopback viewer: the access check is all they need", async () => {
  const deps = stub();
  assert.equal((await candleApi(get("/api/candles", ""), LOCAL, deps)).status, 200);
  assert.equal((await candleApi(get("/api/candle", `project=${READING}&key=lit-1`), LOCAL, deps)).status, 200);
  assert.equal((await candleApi({ ...get("/api/candles", ""), method: "HEAD" }, LOCAL, deps)).status, 200);
});

test("GET /api/candle: one row with its history and body; a key that looks like a flag works; unknown is 404; bad is 400", async () => {
  const deps = stub();
  const reply = await candleApi(get("/api/candle", `project=${READING}&key=lit-1`), TAILNET, deps);
  assert.equal(reply.status, 200);
  assert.ok(isRecord(reply.body));
  assert.equal(reply.body.body, null, "this candle has no body");
  const row = reply.body.candle;
  assert.ok(isRecord(row));
  assert.equal(row.project, READING);
  assert.equal(row.key, "lit-1");
  assert.ok(isList(row.history));
  assert.equal(row.history.length, 1);

  assert.equal((await candleApi(get("/api/candle", `project=${READING}&key=-closed`), TAILNET, deps)).status, 200);
  assert.equal((await candleApi(get("/api/candle", `project=${READING}&key=nothing`), TAILNET, deps)).status, 404);
  assert.equal((await candleApi(get("/api/candle", `project=${READING}`), TAILNET, deps)).status, 400);
  assert.equal((await candleApi(get("/api/candle", `key=lit-1`), TAILNET, deps)).status, 400);
  assert.equal((await candleApi(get("/api/candle", `project=nobody-here&key=k`), TAILNET, deps)).status, 400);
  assert.equal((await candleApi(get("/api/candle", `project=${READING}&key=a%0Ab`), TAILNET, deps)).status, 400);
  assert.equal((await candleApi(post("/api/candle", {}), TAILNET, deps)).status, 405);
  assert.equal((await candleApi(get("/api/candle", `project=${READING}&key=lit-1`, { "sec-fetch-site": "cross-site" }), TAILNET, deps)).status, 403);
});

test("WebContext: candles() gives every status and candle() gives the row and the body; unknown is null", async () => {
  const name = "ctx-candle";
  openProject(name, { create: true });
  assert.equal((await candleApi(post(LIGHT_PATH, { project: name, key: "k", title: "t", severity: "high", body: "The body", deliver: "none" }), TAILNET, REAL_RUN)).status, 200);
  const context = webContext("someone");
  const rows = await context.candles();
  assert.ok(rows.some((row) => row.project === name && row.key === "k" && row.status === "lit"));
  assert.ok(rows.some((row) => row.project === READING && row.status === "accepted"), "candles() is not only the lit ones");
  const detail = context.candle(name, "k");
  assert.equal(detail?.row.project, name);
  assert.equal(detail?.body, "The body");
  assert.equal(context.candle(name, "nothing"), null);
  assert.equal(context.candle("nobody-here", "k"), null);
});

test("the status JSON gains candles.lit per project; every field it had stays", () => {
  const status = collectStatus();
  const reading = status.projects.find((project) => project.name === READING);
  assert.ok(reading !== undefined);
  assert.deepEqual(reading.candles, { lit: 1 }, "one lit and one accepted");
  assert.deepEqual(Object.keys(reading).toSorted(), ["candles", "checkout", "error", "findings", "icon", "lastSync", "maxMode", "milestones", "milestonesArchived", "name", "rituals", "runs", "vigils"]);
  assert.deepEqual(Object.keys(status).toSorted(), ["generatedAt", "host", "hosts", "profiles", "projects", "today", "utcOffset", "version"]);
  assert.deepEqual(status.projects.find((project) => project.name === FOLLOWING)?.candles, { lit: 1 });
});

// --- darius serve ------------------------------------------------------------------------

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address: JsonValue = JSON.parse(JSON.stringify(probe.address()));
      const port = isRecord(address) ? Number(address.port) : 0;
      probe.close(() => resolve(port));
    });
  });
}

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function call(port: number, options: { method: string; path: string; headers?: Record<string, string>; body?: string }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, method: options.method, path: options.path, headers: options.headers ?? {} }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(options.body ?? "");
  });
}

/** Asks until the server answers: a fixed wait is what makes the other serve tests flaky. */
async function waitForServe(port: number): Promise<void> {
  const deadline = Date.now() + 15_000;
  let last = "no answer";
  while (Date.now() < deadline) {
    try {
      await call(port, { method: "GET", path: "/healthz" });
      return;
    } catch (cause) {
      last = String(cause);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`serve did not answer: ${last}`);
}

test("serve: the reads pass the access check as JSON that cannot run as a page; the writes refuse the loopback viewer", async () => {
  assert.ok(isCandlePath("/api/candles") && isCandlePath("/api/candle") && isCandlePath("/api/candle/light"));
  assert.ok(!isCandlePath("/api/candley") && !isCandlePath("/candles"));
  const port = await freePort();
  const log = console.log;
  console.log = () => undefined;
  const serving = serveCommand.run(parseArgs(["--port", String(port), "--bind", "127.0.0.1"]));
  try {
    await waitForServe(port);
    const list = await call(port, { method: "GET", path: `/api/candles?project=${READING}&status=lit` });
    assert.equal(list.status, 200);
    assert.match(String(list.headers["content-type"]), /^application\/json/u);
    assert.equal(list.headers["content-security-policy"], "default-src 'none'");
    assert.equal(list.headers["x-content-type-options"], "nosniff");
    const rows = rowsOf(JSON.parse(list.body));
    assert.equal(rows[0]?.title, NASTY, "the text comes back as the same string");
    assert.equal(rows[0]?.target, NASTY);
    assert.ok(list.body.includes(JSON.stringify(NASTY)), "as a JSON string");

    const one = await call(port, { method: "GET", path: `/api/candle?project=${READING}&key=lit-1` });
    assert.equal(one.status, 200);
    assert.match(String(one.headers["content-type"]), /^application\/json/u);

    const status: JsonValue = JSON.parse((await call(port, { method: "GET", path: "/api/status.json" })).body);
    assert.ok(isRecord(status) && isList(status.projects));
    const shown = status.projects.find((project) => isRecord(project) && project.name === READING);
    assert.ok(isRecord(shown));
    assert.deepEqual(shown.candles, { lit: 1 });

    const sent = JSON.stringify({ project: READING, key: "lit-1", title: "t", severity: "high" });
    const light = await call(port, { method: "POST", path: LIGHT_PATH, headers: JSON_TYPE, body: sent });
    assert.equal(light.status, 403);
    assert.match(light.body, /lighting a candle over HTTP needs a tailnet identity/u);
    const answer = await call(port, { method: "POST", path: ANSWER_PATH, headers: { ...JSON_TYPE, origin: `http://127.0.0.1:${String(port)}` }, body: JSON.stringify({ project: READING, key: "lit-1", note: "n" }) });
    assert.equal(answer.status, 403);
    assert.match(answer.body, /settling a candle needs a tailnet identity/u);
    assert.equal((await call(port, { method: "POST", path: "/api/candles", headers: JSON_TYPE, body: "{}" })).status, 405);
    assert.equal((await call(port, { method: "GET", path: LIGHT_PATH })).status, 405);
  } finally {
    process.emit("SIGTERM");
    await serving;
    console.log = log;
  }
});

// --- the CLI runner -------------------------------------------------------------------------

test("runCli: a CLI that does not read its input still answers", async () => {
  const answer = await runCli(["candle", "--bogus"], "unread input");
  assert.equal(answer.code, 2);
  assert.match(answer.error, /unknown option --bogus/u);
});
