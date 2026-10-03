/**
 * The findings index (docs/concept.md, "Findings (0.62.0)"). A ritual run
 * reports `items` in its result block; an item may carry a `key`, a stable
 * id for the finding (src/core/result.ts). This file reads the ledger and the
 * result blobs, which already sync, and derives one Finding per (ritual,
 * key). Nothing is stored for a finding, except the two operator lines
 * `finding.closed` and `finding.reopened` (src/cli/finding.ts).
 *
 * Pure apart from the blob reads: the same ledger gives the same findings on
 * every host, so a derived finding cannot drift.
 *
 * STALE. A finding is stale when the newest complete, non-follow-up run of
 * its ritual that handed in a result did not report it. A follow-up never
 * makes a finding stale: it reports only what it changed.
 *
 * LAPSED (0.66.0). A stale finding that the full run before that one did not
 * report either is lapsed: two full runs in a row left it out. It leaves the
 * default list, the needs-you count and the run prompt; `--all` still shows
 * it. A later report of its key makes it open again.
 *
 * RESET (0.66.0). `finding.reset` (src/cli/finding.ts) hides every run
 * result that completed before it: for its ritual when the line names one
 * (`item: ritual/<slug>`), else for all rituals. The newest matching reset
 * counts. Ledger lines sync, so a reset on one host applies on every host.
 *
 * CLOSE. `finding.closed` closes a finding at the severity of its newest
 * report at that time. The close stays in force while later reports have the
 * same or a lower severity. A report at a higher severity ends it and sets
 * `reopened`. `finding.reopened` ends it at once.
 */

import { followUpRuns } from "./due.ts";
import type { JsonValue, LedgerLine } from "./model.ts";
import { parseResult, SEVERITIES, type ItemState, type ResultItem, type RunResult, type Severity } from "./result.ts";
import { getBlobText, type Project } from "./store.ts";

export interface FindingSeen {
  run: string;
  at: string;
}

export interface FindingStep {
  run: string;
  at: string;
  state: ItemState;
  severity: Severity;
}

export type FindingStatus = "needs-you" | "open" | "fixed" | "closed" | "lapsed";

export interface Finding {
  /** The ritual slug, from the run's item `ritual/<slug>`. */
  ritual: string;
  key: string;
  /** True when darius derived the key: the run gave none. */
  auto: boolean;
  title: string;
  severity: Severity;
  state: ItemState;
  group?: string;
  target?: string;
  detail?: string;
  firstSeen: FindingSeen;
  lastSeen: FindingSeen;
  /** The results that reported it. */
  runs: number;
  /** Oldest first, the newest HISTORY_MAX. */
  history: FindingStep[];
  stale: boolean;
  reopened: boolean;
  /** Only while the close is in force. */
  closed?: { at: string; who: string; note?: string; severity: Severity };
  status: FindingStatus;
}

/** How many history steps a finding keeps. */
export const HISTORY_MAX = 10;

const RITUAL_PREFIX = "ritual/";

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

/** Lower is worse. */
function severityRank(severity: Severity): number {
  return SEVERITIES.indexOf(severity);
}

function collapse(text: string): string {
  return text.replaceAll(/\s+/gu, " ").trim();
}

/** The key darius derives for an item without one. */
export function autoKey(item: Pick<ResultItem, "group" | "target" | "title">): string {
  return `auto:${collapse(`${item.group ?? ""}|${item.target ?? ""}|${item.title}`).toLowerCase()}`;
}

interface Track {
  ritual: string;
  key: string;
  auto: boolean;
  latest: ResultItem;
  firstSeen: FindingSeen;
  lastSeen: FindingSeen;
  /** The ledger index of the newest report. */
  lastOrder: number;
  /** The ledger index of the newest complete, non-follow-up run that reported it; -1 for none. */
  lastFullOrder: number;
  runs: number;
  history: FindingStep[];
  /** Some step so far was fixed. */
  everFixed: boolean;
  /** Some step before the newest was fixed. */
  fixedBefore: boolean;
  /** A report at a higher severity ended a close. */
  reopenedBySeverity: boolean;
  closed?: { at: string; who: string; note?: string; severity: Severity };
}

function trackId(ritual: string, key: string): string {
  return `${ritual}\u0000${key}`;
}

/** The items of one result by key, the later one winning. */
function itemsByKey(items: readonly ResultItem[]): Map<string, { item: ResultItem; auto: boolean }> {
  const byKey = new Map<string, { item: ResultItem; auto: boolean }>();
  for (const item of items) {
    const given = item.key;
    byKey.set(given ?? autoKey(item), { item, auto: given === undefined });
  }
  return byKey;
}

function report(
  tracks: Map<string, Track>,
  at: { ritual: string; seen: FindingSeen; order: number; isFull: boolean },
  key: string,
  entry: { item: ResultItem; auto: boolean },
): void {
  const { item } = entry;
  const step: FindingStep = { run: at.seen.run, at: at.seen.at, state: item.state, severity: item.severity };
  const id = trackId(at.ritual, key);
  const known = tracks.get(id);
  if (known === undefined) {
    tracks.set(id, {
      ritual: at.ritual,
      key,
      auto: entry.auto,
      latest: item,
      firstSeen: at.seen,
      lastSeen: at.seen,
      lastOrder: at.order,
      lastFullOrder: at.isFull ? at.order : -1,
      runs: 1,
      history: [step],
      everFixed: item.state === "fixed",
      fixedBefore: false,
      reopenedBySeverity: false,
    });
    return;
  }
  known.fixedBefore = known.everFixed;
  known.everFixed ||= item.state === "fixed";
  if (known.closed !== undefined && severityRank(item.severity) < severityRank(known.closed.severity)) {
    delete known.closed;
    known.reopenedBySeverity = true;
  }
  known.latest = item;
  known.auto = entry.auto;
  known.lastSeen = at.seen;
  known.lastOrder = at.order;
  if (at.isFull) known.lastFullOrder = at.order;
  known.runs += 1;
  known.history.push(step);
}

/**
 * Needs-you only for a finding the newest run confirmed (not stale) under a
 * key the run gave (not auto): an auto key is a guess, and the results from
 * before keys existed would flood the list with findings long fixed.
 */
function statusOf(track: Track, stale: boolean, lapsed: boolean): FindingStatus {
  const { state, severity } = track.latest;
  if (state === "fixed") return "fixed";
  if (track.closed !== undefined) return "closed";
  if (lapsed) return "lapsed";
  if (stale || track.auto) return "open";
  if (state === "needs-decision" || state === "needs-code" || severity === "critical" || severity === "high") return "needs-you";
  return "open";
}

/**
 * `fullRuns` holds the ledger index of each complete, non-follow-up run with
 * a result, per ritual, oldest first. Stale: the newest of them did not
 * report it. Lapsed: the one before did not either.
 */
function toFinding(track: Track, fullRuns: ReadonlyMap<string, readonly number[]>): Finding {
  const { latest } = track;
  const full = fullRuns.get(track.ritual) ?? [];
  const stale = track.lastOrder < (full.at(-1) ?? -1);
  const previous = full.at(-2);
  const lapsed = stale && previous !== undefined && track.lastFullOrder < previous;
  const reopened = (track.fixedBefore && latest.state !== "fixed") || track.reopenedBySeverity;
  const finding: Finding = {
    ritual: track.ritual,
    key: track.key,
    auto: track.auto,
    title: latest.title,
    severity: latest.severity,
    state: latest.state,
    firstSeen: track.firstSeen,
    lastSeen: track.lastSeen,
    runs: track.runs,
    history: track.history.slice(-HISTORY_MAX),
    stale,
    reopened,
    status: statusOf(track, stale, lapsed),
  };
  if (latest.group !== undefined) finding.group = latest.group;
  if (latest.target !== undefined) finding.target = latest.target;
  if (latest.detail !== undefined) finding.detail = latest.detail;
  if (track.closed !== undefined) finding.closed = track.closed;
  return finding;
}

const STATUS_ORDER: readonly FindingStatus[] = ["needs-you", "open", "closed", "lapsed", "fixed"];

function compareFindings(a: Finding, b: Finding): number {
  const byStatus = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
  if (byStatus !== 0) return byStatus;
  const bySeverity = severityRank(a.severity) - severityRank(b.severity);
  if (bySeverity !== 0) return bySeverity;
  if (a.lastSeen.at !== b.lastSeen.at) return a.lastSeen.at < b.lastSeen.at ? 1 : -1;
  return a.ritual === b.ritual ? a.key.localeCompare(b.key) : a.ritual.localeCompare(b.ritual);
}

/** The result of a completed ritual run, or null when the line carries none or the blob does not parse. */
function resultOf(project: Project, line: LedgerLine): RunResult | null {
  const sha = line.result_sha;
  if (!isText(sha)) return null;
  const blob = getBlobText(project, sha);
  if (blob === null) return null;
  const parsed = parseResult(blob);
  return "result" in parsed ? parsed.result : null;
}

function operatorLine(line: LedgerLine): { ritual: string; key: string } | null {
  const { item, key } = line;
  if (!isText(item) || !item.startsWith(RITUAL_PREFIX) || !isText(key) || key === "") return null;
  return { ritual: item.slice(RITUAL_PREFIX.length), key };
}

/** The ledger line type `darius finding reset` writes (0.66.0). */
export const FINDING_RESET = "finding.reset";

/** The time of the newest `finding.reset` per ritual slug; "" holds the newest reset of all rituals. */
function resetTimes(ledger: readonly LedgerLine[]): Map<string, string> {
  const times = new Map<string, string>();
  for (const line of ledger) {
    if (line.type !== FINDING_RESET) continue;
    const ritual = isText(line.item) && line.item.startsWith(RITUAL_PREFIX) ? line.item.slice(RITUAL_PREFIX.length) : "";
    const known = times.get(ritual);
    if (known === undefined || line.at > known) times.set(ritual, line.at);
  }
  return times;
}

/** True when a reset hides a result of `ritual` that completed at `at`: a reset for the ritual, or for all, came later. */
function isHiddenByReset(resets: ReadonlyMap<string, string>, ritual: string, at: string): boolean {
  return [resets.get(""), resets.get(ritual)].some((reset) => reset !== undefined && at < reset);
}

/** The findings of every ritual of the project, worst first (see the sort rules in docs/concept.md). */
export function collectFindings(project: Project, ledger: readonly LedgerLine[]): Finding[] {
  const followUps = followUpRuns(ledger);
  const resets = resetTimes(ledger);
  const tracks = new Map<string, Track>();
  const fullRuns = new Map<string, number[]>();
  ledger.forEach((line, order) => {
    if (line.type === "finding.closed" || line.type === "finding.reopened") {
      const target = operatorLine(line);
      const track = target === null ? undefined : tracks.get(trackId(target.ritual, target.key));
      if (track === undefined) return;
      if (line.type === "finding.reopened") {
        delete track.closed;
        return;
      }
      const closed: NonNullable<Track["closed"]> = { at: line.at, who: line.who, severity: track.latest.severity };
      if (isText(line.note) && line.note.trim() !== "") closed.note = line.note.trim();
      track.closed = closed;
      track.reopenedBySeverity = false;
      return;
    }
    if (line.type !== "run.completed" || !isText(line.item) || !line.item.startsWith(RITUAL_PREFIX) || !isText(line.run)) return;
    const ritual = line.item.slice(RITUAL_PREFIX.length);
    if (isHiddenByReset(resets, ritual, line.at)) return;
    const result = resultOf(project, line);
    if (result === null) return;
    const isFull = line.outcome === "complete" && !followUps.has(line.run);
    if (isFull) fullRuns.set(ritual, [...(fullRuns.get(ritual) ?? []), order]);
    const seen: FindingSeen = { run: line.run, at: line.at };
    for (const [key, entry] of itemsByKey(result.items)) report(tracks, { ritual, seen, order, isFull }, key, entry);
  });
  return [...tracks.values()].map((track) => toFinding(track, fullRuns)).toSorted(compareFindings);
}

/** What the dashboard counts: `open` is needs-you plus open. */
export interface FindingCounts {
  needsYou: number;
  open: number;
}

export function findingCounts(findings: readonly Finding[]): FindingCounts {
  let needsYou = 0;
  let open = 0;
  for (const finding of findings) {
    if (finding.status === "needs-you") needsYou += 1;
    if (finding.status === "needs-you" || finding.status === "open") open += 1;
  }
  return { needsYou, open };
}

// --- the run prompt -----------------------------------------------------------------

/** Most open findings a prompt lists; the rest is a count. */
export const PROMPT_OPEN_MAX = 40;
/** Most closed keys a prompt lists. */
export const PROMPT_CLOSED_MAX = 20;

export const FINDINGS_LEAD =
  "darius tracks these findings across runs. Re-check each one and report it again with the same key: state fixed when it is gone, else its state now. The key is the text in braces.";

/**
 * The lines of the `## Open findings` section after its lead text: the
 * needs-you and open findings, worst first, then the closed ones; only keys
 * a run gave, never auto keys. Empty when there is nothing to say. `findings`
 * is already one ritual's.
 */
export function findingPromptLines(findings: readonly Finding[]): string[] {
  const keyed = findings.filter((finding) => !finding.auto);
  const open = keyed.filter((finding) => finding.status === "needs-you" || finding.status === "open");
  const lines = open.slice(0, PROMPT_OPEN_MAX).map((finding) => {
    const target = finding.target === undefined ? "" : ` [${finding.target}]`;
    const stale = finding.stale ? " stale" : "";
    return `- {${finding.key}} ${finding.severity} ${finding.state}: ${finding.title}${target} (since ${finding.firstSeen.at.slice(0, 10)})${stale}`;
  });
  if (open.length > PROMPT_OPEN_MAX) lines.push(`- (${String(open.length - PROMPT_OPEN_MAX)} more)`);
  const closed = keyed.filter((finding) => finding.status === "closed").slice(0, PROMPT_CLOSED_MAX);
  if (closed.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`Closed by the operator, do not report again unless worse: ${closed.map((finding) => `{${finding.key}}`).join(", ")}`);
  }
  return lines;
}

/** The section as markdown lines, with its heading and lead; empty without lines. */
export function findingsSection(lines: readonly string[]): string[] {
  if (lines.length === 0) return [];
  return ["## Open findings", "", FINDINGS_LEAD, "", ...lines, ""];
}
