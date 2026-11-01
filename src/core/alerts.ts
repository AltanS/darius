/**
 * Alerts (docs/concept.md, "Alerts"). darius tells the operator on their
 * phone, by Web Push (src/core/push.ts), when something needs them: a held
 * run, a complete run whose result asks questions, a failed run, a gate
 * check that did not pass, and a ritual that could not start for a reason
 * that means something is broken (src/cli/run-due.ts sends those from its
 * batch report).
 *
 * THE ORIGIN HOST SENDS. Every alert comes from a ledger line or a batch
 * report, and each has exactly one host: the one that wrote the line or ran
 * the batch. Only that host sends, so two hosts never send the same alert,
 * with no lease and no wait for a sync. It records `alert.sent{key,
 * devices}` in the project ledger, and a later flush skips a key already
 * sent. When no device took it, it records `alert.failed{key, error, title,
 * body, url}`, and the next flush sends that notice again, at most
 * MAX_TRIES times in all.
 *
 * The one alert no host wrote is a host that stopped backing up. A stale
 * host leaves no line, so one host must watch: the host with the smallest
 * host id among the hosts whose newest `_global` line is under 36 hours old
 * (`watcherHost`). Every host computes that from the same synced ledger, so
 * at most one sends, with no lease. It sends `snapshot-stale:<host>:<UTC
 * date>`, once a day per stale host; `alert.sent` in `_global` dedupes it
 * after a sync. When the watcher changes, the new one may repeat one notice
 * that day, which is accepted. A host in state `silent` or `off` gets none.
 *
 * FLARES (src/core/flare-index.ts). A ledger line that opens or raises
 * flares gives one notice per channel, not one per flare: a run result may
 * hold a hundred. The key is `line:<line id>:<channel>`, and the notice names
 * one flare or counts several. Only the host that wrote the line sends, as
 * above. The channels come from the line (`flare.lit` `deliver`) or, for a
 * run, from the ritual's `flare_deliver`, read from the store when the alert
 * is built; the default is push. Each channel has its own readiness check
 * (`CHANNELS`), so a channel does not depend on push keys. A flare notice on
 * a channel that is not set up on this host would be lost with no trace, so
 * it writes `alert.failed` with the reason "not set up on host". That counts
 * toward MAX_TRIES, so the trace repeats at most MAX_TRIES times. A line older
 * than the `since` of its channel is history and sends nothing. Email
 * (src/core/email.ts) has its own text, with less in it, and a bad `email.json`
 * counts as not set up with the reason added, so it cannot stop the flush.
 *
 * WHEN. `flushAlerts` runs after every run-due batch, `run now` and `run
 * resume`, and after `darius sync` (the sync timer, every 15 minutes), which
 * catches the lines a session writes by hand. A host without push keys sends
 * nothing on push. Lines from before the keys were made, or from before the
 * first device subscribed, are history, not news. `darius flare light` flushes
 * its own project.
 */

import { existsSync } from "node:fs";

import { errorMessage } from "../runtime.ts";
import { classifyBackups, STALE_AFTER_MS, SNAPSHOT_FAILED, type BackupState } from "./backup-state.ts";
import { readEmailSettings, sendEmail, type EmailSettings } from "./email.ts";
import { appendLine, hostId, readLedger, type LedgerLineInput } from "./ledger.ts";
import { FLARE_LIT, flareOpenings, type FlareOpened, type FlareOpening } from "./flare-index.ts";
import type { JsonValue, LedgerLine, Ritual } from "./model.ts";
import { projectDir } from "./paths.ts";
import { activeDevices, broadcast, readPushKeys, type Notice } from "./push.ts";
import { parseResult, readSummary } from "./result.ts";
import { getBlobText, GLOBAL_PROJECT, listProjects, openProject, type Project } from "./store.ts";

/** A notice that failed this many times is not sent again. */
export const MAX_TRIES = 3;
const WHO = "darius:alerts";

/** The ways a notice can reach the operator. */
export type ChannelName = "push" | "email";

/** In the order the passes run. */
export const CHANNELS: readonly ChannelName[] = ["push", "email"];

/** The channels of a flare that names none. */
const DEFAULT_DELIVER: readonly ChannelName[] = ["push"];

/** Why a flare notice was not sent on a channel this host has not set up. */
export const NOT_SET_UP = "not set up on host";

/** One notice to send, with the key that keeps it from going out twice. */
export interface Alert extends Notice {
  key: string;
  /** The channel it goes on. Absent means push. Every flare notice names it. */
  channel?: ChannelName;
}

function channelOf(alert: Alert): ChannelName {
  return alert.channel ?? "push";
}

function channelNamed(value: JsonValue | undefined): ChannelName | undefined {
  return CHANNELS.find((channel) => channel === value);
}

/** The known channels of a stored list, each once; a name this darius does not know is left out. */
function knownChannels(list: JsonValue | undefined): ChannelName[] | undefined {
  if (!Array.isArray(list)) return undefined;
  return CHANNELS.filter((channel) => list.includes(channel));
}

function flareKey(lineId: string, channel: ChannelName): string {
  return `line:${lineId}:${channel}`;
}

/** True for the key of a flare notice, `line:<id>:<channel>`. No other alert key has that shape. */
function isFlareKey(key: string): boolean {
  return /^line:[^:]+:(push|email)$/u.test(key);
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
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

function runPath(project: string, run: string): string {
  return `/w/${encodeURIComponent(project)}/runs/${encodeURIComponent(run)}`;
}

function heldAlert(project: string, line: LedgerLine, run: string): Alert {
  const questions = Array.isArray(line.questions) ? line.questions.filter((entry) => isText(entry)) : [];
  return {
    key: `line:${line.id}`,
    tag: `line:${line.id}`,
    title: `${slugOf(line.item)} waits for you`,
    body: [`${project}: the run is held.`, ...questions.map((question, index) => `${String(index + 1)}. ${oneLine(question)}`)].join("\n"),
    url: runPath(project, run),
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

function completedAlert(project: Project, line: LedgerLine, run: string): Alert | null {
  const slug = slugOf(line.item);
  const url = runPath(project.name, run);
  if (line.outcome === "failed" || line.outcome === "abandoned") {
    const what = line.outcome === "failed" ? "failed" : "was abandoned";
    return { key: `line:${line.id}`, tag: `line:${line.id}`, title: `${slug} ${what}`, body: `${project.name}: the run ${what}.`, url };
  }
  const count = readSummary(line.result)?.questions ?? 0;
  if (count === 0) return null;
  // One key per run: when a decider escalates the same questions later, it uses this key and cannot send them twice.
  return {
    key: `asks:${run}`,
    tag: `asks:${run}`,
    title: `${slug} asks you ${String(count)} question${count === 1 ? "" : "s"}`,
    body: [`${project.name}:`, ...resultQuestions(project, line)].join("\n"),
    url,
  };
}

function checkAlert(line: LedgerLine): Alert | null {
  const { harness, version, outcome } = line;
  if (!isText(harness) || !isText(version) || !isText(outcome) || outcome === "passed") return null;
  const detail = isText(line.detail) ? ` ${oneLine(line.detail)}.` : "";
  return {
    key: `line:${line.id}`,
    tag: `line:${line.id}`,
    title: `Gate check ${outcome} on ${line.host}`,
    body: `${harness} ${version}:${detail} Runs with ${harness} wait on this host. Check again: darius harness check ${harness}`,
    url: "/",
  };
}

function failedBackupAlert(line: LedgerLine): Alert {
  const key = `snapshot-failed:${line.host}:${line.id}`;
  const error = isText(line.error) ? oneLine(line.error) : "no reason given";
  return { key, tag: key, title: `Backup failed on ${line.host}`, body: error, url: "/status" };
}

/**
 * The host that raises the stale-backup alert: the smallest host id among the
 * hosts whose newest line in `lines` (the `_global` ledger, any type) is at
 * most 36 hours old at `now`. Null when no host is that recent. Pure.
 */
export function watcherHost(lines: readonly LedgerLine[], now: number): string | null {
  const active = new Set<string>();
  for (const line of lines) {
    if (now - Date.parse(line.at) <= STALE_AFTER_MS) active.add(line.host);
  }
  return [...active].toSorted()[0] ?? null;
}

function staleAlert(state: BackupState, now: number): Alert {
  const key = `snapshot-stale:${state.host}:${new Date(now).toISOString().slice(0, 10)}`;
  // The hours count from the line the host is judged on: its last upload when it has a bucket.
  const since = (state.needs_upload ? state.last_upload_at : state.last_ok_at) ?? state.last_at;
  const hours = Math.floor((now - Date.parse(since)) / 3_600_000);
  const reason = state.reason === null ? "" : `${state.reason[0]?.toUpperCase() ?? ""}${state.reason.slice(1)}. `;
  const last = state.last_ok_at === null ? "It never made a good backup." : `Last good backup: ${state.last_ok_at}.`;
  return {
    key,
    tag: key,
    title: `No backup from ${state.host} for ${String(hours)} hours`,
    body: `${reason}${last} Look: darius snapshot status --hosts`,
    url: "/status",
  };
}

/** The stale-host alerts this host must send at `now`: none unless it is the watcher. */
function staleAlerts(ledger: readonly LedgerLine[], host: string, now: number): Alert[] {
  if (watcherHost(ledger, now) !== host) return [];
  return classifyBackups(ledger, now)
    .filter((state) => state.state === "stale")
    .map((state) => staleAlert(state, now));
}

/**
 * The alerts in a project's ledger that this host must send: its own lines
 * since `since`, and in `_global` the stale-backup notices when this host is
 * the watcher (`now` is the clock for those).
 */
export function ledgerAlerts(project: Project, ledger: readonly LedgerLine[], since: string, host: string, now: number = Date.now()): Alert[] {
  const alerts: Alert[] = [];
  for (const line of ledger) {
    if (line.host !== host || line.at < since) continue;
    const run = isText(line.run) ? line.run : undefined;
    let alert: Alert | null = null;
    if (line.type === "run.held" && run !== undefined) alert = heldAlert(project.name, line, run);
    else if (line.type === "run.completed" && run !== undefined) alert = completedAlert(project, line, run);
    else if (line.type === "harness.checked" && project.name === GLOBAL_PROJECT) alert = checkAlert(line);
    else if (line.type === SNAPSHOT_FAILED && project.name === GLOBAL_PROJECT) alert = failedBackupAlert(line);
    if (alert !== null) alerts.push(alert);
  }
  if (project.name === GLOBAL_PROJECT) alerts.push(...staleAlerts(ledger, host, now));
  return alerts;
}

// --- flare notices ------------------------------------------------------------------

/** Most flares a notice lists by name; the rest is a count. */
const FLARE_LIST_MAX = 3;

function flarePath(project: string, key?: string): string {
  const base = `/w/${encodeURIComponent(project)}/flares`;
  return key === undefined ? base : `${base}/${encodeURIComponent(key)}`;
}

function oneFlareNotice(project: string, flare: FlareOpened): Pick<Alert, "title" | "body" | "url"> {
  const what = flare.kind === "raised" ? `Flare raised to ${flare.severity}` : `Flare lit, ${flare.severity}`;
  const where = flare.target === undefined ? "needs you." : oneLine(flare.target);
  return { title: `${what}: ${oneLine(flare.title)}`, body: `${project}: ${where}`, url: flarePath(project, flare.key) };
}

function manyFlaresNotice(project: string, flares: readonly FlareOpened[]): Pick<Alert, "title" | "body" | "url"> {
  const named = flares.slice(0, FLARE_LIST_MAX).map((flare, index) => `${String(index + 1)}. ${flare.severity}: ${oneLine(flare.title)}`);
  const more = flares.length > FLARE_LIST_MAX ? [`and ${String(flares.length - FLARE_LIST_MAX)} more`] : [];
  const ritual = flares[0]?.ritual ?? project;
  return { title: `${String(flares.length)} flares in ${ritual}`, body: [`${project}:`, ...named, ...more].join("\n"), url: flarePath(project) };
}

/** An email: a third party stores it, so it carries the least. src/core/email.ts adds the link and redacts each line. */
function oneFlareEmail(project: string, flare: FlareOpened): Pick<Alert, "title" | "body" | "url"> {
  const severity = flare.kind === "raised" ? `${flare.severity}, raised` : flare.severity;
  const target = flare.target === undefined ? [] : [`Target: ${oneLine(flare.target)}`];
  return { title: `flare: ${oneLine(flare.title)}`, body: [`Severity: ${severity}`, `Project: ${project}`, ...target].join("\n"), url: flarePath(project, flare.key) };
}

function manyFlaresEmail(project: string, flares: readonly FlareOpened[]): Pick<Alert, "title" | "body" | "url"> {
  const named = flares.slice(0, FLARE_LIST_MAX).map((flare, index) => {
    const target = flare.target === undefined ? "" : `, ${oneLine(flare.target)}`;
    return `${String(index + 1)}. ${flare.severity}: ${oneLine(flare.title)}${target}`;
  });
  const more = flares.length > FLARE_LIST_MAX ? [`and ${String(flares.length - FLARE_LIST_MAX)} more`] : [];
  const ritual = flares[0]?.ritual ?? project;
  return { title: `${String(flares.length)} flares in ${ritual}`, body: [`Project: ${project}`, ...named, ...more].join("\n"), url: flarePath(project) };
}

/** How a channel words a notice. */
interface FlareWording {
  one: typeof oneFlareNotice;
  many: typeof manyFlaresNotice;
}

const FLARE_WORDING = {
  push: { one: oneFlareNotice, many: manyFlaresNotice },
  email: { one: oneFlareEmail, many: manyFlaresEmail },
} satisfies Record<ChannelName, FlareWording>;

/** The notice of one line for one channel: short plain text, with no flare body and no detail. */
function flareNotice(project: string, opening: FlareOpening, channel: ChannelName): Alert {
  const key = flareKey(opening.line.id, channel);
  const [only] = opening.flares;
  const { one, many } = FLARE_WORDING[channel];
  const text = opening.flares.length === 1 && only !== undefined ? one(project, only) : many(project, opening.flares);
  return { key, tag: key, channel, ...text };
}

/** The channels a line delivers on: the `deliver` of a `flare.lit` line, else the ritual's `flare_deliver`, else push. */
function flareChannels(project: Project, opening: FlareOpening): readonly ChannelName[] {
  const { line } = opening;
  if (line.type === FLARE_LIT) return knownChannels(line.deliver) ?? DEFAULT_DELIVER;
  const slug = opening.flares[0]?.ritual;
  if (slug === undefined) return DEFAULT_DELIVER;
  try {
    return knownChannels(project.readItem<Ritual>("ritual", slug)?.header.flare_deliver) ?? DEFAULT_DELIVER;
  } catch {
    // One unreadable ritual item must not stop the flush of every other alert. The default still tells the operator.
    return DEFAULT_DELIVER;
  }
}

export interface FlareAlertOptions {
  /** This host: only the lines it wrote send. */
  host: string;
  /** Per channel, the earliest time that counts. Absent: the channel is not set up here, so every line counts and gets its trace. */
  since: Readonly<Record<ChannelName, string | undefined>>;
}

/**
 * The flare notices this host must send from `ledger`: for each line that
 * this host wrote and that opened or raised flares, one notice per channel it
 * delivers on. The walk reads the whole ledger, so state from other hosts'
 * lines counts, but another host's line sends nothing here.
 */
export function flareAlerts(project: Project, ledger: readonly LedgerLine[], options: FlareAlertOptions): Alert[] {
  if (project.name === GLOBAL_PROJECT) return [];
  const mine = ledger.some((line) => line.host === options.host && (line.type === FLARE_LIT || line.type === "run.completed"));
  if (!mine) return [];
  const alerts: Alert[] = [];
  for (const opening of flareOpenings(project, ledger)) {
    if (opening.line.host !== options.host) continue;
    for (const channel of flareChannels(project, opening)) {
      const since = options.since[channel];
      if (since !== undefined && opening.line.at < since) continue;
      alerts.push(flareNotice(project.name, opening, channel));
    }
  }
  return alerts;
}

// --- sending ------------------------------------------------------------------------

export interface Delivery {
  sent: number;
  /** Why notices reached no device. */
  failed: string[];
  /** In a dry run: what would go out. */
  pending: Alert[];
}

function emptyDelivery(): Delivery {
  return { sent: 0, failed: [], pending: [] };
}

/** Which keys went out, how often each failed, the notice each failed with, and when it last failed. */
interface SendState {
  sent: Set<string>;
  tries: Map<string, number>;
  retries: Map<string, Alert>;
  lastFailed: Map<string, string>;
}

/** The send state of every key, from the ledger. */
function sendState(ledger: readonly LedgerLine[]): SendState {
  const state: SendState = { sent: new Set(), tries: new Map(), retries: new Map(), lastFailed: new Map() };
  for (const line of ledger) {
    const { key } = line;
    if (!isText(key)) continue;
    if (line.type === "alert.sent") state.sent.add(key);
    else if (line.type === "alert.failed") {
      state.tries.set(key, (state.tries.get(key) ?? 0) + 1);
      state.lastFailed.set(key, line.at);
      // A line written before channels were named is a push line. A channel this darius does not know is not ours to retry.
      const channel = line.channel === undefined ? "push" : channelNamed(line.channel);
      if (channel !== undefined && isText(line.title) && isText(line.body) && isText(line.url)) {
        state.retries.set(key, { key, tag: key, channel, title: line.title, body: line.body, url: line.url });
      }
    }
  }
  return state;
}

/** How a channel took one notice: to how many recipients, and if none, why. */
interface Outcome {
  delivered: number;
  error: string;
}

/** A channel this host can send on. */
interface OpenChannel {
  /** The earliest time that counts as news on this channel. */
  since: string;
  send(alert: Alert): Promise<Outcome>;
}

/** Null when this host has no keys or no device subscribed yet: then nothing is sent, and nothing piles up. */
function openPush(): OpenChannel | null {
  const keys = readPushKeys();
  if (keys === null || !existsSync(projectDir(GLOBAL_PROJECT))) return null;
  const global = openProject(GLOBAL_PROJECT);
  const devices = activeDevices(readLedger(global));
  if (devices.length === 0) return null;
  const firstDevice = devices.map((device) => device.at).toSorted()[0] ?? keys.since;
  return {
    since: firstDevice > keys.since ? firstDevice : keys.since,
    async send(alert) {
      const result = await broadcast(global, keys, alert);
      return { delivered: result.sent, error: result.errors.join("; ") || "no device took it" };
    },
  };
}

function emailChannel(settings: EmailSettings): OpenChannel {
  return {
    since: settings.since,
    async send(alert) {
      await sendEmail(settings, alert);
      return { delivered: settings.to.length, error: "" };
    },
  };
}

/** The email channel, and what a flare notice records while it is closed. */
interface EmailOpening {
  channel: OpenChannel | null;
  reason: string;
}

/** A bad file is a reason and not a throw, so the other alerts still go. The reason quotes no value. */
function openEmail(): EmailOpening {
  try {
    const settings = readEmailSettings();
    return { channel: settings === null ? null : emailChannel(settings), reason: NOT_SET_UP };
  } catch (cause) {
    return { channel: null, reason: `${NOT_SET_UP}: ${errorMessage(cause)}` };
  }
}

/** Each channel as this host has it: open, or null when it is not set up here. */
interface Channels {
  push: OpenChannel | null;
  email: OpenChannel | null;
  /** What a flare notice records on a closed channel. */
  closedReason: Readonly<Record<ChannelName, string>>;
}

/** Opens every channel once. */
function openChannels(): Channels {
  const email = openEmail();
  return { push: openPush(), email: email.channel, closedReason: { push: NOT_SET_UP, email: email.reason } };
}

/** A notice that failed before email was set up is history: its line is older than `since`, and setup must not send it. */
function isHistoryOnEmail(retry: Alert, state: SendState, email: OpenChannel | null): boolean {
  if (email === null || channelOf(retry) !== "email") return false;
  return (state.lastFailed.get(retry.key) ?? "") < email.since;
}

/** What a failed notice leaves in the ledger: enough to send it again. */
function failedLine(alert: Alert, error: string): LedgerLineInput {
  return { who: WHO, type: "alert.failed", key: alert.key, channel: channelOf(alert), error, title: alert.title, body: alert.body, url: alert.url };
}

async function sendOn(channel: OpenChannel, alert: Alert): Promise<Outcome> {
  try {
    return await channel.send(alert);
  } catch (cause) {
    return { delivered: 0, error: errorMessage(cause) };
  }
}

/**
 * Sends each alert not sent yet on its channel to every recipient, and
 * records the outcome in the project ledger. Alerts that failed before go
 * again with their stored notice and channel, even when nothing rebuilds them
 * (a skip). One pass per channel, each with its own readiness check. A flare
 * notice on a channel this host has not set up writes `alert.failed` with the
 * reason "not set up on host" (counted in MAX_TRIES); any other alert on such
 * a channel stays silent. A dry run sends and records nothing. Null when this
 * host sends nothing, records nothing and has no flare notice to trace.
 */
export async function sendAlerts(project: Project, alerts: readonly Alert[], options: { isDryRun?: boolean } = {}): Promise<Delivery | null> {
  const channels = openChannels();
  const state = sendState(readLedger(project));
  const retries = [...state.retries.values()].filter((retry) => !alerts.some((alert) => alert.key === retry.key) && !isHistoryOnEmail(retry, state, channels.email));
  const queue = [...alerts, ...retries];
  if (channels.push === null && !queue.some((alert) => isFlareKey(alert.key))) return null;
  const delivery = emptyDelivery();
  for (const name of CHANNELS) {
    const channel = channels[name];
    for (const alert of queue) {
      if (channelOf(alert) !== name || state.sent.has(alert.key) || (state.tries.get(alert.key) ?? 0) >= MAX_TRIES) continue;
      if (options.isDryRun === true) {
        if (channel !== null) delivery.pending.push(alert);
        continue;
      }
      if (channel === null && !isFlareKey(alert.key)) continue;
      const outcome: Outcome = channel === null ? { delivered: 0, error: channels.closedReason[name] } : await sendOn(channel, alert);
      if (outcome.delivered > 0) {
        appendLine(project, { who: WHO, type: "alert.sent", key: alert.key, channel: name, devices: outcome.delivered });
        state.sent.add(alert.key);
        delivery.sent += 1;
        continue;
      }
      appendLine(project, failedLine(alert, outcome.error));
      state.tries.set(alert.key, (state.tries.get(alert.key) ?? 0) + 1);
      delivery.failed.push(`${alert.key}: ${outcome.error}`);
    }
  }
  return delivery;
}

/** Sends what the ledgers of this host hold and nobody was told yet. Null when this host cannot send on push and has no flare notice to trace. */
export async function flushAlerts(options: { isDryRun?: boolean; projects?: readonly string[]; now?: number } = {}): Promise<Delivery | null> {
  const channels = openChannels();
  const since = { push: channels.push?.since, email: channels.email?.since };
  const host = hostId();
  const total = emptyDelivery();
  let isActive = channels.push !== null;
  // `_global` holds the gate checks; listProjects leaves it out. Without push keys it has nothing to send.
  const names = options.projects ?? [...listProjects(), GLOBAL_PROJECT];
  for (const name of names) {
    if (name === GLOBAL_PROJECT && channels.push === null) continue;
    const project = openProject(name);
    const ledger = readLedger(project);
    const news = channels.push === null ? [] : ledgerAlerts(project, ledger, channels.push.since, host, options.now);
    const delivery = await sendAlerts(project, [...news, ...flareAlerts(project, ledger, { host, since })], options);
    if (delivery === null) continue;
    isActive = true;
    total.sent += delivery.sent;
    total.failed.push(...delivery.failed);
    total.pending.push(...delivery.pending);
  }
  return isActive ? total : null;
}
