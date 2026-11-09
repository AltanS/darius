/**
 * The summary at the top of a milestone page (0.125.0): one plain paragraph
 * from the README. It is the first paragraph under the `## Goal` heading.
 * When that is missing, empty, or still the template placeholder, it is the
 * first prose paragraph of the README. Otherwise there is none.
 *
 * The README is untrusted text, so the result is plain text: the markdown
 * marks are gone, and it is cut to about 280 characters on a word boundary.
 */

import type { MdBlock, MdLine } from "./api.ts";
import { parseMarkdown } from "./markdown.ts";

/** The longest summary, in characters, before the ellipsis. */
export const SUMMARY_MAX = 280;

/** A template placeholder that nobody filled in: `{{ONE_SENTENCE_GOAL}}`. The tracker writes HTML comments, which the parser drops. */
const PLACEHOLDER = /^\{\{[A-Z0-9_]+\}\}$/u;
/** A link `[text](url)`: the text stays. */
const LINK = /\[([^\]]*)\]\([^)]*\)/gu;

function lineText(line: MdLine): string {
  return line.map((span) => span.text).join("");
}

/** A paragraph as one line of plain text. */
function paragraphText(lines: readonly MdLine[]): string {
  return lines
    .map(lineText)
    .join(" ")
    .replace(LINK, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}

/** The text of a prose paragraph, or null when the block is no paragraph or holds only a placeholder. */
function prose(block: MdBlock): string | null {
  if (block.kind !== "paragraph") return null;
  const text = paragraphText(block.lines);
  return text === "" || PLACEHOLDER.test(text) ? null : text;
}

/** The first paragraph under a `## Goal` heading, before the next heading; null when there is none. */
function goalText(blocks: readonly MdBlock[]): string | null {
  const at = blocks.findIndex((block) => block.kind === "heading" && block.level === 2 && lineText(block.content).trim().toLowerCase() === "goal");
  if (at === -1) return null;
  for (const block of blocks.slice(at + 1)) {
    if (block.kind === "heading") return null;
    if (block.kind === "paragraph") return prose(block);
  }
  return null;
}

/** Text cut to `max` characters at the last space, with "…"; shorter text stays as it is. */
export function capText(text: string, max: number = SUMMARY_MAX): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const space = head.lastIndexOf(" ");
  const cut = space > 0 ? head.slice(0, space) : head;
  return `${cut.replace(/[\s,;:.-]+$/u, "")}…`;
}

/** The summary of a README body (header already cut off); null when it has no prose. */
export function milestoneSummary(readme: string | null): string | null {
  if (readme === null) return null;
  const blocks = parseMarkdown(readme);
  const text = goalText(blocks) ?? blocks.map(prose).find((candidate) => candidate !== null) ?? null;
  return text === null ? null : capText(text);
}
