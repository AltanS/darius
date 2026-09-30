/**
 * dates.ts — pure calendar date helpers operating on YYYY-MM-DD strings.
 *
 * All arithmetic is calendar-based and timezone-independent: dates are parsed
 * as UTC midnight, manipulated, then reformatted to YYYY-MM-DD. `todayIso()`
 * is the only impure function (reads the system clock); it uses the LOCAL date
 * so "today" matches the operator's wall calendar.
 *
 * Because YYYY-MM-DD is zero-padded, lexicographic string comparison equals
 * chronological comparison — so `today >= due` is a valid due-check.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: string): boolean {
  return ISO_DATE.test(s);
}

/** Today's date in the local timezone, as YYYY-MM-DD. */
export function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toUTC(iso: string): Date {
  if (!ISO_DATE.test(iso)) {
    throw new Error(`Invalid ISO date: "${iso}" (expected YYYY-MM-DD)`);
  }
  const parts = iso.split("-").map((p) => parseInt(p, 10));
  return new Date(Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!));
}

function fromUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = toUTC(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUTC(d);
}

/**
 * Add n calendar months, clamping the day to the target month's last valid day
 * (so 2026-01-31 + 1m → 2026-02-28, not a spill into March).
 */
export function addMonths(iso: string, n: number): string {
  const d = toUTC(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const lastDay = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return fromUTC(d);
}

/** Whole days from a → b (b minus a). Negative if b precedes a. */
export function daysBetween(aIso: string, bIso: string): number {
  const a = toUTC(aIso).getTime();
  const b = toUTC(bIso).getTime();
  return Math.round((b - a) / 86_400_000);
}

export type Cadence = { n: number; unit: "d" | "w" | "m" };

/**
 * Parse a cadence like "7d", "2w", "1m". A bare integer is treated as days.
 * Returns null on anything unparseable or non-positive.
 */
export function parseCadence(cadence: string): Cadence | null {
  const m = /^(\d+)\s*([dwm])?$/i.exec(cadence.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  if (n <= 0) return null;
  const unit = (m[2]?.toLowerCase() ?? "d") as "d" | "w" | "m";
  return { n, unit };
}

/** Roll a date forward by a cadence. Throws on an invalid cadence. */
export function rollByCadence(fromIso: string, cadence: string): string {
  const c = parseCadence(cadence);
  if (c === null) {
    throw new Error(`Invalid cadence: "${cadence}" (expected e.g. 7d, 2w, 1m)`);
  }
  if (c.unit === "d") return addDays(fromIso, c.n);
  if (c.unit === "w") return addDays(fromIso, c.n * 7);
  return addMonths(fromIso, c.n);
}

/** A ritual is due when it has a due date and today is on or after it. */
export function isDue(due: string | null | undefined, today: string): boolean {
  if (due === null || due === undefined || due === "") return false;
  return today >= due;
}
