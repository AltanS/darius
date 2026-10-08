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
 * WHEN. `flushAlerts` runs after every run-due batch, `run now` and `run
 * resume`, and after `darius sync` (the sync timer, every 15 minutes), which
 * catches the lines a session writes by hand. A host without push keys sends
 * nothing. Lines from before the keys were made, or from before the first
 * device subscribed, are history, not news.
 */

import { existsSync } from "node:fs";

import { errorMessage } from "../runtime.ts";
import { classifyBackups, STALE_AFTER_MS, SNAPSHOT_FAILED, type BackupState } from "./backup-state.ts";
import { appendLine, hostId, readLedger, type LedgerLineInput } from "./ledger.ts";
import type { JsonValue, LedgerLine } from "./model.ts";
import { projectDir } from "./paths.ts";
import { activeDevices, broadcast, readPushKeys, type Notice, type PushKeys } from "./push.ts";
import { parseResult, readSummary } from "./result.ts";
import { getBlobText, GLOBAL_PROJECT, listProjects, openProject, type Project } from "./store.ts";

/** A notice that failed this many times is not sent again. */
export const MAX_TRIES = 3;
const WHO = "darius:alerts";

/** One notice to send, with the key that keeps it from going out twice. */
export interface Alert extends Notice {
  key: string;
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

/** Which keys went out, how often each failed, and the notice each failed with. */
interface SendState {
  sent: Set<string>;
  tries: Map<string, number>;
  retries: Map<string, Alert>;
}

/** The send state of every key, from the ledger. */
function sendState(ledger: readonly LedgerLine[]): SendState {
  const state: SendState = { sent: new Set(), tries: new Map(), retries: new Map() };
  for (const line of ledger) {
    const { key } = line;
    if (!isText(key)) continue;
    if (line.type === "alert.sent") state.sent.add(key);
    else if (line.type === "alert.failed") {
      state.tries.set(key, (state.tries.get(key) ?? 0) + 1);
      if (isText(line.title) && isText(line.body) && isText(line.url)) {
        state.retries.set(key, { key, tag: key, title: line.title, body: line.body, url: line.url });
      }
    }
  }
  return state;
}

/** The push keys and the `_global` project, or null when this host cannot send. */
interface Sender {
  keys: PushKeys;
  global: Project;
}

/** Null when this host has no keys or no device subscribed yet: then nothing is sent, and nothing piles up. */
function sender(): Sender | null {
  const keys = readPushKeys();
  if (keys === null || !existsSync(projectDir(GLOBAL_PROJECT))) return null;
  const global = openProject(GLOBAL_PROJECT);
  return activeDevices(readLedger(global)).length === 0 ? null : { keys, global };
}

/**
 * Sends each alert not sent yet to every device, and records the outcome in
 * the project ledger. Alerts that failed before go again with their stored
 * notice, even when nothing rebuilds them (a skip). A dry run sends and
 * records nothing. Null when this host has no keys.
 */
export async function sendAlerts(project: Project, alerts: readonly Alert[], options: { isDryRun?: boolean } = {}): Promise<Delivery | null> {
  const from = sender();
  if (from === null) return null;
  const delivery = emptyDelivery();
  const state = sendState(readLedger(project));
  const retries = [...state.retries.values()].filter((retry) => !alerts.some((alert) => alert.key === retry.key));
  for (const alert of [...alerts, ...retries]) {
    if (state.sent.has(alert.key) || (state.tries.get(alert.key) ?? 0) >= MAX_TRIES) continue;
    if (options.isDryRun === true) {
      delivery.pending.push(alert);
      continue;
    }
    let error = "";
    let devices = 0;
    try {
      const result = await broadcast(from.global, from.keys, alert);
      devices = result.sent;
      error = result.errors.join("; ") || "no device took it";
    } catch (cause) {
      error = errorMessage(cause);
    }
    if (devices > 0) {
      appendLine(project, { who: WHO, type: "alert.sent", key: alert.key, channel: "push", devices });
      state.sent.add(alert.key);
      delivery.sent += 1;
    } else {
      const line: LedgerLineInput = { who: WHO, type: "alert.failed", key: alert.key, channel: "push", error, title: alert.title, body: alert.body, url: alert.url };
      appendLine(project, line);
      delivery.failed.push(`${alert.key}: ${error}`);
    }
  }
  return delivery;
}

/** The earliest time that counts: the keys, or the first device, whichever is later. */
function newsSince(from: Sender): string {
  const firstDevice = activeDevices(readLedger(from.global)).map((device) => device.at).toSorted()[0] ?? from.keys.since;
  return firstDevice > from.keys.since ? firstDevice : from.keys.since;
}

/** Sends what the ledgers of this host hold and nobody was told yet. Null when this host cannot send. */
export async function flushAlerts(options: { isDryRun?: boolean; projects?: readonly string[]; now?: number } = {}): Promise<Delivery | null> {
  const from = sender();
  if (from === null) return null;
  const since = newsSince(from);
  const host = hostId();
  const total = emptyDelivery();
  // `_global` holds the gate checks; listProjects leaves it out.
  const names = options.projects ?? [...listProjects(), GLOBAL_PROJECT];
  for (const name of names) {
    const project = openProject(name);
    const delivery = await sendAlerts(project, ledgerAlerts(project, readLedger(project), since, host, options.now), options);
    if (delivery === null) continue;
    total.sent += delivery.sent;
    total.failed.push(...delivery.failed);
    total.pending.push(...delivery.pending);
  }
  return total;
}
