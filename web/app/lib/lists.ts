/**
 * The row grammar of the lists (0.142.0, words of 0.143.0): the rituals of
 * a machine, the runs by day, the mark of a run that did not start the
 * default way, the "Next" text of a ritual and the workspaces a machine
 * runs. Every list says its order in its heading. Pure, so the server and
 * the browser agree.
 */

import type { FleetDjinn, FleetLast, FleetWorkspace, HostOpenRun, RunRow } from "../../../src/web/api.ts";
import { clockTime, dayGap, dayName, hostDate, nextDay, roughDuration } from "./format.ts";
import { HEALTHS, healthWord } from "./fleet.ts";
import type { NeedPart } from "./home.ts";
import { LABELS, STATE_WORDS } from "./terms.ts";
import { outcomeTone, type Badge } from "./tone.ts";

// --- the rituals of a machine --------------------------------------------------------------------

/** An open question of a run: how many questions, and since when. */
export interface OpenAsk {
  questions: number;
  at: string;
}

/** A ritual that darius starts on a machine, with its workspace. */
export interface PlacedRitual {
  workspace: string;
  ritual: FleetDjinn;
  /** Its last run waits for an answer: held, or closed complete with a question nobody answered. Null when it does not. */
  ask: OpenAsk | null;
}

/** A closed outcome that counts as a failure. */
function failedLast(ritual: FleetDjinn): boolean {
  const outcome = ritual.lastOutcome;
  return outcome !== null && outcome !== "running" && outcome !== "held" && outcomeTone(outcome) === "bad";
}

/** Why a ritual needs a look, most urgent first; null for a ritual on schedule. Running and due today are on schedule. */
export type RitualProblem = "waits" | "failed" | "late";

export function ritualProblem(placed: PlacedRitual): RitualProblem | null {
  const { ritual } = placed;
  if (ritual.state === "held" || placed.ask !== null) return "waits";
  if (ritual.state === "running") return null;
  if (failedLast(ritual)) return "failed";
  if (ritual.state === "late") return "late";
  return null;
}

/** The due time as a sort key; a ritual with no schedule sorts last. */
function nextKey(placed: PlacedRitual): string {
  return placed.ritual.nextDueAt ?? placed.ritual.nextDue ?? "\uffff";
}

/** Code-point order: ISO times and dates sort by time, and the no-schedule key sorts after both. */
function byText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** The same ritual always lands in the same place: by workspace and slug, never by title. */
function byKey(left: PlacedRitual, right: PlacedRitual): number {
  return left.workspace.localeCompare(right.workspace) || left.ritual.slug.localeCompare(right.ritual.slug);
}

/** The rituals on schedule: next due first (one with no schedule last), then by workspace and slug. */
export function onSchedule(rituals: readonly PlacedRitual[]): PlacedRitual[] {
  return rituals.filter((one) => ritualProblem(one) === null).toSorted((left, right) => byText(nextKey(left), nextKey(right)) || byKey(left, right));
}

/** The rituals that need a look, by kind (waits, failed, late), then the oldest due first. */
export function withProblems(rituals: readonly PlacedRitual[]): Array<PlacedRitual & { problem: RitualProblem }> {
  const order: readonly RitualProblem[] = ["waits", "failed", "late"];
  return rituals
    .flatMap((one) => {
      const problem = ritualProblem(one);
      return problem === null ? [] : [Object.assign({ problem }, one)];
    })
    .toSorted((left, right) => order.indexOf(left.problem) - order.indexOf(right.problem) || byText(nextKey(left), nextKey(right)) || byKey(left, right));
}

/** "On schedule (9 of 11)": the rituals on schedule of all that darius starts here; the others are the ones above. "On schedule (11)" when all are. */
export function onScheduleTitle(quiet: number, rituals: number): string {
  return quiet === rituals ? `${LABELS.onSchedule} (${String(rituals)})` : `${LABELS.onSchedule} (${String(quiet)} of ${String(rituals)})`;
}

/** The "Next" cell of a ritual: when it is due next, or how late it is, with the full local moment for a title. */
export interface NextText {
  text: string;
  /** Late: the text is "late by 2 d" in the late tone. */
  late: boolean;
  /** "Thu 26 Nov 07:00"; null when only a day is known. */
  title: string | null;
}

/**
 * When a ritual runs next, for its "Next" cell. The future is always a day
 * word and a time: "today 14:00", "tomorrow 07:00", "Mon 07:00" within six
 * days, "Mon 7 Dec 07:00" later. Late: "late by 1 d". Due and past: "due
 * now". No schedule: null.
 */
export function nextText(ritual: Pick<FleetDjinn, "state" | "nextDueAt" | "nextDue">, clock: { now: number; today: string; offset: number }): NextText | null {
  const { now, today, offset } = clock;
  if (ritual.nextDueAt === null) {
    if (ritual.nextDue === null) return null;
    const days = dayGap(today, ritual.nextDue);
    if (days < 0) return { text: `late by ${String(-days)} d`, late: ritual.state === "late", title: null };
    if (days === 0) return { text: "today", late: false, title: null };
    return { text: days === 1 ? "tomorrow" : dayName(`${ritual.nextDue}T12:00:00.000Z`, 0), late: false, title: null };
  }
  const at = Date.parse(ritual.nextDueAt);
  if (Number.isNaN(at)) return null;
  const title = fullMoment(ritual.nextDueAt, offset);
  if (ritual.state === "late") return { text: `late by ${roughDuration(Math.max(0, now - at))}`, late: true, title };
  if (at <= now) return { text: "due now", late: false, title };
  const date = hostDate(ritual.nextDueAt, offset);
  const time = clockTime(ritual.nextDueAt, offset);
  if (date === today) return { text: `today ${time}`, late: false, title };
  if (date === nextDay(today)) return { text: `tomorrow ${time}`, late: false, title };
  const day = dayName(ritual.nextDueAt, offset);
  return { text: dayGap(today, date) <= 6 ? `${day.split(" ")[0] ?? day} ${time}` : `${day} ${time}`, late: false, title };
}

// --- the runs by day ------------------------------------------------------------------------

/** The runs of one day of the host's calendar, newest first. */
export interface DayGroup<T> {
  /** YYYY-MM-DD on the host's clock. */
  date: string;
  /** "Today", "Yesterday", "Mon 23 Nov". */
  label: string;
  runs: T[];
}

/** The label of a day: "Today", "Yesterday", or "Mon 23 Nov". */
export function dayLabel(date: string, today: string): string {
  const gap = dayGap(date, today);
  if (gap === 0) return "Today";
  if (gap === 1) return "Yesterday";
  return dayName(`${date}T12:00:00.000Z`, 0);
}

/** Runs grouped by the host's day: the newest day first, the newest run first inside a day. */
export function groupByDay<T extends { startedAt: string }>(runs: readonly T[], clock: { today: string; offset: number }): DayGroup<T>[] {
  const days = new Map<string, T[]>();
  for (const run of runs.toSorted((left, right) => right.startedAt.localeCompare(left.startedAt))) {
    const date = hostDate(run.startedAt, clock.offset);
    days.set(date, [...(days.get(date) ?? []), run]);
  }
  return [...days.entries()].toSorted(([left], [right]) => right.localeCompare(left)).map(([date, list]) => ({ date, label: dayLabel(date, clock.today), runs: list }));
}

/** The Time cell of a run: "07:00" today; with `withDay`, "Tue 07:00" on another day. */
export function runClock(iso: string, clock: { today: string; offset: number }, withDay: boolean): string {
  const time = clockTime(iso, clock.offset);
  if (!withDay || hostDate(iso, clock.offset) === clock.today) return time;
  return `${dayName(iso, clock.offset).split(" ")[0] ?? ""} ${time}`;
}

/** The absolute local moment for a title: "Thu 26 Nov 07:00". */
export function fullMoment(iso: string, offset: number): string {
  return `${dayName(iso, offset)} ${clockTime(iso, offset)}`;
}

// --- the mark of a run ------------------------------------------------------------------------

/** One small muted mark after a run title; `run` makes the mark end in a link to that run. */
export interface RunMark {
  text: string;
  run?: string;
}

/**
 * What is not the default about a run: the default is a scheduled ritual
 * run that the timer started, and it has no mark. A vigil run says "vigil",
 * a ritual done by hand "manual", a follow-up "follow-up of" and its parent,
 * a start from the web "from the web", any other starter "by <name>".
 * An imported run says nothing here: its row has the "imported" chip.
 */
export function runMarks(run: Pick<RunRow, "who" | "startedBy" | "followUpOf"> & { kind: "ritual" | "vigil"; manual: boolean }): RunMark[] {
  const marks: RunMark[] = [];
  if (run.kind === "vigil") marks.push({ text: "vigil" });
  if (run.manual) marks.push({ text: "manual" });
  if (run.followUpOf !== null) marks.push({ text: "follow-up of", run: run.followUpOf });
  if (run.who === "import" || run.startedBy === "timer") return marks;
  marks.push({ text: run.startedBy === "web" ? "from the web" : `by ${run.who}` });
  return marks;
}

/** Show the Machine column: more than one machine has runs in the list. */
export function showsMachines(runs: readonly { host?: string | undefined }[]): boolean {
  return new Set(runs.map((run) => run.host ?? "")).size > 1;
}

// --- the workspaces a machine runs -----------------------------------------------------------

/** A workspace a machine runs, as its row says it. */
export interface RunsHereRow {
  name: string;
  icon: FleetWorkspace["icon"];
  health: Badge;
  /** Its reasons, worst first: "2 vigils flagged"; empty for OK. */
  reasons: string[];
  /** The things that need you there: the one count of its badge in Places (`needCounts`), the sum of `needParts`. */
  needs: number;
  /** What that count is made of, by kind. */
  needParts: NeedPart[];
  /** The rituals darius starts for it on this machine. */
  rituals: number;
  openRuns: number;
  /** Its newest ritual run on this machine. */
  lastRun: FleetLast | null;
  /** The word of that run: its outcome, "running", or "waits for your answer". */
  lastWord: Badge | null;
}

/**
 * The workspaces a machine runs (its project folder is linked there), worst
 * health first, then by name; each with its rituals there, its open runs
 * there and its newest ritual run there. `asks` holds the runs that wait for
 * an answer (`project/run`), so a run reads the same word here as in the
 * ritual lists. `needs` holds what the need-you count of each workspace is
 * made of, from the root loader's source (`needCounts().partsByProject`), so
 * the Why cell and the badge in Places show one number and its parts.
 */
export function runsHereRows(name: string, workspaces: readonly FleetWorkspace[], lastRuns: readonly FleetLast[], openRuns: readonly Pick<HostOpenRun, "project">[], asks: ReadonlyMap<string, OpenAsk> = new Map(), needs: Readonly<Record<string, readonly NeedPart[]>> = {}): RunsHereRow[] {
  return workspaces
    .filter((workspace) => workspace.places.some((place) => place.host === name && place.kind === "checkout"))
    .toSorted((left, right) => HEALTHS.indexOf(left.health) - HEALTHS.indexOf(right.health) || left.name.localeCompare(right.name))
    .map((workspace) => {
      const last = lastRuns.filter((run) => run.project === workspace.name && run.host === name).toSorted((left, right) => right.at.localeCompare(left.at))[0] ?? null;
      const asked = last?.run !== undefined && asks.has(`${workspace.name}/${last.run}`);
      return {
        name: workspace.name,
        icon: workspace.icon,
        health: healthWord(workspace.health),
        reasons: workspace.health === "ok" ? [] : workspace.reasons,
        needs: (needs[workspace.name] ?? []).reduce((sum, part) => sum + part.count, 0),
        needParts: [...(needs[workspace.name] ?? [])],
        rituals: workspace.djinns.filter((ritual) => ritual.host === name).length,
        openRuns: openRuns.filter((run) => run.project === workspace.name).length,
        lastRun: last,
        lastWord: last === null ? null : lastRunWord(last.outcome, last.phase ?? null, asked),
      };
    });
}

/** A workspace a machine only keeps a copy of, with its health. */
export interface CopyRow {
  name: string;
  health: Badge;
}

/** The copies a machine keeps, by name. */
export function copyRows(name: string, workspaces: readonly FleetWorkspace[]): CopyRow[] {
  return workspaces
    .filter((workspace) => workspace.places.some((place) => place.host === name && place.kind === "copy"))
    .map((workspace) => ({ name: workspace.name, health: healthWord(workspace.health) }))
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

/**
 * The word of a last run, the same in every machine list: "running" while
 * it works, "waits for your answer" while it is held or when it closed with
 * a question nobody answered, else its outcome. An open run whose phase is
 * unknown (null outcome, no phase) reads "running".
 */
export function lastRunWord(outcome: string | null, phase: "running" | "held" | null = null, asks = false): Badge {
  if (phase === "held" || outcome === "held" || asks) return { tone: "wait", label: STATE_WORDS.waits };
  if (phase === "running" || outcome === null || outcome === "running") return { tone: "run", label: STATE_WORDS.running };
  return { tone: outcomeTone(outcome), label: outcome };
}
