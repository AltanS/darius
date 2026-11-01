/**
 * Flare notices (src/core/alerts.ts, "FLARES"): one notice per ledger line and
 * channel, sent by the host that wrote the line, with a trace when a channel is
 * not set up. The push service is a fake on loopback that counts requests.
 *
 * SAFETY: the state and config dirs are `mkdtemp` dirs, and DARIUS_PUSH_ORIGINS
 * names only the fake. Nothing here reaches a real push service or a real store.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs } from "../src/cli/args.ts";
import { flareCommand } from "../src/cli/flare.ts";
import { flareAlerts, flushAlerts, MAX_TRIES, NOT_SET_UP, sendAlerts, type Alert } from "../src/core/alerts.ts";
import { appendLine, readLedger } from "../src/core/ledger.ts";
import type { LedgerLine, Ritual } from "../src/core/model.ts";
import { makePushKeys, subscribe, writePushKeys } from "../src/core/push.ts";
import { GLOBAL_PROJECT, openProject, putBlob, type Project } from "../src/core/store.ts";
import { ulid } from "../src/core/ulid.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-flare-alerts-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
mkdirSync(process.env.DARIUS_CONFIG_DIR, { recursive: true });
writeFileSync(join(process.env.DARIUS_CONFIG_DIR, "config.toml"), 'host = "host-a"\n');
// A suite run inside a darius run must not see its own run.
delete process.env.DARIUS_RUN;
delete process.env.DARIUS_RUN_POLICY;
delete process.env.DARIUS_PROJECT;

// --- a fake push service ---------------------------------------------------------------

interface FakeService {
  /** The path of every request, in order. */
  paths: string[];
  /** The HTTP status the next sends get. */
  status: number;
}

const service: FakeService = { paths: [], status: 201 };

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  request.resume();
  request.on("end", () => {
    service.paths.push(request.url ?? "");
    response.writeHead(service.status);
    response.end();
  });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
// SAFETY: a server listening on a TCP port reports an AddressInfo, never a pipe name or null.
const origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
process.env.DARIUS_PUSH_ORIGINS = origin;
test.after(() => server.close());

async function setUpPush(): Promise<void> {
  writePushKeys(await makePushKeys("mailto:ops@example.com", new Date(Date.now() - 100 * 3_600_000)));
  const pair = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const p256dh = Buffer.from(await webcrypto.subtle.exportKey("raw", pair.publicKey)).toString("base64url");
  const auth = Buffer.from(webcrypto.getRandomValues(new Uint8Array(16))).toString("base64url");
  const global = openProject(GLOBAL_PROJECT, { create: true });
  assert.deepEqual(subscribe(global, { endpoint: `${origin}/device`, keys: { p256dh, auth } }, "ops on phone"), { ok: true });
}

// --- helpers ---------------------------------------------------------------------------

/** Lines get strictly rising instants in the near future, so they are later than the device and the keys. */
let tickMs = Date.now() + 60_000;
function tick(): string {
  tickMs += 1000;
  return new Date(tickMs).toISOString();
}

let runCount = 0;

interface FlagItem {
  key: string;
  severity?: string;
  state?: string;
  title?: string;
  detail?: string;
  target?: string;
}

/** A completed run of `ritual` whose result holds these flagged items; returns the ledger line. */
function runWithFlares(project: Project, ritual: string, items: readonly FlagItem[]): LedgerLine {
  runCount += 1;
  const filled = items.map((item) => ({ title: `Flare ${item.key}`, severity: "high", state: "needs-decision", ...item, flare: true }));
  const body = JSON.stringify({ v: 1, status: "ok", summary: "s", items: filled });
  return appendLine(project, {
    who: "t",
    type: "run.completed",
    item: `ritual/${ritual}`,
    run: `RUN${String(runCount).padStart(3, "0")}`,
    outcome: "complete",
    result_sha: putBlob(project, `${body}\n`),
    at: tick(),
  });
}

function light(project: Project, key: string, more: Record<string, string | string[]> = {}): LedgerLine {
  return appendLine(project, { who: "script", type: "flare.lit", key, title: `Flare ${key}`, severity: "high", source: "ci:nightly", at: tick(), ...more });
}

function fresh(name: string): Project {
  return openProject(name, { create: true });
}

function lines(project: Project, type: string): LedgerLine[] {
  return readLedger(project).filter((line) => line.type === type);
}

function alertLines(project: Project): LedgerLine[] {
  return readLedger(project).filter((line) => line.type.startsWith("alert."));
}

/** The flare notices the ledger builds now, with push set up and email not. */
function notices(project: Project): Alert[] {
  return flareAlerts(project, readLedger(project), { host: "host-a", since: { push: "2000-01-01T00:00:00.000Z", email: undefined } });
}

/** Writes lines of another host into a project, as a sync would leave them. */
function foreign(project: Project, host: string, rows: ReadonlyArray<Record<string, string | string[]>>): void {
  const dir = join(project.root, "ledger", host);
  mkdirSync(dir, { recursive: true });
  const written = rows.map((row) => {
    const at = tick();
    return { v: 1, id: ulid(Date.parse(at)), at, host, who: "script", project: project.name, ...row };
  });
  writeFileSync(join(dir, "open.jsonl"), written.map((row) => `${JSON.stringify(row)}\n`).join(""));
}

async function flush(project: Project): Promise<number> {
  const before = service.paths.length;
  await flushAlerts({ projects: [project.name] });
  return service.paths.length - before;
}

function failures(project: Project, key: string): LedgerLine[] {
  return lines(project, "alert.failed").filter((line) => line.key === key);
}

// --- a host that cannot send -----------------------------------------------------------

test("without push keys a flare notice leaves one trace per flush, at most MAX_TRIES, and a plain alert leaves none", async () => {
  const project = fresh("fa-bare");
  const failedRun = appendLine(project, { who: "timer", type: "run.completed", item: "ritual/heartbeat", run: "B1", outcome: "failed", at: tick() });
  const byDefault = light(project, "k1");
  const byEmail = light(project, "k2", { deliver: ["email"] });
  const pushKey = `line:${byDefault.id}:push`;
  const emailKey = `line:${byEmail.id}:email`;

  const first = await flushAlerts({ projects: [project.name] });
  assert.deepEqual(first?.failed.toSorted(), [`${emailKey}: ${NOT_SET_UP}`, `${pushKey}: ${NOT_SET_UP}`].toSorted());
  for (let attempt = 0; attempt < MAX_TRIES + 2; attempt += 1) await flushAlerts({ projects: [project.name] });

  assert.equal(failures(project, pushKey).length, MAX_TRIES, "the trace stops at MAX_TRIES");
  assert.equal(failures(project, emailKey).length, MAX_TRIES);
  const [trace] = failures(project, pushKey);
  assert.equal(trace?.channel, "push");
  assert.equal(trace?.error, NOT_SET_UP);
  assert.equal(trace?.title, "Flare lit, high: Flare k1");
  assert.equal(trace?.url, "/w/fa-bare/flares/k1");
  assert.equal(failures(project, emailKey)[0]?.channel, "email");
  assert.equal(lines(project, "alert.sent").length, 0);
  assert.equal(readLedger(project).some((line) => line.key === `line:${failedRun.id}`), false, "a plain alert on a host without keys records nothing");
  assert.equal(service.paths.length, 0, "nothing reached a push service");
});

test("a host without keys and without a flare sends nothing and records nothing, as before", async () => {
  const project = fresh("fa-plain");
  appendLine(project, { who: "timer", type: "run.completed", item: "ritual/heartbeat", run: "P1", outcome: "failed", at: tick() });
  assert.equal(await flushAlerts({ projects: [project.name] }), null);
  assert.equal(alertLines(project).length, 0);
  assert.equal(await sendAlerts(project, []), null);
});

test("a flush of every project works on a host with no _global project, and an exhausted trace stays quiet", async () => {
  const delivery = await flushAlerts();
  assert.deepEqual(delivery?.failed, []);
  assert.equal(delivery?.sent, 0);
});

test("a notice with tries left goes out when push is set up later; one that used its tries does not", async () => {
  const project = fresh("fa-late");
  const lit = light(project, "late");
  await flushAlerts({ projects: [project.name] });
  assert.equal(failures(project, `line:${lit.id}:push`).length, 1);

  await setUpPush();
  assert.equal(await flush(project), 1);
  assert.equal(lines(project, "alert.sent").filter((line) => line.key === `line:${lit.id}:push`).length, 1);
  const bare = fresh("fa-bare");
  await flush(bare);
  const flareKeys = lines(bare, "flare.lit").map((flare) => `line:${flare.id}:push`);
  assert.equal(flareKeys.length, 2);
  assert.equal(lines(bare, "alert.sent").some((sent) => flareKeys.includes(String(sent.key))), false, "three tries are gone: that notice is not sent now");
});

// --- one notice per line ---------------------------------------------------------------

test("one line gives one notice however many flares it holds, with no flare body and no detail", async () => {
  const project = fresh("fa-many");
  const items = Array.from({ length: 100 }, (_, index) => ({ key: `cve-${String(index)}`, title: `Problem ${String(index)}`, severity: "high", detail: "SECRET-DETAIL" }));
  const line = runWithFlares(project, "audit", items);

  const [only, ...more] = notices(project);
  assert.equal(more.length, 0);
  assert.equal(only?.key, `line:${line.id}:push`);
  assert.equal(only?.channel, "push");
  assert.equal(only?.title, "100 flares in audit");
  assert.equal(only?.body, "fa-many:\n1. high: Problem 0\n2. high: Problem 1\n3. high: Problem 2\nand 97 more");
  assert.equal(only?.url, "/w/fa-many/flares");
  assert.equal(`${only?.title}${only?.body}`.includes("SECRET-DETAIL"), false);

  assert.equal(await flush(project), 1, "one request for one device");
  assert.equal(await flush(project), 0, "once");
  assert.deepEqual(lines(project, "alert.sent").map((sent) => [sent.key, sent.channel]), [[`line:${line.id}:push`, "push"]]);
});

test("a run with one flare names it, with its target and a link to it; the key is encoded", async () => {
  const project = fresh("fa-one");
  runWithFlares(project, "audit", [{ key: "pkg a/b", title: "Old\nlibrary", severity: "critical", target: "service api" }]);
  const [only] = notices(project);
  assert.equal(only?.title, "Flare lit, critical: Old library");
  assert.equal(only?.body, "fa-one: service api");
  assert.equal(only?.url, "/w/fa-one/flares/pkg%20a%2Fb");
  assert.equal(await flush(project), 1);
});

test("a repeat report sends nothing, a severity rise sends once, and the same rise again sends nothing", async () => {
  const project = fresh("fa-rise");
  runWithFlares(project, "audit", [{ key: "k", severity: "medium" }]);
  assert.equal(await flush(project), 1);
  runWithFlares(project, "audit", [{ key: "k", severity: "medium" }]);
  light(project, "k", { severity: "low" });
  assert.equal(await flush(project), 0, "same or lower severity");
  runWithFlares(project, "audit", [{ key: "k", severity: "critical" }]);
  assert.equal(await flush(project), 1);
  runWithFlares(project, "audit", [{ key: "k", severity: "critical" }]);
  assert.equal(await flush(project), 0);
  assert.deepEqual(notices(project).map((alert) => alert.title), ["Flare lit, medium: Flare k", "Flare raised to critical: Flare k"]);
});

test("a relight after gone sends once", async () => {
  const project = fresh("fa-relight");
  light(project, "k");
  assert.equal(await flush(project), 1);
  appendLine(project, { who: "op", type: "flare.cleared", key: "k", at: tick() });
  assert.equal(await flush(project), 0, "clearing is not news");
  light(project, "k");
  assert.equal(await flush(project), 1);
  assert.equal(notices(project).length, 2);
});

// --- delivery --------------------------------------------------------------------------

test("deliver none sends nothing and traces nothing, on a line and for a ritual", async () => {
  const project = fresh("fa-none");
  light(project, "quiet", { deliver: [] });
  const header: Ritual = {
    id: ulid(),
    kind: "ritual",
    slug: "silent",
    title: "Silent",
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    tags: [],
    anchor: "due",
    policy: { mode: "report", may: [], hold: [] },
    flare_deliver: [],
  };
  project.writeItem({ header, body: "" }, { who: "test" });
  runWithFlares(project, "silent", [{ key: "from-run" }]);
  assert.equal(notices(project).length, 0);
  assert.equal(await flush(project), 0);
  assert.equal(alertLines(project).length, 0);
});

test("a run takes its channels from the ritual, read at flush time, and a ritual that is gone gets the default", async () => {
  const project = fresh("fa-ritual");
  const header: Ritual = {
    id: ulid(),
    kind: "ritual",
    slug: "mailer",
    title: "Mailer",
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    tags: [],
    anchor: "due",
    policy: { mode: "report", may: [], hold: [] },
    flare_deliver: ["email"],
  };
  project.writeItem({ header, body: "" }, { who: "test" });
  const mail = runWithFlares(project, "mailer", [{ key: "m" }]);
  const ghost = runWithFlares(project, "ghost", [{ key: "g" }]);

  assert.equal(await flush(project), 1, "only the ghost run goes to push");
  assert.deepEqual(lines(project, "alert.sent").map((sent) => sent.key), [`line:${ghost.id}:push`]);
  assert.equal(failures(project, `line:${mail.id}:email`).length, 1, "email is not set up: a trace, no push");
  assert.equal(failures(project, `line:${mail.id}:push`).length, 0);
});

test("a retry keeps its channel: a failed push goes again on push, and email never rides on push", async () => {
  const project = fresh("fa-retry");
  const lit = light(project, "k", { deliver: ["push", "email"] });
  const pushKey = `line:${lit.id}:push`;
  const emailKey = `line:${lit.id}:email`;

  service.status = 500;
  assert.equal(await flush(project), 1);
  service.status = 201;
  const [failedPush] = failures(project, pushKey);
  assert.equal(failedPush?.channel, "push");
  assert.match(String(failedPush?.error), /answered 500/u);
  assert.deepEqual([failedPush?.title, failedPush?.url], ["Flare lit, high: Flare k", "/w/fa-retry/flares/k"]);
  assert.equal(failures(project, emailKey).length, 1);
  assert.equal(failures(project, emailKey)[0]?.error, NOT_SET_UP);

  assert.equal(await flush(project), 1, "the push retry goes out; the email retry sends nothing");
  for (let attempt = 0; attempt < MAX_TRIES; attempt += 1) assert.equal(await flush(project), 0);

  assert.deepEqual(lines(project, "alert.sent").map((sent) => [sent.key, sent.channel]), [[pushKey, "push"]]);
  assert.equal(failures(project, pushKey).length, 1);
  assert.equal(failures(project, emailKey).length, MAX_TRIES, "the email trace is bounded");
});

test("a retried notice that sendState rebuilds from a failed line names the channel of that line", async () => {
  const project = fresh("fa-state");
  appendLine(project, { who: "t", type: "alert.failed", key: "line:X1:email", channel: "email", error: "x", title: "T", body: "B", url: "/u", at: tick() });
  appendLine(project, { who: "t", type: "alert.failed", key: "old", error: "x", title: "T", body: "B", url: "/u", at: tick() });
  appendLine(project, { who: "t", type: "alert.failed", key: "other", channel: "sms", error: "x", title: "T", body: "B", url: "/u", at: tick() });
  const delivery = await sendAlerts(project, [], { isDryRun: true });
  assert.deepEqual(delivery?.pending.map((alert) => [alert.key, alert.channel]), [["old", "push"]], "email is not ready, and an unknown channel is not ours");
});

// --- the origin host and history -------------------------------------------------------

test("only the host that wrote the line sends, but another host's lines still give the state", async () => {
  const project = fresh("fa-origin");
  foreign(project, "host-b", [{ type: "flare.lit", key: "k", title: "Flare k", severity: "high", source: "ci:nightly" }]);
  assert.equal(await flush(project), 0, "host-b sends its own");
  assert.equal(alertLines(project).length, 0);
  light(project, "k");
  assert.equal(await flush(project), 0, "host-b already lit it at this severity");
  light(project, "k", { severity: "critical" });
  assert.equal(await flush(project), 1, "this host raised it");
});

test("lines older than the first device are history and send nothing", async () => {
  const project = fresh("fa-old");
  appendLine(project, { who: "script", type: "flare.lit", key: "old", title: "Old", severity: "high", source: "ci", at: "2026-01-01T00:00:00.000Z" });
  assert.equal(notices(project).length, 1, "with an early since it would be news");
  assert.equal(await flush(project), 0);
  assert.equal(alertLines(project).length, 0);
});

// --- flare light -----------------------------------------------------------------------

async function runFlare(project: string, argv: string[]): Promise<{ code: number; stderr: string }> {
  const errors: string[] = [];
  const { log, error } = console;
  console.log = () => undefined;
  console.error = (...parts: string[]) => errors.push(parts.join(" "));
  try {
    const code = await flareCommand.run(parseArgs([...argv, "--project", project], flareCommand.flags));
    return { code, stderr: errors.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}

test("flare light flushes its own project before it exits and no other project", async () => {
  const mine = fresh("fa-light");
  const other = fresh("fa-other");
  const waiting = light(other, "waiting");
  const before = service.paths.length;

  const first = await runFlare(mine.name, ["light", "k", "--title", "Flare k", "--severity", "high"]);
  assert.equal(first.code, 0);
  assert.equal(service.paths.length - before, 1);
  assert.equal(lines(mine, "alert.sent").length, 1);
  assert.equal(readLedger(other).some((line) => line.key === `line:${waiting.id}:push`), false, "another project waits for its own flush");

  await runFlare(mine.name, ["light", "k", "--title", "Flare k", "--severity", "high"]);
  assert.equal(service.paths.length - before, 1, "a repeat report sends nothing");
});

test("flare light says on stderr that a channel is not set up, and still exits 0", async () => {
  const project = fresh("fa-light-email");
  const result = await runFlare(project.name, ["light", "k", "--title", "Flare k", "--severity", "high", "--deliver", "email"]);
  assert.equal(result.code, 0);
  assert.match(result.stderr, /:email: not set up on host/u);
  assert.equal(lines(project, "flare.lit").length, 1);
});
