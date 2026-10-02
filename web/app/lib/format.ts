/** Text helpers for times, ids and commands. Pure, so server and client agree. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "3 min ago", "in 2 h", relative to `now` (ms). */
export function relativeTime(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  const delta = now - at;
  const size = Math.abs(delta);
  if (size < MINUTE) return "just now";
  const amount = size < HOUR ? `${Math.round(size / MINUTE)} min` : size < DAY ? `${Math.round(size / HOUR)} h` : `${Math.round(size / DAY)} d`;
  return delta >= 0 ? `${amount} ago` : `in ${amount}`;
}

function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / DAY);
}

/** A YYYY-MM-DD date against the host's `today`: "today", "in 3 d", "2 d ago". */
export function relativeDate(date: string, today: string): string {
  const days = dayNumber(date) - dayNumber(today);
  if (Number.isNaN(days)) return date;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} d` : `${-days} d ago`;
}

/** Whole days from one YYYY-MM-DD date to another; negative when `to` is earlier. */
export function dayGap(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

function pair(big: number, bigUnit: string, small: number, smallUnit: string): string {
  return small === 0 ? `${big} ${bigUnit}` : `${big} ${bigUnit} ${small} ${smallUnit}`;
}

/** "4 min", "2 h 5 min", "1 d 3 h" between two ISO times. */
export function duration(start: string, end: string): string {
  const size = Date.parse(end) - Date.parse(start);
  if (Number.isNaN(size) || size < 0) return "";
  if (size < MINUTE) return `${Math.round(size / 1000)} s`;
  if (size < HOUR) return `${Math.round(size / MINUTE)} min`;
  if (size < DAY) return pair(Math.floor(size / HOUR), "h", Math.round((size % HOUR) / MINUTE), "min");
  return pair(Math.floor(size / DAY), "d", Math.round((size % DAY) / HOUR), "h");
}

/** A long span in one coarse unit: "12 h", "3 d". */
export function roughDuration(size: number): string {
  if (size < HOUR) return `${Math.max(1, Math.round(size / MINUTE))} min`;
  if (size < 2 * DAY) return `${Math.floor(size / HOUR)} h`;
  return `${Math.floor(size / DAY)} d`;
}

/** A size in bytes as "812 B", "48 MiB" or "1.4 GiB": one decimal below 10, none above. */
export function byteSize(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"] as const;
  let value = Math.max(0, bytes);
  let at = 0;
  while (value >= 1024 && at < units.length - 1) {
    value /= 1024;
    at += 1;
  }
  const text = at === 0 || value >= 10 ? String(Math.round(value)) : value.toFixed(1);
  return `${text} ${units[at] ?? "B"}`;
}

/** An uptime in seconds as "12 d 3 h", "5 h 10 min" or "4 min". */
export function uptimeText(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return pair(hours, "h", minutes % 60, "min");
  return pair(Math.floor(hours / 24), "d", hours % 24, "h");
}

// --- host clock ----------------------------------------------------------------------------

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * A Date whose UTC fields read as the host's wall clock. `offset` is the
 * host's UTC offset in minutes east (HostStatus.utcOffset), so the server and
 * the browser print the same clock time whatever zone the browser is in.
 */
function wall(iso: string, offset: number): Date | null {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : new Date(at + offset * MINUTE);
}

function two(value: number): string {
  return String(value).padStart(2, "0");
}

/** "23:42" on the host's clock. */
export function clockTime(iso: string, offset: number): string {
  const date = wall(iso, offset);
  return date === null ? iso : `${two(date.getUTCHours())}:${two(date.getUTCMinutes())}`;
}

/** The host's local date of a moment, YYYY-MM-DD. */
export function hostDate(iso: string, offset: number): string {
  const date = wall(iso, offset);
  return date === null ? iso : date.toISOString().slice(0, 10);
}

/** "27 Sep" for a YYYY-MM-DD date. */
export function shortDate(date: string): string {
  const [, month = "", day = ""] = date.split("-");
  const name = MONTHS[Number(month) - 1];
  return name === undefined ? date : `${Number(day)} ${name}`;
}

/** "Tue 29 Sep" for a moment, on the host's calendar. */
export function dayName(iso: string, offset: number): string {
  const date = wall(iso, offset);
  if (date === null) return iso;
  return `${WEEKDAYS[date.getUTCDay()] ?? ""} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()] ?? ""}`;
}

/** The date after a YYYY-MM-DD date. */
export function nextDay(date: string): string {
  const at = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(at) ? date : new Date(at + DAY).toISOString().slice(0, 10);
}

/** A moment on the host's clock: "09:12" on `today`, "27 Sep 09:12" on another day. */
export function momentText(iso: string, today: string, offset: number): string {
  const date = hostDate(iso, offset);
  const time = clockTime(iso, offset);
  return date === today ? time : `${shortDate(date)} ${time}`;
}

/** A past moment: "12 h ago" within a day, otherwise its date, "27 Sep". */
export function whenText(iso: string, now: number, offset: number): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  return now - at < DAY ? relativeTime(iso, now) : shortDate(hostDate(iso, offset));
}

/** The tail of a run id: ULIDs share their time prefix, the tail tells them apart. */
export function shortRun(run: string): string {
  return run.length > 10 ? run.slice(-8) : run;
}

/** The exact command that answers question `n` (1-based) of a held run. */
export function answerCommand(run: string, n: number, project: string): string {
  return `darius run answer ${run} ${n} "your answer" --project ${project}`;
}

/** The command that starts a ritual now, due or not, failed today or not. */
export function runNowCommand(slug: string, project: string): string {
  return `darius run now ${slug} --project ${project}`;
}

/** The command that marks a failed or abandoned run as seen. */
export function ackCommand(run: string, project: string): string {
  return `darius run ack ${run} --project ${project}`;
}

/** The command that records the operator's decision on the questions of a run's result. */
export function decideCommand(run: string, project: string): string {
  return `darius run ack ${run} --note "your decision" --project ${project}`;
}
