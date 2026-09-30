/**
 * Web Push (docs/concept.md, "Alerts"): darius sends a notification to the
 * phones that installed the web app and turned notifications on. No
 * dependency: the payload encryption (RFC 8291, aes128gcm) and the VAPID
 * signature (RFC 8292, ES256) use WebCrypto, which Bun and Node both have,
 * as the S3 signing uses node:crypto.
 *
 * KEYS. One VAPID key pair for every host that sends, in
 * `<config>/push.json` (0600): a subscription is bound to the public key it
 * was made with, so both hosts need the same pair. `darius push keys`
 * makes it on one host; copy the file to the other. Never in the store,
 * never printed.
 *
 * SUBSCRIPTIONS. The web app posts the browser's subscription (src/cli/
 * serve.ts), and darius records it as `push.subscribed{endpoint, p256dh,
 * auth, viewer}` in the `_global` ledger, so every host that syncs knows
 * every device. `push.unsubscribed` and `push.gone` (the push service
 * answered 404 or 410) end one. Its keys only let a sender encrypt for the
 * device; the push service accepts a message only with a VAPID signature
 * of the private key. An endpoint must be https on a known push service, so
 * a caller cannot make darius post to any URL it likes.
 */

import { webcrypto } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "../runtime.ts";
import { appendLine, readLedger } from "./ledger.ts";
import type { JsonValue, LedgerLine } from "./model.ts";
import { configDir } from "./paths.ts";
import type { Project } from "./store.ts";

const { subtle } = webcrypto;

/** How long a push service keeps a message for a phone that is offline. */
const TTL_SECONDS = 24 * 60 * 60;
/** The JWT may live up to 24 hours (RFC 8292); darius signs one per send. */
const JWT_SECONDS = 12 * 60 * 60;
const RECORD_SIZE = 4096;
const TIMEOUT_MS = 15_000;
const WHO = "darius:push";

/** Hosts of the push services that browsers use. An endpoint elsewhere is refused. */
const PUSH_SERVICES: readonly string[] = [".push.apple.com", ".googleapis.com", ".push.services.mozilla.com", ".notify.windows.com"];

export interface PushKeys {
  v: 1;
  /** The VAPID contact: a `mailto:` or `https:` URL (RFC 8292). */
  subject: string;
  /** The public key, uncompressed P-256 point, base64url: the browser's `applicationServerKey`. */
  public: string;
  /** The private scalar, base64url. */
  private: string;
  /** When the keys were made: alerts from before are history. */
  since: string;
}

/** A browser subscription, as `PushSubscription.toJSON()` gives it. */
export interface PushSubscriptionJson {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}

/** An active subscription, as the `_global` ledger has it. */
export interface Device {
  endpoint: string;
  p256dh: string;
  auth: string;
  viewer: string;
  at: string;
}

export type PushResult = { ok: true } | { ok: false; error: string };

// --- bytes --------------------------------------------------------------------------

/** Bytes over a plain ArrayBuffer, what WebCrypto takes. */
type Bytes = Uint8Array<ArrayBuffer>;

function b64url(bytes: Bytes): string {
  return Buffer.from(bytes).toString("base64url");
}

function unb64url(text: string): Bytes {
  return new Uint8Array(Buffer.from(text, "base64url"));
}

function concat(...parts: readonly Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const text = new TextEncoder();

// --- keys ---------------------------------------------------------------------------

export function pushKeysFile(): string {
  return join(configDir(), "push.json");
}

function isRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

/** The keys of this host; null without the file. A broken file is an error that never quotes it. */
export function readPushKeys(): PushKeys | null {
  const file = pushKeysFile();
  if (!existsSync(file)) return null;
  let raw: JsonValue;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(`${file} is not valid JSON; copy it again from the host that made the keys`);
  }
  if (!isRecord(raw) || raw.v !== 1 || !isText(raw.subject) || !isText(raw.public) || !isText(raw.private) || !isText(raw.since)) {
    throw new Error(`${file} needs v 1, subject, public, private and since`);
  }
  return { v: 1, subject: raw.subject, public: raw.public, private: raw.private, since: raw.since };
}

export function writePushKeys(keys: PushKeys): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  const file = pushKeysFile();
  writeFileSync(file, `${JSON.stringify(keys, null, 2)}\n`, { mode: 0o600 });
  // writeFileSync keeps the mode of a file that already exists.
  chmodSync(file, 0o600);
}

/** A new VAPID key pair. */
export async function makePushKeys(subject: string, now: Date = new Date()): Promise<PushKeys> {
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await subtle.exportKey("jwk", pair.privateKey);
  const publicRaw = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
  if (jwk.d === undefined) throw new Error("the new key has no private part");
  return { v: 1, subject, public: b64url(publicRaw), private: jwk.d, since: now.toISOString() };
}

/** The JWK of a P-256 key from its raw public point and, for a private key, its scalar. */
function p256Jwk(publicRaw: Bytes, d?: string): webcrypto.JsonWebKey {
  const jwk: webcrypto.JsonWebKey = { kty: "EC", crv: "P-256", x: b64url(publicRaw.slice(1, 33)), y: b64url(publicRaw.slice(33, 65)), ext: true };
  if (d !== undefined) jwk.d = d;
  return jwk;
}

// --- VAPID (RFC 8292) ---------------------------------------------------------------

/** The Authorization header for one send to `endpoint`. */
export async function vapidHeader(endpoint: string, keys: PushKeys, now: Date = new Date()): Promise<string> {
  const header = b64url(text.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = { aud: new URL(endpoint).origin, exp: Math.floor(now.getTime() / 1000) + JWT_SECONDS, sub: keys.subject };
  const body = b64url(text.encode(JSON.stringify(claims)));
  const key = await subtle.importKey("jwk", p256Jwk(unb64url(keys.public), keys.private), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  // WebCrypto signs ECDSA as r || s, which is exactly the JWS form of ES256.
  const signature = new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, text.encode(`${header}.${body}`)));
  return `vapid t=${header}.${body}.${b64url(signature)}, k=${keys.public}`;
}

// --- encryption (RFC 8291) ----------------------------------------------------------

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

/** The sender's side of one message: a fresh ECDH key and salt, or fixed ones for the RFC's test vector. */
export interface Ephemeral {
  salt: Bytes;
  publicRaw: Bytes;
  privateKey: webcrypto.CryptoKey;
}

async function freshEphemeral(): Promise<Ephemeral> {
  const pair = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicRaw = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
  return { salt: webcrypto.getRandomValues(new Uint8Array(16)), publicRaw, privateKey: pair.privateKey };
}

/** A fixed sender key from its raw public point and private scalar (tests). */
export async function fixedEphemeral(salt: Bytes, publicRaw: Bytes, d: string): Promise<Ephemeral> {
  const privateKey = await subtle.importKey("jwk", p256Jwk(publicRaw, d), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  return { salt, publicRaw, privateKey };
}

/** The aes128gcm body for `plaintext` to one subscription: header, then one record. */
export async function encryptPayload(plaintext: Bytes, keys: { p256dh: string; auth: string }, sender?: Ephemeral): Promise<Bytes> {
  const own = sender ?? (await freshEphemeral());
  const uaPublic = unb64url(keys.p256dh);
  const uaKey = await subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: uaKey }, own.privateKey, 256));
  const keyInfo = concat(text.encode("WebPush: info\u0000"), uaPublic, own.publicRaw);
  const ikm = await hkdf(unb64url(keys.auth), ecdh, keyInfo, 32);
  const cek = await hkdf(own.salt, ikm, text.encode("Content-Encoding: aes128gcm\u0000"), 16);
  const nonce = await hkdf(own.salt, ikm, text.encode("Content-Encoding: nonce\u0000"), 12);
  const aes = await subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // 0x02: the delimiter of the last (here the only) record, no padding.
  const sealed = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(own.salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = own.publicRaw.length;
  return concat(header, own.publicRaw, sealed);
}

// --- subscriptions ------------------------------------------------------------------

/** Push service origins a test adds, comma-separated (never set outside tests). */
function extraOrigins(): string[] {
  const raw = process.env.DARIUS_PUSH_ORIGINS ?? "";
  return raw.split(",").map((origin) => origin.trim()).filter((origin) => origin !== "");
}

/** Why `endpoint` is refused, or undefined when it is a known push service. */
function endpointProblem(endpoint: string): string | undefined {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return "the endpoint is not a URL";
  }
  if (extraOrigins().includes(url.origin)) return undefined;
  if (url.protocol !== "https:") return "the endpoint must be https";
  if (!PUSH_SERVICES.some((suffix) => url.hostname.endsWith(suffix))) return `${url.hostname} is not a known push service`;
  return undefined;
}

/** Why a posted subscription is refused, or undefined. */
export function subscriptionProblem(value: JsonValue): string | undefined {
  if (!isRecord(value) || !isText(value.endpoint) || !isRecord(value.keys)) return "a subscription needs endpoint and keys";
  const { p256dh, auth } = value.keys;
  if (!isText(p256dh) || !isText(auth)) return "keys needs p256dh and auth";
  const point = unb64url(p256dh);
  if (point.length !== 65 || point[0] !== 4) return "keys.p256dh is not an uncompressed P-256 key";
  if (unb64url(auth).length !== 16) return "keys.auth must be 16 bytes";
  if (value.endpoint.length > 1024) return "the endpoint is too long";
  return endpointProblem(value.endpoint);
}

/** The active devices, from `push.*` lines in ledger order. */
export function activeDevices(ledger: readonly LedgerLine[]): Device[] {
  const devices = new Map<string, Device>();
  for (const line of ledger) {
    if (!isText(line.endpoint)) continue;
    if (line.type === "push.subscribed" && isText(line.p256dh) && isText(line.auth)) {
      devices.set(line.endpoint, { endpoint: line.endpoint, p256dh: line.p256dh, auth: line.auth, viewer: isText(line.viewer) ? line.viewer : "?", at: line.at });
    } else if (line.type === "push.unsubscribed" || line.type === "push.gone") {
      devices.delete(line.endpoint);
    }
  }
  return [...devices.values()];
}

/** Records a subscription the web app posted; the same one again writes nothing. */
export function subscribe(global: Project, value: JsonValue, viewer: string): PushResult {
  const problem = subscriptionProblem(value);
  if (problem !== undefined || !isRecord(value) || !isText(value.endpoint) || !isRecord(value.keys)) return { ok: false, error: problem ?? "not a subscription" };
  const { endpoint } = value;
  const { p256dh, auth } = value.keys;
  if (!isText(p256dh) || !isText(auth)) return { ok: false, error: "keys needs p256dh and auth" };
  const known = activeDevices(readLedger(global)).find((device) => device.endpoint === endpoint);
  if (known?.p256dh === p256dh && known.auth === auth) return { ok: true };
  appendLine(global, { who: WHO, type: "push.subscribed", endpoint, p256dh, auth, viewer });
  return { ok: true };
}

export function unsubscribe(global: Project, endpoint: string): PushResult {
  if (!activeDevices(readLedger(global)).some((device) => device.endpoint === endpoint)) return { ok: true };
  appendLine(global, { who: WHO, type: "push.unsubscribed", endpoint });
  return { ok: true };
}

// --- sending ------------------------------------------------------------------------

/** What the service worker gets: it shows `title` and `body`, and a tap opens `url`, a path of the web app. */
export interface Notice {
  title: string;
  body: string;
  url: string;
  /** Same tag, same notification: a newer one replaces it on the phone. */
  tag: string;
}

/** A push service keeps up to 4096 bytes; the header and the tag take about 100. */
const MAX_BODY = 1500;

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** `sent`, `gone` (the device unsubscribed; drop it), or why it failed. */
export type SendOutcome = { sent: true } | { gone: true } | { error: string };

/** Sends one notice to one device. Never throws. */
export async function sendNotice(keys: PushKeys, device: Device, notice: Notice): Promise<SendOutcome> {
  const problem = endpointProblem(device.endpoint);
  if (problem !== undefined) return { error: problem };
  try {
    // Exactly the four fields the service worker reads, whatever else `notice` carries.
    const payload = text.encode(JSON.stringify({ title: clip(notice.title, 120), body: clip(notice.body, MAX_BODY), url: notice.url, tag: notice.tag }));
    const body = await encryptPayload(payload, device);
    const response = await fetch(device.endpoint, {
      method: "POST",
      headers: {
        authorization: await vapidHeader(device.endpoint, keys),
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: String(TTL_SECONDS),
        urgency: "high",
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 404 || response.status === 410) return { gone: true };
    if (!response.ok) return { error: `${new URL(device.endpoint).hostname} answered ${String(response.status)}` };
    return { sent: true };
  } catch (cause) {
    return { error: `${new URL(device.endpoint).hostname} did not answer: ${errorMessage(cause)}` };
  }
}

/** How one notice went to every device. */
export interface Broadcast {
  sent: number;
  gone: number;
  errors: string[];
}

/** Sends `notice` to every active device, and ends the ones the push service says are gone. */
export async function broadcast(global: Project, keys: PushKeys, notice: Notice): Promise<Broadcast> {
  const result: Broadcast = { sent: 0, gone: 0, errors: [] };
  for (const device of activeDevices(readLedger(global))) {
    const outcome = await sendNotice(keys, device, notice);
    if ("sent" in outcome) result.sent += 1;
    else if ("gone" in outcome) {
      result.gone += 1;
      appendLine(global, { who: WHO, type: "push.gone", endpoint: device.endpoint });
    } else result.errors.push(outcome.error);
  }
  return result;
}
