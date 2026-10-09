/**
 * The Overview, "the command board": one read of the status, across all
 * workspaces or for one (`HomeScope`), that answers the operator's questions in the order they matter.
 * Does anything need me (the verdict, the status strip and the Needs you
 * cards)? What runs now (the Now rows)? What is coming (Coming up, one
 * time-ordered list of every active ritual and every dated vigil, and Waiting
 * on an event, the vigils without a date; both built by `lib/agenda.ts`, which
 * the Rituals and Vigils sections draw; the Overview links there)? What happened last night (the Last night
 * cards)? Is darius itself healthy (one quiet line: Timer, Sync, last ritual
 * run)? Every value here comes from the status. The sub line under the verdict
 * is the date and time; the Next line under it names what is next.
 *
 * Three filters keep noise off the page. Only djinns (rituals darius runs
 * that follow a repo skill) get a line. Imported and acceptance runs never
 * show. The projects that test darius itself shrink to one line in the host line of Places, and
 * their flagged vigils never count as "needs you".
 *
 * The verdict counts things that need a person: held runs, runs whose result
 * asks a question, unacknowledged failures, stuck runs, flagged vigils and
 * unreadable projects. `needCounts` gives the same number per project and in
 * total, so the Places counts and the verdict cannot drift apart.
 *
 * A failed run that a person acknowledged (`darius run ack`) needs nobody
 * any more: it leaves Needs you and shows as a plain Last night card with
 * the acknowledgement, so the verdict stops saying "Failed", and its row in
 * Coming up says "Failed, acknowledged" in grey.
 *
 * A complete run whose result asks the operator something (0.22.0) is an
 * "Asks you" card, like a held run, until someone answers it in the card or
 * with `darius run ack --answer`. Then it is a plain Last night card with the
 * decision. Since 0.80.0 the card is the newest open ask of the ritual, and
 * older open asks fold under it.
 */

import type { HostStatus, MdBlock, ProjectStatus, ResultQuestion, RitualRow, RunDetail, RunRow, VigilRow, WorkspaceIcon } from "../../../src/web/api.ts";
import { buildAgenda, nextLine, vigilsDue, type Agenda, type NextLine } from "./agenda.ts";
import { answerCommand, clockTime, dayName, decideCommand, duration, hostDate, relativeDate, roughDuration, shortDate } from "./format.ts";
import { href } from "./paths.ts";
import { isManual, type Kind } from "./kind.ts";
import { ASKS_YOU, datePhrase, FLAGGED, RUNNING, WAITING_FOR_YOU } from "./state-words.ts";
import { outcomeTone, type Tone } from "./tone.ts";
import { ackText, activity, askStacks, asksYou, decisionText, excerpt, isDjinn, nextRunText, runState, stuckFor, type ActivityRun, type AskStack, type Excerpt } from "./view.ts";

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

/** One older open ask of the same ritual, to fold under the main card (0.80.0). */
export interface EarlierRun {
  run: string;
  /** "12 h ago" or "27 Sep". */
  when: string;
  summary: string | null;
  questions: ResultQuestion[];
}

/**
 * The questions of a result and what the answer form needs (0.80.0): the run
 * to answer, when the answer takes effect, whether "Send and run now" is
 * offered, the command for a terminal, and the older open asks of the ritual.
 */
export interface Ask {
  questions: ResultQuestion[];
  command: string;
  project: string;
  run: string;
  /** "Fri 16 Oct 09:00 Europe/Berlin", "on demand" or "due now". */
  nextRun: string;
  canRunNow: boolean;
  earlier: EarlierRun[];
}

/** The run an Acknowledge button names (a failed or abandoned run). */
export interface AckTarget {
  project: string;
  run: string;
}

export type CardKind = "held" | "asks" | "failed" | "stuck" | "flagged" | "unreadable" | "done";

/** One card in the main column: a thing that needs the operator, or a djinn that completed last night. */
export interface Card {
  id: string;
  kind: CardKind;
  /** What the card is about: a ritual or a vigil. Null for a project that cannot be read. */
  item: Kind | null;
  /** The ritual is done by hand (mode off): it reads "manual ritual" with the hand icon. */
  manual: boolean;
  /** The colour of the left border; null for a plain card. */
  edge: Tone | null;
  word: Piece;
  /** A line under the status word: when, or how long stuck. */
  side: Piece | null;
  title: string;
  href: string;
  /** The pieces of the meta line: project, who, how long. */
  meta: string[];
  meta2: string | null;
  questions: Question[];
  /** Set on an "Asks you" card. */
  ask: Ask | null;
  /** The run the Acknowledge button acknowledges (0.68.0): a failed card; null on any other card. An "Asks you" card has the answer form in `ask` instead (0.80.0). */
  ack: AckTarget | null;
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
  /** A `#card` on this page, a path to a section, or null when there is nowhere to go. */
  href: string | null;
  /** The segment shows the live animation while its count is above zero. */
  live: boolean;
  /** The kind whose icon marks the segment instead of a square; null for a state segment. */
  kind: Kind | null;
}

/** A run that runs now, for the Now rows. */
export interface NowRun {
  id: string;
  title: string;
  project: string;
  href: string;
  startedAt: string;
  who: string;
  kind: Kind;
  manual: boolean;
}

export interface Home {
  verdict: string;
  tone: Tone;
  /** "Wed 30 Sep, 18:32": the date and time only. */
  sub: string;
  /** The first item that is not late, for the Next line; null when nothing is dated. */
  next: NextLine | null;
  strip: Segment[];
  /** The runs that run now and are not stuck (a stuck run has its card in Needs you). */
  now: NowRun[];
  needs: Card[];
  lastNight: Card[];
  /** Coming up and Waiting on an event: the same agenda the project page draws. */
  agenda: Agenda;
  /** "Timer ok, last run 6 min ago. Synced 2 min ago. Last ritual run 18 h ago, complete." in parts, each in its own colour. */
  health: Piece[];
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
  /** The ritual's runs, newest first; `last` is the first. */
  own: ActivityRun[];
  /** Due since a day or more, not started today, nothing open: the timer did not start it. */
  missed: boolean;
}

function djinnState(clock: Clock, project: string, ritual: RitualRow, runs: readonly ActivityRun[]): DjinnState {
  const own = runs.filter((run) => run.project === project && run.item === `ritual/${ritual.slug}`);
  const last = own[0] ?? null;
  const waiting = ritual.heldRun !== null || ritual.openRun !== null;
  const ranToday = own.some((run) => hostDate(run.startedAt, clock.offset) === clock.today);
  const missed = ritual.isDue && ritual.overdueDays >= 1 && !waiting && !ranToday;
  return { project, ritual, last, own, missed };
}

// --- cards ---------------------------------------------------------------------------------

function blank(id: string, kind: CardKind, item: Kind | null, manual = false): Card {
  return { id, kind, item, manual, edge: null, word: { text: "", ink: "plain" }, side: null, title: "", href: "", meta: [], meta2: null, questions: [], ask: null, ack: null, report: null, fades: false, error: null, actions: [] };
}

function historyHref(run: ActivityRun): string {
  return run.item.startsWith("vigil/") ? href({ to: "vigil", ws: run.project, slug: run.slug }) : href({ to: "ritual", ws: run.project, slug: run.slug });
}

function heldCard(clock: Clock, run: ActivityRun): Card {
  return {
    ...blank(`held-${run.run}`, "held", run.kind, run.manual),
    edge: "wait",
    word: { text: WAITING_FOR_YOU.label, ink: WAITING_FOR_YOU.tone },
    side: { text: when(clock, run.startedAt), ink: "plain" },
    title: run.label,
    href: href({ to: "run", ws: run.project, run: run.run }),
    meta: [run.project, byText(run.who), run.questions.length === 0 ? null : plural(run.questions.length, "question")].filter((part) => part !== null),
    questions: run.questions.map((text, index) => ({ text, command: answerCommand(run.run, index + 1, run.project) })),
    actions: [{ text: "History", href: historyHref(run) }],
  };
}

/**
 * A complete run whose result asks the operator something: its questions,
 * the answer form's facts and the older open asks of the same ritual
 * (0.80.0). The main run is the newest open ask, which is not always the
 * newest run: a later run that asked nothing leaves the older ask open.
 */
function asksCard(clock: Clock, readRun: ReadRun, stack: AskStack<ActivityRun>, ritual: RitualRow | undefined): Card {
  const run = stack.main;
  const count = run.result?.questions ?? 0;
  const result = readRun(run.project, run.run)?.result ?? null;
  const earlier = stack.earlier.map((older): EarlierRun => {
    const detail = readRun(older.project, older.run)?.result ?? null;
    return { run: older.run, when: when(clock, older.endedAt ?? older.startedAt), summary: detail === null ? null : detail.summary, questions: detail === null ? [] : detail.questions };
  });
  return {
    ...blank(`asks-${run.run}`, "asks", run.kind, run.manual),
    edge: "wait",
    word: { text: ASKS_YOU.label, ink: ASKS_YOU.tone },
    side: { text: when(clock, run.endedAt ?? run.startedAt), ink: "plain" },
    title: run.label,
    href: href({ to: "run", ws: run.project, run: run.run }),
    meta: [run.project, byText(run.who), plural(count, "question")],
    meta2: result === null ? null : result.summary,
    ask: { questions: result === null ? [] : result.questions, command: decideCommand(run.run, run.project), project: run.project, run: run.run, nextRun: nextRunText(ritual, clock), canRunNow: run.kind === "ritual", earlier },
    actions: [
      { text: "Open the run", href: href({ to: "run", ws: run.project, run: run.run }) },
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
function isDone(run: RunRow, runs: readonly RunRow[]): boolean {
  if (asksYou(run, runs)) return false;
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
  const badge = runState(run, state.own);
  const report = failed ? reportOf(readRun, run, NEED_CHARS, NEED_FADE) : reportOf(readRun, run, DONE_CHARS, DONE_FADE);
  // An acknowledged failure is a plain card: runState() makes its word grey, and the acknowledgement says who saw it.
  return {
    ...blank(`${failed ? "failed" : "done"}-${state.project}-${state.ritual.slug}`, failed ? "failed" : "done", "ritual", isManual(state.ritual)),
    edge: failed ? "bad" : null,
    word: { text: badge.label, ink: badge.tone },
    side: { text: when(clock, run.startedAt), ink: "plain" },
    title: state.ritual.title,
    href: href({ to: "run", ws: run.project, run: run.run }),
    meta: [state.project, byText(run.who), tookText(run)].filter((part) => part !== null),
    meta2: seenText(run, clock),
    // `darius run ack` takes a failed or abandoned run; the other bad outcomes (a refused start) it does not, so they get no button.
    ack: failed && (run.outcome === "failed" || run.outcome === "abandoned") ? { project: run.project, run: run.run } : null,
    ...report,
    actions: [
      { text: run.findingsSha === null ? "Open the run" : "Read the report", href: href({ to: "run", ws: run.project, run: run.run }) },
      { text: "History", href: href({ to: "ritual", ws: state.project, slug: state.ritual.slug }) },
    ],
  };
}

function stuckCard(clock: Clock, run: ActivityRun, stuck: string): Card {
  return {
    ...blank(`stuck-${run.run}`, "stuck", run.kind, run.manual),
    edge: "late",
    word: { text: RUNNING.label, ink: RUNNING.tone },
    side: { text: `stuck, ${stuck}`, ink: "late" },
    title: run.label,
    href: href({ to: "run", ws: run.project, run: run.run }),
    meta: [run.project, byText(run.who), `started ${startedText(clock, run.startedAt)}`],
    actions: [
      { text: "Open the run", href: href({ to: "run", ws: run.project, run: run.run }) },
      { text: "History", href: historyHref(run) },
    ],
  };
}

function vigilWaitText(vigil: VigilRow, today: string): string[] {
  return [vigil.due === null ? null : `due ${relativeDate(vigil.due, today)}`, vigil.until === null ? null : `waits for ${vigil.until}`].filter((part) => part !== null);
}

function flaggedCard(clock: Clock, project: ProjectStatus, vigil: VigilRow, runs: readonly ActivityRun[], generatedAt: string): Card {
  const check = runs.find((run) => run.project === project.name && run.item === `vigil/${vigil.slug}` && run.phase === "running");
  const meta = [project.name, vigil.lastOutcome === null ? null : `last check ${vigil.lastOutcome}`, ...vigilWaitText(vigil, clock.today)].filter((part) => part !== null);
  const size = check === undefined ? 0 : clock.now - Date.parse(check.startedAt);
  return {
    ...blank(`flagged-${project.name}-${vigil.slug}`, "flagged", "vigil"),
    edge: "bad",
    word: { text: FLAGGED.label, ink: FLAGGED.tone },
    title: vigil.title,
    href: href({ to: "vigil", ws: project.name, slug: vigil.slug }),
    meta,
    meta2: check === undefined ? null : `A new check is running, ${byText(check.who)}, ${roughDuration(size)} so far.${stuckFor(check, generatedAt) === null ? "" : " It may be stuck."}`,
    actions: [{ text: "Open the vigil", href: href({ to: "vigil", ws: project.name, slug: vigil.slug }) }],
  };
}

function unreadableCard(project: ProjectStatus): Card {
  return {
    ...blank(`unreadable-${project.name}`, "unreadable", null),
    edge: "bad",
    word: { text: "Unreadable", ink: "bad" },
    title: project.name,
    href: href({ to: "overview", ws: project.name }),
    meta: ["darius could not read this project"],
    error: project.error,
    actions: [{ text: "Open the workspace", href: href({ to: "overview", ws: project.name }) }],
  };
}

// --- health --------------------------------------------------------------------------------

/**
 * The run-due timer, which fires every 15 minutes. The status has no timer log, so the line reads
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
  asks: Array<AskStack<ActivityRun>>;
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
    asks: askStacks(runs),
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
  /** The things that need the operator over the workspaces the all-workspaces Overview counts: the number in its verdict. */
  total: number;
  /** The same count for each project by name, self-test projects included (they add to the total only when the operator shows them). */
  byProject: Record<string, number>;
}

/** The things that need the operator, per project and in total: what the verdict says and the badges show. */
export function needCounts(status: HostStatus, includeSelftest = false): NeedCounts {
  const clock: Clock = { now: Date.parse(status.generatedAt), today: status.today, offset: status.utcOffset };
  const byProject: Record<string, number> = {};
  let total = 0;
  for (const project of status.projects) {
    const size = needsSize(projectNeeds(clock, status.generatedAt, project));
    byProject[project.name] = size;
    if (includeSelftest || !isSelftest(project.name)) total += size;
  }
  return { total, byProject };
}

/** "3 things need you", for the badge title. */
export function needsText(count: number): string {
  return count === 1 ? "1 thing needs you" : `${count} things need you`;
}

// --- the page ------------------------------------------------------------------------------

function verdictTone(needs: readonly Card[]): Tone {
  const kinds = new Set(needs.map((card) => card.kind));
  if (kinds.has("failed") || kinds.has("flagged") || kinds.has("unreadable")) return "bad";
  if (kinds.has("held") || kinds.has("asks")) return "wait";
  return kinds.has("stuck") ? "late" : "ok";
}

/** "Last ritual run 18 h ago, complete." The newest run of any ritual; nothing when no ritual is tracked. */
function lastRunPiece(clock: Clock, states: readonly DjinnState[]): Piece[] {
  if (states.length === 0) return [];
  const last = states
    .map((state) => state.last)
    .filter((run) => run !== null)
    .toSorted((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
  if (last === undefined) return [{ text: " No ritual has run yet.", ink: "mute" }];
  const state = runState(last, states.flatMap((entry) => entry.own));
  return [{ text: ` Last ritual run ${when(clock, last.startedAt)}, ${state.label.toLowerCase()}.`, ink: state.tone === "bad" ? "bad" : "plain" }];
}

/** The segment of one card kind: its count and a link to the first card. Nothing when there is no such card. */
function cardSegment(needs: readonly Card[], kind: CardKind, label: string, tone: Tone): Segment[] {
  const cards = needs.filter((card) => card.kind === kind);
  const first = cards[0];
  return first === undefined ? [] : [{ key: kind, label, count: cards.length, tone, href: `#${first.id}`, live: false, kind: null }];
}

/**
 * The status strip. A segment shows only above zero, and the strip not at all
 * when every segment is zero. The order: need you (held runs and runs that
 * ask), findings that need you, running (not the stuck ones), stuck, failed, flagged, unreadable, late
 * (rituals and dated vigils past due), due today, and vigils due (late or due
 * today, the number of the Vigils badge).
 */
function statusStrip(needs: readonly Card[], running: number, agenda: Agenda, workspace: string | null, findings: number, vigilsDueCount: number): Segment[] {
  const waiting = needs.filter((card) => card.kind === "held" || card.kind === "asks").length;
  const findingsHref = href({ to: "section", ws: workspace, section: "findings" });
  const findingsSegment: Segment[] = findings === 0 ? [] : [{ key: "findings", label: "findings", count: findings, tone: "wait", href: findingsHref, live: false, kind: null }];
  const runningSegment: Segment[] = running === 0 ? [] : [{ key: "running", label: "running", count: running, tone: "run", href: "#now", live: true, kind: null }];
  const needSegment: Segment[] = waiting === 0 ? [] : [{ key: "need", label: "need you", count: waiting, tone: "wait", href: "#needs", live: false, kind: null }];
  const lateSegment: Segment[] = agenda.overdue === 0 ? [] : [{ key: "late", label: "late", count: agenda.overdue, tone: "late", href: groupHref(agenda, "overdue", workspace), live: false, kind: null }];
  const todaySegment: Segment[] = agenda.dueToday === 0 ? [] : [{ key: "today", label: "due today", count: agenda.dueToday, tone: "gold", href: groupHref(agenda, "today", workspace), live: false, kind: null }];
  const vigilsHref = `${href({ to: "section", ws: workspace, section: "vigils" })}#coming-up`;
  const vigilsSegment: Segment[] = vigilsDueCount === 0 ? [] : [{ key: "vigils", label: "vigils due", count: vigilsDueCount, tone: "gold", href: vigilsHref, live: false, kind: "vigil" }];
  return [
    ...needSegment,
    ...findingsSegment,
    ...runningSegment,
    ...cardSegment(needs, "stuck", "stuck", "late"),
    ...cardSegment(needs, "failed", "failed", "bad"),
    ...cardSegment(needs, "flagged", "flagged", "bad"),
    ...cardSegment(needs, "unreadable", "unreadable", "bad"),
    ...lateSegment,
    ...todaySegment,
    ...vigilsSegment,
  ];
}

/** Where a day group of the agenda lives: the Rituals section when it holds a ritual, else the Vigils section. */
function groupHref(agenda: Agenda, kind: "overdue" | "today", workspace: string | null): string {
  const rows = agenda.groups.find((group) => group.kind === kind)?.rows ?? [];
  const section = rows.some((row) => row.kind === "ritual") ? "rituals" : "vigils";
  return `${href({ to: "section", ws: workspace, section: section })}#coming-up`;
}

function newest(left: ActivityRun, right: ActivityRun): number {
  return right.startedAt.localeCompare(left.startedAt);
}

function nowRun(run: ActivityRun): NowRun {
  return { id: run.run, title: run.label, project: run.project, href: href({ to: "run", ws: run.project, run: run.run }), startedAt: run.startedAt, who: run.who, kind: run.kind, manual: run.manual };
}

/** What an Overview covers: one workspace (whatever it is), or all of them without the self-test one unless it is shown. */
export interface HomeScope {
  workspace: string | null;
  includeSelftest: boolean;
}

export const ALL_WORKSPACES: HomeScope = { workspace: null, includeSelftest: false };

/** The projects an Overview covers. */
export function scopeProjects(status: HostStatus, scope: HomeScope): ProjectStatus[] {
  if (scope.workspace !== null) return status.projects.filter((project) => project.name === scope.workspace);
  return status.projects.filter((project) => scope.includeSelftest || !isSelftest(project.name));
}

export function homeView(status: HostStatus, readRun: ReadRun, scope: HomeScope = ALL_WORKSPACES): Home {
  const clock: Clock = { now: Date.parse(status.generatedAt), today: status.today, offset: status.utcOffset };
  const scoped = scopeProjects(status, scope);
  const all = scoped.map((project) => projectNeeds(clock, status.generatedAt, project));
  const states = all.flatMap((needs) => needs.states);
  const runs = all.flatMap((needs) => needs.runs).toSorted(newest);

  const needs: Card[] = [
    ...all.flatMap((entry) => entry.held).toSorted(newest).map((run) => heldCard(clock, run)),
    ...all
      .flatMap((entry) => entry.asks.map((stack) => ({ stack, ritual: entry.project.rituals.find((candidate) => `ritual/${candidate.slug}` === stack.main.item) })))
      .toSorted((left, right) => newest(left.stack.main, right.stack.main))
      .map(({ stack, ritual }) => asksCard(clock, readRun, stack, ritual)),
    ...all.flatMap((entry) => entry.failed).flatMap((state) => (state.last === null ? [] : [finishedCard(clock, readRun, state, state.last)])),
    ...all.flatMap((entry) => entry.stuck).toSorted((left, right) => newest(left.run, right.run)).map(({ run, size }) => stuckCard(clock, run, size)),
    ...all.flatMap((entry) => entry.flagged.map((vigil) => flaggedCard(clock, entry.project, vigil, runs, status.generatedAt))),
    ...all.filter((entry) => entry.unreadable).map((entry) => unreadableCard(entry.project)),
  ];
  const lastNight = states
    .filter((state) => state.last !== null && isDone(state.last, state.own) && clock.now - Date.parse(state.last.startedAt) < DAY)
    .toSorted((left, right) => (right.last?.startedAt ?? "").localeCompare(left.last?.startedAt ?? ""))
    .flatMap((state) => (state.last === null ? [] : [finishedCard(clock, readRun, state, state.last)]));
  const agenda = buildAgenda({ projects: all.map((entry) => entry.project), today: clock.today });
  const now = runs.filter((run) => run.phase === "running" && stuckFor(run, status.generatedAt) === null).map((run) => nowRun(run));

  return {
    verdict: verdictText(needs.length),
    tone: verdictTone(needs),
    sub: `${dayName(status.generatedAt, clock.offset)}, ${clockTime(status.generatedAt, clock.offset)}`,
    next: nextLine(agenda, clock.today),
    strip: statusStrip(needs, now.length, agenda, scope.workspace, scoped.reduce((sum, project) => sum + project.findings.needsYou, 0), vigilsDue(scoped, clock.today)),
    now,
    needs,
    lastNight,
    agenda,
    health: [timerPiece(clock, status, states), syncPiece(clock, status), ...lastRunPiece(clock, states)],
  };
}

// --- the workspace rows --------------------------------------------------------------------

/** The next dated item of a workspace: what it is, the YYYY-MM-DD it comes up on, and that day in words. */
export interface WorkspaceNext {
  title: string;
  date: string;
  /** "today", "tomorrow", "Fri 2 Oct" or "15 Nov". */
  when: string;
}

/** One row of the Workspaces list on the all-workspaces Overview. */
export interface WorkspaceRow {
  name: string;
  /** The things that need the operator here: the same count as the verdict and the badges. */
  needs: number;
  /** darius could not read the workspace; `needs` then counts it as one. */
  unreadable: boolean;
  /** The first dated item that is not late; null when there is none. */
  next: WorkspaceNext | null;
  /** The Overview of the workspace. */
  href: string;
  /** The icon its marker names; null when it has none or is unreadable. */
  icon: WorkspaceIcon | null;
}

/** The icon a workspace shows: none when darius could not read it, or when the status has none. */
export function workspaceIcon(project: ProjectStatus): WorkspaceIcon | null {
  return project.error === null ? (project.icon ?? null) : null;
}

/**
 * One row per workspace in the scope, the ones that need you first (most
 * first), then by name. A workspace that cannot be read has no next item.
 */
export function workspaceRows(status: HostStatus, scope: HomeScope = ALL_WORKSPACES): WorkspaceRow[] {
  const clock: Clock = { now: Date.parse(status.generatedAt), today: status.today, offset: status.utcOffset };
  const rows = scopeProjects(status, scope).map((project): WorkspaceRow => {
    const needs = projectNeeds(clock, status.generatedAt, project);
    const row = project.error === null ? buildAgenda({ projects: [project], today: clock.today }).next : null;
    const next = row === null || row.date === null ? null : { title: row.title, date: row.date, when: datePhrase(clock.today, row.date) };
    return { name: project.name, needs: needsSize(needs), unreadable: needs.unreadable, next, href: href({ to: "overview", ws: project.name }), icon: workspaceIcon(project) };
  });
  return rows.toSorted((left, right) => right.needs - left.needs || left.name.localeCompare(right.name));
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
      const link = href({ to: "overview", ws: project.name });
      if (project.error !== null) return { text: `Self-test: darius could not read ${project.name}.`, href: link };
      const last = project.runs.find((run) => run.who !== "import");
      const slug = last === undefined ? null : (last.item.split("/")[1] ?? last.item);
      const ran = (() => {
        if (last === undefined || slug === null) return "no run yet.";
        if (last.phase === "closed" && last.outcome === "complete") return `${slug} ran ${whenPhrase(clock, last.startedAt)}.`;
        return `${slug} ${runState(last, project.runs).label.toLowerCase()}, started ${whenPhrase(clock, last.startedAt)}.`;
      })();
      const flagged = project.vigils.filter((vigil) => vigil.flagged).length;
      return { text: `Self-test: ${ran} ${flagged === 0 ? "Nothing flagged." : `${plural(flagged, "vigil")} flagged.`}`, href: link };
    });
}
