/**
 * Ritual status, computed from facts: the ritual's header plus its ledger
 * lines. Nothing here is stored (docs/concept.md, "Domain model": "Store
 * facts, compute status"). Pure: no fs. The clock comes in (`Clock`).
 *
 * DATES AND INSTANTS (docs/architecture/marker-v3.md, section 3). Every date
 * here is a calendar date, YYYY-MM-DD, in the ritual's zone: its `tz`, else
 * the clock's `hostTz`, else the host's local zone. Only v1 and v2 store
 * rituals have no `tz`. A ledger `at` is a UTC instant; its date is taken in
 * that zone, never with `toISOString().slice(0, 10)`, which is the UTC date and
 * lands on the wrong day for runs completed near midnight. Calendar arithmetic
 * (`rollCadence`, day counts) runs on UTC midnight, where no day is 23 or 25
 * hours long. YYYY-MM-DD compares chronologically as a plain string.
 *
 * Every grid date has an occurrence instant: the date at `at` in the zone, or
 * at 00:00 when `at` is absent (`occurrenceAt`). A ritual is due from that
 * instant on. A completion instant satisfies every occurrence at or before
 * it. For a date-only ritual this is the date rule: a completion on date D
 * satisfies the occurrence of D, because D 00:00 is not after it.
 *
 * SEMANTICS (docs/plan-tonight.md, "Due computation", made precise):
 *
 * - Lifecycle is the latest `ritual.lifecycle{state}` line, default `active`.
 *   `retired` is terminal: a later line cannot revive it. A `paused` or
 *   `retired` ritual is never due and reports no `nextDue`.
 * - Only `run.completed` with `outcome: "complete"` counts as a completion.
 *   `failed` and `abandoned` close the run but leave the schedule alone, so
 *   the ritual stays due.
 * - A follow-up run (its `run.started` carries `follow_up_of`, 0.47.1) is
 *   never a completion: the operator started it by hand, out of schedule.
 *   An open or held follow-up still blocks a new run like any other.
 * - `anchor: "completion"`: next due = completion date (in the zone) +
 *   cadence, always. Before the first completion, `from` is the first due.
 * - `anchor: "due"`: the schedule is a grid, origin + k * cadence. A
 *   completion at or after the pending occurrence satisfies every occurrence
 *   up to and including its own instant; next due is the first occurrence
 *   after it. So a late run does not push the schedule back, and a ritual
 *   missed for several periods is due ONCE, with `overdueDays` counted from
 *   the oldest missed date (next due is never rolled toward today). A
 *   completion BEFORE the pending occurrence is an extra run: it moves
 *   nothing. Two runs on one day therefore never skip a period. A ritual at
 *   23:00 that completes at 00:10 the next day satisfies the 23:00 before it
 *   only; the next day's 23:00 stays due.
 *   The grid starts at `from` when set, else at the first completion's date
 *   (its first occurrence after the completion is the next due). A reschedule that
 *   becomes the pending due moves the grid origin to that date once a run
 *   satisfies it. Month steps count from the origin (Jan 31 + 1m = Feb 28,
 *   + 2m = Mar 31), so clamping does not drift the day of month.
 * - A `ritual.rescheduled{due}` line stays pending until a completion
 *   satisfies it (a completion on or after the pending due clears it; an
 *   early one does not). The latest pending line wins against earlier ones,
 *   then nextDue = max(rolled date, rescheduled due), per the plan. A
 *   reschedule can therefore push a due date out, never pull it in.
 * - Never completed, no reschedule, no `from`: due today (at `at`) when the
 *   ritual has a cadence, never due without one. `from` needs a cadence.
 * - Completed, no cadence, no later reschedule: dormant, never due again.
 * - Runs: the latest run (by its first line) in state `held` sets `heldRun`
 *   and forces `isDue: false`. A run started or resumed and not yet held or
 *   completed is `openRun`; it does not change `isDue`, the runner decides.
 * - `isDue`: no held run, and the clock is at or past `nextDueAt`.
 * - `overdueDays` = days from `nextDue` to today (in the zone) when the
 *   ritual is active and today is past `nextDue`, else 0. It is kept for a held run, so a
 *   display can say "held, 3 days overdue".
 */

import type { Document, JsonValue, LedgerLine, Ritual } from "./model.ts";
import { dateIn, parseHhmm, zoned } from "./zone.ts";

/** The instant a computation judges by. `hostTz` undefined = the host's local zone. */
export interface Clock {
  now: Date;
  hostTz?: string;
}

/** The schedule fields of a ritual (docs/architecture/marker-v3.md, section 3.1). */
export interface Schedule {
  cadence?: string;
  anchor: "due" | "completion";
  /** `HH:MM`, the wall time of every occurrence; 00:00 when absent. */
  at?: string;
  /** IANA zone name; the host's zone when absent (v1 and v2 rituals only). */
  tz?: string;
  /** YYYY-MM-DD, the grid origin. */
  from?: string;
}

export interface RitualState {
  slug: string;
  lifecycle: "active" | "paused" | "retired";
  lastCompleted?: string;
  /** The pending occurrence's date in the ritual's zone. */
  nextDue?: string;
  /** The pending occurrence's instant, ISO. */
  nextDueAt?: string;
  /** The ritual's `tz`, or "local". */
  zone: string;
  isDue: boolean;
  overdueDays: number;
  heldRun?: string;
  openRun?: string;
}

type Lifecycle = RitualState["lifecycle"];
type CadenceUnit = "d" | "w" | "m";
type RunPhase = "running" | "held" | "closed";

interface Cadence {
  count: number;
  unit: CadenceUnit;
}

/** The anchor-`due` grid: the pending due is `origin` shifted by `steps` cadences. */
interface Grid {
  origin: string;
  steps: number;
}

/** The run ids a ritual's run lines leave in a notable phase. */
interface RunSummary {
  heldRun?: string;
  openRun?: string;
}

/** Where occurrences fall: `at` (00:00 when absent) in `tz` (host local when undefined). */
interface When {
  at: string | undefined;
  tz: string | undefined;
}

interface Progress {
  grid?: Grid;
  rescheduled?: string;
  lastCompleted?: string;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CADENCE = /^(\d+)([dwm])?$/;
const DAY_MS = 86_400_000;
const DAYS_PER_WEEK = 7;
const MIDNIGHT = "00:00";
/** A daily ritual caught up across 270 years. Past this the input is corrupt. */
const MAX_GRID_STEPS = 100_000;
const LIFECYCLES: readonly Lifecycle[] = ["active", "paused", "retired"];
const CADENCE_UNITS: readonly CadenceUnit[] = ["d", "w", "m"];

/**
 * Roll a local calendar date forward by one cadence: `Nd`, `Nw`, `Nm`, or a
 * bare `N` (days, as the legacy tracker accepted). A month step clamps to the
 * target month's last day: 2026-01-31 + 1m = 2026-02-28, 2028-01-31 + 1m =
 * 2028-02-29.
 */
export function rollCadence(from: string, cadence: string): string {
  return shiftDate(from, parseCadence(cadence), 1);
}

export function ritualState(doc: Document<Ritual & Schedule>, ledger: LedgerLine[], clock: Clock): RitualState {
  const ritual = doc.header;
  const { now } = clock;
  if (Number.isNaN(now.getTime())) throw new Error("invalid clock (now is not a date)");
  if (ritual.from !== undefined) parseDate(ritual.from);
  if (ritual.at !== undefined) parseHhmm(ritual.at);
  const when: When = { at: ritual.at, tz: ritual.tz ?? clock.hostTz };
  const lines = ledger
    .filter((line) => line.item === `ritual/${ritual.slug}`)
    .toSorted((left, right) => compareText(left.id, right.id));
  const cadence = ritual.cadence === undefined || ritual.cadence === "" ? undefined : parseCadence(ritual.cadence);
  const lifecycle = readLifecycle(lines);
  const runs = readRuns(lines);
  const base: RitualState = { slug: ritual.slug, lifecycle, zone: ritual.tz ?? "local", isDue: false, overdueDays: 0 };
  const progress = readProgress(lines, { anchor: ritual.anchor, cadence, from: ritual.from, when });
  if (progress.lastCompleted !== undefined) base.lastCompleted = progress.lastCompleted;
  if (runs.heldRun !== undefined) base.heldRun = runs.heldRun;
  if (runs.openRun !== undefined) base.openRun = runs.openRun;
  if (lifecycle !== "active") return base;

  const today = dateIn(now, when.tz);
  const nextDue = pendingDue(progress, cadence) ?? firstDue(progress, { cadence, today });
  if (nextDue === undefined) return base;
  const nextDueAt = occurrenceAt(nextDue, when.at, when.tz);
  const overdueDays = Math.max(0, daysBetween(nextDue, today));
  const isDue = runs.heldRun === undefined && now.getTime() >= nextDueAt.getTime();
  return { ...base, nextDue, nextDueAt: nextDueAt.toISOString(), isDue, overdueDays };
}

/**
 * The instant of the occurrence on `date`: `at` (00:00 when absent) in `tz`,
 * in the host's local zone when `tz` is undefined (v1 and v2 rituals only).
 */
export function occurrenceAt(date: string, at: string | undefined, tz: string | undefined): Date {
  const hhmm = at ?? MIDNIGHT;
  if (tz !== undefined) return zoned(date, hhmm, tz);
  const [year, month, day] = parseDate(date);
  const [hour, minute] = parseHhmm(hhmm);
  return new Date(year, month - 1, day, hour, minute);
}

/** Never completed, never rescheduled, no `from`: due today if there is a cadence at all. */
function firstDue(progress: Progress, context: { cadence: Cadence | undefined; today: string }): string | undefined {
  if (progress.lastCompleted !== undefined) return undefined;
  if (context.cadence === undefined) return undefined;
  return context.today;
}

/** The lifecycle of ritual `slug` from the whole ledger: the latest `ritual.lifecycle` state, `retired` terminal. */
export function ritualLifecycle(ledger: readonly LedgerLine[], slug: string): Lifecycle {
  const lines = ledger
    .filter((line) => line.item === `ritual/${slug}`)
    .toSorted((left, right) => compareText(left.id, right.id));
  return readLifecycle(lines);
}

function readLifecycle(lines: LedgerLine[]): Lifecycle {
  let lifecycle: Lifecycle = "active";
  for (const line of lines) {
    if (line.type !== "ritual.lifecycle") continue;
    const state = LIFECYCLES.find((candidate) => candidate === line.state);
    if (state === undefined) throw new Error(`ledger line ${line.id}: ritual.lifecycle has invalid state`);
    if (lifecycle === "retired") continue;
    lifecycle = state;
  }
  return lifecycle;
}

function readRuns(lines: LedgerLine[]): RunSummary {
  const phases = new Map<string, RunPhase>();
  for (const line of lines) {
    const phase = runPhaseAfter(line.type);
    if (phase === undefined) continue;
    const run = requireText(line, "run");
    if (phases.get(run) === "closed") continue;
    phases.set(run, phase);
  }
  const result: RunSummary = {};
  const latest = [...phases.keys()].at(-1);
  if (latest !== undefined && phases.get(latest) === "held") result.heldRun = latest;
  const open = [...phases.entries()].findLast((entry) => entry[1] === "running");
  if (open !== undefined) result.openRun = open[0];
  return result;
}

/** The run phase a ledger line type moves a run into; undefined when it does not touch run phase. */
function runPhaseAfter(type: string): RunPhase | undefined {
  if (type === "run.started" || type === "run.resumed") return "running";
  if (type === "run.held") return "held";
  if (type === "run.completed") return "closed";
  return undefined;
}

/** The ids of the follow-up runs among the lines: their `run.started` carries `follow_up_of`. */
export function followUpRuns(lines: readonly LedgerLine[]): Set<string> {
  const runs = new Set<string>();
  for (const line of lines) {
    if (line.type === "run.started" && isText(line.follow_up_of) && isText(line.run)) runs.add(line.run);
  }
  return runs;
}

function readProgress(
  lines: LedgerLine[],
  ritual: { anchor: Ritual["anchor"]; cadence: Cadence | undefined; from: string | undefined; when: When },
): Progress {
  const { cadence, from, when } = ritual;
  let progress: Progress = from === undefined || cadence === undefined ? {} : { grid: { origin: from, steps: 0 } };
  const followUps = followUpRuns(lines);
  for (const line of lines) {
    if (line.type === "ritual.rescheduled") {
      const due = requireText(line, "due");
      parseDate(due);
      progress.rescheduled = due;
      continue;
    }
    if (line.type !== "run.completed") continue;
    if (isText(line.run) && followUps.has(line.run)) continue;
    const outcome = requireText(line, "outcome");
    if (outcome !== "complete") continue;
    progress = applyCompletion(progress, { completedAt: instantOf(line), anchor: ritual.anchor, cadence, when });
  }
  return progress;
}

function applyCompletion(
  progress: Progress,
  event: { completedAt: Date; anchor: Ritual["anchor"]; cadence: Cadence | undefined; when: When },
): Progress {
  const { completedAt, cadence, when } = event;
  const completed = dateIn(completedAt, when.tz);
  if (cadence === undefined) return { lastCompleted: completed };
  if (event.anchor === "completion") return { grid: { origin: completed, steps: 1 }, lastCompleted: completed };

  const pending = pendingDue(progress, cadence);
  if (pending === undefined) {
    const grid = firstAfter({ grid: { origin: completed, steps: 0 }, cadence, when, instant: completedAt });
    return { grid, lastCompleted: completed };
  }
  if (occurrenceAt(pending, when.at, when.tz).getTime() > completedAt.getTime()) {
    return { ...progress, lastCompleted: completed };
  }
  const satisfied = pendingGrid(progress, cadence);
  const grid = firstAfter({
    grid: { origin: satisfied.origin, steps: satisfied.steps + 1 },
    cadence,
    when,
    instant: completedAt,
  });
  return { grid, lastCompleted: completed };
}

/** The grid whose current step IS the pending due: a reschedule that won becomes the new origin. */
function pendingGrid(progress: Progress, cadence: Cadence): Grid {
  const rolled = progress.grid === undefined ? undefined : gridDate(progress.grid, cadence);
  const { rescheduled } = progress;
  if (rescheduled !== undefined && (rolled === undefined || rescheduled > rolled)) {
    return { origin: rescheduled, steps: 0 };
  }
  if (progress.grid === undefined) throw new Error("no pending due to advance from");
  return progress.grid;
}

/** The pending due: max(grid date, latest reschedule since the last completion). */
function pendingDue(progress: Progress, cadence: Cadence | undefined): string | undefined {
  const rolled = progress.grid === undefined || cadence === undefined ? undefined : gridDate(progress.grid, cadence);
  const { rescheduled } = progress;
  if (rolled === undefined) return rescheduled;
  if (rescheduled === undefined) return rolled;
  return rescheduled > rolled ? rescheduled : rolled;
}

/** The first step at or after `grid.steps` whose occurrence instant is after `instant`. */
function firstAfter(context: { grid: Grid; cadence: Cadence; when: When; instant: Date }): Grid {
  const { grid, cadence, when, instant } = context;
  for (let steps = grid.steps; steps <= grid.steps + MAX_GRID_STEPS; steps += 1) {
    const next = { origin: grid.origin, steps };
    if (occurrenceAt(gridDate(next, cadence), when.at, when.tz).getTime() > instant.getTime()) return next;
  }
  throw new Error(`cadence grid from ${grid.origin} did not pass ${instant.toISOString()} within ${MAX_GRID_STEPS} steps`);
}

function gridDate(grid: Grid, cadence: Cadence): string {
  return shiftDate(grid.origin, cadence, grid.steps);
}

function parseCadence(cadence: string): Cadence {
  const match = CADENCE.exec(cadence.trim());
  const count = match?.[1] === undefined ? 0 : Number.parseInt(match[1], 10);
  if (match === null || count <= 0) {
    throw new Error(`invalid cadence "${cadence}" (expected Nd, Nw or Nm, for example 7d, 2w, 1m)`);
  }
  const unit = CADENCE_UNITS.find((candidate) => candidate === match[2]) ?? "d";
  return { count, unit };
}

function shiftDate(from: string, cadence: Cadence, times: number): string {
  const [year, month, day] = parseDate(from);
  if (cadence.unit === "m") {
    const target = new Date(Date.UTC(year, month - 1 + cadence.count * times, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(day, lastDay));
    return formatUtcDate(target);
  }
  const days = cadence.unit === "w" ? cadence.count * DAYS_PER_WEEK : cadence.count;
  return formatUtcDate(new Date(Date.UTC(year, month - 1, day + days * times)));
}

/** A YYYY-MM-DD calendar date as [year, month, day]; throws on anything else. */
export function parseDate(date: string): [number, number, number] {
  const match = ISO_DATE.exec(date);
  if (match === null) throw new Error(`invalid date "${date}" (expected YYYY-MM-DD)`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new Error(`invalid date "${date}" (no such calendar day)`);
  }
  return [year, month, day];
}

function daysBetween(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = parseDate(from);
  const [toYear, toMonth, toDay] = parseDate(to);
  return Math.round((Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / DAY_MS);
}

/** The instant of a ledger line. */
function instantOf(line: LedgerLine): Date {
  const instant = new Date(line.at);
  if (Number.isNaN(instant.getTime())) throw new Error(`ledger line ${line.id}: invalid at "${line.at}"`);
  return instant;
}

function formatUtcDate(date: Date): string {
  return formatDate([date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]);
}

function formatDate(parts: [number, number, number]): string {
  const [year, month, day] = parts;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function requireText(line: LedgerLine, field: string): string {
  const value = line[field];
  if (!isText(value)) throw new Error(`ledger line ${line.id}: ${line.type} is missing text field "${field}"`);
  return value;
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
