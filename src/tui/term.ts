/**
 * The terminal under the TUI: raw keys in, whole frames out. Modelled on
 * a sibling project's dependency-free TUI: plain ANSI on raw stdin, no dependency.
 *
 * MODES. `enterModes()` switches to the alternate screen, hides the cursor,
 * turns line wrap off (an over-long row is clipped, never pushed onto the
 * next one) and turns bracketed paste on, so pasted text arrives between two
 * markers and a newline in it cannot submit an answer or reach the next
 * screen as keys. `leaveModes()` undoes each, in reverse order. src/tui/app.ts
 * calls it on every way out.
 *
 * KEYS. `decodeKeys()` turns one chunk of stdin (utf8) into keys. Escape
 * sequences are parsed by their CSI or SS3 grammar, so an unknown sequence
 * is dropped whole instead of landing in the answer as characters. A lone
 * ESC at the end of a chunk is the Esc key. Other control bytes are dropped,
 * except the ones named below.
 */

import { paint, type Line } from "./text.ts";

const ESC = "\u001b";
const CSI = `${ESC}[`;

export const ENTER_MODES = `${CSI}?1049h${CSI}?25l${CSI}?7l${CSI}?2004h`;
export const LEAVE_MODES = `${CSI}0m${CSI}?2004l${CSI}?7h${CSI}?25h${CSI}?1049l`;

export type NamedKey = "up" | "down" | "pageup" | "pagedown" | "enter" | "esc" | "backspace" | "ctrl-c" | "paste-start" | "paste-end";

/** One key press. `char` is one printable code point, or a tab. */
export type Key = { kind: "char"; char: string } | { kind: NamedKey };

export interface Size {
  cols: number;
  rows: number;
}

/** CSI finals that name a key whatever their parameters (a modifier such as `1;5` is ignored). */
const CSI_FINALS: ReadonlyMap<string, NamedKey> = new Map([
  ["A", "up"],
  ["B", "down"],
]);

/** `CSI <n> ~` keys. */
const TILDE_KEYS: ReadonlyMap<string, NamedKey> = new Map([
  ["5", "pageup"],
  ["6", "pagedown"],
  ["200", "paste-start"],
  ["201", "paste-end"],
]);

function named(kind: NamedKey): Key {
  return { kind };
}

function isFinalByte(char: string): boolean {
  return char >= "@" && char <= "~";
}

/** What one escape sequence meant, and where the next key starts. */
interface SequenceRead {
  key: Key | null;
  next: number;
}

/** The key a CSI sequence starting at `start` (just after `ESC [`) names, and where it ends. */
function readCsi(data: string, start: number): SequenceRead {
  let index = start;
  while (index < data.length && !isFinalByte(data.charAt(index))) index += 1;
  if (index >= data.length) return { key: null, next: data.length };
  const params = data.slice(start, index);
  const final = data.charAt(index);
  const kind = final === "~" ? TILDE_KEYS.get(params.split(";")[0] ?? "") : CSI_FINALS.get(final);
  return { key: kind === undefined ? null : named(kind), next: index + 1 };
}

/** The code point at `index` of `data`, as a string of one or two UTF-16 units. */
function charAt(data: string, index: number): string {
  const code = data.codePointAt(index);
  return code === undefined ? "" : String.fromCodePoint(code);
}

function isC1(char: string): boolean {
  return char >= "\u0080" && char <= "\u009f";
}

/** Every key in one chunk of stdin, in order. */
export function decodeKeys(data: string): Key[] {
  const keys: Key[] = [];
  let index = 0;
  while (index < data.length) {
    const char = charAt(data, index);
    index += char.length;
    if (char === ESC) {
      const next = data.charAt(index);
      if (next === "" || next === ESC) {
        keys.push(named("esc"));
      } else if (next === "[") {
        const read = readCsi(data, index + 1);
        if (read.key !== null) keys.push(read.key);
        index = read.next;
      } else if (next === "O") {
        const kind = CSI_FINALS.get(data.charAt(index + 1));
        if (kind !== undefined) keys.push(named(kind));
        index += 2;
      } else {
        // Alt plus a key: nothing here uses it, and the key alone must not act.
        index += charAt(data, index).length;
      }
      continue;
    }
    if (char === "\r") {
      keys.push(named("enter"));
      if (data.charAt(index) === "\n") index += 1;
    } else if (char === "\n") keys.push(named("enter"));
    else if (char === "\u007f" || char === "\b") keys.push(named("backspace"));
    else if (char === "\u0003") keys.push(named("ctrl-c"));
    else if (char === "\t" || (char >= " " && !isC1(char))) keys.push({ kind: "char", char });
  }
  return keys;
}

/**
 * One whole frame: every row of the screen, each erased and then drawn from
 * column 1. Rows past `lines` are blank. The erase comes first: with line
 * wrap off, a row that fills the width leaves the cursor ON its last cell,
 * and an erase after it would wipe that cell. One write per frame, so the
 * terminal never shows half a screen.
 */
export function frame(lines: readonly Line[], size: Size, hasColour: boolean): string {
  let out = "";
  for (let row = 0; row < size.rows; row += 1) {
    const content = lines[row];
    out += `${CSI}${String(row + 1)};1H${CSI}2K${content === undefined ? "" : paint(content, size.cols, hasColour)}`;
  }
  return out;
}

/** False when NO_COLOR is set to anything but the empty string (https://no-color.org). */
export function colourAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.NO_COLOR;
  return flag === undefined || flag === "";
}
