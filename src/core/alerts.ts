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
 * CANDLES (src/core/candle-index.ts). A ledger line that opens or raises
 * candles gives one notice per channel, not one per candle: a run result may
 * hold a hundred. The key is `line:<line id>:<channel>`, and the notice names
 * one candle or counts several. Only the host that wrote the line sends, as
 * above. The channels come from the line (`candle.lit` `deliver`) or, for a
 * run, from the ritual's `candle_deliver`, read from the store when the alert
 * is built; the default is push. Each channel has its own readiness check
 * (`CHANNELS`), so a channel does not depend on push keys. A candle notice on
 * a channel that is not set up on this host would be lost with no trace, so
 * it writes `alert.failed` with the reason "not set up on host". That line is a
 * trace and not a try: it does not count toward MAX_TRIES, and it is written
 * once per key and reason, not once per flush. A line older than the `since`
 * of its channel is history and sends nothing, and nothing replays it later.
 * A notice that waited for a repair goes out only if a candle of its opening is
 * still lit; if all are answered, accepted or out, it is dropped with no
 * line. Email (src/core/email.ts) has its own text, with less in it. A bad
 * `email.json` or `push.json` counts as not set up with the reason added, so
 * it cannot stop the flush.
 *
 * REPORTS (src/core/report-email.ts, 0.127.0). A `run.completed` line with
 * outcome complete, of a ritual whose store item has `report_deliver` with
 * `email`, gives one report mail with the key `report:<run>`. The ritual is
 * read when the alert is built, as for `candle_deliver`, so a run cannot ask
 * for its own report. Only the host that wrote the line sends, and only on
 * email. A line older than the channel's `since`, or than a day, sends
 * nothing: adding the key to a ritual does not mail its old runs. An imported
 * line sends nothing. The mail is built again from the blobs at each try, so
 * no ledger line holds its text: `alert.failed` for a report has the key, the
 * channel and the error only, and `sendState` cannot rebuild it. A host
 * without email sends no report and leaves no trace; `darius doctor` says so.
 *
 * WHEN. `flushAlerts` runs after every run-due batch, `run now` and `run
 * resume`, and after `darius sync` (the sync timer, every 15 minutes), which
 * catches the lines a session writes by hand. A host without push keys sends
 * nothing on push. Lines from before the keys were made, or from before the
 * first device subscribed, are history, not news. `darius candle light` flushes
 * its own project.
 */

import { existsSync } from "node:fs";

import { errorMessage } from "../runtime.ts";
import { classifyBackups, STALE_AFTER_MS, SNAPSHOT_FAILED, type BackupState } from "./backup-state.ts";
import { RUN_BOX_BLOCKED } from "./box-work.ts";
import { emailStatus, postEmail, readEmailSettings, sendEmail, type EmailMessage, type EmailSettings } from "./email.ts";
import { appendLine, hostId, readLedger, type LedgerLineInput } from "./ledger.ts";
import { collectCandles, CANDLE_LIT, candleOpenings, type CandleOpened, type CandleOpening } from "./candle-index.ts";
import type { JsonValue, LedgerLine, Ritual } from "./model.ts";
import { projectDir } from "./paths.ts";
import { activeDevices, broadcast, pushKeysProblem, readPushKeys, type Notice } from "./push.ts";
import { isReportKey, reportFacts, reportKey, reportMessage, REPORT_MISSING, runPagePath, REPORT_UNRENDERED, type ReportFacts } from "./report-email.ts";
import { parseResult, readSummary } from "./result.ts";
import { getBlobText, GLOBAL_PROJECT, listProjects, openProject, type Project } from "./store.ts";

/** A notice that failed this many times is not sent again. */
export const MAX_TRIES = 3;
const WHO = "darius:alerts";

/** The ways a notice can reach the operator. */
export type ChannelName = "push" | "email";

/** In the order the passes run. */
export const CHANNELS: readonly ChannelName[] = ["push", "email"];

/** The channels of a candle that names none. */
const DEFAULT_DELIVER: readonly ChannelName[] = ["push"];

/** Why a candle notice was not sent on a channel this host has not set up. */
export const NOT_SET_UP = "not set up on host";

/** One notice to send, with the key that keeps it from going out twice. */
export interface Alert extends Notice {
  key: string;
  /** The channel it goes on. Absent means push. Every candle notice names it. */
  channel?: ChannelName;
  /** A run report (0.127.0): the email channel builds the mail from these facts at each try. */
  report?: ReportFacts;
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

function candleKey(lineId: string, channel: ChannelName): string {
  return `line:${lineId}:${channel}`;
}

/** True for the key of a candle notice, `line:<id>:<channel>`. No other alert key has that shape. */
function isCandleKey(key: string): boolean {
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

const runPath = runPagePath;

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

/**
 * A boxed run left what the box could not settle in its work dir, so that
 * work dir is tainted on its host (src/core/box-taint.ts): every run there
 * skips as box-broken. The alert names no path: the host's box status does.
 */
function taintAlert(project: string, line: LedgerLine, run: string): Alert {
  const slug = slugOf(line.item);
  return {
    key: `line:${line.id}`,
    tag: `line:${line.id}`,
    title: `${slug} tainted its work dir on ${line.host}`,
    body: `${project}: the box could not settle what the run left in its work dir. Runs there skip as box-broken. Look: darius box status, on ${line.host}.`,
    url: runPath(project, run),
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
    else if (line.type === RUN_BOX_BLOCKED && line.unresolved === true && run !== undefined) alert = taintAlert(project.name, line, run);
    else if (line.type === "harness.checked" && project.name === GLOBAL_PROJECT) alert = checkAlert(line);
    else if (line.type === SNAPSHOT_FAILED && project.name === GLOBAL_PROJECT) alert = failedBackupAlert(line);
    if (alert !== null) alerts.push(alert);
  }
  if (project.name === GLOBAL_PROJECT) alerts.push(...staleAlerts(ledger, host, now));
  return alerts;
}

// --- candle notices ------------------------------------------------------------------

/** Most candles a notice lists by name; the rest is a count. */
const CANDLE_LIST_MAX = 3;

function candlePath(project: string, key?: string): string {
  const base = `/w/${encodeURIComponent(project)}/candles`;
  return key === undefined ? base : `${base}/${encodeURIComponent(key)}`;
}

function oneCandleNotice(project: string, candle: CandleOpened): Pick<Alert, "title" | "body" | "url"> {
  const what = candle.kind === "raised" ? `Candle raised to ${candle.severity}` : `Candle lit, ${candle.severity}`;
  const where = candle.target === undefined ? "needs you." : oneLine(candle.target);
  return { title: `${what}: ${oneLine(candle.title)}`, body: `${project}: ${where}`, url: candlePath(project, candle.key) };
}

function manyCandlesNotice(project: string, candles: readonly CandleOpened[]): Pick<Alert, "title" | "body" | "url"> {
  const named = candles.slice(0, CANDLE_LIST_MAX).map((candle, index) => `${String(index + 1)}. ${candle.severity}: ${oneLine(candle.title)}`);
  const more = candles.length > CANDLE_LIST_MAX ? [`and ${String(candles.length - CANDLE_LIST_MAX)} more`] : [];
  const ritual = candles[0]?.ritual ?? project;
  return { title: `${String(candles.length)} candles in ${ritual}`, body: [`${project}:`, ...named, ...more].join("\n"), url: candlePath(project) };
}

/** An email: a third party stores it, so it carries the least. src/core/email.ts adds the link and redacts each line. */
function oneCandleEmail(project: string, candle: CandleOpened): Pick<Alert, "title" | "body" | "url"> {
  const severity = candle.kind === "raised" ? `${candle.severity}, raised` : candle.severity;
  const target = candle.target === undefined ? [] : [`Target: ${oneLine(candle.target)}`];
  return { title: `candle: ${oneLine(candle.title)}`, body: [`Severity: ${severity}`, `Project: ${project}`, ...target].join("\n"), url: candlePath(project, candle.key) };
}

function manyCandlesEmail(project: string, candles: readonly CandleOpened[]): Pick<Alert, "title" | "body" | "url"> {
  const named = candles.slice(0, CANDLE_LIST_MAX).map((candle, index) => {
    const target = candle.target === undefined ? "" : `, ${oneLine(candle.target)}`;
    return `${String(index + 1)}. ${candle.severity}: ${oneLine(candle.title)}${target}`;
  });
  const more = candles.length > CANDLE_LIST_MAX ? [`and ${String(candles.length - CANDLE_LIST_MAX)} more`] : [];
  const ritual = candles[0]?.ritual ?? project;
  return { title: `${String(candles.length)} candles in ${ritual}`, body: [`Project: ${project}`, ...named, ...more].join("\n"), url: candlePath(project) };
}

/** How a channel words a notice. */
interface CandleWording {
  one: typeof oneCandleNotice;
  many: typeof manyCandlesNotice;
}

const CANDLE_WORDING = {
  push: { one: oneCandleNotice, many: manyCandlesNotice },
  email: { one: oneCandleEmail, many: manyCandlesEmail },
} satisfies Record<ChannelName, CandleWording>;

/** The notice of one line for one channel: short plain text, with no candle body and no detail. */
function candleNotice(project: string, opening: CandleOpening, channel: ChannelName): Alert {
  const key = candleKey(opening.line.id, channel);
  const [only] = opening.candles;
  const { one, many } = CANDLE_WORDING[channel];
  const text = opening.candles.length === 1 && only !== undefined ? one(project, only) : many(project, opening.candles);
  return { key, tag: key, channel, ...text };
}

/** The channels a line delivers on: the `deliver` of a `candle.lit` line, else the ritual's `candle_deliver`, else push. */
function candleChannels(project: Project, opening: CandleOpening): readonly ChannelName[] {
  const { line } = opening;
  if (line.type === CANDLE_LIT) return knownChannels(line.deliver) ?? DEFAULT_DELIVER;
  const slug = opening.candles[0]?.ritual;
  if (slug === undefined) return DEFAULT_DELIVER;
  try {
    return knownChannels(project.readItem<Ritual>("ritual", slug)?.header.candle_deliver) ?? DEFAULT_DELIVER;
  } catch {
    // One unreadable ritual item must not stop the flush of every other alert. The default still tells the operator.
    return DEFAULT_DELIVER;
  }
}

export interface CandleAlertOptions {
  /** This host: only the lines it wrote send. */
  host: string;
  /** Per channel, the earliest time that counts. Absent: the channel is not set up here, so every line counts and gets its trace. */
  since: Readonly<Record<ChannelName, string | undefined>>;
}

/**
 * The candle notices this host must send from `ledger`: for each line that
 * this host wrote and that opened or raised candles, one notice per channel it
 * delivers on. The walk reads the whole ledger, so state from other hosts'
 * lines counts, but another host's line sends nothing here.
 */
export function candleAlerts(project: Project, ledger: readonly LedgerLine[], options: CandleAlertOptions): Alert[] {
  if (project.name === GLOBAL_PROJECT) return [];
  const mine = ledger.some((line) => line.host === options.host && (line.type === CANDLE_LIT || line.type === "run.completed"));
  if (!mine) return [];
  const alerts: Alert[] = [];
  for (const opening of candleOpenings(project, ledger)) {
    if (opening.line.host !== options.host) continue;
    for (const channel of candleChannels(project, opening)) {
      const since = options.since[channel];
      if (since !== undefined && opening.line.at < since) continue;
      alerts.push(candleNotice(project.name, opening, channel));
    }
  }
  return alerts;
}

// --- run reports ---------------------------------------------------------------------

/** The ritual's title when its item asks for report mail; undefined when it does not, or cannot be read. */
function reportTitle(project: Project, slug: string, titles: Map<string, string | null>): string | undefined {
  if (!titles.has(slug)) {
    let title: string | null = null;
    try {
      const header = project.readItem<Ritual>("ritual", slug)?.header;
      if (header !== undefined && knownChannels(header.report_deliver)?.includes("email") === true) title = header.title;
    } catch {
      // One unreadable ritual item must not stop the flush. No report is the safe side.
      title = null;
    }
    titles.set(slug, title);
  }
  return titles.get(slug) ?? undefined;
}

/**
 * The report mails this host must send from `ledger`: one per `run.completed`
 * line it wrote at or after `floor`, with outcome complete, of a ritual whose
 * item asks for report mail on email. Not for an imported line.
 */
export function reportAlerts(project: Project, ledger: readonly LedgerLine[], options: { host: string; floor: string }): Alert[] {
  if (project.name === GLOBAL_PROJECT) return [];
  const titles = new Map<string, string | null>();
  const alerts: Alert[] = [];
  for (const line of ledger) {
    if (line.type !== "run.completed" || line.outcome !== "complete" || line.host !== options.host || line.at < options.floor) continue;
    if (line.imported_from !== undefined || !isText(line.run) || !isText(line.item) || !line.item.startsWith("ritual/")) continue;
    const title = reportTitle(project, line.item.slice("ritual/".length), titles);
    if (title === undefined) continue;
    const facts = reportFacts(project, line, title);
    if (facts === null) continue;
    const key = reportKey(line.run);
    alerts.push({ key, tag: key, channel: "email", title: `Report: ${title}`, body: `${project.name}: run ${line.run} complete`, url: facts.url, report: facts });
  }
  return alerts;
}

/** How one channel took the newest notice of a candle. */
export interface ChannelDelivery {
  channel: ChannelName;
  /** `waiting`: the ledger holds neither `alert.sent` nor `alert.failed` for the notice. */
  state: "sent" | "failed" | "waiting";
  /** The host of the newest `alert.sent` or `alert.failed` line. */
  host?: string;
  at?: string;
  /** How many `alert.failed` lines the notice has. */
  tries: number;
  /** The `error` of the newest `alert.failed` line, cut to one short line. Only when `state` is `failed`. */
  reason?: string;
}

const REASON_MAX = 200;

function deliveryOf(ledger: readonly LedgerLine[], key: string, channel: ChannelName): ChannelDelivery {
  const own = ledger.filter((line) => line.key === key && (line.type === "alert.sent" || line.type === "alert.failed"));
  const sent = own.findLast((line) => line.type === "alert.sent");
  if (sent !== undefined) return { channel, state: "sent", host: sent.host, at: sent.at, tries: own.filter((line) => line.type === "alert.failed").length };
  const failures = own.filter((line) => line.type === "alert.failed");
  const last = failures.at(-1);
  if (last === undefined) return { channel, state: "waiting", tries: 0 };
  const error = isText(last.error) ? oneLine(last.error).slice(0, REASON_MAX) : "";
  const failed: ChannelDelivery = { channel, state: "failed", host: last.host, at: last.at, tries: failures.length };
  if (error !== "") failed.reason = error;
  return failed;
}

/**
 * Where the newest notice of a candle stands, one entry per channel it names
 * (the web app's candle page). The newest notice is the one of the newest line
 * that opened or raised the candle. A candle that delivers to the app only has
 * no channel, so the list is empty. Reads the ledger and writes nothing.
 */
export function candleDelivery(project: Project, ledger: readonly LedgerLine[], key: string): ChannelDelivery[] {
  const opening = candleOpenings(project, ledger).findLast((one) => one.candles.some((candle) => candle.key === key));
  if (opening === undefined) return [];
  return candleChannels(project, opening).map((channel) => deliveryOf(ledger, candleKey(opening.line.id, channel), channel));
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
  /** The `error` of the newest trace of each key. */
  traces: Map<string, string>;
}

/** An `alert.failed` line that says only that the channel was closed. It is a trace and not a try, also in a ledger from before 0.113.2. */
function isTrace(line: LedgerLine): line is LedgerLine & { error: string } {
  return isText(line.error) && line.error.startsWith(NOT_SET_UP);
}

/** The send state of every key, from the ledger. */
function sendState(ledger: readonly LedgerLine[]): SendState {
  const state: SendState = { sent: new Set(), tries: new Map(), retries: new Map(), lastFailed: new Map(), traces: new Map() };
  for (const line of ledger) {
    const { key } = line;
    if (!isText(key)) continue;
    if (line.type === "alert.sent") state.sent.add(key);
    else if (line.type === "alert.failed") {
      if (isTrace(line)) {
        state.traces.set(key, line.error);
        continue;
      }
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

/** A channel as this host has it: open, or closed with the reason a candle notice records. */
interface Opening {
  channel: OpenChannel | null;
  reason: string;
}

function openedPush(): OpenChannel | null {
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

/**
 * Closed (null channel) when this host has no keys or no device subscribed yet:
 * then nothing is sent, and nothing piles up. A bad `push.json` is a reason and
 * not a throw, so email and the other projects still go. The reason quotes no
 * value (src/core/push.ts, `readPushKeys`).
 */
function openPush(): Opening {
  try {
    return { channel: openedPush(), reason: NOT_SET_UP };
  } catch (cause) {
    return { channel: null, reason: `${NOT_SET_UP}: ${errorMessage(cause)}` };
  }
}

/** The mail of a report, or an error that quotes no text of it. */
function reportMail(settings: EmailSettings, alert: Alert, facts: ReportFacts): EmailMessage {
  if (facts.isMissing) throw new Error(REPORT_MISSING);
  try {
    return reportMessage(settings, facts, alert.key);
  } catch {
    // No cause and no message of it: it could quote the findings.
    throw new Error(REPORT_UNRENDERED);
  }
}

function emailChannel(settings: EmailSettings): OpenChannel {
  return {
    since: settings.since,
    async send(alert) {
      if (alert.report === undefined) await sendEmail(settings, alert);
      else await postEmail(settings, reportMail(settings, alert, alert.report));
      return { delivered: settings.to.length, error: "" };
    },
  };
}

/** A bad file is a reason and not a throw, so the other alerts still go. The reason quotes no value. */
function openEmail(): Opening {
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
  /** What a candle notice records on a closed channel. */
  closedReason: Readonly<Record<ChannelName, string>>;
}

/** Opens every channel once. */
function openChannels(): Channels {
  const push = openPush();
  const email = openEmail();
  return { push: push.channel, email: email.channel, closedReason: { push: push.reason, email: email.reason } };
}

/** One line per alert channel file that cannot be read, with the reason and no value. Empty when all is well. For `darius doctor`. */
export function channelProblems(): string[] {
  const found: string[] = [];
  const push = pushKeysProblem();
  if (push !== null) found.push(push);
  const email = emailStatus().problem;
  if (email !== null) found.push(email);
  return found;
}

/** A notice that failed before email was set up is history: its line is older than `since`, and setup must not send it. */
function isHistoryOnEmail(retry: Alert, state: SendState, email: OpenChannel | null): boolean {
  if (email === null || channelOf(retry) !== "email") return false;
  return (state.lastFailed.get(retry.key) ?? "") < email.since;
}

/** The id of the ledger line a candle key stands for, `line:<id>:<channel>`. */
function lineIdOfCandleKey(key: string): string | undefined {
  return /^line:([^:]+):(?:push|email)$/u.exec(key)?.[1];
}

/**
 * Tells whether a candle notice is still worth sending: a candle of its opening
 * is lit. A candle that was answered, accepted or blown out since is settled, and
 * the operator needs no word about it. The walk runs on the first question
 * only, so a flush without a candle notice pays nothing. An opening this
 * darius cannot find counts as open: it sends, as before.
 */
function openCandleCheck(project: Project, ledger: readonly LedgerLine[]): (key: string) => boolean {
  let known: { status: Map<string, string>; openings: Map<string, CandleOpening> } | undefined;
  const load = (): NonNullable<typeof known> => {
    known ??= {
      status: new Map(collectCandles(project, ledger).map((candle) => [candle.key, candle.status])),
      openings: new Map(candleOpenings(project, ledger).map((opening) => [opening.line.id, opening])),
    };
    return known;
  };
  return (key) => {
    const id = lineIdOfCandleKey(key);
    const opening = id === undefined ? undefined : load().openings.get(id);
    if (opening === undefined) return true;
    return opening.candles.some((candle) => load().status.get(candle.key) === "lit");
  };
}

/** What a failed notice leaves in the ledger: enough to send it again. A report leaves no text: the next flush builds it again from the blobs. */
function failedLine(alert: Alert, error: string): LedgerLineInput {
  if (alert.report !== undefined) return { who: WHO, type: "alert.failed", key: alert.key, channel: channelOf(alert), error };
  return { who: WHO, type: "alert.failed", key: alert.key, channel: channelOf(alert), error, title: alert.title, body: alert.body, url: alert.url };
}

async function sendOn(channel: OpenChannel, alert: Alert): Promise<Outcome> {
  try {
    return await channel.send(alert);
  } catch (cause) {
    return { delivered: 0, error: errorMessage(cause) };
  }
}

/** The trace of a candle notice on a closed channel: once per key and reason, never a try. */
function trace(project: Project, alert: Alert, reason: string, state: SendState, delivery: Delivery): void {
  if (state.traces.get(alert.key) === reason) return;
  appendLine(project, failedLine(alert, reason));
  state.traces.set(alert.key, reason);
  delivery.failed.push(`${alert.key}: ${reason}`);
}

/**
 * Sends each alert not sent yet on its channel to every recipient, and
 * records the outcome in the project ledger. Alerts that failed before go
 * again with their stored notice and channel, even when nothing rebuilds them
 * (a skip). One pass per channel, each with its own readiness check. A candle
 * notice on a channel this host has not set up writes one `alert.failed` trace
 * with the reason "not set up on host" per key and reason; a trace is not a
 * try. Any other alert on such a channel stays silent. A candle notice whose
 * candles are all settled is not sent and leaves no line. A dry run sends and
 * records nothing. Null when this host sends nothing, records nothing and has
 * no candle notice to trace.
 */
export async function sendAlerts(project: Project, alerts: readonly Alert[], options: { isDryRun?: boolean } = {}): Promise<Delivery | null> {
  const channels = openChannels();
  const ledger = readLedger(project);
  const state = sendState(ledger);
  const isOpen = openCandleCheck(project, ledger);
  const retries = [...state.retries.values()].filter((retry) => !alerts.some((alert) => alert.key === retry.key) && !isHistoryOnEmail(retry, state, channels.email));
  const queue = [...alerts, ...retries];
  if (channels.push === null && !queue.some((alert) => isCandleKey(alert.key) || isReportKey(alert.key))) return null;
  const delivery = emptyDelivery();
  for (const name of CHANNELS) {
    const channel = channels[name];
    for (const alert of queue) {
      if (channelOf(alert) !== name || state.sent.has(alert.key) || (state.tries.get(alert.key) ?? 0) >= MAX_TRIES) continue;
      if (isCandleKey(alert.key) && !isOpen(alert.key)) continue;
      if (options.isDryRun === true) {
        // A dry run prints what would go; a report's facts hold the findings text, which stays out of that print.
        const { report: _report, ...shown } = alert;
        if (channel !== null) delivery.pending.push(shown);
        continue;
      }
      if (channel === null) {
        if (isCandleKey(alert.key)) trace(project, alert, channels.closedReason[name], state, delivery);
        continue;
      }
      const outcome = await sendOn(channel, alert);
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

/**
 * An alert that waited longer than this for a closed channel is stale news.
 * After a repair, the old lines stay silent, so there is no burst. A candle
 * notice is not held to this: it is still open until someone settles it.
 */
const WAITED_MAX_MS = 24 * 3_600_000;

/** The later of the channel's `since` and `now` minus a day. */
function newsFloor(since: string, now: number): string {
  const floor = new Date(now - WAITED_MAX_MS).toISOString();
  return since > floor ? since : floor;
}

/**
 * Sends what the ledgers of this host hold and nobody was told yet. Null when
 * this host cannot send on push and has no candle notice to trace. A project
 * that throws is one entry in `failed`, and the others still go.
 */
export async function flushAlerts(options: { isDryRun?: boolean; projects?: readonly string[]; now?: number } = {}): Promise<Delivery | null> {
  const channels = openChannels();
  const since = { push: channels.push?.since, email: channels.email?.since };
  const host = hostId();
  const now = options.now ?? Date.now();
  const total = emptyDelivery();
  let isActive = channels.push !== null;
  // `_global` holds the gate checks; listProjects leaves it out. Without push keys it has nothing to send.
  const names = options.projects ?? [...listProjects(), GLOBAL_PROJECT];
  for (const name of names) {
    if (name === GLOBAL_PROJECT && channels.push === null) continue;
    try {
      const project = openProject(name);
      const ledger = readLedger(project);
      const news = channels.push === null ? [] : ledgerAlerts(project, ledger, newsFloor(channels.push.since, now), host, now);
      const reports = channels.email === null ? [] : reportAlerts(project, ledger, { host, floor: newsFloor(channels.email.since, now) });
      const delivery = await sendAlerts(project, [...news, ...candleAlerts(project, ledger, { host, since }), ...reports], options);
      if (delivery === null) continue;
      isActive = true;
      total.sent += delivery.sent;
      total.failed.push(...delivery.failed);
      total.pending.push(...delivery.pending);
    } catch (cause) {
      isActive = true;
      total.failed.push(`${name}: ${errorMessage(cause)}`);
    }
  }
  return isActive ? total : null;
}

/**
 * How many lit candles asked for email and have no `alert.sent` on it, across
 * the projects of the local store. `darius email set` says it, because a candle
 * from before `since`, or one that never had a closed channel's notice, stays
 * in the app only. Reads the ledgers and writes nothing. A project that does
 * not read counts as none.
 */
export function unsentEmailCandles(): number {
  let count = 0;
  for (const name of listProjects()) {
    try {
      const project = openProject(name);
      const ledger = readLedger(project);
      for (const candle of collectCandles(project, ledger)) {
        if (candle.status !== "lit") continue;
        const email = candleDelivery(project, ledger, candle.key).find((one) => one.channel === "email");
        if (email !== undefined && email.state !== "sent") count += 1;
      }
    } catch {
      // A project that does not read cannot say. The count is a hint, and `email set` must not fail on it.
    }
  }
  return count;
}
