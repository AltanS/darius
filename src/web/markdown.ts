/**
 * A small markdown parser for run findings and ritual instructions. The
 * input is untrusted (a model writes findings), so the output is data, not
 * HTML: blocks of spans that the web app renders as React text nodes. There
 * is no raw HTML, no link and no image in the model (src/web/api.ts).
 *
 * Blocks: `#` to `######` headings, `-`/`*` and `1.` lists (one level),
 * pipe tables with a `|---|` separator row, fenced code, paragraphs.
 * Inline: `code`, **bold**, *italic*.
 */

import type { MdBlock, MdLine, MdSpan } from "./api.ts";

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
      const items: MdLine[] = [];
      for (; i < lines.length && pattern.test(lines[i] ?? ""); i += 1) items.push(parseInline(pattern.exec(lines[i] ?? "")?.[1] ?? ""));
      i -= 1;
      // A numbered list broken up by sub-bullets goes on with its own numbers.
      const start = isBullet ? 1 : Number(NUMBER.exec(line)?.[1] ?? "1");
      out.push({ kind: "list", ordered: !isBullet, start, items });
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return out;
}
