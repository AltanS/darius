/**
 * The Due screen (docs/concept.md, "App design" > "TUI"): one numbered list
 * of what needs the operator across every project in the local store. Pure:
 * a snapshot and the state in, rows out. src/tui/snapshot.ts decides what is
 * listed and in which order; this file only draws it.
 *
 *   darius 0.15.0  host-a  read 14:32:07
 *
 *   Held, waiting for you
 *   > 1  acme  stale-draft-sweep  held, 2 questions, 1 answered
 *
 *   Asks you
 *     2  acme  fact-check  complete, 1 question for you
 *
 *   Due
 *     3  acme  heartbeat  overdue 3 days  mode off  Heartbeat
 *   ...
 *   j/k move  Enter open  1-9 pick a row  q quit
 */

import type { DueRow, DueSnapshot } from "./snapshot.ts";
import type { TuiState } from "./state.ts";
import type { Size } from "./term.ts";
import { BLANK, blanks, clock, count, line, noticeLines, oneLine, part, type Line, type Notice, type Part } from "./text.ts";

const HINTS = "j/k move  Enter open  1-9 pick a row  q quit";
const NOTHING = "Nothing is due and no run waits for you.";

interface Section {
  kind: DueRow["kind"];
  heading: Part;
}

const SECTIONS: readonly Section[] = [
  { kind: "held", heading: part("Held, waiting for you", "needs") },
  { kind: "asks", heading: part("Asks you", "needs") },
  { kind: "ritual", heading: part("Due", "bold") },
  { kind: "vigil", heading: part("Vigils", "bold") },
  { kind: "failed", heading: part("Failed today", "failed") },
];

function titlePart(title: string): Part {
  return part(`  ${oneLine(title)}`, "dim");
}

/** What a row says after its project and slug. */
function rowStatus(row: DueRow): Part[] {
  if (row.kind === "held") {
    return [part(`held, ${count(row.questions, "question")}, ${String(row.answered)} answered`, "needs")];
  }
  if (row.kind === "asks") return [part(`complete, ${count(row.questions, "question")} for you`, "needs")];
  if (row.kind === "failed") return [part(`failed at ${clock(row.endedAt)}`, "failed")];
  if (row.kind === "vigil") {
    if (row.gate === "flagged") return [part("flagged: a check failed", "failed"), titlePart(row.title)];
    if (row.gate === "armed") return [part(`armed, waiting on: ${oneLine(row.until ?? "")}`), titlePart(row.title)];
    return [part(row.due === null ? "due" : `due ${row.due}`), titlePart(row.title)];
  }
  const parts = [part(row.overdueDays > 0 ? `overdue ${count(row.overdueDays, "day")}` : "due today")];
  if (row.isRunning) parts.push(part(", running now"));
  if (row.isAcknowledgedFailure) parts.push(part("  failed today, acknowledged", "dim"));
  if (row.isOff) parts.push(part("  mode off", "dim"));
  if (row.host !== null) parts.push(part(`  pinned to ${oneLine(row.host)}`, "dim"));
  parts.push(titlePart(row.title));
  return parts;
}

function rowLine(row: DueRow, number: string, isSelected: boolean): Line {
  const label = `${isSelected ? ">" : " "} ${number}  ${oneLine(row.project)}  ${oneLine(row.slug)}  `;
  return { parts: [part(label), ...rowStatus(row)], isSelected };
}

interface ListLines {
  lines: Line[];
  /** The index in `lines` of the selected row; -1 when nothing is listed. */
  selectedAt: number;
}

/** The sections with their rows, numbered from 1 in list order; empty sections left out. */
function listLines(snapshot: DueSnapshot, selected: number): ListLines {
  const lines: Line[] = [];
  let selectedAt = -1;
  const width = String(snapshot.rows.length).length;
  for (const section of SECTIONS) {
    const indexes = snapshot.rows.flatMap((row, index) => (row.kind === section.kind ? [index] : []));
    if (indexes.length === 0) continue;
    if (lines.length > 0) lines.push(BLANK);
    lines.push(line(section.heading));
    for (const index of indexes) {
      const row = snapshot.rows[index];
      if (row === undefined) continue;
      if (index === selected) selectedAt = lines.length;
      lines.push(rowLine(row, String(index + 1).padStart(width), index === selected));
    }
  }
  if (snapshot.errors.length > 0) {
    if (lines.length > 0) lines.push(BLANK);
    lines.push(line(part("Could not read", "failed")));
    for (const error of snapshot.errors) lines.push(line(part(`  ${oneLine(error)}`)));
  }
  if (snapshot.rows.length === 0) lines.unshift(line(part(NOTHING)), ...(lines.length > 0 ? [BLANK] : []));
  return { lines, selectedAt };
}

/** The first list line to show, so the selected row stays in view, centred when the list scrolls. */
function windowStart(selectedAt: number, total: number, room: number): number {
  if (total <= room || selectedAt < 0) return 0;
  return Math.min(Math.max(0, selectedAt - Math.floor(room / 2)), total - room);
}

function header(snapshot: DueSnapshot | null): Line {
  if (snapshot === null) return line(part("darius", "bold"));
  return line(part("darius", "bold"), part(` ${snapshot.version}  ${oneLine(snapshot.host)}  read ${clock(snapshot.readAt)}`));
}

function footer(state: TuiState, notice: Notice | null, width: number): Line[] {
  const hints = line(part(HINTS, "dim"));
  if (state.typed !== "") hints.parts.push(part(`  row ${state.typed}`, "bold"));
  return notice === null ? [hints] : [...noticeLines(notice, width), hints];
}

/** The whole Due screen, `size.rows` lines. */
export function dueScreen(snapshot: DueSnapshot | null, state: TuiState, size: Size, notice: Notice | null): Line[] {
  const head = [header(snapshot), BLANK];
  const foot = footer(state, notice, size.cols);
  const room = Math.max(0, size.rows - head.length - foot.length);
  // The list may have shrunk since the last key: the selection stays on the last row.
  const list = snapshot === null ? { lines: [], selectedAt: -1 } : listLines(snapshot, Math.min(state.selected, snapshot.rows.length - 1));
  const start = windowStart(list.selectedAt, list.lines.length, room);
  const body = list.lines.slice(start, start + room);
  return [...head, ...body, ...blanks(room - body.length), ...foot];
}
