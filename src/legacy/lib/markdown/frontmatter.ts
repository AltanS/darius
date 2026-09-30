/**
 * Lightweight frontmatter parser — no external dependencies.
 *
 * Replaces gray-matter + js-yaml with a purpose-built parser that handles
 * the strict YAML subset actually used in this repo's .tracker/ files.
 *
 * Supported subset:
 *   - Plain scalars: strings, integers, booleans (true/false only — no yes/no)
 *   - Quoted scalars: "double" and 'single' (no escape sequences except '' → ')
 *   - Date strings (YYYY-MM-DD): kept as strings, NOT coerced to Date objects
 *   - Empty values (key: or key: <space>): undefined
 *   - Block sequences (indented - items)
 *   - Inline empty sequence: []
 *   - Multi-line values: NOT supported; throws on detection
 *   - Nested mappings: NOT supported; throws on detection
 *   - Anchors, aliases, flow style (except []): NOT supported; throws
 *   - Comments: NOT supported inside frontmatter; throws
 *
 * Round-trip canonical writer:
 *   - Emits keys in the order provided (caller is responsible for ordering)
 *   - Bare scalars where possible; quotes when value contains ':', starts with
 *     '['/'{', looks like a number/bool but should be string, or contains
 *     leading/trailing whitespace or special YAML chars
 *   - Block sequences for non-empty arrays, '[]' for empty arrays
 *   - No trailing whitespace, single trailing newline before closing ---
 */

export type ParsedDocument = {
  /** Raw YAML front-matter data (any keys, passthrough-safe) */
  data: Record<string, unknown>;
  /** The markdown body after the front-matter delimiter */
  content: string;
};

// ---------------------------------------------------------------------------
// Block boundary location (shared by parse, and the non-throwing scanners)
// ---------------------------------------------------------------------------

type YamlBlockLocation = {
  /** Raw text between the opening `---` and the closing `---` (exclusive). */
  yamlBlock: string;
  /** The closing delimiter itself, e.g. "\n---\n" — preserved verbatim for rewrites. */
  closingDelim: string;
  /** Everything after the closing delimiter (the markdown body). */
  content: string;
};

/**
 * Locate the front-matter block boundaries without parsing its contents.
 * Returns null when there's no `---` opener or no matching closer — same
 * "not front-matter, treat as body" cases parseFrontmatter falls back on.
 */
function locateYamlBlock(raw: string): YamlBlockLocation | null {
  if (!raw.startsWith("---")) return null;

  const afterOpen = raw.slice(3);
  const closingMatch = /\n---(\r?\n|$)/.exec(afterOpen);
  if (!closingMatch) return null;

  const yamlBlock = afterOpen.slice(0, closingMatch.index);
  const closingDelim = closingMatch[0]!;
  const content = afterOpen.slice(closingMatch.index! + closingDelim.length);

  return { yamlBlock, closingDelim, content };
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/**
 * Parse a file string (with or without front-matter) into a typed shape.
 * Returns an empty `data` object when no front-matter is present.
 *
 * Date strings (YYYY-MM-DD) stay as strings — NOT coerced to JS Date.
 */
export function parseFrontmatter(raw: string): ParsedDocument {
  const located = locateYamlBlock(raw);
  if (!located) {
    return { data: {}, content: raw };
  }

  const data = parseYamlBlock(located.yamlBlock);
  return { data, content: located.content };
}

/**
 * Split a document into its VERBATIM front-matter block and the body after it.
 *
 * `parseFrontmatter` + `serializeFrontmatter` round-trips through the YAML
 * model, so it re-canonicalises quoting, key spacing and blank lines. A
 * body-only rewrite (`vigil set-body`) must not touch a single frontmatter
 * byte, so it splits on the raw text instead. `frontmatter` runs from the
 * opening `---` through the closing delimiter inclusive; concatenating
 * `frontmatter + body` reproduces the input exactly.
 *
 * Returns null when the document carries no front-matter block.
 */
export function splitRawFrontmatter(
  raw: string,
): { frontmatter: string; body: string } | null {
  const located = locateYamlBlock(raw);
  if (located === null) return null;
  return {
    frontmatter: `---${located.yamlBlock}${located.closingDelim}`,
    body: located.content,
  };
}

// ---------------------------------------------------------------------------
// Inline sequence detection — non-throwing, for doctor-style diagnostics
// ---------------------------------------------------------------------------

export type InlineSequenceIssue = {
  /** The frontmatter key using inline `[...]` syntax. */
  key: string;
  /** 1-indexed line number within the file. */
  line: number;
  /** The raw inline value text, e.g. "[01-first.md, 02-second.md]". */
  raw: string;
  /** Parsed items, unquoted. */
  items: string[];
};

/**
 * Scan front-matter for `key: [a, b]` inline sequence syntax — the one YAML
 * shape parseFrontmatter rejects outright (block form only). Never throws;
 * returns an empty array for well-formed or non-frontmatter input. Used by
 * `tracker doctor` to report this as a specific, fixable finding instead of
 * letting it surface as a generic (and, in some call sites, uncaught) parse
 * error.
 */
export function findInlineSequences(raw: string): InlineSequenceIssue[] {
  const located = locateYamlBlock(raw);
  if (!located) return [];
  return scanInlineSequences(located.yamlBlock);
}

/**
 * Rewrite every inline sequence in `raw`'s front-matter to block form.
 * Returns the input unchanged (with `rewrites: []`) when there's nothing to
 * rewrite. Preserves everything else byte-for-byte, including CRLF line
 * endings within the YAML block.
 */
export function rewriteInlineSequences(raw: string): {
  raw: string;
  rewrites: InlineSequenceIssue[];
} {
  const located = locateYamlBlock(raw);
  if (!located) return { raw, rewrites: [] };

  const issues = scanInlineSequences(located.yamlBlock);
  if (issues.length === 0) return { raw, rewrites: [] };

  const eol = /\r\n/.test(located.yamlBlock) ? "\r\n" : "\n";
  const lines = located.yamlBlock.replace(/\r\n/g, "\n").split("\n");
  const issueByLine = new Map(issues.map((issue) => [issue.line, issue]));

  const rewrittenLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const issue = issueByLine.get(i + 1);
    if (!issue) {
      rewrittenLines.push(lines[i]!);
      continue;
    }
    rewrittenLines.push(`${issue.key}:`);
    for (const item of issue.items) {
      rewrittenLines.push(`  - ${item}`);
    }
  }

  const newYamlBlock = rewrittenLines.join(eol);
  const newRaw = "---" + newYamlBlock + located.closingDelim + located.content;
  return { raw: newRaw, rewrites: issues };
}

function scanInlineSequences(yamlBlock: string): InlineSequenceIssue[] {
  const lines = yamlBlock.replace(/\r\n/g, "\n").split("\n");
  const issues: InlineSequenceIssue[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") continue;
    if (line.trim().startsWith("#")) continue;
    if (/^\s+/.test(line)) continue; // indented — block sequence item or nested mapping, not a top-level key

    const keyMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (!keyMatch) continue;

    const key = keyMatch[1]!;
    const rawValue = (keyMatch[2] ?? "").trim();
    if (rawValue === "[]") continue;
    if (!(rawValue.startsWith("[") && rawValue.endsWith("]"))) continue;

    const items = rawValue
      .slice(1, -1)
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map(unquoteInlineItem);

    issues.push({ key, line: i + 1, raw: rawValue, items });
  }

  return issues;
}

function unquoteInlineItem(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

/**
 * Serialize a data object + body back to a canonical markdown string.
 *
 * - Produces `---\n<yaml>\n---\n\n<body>` when data is non-empty.
 * - Produces `<body>` when data is empty.
 */
export function serializeFrontmatter(
  data: Record<string, unknown>,
  content: string,
): string {
  if (Object.keys(data).length === 0) {
    return content;
  }

  const yaml = serializeYamlBlock(data);
  const trimmedContent = content.replace(/^\n+/, "");
  return `---\n${yaml}---\n\n${trimmedContent}`;
}

// ---------------------------------------------------------------------------
// YAML block parser (internal)
// ---------------------------------------------------------------------------

function parseYamlBlock(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Normalize line endings
  const lines = yaml.replace(/\r\n/g, "\n").split("\n");

  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Skip blank lines
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Skip comment lines (# ...) — tolerated for backward compat with templates
    if (line.trim().startsWith("#")) {
      i++;
      continue;
    }

    // Detect indented lines that aren't sequence items for a known key
    // Top-level lines must not be indented (except block sequence items
    // that follow a key line — handled below)
    if (/^\s+/.test(line) && !line.trimStart().startsWith("- ")) {
      throw new FrontmatterParseError(
        `Nested mappings are not supported (line ${i + 1}): ${line}`,
      );
    }

    // Key: value line
    const keyMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (!keyMatch) {
      throw new FrontmatterParseError(
        `Invalid frontmatter line (line ${i + 1}): ${line}`,
      );
    }

    const key = keyMatch[1]!;
    const rawValue = (keyMatch[2] ?? "").trim();

    // Check for inline empty sequence
    if (rawValue === "[]") {
      result[key] = [];
      i++;
      continue;
    }

    // Check for inline anchor/alias — not supported
    if (rawValue.startsWith("*") || rawValue.startsWith("&")) {
      throw new FrontmatterParseError(
        `Anchors and aliases are not supported (line ${i + 1}): ${line}`,
      );
    }

    // Check for inline flow mapping — not supported
    if (rawValue.startsWith("{")) {
      throw new FrontmatterParseError(
        `Inline mappings are not supported (line ${i + 1}): ${line}`,
      );
    }

    // Check for inline non-empty sequence — not supported (use block form)
    if (rawValue.startsWith("[") && rawValue !== "[]") {
      throw new FrontmatterParseError(
        `Inline non-empty sequences are not supported (line ${i + 1}): ${line}. Use block form.`,
      );
    }

    // Empty value (key: or key: <whitespace>)
    if (rawValue === "") {
      // Peek ahead for block sequence items
      const seqItems = collectBlockSequence(lines, i + 1);
      if (seqItems !== null) {
        result[key] = seqItems;
        i += seqItems.length + 1;
        continue;
      }
      result[key] = undefined;
      i++;
      continue;
    }

    // Multiline indicator — not supported
    if (rawValue === "|" || rawValue === ">" || rawValue === "|-" || rawValue === ">-") {
      throw new FrontmatterParseError(
        `Multiline string values are not supported (line ${i + 1}): ${line}`,
      );
    }

    result[key] = parseScalar(rawValue, i + 1);
    i++;
  }

  return result;
}

/**
 * Attempt to collect block sequence items starting at `startLine`.
 * Returns null if the next line is not a sequence item.
 * Returns an array of parsed strings if sequence items are found.
 */
function collectBlockSequence(
  lines: string[],
  startLine: number,
): string[] | null {
  const items: string[] = [];

  let j = startLine;
  while (j < lines.length) {
    const line = lines[j]!;

    // Skip blank lines (they don't terminate a block sequence)
    if (line.trim() === "") {
      // If we haven't started collecting, stop
      if (items.length === 0) return null;
      // If mid-sequence, a blank line ends it
      break;
    }

    // Sequence item must be indented with spaces then "- "
    const seqMatch = /^(\s+)- (.*)$/.exec(line);
    if (!seqMatch) {
      // Not a sequence item — stop
      break;
    }

    const raw = (seqMatch[2] ?? "").trim();
    // Unquote the item. Pushing the raw text here let serializeScalar
    // re-quote an already quoted item on every write, so each round trip
    // doubled the quote count.
    items.push(unquoteScalar(raw));
    j++;
  }

  if (items.length === 0) return null;
  return items;
}

/**
 * Strip one layer of YAML quoting from a scalar, if it carries any.
 * An unquoted value is returned unchanged, so the call is idempotent.
 */
function unquoteScalar(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1);
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  return raw;
}

/**
 * Parse a YAML scalar value string into the appropriate JS type.
 */
function parseScalar(raw: string, lineNum: number): string | number | boolean {
  // Boolean
  if (raw === "true") return true;
  if (raw === "false") return false;

  // Quoted string — double quotes
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    // Simple unquoting — we don't support escape sequences except basic ones
    return raw.slice(1, -1);
  }

  // Quoted string — single quotes
  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
    // Single-quoted: '' → '
    return raw.slice(1, -1).replace(/''/g, "'");
  }

  // Integer (only pure digit sequences, optional leading -)
  // Do NOT coerce YYYY-MM-DD date strings to numbers
  if (/^-?\d+$/.test(raw)) {
    return parseInt(raw, 10);
  }

  // Reject octal literals (0o...) and other YAML quirks
  if (/^0[0-9]/.test(raw)) {
    throw new FrontmatterParseError(
      `Octal literals are not supported (line ${lineNum}): ${raw}`,
    );
  }

  // Plain string (includes date strings like 2026-05-09)
  return raw;
}

// ---------------------------------------------------------------------------
// YAML block serializer (internal)
// ---------------------------------------------------------------------------

function serializeYamlBlock(data: Record<string, unknown>): string {
  const lines: string[] = [];

  for (const key of Object.keys(data)) {
    const value = data[key];

    if (value === undefined || value === null) {
      lines.push(`${key}:`);
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${serializeScalar(item)}`);
        }
      }
      continue;
    }

    if (typeof value === "object") {
      throw new FrontmatterParseError(
        `Nested objects are not supported in frontmatter serialization (key: ${key})`,
      );
    }

    lines.push(`${key}: ${serializeScalar(value)}`);
  }

  return lines.length > 0 ? lines.join("\n") + "\n" : "";
}

/**
 * Serialize a scalar value to a YAML-safe string.
 *
 * Quoting rules:
 * - Booleans and integers: bare
 * - Strings that look like booleans/integers/dates → single-quoted
 * - Strings containing ':' or leading '['/'{' → single-quoted
 * - Strings with leading/trailing whitespace → single-quoted
 * - Otherwise: bare
 */
function serializeScalar(value: unknown): string {
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return String(value);

  const s = String(value);

  // Must quote if looks like boolean
  if (s === "true" || s === "false") return `'${s}'`;

  // Must quote if looks like integer
  if (/^-?\d+$/.test(s)) return `'${s}'`;

  // Must quote if leading/trailing whitespace
  if (s !== s.trim()) return `'${s.replace(/'/g, "''")}'`;

  // Must quote if contains ': ' (colon-space, YAML mapping indicator)
  // or starts with special chars
  if (
    s.includes(": ") ||
    s.startsWith("[") ||
    s.startsWith("{") ||
    s.startsWith("*") ||
    s.startsWith("&") ||
    s.startsWith("!") ||
    s.startsWith("|") ||
    s.startsWith(">") ||
    s.startsWith("'") ||
    s.startsWith('"') ||
    s.startsWith("#") ||
    s.endsWith(":")
  ) {
    // Use single quotes, escaping embedded single quotes as ''
    return `'${s.replace(/'/g, "''")}'`;
  }

  return s;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class FrontmatterParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrontmatterParseError";
  }
}
