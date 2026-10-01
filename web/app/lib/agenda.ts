/**
 * The agenda: what is coming, in one time-ordered list, and what waits for an
 * event. The home page and the project page both draw it, so they cannot
 * disagree. Pure: it reads a status and a clock and returns plain data.
 *
 * Coming up holds every active ritual once, at its next date, and every armed
 * vigil that has a due date, once, at that date. The rows are grouped by day:
 * Overdue, Today, Tomorrow, one group per weekday for two weeks, Later, and
 * No schedule (active rituals without a cadence or a next date).
 *
 * Waiting on an event holds the armed vigils without a due date, flagged first.
 *
 * Where a ritual lands: a running or held run puts it in Today. A ritual whose
 * latest run failed today goes to tomorrow, because the timer does not retry it
 * before then. Otherwise its `nextDue` decides: past is Overdue, today is
 * Today.
 */

import type { ProjectStatus, RitualRow, RunRow, VigilRow } from "../../../src/web/api.ts";
import { dayGap, dayName, ritualPath, shortDate, vigilPath } from "./format.ts";
import { type Kind, isManual } from "./kind.ts";
import { ASKS_YOU, datePhrase, FAILED, FAILED_SEEN, FLAGGED, lateWord, railOf, type Rail, RUNNING, WAITING_FOR_YOU } from "./state-words.ts";
import type { Badge } from "./tone.ts";
import { asksYou, atText, cadenceText } from "./view.ts";

const DAY = 24 * 60 * 60_000;

/** Days ahead that get a group of their own; a later date joins "Later". */
export const HORIZON_DAYS = 14;

export type GroupKind = "overdue" | "today" | "tomorrow" | "day" | "later" | "none";

/** A state word that is not plain: "13 days late", "Running", "Waiting for you", "Failed", "Asks you", "Flagged". */
export type AgendaState = Badge;

export interface AgendaRow {
  key: string;
  kind: Kind;
  /** A ritual darius never starts: it reads "manual ritual" with the hand icon. */
  manual: boolean;
  project: string;
  slug: string;
  title: string;
  href: string;
  /** The YYYY-MM-DD it comes up on; null in No schedule. */
  date: string | null;
  /** The rail colour at the row's left edge; null for a plain row (only a row that needs attention has one). */
  rail: Rail | null;
  state: AgendaState | null;
  /** A ritual: "every 7 days, last done 14 Sep". Empty for a vigil. */
  facts: string;
  /** A vigil: the event it also waits for. */
  until: string | null;
  /** A flagged vigil: "last check failed, 1 day late". */
  note: string | null;
  /** Days past due; 0 when not overdue. */
  overdueDays: number;
}

export interface AgendaGroup {
  key: string;
  kind: GroupKind;
  /** "Overdue", "Today", "Tomorrow", "Fri 2 Oct", "Later", "No schedule". */
  label: string;
  rows: AgendaRow[];
}

/** An armed vigil without a due date. */
export interface WaitingRow {
  key: string;
  project: string;
  slug: string;
  title: string;
  href: string;
  until: string | null;
  flagged: boolean;
}

export interface Agenda {
  groups: AgendaGroup[];
  waiting: WaitingRow[];
  /** More than one project contributes rows: rows then name their project. */
  showProject: boolean;
  /** The first row that is not overdue and has a date. */
  next: AgendaRow | null;
  /** Rituals and dated vigils past due. */
  overdue: number;
  /** Rows due today that are not running or held now. */
  dueToday: number;
  /** Armed vigils, dated or not. */
  armed: number;
}

export interface AgendaInput {
  /** The projects to show; the caller drops the self-test ones. */
  projects: readonly ProjectStatus[];
  /** The host's YYYY-MM-DD today. */
  today: string;
  /** Keep only the rituals or only the vigils, for the Rituals and Vigils sections; all of them by default. */
  only?: Kind;
}

// --- dates ---------------------------------------------------------------------------------

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** "Fri 2 Oct" for a YYYY-MM-DD date. */
export function weekdayDate(date: string): string {
  return dayName(`${date}T00:00:00Z`, 0);
}

interface GroupSpec {
  key: string;
  kind: GroupKind;
  label: string;
}

function groupOf(today: string, date: string | null, overdue: boolean): GroupSpec {
  if (date === null) return { key: "none", kind: "none", label: "No schedule" };
  if (overdue) return { key: "overdue", kind: "overdue", label: "Overdue" };
  const gap = dayGap(today, date);
  if (gap <= 0) return { key: "today", kind: "today", label: "Today" };
  if (gap === 1) return { key: "tomorrow", kind: "tomorrow", label: "Tomorrow" };
  if (gap <= HORIZON_DAYS) return { key: `d-${date}`, kind: "day", label: weekdayDate(date) };
  return { key: "later", kind: "later", label: "Later" };
}

// --- words ---------------------------------------------------------------------------------

/** "every 7 days, last done 14 Sep": the cadence in words, then when it was last done. */
function factsText(ritual: RitualRow): string {
  const cadence = cadenceText(ritual.cadence);
  const cadenceAt = atText(ritual);
  const done = ritual.lastCompleted === null ? "not done yet" : `last done ${shortDate(ritual.lastCompleted)}`;
  const every = cadence === null || cadenceAt === null ? cadence : `${cadence} at ${cadenceAt}`;
  return every === null ? done : `${every}, ${done}`;
}

// --- rituals -------------------------------------------------------------------------------

/** Runs that count: imports and install proofs are history, not activity. */
function isNoise(run: RunRow): boolean {
  return run.who === "import" || run.who === "acceptance";
}

/** Whether the newest counted run of a ritual is a complete run that asks the operator something. */
function asksNow(project: ProjectStatus, ritual: RitualRow): boolean {
  const own = project.runs.filter((run) => run.item === `ritual/${ritual.slug}` && !isNoise(run)).toSorted((left, right) => right.startedAt.localeCompare(left.startedAt));
  const last = own[0];
  return last !== undefined && asksYou(last);
}

interface Placement {
  date: string | null;
  overdueDays: number;
  state: AgendaState | null;
}

function placement(input: AgendaInput, project: ProjectStatus, ritual: RitualRow): Placement {
  const { today } = input;
  if (ritual.heldRun !== null) return { date: today, overdueDays: 0, state: WAITING_FOR_YOU };
  if (ritual.openRun !== null) return { date: today, overdueDays: 0, state: RUNNING };
  if (ritual.failedToday !== null) {
    const seen = ritual.failedToday.acknowledged !== null;
    return { date: addDays(today, 1), overdueDays: 0, state: seen ? FAILED_SEEN : FAILED };
  }
  const asks: AgendaState | null = asksNow(project, ritual) ? ASKS_YOU : null;
  if (ritual.nextDue === null) return { date: null, overdueDays: 0, state: asks };
  const late = Math.max(ritual.overdueDays, dayGap(ritual.nextDue, today));
  if (late > 0) return { date: ritual.nextDue, overdueDays: late, state: lateWord(late) };
  return { date: ritual.nextDue <= today ? today : ritual.nextDue, overdueDays: 0, state: asks };
}

function ritualRow(input: AgendaInput, project: ProjectStatus, ritual: RitualRow): AgendaRow {
  const at = placement(input, project, ritual);
  return {
    key: `${project.name}/ritual/${ritual.slug}`,
    kind: "ritual",
    manual: isManual(ritual),
    project: project.name,
    slug: ritual.slug,
    title: ritual.title,
    href: ritualPath(project.name, ritual.slug),
    date: at.date,
    rail: railOf(at.state),
    state: at.state,
    facts: factsText(ritual),
    until: null,
    note: ritual.source === "repo" ? "git" : ritual.source === "unmanaged" ? "not in .darius.toml" : null,
    overdueDays: at.overdueDays,
  };
}

// --- vigils --------------------------------------------------------------------------------

function isArmed(vigil: VigilRow): boolean {
  return vigil.state !== "closed";
}

function vigilRow(input: AgendaInput, project: ProjectStatus, vigil: VigilRow, due: string): AgendaRow {
  const late = Math.max(0, dayGap(due, input.today));
  // A flagged vigil is "Flagged"; how late it is moves to the note, so the days are not lost.
  const noted = vigil.flagged ? [vigil.lastOutcome === null ? null : `last check ${vigil.lastOutcome}`, late > 0 ? lateWord(late).label : null].filter((part) => part !== null) : [];
  const note = noted.length === 0 ? null : noted.join(", ");
  const state: AgendaState | null = vigil.flagged ? FLAGGED : late > 0 ? lateWord(late) : null;
  return {
    key: `${project.name}/vigil/${vigil.slug}`,
    kind: "vigil",
    manual: false,
    project: project.name,
    slug: vigil.slug,
    title: vigil.title,
    href: vigilPath(project.name, vigil.slug),
    date: due,
    rail: railOf(state),
    state,
    facts: "",
    until: vigil.until,
    note,
    overdueDays: late,
  };
}

function waitingRow(project: ProjectStatus, vigil: VigilRow): WaitingRow {
  return { key: `${project.name}/vigil/${vigil.slug}`, project: project.name, slug: vigil.slug, title: vigil.title, href: vigilPath(project.name, vigil.slug), until: vigil.until, flagged: vigil.flagged };
}

// --- the agenda ----------------------------------------------------------------------------

/** Rituals darius runs lead their day; manual rituals and vigils follow, by title. */
function ritualFirst(row: AgendaRow): number {
  return row.kind === "ritual" && !row.manual ? 0 : 1;
}

/** Overdue: the latest first. Other groups: the date, rituals darius runs first, then the title. */
function byRow(left: AgendaRow, right: AgendaRow): number {
  return right.overdueDays - left.overdueDays || (left.date ?? "").localeCompare(right.date ?? "") || ritualFirst(left) - ritualFirst(right) || left.title.localeCompare(right.title);
}

function byWaiting(left: WaitingRow, right: WaitingRow): number {
  return Number(right.flagged) - Number(left.flagged) || left.title.localeCompare(right.title);
}

const GROUP_ORDER = { overdue: 0, today: 1, tomorrow: 2, day: 3, later: 4, none: 5 } as const satisfies Record<GroupKind, number>;

export function buildAgenda(input: AgendaInput): Agenda {
  const rows: AgendaRow[] = [];
  const waiting: WaitingRow[] = [];
  let armed = 0;
  for (const project of input.projects) {
    for (const ritual of input.only === "vigil" ? [] : project.rituals) {
      if (ritual.lifecycle === "active") rows.push(ritualRow(input, project, ritual));
    }
    for (const vigil of (input.only === "ritual" ? [] : project.vigils).filter((candidate) => isArmed(candidate))) {
      armed += 1;
      if (vigil.due === null) waiting.push(waitingRow(project, vigil));
      else rows.push(vigilRow(input, project, vigil, vigil.due));
    }
  }
  const groups = new Map<string, AgendaGroup & { order: number; date: string }>();
  for (const row of rows.toSorted(byRow)) {
    const spec = groupOf(input.today, row.date, row.overdueDays > 0);
    const found = groups.get(spec.key);
    if (found === undefined) groups.set(spec.key, { ...spec, rows: [row], order: GROUP_ORDER[spec.kind], date: row.date ?? "" });
    else found.rows.push(row);
  }
  const ordered = [...groups.values()]
    .toSorted((left, right) => left.order - right.order || left.date.localeCompare(right.date))
    .map(({ key, kind, label, rows: members }): AgendaGroup => ({ key, kind, label, rows: members }));
  const dated = ordered.filter((group) => group.kind !== "overdue" && group.kind !== "none").flatMap((group) => group.rows);
  const today = ordered.find((group) => group.kind === "today");
  return {
    groups: ordered,
    waiting: waiting.toSorted(byWaiting),
    showProject: new Set([...rows.map((row) => row.project), ...waiting.map((row) => row.project)]).size > 1,
    next: dated[0] ?? null,
    overdue: ordered.find((group) => group.kind === "overdue")?.rows.length ?? 0,
    dueToday: today?.rows.filter((row) => row.state === null || (row.state !== RUNNING && row.state !== WAITING_FOR_YOU)).length ?? 0,
    armed,
  };
}

/** The Next line under the home verdict: the first item that is not late, with when it comes up. */
export interface NextLine {
  title: string;
  href: string;
  kind: Kind;
  manual: boolean;
  /** "today", "tomorrow", "Fri 2 Oct" or "15 Nov". */
  when: string;
  isToday: boolean;
}

/** The first dated row that is not overdue (the strip already counts the overdue ones); null when there is none. */
export function nextLine(agenda: Agenda, today: string): NextLine | null {
  const row = agenda.next;
  if (row === null || row.date === null) return null;
  const when = datePhrase(today, row.date);
  return { title: row.title, href: row.href, kind: row.kind, manual: row.manual, when, isToday: when === "today" };
}

/** How many rows show on a phone: every row of Overdue, Today and Tomorrow, then this many more. */
export const PHONE_EXTRA_ROWS = 6;

/** The rows a phone hides until "Show more": past Tomorrow, after the first few. */
export function phoneHidden(agenda: Agenda): ReadonlySet<string> {
  const hidden = new Set<string>();
  let shown = 0;
  for (const group of agenda.groups) {
    const always = group.kind === "overdue" || group.kind === "today" || group.kind === "tomorrow";
    for (const row of group.rows) {
      if (always) continue;
      shown += 1;
      if (shown > PHONE_EXTRA_ROWS) hidden.add(row.key);
    }
  }
  return hidden;
}

/** The groups a desktop keeps in a closed fold. */
export function isFolded(group: AgendaGroup): boolean {
  return group.kind === "later" || group.kind === "none";
}
