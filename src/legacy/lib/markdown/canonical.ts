/**
 * Canonical form serializer for tracker documents.
 *
 * The canonical form is the "single source of truth" for what the CLI writes.
 * Any file touched by the CLI is normalized on first write. This makes diffs
 * predictable: only semantically meaningful changes produce non-empty diffs.
 *
 * Rules:
 * 1. Front-matter keys are sorted alphabetically.
 * 2. A single blank line separates the front-matter closing `---` from the body.
 * 3. Trailing whitespace is stripped from every line.
 * 4. The file ends with exactly one newline character.
 * 5. Checklist items use `- [ ]` / `- [x]` (lower-case x).
 * 6. Command/Expected sub-keys use backtick code spans.
 */

import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.ts";

/**
 * Normalize a raw markdown string to canonical form.
 *
 * Idempotent: `canonicalize(canonicalize(s)) === canonicalize(s)`
 */
export function canonicalize(raw: string): string {
  const { data, content } = parseFrontmatter(raw);
  const normalizedContent = normalizeBody(content);
  const serialized = serializeFrontmatter(data, normalizedContent);
  return ensureTrailingNewline(serialized);
}

/**
 * Normalize the markdown body (everything after front-matter):
 * - Strip trailing whitespace from each line.
 * - Normalize checklist markers to lower-case `x`.
 * - Collapse multiple consecutive blank lines into at most two blank lines.
 */
function normalizeBody(body: string): string {
  const lines = body.split("\n");
  const normalized = lines
    .map((line) => line.trimEnd())
    .map((line) => line.replace(/^(\s*)- \[X\]/, "$1- [x]"));

  const collapsed = collapseBlankLines(normalized);
  return collapsed.join("\n");
}

/**
 * Collapse runs of more than 2 blank lines into exactly 2 blank lines.
 */
function collapseBlankLines(lines: string[]): string[] {
  const result: string[] = [];
  let blankRun = 0;

  for (const line of lines) {
    if (line === "") {
      blankRun++;
      if (blankRun <= 2) {
        result.push(line);
      }
    } else {
      blankRun = 0;
      result.push(line);
    }
  }
  return result;
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s : `${s}\n`;
}
