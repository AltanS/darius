/**
 * What the pages show, derived from the status. The rule behind every
 * helper: show what the operator acts on, hide the rest. darius runs only
 * rituals with a mode other than `off`; the imported rituals of the legacy
 * tracker are tracked by hand, so they stay out of the main views, and so
 * do the runs `darius import` copied over.
 */

import type { Acknowledgement, MdBlock, MdLine, MdSpan, ProjectStatus, RitualRow, RunDetail, RunRow, VigilRow } from "../../../src/web/api.ts";
import { ackCommand, hostDate, momentText, relativeDate, roughDuration, runNowCommand, shortDate } from "./format.ts";
import { isUnattended, itemKind, type Kind } from "./kind.ts";
import type { Badge, Tone } from "./tone.ts";

export { isUnattended };

/** A djinn: a ritual darius runs that follows a repo skill. */
export function isDjinn(ritual: RitualRow): boolean {
  return isUnattended(ritual) && ritual.skill !== null;
}

/** A scheduled check: a ritual darius runs without a skill (a selftest heartbeat, say). */
export function isScheduledCheck(ritual: RitualRow): boolean {
  return isUnattended(ritual) && ritual.skill === null;
}

/** Runs that `darius import` copied from the legacy tracker: history, not activity. */
export function isImported(run: RunRow): boolean {
  return run.who === "import";
}

/** A run with the project and the human name of its item. */
export interface ActivityRun extends RunRow {
  project: string;
  /** The ritual title, or the item slug when the item is unknown. */
  label: string;
  /** The ritual or vigil slug. */
  slug: string;
  /** What the item is: a ritual darius runs, a ritual done by hand, or a vigil. */
  kind: Kind;
}

export function itemSlug(item: string): string {
  return item.split("/")[1] ?? item;
}

/** The human name of an item (`ritual/<slug>` or `vigil/<slug>`) in a project, or its slug. */
export function itemLabel(project: ProjectStatus | undefined, item: string): string {
  const [kind = "", slug = item] = item.split("/");
  const found = kind === "vigil" ? project?.vigils.find((vigil) => vigil.slug === slug) : project?.rituals.find((ritual) => ritual.slug === slug);
  return found?.title ?? slug;
}

/** The runs of these projects, newest first, each with a readable label. */
export function activity(projects: readonly ProjectStatus[], opts: { withImported: boolean }): ActivityRun[] {
  return projects
    .flatMap((project) =>
      project.runs
        .filter((run) => opts.withImported || !isImported(run))
        .map((run): ActivityRun => Object.assign({}, run, { project: project.name, slug: itemSlug(run.item), label: itemLabel(project, run.item), kind: itemKind(run.item, project.rituals.find((ritual) => ritual.slug === itemSlug(run.item))) })),
    )
    .toSorted((left, right) => right.startedAt.localeCompare(left.startedAt));
}

/**
 * A complete run whose result asks the operator something (0.22.0), and
 * nobody answered yet: it waits for `darius run ack --note`, like a held run
 * waits for an answer.
 */
export function asksYou(run: RunRow): boolean {
  return run.phase === "closed" && run.outcome === "complete" && (run.result?.questions ?? 0) > 0 && run.acknowledged === null;
}

/**
 * How a run ended, in words and a tone. A run a person acknowledged
 * (`darius run ack`) is quiet on every page: "Failed, acknowledged" in grey,
 * never the failure colour. A complete run that asks a question is not
 * "Complete" until someone answered it.
 */
export function runState(run: RunRow): Badge {
  if (run.phase === "held") return { tone: "wait", label: "Waiting for you" };
  if (run.phase === "running") return { tone: "run", label: "Running" };
  if (asksYou(run)) return { tone: "wait", label: "Asks you" };
  if (run.outcome === "complete") return { tone: "ok", label: "Complete" };
  const badge = closedState(run.outcome);
  return run.acknowledged === null ? badge : { tone: "idle", label: `${badge.label}, acknowledged` };
}

function closedState(outcome: string | null): Badge {
  if (outcome === "failed") return { tone: "bad", label: "Failed" };
  if (outcome === null) return { tone: "idle", label: "Closed" };
  return { tone: "idle", label: outcome.charAt(0).toUpperCase() + outcome.slice(1) };
}

// --- stuck runs ------------------------------------------------------------------------

/** darius stops a run after this many minutes by default (DEFAULT_RUN_TIMEOUT_MS in src/runner/run-due.ts). */
export const RUN_TIMEOUT_MINUTES = 20;

/** A run still open after this long has outlived the timeout by far: it may be stuck. */
const STUCK_AFTER_MS = 2 * 60 * 60_000;

/**
 * How long a running run has run, in words, when that is past the stuck
 * limit; null otherwise. Measured against the status time, not the browser
 * clock, so server and client render the same text.
 */
export function stuckFor(run: RunRow, generatedAt: string): string | null {
  if (run.phase !== "running") return null;
  const size = Date.parse(generatedAt) - Date.parse(run.startedAt);
  if (Number.isNaN(size) || size < STUCK_AFTER_MS) return null;
  return roughDuration(size);
}

/** The warning line for a stuck run. */
export function stuckText(runningFor: string): string {
  return `Running for ${runningFor}. Runs stop after ${RUN_TIMEOUT_MINUTES} min, so this one may be stuck.`;
}

// --- vigils and questions -----------------------------------------------------------

/** What a vigil waits for, in words: "due in 3 d", "waits for: the first batch", or both. */
export function vigilWaits(vigil: VigilRow, today: string): string[] {
  return [vigil.due === null ? null : `due ${relativeDate(vigil.due, today)}`, vigil.until === null ? null : `waits for: ${vigil.until}`].filter((part) => part !== null);
}

/** The questions that wait for the operator: a held run's (one without a question counts as one), and a result's nobody answered. */
export function questionCount(runs: readonly RunRow[]): number {
  const held = runs.filter((run) => run.phase === "held").reduce((sum, run) => sum + Math.max(run.questions.length, 1), 0);
  return runs.filter((run) => asksYou(run)).reduce((sum, run) => sum + (run.result?.questions ?? 0), held);
}

/** "2 questions wait for you". */
export function questionsText(count: number): string {
  return `${count} question${count === 1 ? "" : "s"} wait${count === 1 ? "s" : ""} for you`;
}

/** "every day", "every 7 days", "every week"; null without a cadence. */
export function cadenceText(cadence: string | null): string | null {
  if (cadence === null) return null;
  const match = /^(\d+)\s*([hdwm])$/u.exec(cadence.trim());
  if (match === null) return `every ${cadence}`;
  const count = Number(match[1]);
  const unit = { h: "hour", d: "day", w: "week", m: "month" }[match[2] ?? "d"] ?? "day";
  return count === 1 ? `every ${unit}` : `every ${count} ${unit}s`;
}

/** When the ritual runs next, in words, against the host's today. */
export function nextText(ritual: RitualRow, today: string): string {
  if (ritual.heldRun !== null) return "waits for your answer";
  if (ritual.openRun !== null) return "running now";
  if (ritual.nextDue === null) return "not scheduled";
  if (ritual.overdueDays > 0) return `overdue ${ritual.overdueDays} d`;
  if (ritual.isDue) return "due today";
  return `next due ${relativeDate(ritual.nextDue, today)}`;
}

// --- failed runs: what happens next ------------------------------------------------------

/** The host's date and UTC offset, for clock times that read the same on the server and in the browser. */
export interface HostClock {
  today: string;
  offset: number;
}

/** "Acknowledged by owner at 09:12: known outage." Store text, shown as text. */
export function ackText(ack: Acknowledgement, clock: HostClock): string {
  const lead = `Acknowledged by ${ack.who} at ${momentText(ack.at, clock.today, clock.offset)}`;
  if (ack.note === null || ack.note.trim() === "") return `${lead}.`;
  const note = ack.note.trim();
  return /[.!?]$/u.test(note) ? `${lead}: ${note}` : `${lead}: ${note}.`;
}

/** "Answered by owner at 09:12: yes, delete them." The decision on a result's questions, from the acknowledgement. */
export function decisionText(ack: Acknowledgement, clock: HostClock): string {
  const lead = `Answered by ${ack.who} at ${momentText(ack.at, clock.today, clock.offset)}`;
  if (ack.note === null || ack.note.trim() === "") return `${lead}, without a note.`;
  const note = ack.note.trim();
  return /[.!?]$/u.test(note) ? `${lead}: ${note}` : `${lead}: ${note}.`;
}

/** A ritual run that failed or was abandoned. */
export interface Failure {
  project: string;
  slug: string;
  run: string;
  /** "failed" or "abandoned". */
  outcome: string;
  /** The host date the run ended, YYYY-MM-DD. */
  endedOn: string;
  acknowledged: Acknowledgement | null;
}

/** The "What happens next" card: the two commands, or who saw the failure. */
export type NextStep = { kind: "open"; tone: Tone; text: string; runNow: string; ack: string } | { kind: "seen"; text: string };

export function nextStep(failure: Failure, clock: HostClock): NextStep {
  if (failure.acknowledged !== null) return { kind: "seen", text: ackText(failure.acknowledged, clock) };
  const failed = failure.outcome === "failed";
  const verb = failed ? "failed" : "was abandoned";
  const text =
    failure.endedOn === clock.today
      ? `This run ${verb}. darius does not retry it today. The timer starts the ritual again when it is next due, tomorrow for a daily ritual.`
      : `This run ${verb} on ${shortDate(failure.endedOn)}. The timer starts the ritual again when it is next due.`;
  return { kind: "open", tone: failed ? "bad" : "idle", text, runNow: runNowCommand(failure.slug, failure.project), ack: ackCommand(failure.run, failure.project) };
}

/** The failure a run page shows a next step for: a closed ritual run that failed or was abandoned; null for any other run. */
export function runFailure(project: string, run: RunRow, offset: number): Failure | null {
  const { phase, outcome, item } = run;
  if (phase !== "closed" || (outcome !== "failed" && outcome !== "abandoned") || !item.startsWith("ritual/")) return null;
  return { project, slug: itemSlug(item), run: run.run, outcome, endedOn: hostDate(run.endedAt ?? run.startedAt, offset), acknowledged: run.acknowledged };
}

/** The failure a ritual page shows a next step for: its run that failed today; null when none did. */
export function ritualFailure(project: string, ritual: RitualRow, runs: readonly RunRow[], today: string): Failure | null {
  const failed = ritual.failedToday;
  if (failed === null) return null;
  const outcome = runs.find((run) => run.run === failed.run)?.outcome ?? "failed";
  return { project, slug: ritual.slug, run: failed.run, outcome, endedOn: today, acknowledged: failed.acknowledged };
}

// --- report excerpts -------------------------------------------------------------------

function lineText(line: MdLine): string {
  return line.map((span) => span.text).join("");
}

/** The first heading of a report, as plain text. */
export interface Excerpt {
  headline: string | null;
  /** The first paragraph or list after the headline, at most three list items. */
  blocks: MdBlock[];
}

const EXCERPT_ITEMS = 3;
/** The most characters an excerpt shows: about four lines on a phone. */
const EXCERPT_CHARS = 200;

interface ClippedLine {
  line: MdLine;
  used: number;
  clipped: boolean;
}

interface ClippedBlock {
  block: MdBlock;
  used: number;
}

/** The spans of a line that fit in `budget` characters, cut at a word boundary. */
function clipLine(line: MdLine, budget: number): ClippedLine {
  const kept: MdSpan[] = [];
  let used = 0;
  for (const span of line) {
    if (used + span.text.length <= budget) {
      kept.push(span);
      used += span.text.length;
      continue;
    }
    const room = budget - used;
    // One character past the room tells whether the last word ends there; a word never breaks.
    const head = span.text.slice(0, room + 1);
    const cut = span.kind === "code" || !/\s/u.test(head) ? "" : head.replace(/\s+\S*$/u, "").replace(/[\s,;:.(-]+$/u, "");
    if (cut !== "") kept.push({ kind: span.kind, text: cut });
    kept.push({ kind: "text", text: "…" });
    return { line: kept, used: budget, clipped: true };
  }
  return { line: kept, used, clipped: false };
}

/** A paragraph or list clipped to `budget` characters. */
function clipBlock(block: MdBlock, budget: number): ClippedBlock {
  if (block.kind !== "paragraph" && block.kind !== "list") return { block, used: 0 };
  const source = block.kind === "paragraph" ? block.lines : block.items;
  const lines: MdLine[] = [];
  let used = 0;
  for (const line of source) {
    if (used >= budget) break;
    const clip = clipLine(line, budget - used);
    lines.push(clip.line);
    used += clip.used;
    if (clip.clipped) break;
  }
  return { block: block.kind === "paragraph" ? { ...block, lines } : { ...block, items: lines }, used };
}

/** The first heading and paragraph of a report, the paragraph cut to `chars` characters. */
export function excerpt(findings: readonly MdBlock[] | null, chars: number = EXCERPT_CHARS): Excerpt | null {
  if (findings === null || findings.length === 0) return null;
  const first = findings[0];
  const headline = first?.kind === "heading" ? lineText(first.content) : null;
  const rest = headline === null ? findings : findings.slice(1);
  const blocks: MdBlock[] = [];
  for (const block of rest) {
    if (block.kind === "heading") {
      if (blocks.length > 0) break;
      continue;
    }
    if (block.kind === "list") blocks.push(clipBlock({ ...block, items: block.items.slice(0, EXCERPT_ITEMS) }, chars).block);
    else if (block.kind === "paragraph") blocks.push(clipBlock(block, chars).block);
    if (blocks.length >= 1) break;
  }
  return { headline, blocks };
}

/** The report of a run, when it has one. */
export function reportExcerpt(detail: RunDetail | null): Excerpt | null {
  return detail === null ? null : excerpt(detail.findings);
}
