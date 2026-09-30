/**
 * Text for the TUI (docs/concept.md, "App design" > "TUI"): store text made
 * safe to print, fitted to a width in terminal cells, and styled lines.
 *
 * UNTRUSTED TEXT. Findings, questions, answers and titles are written by a
 * model or a person. Printed raw, one ESC byte could move the cursor, set the
 * window title or hide the text around it. `clean()` removes every C0 and C1
 * control character (ESC, BEL and DEL included) and the bidi controls, which
 * can reorder what the operator reads. Only newline survives; a tab becomes
 * two spaces. `paint()` runs every part through `oneLine()` again, so no
 * screen can print a control byte by mistake: the only escapes on the wire
 * are the SGR codes `paint()` adds itself.
 *
 * WIDTH. A width is counted in terminal cells, per code point: East Asian
 * wide and emoji code points take two, combining marks none. The table is
 * short on purpose; the TUI also turns the terminal's line wrap off
 * (src/tui/term.ts), so a miscount clips a line instead of breaking the frame.
 */

const TAB = "  ";
const ELLIPSIS = "…";

/** Bidi controls and the Unicode line and paragraph separators: printable in name only. */
const INVISIBLE: ReadonlySet<number> = new Set([
  0x061c, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
]);

/** Inclusive code point ranges that take two cells. */
const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
];

/** Inclusive code point ranges that take no cell: combining marks, zero-width space and joiners, variation selectors. */
const ZERO: readonly (readonly [number, number])[] = [
  [0x0300, 0x036f],
  [0x200b, 0x200d],
  [0xfe00, 0xfe0f],
];

function isControl(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

function inRanges(code: number, ranges: readonly (readonly [number, number])[]): boolean {
  return ranges.some(([low, high]) => code >= low && code <= high);
}

/** `text` without control characters: newline stays, a tab becomes two spaces, the rest is dropped. */
export function clean(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (char === "\n") out += char;
    else if (char === "\t") out += TAB;
    else if (!isControl(code) && !INVISIBLE.has(code)) out += char;
  }
  return out;
}

/** `clean(text)` on one line: every run of whitespace, newlines included, becomes one space. */
export function oneLine(text: string): string {
  return clean(text).replace(/\s+/gu, " ").trim();
}

/** The cells one code point takes. */
export function charCells(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (isControl(code) || inRanges(code, ZERO)) return 0;
  return inRanges(code, WIDE) ? 2 : 1;
}

/** The cells `text` takes on one terminal line. */
export function cells(text: string): number {
  let total = 0;
  for (const char of text) total += charCells(char);
  return total;
}

/** `text` cut to `width` cells, with an ellipsis in the last cell when it was cut. */
export function truncate(text: string, width: number): string {
  if (width <= 0) return "";
  if (cells(text) <= width) return text;
  let out = "";
  let used = 0;
  for (const char of text) {
    const size = charCells(char);
    if (used + size > width - 1) break;
    out += char;
    used += size;
  }
  return out + ELLIPSIS;
}

/** The last `width` cells of `text`: what a one-line input shows while the text grows. */
export function tail(text: string, width: number): string {
  if (width <= 0) return "";
  const chars = [...text];
  let out = "";
  let used = 0;
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    const char = chars[index] ?? "";
    const size = charCells(char);
    if (used + size > width) break;
    out = char + out;
    used += size;
  }
  return out;
}

/** One source line broken into rows of at most `width` cells, at spaces where it can. */
function wrapLine(sourceLine: string, width: number): string[] {
  if (cells(sourceLine) <= width) return [sourceLine];
  const rows: string[] = [];
  let row = "";
  let used = 0;
  for (const token of sourceLine.match(/\s+|\S+/gu) ?? []) {
    const size = cells(token);
    if (used + size <= width) {
      row += token;
      used += size;
      continue;
    }
    if (/^\s/u.test(token)) {
      rows.push(row);
      row = "";
      used = 0;
      continue;
    }
    if (size <= width) {
      if (row !== "") rows.push(row.trimEnd());
      row = token;
      used = size;
      continue;
    }
    for (const char of token) {
      const charSize = charCells(char);
      if (used + charSize > width && row !== "") {
        rows.push(row);
        row = "";
        used = 0;
      }
      row += char;
      used += charSize;
    }
  }
  rows.push(row);
  return rows;
}

/** `text` word-wrapped to `width` cells. Newlines stay line breaks; `text` must be `clean()` already. */
export function wrap(text: string, width: number): string[] {
  return text.split("\n").flatMap((sourceLine) => wrapLine(sourceLine, Math.max(1, width)));
}

/** `n` and the noun, plural when `n` is not 1: "1 question", "2 questions". */
export function count(n: number, noun: string): string {
  return `${String(n)} ${noun}${n === 1 ? "" : "s"}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** `HH:MM:SS` of an ISO instant, in the host's zone. */
export function clock(iso: string): string {
  const at = new Date(iso);
  return `${pad2(at.getHours())}:${pad2(at.getMinutes())}:${pad2(at.getSeconds())}`;
}

/** `YYYY-MM-DD HH:MM` of an ISO instant, in the host's zone. */
export function stamp(iso: string): string {
  const at = new Date(iso);
  return `${String(at.getFullYear())}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())} ${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
}

// --- styled lines ------------------------------------------------------------------

/**
 * The few styles the TUI uses. `needs` marks what waits for the operator (a
 * warm yellow), `failed` is red, `dim` is quiet text, `cursor` is the block
 * at the end of the answer prompt.
 */
export type Tone = "plain" | "bold" | "dim" | "needs" | "failed" | "cursor";

export interface Part {
  text: string;
  tone: Tone;
}

/** One terminal row. `isSelected` draws it in reverse video across the whole width. */
export interface Line {
  parts: Part[];
  isSelected: boolean;
}

export function part(text: string, tone: Tone = "plain"): Part {
  return { text, tone };
}

export function line(...parts: Part[]): Line {
  return { parts, isSelected: false };
}

export const BLANK: Line = line();

/** Every part's text, joined: what a test compares. */
export function plain(row: Line): string {
  return row.parts.map((entry) => entry.text).join("");
}

const SGR_RESET = "\u001b[0m";
const SGR_REVERSE = "\u001b[7m";

/** The SGR codes per tone. With NO_COLOR the two colours fall back to bold: emphasis is not colour. */
function toneCodes(tone: Tone, hasColour: boolean): string {
  if (tone === "bold") return "\u001b[1m";
  if (tone === "dim") return "\u001b[2m";
  if (tone === "cursor") return SGR_REVERSE;
  if (tone === "needs") return hasColour ? "\u001b[33m" : "\u001b[1m";
  if (tone === "failed") return hasColour ? "\u001b[31m" : "\u001b[1m";
  return "";
}

/** One row as terminal bytes: cleaned, cut to `width` cells, styled. */
export function paint(row: Line, width: number, hasColour: boolean): string {
  let out = "";
  let used = 0;
  for (const entry of row.parts) {
    const room = width - used;
    if (room <= 0) break;
    const text = truncate(oneLineKeepSpaces(entry.text), room);
    if (text === "") continue;
    const codes = (row.isSelected ? SGR_REVERSE : "") + toneCodes(entry.tone, hasColour);
    out += codes === "" ? text : `${codes}${text}${SGR_RESET}`;
    used += cells(text);
  }
  if (row.isSelected && used < width) out += `${SGR_REVERSE}${" ".repeat(width - used)}${SGR_RESET}`;
  return out;
}

/** `clean()` for one row: a newline becomes a space; runs of spaces stay, since layout uses them. */
function oneLineKeepSpaces(text: string): string {
  return clean(text).replaceAll("\n", " ");
}

// --- screen furniture --------------------------------------------------------------

/** A one-line message under a screen: what the last key did, or why it did nothing. */
export interface Notice {
  text: string;
  isError: boolean;
}

/** A notice wrapped to the width: it may hold a path the operator needs whole. */
export function noticeLines(notice: Notice, width: number): Line[] {
  const tone = notice.isError ? "failed" : "plain";
  return wrap(oneLine(notice.text), width).map((row) => line(part(row, tone)));
}

/** `n` blank rows. */
export function blanks(n: number): Line[] {
  return Array.from({ length: Math.max(0, n) }, () => BLANK);
}
