/**
 * Alert channels (docs/concept.md, "Alerts (0.29.0)"). darius tells the
 * operator by Telegram when something needs them: a held run, a complete run
 * whose result asks questions, a failed run, a gate check that did not pass,
 * and a ritual that could not start for a reason that means something is
 * broken (src/cli/run-due.ts sends those from its batch report).
 *
 * THE ORIGIN HOST SENDS. Every alert comes from a ledger line or a batch
 * report, and each has exactly one host: the one that wrote the line or ran
 * the batch. Only that host sends, so two hosts never send the same alert,
 * with no lease and no wait for a sync. It records `alert.sent{key,
 * channel}` in the project ledger, and a later flush skips a key already
 * sent. A failed send records `alert.failed`, and the next flush tries it
 * again, at most MAX_TRIES times in all.
 *
 * SECRETS. The bot token lives in `<config>/alerts.json` (0600) on each host
 * that sends, never in the store: the store syncs to the bucket. Nothing
 * prints it; an error text has the token cut out.
 *
 * WHEN. `flushAlerts` runs after every run-due batch, `run now` and `run
 * resume`, and after `darius sync` (the sync timer, every 15 minutes), which
 * catches the lines a session writes by hand. Lines older than `since`, the
 * time of the first setup on this host, are history, not news.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "../runtime.ts";
import { appendLine, hostId, readLedger, type LedgerLineInput } from "./ledger.ts";
import type { JsonValue, LedgerLine } from "./model.ts";
import { configDir, projectDir } from "./paths.ts";
import { parseResult, readSummary } from "./result.ts";
import { getBlobText, GLOBAL_PROJECT, listProjects, openProject, type Project } from "./store.ts";

/** A send that failed this many times is not tried again. */
export const MAX_TRIES = 3;
/** Telegram refuses longer messages (4096); darius stays well under. */
const MAX_TEXT = 3500;
const TIMEOUT_MS = 15_000;
const WHO = "darius:alerts";

export interface TelegramChannel {
  token: string;
  /** The chat the bot writes to; a string, since a group id is negative and large. */
  chat_id: string;
}

export interface AlertConfig {
  v: 1;
  /** Lines before this time are history: the first setup on this host. */
  since: string;
  /** For example `http://host-a:4747`: the web app, for a link to the run. */
  link_base?: string;
  telegram?: TelegramChannel;
}

/** One message to send, with the key that keeps it from going out twice. */
export interface Alert {
  key: string;
  text: string;
}

// --- config -------------------------------------------------------------------------

export function alertsFile(): string {
  return join(configDir(), "alerts.json");
}

function isRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isNumber(value: JsonValue | undefined): value is number {
  return typeof value === "number";
}

/** The alert config of this host; null without the file. A broken file is an error that never quotes the file. */
export function readAlertConfig(): AlertConfig | null {
  const file = alertsFile();
  if (!existsSync(file)) return null;
  let raw: JsonValue;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(`${file} is not valid JSON; run darius alert setup telegram again`);
  }
  if (!isRecord(raw) || raw.v !== 1 || !isText(raw.since)) throw new Error(`${file} has no v 1 and since; run darius alert setup telegram again`);
  const config: AlertConfig = { v: 1, since: raw.since };
  if (isText(raw.link_base) && raw.link_base !== "") config.link_base = raw.link_base.replace(/\/+$/u, "");
  const { telegram } = raw;
  if (telegram !== undefined && telegram !== null) {
    if (!isRecord(telegram) || !isText(telegram.token) || !isText(telegram.chat_id)) {
      throw new Error(`${file}: telegram needs token and chat_id; run darius alert setup telegram again`);
    }
    config.telegram = { token: telegram.token, chat_id: telegram.chat_id };
  }
  return config;
}

/** Writes the config readable by this user only; the directory too. */
export function writeAlertConfig(config: AlertConfig): void {
  const dir = configDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = alertsFile();
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  // writeFileSync keeps the mode of a file that already exists.
  chmodSync(file, 0o600);
}

export function removeAlertConfig(): boolean {
  const file = alertsFile();
  if (!existsSync(file)) return false;
  rmSync(file);
  return true;
}

// --- telegram -----------------------------------------------------------------------

/** The Bot API base URL; tests point `DARIUS_TELEGRAM_API` at a fake. */
function telegramApi(): string {
  const override = process.env.DARIUS_TELEGRAM_API;
  return override === undefined || override === "" ? "https://api.telegram.org" : override.replace(/\/+$/u, "");
}

function scrub(text: string, token: string): string {
  return token === "" ? text : text.replaceAll(token, "<token>");
}

/** One Bot API call. Throws with a text that never holds the token. */
async function telegramCall(token: string, method: string, body: { readonly [key: string]: JsonValue }): Promise<JsonValue> {
  let response: Response | undefined;
  let unreached = "";
  try {
    response = await fetch(`${telegramApi()}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    unreached = errorMessage(cause);
  }
  // No `cause` on the error: a fetch error may carry the URL, and the URL holds the token.
  if (response === undefined) throw new Error(scrub(`telegram ${method} did not reach the API: ${unreached}`, token));
  const text = await response.text();
  let parsed: JsonValue = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON: the status says enough.
  }
  if (!response.ok || !isRecord(parsed) || parsed.ok !== true) {
    const why = isRecord(parsed) && isText(parsed.description) ? `: ${parsed.description}` : "";
    throw new Error(scrub(`telegram ${method} answered ${String(response.status)}${why}`, token));
  }
  return parsed.result ?? null;
}

/** Sends one plain-text message; returns its message id when Telegram gives one. */
export async function sendTelegram(channel: TelegramChannel, text: string): Promise<number | undefined> {
  const clipped = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
  const result = await telegramCall(channel.token, "sendMessage", { chat_id: channel.chat_id, text: clipped, disable_web_page_preview: true });
  return isRecord(result) && isNumber(result.message_id) ? result.message_id : undefined;
}

/** The chat of the newest message to the bot (the operator's /start), with a name to show; null when there is none. */
export async function findChat(token: string): Promise<{ id: string; name: string } | null> {
  const result = await telegramCall(token, "getUpdates", { timeout: 0 });
  if (!Array.isArray(result)) return null;
  for (const update of result.toReversed()) {
    const message = isRecord(update) ? update.message : undefined;
    const chat = isRecord(message) ? message.chat : undefined;
    if (!isRecord(chat) || (!isNumber(chat.id) && !isText(chat.id))) continue;
    const name = [chat.username, chat.first_name, chat.title].find((part) => isText(part) && part !== "");
    return { id: String(chat.id), name: isText(name) ? name : "unnamed chat" };
  }
  return null;
}

// --- what to say --------------------------------------------------------------------

function slugOf(item: string | undefined): string {
  if (item === undefined) return "a ritual";
  const slash = item.indexOf("/");
  return slash === -1 ? item : item.slice(slash + 1);
}

function oneLine(text: string): string {
  return text.replaceAll(/\s+/gu, " ").trim();
}

function runLink(config: AlertConfig, project: string, run: string): string[] {
  return config.link_base === undefined ? [] : [`${config.link_base}/p/${project}/runs/${run}`];
}

function heldAlert(config: AlertConfig, project: string, line: LedgerLine, run: string): Alert {
  const questions = Array.isArray(line.questions) ? line.questions.filter((entry) => isText(entry)) : [];
  return {
    key: `line:${line.id}`,
    text: [
      `darius · ${project}`,
      `${slugOf(line.item)} is held and waits for you:`,
      ...questions.map((question, index) => `${String(index + 1)}. ${oneLine(question)}`),
      `Answer: darius run answer ${run} 1 "your answer" --project ${project}, then darius run resume ${run} --project ${project}`,
      ...runLink(config, project, run),
    ].join("\n"),
  };
}

/** The questions of a complete run's result, read from its blob; empty when the blob is not on this host. */
function resultQuestions(project: Project, line: LedgerLine): string[] {
  const sha = line.result_sha;
  if (!isText(sha)) return [];
  const blob = getBlobText(project, sha);
  const parsed = blob === null ? null : parseResult(blob);
  if (parsed === null || !("result" in parsed)) return [];
  return parsed.result.questions.map((question, index) => {
    const recommended = question.recommendation === undefined ? "" : ` (recommended: ${oneLine(question.recommendation)})`;
    return `${String(index + 1)}. ${oneLine(question.text)}${recommended}`;
  });
}

function completedAlert(config: AlertConfig, project: Project, line: LedgerLine, run: string): Alert | null {
  const slug = slugOf(line.item);
  const lines = [`darius · ${project.name}`];
  if (line.outcome === "failed" || line.outcome === "abandoned") {
    lines.push(`${slug}: the run ${line.outcome === "failed" ? "failed" : "was abandoned"}.`, `Look: darius run show ${run} --project ${project.name}`);
  } else {
    const count = readSummary(line.result)?.questions ?? 0;
    if (count === 0) return null;
    lines.push(
      `${slug} asks you ${String(count)} question${count === 1 ? "" : "s"}:`,
      ...resultQuestions(project, line),
      `Answer: darius run ack ${run} --note "your decision" --project ${project.name}`,
    );
  }
  // A question alert has one key per run: when a decider (0.30.0) escalates the same questions, it uses this key and cannot send them twice.
  const key = line.outcome === "complete" ? `asks:${run}` : `line:${line.id}`;
  return { key, text: [...lines, ...runLink(config, project.name, run)].join("\n") };
}

function checkAlert(line: LedgerLine): Alert | null {
  const { harness, version, outcome } = line;
  if (!isText(harness) || !isText(version) || !isText(outcome) || outcome === "passed") return null;
  const detail = isText(line.detail) ? `: ${oneLine(line.detail)}` : "";
  return {
    key: `line:${line.id}`,
    text: [
      `darius · ${line.host}`,
      `The gate check of ${harness} ${version} was ${outcome}${detail}.`,
      `Runs with ${harness} wait on this host. Check again: darius harness check ${harness}`,
    ].join("\n"),
  };
}

/** The alerts in a project's ledger that this host must send: its own lines since `config.since`. */
export function ledgerAlerts(project: Project, ledger: readonly LedgerLine[], config: AlertConfig, host: string): Alert[] {
  const alerts: Alert[] = [];
  for (const line of ledger) {
    if (line.host !== host || line.at < config.since) continue;
    const run = isText(line.run) ? line.run : undefined;
    let alert: Alert | null = null;
    if (line.type === "run.held" && run !== undefined) alert = heldAlert(config, project.name, line, run);
    else if (line.type === "run.completed" && run !== undefined) alert = completedAlert(config, project, line, run);
    else if (line.type === "harness.checked" && project.name === GLOBAL_PROJECT) alert = checkAlert(line);
    if (alert !== null) alerts.push(alert);
  }
  return alerts;
}

// --- sending ------------------------------------------------------------------------

export interface Delivery {
  sent: number;
  /** Why sends failed, token cut out. */
  failed: string[];
  /** In a dry run: what would go out. */
  pending: Alert[];
}

function emptyDelivery(): Delivery {
  return { sent: 0, failed: [], pending: [] };
}

/** Which keys went out, how often each failed, and the text each failed with. */
interface SendState {
  sent: Set<string>;
  tries: Map<string, number>;
  texts: Map<string, string>;
}

/** The send state of every key, from the ledger. */
function sendState(ledger: readonly LedgerLine[]): SendState {
  const sent = new Set<string>();
  const tries = new Map<string, number>();
  const texts = new Map<string, string>();
  for (const line of ledger) {
    if (!isText(line.key)) continue;
    if (line.type === "alert.sent") sent.add(line.key);
    else if (line.type === "alert.failed") {
      tries.set(line.key, (tries.get(line.key) ?? 0) + 1);
      if (isText(line.text)) texts.set(line.key, line.text);
    }
  }
  return { sent, tries, texts };
}

/**
 * Sends each alert not sent yet, and records the outcome in the project
 * ledger. A dry run sends and records nothing.
 */
export async function sendAlerts(project: Project, alerts: readonly Alert[], config: AlertConfig, options: { isDryRun?: boolean } = {}): Promise<Delivery> {
  const delivery = emptyDelivery();
  const channel = config.telegram;
  if (channel === undefined) return delivery;
  const state = sendState(readLedger(project));
  // A send that failed goes again with the text it failed with, even when nothing rebuilds it (a skip).
  const retries = [...state.texts].filter(([key]) => !alerts.some((alert) => alert.key === key)).map(([key, text]) => ({ key, text }));
  for (const alert of [...alerts, ...retries]) {
    if (state.sent.has(alert.key) || (state.tries.get(alert.key) ?? 0) >= MAX_TRIES) continue;
    if (options.isDryRun === true) {
      delivery.pending.push(alert);
      continue;
    }
    try {
      const messageId = await sendTelegram(channel, alert.text);
      const line: LedgerLineInput = { who: WHO, type: "alert.sent", key: alert.key, channel: "telegram" };
      if (messageId !== undefined) line.message_id = messageId;
      appendLine(project, line);
      state.sent.add(alert.key);
      delivery.sent += 1;
    } catch (cause) {
      const error = scrub(errorMessage(cause), channel.token);
      appendLine(project, { who: WHO, type: "alert.failed", key: alert.key, channel: "telegram", error, text: alert.text });
      delivery.failed.push(error);
    }
  }
  return delivery;
}

/**
 * Sends what the ledgers of this host hold and nobody was told yet. Null
 * when this host has no Telegram channel: then there is nothing to do.
 */
export async function flushAlerts(options: { isDryRun?: boolean; projects?: readonly string[] } = {}): Promise<Delivery | null> {
  const config = readAlertConfig();
  if (config?.telegram === undefined) return null;
  const host = hostId();
  const total = emptyDelivery();
  // `_global` holds the gate checks; listProjects leaves it out.
  const names = options.projects ?? [...listProjects(), ...(existsSync(projectDir(GLOBAL_PROJECT)) ? [GLOBAL_PROJECT] : [])];
  for (const name of names) {
    const project = openProject(name);
    const alerts = ledgerAlerts(project, readLedger(project), config, host);
    const delivery = await sendAlerts(project, alerts, config, options);
    total.sent += delivery.sent;
    total.failed.push(...delivery.failed);
    total.pending.push(...delivery.pending);
  }
  return total;
}
