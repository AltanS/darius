/**
 * The row grammar of the lists (0.142.0): the djinns of a machine, the
 * runs by day, the mark of a run that did not start the default way, the
 * "Next" text of a djinn and the workspaces a machine runs. Every list puts
 * its columns in one order (State, Name, Where, When, then extras) and says
 * its order in its heading. Pure, so the server and the browser agree.
 */

import type { FleetDjinn, FleetLast, FleetWorkspace, HostOpenRun, RunRow } from "../../../src/web/api.ts";
import { clockTime, dayGap, dayName, hostDate, nextDay, relativeTime, roughDuration } from "./format.ts";
import { HEALTHS, healthWord } from "./fleet.ts";
import { outcomeTone, type Badge } from "./tone.ts";

// --- the djinns of a machine -------------------------------------------------------------------

/** A djinn and the workspace it belongs to. */
export interface PlacedDjinn {
  workspace: string;
  djinn: FleetDjinn;
  /** Its last run closed complete with a question nobody answered yet. */
  asks: boolean;
}

/** A closed outcome that counts as a failure in a djinn's state. */
function failedLast(djinn: FleetDjinn): boolean {
  const outcome = djinn.lastOutcome;
  return outcome !== null && outcome !== "running" && outcome !== "held" && outcomeTone(outcome) === "bad";
}

/**
 * The state word of a djinn, its own state only: running, held, late, asks
 * you, failed (its last run failed), due today. Any other djinn is a muted
 * "ok": the outcome of its last run is in the Last run cell, not here.
 */
export function djinnStateWord(placed: PlacedDjinn): Badge {
  const { djinn } = placed;
  if (djinn.state === "running") return { tone: "run", label: "running" };
  if (djinn.state === "held") return { tone: "wait", label: "held" };
  if (djinn.state === "late") return { tone: "late", label: "late" };
  if (placed.asks) return { tone: "wait", label: "asks you" };
  if (failedLast(djinn)) return { tone: "bad", label: "failed" };
  if (djinn.state === "due") return { tone: "gold", label: "due today" };
  return { tone: "idle", label: "ok" };
}

/** A djinn needs a look: it runs, waits, is late, asks, failed its last run, or is due today. */
export function needsLook(placed: PlacedDjinn): boolean {
  const { djinn } = placed;
  return djinn.state !== "idle" || placed.asks || failedLast(djinn);
}

function byDueOldestFirst(left: PlacedDjinn, right: PlacedDjinn): number {
  return (left.djinn.nextDueAt ?? left.djinn.nextDue ?? "~").localeCompare(right.djinn.nextDueAt ?? right.djinn.nextDue ?? "~");
}

function byLastRunNewestFirst(left: PlacedDjinn, right: PlacedDjinn): number {
  return (right.djinn.lastAt ?? "").localeCompare(left.djinn.lastAt ?? "");
}

/** The same djinn always lands in the same place: by workspace and slug, never by title. */
function byKey(left: PlacedDjinn, right: PlacedDjinn): number {
  return left.workspace.localeCompare(right.workspace) || left.djinn.slug.localeCompare(right.djinn.slug);
}

/**
 * The order of every djinn list: first the ones that need a look, the
 * oldest due first; then all others by the date of their last run, newest
 * first (one that never ran last). Never by title.
 */
export function sortDjinns(djinns: readonly PlacedDjinn[]): PlacedDjinn[] {
  const look = djinns.filter(needsLook).toSorted((left, right) => byDueOldestFirst(left, right) || byKey(left, right));
  const rest = djinns.filter((one) => !needsLook(one)).toSorted((left, right) => byLastRunNewestFirst(left, right) || byKey(left, right));
  return [...look, ...rest];
}

/** The "Next" cell of a djinn: when it is due next, or how late it is. */
export interface NextText {
  text: string;
  /** Late: the text is "late by 2 d" in the late tone. */
  late: boolean;
}

/**
 * When a djinn runs next, for its "Next" cell. Late: "late by 1 d". Due
 * and past: "due now". Later today: "in 3 h". Tomorrow: "tomorrow 07:00".
 * Within six days: "Mon 07:00". Later: "Mon 7 Dec". No schedule: null.
 */
export function nextText(djinn: Pick<FleetDjinn, "state" | "nextDueAt" | "nextDue">, clock: { now: number; today: string; offset: number }): NextText | null {
  const { now, today, offset } = clock;
  if (djinn.nextDueAt === null) {
    if (djinn.nextDue === null) return null;
    const days = dayGap(today, djinn.nextDue);
    if (days < 0) return { text: `late by ${String(-days)} d`, late: djinn.state === "late" };
    if (days === 0) return { text: "today", late: false };
    return { text: days === 1 ? "tomorrow" : `in ${String(days)} d`, late: false };
  }
  const at = Date.parse(djinn.nextDueAt);
  if (Number.isNaN(at)) return null;
  if (djinn.state === "late") return { text: `late by ${roughDuration(Math.max(0, now - at))}`, late: true };
  if (at <= now) return { text: "due now", late: false };
  const date = hostDate(djinn.nextDueAt, offset);
  if (date === today) return { text: relativeTime(djinn.nextDueAt, now), late: false };
  const time = clockTime(djinn.nextDueAt, offset);
  if (date === nextDay(today)) return { text: `tomorrow ${time}`, late: false };
  const day = dayName(djinn.nextDueAt, offset);
  return dayGap(today, date) <= 6 ? { text: `${day.split(" ")[0] ?? day} ${time}`, late: false } : { text: day, late: false };
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
  /** The first of its reasons: "2 candles lit"; null when it has none. */
  reason: string | null;
  djinns: number;
  djinnsLate: number;
  openRuns: number;
  /** Its newest ritual run on this machine. */
  lastRun: FleetLast | null;
}

/**
 * The workspaces a machine runs (its project folder is linked there), worst
 * health first, then by name; each with its djinns there, its open runs
 * there and its newest ritual run there.
 */
export function runsHereRows(name: string, workspaces: readonly FleetWorkspace[], lastRuns: readonly FleetLast[], openRuns: readonly Pick<HostOpenRun, "project">[]): RunsHereRow[] {
  return workspaces
    .filter((workspace) => workspace.places.some((place) => place.host === name && place.kind === "checkout"))
    .toSorted((left, right) => HEALTHS.indexOf(left.health) - HEALTHS.indexOf(right.health) || left.name.localeCompare(right.name))
    .map((workspace) => {
      const djinns = workspace.djinns.filter((djinn) => djinn.host === name);
      const last = lastRuns.filter((run) => run.project === workspace.name && run.host === name).toSorted((left, right) => right.at.localeCompare(left.at))[0] ?? null;
      return {
        name: workspace.name,
        icon: workspace.icon,
        health: healthWord(workspace.health),
        reason: workspace.reasons[0] ?? null,
        djinns: djinns.length,
        djinnsLate: djinns.filter((djinn) => djinn.state === "late").length,
        openRuns: openRuns.filter((run) => run.project === workspace.name).length,
        lastRun: last,
      };
    });
}

/** A workspace a machine only shows a copy of, with its health. */
export interface CopyRow {
  name: string;
  health: Badge;
}

/** The copies a machine shows, by name. */
export function copyRows(name: string, workspaces: readonly FleetWorkspace[]): CopyRow[] {
  return workspaces
    .filter((workspace) => workspace.places.some((place) => place.host === name && place.kind === "copy"))
    .map((workspace) => ({ name: workspace.name, health: healthWord(workspace.health) }))
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

/** The words of a last run: its outcome; "running" while open, "held" while it waits for an answer. */
export function lastRunWord(outcome: string | null): Badge {
  if (outcome === null || outcome === "running") return { tone: "run", label: "running" };
  if (outcome === "held") return { tone: "wait", label: "held" };
  return { tone: outcomeTone(outcome), label: outcome };
}
