/**
 * `--in <N>d|w|m` (0.110.0): a due date counted from today, resolved when the
 * vigil is written. The store keeps the date, never the phrase, so every host
 * reads the same day. All dates are local `YYYY-MM-DD`.
 */

import { UsageError } from "./model.ts";

const IN_RE = /^([1-9]\d{0,3})([dwm])$/u;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function format(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Adds whole months and keeps the day when the month has it; else the last day of the month (31 Jan + 1m is 28 or 29 Feb). */
function addMonths(from: { year: number; month: number; day: number }, months: number): Date {
  const first = new Date(from.year, from.month - 1 + months, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(from.day, lastDay));
}

/** The local due date `spec` (`7d`, `2w`, `1m`) after `today`. A bad spec is a UsageError. */
export function dueFromIn(spec: string, today: string): string {
  const match = IN_RE.exec(spec.trim());
  if (match === null) throw new UsageError(`--in takes a number and d, w or m, for example 7d, 2w or 1m; got '${spec}'`);
  const count = Number(match[1]);
  const unit = match[2];
  const [year, month, day] = today.split("-").map(Number);
  const from = { year: year ?? 0, month: month ?? 1, day: day ?? 1 };
  if (unit === "m") return format(addMonths(from, count));
  const days = unit === "w" ? count * 7 : count;
  return format(new Date(from.year, from.month - 1, from.day + days));
}
