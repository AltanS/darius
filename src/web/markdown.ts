/**
 * A small markdown parser for run findings and ritual instructions. The
 * input is untrusted (a model writes findings), so the output is data, not
 * HTML: blocks of spans that the web app renders as React text nodes. There
 * is no raw HTML, no link and no image in the model (src/web/api.ts).
 *
 * Blocks: `#` to `######` headings, `-`/`*` and `1.` lists (an indented
 * item is marked nested, one level; an indented line that starts no item
 * carries on the item above), checklist boxes (`- [x]`, as the
 * tracker writes them), pipe tables with a `|---|` separator row, fenced
 * code, paragraphs. An HTML comment on lines of its own is left out, as a
 * markdown viewer leaves it out. Inline: `code`, **bold**, *italic*.
 */

import type { MdBlock, MdCheck, MdLine, MdList, MdSpan } from "./api.ts";

const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|(?<=^|[\s(])\*([^*\s][^*]*)\*/gu;

/** One line of text to spans. Exported for tests. */
export function parseInline(line: string): MdLine {
  const spans: MdSpan[] = [];
  let last = 0;
  for (const match of line.matchAll(INLINE)) {
    const at = match.index;
    if (at > last) spans.push({ kind: "text", text: line.slice(last, at) });
    if (match[1] !== undefined) spans.push({ kind: "code", text: match[1] });
    else if (match[2] !== undefined) spans.push({ kind: "bold", text: match[2] });
    else spans.push({ kind: "italic", text: match[3] ?? "" });
    last = at + match[0].length;
  }
  if (last < line.length) spans.push({ kind: "text", text: line.slice(last) });
  return spans;
}

function cells(row: string): MdLine[] {
  const trimmed = row.trim().replace(/^\|/u, "").replace(/\|$/u, "");
  return trimmed.split("|").map((cell) => parseInline(cell.trim()));
}

const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/u;
const HEADING = /^(#{1,6})\s+(.*)$/u;
const BULLET = /^\s*[-*]\s+(.*)$/u;
const NUMBERED = /^\s*(?:\d+)[.)]\s+(.*)$/u;
const NUMBER = /^\s*(\d+)/u;
const FENCE = /^\s*```/u;
/** A checklist box at the start of a list item, as the tracker writes it. */
const CHECK = /^\[([ xX~!-])\](?:\s+(.*))?$/u;
const COMMENT_LINE = /^<!--.*-->$/u;

function checkOf(marker: string): MdCheck {
  if (marker === "x" || marker === "X") return "done";
  if (marker === "~") return "doing";
  if (marker === "!") return "blocked";
  if (marker === "-") return "skipped";
  return "open";
}

/** How far a line is indented; a tab counts as four spaces. */
function indentOf(line: string): number {
  const lead = /^[ \t]*/u.exec(line)?.[0] ?? "";
  return lead.replaceAll("\t", "    ").length;
}

/** The index of the last line of an HTML comment that starts at `i` and fills its lines, or -1. */
function commentEnd(lines: readonly string[], i: number): number {
  const first = (lines[i] ?? "").trim();
  if (!first.startsWith("<!--")) return -1;
  if (COMMENT_LINE.test(first)) return i;
  if (first.includes("-->")) return -1;
  for (let j = i + 1; j < lines.length; j += 1) {
    const line = (lines[j] ?? "").trim();
    if (line.includes("-->")) return line.endsWith("-->") ? j : -1;
  }
  return -1;
}

/** A line that carries on the list item above it: indented, and no item, fence or blank line of its own. */
function isContinuation(line: string): boolean {
  return line.trim() !== "" && indentOf(line) >= 2 && !BULLET.test(line) && !NUMBERED.test(line) && !FENCE.test(line);
}

/** List item texts to a list block, with the boxes and the nesting when there are any. */
function listBlock(ordered: boolean, start: number, texts: readonly string[], indents: readonly number[]): MdList {
  const items: MdLine[] = [];
  const checks: Array<MdCheck | null> = [];
  for (const text of texts) {
    const check = CHECK.exec(text);
    items.push(parseInline(check === null ? text : (check[2] ?? "")));
    checks.push(check === null ? null : checkOf(check[1] ?? " "));
  }
  const base = indents[0] ?? 0;
  const nested = indents.map((indent, index) => index > 0 && indent >= base + 2);
  const block: MdList = { kind: "list", ordered, start, items };
  if (checks.some((check) => check !== null)) block.checks = checks;
  if (nested.some(Boolean)) block.nested = nested;
  return block;
}

/** Markdown to blocks. */
export function parseMarkdown(markdown: string): MdBlock[] {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const out: MdBlock[] = [];
  let paragraph: string[] = [];
  const flush = (): void => {
    if (paragraph.length > 0) out.push({ kind: "paragraph", lines: paragraph.map((line) => parseInline(line)) });
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (FENCE.test(line)) {
      flush();
      const code: string[] = [];
      for (i += 1; i < lines.length && !FENCE.test(lines[i] ?? ""); i += 1) code.push(lines[i] ?? "");
      out.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    const comment = commentEnd(lines, i);
    if (comment !== -1) {
      flush();
      i = comment;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      flush();
      out.push({ kind: "heading", level: (heading[1] ?? "#").length, content: parseInline(heading[2] ?? "") });
      continue;
    }
    if (line.trim().startsWith("|") && TABLE_SEPARATOR.test(lines[i + 1] ?? "")) {
      flush();
      const head = cells(line);
      const rows: MdLine[][] = [];
      for (i += 2; i < lines.length && (lines[i] ?? "").trim().startsWith("|"); i += 1) rows.push(cells(lines[i] ?? ""));
      i -= 1;
      out.push({ kind: "table", head, rows });
      continue;
    }
    const isBullet = BULLET.test(line);
    if (isBullet || NUMBERED.test(line)) {
      flush();
      const pattern = isBullet ? BULLET : NUMBERED;
      const texts: string[] = [];
      const indents: number[] = [];
      for (; i < lines.length && pattern.test(lines[i] ?? ""); i += 1) {
        texts.push(pattern.exec(lines[i] ?? "")?.[1] ?? "");
        indents.push(indentOf(lines[i] ?? ""));
        // An indented line that starts no item goes on the item before it: hard-wrapped text.
        while (isContinuation(lines[i + 1] ?? "")) {
          i += 1;
          texts[texts.length - 1] = `${texts.at(-1) ?? ""} ${(lines[i] ?? "").trim()}`;
        }
      }
      i -= 1;
      // A numbered list broken up by sub-bullets goes on with its own numbers.
      const start = isBullet ? 1 : Number(NUMBER.exec(line)?.[1] ?? "1");
      out.push(listBlock(!isBullet, start, texts, indents));
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return out;
}
