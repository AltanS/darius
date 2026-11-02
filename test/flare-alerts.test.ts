/**
 * Flare notices (src/core/alerts.ts, "FLARES"): one notice per ledger line and
 * channel, sent by the host that wrote the line, with a trace when a channel is
 * not set up. The push service and the mail provider are fakes on loopback.
 *
 * SAFETY: the state and config dirs are `mkdtemp` dirs, and DARIUS_PUSH_ORIGINS
 * names only the fake. Nothing here reaches a real push service or a real store.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs } from "../src/cli/args.ts";
import { flareCommand } from "../src/cli/flare.ts";
import { channelProblems, flareAlerts, flushAlerts, MAX_TRIES, NOT_SET_UP, sendAlerts, type Alert } from "../src/core/alerts.ts";
import { emailSettingsFile, writeEmailSettings, type EmailSettings } from "../src/core/email.ts";
import { appendLine, readLedger } from "../src/core/ledger.ts";
import type { LedgerLine, Ritual } from "../src/core/model.ts";
import { makePushKeys, pushKeysFile, subscribe, writePushKeys } from "../src/core/push.ts";
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
  /** What reached the mail path. */
  mail: Array<{ idempotencyKey: string; message: { from: string; to: string[]; subject: string; text: string } }>;
  /** The HTTP status the next mails get. An error echoes the request. */
  mailStatus: number;
}

const MAIL_PATH = "/private-path/send";
const service: FakeService = { paths: [], status: 201, mail: [], mailStatus: 202 };

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk: string) => {
    body += chunk;
  });
  request.on("end", () => {
    if (request.url === MAIL_PATH) {
      service.mail.push({ idempotencyKey: String(request.headers["idempotency-key"]), message: JSON.parse(body) });
      response.writeHead(service.mailStatus);
      response.end(service.mailStatus < 300 ? "" : JSON.stringify({ authorization: request.headers.authorization, request: body }));
      return;
    }
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

// --- email ------------------------------------------------------------------------------

const TOKEN = "your-token-here";
const MAIL_FROM = "darius@example.com";
const MAIL_TO = ["ops@example.com", "second@example.com"];

function emailSettings(more: Partial<EmailSettings> = {}): EmailSettings {
  return { url: `${origin}${MAIL_PATH}`, token: TOKEN, from: MAIL_FROM, to: MAIL_TO, since: "2000-01-01T00:00:00.000Z", ...more };
}

/** Runs `body` with this file in the config dir, and takes it away after, because other tests need email not set up. */
async function withEmail(settings: EmailSettings, body: () => Promise<void>): Promise<void> {
  service.mail = [];
  service.mailStatus = 202;
  writeEmailSettings(settings);
  try {
    await body();
  } finally {
    rmSync(emailSettingsFile(), { force: true });
  }
}

/** Every file under `dir`, with its text. */
function filesUnder(dir: string): Array<{ path: string; text: string }> {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isFile())
    .map((path) => ({ path, text: readFileSync(path, "utf8") }));
}

/** The whole store, which is what syncs: no token, no address, no path of the provider's url. */
function assertStoreClean(): void {
  for (const { path, text } of filesUnder(process.env.DARIUS_STATE_DIR ?? "")) {
    for (const secret of [TOKEN, MAIL_FROM, ...MAIL_TO, MAIL_PATH, "private-path"]) assert.equal(text.includes(secret), false, `${path} holds ${secret}`);
  }
}

test("a flare notice goes out by email: the text, the hashed key and a recipient count, with no address or token in the store", async () => {
  await withEmail(emailSettings({ web_url: "https://darius.example.com/" }), async () => {
    const project = fresh("fa-mail");
    const lit = light(project, "dep/cve 1", { deliver: ["email"], target: "web/package.json", title: "Vulnerable dependency" });
    const key = `line:${lit.id}:email`;
    assert.equal(await flush(project), 0, "nothing on push");
    assert.equal(service.mail.length, 1);
    const [mail] = service.mail;
    assert.equal(mail?.idempotencyKey, createHash("sha256").update(key).digest("hex"));
    assert.equal(mail?.message.from, MAIL_FROM);
    assert.deepEqual(mail?.message.to, MAIL_TO);
    assert.equal(mail?.message.subject, "flare: Vulnerable dependency");
    assert.equal(mail?.message.text, ["Severity: high", "Project: fa-mail", "Target: web/package.json", "Link: https://darius.example.com/w/fa-mail/flares/dep%2Fcve%201"].join("\n"));
    const [sentLine] = lines(project, "alert.sent");
    assert.equal(sentLine?.key, key);
    assert.equal(sentLine?.channel, "email");
    assert.equal(sentLine?.devices, MAIL_TO.length);
    await flushAlerts({ projects: [project.name] });
    assert.equal(service.mail.length, 1, "sent once");
    assertStoreClean();
  });
});

test("a raised flare says so, and a run with many flares sends one mail with no flare body and no detail", async () => {
  await withEmail(emailSettings(), async () => {
    const project = fresh("fa-mail-many");
    const header: Ritual = {
      id: ulid(),
      kind: "ritual",
      slug: "scan",
      title: "Scan",
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      tags: [],
      anchor: "due",
      policy: { mode: "report", may: [], hold: [] },
      flare_deliver: ["email"],
    };
    project.writeItem({ header, body: "" }, { who: "test" });
    const items = ["a", "b", "c", "d", "e"].map((key) => ({ key, detail: "THE-DETAIL", target: `t-${key}` }));
    runWithFlares(project, "scan", items);
    await flushAlerts({ projects: [project.name] });
    assert.equal(service.mail.length, 1);
    const message = service.mail[0]?.message;
    assert.equal(message?.subject, "5 flares in scan");
    assert.equal(message?.text, ["Project: fa-mail-many", "1. high: Flare a, t-a", "2. high: Flare b, t-b", "3. high: Flare c, t-c", "and 2 more"].join("\n"));
    assert.equal(JSON.stringify(message).includes("THE-DETAIL"), false);

    const single = fresh("fa-mail-raise");
    light(single, "k", { deliver: ["email"], severity: "low" });
    light(single, "k", { deliver: ["email"], severity: "critical" });
    await flushAlerts({ projects: [single.name] });
    assert.equal(service.mail[1]?.message.text, "Severity: low\nProject: fa-mail-raise");
    assert.equal(service.mail[2]?.message.text, "Severity: critical, raised\nProject: fa-mail-raise");
  });
});

test("a provider that fails and echoes the request leaves a scrubbed alert.failed, and retries stop at MAX_TRIES", async () => {
  await withEmail(emailSettings(), async () => {
    const project = fresh("fa-mail-fail");
    const lit = light(project, "k", { deliver: ["email"] });
    const key = `line:${lit.id}:email`;
    service.mailStatus = 500;
    for (let attempt = 0; attempt < MAX_TRIES + 2; attempt += 1) await flushAlerts({ projects: [project.name] });
    assert.equal(service.mail.length, MAX_TRIES, "a broken provider costs at most MAX_TRIES requests");
    assert.equal(failures(project, key).length, MAX_TRIES);
    assert.equal(failures(project, key)[0]?.error, "127.0.0.1 answered 500");
    assert.equal(failures(project, key)[0]?.channel, "email");
    assert.equal(service.mail[2]?.idempotencyKey, service.mail[0]?.idempotencyKey, "the same notice, so the provider can drop a double");
    assert.equal(service.mail[2]?.message.subject, "flare: Flare k", "a retry keeps the email text");
    assertStoreClean();
  });
});

test("a dead provider is a failed notice with a clean error, and not a stopped flush", async () => {
  const dead = emailSettings({ url: "http://127.0.0.1:9/private-path/send" });
  await withEmail(dead, async () => {
    const project = fresh("fa-mail-dead");
    const lit = light(project, "k", { deliver: ["email"] });
    const delivery = await flushAlerts({ projects: [project.name] });
    assert.equal(delivery?.sent, 0);
    assert.match(String(failures(project, `line:${lit.id}:email`)[0]?.error), /^127\.0\.0\.1 did not answer/u);
    assertStoreClean();
  });
});

test("lines before since are not emailed, and leave no trace", async () => {
  const project = fresh("fa-mail-since");
  const old = light(project, "old", { deliver: ["email"] });
  await withEmail(emailSettings({ since: tick() }), async () => {
    const fresher = light(project, "new", { deliver: ["email"] });
    await flushAlerts({ projects: [project.name] });
    assert.deepEqual(service.mail.map((mail) => mail.message.subject), ["flare: Flare new"]);
    assert.deepEqual(lines(project, "alert.sent").map((line) => line.key), [`line:${fresher.id}:email`]);
    assert.equal(readLedger(project).some((line) => line.key === `line:${old.id}:email`), false);
  });
});

test("a notice that failed as not set up is history once email is set up: setup does not email old flares", async () => {
  const project = fresh("fa-mail-late");
  const old = light(project, "old", { deliver: ["email"] });
  await flushAlerts({ projects: [project.name] });
  assert.equal(failures(project, `line:${old.id}:email`).length, 1, "a trace with tries left");
  await withEmail(emailSettings({ since: tick() }), async () => {
    await flushAlerts({ projects: [project.name] });
    assert.deepEqual(service.mail, []);
    assert.equal(failures(project, `line:${old.id}:email`).length, 1, "and no new trace");
  });
});

test("a bad email.json does not stop the flush: push still goes out, and the trace gives the reason with no value", async () => {
  const broken = [
    { name: "wide", content: JSON.stringify(emailSettings()), mode: 0o644, reason: /^not set up on host: email\.json must be readable by its owner only/u },
    { name: "syntax", content: `{"token":"${TOKEN}","to":["${MAIL_TO[0] ?? ""}"`, mode: 0o600, reason: /^not set up on host: email\.json is not valid JSON$/u },
    { name: "field", content: JSON.stringify(emailSettings({ url: `http://mail.example.com${MAIL_PATH}` })), mode: 0o600, reason: /^not set up on host: email\.json: url must be https/u },
  ];
  for (const { name, content, mode, reason } of broken) {
    writeFileSync(emailSettingsFile(), content, { mode });
    chmodSync(emailSettingsFile(), mode);
    try {
      const project = fresh(`fa-mail-bad-${name}`);
      const lit = light(project, "k", { deliver: ["push", "email"] });
      assert.equal(await flush(project), 1, "push goes out");
      assert.deepEqual(lines(project, "alert.sent").map((line) => line.channel), ["push"]);
      assert.match(String(failures(project, `line:${lit.id}:email`)[0]?.error), reason);
    } finally {
      rmSync(emailSettingsFile(), { force: true });
    }
  }
  assertStoreClean();
});

/** Runs `body` with this text as push.json, and puts the real keys back after. */
async function withPushFile(content: string, body: () => Promise<void>): Promise<void> {
  const saved = readFileSync(pushKeysFile(), "utf8");
  writeFileSync(pushKeysFile(), content);
  try {
    await body();
  } finally {
    writeFileSync(pushKeysFile(), saved, { mode: 0o600 });
  }
}

test("a bad push.json does not stop the flush: email still goes out, and the trace holds no key material", async () => {
  const secret = "PRIVATE-KEY-MATERIAL-1234";
  const broken = [`{"v":1,"private":"${secret}"`, JSON.stringify({ v: 1, private: secret, public: "p" })];
  for (const content of broken) {
    await withPushFile(content, async () => {
      await withEmail(emailSettings(), async () => {
        const project = fresh(`fa-push-bad-${String(content.length)}`);
        const lit = light(project, "k", { deliver: ["push", "email"] });
        const delivery = await flushAlerts({ projects: [project.name] });
        assert.equal(delivery?.sent, 1, "email goes out");
        assert.equal(service.mail.length, 1);
        const [trace] = failures(project, `line:${lit.id}:push`);
        assert.match(String(trace?.error), /^not set up on host: push\.json /u);
        assert.equal(String(trace?.error).includes(secret), false);
        assert.equal(String(trace?.error).includes(SANDBOX), false, "a base name, not a path");
        for (const { path, text } of filesUnder(join(process.env.DARIUS_STATE_DIR ?? "", project.name))) assert.equal(text.includes(secret), false, path);
      });
    });
  }
});

test("channelProblems names a broken push.json or email.json with the reason and no value", async () => {
  assert.deepEqual(channelProblems(), []);
  await withPushFile("not json at all", async () => {
    writeFileSync(emailSettingsFile(), `{"token":"${TOKEN}"`, { mode: 0o600 });
    try {
      const found = channelProblems();
      assert.equal(found.length, 2);
      assert.match(found[0] ?? "", /^push\.json is not valid JSON/u);
      assert.equal(found[1], "email.json is not valid JSON");
      assert.equal(found.join("\n").includes(TOKEN), false);
    } finally {
      rmSync(emailSettingsFile(), { force: true });
    }
  });
});

test("one project that throws is one entry in failed, and the others still go", async () => {
  const project = fresh("fa-iso");
  light(project, "k");
  const delivery = await flushAlerts({ projects: ["fa-no-such-project", project.name] });
  assert.equal(delivery?.sent, 1);
  assert.equal(delivery?.failed.length, 1);
  assert.match(delivery?.failed[0] ?? "", /^fa-no-such-project: /u);
});

test("an alert from a line older than 24 hours does not go out after a repair, a flare notice does; now is respected", async () => {
  const project = fresh("fa-24h");
  appendLine(project, { who: "t", type: "run.completed", item: "ritual/heartbeat", run: "OLD1", outcome: "failed", at: tick() });
  const lit = light(project, "waited");
  const twoDays = Date.now() + 48 * 3_600_000;
  const delivery = await flushAlerts({ projects: [project.name], now: twoDays });
  assert.equal(delivery?.sent, 1, "only the flare notice");
  assert.deepEqual(lines(project, "alert.sent").map((line) => line.key), [`line:${lit.id}:push`]);

  appendLine(project, { who: "t", type: "run.completed", item: "ritual/heartbeat", run: "NEW1", outcome: "failed", at: tick() });
  // At the real time both lines are under a day old, so the held back one goes now, with the new one.
  assert.equal((await flushAlerts({ projects: [project.name] }))?.sent, 2, "a line under 24 hours old goes");
});

test("flare light sends its own email before it exits, and its stderr holds no value on a failure", async () => {
  await withEmail(emailSettings(), async () => {
    const project = fresh("fa-mail-light");
    service.mailStatus = 403;
    const result = await runFlare(project.name, ["light", "k", "--title", "Flare k", "--severity", "high", "--deliver", "email"]);
    assert.equal(result.code, 0);
    assert.equal(service.mail.length, 1);
    assert.match(result.stderr, /127\.0\.0\.1 answered 403/u);
    for (const secret of [TOKEN, MAIL_FROM, ...MAIL_TO, MAIL_PATH]) assert.equal(result.stderr.includes(secret), false, secret);
  });
});

// Last: it takes the push keys away.
test("email does not depend on push: a host without push keys still sends it", async () => {
  rmSync(pushKeysFile(), { force: true });
  await withEmail(emailSettings(), async () => {
    const project = fresh("fa-mail-only");
    light(project, "k", { deliver: ["email"] });
    const delivery = await flushAlerts({ projects: [project.name] });
    assert.equal(delivery?.sent, 1);
    assert.equal(service.mail.length, 1);
  });
});
