/**
 * The flare index (docs/concept.md, "Flares"). A flare is a problem that
 * needs the operator, kept by (project, key). It has no schedule and does no
 * work: a ritual or a script reports it, the operator answers or accepts it.
 *
 * Like the findings index (src/core/finding-index.ts), this file only reads
 * the project ledger and the result blobs, which already sync, and derives one
 * Flare per key. The same ledger gives the same flares on every host, and
 * nothing is stored but ledger lines.
 *
 * LEDGER LINES. `flare.lit` is a report from a script or a person. A run
 * reports through `run.completed` and its result blob alone: an item with
 * `flare: true` (src/core/result.ts). The operator's lines are
 * `flare.answered`, `flare.accepted`, `flare.cleared` and `flare.reopened`.
 * A line of these types that is malformed, or names a flare that is not
 * there, is skipped: a newer host may write a shape this host does not know.
 *
 * STATUS. `lit` until someone closes it. A report while lit counts and moves
 * `lastSeen`; the newest report names the title, severity and target. An
 * answer or an accept closes the flare at the severity it had. A later report
 * at the same or a lower severity leaves it closed and sets `stillReported`.
 * A higher severity lights it again. A flagged item in the state `fixed`, in
 * a complete run, clears the flare, as `flare.cleared` does.
 *
 * GONE. `flare.cleared`, a fixed report, or CLEAN_RUNS complete runs in a row
 * that did not report it. Only the ritual of the newest report counts runs;
 * a follow-up run and a run that did not complete never count. A flare from a
 * script has no runs to count, so it waits for `flare.cleared`. A report after
 * gone lights it again; so does nothing else. `finding.reset` has no effect.
 *
 * OPENINGS. `flareOpenings` names, per ledger line, the flares the line
 * opened (new, or lit again after gone) or raised in severity, so an alert
 * can send one notice per line.
 */

import { followUpRuns } from "./due.ts";
import { readLedger } from "./ledger.ts";
import type { JsonValue, LedgerLine } from "./model.ts";
import { parseResult, SEVERITIES, type ResultItem, type RunResult, type Severity } from "./result.ts";
import { getBlobText, type Project } from "./store.ts";

export const FLARE_LIT = "flare.lit";
export const FLARE_ANSWERED = "flare.answered";
export const FLARE_ACCEPTED = "flare.accepted";
export const FLARE_CLEARED = "flare.cleared";
export const FLARE_REOPENED = "flare.reopened";

/** Complete, non-follow-up runs in a row that must leave a flare out before it is gone. */
export const CLEAN_RUNS = 2;

/** How many history steps a flare keeps, newest last. */
export const FLARE_HISTORY_MAX = 30;

const RITUAL_PREFIX = "ritual/";

export type FlareStatus = "lit" | "answered" | "accepted" | "gone";

export const FLARE_STATUSES: readonly FlareStatus[] = ["lit", "answered", "accepted", "gone"];

/** The verbs a person settles a flare with. */
export type FlareSettle = "answer" | "accept" | "clear" | "reopen";

/** How `flare answer --follow-up` starts the line it ends with when no run started. The reason is on the line before it. */
export const FOLLOW_UP_NOT_STARTED = "darius flare answer: the follow-up did not start";

/** Where a report came from: the ledger line, and the run when a run reported it. */
export interface FlareSeen {
  at: string;
  line: string;
  run?: string;
}

/**
 * What a history step is. `lit` opens a flare, new or after gone. `report`
 * is a report that changed nothing else. `raised` is a report at a higher
 * severity. `gone` is the last clean run. The other kinds are the lines the
 * operator or a source wrote; a fixed report is a `cleared` step with a run.
 */
export type FlareStepKind = "lit" | "report" | "raised" | "answered" | "accepted" | "cleared" | "reopened" | "gone";

export interface FlareStep {
  at: string;
  kind: FlareStepKind;
  severity: Severity;
  line: string;
  run?: string;
  who?: string;
  note?: string;
}

export interface FlareAnswer {
  at: string;
  who: string;
  note: string;
  severity: Severity;
  /** The follow-up run the answer started, when it started one. */
  followUpRun?: string;
}

export interface FlareAccept {
  at: string;
  who: string;
  severity: Severity;
  note?: string;
}

export interface FlareClear {
  at: string;
  who: string;
  note?: string;
}

export interface Flare {
  key: string;
  title: string;
  severity: Severity;
  target?: string;
  status: FlareStatus;
  /** The ritual slug of the newest report, when a run made it. */
  ritual?: string;
  /** The run of the newest report, when a run made it. */
  run?: string;
  /** Plain text: `ritual:<slug>` for a run, else what `flare.lit` said, for example `ci:nightly`. */
  source: string;
  firstSeen: FlareSeen;
  lastSeen: FlareSeen;
  /** Every report so far, while lit or closed. */
  reports: number;
  /** A report came in since the flare was closed, at the same or a lower severity. */
  stillReported: boolean;
  bodySha?: string;
  /** The channels `flare.lit` named; absent for a report from a run. */
  deliver?: string[];
  /** Only while the answer is in force. */
  answered?: FlareAnswer;
  /** Only while the accept is in force. */
  accepted?: FlareAccept;
  /** Only while the flare is gone by a clear. */
  cleared?: FlareClear;
  history: FlareStep[];
}

/** What one ledger line opened or raised. */
export interface FlareOpened {
  key: string;
  title: string;
  severity: Severity;
  target?: string;
  /** `opened`: new, or lit again after gone. `raised`: a higher severity than before. */
  kind: "opened" | "raised";
  ritual?: string;
  deliver?: string[];
}

export interface FlareOpening {
  line: LedgerLine;
  flares: FlareOpened[];
}

// --- small readers ----------------------------------------------------------------------

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function textOf(value: JsonValue | undefined): string | undefined {
  if (!isText(value)) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function severityOf(value: JsonValue | undefined): Severity | undefined {
  return SEVERITIES.find((candidate) => candidate === value);
}

function channelsOf(value: JsonValue | undefined): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((entry) => {
    const text = textOf(entry);
    return text === undefined ? [] : [text];
  });
}

/** Lower is worse. */
function rank(severity: Severity): number {
  return SEVERITIES.indexOf(severity);
}

function isWorse(a: Severity, than: Severity): boolean {
  return rank(a) < rank(than);
}

// --- tracks -----------------------------------------------------------------------------

/** One report of a flare: from a `flare.lit` line or from a flagged item of a run. */
interface Report {
  key: string;
  title: string;
  severity: Severity;
  target?: string;
  source: string;
  ritual?: string;
  bodySha?: string;
  deliver?: string[];
  seen: FlareSeen;
  who: string;
}

interface Track {
  key: string;
  title: string;
  severity: Severity;
  /** The worst severity since the flare last opened or closed. Only a report above it is a raise, so a severity that moves down and up again alerts once. */
  peak: Severity;
  target?: string;
  source: string;
  ritual?: string;
  run?: string;
  bodySha?: string;
  deliver?: string[];
  status: FlareStatus;
  firstSeen: FlareSeen;
  lastSeen: FlareSeen;
  reports: number;
  stillReported: boolean;
  /** Runs of the ritual in a row that left it out. */
  cleanRuns: number;
  answered?: FlareAnswer;
  accepted?: FlareAccept;
  cleared?: FlareClear;
  history: FlareStep[];
}

interface Context {
  project: Project;
  followUps: ReadonlySet<string>;
  tracks: Map<string, Track>;
}

function stepOf(report: Report, kind: FlareStepKind, severity: Severity): FlareStep {
  const step: FlareStep = { at: report.seen.at, kind, severity, line: report.seen.line, who: report.who };
  if (report.seen.run !== undefined) step.run = report.seen.run;
  return step;
}

/** The fields the newest report names. A field the report lacks is gone. */
function adopt(track: Track, report: Report): void {
  track.title = report.title;
  track.severity = report.severity;
  if (report.target === undefined) delete track.target;
  else track.target = report.target;
  if (report.bodySha === undefined) delete track.bodySha;
  else track.bodySha = report.bodySha;
  if (report.deliver === undefined) delete track.deliver;
  else track.deliver = report.deliver;
}

/** What every report changes, whatever the status: who reported it and when. */
function noteSource(track: Track, report: Report): void {
  track.source = report.source;
  if (report.ritual === undefined) delete track.ritual;
  else track.ritual = report.ritual;
  if (report.seen.run === undefined) delete track.run;
  else track.run = report.seen.run;
  track.lastSeen = report.seen;
  track.reports += 1;
  track.cleanRuns = 0;
}

function dropClose(track: Track): void {
  delete track.answered;
  delete track.accepted;
  delete track.cleared;
  track.stillReported = false;
}

function openedOf(track: Track, kind: FlareOpened["kind"]): FlareOpened {
  const opened: FlareOpened = { key: track.key, title: track.title, severity: track.severity, kind };
  if (track.target !== undefined) opened.target = track.target;
  if (track.ritual !== undefined) opened.ritual = track.ritual;
  if (track.deliver !== undefined) opened.deliver = track.deliver;
  return opened;
}

function newTrack(report: Report): Track {
  const track: Track = {
    key: report.key,
    title: report.title,
    severity: report.severity,
    peak: report.severity,
    source: report.source,
    status: "lit",
    firstSeen: report.seen,
    lastSeen: report.seen,
    reports: 1,
    stillReported: false,
    cleanRuns: 0,
    history: [stepOf(report, "lit", report.severity)],
  };
  if (report.target !== undefined) track.target = report.target;
  if (report.ritual !== undefined) track.ritual = report.ritual;
  if (report.seen.run !== undefined) track.run = report.seen.run;
  if (report.bodySha !== undefined) track.bodySha = report.bodySha;
  if (report.deliver !== undefined) track.deliver = report.deliver;
  return track;
}

/** Applies one report. Returns what it opened or raised, if anything. */
function applyReport(tracks: Map<string, Track>, report: Report): FlareOpened | undefined {
  const known = tracks.get(report.key);
  if (known === undefined) {
    const created = newTrack(report);
    tracks.set(report.key, created);
    return openedOf(created, "opened");
  }
  const previous = known.severity;
  const { peak } = known;
  noteSource(known, report);
  if (known.status === "gone") {
    dropClose(known);
    known.status = "lit";
    known.peak = report.severity;
    adopt(known, report);
    known.history.push(stepOf(report, "lit", report.severity));
    return openedOf(known, "opened");
  }
  const isRaise = isWorse(report.severity, peak);
  if (isRaise) known.peak = report.severity;
  if (known.status === "lit") {
    adopt(known, report);
    known.history.push(stepOf(report, isRaise ? "raised" : "report", report.severity));
    return isRaise ? openedOf(known, "raised") : undefined;
  }
  if (!isRaise) {
    known.stillReported = true;
    known.history.push(stepOf(report, "report", previous));
    return undefined;
  }
  dropClose(known);
  known.status = "lit";
  adopt(known, report);
  known.history.push(stepOf(report, "raised", report.severity));
  return openedOf(known, "raised");
}

function endTrack(track: Track, step: FlareStep, cleared: FlareClear | undefined): void {
  delete track.answered;
  delete track.accepted;
  delete track.cleared;
  if (cleared !== undefined) track.cleared = cleared;
  track.status = "gone";
  track.stillReported = false;
  track.history.push(step);
}

// --- ledger lines -----------------------------------------------------------------------

function reportOfLine(line: LedgerLine): Report | undefined {
  const key = textOf(line.key);
  const title = textOf(line.title);
  const severity = severityOf(line.severity);
  const source = textOf(line.source);
  if (key === undefined || title === undefined || severity === undefined || source === undefined) return undefined;
  const report: Report = { key, title, severity, source, seen: { at: line.at, line: line.id }, who: line.who };
  const target = textOf(line.target);
  if (target !== undefined) report.target = target;
  const bodySha = textOf(line.body_sha);
  if (bodySha !== undefined) report.bodySha = bodySha;
  const deliver = channelsOf(line.deliver);
  if (deliver !== undefined) report.deliver = deliver;
  return report;
}

function lineStep(line: LedgerLine, kind: FlareStepKind, severity: Severity, note: string | undefined): FlareStep {
  const step: FlareStep = { at: line.at, kind, severity, line: line.id, who: line.who };
  if (note !== undefined) step.note = note;
  return step;
}

function answer(track: Track, line: LedgerLine): void {
  const note = textOf(line.note);
  if (note === undefined) return;
  const severity = severityOf(line.severity) ?? track.severity;
  const given: FlareAnswer = { at: line.at, who: line.who, note, severity };
  const run = textOf(line.follow_up_run);
  if (run !== undefined) given.followUpRun = run;
  delete track.accepted;
  track.answered = given;
  track.severity = severity;
  track.peak = severity;
  track.status = "answered";
  track.stillReported = false;
  track.history.push(lineStep(line, "answered", severity, note));
}

function accept(track: Track, line: LedgerLine): void {
  const note = textOf(line.note);
  const severity = severityOf(line.severity) ?? track.severity;
  const given: FlareAccept = { at: line.at, who: line.who, severity };
  if (note !== undefined) given.note = note;
  delete track.answered;
  track.accepted = given;
  track.severity = severity;
  track.peak = severity;
  track.status = "accepted";
  track.stillReported = false;
  track.history.push(lineStep(line, "accepted", severity, note));
}

function clear(track: Track, line: LedgerLine): void {
  const note = textOf(line.note);
  const cleared: FlareClear = { at: line.at, who: line.who };
  if (note !== undefined) cleared.note = note;
  endTrack(track, lineStep(line, "cleared", track.severity, note), cleared);
}

function reopen(track: Track, line: LedgerLine): void {
  if (track.status !== "answered" && track.status !== "accepted") return;
  dropClose(track);
  track.status = "lit";
  track.history.push(lineStep(line, "reopened", track.severity, textOf(line.note)));
}

type OperatorVerb = (track: Track, line: LedgerLine) => void;

const OPERATOR_VERBS = new Map<string, OperatorVerb>([
  [FLARE_ANSWERED, answer],
  [FLARE_ACCEPTED, accept],
  [FLARE_CLEARED, clear],
  [FLARE_REOPENED, reopen],
]);

function applyOperatorLine(tracks: Map<string, Track>, line: LedgerLine, verb: OperatorVerb): void {
  const key = textOf(line.key);
  const track = key === undefined ? undefined : tracks.get(key);
  if (track === undefined || track.status === "gone") return;
  verb(track, line);
}

// --- runs -------------------------------------------------------------------------------

function ritualOf(line: LedgerLine): string | undefined {
  if (!isText(line.item) || !line.item.startsWith(RITUAL_PREFIX)) return undefined;
  const slug = line.item.slice(RITUAL_PREFIX.length);
  return slug === "" ? undefined : slug;
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

/** The flagged items of one result by key, the later one winning. */
function flaggedItems(result: RunResult): Map<string, ResultItem> {
  const byKey = new Map<string, ResultItem>();
  for (const item of result.items) {
    if (item.flare === true && item.key !== undefined) byKey.set(item.key, item);
  }
  return byKey;
}

function reportOfItem(item: ResultItem, at: { ritual: string; seen: FlareSeen; who: string }): Report {
  const report: Report = {
    key: item.key ?? "",
    title: item.title,
    severity: item.severity,
    source: `ritual:${at.ritual}`,
    ritual: at.ritual,
    seen: at.seen,
    who: at.who,
  };
  if (item.target !== undefined) report.target = item.target;
  return report;
}

/** A fixed report clears the flare, as a source clear. */
function clearByReport(track: Track | undefined, report: Report): void {
  if (track === undefined || track.status === "gone") return;
  const cleared: FlareClear = { at: report.seen.at, who: report.who };
  endTrack(track, stepOf(report, "cleared", track.severity), cleared);
}

/** A full run of `ritual` that left these flares out: each one gets a step toward gone. */
function countCleanRun(tracks: ReadonlyMap<string, Track>, at: { ritual: string; seen: FlareSeen; who: string; reported: ReadonlySet<string> }): void {
  for (const track of tracks.values()) {
    if (track.ritual !== at.ritual || track.status === "gone" || at.reported.has(track.key)) continue;
    track.cleanRuns += 1;
    if (track.cleanRuns < CLEAN_RUNS) continue;
    const step: FlareStep = { at: at.seen.at, kind: "gone", severity: track.severity, line: at.seen.line, who: at.who };
    if (at.seen.run !== undefined) step.run = at.seen.run;
    endTrack(track, step, undefined);
  }
}

function applyRunLine(context: Context, line: LedgerLine): FlareOpened[] {
  const ritual = ritualOf(line);
  const run = textOf(line.run);
  if (ritual === undefined || run === undefined) return [];
  const result = resultOf(context.project, line);
  if (result === null) return [];
  const at = { ritual, seen: { at: line.at, line: line.id, run }, who: line.who };
  const flagged = flaggedItems(result);
  const opened: FlareOpened[] = [];
  for (const [key, item] of flagged) {
    const report = reportOfItem(item, at);
    if (item.state === "fixed") {
      // A run that failed proved nothing: its fixed report does not clear the flare.
      if (line.outcome === "complete") clearByReport(context.tracks.get(key), report);
      continue;
    }
    const found = applyReport(context.tracks, report);
    if (found !== undefined) opened.push(found);
  }
  const isFull = line.outcome === "complete" && !context.followUps.has(run);
  if (isFull) countCleanRun(context.tracks, { ...at, reported: new Set(flagged.keys()) });
  return opened;
}

function applyLine(context: Context, line: LedgerLine): FlareOpened[] {
  if (line.type === "run.completed") return applyRunLine(context, line);
  if (line.type === FLARE_LIT) {
    const report = reportOfLine(line);
    const found = report === undefined ? undefined : applyReport(context.tracks, report);
    return found === undefined ? [] : [found];
  }
  const verb = OPERATOR_VERBS.get(line.type);
  if (verb !== undefined) applyOperatorLine(context.tracks, line, verb);
  return [];
}

// --- the public reads -------------------------------------------------------------------

interface Walked {
  tracks: Map<string, Track>;
  openings: FlareOpening[];
}

function walk(project: Project, ledger: readonly LedgerLine[]): Walked {
  const context: Context = { project, followUps: followUpRuns(ledger), tracks: new Map() };
  const openings: FlareOpening[] = [];
  for (const line of ledger) {
    const flares = applyLine(context, line);
    if (flares.length > 0) openings.push({ line, flares });
  }
  return { tracks: context.tracks, openings };
}

// --- the run prompt -----------------------------------------------------------------

/** Most open flares a prompt lists; the rest is a count. */
export const PROMPT_FLARES_MAX = 40;

export const FLARES_LEAD =
  'These flares of this ritual are open. Check each one again. While the problem stands, report it with the same key and `"flare": true`, state needs-decision. When it is gone, report it with state fixed and the flag: that clears it. An answered or accepted flare stays closed unless it gets worse. The key is the text in braces.';

/** The lines of the `## Open flares` section: the flares of `ritual` that are not gone. Empty when there are none. */
export function flarePromptLines(flares: readonly Flare[], ritual: string): string[] {
  const open = flares.filter((flare) => flare.ritual === ritual && flare.status !== "gone");
  const lines = open.slice(0, PROMPT_FLARES_MAX).map((flare) => {
    const target = flare.target === undefined ? "" : ` [${flare.target}]`;
    return `- {${flare.key}} ${flare.severity} ${flare.status}: ${flare.title}${target} (since ${flare.firstSeen.at.slice(0, 10)})`;
  });
  if (open.length > PROMPT_FLARES_MAX) lines.push(`- (${String(open.length - PROMPT_FLARES_MAX)} more)`);
  return lines;
}

/** The section as markdown lines, with its heading and lead; empty without lines. */
export function flaresSection(lines: readonly string[]): string[] {
  if (lines.length === 0) return [];
  return ["## Open flares", "", FLARES_LEAD, "", ...lines, ""];
}

// --- the order of the list ----------------------------------------------------------

const STATUS_ORDER: readonly FlareStatus[] = ["lit", "answered", "accepted", "gone"];

function compareFlares(a: Flare, b: Flare): number {
  const byStatus = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
  if (byStatus !== 0) return byStatus;
  const bySeverity = rank(a.severity) - rank(b.severity);
  if (bySeverity !== 0) return bySeverity;
  if (a.lastSeen.at !== b.lastSeen.at) return a.lastSeen.at < b.lastSeen.at ? 1 : -1;
  return a.key.localeCompare(b.key);
}

function toFlare(track: Track): Flare {
  const flare: Flare = {
    key: track.key,
    title: track.title,
    severity: track.severity,
    status: track.status,
    source: track.source,
    firstSeen: track.firstSeen,
    lastSeen: track.lastSeen,
    reports: track.reports,
    stillReported: track.stillReported,
    history: track.history.slice(-FLARE_HISTORY_MAX),
  };
  if (track.target !== undefined) flare.target = track.target;
  if (track.ritual !== undefined) flare.ritual = track.ritual;
  if (track.run !== undefined) flare.run = track.run;
  if (track.bodySha !== undefined) flare.bodySha = track.bodySha;
  if (track.deliver !== undefined) flare.deliver = track.deliver;
  if (track.answered !== undefined) flare.answered = track.answered;
  if (track.accepted !== undefined) flare.accepted = track.accepted;
  if (track.cleared !== undefined) flare.cleared = track.cleared;
  return flare;
}

/** The flares of the project, lit first, then by severity and recency. Reads the ledger when none is given. */
/** Why `verb` cannot act on the flare now, or undefined when it can. The index skips such a line, so it must not be written. */
export function flareSettleRefusal(verb: FlareSettle, flare: Flare): string | undefined {
  const named = `flare '${flare.key}'`;
  if (verb === "reopen") {
    if (flare.status === "gone") return `${named} is gone; only a new report lights it again`;
    return flare.status === "lit" ? `${named} is lit; there is nothing to reopen` : undefined;
  }
  if (flare.status === "gone") return `${named} is already gone`;
  if (verb === "answer" && flare.status === "answered") return `${named} is already answered by ${flare.answered?.who ?? "someone"}; reopen it to answer again`;
  if (verb === "accept" && flare.status === "accepted") return `${named} is already accepted by ${flare.accepted?.who ?? "someone"}; reopen it to accept again`;
  return undefined;
}

export function collectFlares(project: Project, ledger?: readonly LedgerLine[]): Flare[] {
  const { tracks } = walk(project, ledger ?? readLedger(project));
  return [...tracks.values()].map(toFlare).toSorted(compareFlares);
}

/** For each ledger line that opened or raised flares, in ledger order: the line and those flares. */
export function flareOpenings(project: Project, ledger: readonly LedgerLine[]): FlareOpening[] {
  return walk(project, ledger).openings;
}
