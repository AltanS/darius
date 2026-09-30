/**
 * The home page, "the command board": one read of the status, across all
 * projects, that answers the operator's questions in the order they matter.
 * Does anything need me (the verdict, the status strip and the Needs you
 * cards)? What runs now (the Now rows)? What is coming (the Up next rows: the
 * next djinn starts, and the manual rituals that are overdue or due today)?
 * What happened last night (the Last night cards)? Is darius itself healthy
 * (one quiet Timer and Sync line)? Every value here comes from the status.
 * Where the status has no such fact (the next start time of a djinn, say) the
 * page says what it knows instead.
 *
 * Three filters keep noise off the page. Only djinns (rituals darius runs
 * that follow a repo skill) get a line. Imported and acceptance runs never
 * show. The projects that test darius itself shrink to one footer line, and
 * their flagged vigils never count as "needs you".
 *
 * The verdict counts things that need a person: held runs, runs whose result
 * asks a question, unacknowledged failures, stuck runs, flagged vigils and
 * unreadable projects. `needCounts` gives the same number per project and in
 * total, so the Home badge and the verdict cannot drift apart.
 *
 * A failed run that a person acknowledged (`darius run ack`) needs nobody
 * any more: it leaves Needs you and shows as a plain Last night card with
 * the acknowledgement, so the verdict stops saying "Failed", and its djinn
 * line in the rail says "failed, acknowledged" in grey.
 *
 * A complete run whose result asks the operator something (0.22.0) is an
 * "Asks you" card, like a held run, until someone records a decision with
 * `darius run ack --note`. Then it is a plain Last night card with the
 * decision.
 */

import type { HostStatus, MdBlock, ProjectStatus, ResultQuestion, RitualRow, RunDetail, RunRow, VigilRow } from "../../../src/web/api.ts";
import { answerCommand, clockTime, dayName, decideCommand, duration, hostDate, nextDay, projectPath, relativeDate, ritualPath, roughDuration, runPath, shortDate, vigilPath } from "./format.ts";
import { outcomeTone, type Tone } from "./tone.ts";
import { ackText, activity, asksYou, decisionText, excerpt, isDjinn, runState, stuckFor, type ActivityRun, type Excerpt } from "./view.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A sync older than this shows in the overdue colour. */
const SYNC_STALE_MS = 2 * HOUR;

/** Report excerpts: the characters sent, and the size past which the last line fades out. */
const NEED_CHARS = 480;
const NEED_FADE = 260;
const DONE_CHARS = 320;
const DONE_FADE = 190;

/** The project that tests darius itself (`darius selftest`). A project named `darius` is a real project, not a test. */
const SELFTEST_PROJECTS: ReadonlySet<string> = new Set(["darius-selftest"]);

export function isSelftest(project: string): boolean {
  return SELFTEST_PROJECTS.has(project);
}

/** Runs home never shows: copies from the legacy tracker and install proofs. */
function isNoise(run: RunRow): boolean {
  return run.who === "import" || run.who === "acceptance";
}

/** How a piece of text is coloured: a state tone, the muted label colour, or plain text. */
export type Ink = Tone | "mute" | "plain";

export interface Piece {
  text: string;
  ink: Ink;
}

export interface Action {
  text: string;
  href: string;
}

export interface Question {
  text: string;
  command: string;
}

/** The questions of a result, and the one command that records the decision on all of them. */
export interface Ask {
  questions: ResultQuestion[];
  command: string;
}

export type CardKind = "held" | "asks" | "failed" | "stuck" | "flagged" | "unreadable" | "done";

/** One card in the main column: a thing that needs the operator, or a djinn that completed last night. */
export interface Card {
  id: string;
  kind: CardKind;
  /** The colour of the left border; null for a plain card. */
  edge: Tone | null;
  word: Piece;
  /** A line under the status word: when, or how long stuck. */
  side: Piece | null;
  title: string;
  href: string;
  meta: string;
  meta2: string | null;
  questions: Question[];
  /** Set on an "Asks you" card. */
  ask: Ask | null;
  report: Excerpt | null;
  /** True when the report excerpt runs past its lines, so its end fades out. */
  fades: boolean;
  error: string | null;
  actions: Action[];
}

/** One segment of the status strip. Each one is a link to what it counts. */
export interface Segment {
  key: string;
  label: string;
  count: number;
  tone: Tone;
  /** A `#card` on this page, or null when there is nowhere to go. */
  href: string | null;
  /** The segment shows the live animation while its count is above zero. */
  live: boolean;
}

/** A run that runs now, for the Now rows. */
export interface NowRun {
  id: string;
  title: string;
  project: string;
  href: string;
  startedAt: string;
  who: string;
}

/** One row of a djinn or Up next list: a square in its state colour, a title, and its state in one line. */
export interface DjinnLine {
  key: string;
  title: string;
  href: string;
  tone: Tone;
  word: string;
  detail: Piece[];
}

/** Rows of Up next past the sixth: how many are left, and where to read them. */
export interface MoreLink {
  project: string;
  count: number;
  href: string;
}

export interface UpNext {
  lines: DjinnLine[];
  more: MoreLink[];
}

export interface Home {
  verdict: string;
  tone: Tone;
  /** "Tue 29 Sep, 12:14. Next djinn: tomorrow." */
  sub: string;
  strip: Segment[];
  /** The runs that run now and are not stuck (a stuck run has its card in Needs you). */
  now: NowRun[];
  needs: Card[];
  /** The calm line under Needs you when nothing needs the operator. */
  quiet: string;
  lastNight: Card[];
  upNext: UpNext;
  /** "Timer ok, last run 6 min ago. Synced 2 min ago." in parts, each in its own colour. */
  health: Piece[];
  djinns: DjinnLine[];
}

type ReadRun = (project: string, run: string) => RunDetail | null;

// --- words ---------------------------------------------------------------------------------

const NUMBER_WORDS = ["Nothing", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"] as const;

/**
 * "Nothing needs you.", "One thing needs you.", "Four things need you." In
 * words, because the Cinzel 1 reads as an I.
 */
export function verdictText(count: number): string {
  if (count === 0) return "Nothing needs you.";
  const word = NUMBER_WORDS[count] ?? String(count);
  return count === 1 ? `${word} thing needs you.` : `${word} things need you.`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function byText(who: string): string {
  return who === "timer" ? "by timer" : `by ${who}`;
}

interface Clock {
  now: number;
  today: string;
  offset: number;
}

/** "12 h ago" within a day, otherwise "27 Sep". */
function when(clock: Clock, iso: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  const size = clock.now - at;
  if (size >= DAY) return shortDate(hostDate(iso, clock.offset));
  if (size < 60_000) return "just now";
  return `${roughDuration(size)} ago`;
}

/** "12 h ago" or "on 27 Sep", to follow a verb. */
function whenPhrase(clock: Clock, iso: string): string {
  const text = when(clock, iso);
  return /\d{1,2} [A-Z][a-z]{2}$/u.test(text) ? `on ${text}` : text;
}

/** "today 00:05" or "28 Sep 23:42". */
function startedText(clock: Clock, iso: string): string {
  const date = hostDate(iso, clock.offset);
  const day = date === clock.today ? "today" : shortDate(date);
  return `${day} ${clockTime(iso, clock.offset)}`;
}

/** A YYYY-MM-DD date ahead: "tomorrow", "2 Oct". */
function aheadText(clock: Clock, date: string): string {
  if (date === clock.today) return "today";
  return date === nextDay(clock.today) ? "tomorrow" : shortDate(date);
}

function blocksSize(blocks: readonly MdBlock[]): number {
  return blocks.reduce((sum, block) => {
    if (block.kind === "paragraph") return sum + block.lines.flat().reduce((size, span) => size + span.text.length, 0);
    if (block.kind === "list") return sum + block.items.flat().reduce((size, span) => size + span.text.length, 0) + block.items.length * 40;
    return sum;
  }, 0);
}

// --- djinns --------------------------------------------------------------------------------

interface DjinnState {
  project: string;
  ritual: RitualRow;
  last: ActivityRun | null;
  /** The last run failed or was abandoned today: run-due does not retry it before tomorrow. */
  failedToday: boolean;
  /** Due since a day or more, not started today, nothing open: the timer did not start it. */
  missed: boolean;
  /** When the timer starts it next: "now", a YYYY-MM-DD date, or null when it waits on a run. */
  next: string | null;
}

function djinnState(clock: Clock, project: string, ritual: RitualRow, runs: readonly ActivityRun[]): DjinnState {
  const own = runs.filter((run) => run.project === project && run.item === `ritual/${ritual.slug}`);
  const last = own[0] ?? null;
  const endedOn = last?.endedAt === null || last === null ? null : hostDate(last.endedAt, clock.offset);
  const failedToday = last !== null && last.phase === "closed" && (last.outcome === "failed" || last.outcome === "abandoned") && endedOn === clock.today;
  const waiting = ritual.heldRun !== null || ritual.openRun !== null;
  const ranToday = own.some((run) => hostDate(run.startedAt, clock.offset) === clock.today);
  const missed = ritual.isDue && ritual.overdueDays >= 1 && !waiting && !ranToday;
  let next: string | null = null;
  if (!waiting && failedToday) next = nextDay(clock.today);
  else if (!waiting && ritual.nextDue !== null) next = ritual.nextDue <= clock.today ? "now" : ritual.nextDue;
  return { project, ritual, last, failedToday, missed, next };
}

function nextWords(clock: Clock, next: string | null): string | null {
  if (next === null) return null;
  return next === "now" ? "due now" : `next ${aheadText(clock, next)}`;
}

/** The subline sentence about the next djinn start, or "" when nothing is scheduled. */
function nextSentence(clock: Clock, states: readonly DjinnState[]): string {
  const nexts = states.map((state) => state.next).filter((next) => next !== null);
  if (nexts.includes("now")) return " A djinn is due now.";
  const first = nexts.toSorted()[0];
  return first === undefined ? "" : ` Next djinn: ${aheadText(clock, first)}.`;
}

const LINE_ORDER = { bad: 0, wait: 1, late: 2, run: 3, gold: 4, ok: 5, idle: 6 } as const satisfies Record<Tone, number>;

function djinnLine(clock: Clock, generatedAt: string, state: DjinnState): DjinnLine {
  const { project, ritual, last } = state;
  const base = { key: `${project}/${ritual.slug}`, title: ritual.title, href: ritualPath(project, ritual.slug) };
  if (last !== null && last.phase === "running") {
    const stuck = stuckFor(last, generatedAt);
    const detail: Piece[] = stuck === null ? [{ text: `started ${when(clock, last.startedAt)}`, ink: "plain" }] : [{ text: `${stuck}, `, ink: "plain" }, { text: "stuck", ink: "late" }];
    return { ...base, tone: "run", word: "Running", detail };
  }
  if (last !== null && last.phase === "held") return { ...base, tone: "wait", word: "Held", detail: [{ text: `since ${when(clock, last.startedAt)}`, ink: "plain" }] };
  if (state.missed) {
    const ran = last === null ? "never ran" : `last ran ${when(clock, last.startedAt)}`;
    return { ...base, tone: "late", word: "Overdue", detail: [{ text: `${ritual.overdueDays} d, ${ran}`, ink: "plain" }] };
  }
  const next = nextWords(clock, state.next);
  if (last === null) return { ...base, tone: "idle", word: "No run yet", detail: next === null ? [] : [{ text: next, ink: "plain" }] };
  const badge = runState(last);
  const text = [when(clock, last.startedAt), next].filter((part) => part !== null).join(", ");
  return { ...base, tone: badge.tone, word: badge.label, detail: [{ text, ink: "plain" }] };
}

// --- cards ---------------------------------------------------------------------------------

function blank(id: string, kind: CardKind): Card {
  return { id, kind, edge: null, word: { text: "", ink: "plain" }, side: null, title: "", href: "", meta: "", meta2: null, questions: [], ask: null, report: null, fades: false, error: null, actions: [] };
}

function historyHref(run: ActivityRun): string {
  return run.item.startsWith("vigil/") ? vigilPath(run.project, run.slug) : ritualPath(run.project, run.slug);
}

function heldCard(clock: Clock, run: ActivityRun): Card {
  return {
    ...blank(`held-${run.run}`, "held"),
    edge: "wait",
    word: { text: "Held", ink: "wait" },
    side: { text: when(clock, run.startedAt), ink: "plain" },
    title: run.label,
    href: runPath(run.project, run.run),
    meta: [run.project, byText(run.who), run.questions.length === 0 ? null : plural(run.questions.length, "question")].filter((part) => part !== null).join(", "),
    questions: run.questions.map((text, index) => ({ text, command: answerCommand(run.run, index + 1, run.project) })),
    actions: [{ text: "History", href: historyHref(run) }],
  };
}

/** A complete run whose result asks the operator something: its questions, with the command that records the decision. */
function asksCard(clock: Clock, readRun: ReadRun, run: ActivityRun): Card {
  const count = run.result?.questions ?? 0;
  const result = readRun(run.project, run.run)?.result ?? null;
  return {
    ...blank(`asks-${run.run}`, "asks"),
    edge: "wait",
    word: { text: "Asks you", ink: "wait" },
    side: { text: when(clock, run.endedAt ?? run.startedAt), ink: "plain" },
    title: run.label,
    href: runPath(run.project, run.run),
    meta: [run.project, byText(run.who), plural(count, "question")].join(", "),
    meta2: result === null ? null : result.summary,
    ask: { questions: result === null ? [] : result.questions, command: decideCommand(run.run, run.project) },
    actions: [
      { text: "Open the run", href: runPath(run.project, run.run) },
      { text: "History", href: historyHref(run) },
    ],
  };
}

interface ReportCard {
  report: Excerpt | null;
  fades: boolean;
}

function reportOf(readRun: ReadRun, run: ActivityRun, chars: number, fade: number): ReportCard {
  if (run.findingsSha === null) return { report: null, fades: false };
  const report = excerpt(readRun(run.project, run.run)?.findings ?? null, chars);
  return { report, fades: report !== null && blocksSize(report.blocks) > fade };
}

function tookText(run: RunRow): string | null {
  return run.endedAt === null ? null : `took ${duration(run.startedAt, run.endedAt)}`;
}

/** A failed run nobody acknowledged yet: it needs the operator. */
function isOpenFailure(run: RunRow): boolean {
  return run.phase === "closed" && outcomeTone(run.outcome) === "bad" && run.acknowledged === null;
}

/** A run for the Last night cards: it completed and asks nothing open, or it failed and a person acknowledged it. */
function isDone(run: RunRow): boolean {
  if (asksYou(run)) return false;
  return run.phase === "closed" && (run.outcome === "complete" || (outcomeTone(run.outcome) === "bad" && run.acknowledged !== null));
}

/** Who acknowledged a run: the decision on a result's questions, or who saw a failure. */
function seenText(run: RunRow, clock: Clock): string | null {
  const seen = run.acknowledged;
  if (seen === null) return null;
  return (run.result?.questions ?? 0) > 0 ? decisionText(seen, clock) : ackText(seen, clock);
}

function finishedCard(clock: Clock, readRun: ReadRun, state: DjinnState, run: ActivityRun): Card {
  const failed = isOpenFailure(run);
  const badge = runState(run);
  const report = failed ? reportOf(readRun, run, NEED_CHARS, NEED_FADE) : reportOf(readRun, run, DONE_CHARS, DONE_FADE);
  // An acknowledged failure is a plain card: runState() makes its word grey, and the acknowledgement says who saw it.
  return {
    ...blank(`${failed ? "failed" : "done"}-${state.project}-${state.ritual.slug}`, failed ? "failed" : "done"),
    edge: failed ? "bad" : null,
    word: { text: badge.label, ink: badge.tone },
    side: { text: when(clock, run.startedAt), ink: "plain" },
    title: state.ritual.title,
    href: runPath(run.project, run.run),
    meta: [state.project, byText(run.who), tookText(run)].filter((part) => part !== null).join(", "),
    meta2: seenText(run, clock),
    ...report,
    actions: [
      { text: run.findingsSha === null ? "Open the run" : "Read the report", href: runPath(run.project, run.run) },
      { text: "History", href: ritualPath(state.project, state.ritual.slug) },
    ],
  };
}

function stuckCard(clock: Clock, run: ActivityRun, stuck: string): Card {
  return {
    ...blank(`stuck-${run.run}`, "stuck"),
    edge: "late",
    word: { text: "Running", ink: "run" },
    side: { text: `stuck, ${stuck}`, ink: "late" },
    title: run.label,
    href: runPath(run.project, run.run),
    meta: `${run.project}, ${byText(run.who)}, started ${startedText(clock, run.startedAt)}`,
    actions: [
      { text: "Open the run", href: runPath(run.project, run.run) },
      { text: "History", href: historyHref(run) },
    ],
  };
}

function vigilWaitText(vigil: VigilRow, today: string): string[] {
  return [vigil.due === null ? null : `due ${relativeDate(vigil.due, today)}`, vigil.until === null ? null : `waits for ${vigil.until}`].filter((part) => part !== null);
}

function flaggedCard(clock: Clock, project: ProjectStatus, vigil: VigilRow, runs: readonly ActivityRun[], generatedAt: string): Card {
  const check = runs.find((run) => run.project === project.name && run.item === `vigil/${vigil.slug}` && run.phase === "running");
  const meta = [project.name, "vigil", vigil.lastOutcome === null ? null : `last check ${vigil.lastOutcome}`, ...vigilWaitText(vigil, clock.today)].filter((part) => part !== null);
  const size = check === undefined ? 0 : clock.now - Date.parse(check.startedAt);
  return {
    ...blank(`flagged-${project.name}-${vigil.slug}`, "flagged"),
    edge: "bad",
    word: { text: "Flagged", ink: "bad" },
    title: vigil.title,
    href: vigilPath(project.name, vigil.slug),
    meta: meta.join(", "),
    meta2: check === undefined ? null : `A new check is running, ${byText(check.who)}, ${roughDuration(size)} so far.${stuckFor(check, generatedAt) === null ? "" : " It may be stuck."}`,
    actions: [{ text: "Open the vigil", href: vigilPath(project.name, vigil.slug) }],
  };
}

function unreadableCard(project: ProjectStatus): Card {
  return {
    ...blank(`unreadable-${project.name}`, "unreadable"),
    edge: "bad",
    word: { text: "Unreadable", ink: "bad" },
    title: project.name,
    href: projectPath(project.name),
    meta: "darius could not read this project",
    error: project.error,
    actions: [{ text: "Open the project", href: projectPath(project.name) }],
  };
}

// --- health --------------------------------------------------------------------------------

/**
 * The hourly run-due timer. The status has no timer log, so the line reads
 * the runs: the newest run the timer started anywhere (the self-test counts,
 * it proves the timer fires), and the djinns that are overdue but did not
 * start today.
 */
function timerPiece(clock: Clock, status: HostStatus, states: readonly DjinnState[]): Piece {
  const timed = status.projects
    .flatMap((project) => project.runs)
    .filter((run) => run.who === "timer")
    .toSorted((left, right) => right.startedAt.localeCompare(left.startedAt));
  const last = timed[0];
  const missed = states.filter((state) => state.missed).length;
  if (missed > 0) {
    if (last === undefined) return { text: "Timer never ran.", ink: "late" };
    if (hostDate(last.startedAt, clock.offset) !== clock.today) return { text: `Timer silent since ${shortDate(hostDate(last.startedAt, clock.offset))}.`, ink: "late" };
    return { text: `Timer: ${plural(missed, "djinn")} not started.`, ink: "late" };
  }
  if (last === undefined) return { text: "Timer has no run yet.", ink: "mute" };
  return { text: `Timer ok, last run ${when(clock, last.startedAt)}.`, ink: "plain" };
}

function syncPiece(clock: Clock, status: HostStatus): Piece {
  const last = status.projects
    .map((project) => project.lastSync)
    .filter((sync) => sync !== null)
    .toSorted()
    .at(-1);
  if (last === undefined) return { text: " Never synced.", ink: "mute" };
  const stale = clock.now - Date.parse(last) > SYNC_STALE_MS;
  return { text: ` Synced ${when(clock, last)}.`, ink: stale ? "late" : "plain" };
}

// --- what needs the operator ---------------------------------------------------------------

/** What waits for a person in one project, and the rows it came from. */
interface ProjectNeeds {
  project: ProjectStatus;
  runs: ActivityRun[];
  states: DjinnState[];
  held: ActivityRun[];
  asks: ActivityRun[];
  failed: DjinnState[];
  stuck: Array<{ run: ActivityRun; size: string }>;
  flagged: VigilRow[];
  unreadable: boolean;
}

function projectNeeds(clock: Clock, generatedAt: string, project: ProjectStatus): ProjectNeeds {
  const runs = activity([project], { withImported: false }).filter((run) => !isNoise(run));
  const states = project.rituals.filter((ritual) => isDjinn(ritual)).map((ritual) => djinnState(clock, project.name, ritual, runs));
  const flagged = project.vigils.filter((vigil) => vigil.flagged);
  // A stuck check of a flagged vigil shows on the vigil's card, so the run shows once.
  const flaggedChecks = new Set(flagged.map((vigil) => `vigil/${vigil.slug}`));
  const stuck = runs.flatMap((run) => {
    const size = stuckFor(run, generatedAt);
    return size === null || flaggedChecks.has(run.item) ? [] : [{ run, size }];
  });
  return {
    project,
    runs,
    states,
    held: runs.filter((run) => run.phase === "held"),
    asks: runs.filter((run) => asksYou(run)),
    failed: states.filter((state) => state.last !== null && isOpenFailure(state.last)),
    stuck,
    flagged,
    unreadable: project.error !== null,
  };
}

function needsSize(needs: ProjectNeeds): number {
  return needs.held.length + needs.asks.length + needs.failed.length + needs.stuck.length + needs.flagged.length + (needs.unreadable ? 1 : 0);
}

export interface NeedCounts {
  /** The things that need the operator over the projects home counts: the number in the verdict and on the Home badge. */
  total: number;
  /** The same count for each project by name, self-test projects included (they never add to the total). */
  byProject: Record<string, number>;
}

/** The things that need the operator, per project and in total: what the verdict says and the badges show. */
export function needCounts(status: HostStatus): NeedCounts {
  const clock: Clock = { now: Date.parse(status.generatedAt), today: status.today, offset: status.utcOffset };
  const byProject: Record<string, number> = {};
  let total = 0;
  for (const project of status.projects) {
    const size = needsSize(projectNeeds(clock, status.generatedAt, project));
    byProject[project.name] = size;
    if (!isSelftest(project.name)) total += size;
  }
  return { total, byProject };
}

/** "3 things need you", for the badge title. */
export function needsText(count: number): string {
  return count === 1 ? "1 thing needs you" : `${count} things need you`;
}

// --- Up next -------------------------------------------------------------------------------

/** Rows of Up next before the "more" links. */
const UP_NEXT_SHOWN = 6;

interface UpEntry {
  /** 0 overdue, 1 manual due today, 2 djinn due now, 3 a later djinn start. */
  rank: number;
  /** Overdue days (largest first) or the start date (earliest first). */
  order: string;
  line: DjinnLine;
  project: string;
}

function padDays(days: number): string {
  return String(1_000_000 - days).padStart(7, "0");
}

function djinnEntry(clock: Clock, state: DjinnState): UpEntry | null {
  const { project, ritual } = state;
  const base = { key: `${project}/${ritual.slug}`, title: ritual.title, href: ritualPath(project, ritual.slug) };
  const detail: Piece[] = [{ text: project, ink: "plain" }];
  if (state.missed) return { rank: 0, order: padDays(ritual.overdueDays), project, line: { ...base, tone: "late", word: `Overdue ${plural(ritual.overdueDays, "day")}`, detail } };
  if (state.next === null) return null;
  if (state.next === "now") return { rank: 2, order: "", project, line: { ...base, tone: "gold", word: "Due now", detail } };
  return { rank: 3, order: state.next, project, line: { ...base, tone: "idle", word: `Next ${aheadText(clock, state.next)}`, detail } };
}

/** A manual ritual (mode off, active) that is overdue or due today. */
function manualEntry(project: string, ritual: RitualRow): UpEntry | null {
  if (ritual.lifecycle !== "active" || ritual.mode !== "off") return null;
  const base = { key: `${project}/${ritual.slug}`, title: ritual.title, href: ritualPath(project, ritual.slug) };
  const detail: Piece[] = [{ text: project, ink: "plain" }];
  if (ritual.overdueDays > 0) return { rank: 0, order: padDays(ritual.overdueDays), project, line: { ...base, tone: "late", word: `Overdue ${plural(ritual.overdueDays, "day")}`, detail } };
  if (ritual.isDue) return { rank: 1, order: "", project, line: { ...base, tone: "gold", word: "Due today", detail } };
  return null;
}

function byEntry(left: UpEntry, right: UpEntry): number {
  return left.rank - right.rank || left.order.localeCompare(right.order) || left.line.title.localeCompare(right.line.title);
}

function upNext(clock: Clock, all: readonly ProjectNeeds[]): UpNext {
  const entries = all
    .flatMap((needs) => [...needs.states.map((state) => djinnEntry(clock, state)), ...needs.project.rituals.map((ritual) => manualEntry(needs.project.name, ritual))])
    .filter((entry) => entry !== null)
    .toSorted(byEntry);
  const hidden = new Map<string, number>();
  for (const entry of entries.slice(UP_NEXT_SHOWN)) hidden.set(entry.project, (hidden.get(entry.project) ?? 0) + 1);
  return {
    lines: entries.slice(0, UP_NEXT_SHOWN).map((entry) => entry.line),
    more: [...hidden].map(([project, count]) => ({ project, count, href: projectPath(project) })),
  };
}

/** Overdue djinns and overdue manual rituals: the "overdue" segment of the strip. */
function overdueCount(all: readonly ProjectNeeds[]): number {
  return all.reduce((sum, needs) => {
    const manual = needs.project.rituals.filter((ritual) => ritual.lifecycle === "active" && ritual.mode === "off" && ritual.overdueDays > 0).length;
    return sum + manual + needs.states.filter((state) => state.missed).length;
  }, 0);
}

// --- the page ------------------------------------------------------------------------------

function verdictTone(needs: readonly Card[]): Tone {
  const kinds = new Set(needs.map((card) => card.kind));
  if (kinds.has("failed") || kinds.has("flagged") || kinds.has("unreadable")) return "bad";
  if (kinds.has("held") || kinds.has("asks")) return "wait";
  return kinds.has("stuck") ? "late" : "ok";
}

function quietText(clock: Clock, states: readonly DjinnState[]): string {
  if (states.length === 0) return "Quiet. darius runs no djinn yet.";
  const last = states
    .map((state) => state.last)
    .filter((run) => run !== null)
    .toSorted((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
  if (last === undefined) return "Quiet. No djinn has run yet.";
  if (last.phase === "running") return `Quiet. A djinn is running, it started ${whenPhrase(clock, last.startedAt)}.`;
  if (last.outcome === "complete") return `Quiet. The last djinn ran ${whenPhrase(clock, last.startedAt)} and completed.`;
  const seen = last.acknowledged === null ? "" : ", acknowledged";
  return `Quiet. The last djinn ran ${whenPhrase(clock, last.startedAt)} and ended ${last.outcome ?? "without an outcome"}${seen}.`;
}

/** The segment of one card kind: its count and a link to the first card. Nothing when there is no such card. */
function cardSegment(needs: readonly Card[], kind: CardKind, label: string, tone: Tone): Segment[] {
  const cards = needs.filter((card) => card.kind === kind);
  const first = cards[0];
  return first === undefined ? [] : [{ key: kind, label, count: cards.length, tone, href: `#${first.id}`, live: false }];
}

/**
 * The status strip. "Need you" always shows (held runs and runs that ask);
 * every other segment shows only above zero: running (not the stuck ones),
 * stuck, failed, flagged, unreadable and overdue.
 */
function statusStrip(needs: readonly Card[], running: number, overdue: number): Segment[] {
  const waiting = needs.filter((card) => card.kind === "held" || card.kind === "asks").length;
  const runningSegment: Segment[] = running === 0 ? [] : [{ key: "running", label: "running", count: running, tone: "run", href: "#now", live: true }];
  const overdueSegment: Segment[] = overdue === 0 ? [] : [{ key: "overdue", label: "overdue", count: overdue, tone: "late", href: "#upnext", live: false }];
  return [
    { key: "need", label: "need you", count: waiting, tone: "wait", href: waiting === 0 ? null : "#needs", live: false },
    ...runningSegment,
    ...cardSegment(needs, "stuck", "stuck", "late"),
    ...cardSegment(needs, "failed", "failed", "bad"),
    ...cardSegment(needs, "flagged", "flagged", "bad"),
    ...cardSegment(needs, "unreadable", "unreadable", "bad"),
    ...overdueSegment,
  ];
}

function newest(left: ActivityRun, right: ActivityRun): number {
  return right.startedAt.localeCompare(left.startedAt);
}

function nowRun(run: ActivityRun): NowRun {
  return { id: run.run, title: run.label, project: run.project, href: runPath(run.project, run.run), startedAt: run.startedAt, who: run.who };
}

export function homeView(status: HostStatus, readRun: ReadRun): Home {
  const clock: Clock = { now: Date.parse(status.generatedAt), today: status.today, offset: status.utcOffset };
  const all = status.projects.filter((project) => !isSelftest(project.name)).map((project) => projectNeeds(clock, status.generatedAt, project));
  const states = all.flatMap((needs) => needs.states);
  const runs = all.flatMap((needs) => needs.runs).toSorted(newest);

  const needs: Card[] = [
    ...all.flatMap((entry) => entry.held).toSorted(newest).map((run) => heldCard(clock, run)),
    ...all.flatMap((entry) => entry.asks).toSorted(newest).map((run) => asksCard(clock, readRun, run)),
    ...all.flatMap((entry) => entry.failed).flatMap((state) => (state.last === null ? [] : [finishedCard(clock, readRun, state, state.last)])),
    ...all.flatMap((entry) => entry.stuck).toSorted((left, right) => newest(left.run, right.run)).map(({ run, size }) => stuckCard(clock, run, size)),
    ...all.flatMap((entry) => entry.flagged.map((vigil) => flaggedCard(clock, entry.project, vigil, runs, status.generatedAt))),
    ...all.filter((entry) => entry.unreadable).map((entry) => unreadableCard(entry.project)),
  ];
  const lastNight = states
    .filter((state) => state.last !== null && isDone(state.last) && clock.now - Date.parse(state.last.startedAt) < DAY)
    .toSorted((left, right) => (right.last?.startedAt ?? "").localeCompare(left.last?.startedAt ?? ""))
    .flatMap((state) => (state.last === null ? [] : [finishedCard(clock, readRun, state, state.last)]));
  const now = runs.filter((run) => run.phase === "running" && stuckFor(run, status.generatedAt) === null).map((run) => nowRun(run));

  return {
    verdict: verdictText(needs.length),
    tone: verdictTone(needs),
    sub: `${dayName(status.generatedAt, clock.offset)}, ${clockTime(status.generatedAt, clock.offset)}.${nextSentence(clock, states)}`,
    strip: statusStrip(needs, now.length, overdueCount(all)),
    now,
    needs,
    quiet: quietText(clock, states),
    lastNight,
    upNext: upNext(clock, all),
    health: [timerPiece(clock, status, states), syncPiece(clock, status)],
    djinns: states.map((state) => djinnLine(clock, status.generatedAt, state)).toSorted((left, right) => LINE_ORDER[left.tone] - LINE_ORDER[right.tone]),
  };
}

// --- the self-test line --------------------------------------------------------------------

export interface SelftestLine {
  text: string;
  href: string;
}

/** "Self-test: heartbeat ran 12 h ago. 1 vigil flagged." for each self-test project on this host. */
export function selftestLines(status: HostStatus): SelftestLine[] {
  const clock: Clock = { now: Date.parse(status.generatedAt), today: status.today, offset: status.utcOffset };
  return status.projects
    .filter((project) => isSelftest(project.name))
    .map((project) => {
      const href = projectPath(project.name);
      if (project.error !== null) return { text: `Self-test: darius could not read ${project.name}.`, href };
      const last = project.runs.find((run) => run.who !== "import");
      const slug = last === undefined ? null : (last.item.split("/")[1] ?? last.item);
      const ran = (() => {
        if (last === undefined || slug === null) return "no run yet.";
        if (last.phase === "closed" && last.outcome === "complete") return `${slug} ran ${whenPhrase(clock, last.startedAt)}.`;
        return `${slug} ${runState(last).label.toLowerCase()}, started ${whenPhrase(clock, last.startedAt)}.`;
      })();
      const flagged = project.vigils.filter((vigil) => vigil.flagged).length;
      return { text: `Self-test: ${ran} ${flagged === 0 ? "Nothing flagged." : `${plural(flagged, "vigil")} flagged.`}`, href };
    });
}
