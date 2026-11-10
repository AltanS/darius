/**
 * The email channel (src/core/email.ts, src/cli/email.ts): the request, the
 * status codes, the scrub, the file rules and the run walls.
 *
 * SAFETY: the state and config dirs are `mkdtemp` dirs, and the provider is a
 * stub on 127.0.0.1. Nothing here reaches a real provider or a real store. The
 * token and the addresses are placeholders.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { parseArgs } from "../src/cli/args.ts";
import { emailCommand } from "../src/cli/email.ts";
import { emailSettingsFile, emailStatus, parseEmailInput, readEmailSettings, scrubEmailError, sendEmail, writeEmailSettings, type EmailNotice, type EmailSettings } from "../src/core/email.ts";
import { UsageError } from "../src/core/model.ts";
import { errorMessage } from "../src/runtime.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-candle-email-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
mkdirSync(process.env.DARIUS_CONFIG_DIR, { recursive: true, mode: 0o700 });
writeFileSync(join(process.env.DARIUS_CONFIG_DIR, "config.toml"), 'host = "host-a"\n');
// A suite run inside a darius run must not see its own run.
delete process.env.DARIUS_RUN;
delete process.env.DARIUS_RUN_POLICY;

const TOKEN = "your-token-here";
const FROM = "darius@example.com";
const TO = ["ops@example.com", "second@example.com"];
const API_PATH = "/v1/private-path/send";

// --- a stub provider --------------------------------------------------------------------

interface Received {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  body: string;
}

interface Stub {
  received: Received[];
  status: number;
  /** The next answers echo the whole request in their body. */
  isEcho: boolean;
  /** The next answers carry this Location. */
  location: string | undefined;
  /** The next requests get no answer. */
  isHung: boolean;
}

const stub: Stub = { received: [], status: 202, isEcho: false, location: undefined, isHung: false };

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk: string) => {
    body += chunk;
  });
  request.on("end", () => {
    stub.received.push({ method: request.method ?? "", path: request.url ?? "", headers: request.headers, body });
    if (stub.isHung) return;
    response.writeHead(stub.status, stub.location === undefined ? {} : { location: stub.location });
    response.end(stub.isEcho ? JSON.stringify({ message: "refused", url: request.url, authorization: request.headers.authorization, request: body }) : "");
  });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
// SAFETY: a server listening on a TCP port reports an AddressInfo, never a pipe name or null.
const origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
test.after(() => {
  server.closeAllConnections();
  server.close();
});
test.beforeEach(() => {
  Object.assign(stub, { received: [], status: 202, isEcho: false, location: undefined, isHung: false });
  rmSync(emailSettingsFile(), { force: true });
});

// --- helpers ----------------------------------------------------------------------------

function settings(more: Partial<EmailSettings> = {}): EmailSettings {
  return { url: `${origin}${API_PATH}`, token: TOKEN, from: FROM, to: TO, since: "2026-01-01T00:00:00.000Z", ...more };
}

const NOTICE: EmailNotice = { key: "line:ABC:email", title: "candle: Vulnerable dependency", body: "Severity: high\nProject: demo\nTarget: web/package.json", url: "/w/demo/candles/k" };

/** The sent JSON. */
function sent(index = 0): { from: string; to: string[]; subject: string; text: string; html?: string } {
  return JSON.parse(stub.received[index]?.body ?? "");
}

/** Fails when the text holds the token, an address or the secret part of the url. */
function assertClean(text: string, label: string): void {
  for (const secret of [TOKEN, FROM, ...TO, API_PATH, "private-path"]) assert.equal(text.includes(secret), false, `${label} holds ${secret}: ${text}`);
}

/** The message of what `sendEmail` throws. */
async function failure(run: () => Promise<void>): Promise<string> {
  try {
    await run();
  } catch (cause) {
    assert.equal(cause instanceof Error && cause.cause !== undefined, false, "the raw error does not ride along");
    return errorMessage(cause);
  }
  return assert.fail("it should have failed");
}

interface CliRun {
  code: number;
  stdout: string;
}

async function email(argv: string[], stdin?: string): Promise<CliRun> {
  const out: string[] = [];
  const { log } = console;
  console.log = (...parts: string[]) => out.push(parts.join(" "));
  try {
    const args = parseArgs(argv, emailCommand.flags);
    if (stdin !== undefined) args.stdin = stdin;
    return { code: await emailCommand.run(args), stdout: out.join("\n") };
  } finally {
    console.log = log;
  }
}

function modeOf(file: string): number {
  return statSync(file).mode & 0o777;
}

function badFile(content: string, mode = 0o600): void {
  writeFileSync(emailSettingsFile(), content, { mode });
  chmodSync(emailSettingsFile(), mode);
}

// --- the request ------------------------------------------------------------------------

test("the request: POST to the url, bearer token, hashed idempotency key, exactly the four JSON fields", async () => {
  await sendEmail(settings(), NOTICE);
  const [request] = stub.received;
  assert.equal(request?.method, "POST");
  assert.equal(request.path, API_PATH);
  assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(request.headers["content-type"], "application/json");
  assert.equal(request.headers["idempotency-key"], createHash("sha256").update(NOTICE.key).digest("hex"));
  assert.match(request.headers["idempotency-key"] ?? "", /^[0-9a-f]{64}$/u);
  assert.deepEqual(Object.keys(sent()).toSorted(), ["from", "subject", "text", "to"]);
  assert.equal(sent().from, FROM);
  assert.deepEqual(sent().to, TO);
  assert.equal(sent().subject, NOTICE.title);
  assert.equal(sent().text, NOTICE.body);
});

test("the link comes only with web_url, and a trailing slash gives no double slash", async () => {
  await sendEmail(settings({ web_url: "https://darius.example.com/" }), NOTICE);
  assert.match(sent().text, /\nLink: https:\/\/darius\.example\.com\/w\/demo\/candles\/k$/u);
  await sendEmail(settings(), NOTICE);
  assert.equal(sent(1).text.includes("Link:"), false);
});

test("the title and each body line pass the redaction: the provider's url is cut and the lines stay", async () => {
  const url = `${origin}${API_PATH}`;
  await sendEmail(settings(), { ...NOTICE, title: `candle:\nsee ${url}`, body: `Severity: high\nTarget: ${url}` });
  assert.equal(sent().subject, "candle: see 127.0.0.1");
  assert.equal(sent().text, "Severity: high\nTarget: 127.0.0.1");
});

// --- status codes -----------------------------------------------------------------------

test("any 2xx is success", async () => {
  for (const status of [200, 201, 202, 204, 299]) {
    stub.status = status;
    await sendEmail(settings(), NOTICE);
  }
  assert.equal(stub.received.length, 5);
});

test("a 4xx or a 5xx is a failure that gives the host and the status", async () => {
  for (const status of [400, 401, 403, 404, 422, 429, 500, 503]) {
    stub.status = status;
    assert.equal(await failure(() => sendEmail(settings(), NOTICE)), `127.0.0.1 answered ${String(status)}`);
  }
});

test("a redirect is a failure and is not followed, so the addresses go nowhere else", async () => {
  stub.status = 307;
  stub.location = `${origin}/other`;
  assert.equal(await failure(() => sendEmail(settings(), NOTICE)), "127.0.0.1 answered 307");
  assert.deepEqual(stub.received.map((request) => request.path), [API_PATH]);
});

// --- the scrub --------------------------------------------------------------------------

test("a provider error that echoes the request leaves no token and no address in the error", async () => {
  stub.status = 422;
  stub.isEcho = true;
  const message = await failure(() => sendEmail(settings(), NOTICE));
  assert.equal(message, "127.0.0.1 answered 422");
  assertClean(message, "the error");
});

test("a fetch error that quotes the url, the token and the addresses is scrubbed, also through its cause", async (t) => {
  const url = `${origin}${API_PATH}`;
  const quoting = `request to ${url} failed: Bearer ${TOKEN} from ${FROM} to ${TO.join(",")}`;
  t.mock.method(globalThis, "fetch", () => Promise.reject(new TypeError("fetch failed", { cause: new Error(quoting) })));
  const message = await failure(() => sendEmail(settings(), NOTICE));
  assertClean(message, "the error");
  assert.match(message, /^127\.0\.0\.1 did not answer: fetch failed: request to 127\.0\.0\.1 failed/u);
});

test("the scrub also takes an encoded token and an address in another case or encoding", () => {
  const token = "abc/def+1";
  const message = scrubEmailError(`t=${encodeURIComponent(token)} ${token} OPS@EXAMPLE.COM ops%40example.com Darius <darius@example.com>`, settings({ token, from: "Darius <darius@example.com>" }));
  for (const secret of [token, encodeURIComponent(token), "OPS@EXAMPLE.COM", "ops%40example.com", "darius@example.com"]) assert.equal(message.includes(secret), false, message);
});

test("a provider that does not listen gives a clean error", async () => {
  const closed = createServer();
  await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
  // SAFETY: as above, a listening TCP server reports an AddressInfo.
  const { port } = closed.address() as AddressInfo;
  await new Promise((resolve) => closed.close(resolve));
  const message = await failure(() => sendEmail(settings({ url: `http://127.0.0.1:${String(port)}${API_PATH}` }), NOTICE));
  assert.match(message, /^127\.0\.0\.1 did not answer: /u);
  assertClean(message, "the error");
});

test("a hung provider cannot hold the send: the timeout ends it", async () => {
  stub.isHung = true;
  const started = Date.now();
  const message = await failure(() => sendEmail(settings(), NOTICE, { timeoutMs: 100 }));
  assert.ok(Date.now() - started < 5000, "ended by the timeout");
  assert.match(message, /^127\.0\.0\.1 did not answer: /u);
  assertClean(message, "the error");
});

// --- the file ---------------------------------------------------------------------------

test("without the file the channel is not set up, and that is no problem", () => {
  assert.equal(readEmailSettings(), null);
  assert.deepEqual(emailStatus(), { isSetUp: false, host: null, recipients: 0, since: null, html: null, problem: null });
});

test("a file its group or others can read is refused, and an owner-only one passes", () => {
  writeEmailSettings(settings());
  for (const mode of [0o644, 0o640, 0o604, 0o660, 0o666]) {
    chmodSync(emailSettingsFile(), mode);
    assert.throws(() => readEmailSettings(), /owner only/u);
    assert.match(emailStatus().problem ?? "", /owner only/u);
    assertClean(emailStatus().problem ?? "", "the problem");
  }
  for (const mode of [0o600, 0o400]) {
    chmodSync(emailSettingsFile(), mode);
    assert.equal(readEmailSettings()?.token, TOKEN);
  }
  chmodSync(emailSettingsFile(), 0o600);
});

test("a write makes a 0600 file, under a wide umask too, and replaces a wide file instead of writing into it", () => {
  const before = process.umask(0);
  try {
    writeEmailSettings(settings());
    assert.equal(modeOf(emailSettingsFile()), 0o600);
    badFile("{}", 0o644);
    const oldInode = statSync(emailSettingsFile()).ino;
    writeEmailSettings(settings());
    assert.equal(modeOf(emailSettingsFile()), 0o600);
    assert.notEqual(statSync(emailSettingsFile()).ino, oldInode, "a new file, so no byte was ever in the wide one");
  } finally {
    process.umask(before);
  }
  assert.deepEqual(readdirSync(process.env.DARIUS_CONFIG_DIR ?? "").filter((name) => name.endsWith(".tmp")), [], "no temp file stays");
  assert.deepEqual(readEmailSettings(), settings());
});

test("http is refused off loopback and the tailnet; https is fine anywhere", () => {
  const input = (url: string): string => JSON.stringify({ ...settings(), url });
  for (const url of ["http://mail.example.com/send", "http://100.128.0.1/send", "http://127.0.0.1.example.com/send", "ftp://127.0.0.1/send", "not a url", ""]) {
    assert.throws(() => parseEmailInput(input(url)), /url must be/u, url);
  }
  for (const url of ["https://mail.example.com/send", "http://127.0.0.1:8080/send", "http://localhost/send", "http://100.64.0.1/send", "http://100.127.255.254/send"]) {
    assert.equal(parseEmailInput(input(url)).url, url);
  }
});

test("a url with a user, a password, a query or a fragment is refused, because a scrub could miss that part", () => {
  const input = (url: string): string => JSON.stringify({ ...settings(), url });
  for (const url of ["https://user:s3cret@mail.example.com/send", "https://mail.example.com/send?key=s3cret", "https://mail.example.com/send#s3cret"]) {
    assert.throws(() => parseEmailInput(input(url)), (cause) => !errorMessage(cause).includes("s3cret"), url);
  }
});

test("every bad value is refused by name, and no message quotes a value", () => {
  const good = settings();
  const cases: ReadonlyArray<[object, RegExp]> = [
    [{ ...good, token: "" }, /token/u],
    [{ ...good, token: `${TOKEN} two` }, /token/u],
    [{ ...good, token: `${TOKEN}\nx` }, /token/u],
    [{ ...good, token: 12 }, /token/u],
    [{ ...good, from: TOKEN }, /from/u],
    [{ ...good, to: {} }, /to must/u],
    [{ ...good, to: FROM }, /to must/u],
    [{ ...good, to: [FROM, TOKEN] }, /to\[1\]/u],
    [{ ...good, since: TOKEN }, /since/u],
    [{ ...good, web_url: TOKEN }, /web_url/u],
    [{ ...good, web_url: `ftp://${TOKEN}.example.com/` }, /web_url/u],
    [{ ...good, [TOKEN]: 1 }, /unknown key/u],
    [[TOKEN], /JSON object/u],
  ];
  for (const [value, pattern] of cases) {
    const text = JSON.stringify(value);
    for (const read of [(): EmailSettings => parseEmailInput(text), (): EmailSettings | null => (badFile(text), readEmailSettings())]) {
      assert.throws(read, (cause) => {
        assert.match(errorMessage(cause), pattern);
        assertClean(errorMessage(cause), "the message");
        return true;
      });
    }
  }
});

test("a file that is not JSON gives a problem that does not quote it", () => {
  badFile(`{"token": "${TOKEN}", "to": ["${TO[0] ?? ""}"`);
  assert.equal(emailStatus().problem, "email.json is not valid JSON");
  assert.throws(() => parseEmailInput(`${TOKEN} ${FROM}`), (cause) => {
    assert.equal(errorMessage(cause), "the input is not valid JSON");
    return true;
  });
});

test("since is set to now when absent, kept when given, and made the form ledger lines compare with", () => {
  const now = new Date("2026-11-01T10:00:00.000Z");
  const { since: _since, ...withoutSince } = settings();
  assert.equal(parseEmailInput(JSON.stringify(withoutSince), now).since, now.toISOString());
  assert.equal(parseEmailInput(JSON.stringify({ ...withoutSince, since: "2026-06-01T12:00:00+02:00" }), now).since, "2026-06-01T10:00:00.000Z");
});

test("the status holds no secret", () => {
  writeEmailSettings(settings({ web_url: "https://darius.example.com" }));
  const status = emailStatus();
  assert.deepEqual(status, { isSetUp: true, host: "127.0.0.1", recipients: 2, since: settings().since, html: true, problem: null });
  assertClean(JSON.stringify(status), "the status");
});

// --- the CLI ----------------------------------------------------------------------------

test("email set --stdin writes the file 0600 and prints no value", async () => {
  const { since: _since, ...input } = settings();
  const human = await email(["set", "--stdin"], JSON.stringify(input));
  assert.equal(human.code, 0);
  assert.match(human.stdout, /email is set up: 127\.0\.0\.1, 2 recipients/u);
  assertClean(human.stdout, "stdout");
  assert.equal(modeOf(emailSettingsFile()), 0o600);
  assert.equal(readEmailSettings()?.token, TOKEN);
  assert.ok(Date.parse(readEmailSettings()?.since ?? "") > Date.now() - 60_000, "since is now");
  const json = await email(["set", "--stdin", "--json"], JSON.stringify(input));
  assert.deepEqual(Object.keys(JSON.parse(json.stdout)).toSorted(), ["host", "ok", "recipients", "since"]);
  assertClean(json.stdout, "the JSON");
});

test("email set takes only stdin, and bad input is a usage error that writes nothing and quotes nothing", async () => {
  await assert.rejects(email(["set"]), UsageError);
  await assert.rejects(email(["set", "--token", TOKEN]), (cause) => {
    assertClean(errorMessage(cause), "the message");
    return cause instanceof UsageError;
  });
  await assert.rejects(email(["set", "--stdin"], `{"token":"${TOKEN}"`), (cause) => {
    assert.ok(cause instanceof UsageError);
    assertClean(errorMessage(cause), "the message");
    return true;
  });
  assert.equal(existsSync(emailSettingsFile()), false);
});

test("email status says set up, not set up, or what is wrong, with no value", async () => {
  const absent = await email(["status"]);
  assert.equal(absent.code, 0);
  assert.match(absent.stdout, /email is not set up on host-a/u);

  writeEmailSettings(settings());
  const good = await email(["status"]);
  assert.equal(good.code, 0);
  assert.match(good.stdout, /email is set up on host-a: 127\.0\.0\.1, 2 recipients/u);
  assertClean(good.stdout, "stdout");

  chmodSync(emailSettingsFile(), 0o644);
  const wide = await email(["status"]);
  assert.equal(wide.code, 1);
  assert.match(wide.stdout, /owner only/u);
  assertClean(wide.stdout, "stdout");
  const wideJson = JSON.parse((await email(["status", "--json"])).stdout);
  assert.equal(wideJson.ok, false);
  assert.equal(wideJson.isSetUp, false);

  badFile(`{"token":"${TOKEN}"`);
  const broken = await email(["status"]);
  assert.equal(broken.code, 1);
  assert.match(broken.stdout, /not valid JSON/u);
  assertClean(broken.stdout, "stdout");
});

test("email test sends one message; a failure exits 1 with a clean line; no setup exits 1 and sends nothing", async () => {
  const none = await email(["test"]);
  assert.equal(none.code, 1);
  assert.equal(stub.received.length, 0);

  writeEmailSettings(settings());
  const good = await email(["test"]);
  assert.equal(good.code, 0);
  assert.equal(stub.received.length, 1);
  assert.match(sent().subject, /^\[example\] email test on host-a: 7 candles, 2 critical$/u, "a sample candle mail (0.130.0)");
  assert.match(sent().text, /^Critical \(2\)$/mu);
  assert.match(sent().html ?? "", /<h2 [^>]*>High \(3\)<\/h2>/u, "with html by default");
  assert.match(good.stdout, /took a test for 2 recipients: a sample candle mail, text and html/u);
  assertClean(good.stdout, "stdout");
  assertClean(sent().text, "the sample text");

  stub.status = 401;
  stub.isEcho = true;
  const refused = await email(["test"]);
  assert.equal(refused.code, 1);
  assert.match(refused.stdout, /127\.0\.0\.1 answered 401/u);
  assertClean(refused.stdout, "stdout");

  chmodSync(emailSettingsFile(), 0o644);
  const wide = await email(["test"]);
  assert.equal(wide.code, 1);
  assert.equal(stub.received.length, 2, "a refused file sends nothing");
});

test("email has a verb or it is a usage error", async () => {
  await assert.rejects(email([]), UsageError);
  await assert.rejects(email(["send"]), UsageError);
});

test("inside a run, set and test refuse and change nothing; status still answers", async () => {
  writeEmailSettings(settings());
  const before = readFileSync(emailSettingsFile(), "utf8");
  for (const name of ["DARIUS_RUN", "DARIUS_RUN_POLICY"]) {
    process.env[name] = "x";
    try {
      const set = await email(["set", "--stdin"], JSON.stringify(settings({ token: "other-token" })));
      assert.equal(set.code, 1, name);
      assert.match(set.stdout, /email set is for a person/u);
      const sendIt = await email(["test"]);
      assert.equal(sendIt.code, 1, name);
      assert.match(sendIt.stdout, /email test is for a person/u);
      assert.equal((await email(["status"])).code, 0, name);
    } finally {
      delete process.env[name];
    }
  }
  assert.equal(readFileSync(emailSettingsFile(), "utf8"), before);
  assert.equal(stub.received.length, 0);
});

// --- both runtimes ----------------------------------------------------------------------

const run = promisify(execFile);

for (const runtime of ["node", "bun"]) {
  test(`set, status and test work under ${runtime}, a failed send stays clean, and a run is refused`, async () => {
    const config = mkdtempSync(join(SANDBOX, `cli-${runtime}-`));
    writeFileSync(join(config, "config.toml"), 'host = "host-a"\n');
    const env = { ...process.env, DARIUS_RUNTIME: runtime, DARIUS_CONFIG_DIR: config };
    const bin = join(import.meta.dirname, "..", "bin", "darius");
    const setUp = run(bin, ["email", "set", "--stdin"], { env });
    setUp.child.stdin?.end(JSON.stringify(settings()));
    assertClean((await setUp).stdout, "stdout");
    assert.equal(modeOf(join(config, "email.json")), 0o600);
    assert.match((await run(bin, ["email", "status"], { env })).stdout, /set up on host-a: 127\.0\.0\.1, 2 recipients/u);
    assert.match((await run(bin, ["email", "test"], { env })).stdout, /127\.0\.0\.1 took a test/u);
    assert.equal(stub.received[0]?.headers.authorization, `Bearer ${TOKEN}`);

    stub.status = 500;
    stub.isEcho = true;
    await assert.rejects(run(bin, ["email", "test"], { env }), (cause: { code?: number; stdout?: string; stderr?: string }) => {
      assert.equal(cause.code, 1);
      assert.match(cause.stdout ?? "", /answered 500/u);
      assertClean(`${cause.stdout ?? ""}${cause.stderr ?? ""}`, "the output");
      return true;
    });
    await assert.rejects(run(bin, ["email", "test"], { env: { ...env, DARIUS_RUN: "r1" } }), (cause: { code?: number; stdout?: string }) => {
      assert.equal(cause.code, 1);
      assert.match(cause.stdout ?? "", /is for a person/u);
      return true;
    });
    assert.equal(stub.received.length, 2, "the refused run sent nothing");
  });
}
