/**
 * Web Push (src/core/push.ts), the alerts on top of it (src/core/alerts.ts),
 * the web endpoints (src/web/push-api.ts) and `darius push`, against a fake
 * push service on loopback. The encryption is checked byte for byte against
 * the example of RFC 8291, Appendix A, and the fake decrypts every message
 * the way a browser does.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { mkdtempSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs } from "../src/cli/args.ts";
import { pushCommand } from "../src/cli/push.ts";
import type { ParsedArgs } from "../src/cli/registry.ts";
import { flushAlerts, MAX_TRIES, sendAlerts } from "../src/core/alerts.ts";
import { appendLine, readLedger } from "../src/core/ledger.ts";
import {
  activeDevices,
  encryptPayload,
  fixedEphemeral,
  makePushKeys,
  pushKeysFile,
  subscribe,
  subscriptionProblem,
  vapidHeader,
  writePushKeys,
  type PushKeys,
} from "../src/core/push.ts";
import { GLOBAL_PROJECT, openProject, putBlob } from "../src/core/store.ts";
import { isSameOrigin, pushApi } from "../src/web/push-api.ts";
import { skipAlerts } from "../src/runner/report.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-push-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");

const { subtle } = webcrypto;
type Bytes = Uint8Array<ArrayBuffer>;

function bytes(text: string): Bytes {
  return new Uint8Array(Buffer.from(text.replaceAll(/\s+/gu, ""), "base64url"));
}

function b64(value: Bytes): string {
  return Buffer.from(value).toString("base64url");
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

/** A browser: its ECDH key pair and auth secret, and how it decrypts a message (RFC 8291, the receiver's side). */
interface Browser {
  keys: { p256dh: string; auth: string };
  decrypt(body: Bytes): Promise<string>;
}

async function newBrowser(): Promise<Browser> {
  const pair = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const uaPublic = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
  const auth = webcrypto.getRandomValues(new Uint8Array(16));
  return {
    keys: { p256dh: b64(uaPublic), auth: b64(auth) },
    async decrypt(body: Bytes): Promise<string> {
      const salt = body.slice(0, 16);
      const idlen = body[20] ?? 0;
      const asPublic = body.slice(21, 21 + idlen);
      const asKey = await subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
      const ecdh = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: asKey }, pair.privateKey, 256));
      const info = new Uint8Array([...new TextEncoder().encode("WebPush: info\u0000"), ...uaPublic, ...asPublic]);
      const ikm = await hkdf(auth, ecdh, info, 32);
      const cek = await hkdf(salt, ikm, new TextEncoder().encode("Content-Encoding: aes128gcm\u0000"), 16);
      const nonce = await hkdf(salt, ikm, new TextEncoder().encode("Content-Encoding: nonce\u0000"), 12);
      const aes = await subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
      const plain = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonce }, aes, body.slice(21 + idlen)));
      assert.equal(plain.at(-1), 2, "the last record ends with the delimiter 0x02");
      return new TextDecoder().decode(plain.slice(0, -1));
    },
  };
}

test("the encryption matches RFC 8291, Appendix A, byte for byte", async () => {
  const sender = await fixedEphemeral(
    bytes("DGv6ra1nlYgDCS1FRnbzlw"),
    bytes("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIg Dll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"),
    "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  );
  const body = await encryptPayload(
    bytes("V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24"),
    { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" },
    sender,
  );
  const header = bytes("DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z 9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml mlMoZIIgDll6e3vCYLocInmYWAmS6Tlz AC8wEqKK6PBru3jl7A8");
  const ciphertext = bytes("8pfeW0KbunFT06SuDKoJH9Ql87S1QUrd irN6GcG7sFz1y1sqLgVi1VhjVkHsUoEs bI_0LpXMuGvnzQ");
  assert.deepEqual(body, new Uint8Array([...header, ...ciphertext]));
});

test("a fresh message decrypts on the browser's side, and the VAPID token verifies with the public key", async () => {
  const browser = await newBrowser();
  const body = await encryptPayload(new TextEncoder().encode('{"title":"t"}'), browser.keys);
  assert.equal(await browser.decrypt(body), '{"title":"t"}');

  const keys = await makePushKeys("mailto:ops@example.com", new Date("2026-09-30T12:00:00Z"));
  const header = await vapidHeader("https://fcm.googleapis.com/fcm/send/abc", keys, new Date("2026-09-30T12:00:00Z"));
  const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(\S+)$/u.exec(header);
  assert.ok(match !== null, header);
  const [, head = "", claims = "", signature = "", key = ""] = match;
  assert.equal(key, keys.public);
  assert.deepEqual(JSON.parse(Buffer.from(claims, "base64url").toString()), { aud: "https://fcm.googleapis.com", exp: Date.parse("2026-09-30T12:00:00Z") / 1000 + 43_200, sub: "mailto:ops@example.com" });
  const verifier = await subtle.importKey("raw", bytes(keys.public), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert.ok(await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifier, bytes(signature), new TextEncoder().encode(`${head}.${claims}`)));
});

test("a subscription must be a known https push service with real keys; the same one twice is one line", async () => {
  const browser = await newBrowser();
  const good = { endpoint: "https://web.push.apple.com/QGuQyavXutnMPl", keys: browser.keys };
  assert.equal(subscriptionProblem(good), undefined);
  assert.match(subscriptionProblem({ ...good, endpoint: "http://web.push.apple.com/x" }) ?? "", /must be https/u);
  assert.match(subscriptionProblem({ ...good, endpoint: "https://evil.example.com/x" }) ?? "", /not a known push service/u);
  assert.match(subscriptionProblem({ ...good, keys: { ...browser.keys, auth: "AAAA" } }) ?? "", /16 bytes/u);
  assert.match(subscriptionProblem({ ...good, keys: { ...browser.keys, p256dh: "AAAA" } }) ?? "", /P-256/u);
  const global = openProject(GLOBAL_PROJECT, { create: true });
  assert.deepEqual(subscribe(global, good, "ops on phone"), { ok: true });
  assert.deepEqual(subscribe(global, good, "ops on phone"), { ok: true });
  assert.equal(readLedger(global).filter((line) => line.type === "push.subscribed").length, 1);
  assert.equal(activeDevices(readLedger(global)).length, 1);
  appendLine(global, { who: "t", type: "push.unsubscribed", endpoint: good.endpoint });
  assert.equal(activeDevices(readLedger(global)).length, 0);
});

function headers(fields: Record<string, string>): Headers {
  return new Headers(fields);
}

test("the endpoints: key for anyone let in, writes only from the page itself, as JSON, small", async () => {
  assert.equal(isSameOrigin(headers({ origin: "http://host-a:4747", host: "host-a:4747" }), undefined), true);
  assert.equal(isSameOrigin(headers({ origin: "https://host-a:4747", host: "host-a:4747" }), undefined), true, "a TLS proxy in front");
  assert.equal(isSameOrigin(headers({ origin: "https://darius.example.com", host: "127.0.0.1:4747" }), "https://darius.example.com/"), true);
  assert.equal(isSameOrigin(headers({ origin: "https://evil.example.com", host: "host-a:4747" }), "https://darius.example.com"), false);
  assert.equal(isSameOrigin(headers({ host: "host-a:4747" }), undefined), false, "no Origin, no write");

  const browser = await newBrowser();
  const body = JSON.stringify({ endpoint: "https://fcm.googleapis.com/fcm/send/dev1", expirationTime: null, keys: browser.keys });
  const post = (extra: Record<string, string>, text = body) =>
    pushApi({ method: "POST", path: "/api/push/subscribe", headers: headers({ host: "host-a:4747", "content-type": "application/json", ...extra }), body: text }, "ops on phone");
  assert.equal(post({ origin: "https://evil.example.com" }).status, 403);
  assert.equal(post({ origin: "http://host-a:4747", "content-type": "text/plain" }).status, 415);
  assert.equal(post({ origin: "http://host-a:4747" }, "x".repeat(5000)).status, 413);
  assert.deepEqual(post({ origin: "http://host-a:4747" }), { status: 200, body: { ok: true } });
  assert.equal(pushApi({ method: "GET", path: "/api/push/subscribe", headers: headers({}), body: "" }, "x").status, 405);
  assert.deepEqual(pushApi({ method: "GET", path: "/api/push/key", headers: headers({}), body: "" }, "x"), { status: 200, body: { key: null } });
  const off = pushApi(
    { method: "POST", path: "/api/push/unsubscribe", headers: headers({ host: "host-a:4747", origin: "http://host-a:4747", "content-type": "application/json" }), body: JSON.stringify({ endpoint: "https://fcm.googleapis.com/fcm/send/dev1" }) },
    "x",
  );
  assert.deepEqual(off, { status: 200, body: { ok: true } });
});

// --- a fake push service ---------------------------------------------------------------

interface FakeService {
  /** Decrypted payloads, in order. */
  received: Array<{ title: string; body: string; url: string; tag: string }>;
  /** The HTTP status the next sends get. */
  status: number;
  authorization: string[];
}

const service: FakeService = { received: [], status: 201, authorization: [] };
const browsers = new Map<string, Browser>();

async function readAll(request: IncomingMessage): Promise<Bytes> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return new Uint8Array(Buffer.concat(chunks));
}

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  void (async () => {
    const body = await readAll(request);
    service.authorization.push(String(request.headers.authorization));
    const browser = browsers.get(request.url ?? "");
    if (service.status === 201 && browser !== undefined) {
      assert.equal(request.headers["content-encoding"], "aes128gcm");
      service.received.push(JSON.parse(await browser.decrypt(body)));
    }
    response.writeHead(service.status);
    response.end();
  })();
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
// SAFETY: a server listening on a TCP port reports an AddressInfo, never a pipe name or null.
const origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
process.env.DARIUS_PUSH_ORIGINS = origin;
test.after(() => server.close());

async function device(path: string): Promise<void> {
  const browser = await newBrowser();
  browsers.set(path, browser);
  subscribe(openProject(GLOBAL_PROJECT, { create: true }), { endpoint: `${origin}${path}`, keys: browser.keys }, "ops on phone");
}

let keys: PushKeys;

/** Runs `darius push` in process and returns what it printed. */
async function runPush(argv: string[]): Promise<string> {
  const args: ParsedArgs = parseArgs(argv);
  const out: string[] = [];
  const { log } = console;
  console.log = (...parts: string[]) => out.push(parts.join(" "));
  try {
    await pushCommand.run(args);
  } finally {
    console.log = log;
  }
  return out.join("\n");
}

test("push keys needs a contact, writes 0600, and status never shows the private key", async () => {
  await assert.rejects(runPush(["keys"]), /needs --subject/u);
  await runPush(["keys", "--subject", "mailto:ops@example.com"]);
  assert.equal(statSync(pushKeysFile()).mode & 0o777, 0o600);
  assert.match(await runPush(["keys", "--subject", "mailto:ops@example.com"]), /exists\. New keys end every subscription/u);
  const made = await makePushKeys("mailto:ops@example.com", new Date("2026-01-01T00:00:00Z"));
  writePushKeys(made);
  keys = made;
  const status = await runPush(["status", "--json"]);
  assert.equal(status.includes(made.private), false);
  assert.equal(JSON.parse(status).public, made.public);
});

test("alerts go to every device once; a gone device is dropped; a failed notice goes again with its text, at most MAX_TRIES", async () => {
  service.received = [];
  service.status = 201;
  await device("/dev-a");
  await device("/dev-b");
  const project = openProject("push-flush", { create: true });
  appendLine(project, { who: "claude:1", type: "run.held", item: "ritual/heartbeat", run: "R1", questions: ["may I push?"] });
  const summary = { status: "attention", questions: 1, open: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }, fixed: 0 };
  const result = putBlob(project, `${JSON.stringify({ v: 1, status: "attention", summary: "s", metrics: [], items: [], questions: [{ text: "Delete the card?", recommendation: "Yes." }], actions: [] })}\n`);
  appendLine(project, { who: "claude:2", type: "run.completed", item: "ritual/heartbeat", run: "R2", outcome: "complete", result_sha: result, result: summary });

  assert.equal((await flushAlerts({ projects: ["push-flush"] }))?.sent, 2);
  assert.equal(service.received.length, 4, "two alerts to two devices");
  assert.deepEqual(service.received[0], { title: "heartbeat waits for you", body: "push-flush: the run is held.\n1. may I push?", url: "/p/push-flush/runs/R1", tag: service.received[0]?.tag });
  assert.match(service.received[2]?.body ?? "", /1\. Delete the card\? \(recommended: Yes\.\)/u);
  assert.equal(service.received[2]?.tag, "asks:R2");
  assert.match(service.authorization[0] ?? "", new RegExp(`^vapid t=\\S+, k=${keys.public}$`, "u"));
  assert.equal((await flushAlerts({ projects: ["push-flush"] }))?.sent, 0, "once");

  service.status = 410;
  appendLine(project, { who: "timer", type: "run.completed", item: "ritual/heartbeat", run: "R3", outcome: "failed" });
  await flushAlerts({ projects: ["push-flush"] });
  assert.equal(activeDevices(readLedger(openProject(GLOBAL_PROJECT))).length, 0, "410: both devices are gone");

  await device("/dev-c");
  service.status = 500;
  const skip = skipAlerts({ project: "push-flush", syncBefore: "ok", syncAfter: "ok", rituals: [{ slug: "a", action: "skipped", reason: "gate-broken", detail: "exit 127: HOME=/x" }] }, { date: "2026-09-30", host: "host-a" });
  assert.equal(skip[0]?.body.includes("HOME"), false, "no stderr in an alert");
  await sendAlerts(project, skip);
  for (let attempt = 0; attempt < MAX_TRIES + 1; attempt += 1) await flushAlerts({ projects: ["push-flush"] });
  const failed = readLedger(project).filter((line) => line.type === "alert.failed" && line.key === skip[0]?.key);
  assert.equal(failed.length, MAX_TRIES);
  assert.match(String(failed[0]?.error), /answered 500/u);

  service.status = 201;
  const again = skipAlerts({ project: "push-flush", syncBefore: "ok", syncAfter: "ok", rituals: [{ slug: "b", action: "skipped", reason: "tool-missing", detail: "pnpm not on PATH" }] }, { date: "2026-09-30", host: "host-a" });
  service.status = 500;
  await sendAlerts(project, again);
  service.status = 201;
  service.received = [];
  await flushAlerts({ projects: ["push-flush"] });
  assert.deepEqual(service.received.map((notice) => notice.title), ["b did not start: tool-missing"], "the stored notice goes again");
});

test("without keys or without a device, nothing is sent and nothing piles up", async () => {
  const global = openProject(GLOBAL_PROJECT);
  for (const found of activeDevices(readLedger(global))) appendLine(global, { who: "t", type: "push.unsubscribed", endpoint: found.endpoint });
  assert.equal(await flushAlerts(), null);
  const project = openProject("push-quiet", { create: true });
  appendLine(project, { who: "timer", type: "run.completed", item: "ritual/heartbeat", run: "Q1", outcome: "failed" });
  assert.equal(await sendAlerts(project, []), null);
  assert.equal(readLedger(project).some((line) => line.type.startsWith("alert.")), false);
});
