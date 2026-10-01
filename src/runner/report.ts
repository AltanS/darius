/**
 * The batch report `darius run-due` prints and posts: one entry per due
 * ritual it looked at, what it did about it, and how the run ended
 * (docs/concept.md, "App design" > "Unattended runner", step 5).
 *
 * `--json` prints the whole `BatchReport` as one object on stdout. The text
 * form is what goes to `[notify] webhook` (posted as `text/plain`) or to
 * stdout, which under the systemd timer is the journal. The timer's text form
 * leaves out rituals skipped for `policy.mode: off`, rituals whose working
 * dir is on another host, and rituals pinned to another host: all three are
 * skipped by design and would repeat every 15 minutes. A person's `run now` names
 * every skip, these included.
 */

import { errorMessage } from "../runtime.ts";
import type { Alert } from "../core/alerts.ts";
import type { ResultSummary } from "../core/result.ts";
import type { HarnessCheck } from "./harness-check.ts";

/** What run-due did with one due ritual. */
export type RitualAction = "started" | "would-start" | "skipped";

/** Why a due ritual was not started. */
export type SkipReason =
  | "policy-off"
  | "other-host"
  | "held"
  | "open-run"
  | "failed-today"
  | "lease-held"
  | "lease-offline"
  | "no-workdir"
  | "policy-capped"
  | "gate-broken"
  | "harness-unchecked"
  | "subagents-unproven"
  | "tool-missing"
  | "profile-invalid"
  | "marker-invalid"
  | "marker-dirty"
  | "not-in-marker"
  | "skill-missing"
  | "skill-dirty"
  | "not-active"
  | "not-resumable"
  | "not-followable"
  | "error";

/** How a started run ended, read back from the ledger after `claude` exited. */
export type RunEnd = "complete" | "failed" | "abandoned" | "held";

export interface RitualEntry {
  slug: string;
  action: RitualAction;
  reason?: SkipReason;
  detail?: string;
  run?: string;
  /** The run was held and went on (`darius run resume`), with the same run id. */
  resumed?: boolean;
  /** The run follows up this complete run (`darius run follow-up`, 0.47.0). */
  followUpOf?: string;
  end?: RunEnd;
  questions?: string[];
  sessionId?: string;
  costUsd?: number;
  exitCode?: number | null;
  timedOut?: boolean;
  durationMs?: number;
  /** The resolved profile's name; absent for the built-in default. */
  profile?: string;
  harness?: string;
  surface?: string;
  /** Things the operator should know that did not stop the run, such as a surface fallback. */
  warnings?: string[];
  /** The counts of the run's result block (0.22.0). */
  result?: ResultSummary;
}

export interface ProjectEntry {
  project: string;
  /** "ok", "offline", "lease-held", "no-remote", "skipped" (dry run) or "error: ...". */
  syncBefore: string;
  syncAfter: string;
  rituals: RitualEntry[];
  /** What reconcile says about the marker: a retired repo ritual named again (0.54.0). */
  warnings?: string[];
}

export interface BatchReport {
  ok: boolean;
  date: string;
  host: string;
  dryRun: boolean;
  projects: ProjectEntry[];
  errors: { project: string; error: string }[];
  /** "stdout", "webhook", "none" (nothing to say), or "failed: ...". */
  notify?: string;
  /** How the store-wide profiles (`_global`) synced first; absent without a remote. */
  globalSync?: string;
  /** The gate checks this batch ran, one per new harness version (src/runner/harness-check.ts). */
  harnessChecks?: HarnessCheck[];
}

/**
 * What a report says (docs/concept.md, "The unattended runner" > "Report").
 * `digest`: the first unattended batch of a local day lists every notable
 * entry, held runs and `failed-today` included, and says "all quiet" when
 * there is none, so a dead timer shows as a missing digest. `news`: every
 * later batch of that day lists only started runs and failures, so the
 * 15-minute timer does not repeat the same held run all day. `all`: every
 * entry, skips by design included, never "all quiet" (`run now`,
 * `run resume`, `--dry-run`): a person asked, so a skip is the answer.
 */
export type ReportScope = "digest" | "news" | "all";

/** Skip reasons that mean something is broken, not just "not now". They fail the batch and are always news. */
export const FAILING_SKIPS: ReadonlySet<string> = new Set([
  "error",
  "gate-broken",
  "harness-unchecked",
  "profile-invalid",
  "subagents-unproven",
  "tool-missing",
  "marker-invalid",
  "marker-dirty",
  "skill-missing",
  "skill-dirty",
]);

/**
 * Skip details darius writes itself. The others (gate-broken, error) can hold
 * a stderr tail or an exception text, and an alert never carries those: they
 * can hold environment text.
 */
const OWN_DETAILS: ReadonlySet<string> = new Set([
  "harness-unchecked",
  "profile-invalid",
  "subagents-unproven",
  "tool-missing",
  "marker-invalid",
  "marker-dirty",
  "skill-missing",
  "skill-dirty",
]);

/**
 * The failing skips of one project in a batch, as alerts (src/core/alerts.ts,
 * 0.29.0). One per host, ritual, reason and day: every host's timer fires
 * every 15 minutes, and the key keeps each from repeating it. Skips that only mean
 * "not now" are no alerts.
 */
export function skipAlerts(entry: ProjectEntry, batch: { date: string; host: string }): Alert[] {
  return entry.rituals.flatMap((ritual) => {
    const reason = ritual.reason ?? "";
    if (ritual.action !== "skipped" || !FAILING_SKIPS.has(reason)) return [];
    const detail =
      ritual.detail !== undefined && OWN_DETAILS.has(reason)
        ? ritual.detail
        : `Details: darius run now ${ritual.slug} --dry-run --project ${entry.project}, on ${batch.host}.`;
    const key = `skip:${batch.host}:${ritual.slug}:${batch.date}:${reason}`;
    return [{ key, tag: key, title: `${ritual.slug} did not start: ${reason}`, body: `${entry.project} on ${batch.host}. ${detail}`, url: "/" }];
  });
}

/** Skips by design: the timer meets them on every batch, so its report leaves them out. */
const QUIET_SKIPS: ReadonlySet<string> = new Set(["policy-off", "no-workdir", "other-host", "not-in-marker", "lease-held"]);

/** True when the entry is worth a line in the text report. In scope `all` every entry is. */
function isNotable(entry: RitualEntry, scope: ReportScope): boolean {
  return scope === "all" || !QUIET_SKIPS.has(entry.reason ?? "");
}

/** True when the entry is new since the last batch: a run started, or something broke. */
function isNews(entry: RitualEntry): boolean {
  return entry.action !== "skipped" || FAILING_SKIPS.has(entry.reason ?? "") || entry.reason === "lease-offline";
}

function describeEnd(entry: RitualEntry, project: string): string {
  const run = entry.run ?? "?";
  if (entry.end === "held") {
    const count = entry.questions?.length ?? 0;
    return `held with ${count} question(s): answer with darius run answer ${run} <n> <text> --project ${project}`;
  }
  if (entry.end === "failed") {
    const why = entry.timedOut === true ? "timed out" : `claude exit ${String(entry.exitCode ?? "none")}`;
    return `failed (${why}); findings blob on run ${run}`;
  }
  const asks = entry.result?.questions ?? 0;
  if (entry.end === "complete" && asks > 0) {
    return `complete, asks ${plural(asks, "question")}: read them on the run page, then darius run ack ${run} --note "your decision" --project ${project}`;
  }
  return `${entry.end ?? "unknown"} (run ${run})`;
}

function plural(n: number, noun: string): string {
  return `${String(n)} ${noun}${n === 1 ? "" : "s"}`;
}

/** `claude, profile opus-skip, headless`: what a run starts with. */
function describeLaunch(entry: RitualEntry): string {
  const profile = entry.profile === undefined ? "built-in profile" : `profile ${entry.profile}`;
  return `${entry.harness ?? "claude"}, ${profile}, ${entry.surface ?? "headless"}`;
}

function describeEntry(entry: RitualEntry, project: string): string {
  const warnings = (entry.warnings ?? []).map((warning) => `; warning: ${warning}`).join("");
  if (entry.action === "would-start") {
    const why = entry.followUpOf === undefined ? "due" : `follow-up of ${entry.followUpOf}`;
    const where = entry.detail === undefined ? "" : `, ${entry.detail}`;
    return `· ${entry.slug}: ${why}, would start with ${describeLaunch(entry)}${where} (dry run)${warnings}`;
  }
  if (entry.action === "skipped") {
    const detail = entry.detail === undefined ? "" : `, ${entry.detail}`;
    return `· ${entry.slug}: skipped, ${entry.reason ?? "unknown"}${detail}`;
  }
  const mark = entry.end === "complete" ? "✓" : "!";
  const resumed = entry.resumed === true ? "resumed, " : entry.followUpOf === undefined ? "" : `follow-up of ${entry.followUpOf}, `;
  return `${mark} ${entry.slug}: ${resumed}${describeEnd(entry, project)}${warnings}`;
}

/** `✓ claude 2.1.286: gate check passed on host-a ($0.0040)`. A check that ran is always news. */
function describeCheck(check: HarnessCheck, host: string): string {
  const mark = check.outcome === "passed" ? "✓" : "!";
  const cost = check.costUsd === undefined ? "" : ` ($${check.costUsd.toFixed(4)})`;
  const detail = check.detail === undefined ? "" : `: ${check.detail}`;
  const subagents = check.outcome === "passed" ? `, subagents ${check.subagents === "passed" ? "passed" : "not proven"}` : "";
  return `${mark} ${check.harness} ${check.version}: gate check ${check.outcome}${subagents} on ${host}${cost}${detail}`;
}

/** Plain-text lines for the webhook or the journal. Empty when nothing is worth saying (never for a digest). */
export function formatReport(report: BatchReport, scope: ReportScope = "all"): string[] {
  const lines: string[] = [];
  for (const project of report.projects) {
    const notable = project.rituals.filter((entry) => isNotable(entry, scope) && (scope !== "news" || isNews(entry)));
    if (notable.length === 0) continue;
    lines.push(`darius run-due on ${report.host}, ${report.date}, project ${project.project}:`);
    for (const entry of notable) lines.push(`  ${describeEntry(entry, project.project)}`);
  }
  // The same warning would come every 15 minutes, so the news scope leaves it out.
  for (const project of scope === "news" ? [] : report.projects) {
    for (const warning of project.warnings ?? []) lines.push(`! ${project.project}: ${warning}`);
  }
  for (const check of report.harnessChecks ?? []) lines.push(describeCheck(check, report.host));
  for (const failure of report.errors) lines.push(`! ${failure.project}: ${failure.error}`);
  if (scope === "digest" && lines.length === 0) {
    lines.push(`darius run-due on ${report.host}, ${report.date}: all quiet, ${String(report.projects.length)} project(s), nothing due, held or failed`);
  }
  return lines;
}

/** POSTs the text report to the webhook. Throws on a network error or a non-2xx answer. */
async function postWebhook(webhook: string, text: string): Promise<void> {
  const response = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "text/plain; charset=utf-8" },
    body: text,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`webhook answered ${String(response.status)}`);
}

/**
 * Sends the report: POST to `webhook` when it is set and the report has
 * something to say, else print the text to stdout (only without `--json`;
 * with `--json` stdout carries exactly one JSON object). Sets `report.notify`
 * and prints the JSON object last, so the JSON records where the text went.
 */
export async function deliverReport(report: BatchReport, target: { webhook: string; isJson: boolean; scope: ReportScope }): Promise<void> {
  const lines = formatReport(report, target.scope);
  if (lines.length === 0) report.notify = "none";
  else if (target.webhook !== "" && !report.dryRun) {
    try {
      await postWebhook(target.webhook, lines.join("\n"));
      report.notify = "webhook";
    } catch (cause) {
      report.notify = `failed: ${errorMessage(cause)}`;
      report.ok = false;
      console.error(`darius run-due: webhook post failed: ${errorMessage(cause)}`);
    }
  } else report.notify = "stdout";

  if (target.isJson) {
    console.log(JSON.stringify(report));
    return;
  }
  if (report.notify === "stdout") for (const line of lines) console.log(line);
  if (report.notify === "none") console.log("· run-due: nothing due");
}
