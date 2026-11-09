/**
 * The email channel of candle notices (docs/concept.md, "Candles") and of run
 * reports (src/core/report-email.ts, 0.127.0). One POST of
 * JSON over `fetch` to an HTTP mail API, so no runtime dependency and no SMTP.
 *
 * SETTINGS. Per host, in `<config>/email.json`, read here and nowhere else:
 * `url`, `token`, `from`, `to[]`, `web_url?`, `since`, `html?`. The file is refused when
 * its group or others have any access, as src/core/credentials.ts does, and it
 * is written with mode 0600 from the first byte. The config dir is never
 * synced and never archived (src/core/store-scan.ts).
 *
 * NO VALUE LEAVES. The token and the addresses never reach the store, the
 * ledger, a log, stdout or an error. So no message in this file quotes a value
 * of the settings or of the input, and it does not quote the JSON parser either,
 * because that quotes the text. A message names the file by its base name: it
 * can end up in a synced ledger line, and a full path holds a user name.
 *
 * A PROVIDER'S ANSWER IS NEVER READ. A 4xx or a 5xx gives the status alone,
 * because a provider may echo the request in its body. A failed fetch keeps its
 * own text for the diagnosis, after `scrubEmailError`. An error thrown here
 * carries no `cause`, so the raw text cannot come back through a stack print.
 */

import { createHash, randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "../runtime.ts";
import { isLoopbackOrTailnet } from "./config.ts";
import { GROUP_OTHER_BITS, isMaskedFile } from "./credentials.ts";
import type { JsonValue } from "./model.ts";
import { configDir } from "./paths.ts";
import { endpointHost, scrubForLedger } from "./redact.ts";

const FILE_NAME = "email.json";
/** A hung provider must not hold the sweep or the sync. */
const TIMEOUT_MS = 15_000;
const KNOWN_KEYS: readonly string[] = ["url", "token", "from", "to", "web_url", "since", "html"];
/** One word of printable ASCII: anything else cannot go in a header, and `fetch` would quote it in its error. */
const PRINTABLE_WORD = /^[!-~]+$/u;
const BARE_ADDRESS = /^[^\s@<>]+@[^\s@<>]+$/u;
const NAMED_ADDRESS = /^[^<>\r\n]*<[^\s@<>]+@[^\s@<>]+>$/u;
/** Anything in an error that reads as an address, also URL-encoded and in another case than the settings have it. */
const ADDRESS_IN_TEXT = /[^\s@<>"',;:()[\]{}]+(?:@|%40)[^\s@<>"',;:()[\]{}]+/giu;

export interface EmailSettings {
  url: string;
  token: string;
  from: string;
  to: string[];
  /** The address of the web app. With it, a notice carries a link. */
  web_url?: string;
  /** Lines before this time are history, so setup does not email old candles. */
  since: string;
  /**
   * `false` (0.127.0): a report mail goes as text only, with no `html` field,
   * for a provider that refuses a field it does not know. Absent: true.
   */
  html?: boolean;
}

/** What may be said about the channel: no token, no address, no path of the url. */
export interface EmailStatus {
  isSetUp: boolean;
  /** The host name of the url. */
  host: string | null;
  recipients: number;
  since: string | null;
  /** Whether a report mail carries `html` (0.127.0). Null when the channel is not set up. */
  html: boolean | null;
  /** Why the file is refused, in words that quote no value. Null when it is absent or good. */
  problem: string | null;
}

/** One candle notice to send. `key` makes the send idempotent; `url` is a path of the web app. */
export interface EmailNotice {
  key: string;
  title: string;
  body: string;
  url: string;
}

/**
 * One mail as it goes out: what `postEmail` sends after `from` and `to`. The
 * caller has already scrubbed it. `key` makes the send idempotent; `html` goes
 * only when the settings allow it.
 */
export interface EmailMessage {
  key: string;
  subject: string;
  text: string;
  html?: string;
}

/** The JSON a provider gets, in this key order. */
interface MailBody {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
}

export function emailSettingsFile(): string {
  return join(configDir(), FILE_NAME);
}

// --- checking ---------------------------------------------------------------------------

function isRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isAddress(value: JsonValue): boolean {
  return isText(value) && (BARE_ADDRESS.test(value) || NAMED_ADDRESS.test(value));
}

function parseJson(text: string, where: string): JsonValue {
  try {
    return JSON.parse(text);
  } catch {
    // The parser's own message quotes the text, and the text holds the token.
    throw new Error(`${where} is not valid JSON`);
  }
}

/**
 * The URL of a setting. Refused with a user, a password or a query: a secret
 * goes in the token, and `scrubForLedger` cuts a path but not a query.
 */
function plainUrl(value: JsonValue | undefined, name: string, where: string): URL {
  let url: URL;
  try {
    url = new URL(isText(value) ? value : "");
  } catch {
    throw new Error(`${where}: ${name} must be a URL`);
  }
  if (url.username !== "" || url.password !== "") throw new Error(`${where}: ${name} must not hold a user or a password; the token goes in token`);
  if (url.search !== "" || url.hash !== "") throw new Error(`${where}: ${name} must not hold a query or a fragment`);
  return url;
}

function checkProviderUrl(value: JsonValue | undefined, where: string): void {
  const url = plainUrl(value, "url", where);
  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && isLoopbackOrTailnet(url.hostname)) return;
  throw new Error(`${where}: url must be https, or http on loopback or the tailnet`);
}

function checkWebUrl(value: JsonValue | undefined, where: string): void {
  const url = plainUrl(value, "web_url", where);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${where}: web_url must be http or https`);
}

/** Every string of a list that passed the check. */
function textsOf(list: readonly JsonValue[]): string[] {
  return list.filter((entry) => isText(entry));
}

/** The settings from parsed JSON, or an error that names a field and never its value. */
function checkedSettings(raw: JsonValue, where: string): EmailSettings {
  if (!isRecord(raw)) throw new Error(`${where} must be a JSON object`);
  if (Object.keys(raw).some((key) => !KNOWN_KEYS.includes(key))) throw new Error(`${where} has an unknown key; it takes only ${KNOWN_KEYS.join(", ")}`);
  const { url, token, from, to, web_url: webUrl, since, html } = raw;
  checkProviderUrl(url, where);
  if (!isText(url)) throw new Error(`${where}: url must be a URL`);
  if (!isText(token) || !PRINTABLE_WORD.test(token)) throw new Error(`${where}: token must be one word of printable characters`);
  if (!isText(from) || !isAddress(from)) throw new Error(`${where}: from must be an email address`);
  if (!Array.isArray(to) || to.length === 0) throw new Error(`${where}: to must be a list of at least one address`);
  const badEntry = to.findIndex((entry) => !isAddress(entry));
  if (badEntry !== -1) throw new Error(`${where}: to[${String(badEntry)}] must be an email address`);
  if (!isText(since) || Number.isNaN(Date.parse(since))) throw new Error(`${where}: since must be a date and time`);
  if (html !== undefined && html !== true && html !== false) throw new Error(`${where}: html must be true or false`);
  const settings: EmailSettings = { url, token, from, to: textsOf(to), since: new Date(since).toISOString() };
  if (html !== undefined) settings.html = html;
  if (webUrl === undefined) return settings;
  checkWebUrl(webUrl, where);
  if (!isText(webUrl)) throw new Error(`${where}: web_url must be a URL`);
  return { ...settings, web_url: webUrl };
}

// --- reading and writing ----------------------------------------------------------------

/** The text of the file, after the mode check. No error here holds a path. */
function readOwnerOnly(file: string): string {
  if (isMaskedFile(file)) throw new Error(`the sandbox mask hides ${FILE_NAME} from an unattended run`);
  let mode: number;
  try {
    mode = statSync(file).mode & 0o777;
  } catch {
    throw new Error(`${FILE_NAME} cannot be read`);
  }
  if ((mode & GROUP_OTHER_BITS) !== 0) {
    throw new Error(`${FILE_NAME} must be readable by its owner only (mode 0600 or 0400), found ${mode.toString(8).padStart(4, "0")}. Run chmod 600 on it`);
  }
  try {
    return readFileSync(file, "utf8");
  } catch {
    throw new Error(`${FILE_NAME} cannot be read`);
  }
}

/**
 * The settings of this host; null without the file. A file that its group or
 * others can read, or that is broken, is an error that quotes no value.
 */
export function readEmailSettings(): EmailSettings | null {
  const file = emailSettingsFile();
  if (!existsSync(file)) return null;
  return checkedSettings(parseJson(readOwnerOnly(file), FILE_NAME), FILE_NAME);
}

/** The settings in `text`, what `darius email set --stdin` got. `since` becomes `now` when absent. */
export function parseEmailInput(text: string, now: Date = new Date()): EmailSettings {
  const where = "the input";
  const raw = parseJson(text, where);
  if (!isRecord(raw)) throw new Error(`${where} must be a JSON object`);
  return checkedSettings(raw.since === undefined ? { ...raw, since: now.toISOString() } : raw, where);
}

/**
 * Writes the file with mode 0600 from the first byte. A new file made with
 * O_EXCL and that mode takes the name by rename, so the bytes never sit in a
 * file with a wider mode, even when the old file has one.
 */
export function writeEmailSettings(settings: EmailSettings): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  const file = emailSettingsFile();
  const temp = `${file}.${String(process.pid)}.${randomBytes(4).toString("hex")}.tmp`;
  const handle = openSync(temp, "wx", 0o600);
  try {
    writeFileSync(handle, `${JSON.stringify(settings, null, 2)}\n`);
    closeSync(handle);
    renameSync(temp, file);
  } catch (cause) {
    rmSync(temp, { force: true });
    throw cause;
  }
}

/** The state of the channel on this host, for the CLI and the web app. Holds no secret. Never throws. */
export function emailStatus(): EmailStatus {
  try {
    const settings = readEmailSettings();
    if (settings === null) return { isSetUp: false, host: null, recipients: 0, since: null, html: null, problem: null };
    return { isSetUp: true, host: endpointHost(settings.url), recipients: settings.to.length, since: settings.since, html: settings.html !== false, problem: null };
  } catch (cause) {
    return { isSetUp: false, host: null, recipients: 0, since: null, html: null, problem: errorMessage(cause) };
  }
}

// --- sending ----------------------------------------------------------------------------

/**
 * An error, ready for a ledger line: no token, no address, and the url cut to
 * its host name. It is one line of bounded length.
 */
export function scrubEmailError(text: string, settings: EmailSettings): string {
  let out = text;
  for (const token of [settings.token, encodeURIComponent(settings.token)]) out = out.replaceAll(token, "[token]");
  for (const address of [settings.from, ...settings.to]) out = out.replaceAll(address, "[address]");
  return scrubForLedger(out.replaceAll(ADDRESS_IN_TEXT, "[address]"), [settings.url]);
}

/** A failed fetch: Node says only "fetch failed" and keeps the reason in `cause`. */
function failureText(cause: unknown): string {
  const first = errorMessage(cause);
  return cause instanceof Error && cause.cause !== undefined ? `${first}: ${errorMessage(cause.cause)}` : first;
}

/** The address of a web app path on this host's `web_url`, or undefined without one. */
export function webLink(settings: EmailSettings, path: string): string | undefined {
  return settings.web_url === undefined ? undefined : `${settings.web_url.replace(/\/+$/u, "")}${path}`;
}

/** A candle notice as a mail. Title and every body line pass the redaction, and the link comes from this host's settings. */
function messageOf(settings: EmailSettings, notice: EmailNotice): EmailMessage {
  const hide = [settings.url];
  const lines = notice.body.split("\n").map((line) => scrubForLedger(line, hide));
  const link = webLink(settings, notice.url);
  return { key: notice.key, subject: scrubForLedger(notice.title, hide), text: [...lines, ...(link === undefined ? [] : [`Link: ${link}`])].join("\n") };
}

/**
 * The JSON body: the same bytes for the same message and settings, so a retry
 * with the same key sends the same body. `html` only when the settings allow it.
 */
export function emailBody(settings: EmailSettings, message: EmailMessage): string {
  const body: MailBody = { from: settings.from, to: settings.to, subject: message.subject, text: message.text };
  if (message.html !== undefined && settings.html !== false) body.html = message.html;
  return JSON.stringify(body);
}

/** Sends one candle notice. See `postEmail`. */
export async function sendEmail(settings: EmailSettings, notice: EmailNotice, options: { timeoutMs?: number } = {}): Promise<void> {
  await postEmail(settings, messageOf(settings, notice), options);
}

/**
 * Sends one mail. A 2xx is success. Anything else throws an error that passed
 * `scrubEmailError`. A redirect is a failure: it would carry the body with the
 * addresses to a place nobody chose.
 */
export async function postEmail(settings: EmailSettings, message: EmailMessage, options: { timeoutMs?: number } = {}): Promise<void> {
  const host = endpointHost(settings.url);
  let response: Response | undefined;
  let failure = "";
  try {
    response = await fetch(settings.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${settings.token}`,
        "content-type": "application/json",
        "idempotency-key": createHash("sha256").update(message.key).digest("hex"),
      },
      body: emailBody(settings, message),
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (cause) {
    failure = failureText(cause);
  }
  if (response === undefined) throw new Error(scrubEmailError(`${host} did not answer: ${failure}`, settings));
  // Released unread, so an open connection cannot hold the process.
  await response.body?.cancel().catch(() => undefined);
  if (!response.ok) throw new Error(scrubEmailError(`${host} answered ${String(response.status)}`, settings));
}
