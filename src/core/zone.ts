/**
 * Wall time in an IANA time zone, with `Intl` only (no library).
 *
 * A ritual's day boundaries and its `at` time follow its zone, never the host
 * clock (docs/architecture/marker-v3.md, section 3.2). A zone of `undefined`
 * means the host's local zone; only v1 and v2 store rituals have one.
 *
 * `zoned` turns a wall time into an instant. Two wall times are special:
 *
 * - Clocks fell back, so the wall time happens twice: the earlier instant wins.
 * - Clocks sprang forward, so the wall time never happens: the instant is the
 *   wall time read with the offset before the gap. The run is then one hour
 *   later on the wall clock (02:30 in a 02:00 to 03:00 gap runs at 03:30).
 */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MINUTE_MS = 60_000;
/** Every real offset lies within 14 hours, so the true instant lies within a day of the wall time read as UTC. */
const PROBE_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** True when `tz` is an IANA zone name this runtime knows. */
export function isZone(tz: string): boolean {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions().timeZone !== "";
  } catch {
    return false;
  }
}

/** The YYYY-MM-DD date of `now` in `tz`; the host's local date when `tz` is undefined. */
export function dateIn(now: Date, tz?: string): string {
  requireInstant(now);
  if (tz === undefined) return formatDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const wall = wallParts(now, tz);
  return formatDate(wall.year, wall.month, wall.day);
}

/** Minutes east of UTC in `tz` at `instant` (Europe/Berlin in summer: 120). */
export function offsetAt(instant: Date, tz: string): number {
  requireInstant(instant);
  const wall = wallParts(instant, tz);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const whole = instant.getTime() - (((instant.getTime() % 1000) + 1000) % 1000);
  return Math.round((asUtc - whole) / MINUTE_MS);
}

/** The instant of wall time `hhmm` on `date` in `tz`. See the module comment for the two special cases. */
export function zoned(date: string, hhmm: string, tz: string): Date {
  const [year, month, day] = parseDate(date);
  const [hour, minute] = parseHhmm(hhmm);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offsets = [
    ...new Set([guess - PROBE_MS, guess, guess + PROBE_MS].map((probe) => offsetAt(new Date(probe), tz))),
  ];
  const matches = offsets
    .map((offset) => guess - offset * MINUTE_MS)
    .filter((candidate) => wallMs(new Date(candidate), tz) === guess);
  if (matches.length > 0) return new Date(Math.min(...matches));
  return new Date(guess - Math.min(...offsets) * MINUTE_MS);
}

/** A YYYY-MM-DD calendar date as [year, month, day]; throws on anything else. */
function parseDate(date: string): [number, number, number] {
  const match = DATE.exec(date);
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

/** An `HH:MM` wall time (00:00 to 23:59) as [hour, minute]; throws on anything else. */
export function parseHhmm(hhmm: string): [number, number] {
  const match = HHMM.exec(hhmm);
  if (match === null) throw new Error(`invalid time "${hhmm}" (expected HH:MM, 00:00 to 23:59)`);
  return [Number(match[1]), Number(match[2])];
}

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The wall time of `instant` in `tz`, to the minute, read as a UTC timestamp. */
function wallMs(instant: Date, tz: string): number {
  const wall = wallParts(instant, tz);
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
}

function wallParts(instant: Date, tz: string): WallParts {
  const parts = formatter(tz).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((candidate) => candidate.type === type)?.value;
    if (value === undefined) throw new Error(`time zone ${tz}: no ${type} in the formatted date`);
    return Number(value);
  };
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    second: part("second"),
  };
}

function formatter(tz: string): Intl.DateTimeFormat {
  const cached = formatters.get(tz);
  if (cached !== undefined) return cached;
  if (!isZone(tz)) throw new Error(`invalid time zone "${tz}" (expected an IANA name, for example Europe/Berlin)`);
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatters.set(tz, created);
  return created;
}

function requireInstant(instant: Date): void {
  if (Number.isNaN(instant.getTime())) throw new Error("invalid instant (not a date)");
}

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
