/**
 * One read of a project's store vigils in the fields the legacy tracker CLI
 * printed (`vigil list --json`, `due`): slug, name, due, until, from, agent,
 * opened, resolved, verdict. Status is computed from the ledger, never
 * stored: `resolved` and `verdict` come from the `vigil.closed` line.
 *
 * Also the date helpers a vigil needs: a calendar date has no time, so it
 * becomes LOCAL noon (the same rule as src/core/import.ts), and an instant
 * becomes the local date again without shifting a day.
 */

import { linesFor, readLedger } from "./ledger.ts";
import type { Vigil } from "./model.ts";
import type { Project } from "./store.ts";
import { itemRef } from "./store.ts";
import { localToday, vigilStatus } from "./sweep.ts";

const NOON_HOUR = 12;
const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** True for a real calendar day written as YYYY-MM-DD. */
export function isCalendarDate(date: string): boolean {
  const match = ISO_DATE.exec(date);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

/** The ISO instant of local noon on `date` (YYYY-MM-DD, already checked). */
export function localNoonIso(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, NOON_HOUR).toISOString();
}

/** The local calendar date of an ISO instant. A bare YYYY-MM-DD stays as it is. */
export function localDateOf(value: string): string | null {
  if (isCalendarDate(value)) return value;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : localToday(new Date(ms));
}

/** What the legacy `vigil list` knew of a vigil, plus the native status fields. */
export interface VigilView {
  slug: string;
  name: string;
  due: string | null;
  until: string | null;
  from: string | null;
  agent: string | null;
  opened: string | null;
  resolved: string | null;
  verdict: string | null;
  state: "open" | "closed";
  flagged: boolean;
  heavy: boolean;
  lastOutcome: string | null;
  /** The item body, for the projected file. */
  body: string;
}

function textOrNull(value: string | undefined): string | null {
  return value === undefined || value === "" ? null : value;
}

/** Every vigil of the project in legacy order: by file name, `<slug>.md`. A broken item throws. */
export function readVigilViews(project: Project): VigilView[] {
  const ledger = readLedger(project);
  const slugs = project.listItems("vigil").toSorted((left, right) => compareText(`${left}.md`, `${right}.md`));
  return slugs.flatMap((slug) => {
    const doc = project.readItem<Vigil>("vigil", slug);
    if (doc === null) return [];
    const { header } = doc;
    const status = vigilStatus(slug, linesFor(ledger, itemRef("vigil", slug)));
    return [
      {
        slug,
        name: header.title,
        due: textOrNull(header.due),
        until: textOrNull(header.until),
        from: textOrNull(header.from),
        agent: textOrNull(header.agent),
        opened: localDateOf(header.created),
        resolved: status.closedAt === undefined ? null : localDateOf(status.closedAt),
        verdict: textOrNull(status.verdict),
        state: status.state,
        flagged: status.flagged,
        heavy: header.heavy,
        lastOutcome: textOrNull(status.lastOutcome),
        body: doc.body,
      },
    ];
  });
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** A vigil whose date gate has arrived, and how late it is. */
export interface DueVigil extends VigilView {
  /** Days since the due date: 0 is due today. */
  daysOverdue: number;
}

export interface DueVigils {
  /** The date gate has arrived. Most overdue first, slug breaks a tie. */
  due: DueVigil[];
  /** Open, not yet due, waiting on an event. Oldest opened first. */
  armed: VigilView[];
}

function daysBetween(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  const start = Date.UTC(fromYear ?? 0, (fromMonth ?? 1) - 1, fromDay ?? 1);
  const end = Date.UTC(toYear ?? 0, (toMonth ?? 1) - 1, toDay ?? 1);
  return Math.round((end - start) / DAY_MS);
}

/**
 * The legacy `selectDueVigils`: open vigils split into `due` (the date has
 * arrived; an `until` is only a backstop) and `armed` (not yet due, waiting
 * on an event). A future-dated vigil with no event stays out of both. `today`
 * is a local date, passed in so the function stays pure.
 */
export function selectDueVigils(views: readonly VigilView[], today: string): DueVigils {
  const due: DueVigil[] = [];
  const armed: VigilView[] = [];
  for (const view of views) {
    if (view.state !== "open") continue;
    if (view.due !== null && isCalendarDate(view.due) && view.due <= today) {
      due.push({ ...view, daysOverdue: daysBetween(view.due, today) });
    } else if (view.until !== null) {
      armed.push(view);
    }
  }
  due.sort((left, right) => right.daysOverdue - left.daysOverdue || compareText(left.slug, right.slug));
  armed.sort((left, right) => compareText(left.opened ?? "", right.opened ?? "") || compareText(left.slug, right.slug));
  return { due, armed };
}
