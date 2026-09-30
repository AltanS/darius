/**
 * The item file format: a `---`-fenced frontmatter block (a small YAML
 * subset, docs/plan-tonight.md "Data formats") followed by a markdown body.
 *
 * The subset is exactly: `key: scalar`, `key:` followed by indented
 * `- item` lines (a list of scalars), and one level of nested map (each of
 * its own values a scalar or a list — never a further nested map). Scalars
 * are either bare text or a double-quoted string; single quotes and
 * multi-line block scalars are not supported. Anything else is a parse
 * error naming the file and line. The body is kept byte for byte: import
 * (a later task) must never rewrite a body it copied in.
 */

export type FrontmatterScalar = string;
export type FrontmatterList = readonly FrontmatterScalar[];

/**
 * DEVIATION from the module contract in docs/plan-tonight.md, which types
 * a header `Record<string, unknown>`: the vendored oxlint rule
 * `anti-slop/no-unsafe-dictionary-type` reports on an `unknown`-valued
 * dictionary, so the header's value type is spelled out to the shapes the
 * grammar above actually produces instead. `FrontmatterMap` is typed
 * recursively (a map of `FrontmatterValue`, not capped at one level) only
 * because TypeScript has no way to say "a map whose values are never
 * themselves a map" without duplicating this whole union; the one-level
 * limit is a parser rule (`parseMapBlock`'s `depth` guard below), enforced
 * on every byte actually read from disk.
 */
export type FrontmatterValue = FrontmatterScalar | FrontmatterList | FrontmatterMap;
export interface FrontmatterMap {
  readonly [key: string]: FrontmatterValue;
}
export interface FrontmatterHeader {
  readonly [key: string]: FrontmatterValue;
}

interface KeyValueSplit {
  readonly key: string;
  readonly inlineValue: string | null;
}

interface ListParseResult {
  readonly items: string[];
  readonly next: number;
}

interface MapParseResult {
  readonly map: Record<string, FrontmatterValue>;
  readonly next: number;
}

/** The parsed shape of an item file: its header and its verbatim body. */
export interface ParsedDocument {
  readonly header: FrontmatterHeader;
  readonly body: string;
}

interface Line {
  readonly text: string;
  readonly number: number;
}

function toLines(text: string): Line[] {
  return text.split("\n").map((content, index) => ({ text: content, number: index + 1 }));
}

function parseError(file: string, lineNumber: number, message: string): Error {
  return new Error(`${file}:${lineNumber}: ${message}`);
}

function leadingSpaces(line: Line, file: string): number {
  const match = /^ */u.exec(line.text);
  const spaces = match !== null ? match[0].length : 0;
  if (line.text.length === spaces) throw parseError(file, line.number, "blank line inside frontmatter");
  if (line.text[spaces] === "\t") throw parseError(file, line.number, "tabs are not allowed for indentation");
  return spaces;
}

function findKeySeparator(content: string): number {
  const spaceColon = content.indexOf(": ");
  if (spaceColon !== -1) return spaceColon;
  return content.endsWith(":") ? content.length - 1 : -1;
}

function splitKeyValue(content: string, file: string, lineNumber: number): KeyValueSplit {
  const separator = findKeySeparator(content);
  if (separator === -1) {
    throw parseError(file, lineNumber, `expected 'key: value' or 'key:', got '${content}'`);
  }
  const key = content.slice(0, separator);
  if (key.length === 0) throw parseError(file, lineNumber, "empty key");
  const rawValue = content.slice(separator + 1);
  if (rawValue.length === 0) return { key, inlineValue: null };
  if (!rawValue.startsWith(" ")) {
    throw parseError(file, lineNumber, `expected a space after ':' in '${content}'`);
  }
  const value = rawValue.slice(1);
  if (value.length === 0) {
    throw parseError(file, lineNumber, `trailing space after ':' with no value in '${content}'`);
  }
  return { key, inlineValue: value };
}

function parseScalar(raw: string, file: string, lineNumber: number): string {
  if (raw.startsWith("'")) {
    throw parseError(file, lineNumber, `single-quoted strings are not supported: ${raw}`);
  }
  if (!raw.startsWith('"')) return raw;
  if (raw.length < 2 || !raw.endsWith('"')) {
    throw parseError(file, lineNumber, `unterminated double-quoted string: ${raw}`);
  }
  const inner = raw.slice(1, -1);
  let result = "";
  let index = 0;
  while (index < inner.length) {
    const char = inner[index] ?? "";
    if (char !== "\\") {
      result += char;
      index += 1;
      continue;
    }
    const next = inner[index + 1];
    if (next !== '"' && next !== "\\") {
      throw parseError(file, lineNumber, `unsupported escape sequence in ${raw}`);
    }
    result += next;
    index += 2;
  }
  return result;
}

function parseListBlock(
  lines: readonly Line[],
  start: number,
  indent: number,
  file: string,
): ListParseResult {
  const items: string[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined) break;
    const lineIndent = leadingSpaces(line, file);
    if (lineIndent < indent) break;
    if (lineIndent > indent) throw parseError(file, line.number, "unexpected indentation in list");
    const content = line.text.slice(indent);
    if (content === "-") throw parseError(file, line.number, "empty list item");
    if (!content.startsWith("- ")) {
      throw parseError(file, line.number, `expected a list item ('- …'), got '${content}'`);
    }
    const itemText = content.slice(2);
    if (itemText === "-" || itemText.startsWith("- ")) {
      throw parseError(file, line.number, `nested lists are not supported: '${content}'`);
    }
    items.push(parseScalar(itemText, file, line.number));
    index += 1;
  }
  return { items, next: index };
}

function parseMapBlock(
  lines: readonly Line[],
  start: number,
  indent: number,
  file: string,
  depth: number,
): MapParseResult {
  const map: Record<string, FrontmatterValue> = {};
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined) break;
    const lineIndent = leadingSpaces(line, file);
    if (lineIndent < indent) break;
    if (lineIndent > indent) throw parseError(file, line.number, "unexpected indentation");
    const content = line.text.slice(indent);
    const { key, inlineValue } = splitKeyValue(content, file, line.number);
    if (inlineValue !== null) {
      map[key] = inlineValue === "[]" ? [] : parseScalar(inlineValue, file, line.number);
      index += 1;
      continue;
    }
    const childIndent = indent + 2;
    const child = lines[index + 1];
    if (child === undefined || leadingSpaces(child, file) !== childIndent) {
      throw parseError(file, line.number, `'${key}' has no value and no indented block follows`);
    }
    const firstChildContent = child.text.slice(childIndent);
    if (firstChildContent.startsWith("- ") || firstChildContent === "-") {
      const list = parseListBlock(lines, index + 1, childIndent, file);
      map[key] = list.items;
      index = list.next;
      continue;
    }
    if (depth >= 1) {
      throw parseError(
        file,
        line.number,
        `'${key}' starts a second level of nested map; only one level is supported`,
      );
    }
    const nested = parseMapBlock(lines, index + 1, childIndent, file, depth + 1);
    map[key] = nested.map;
    index = nested.next;
  }
  return { map, next: index };
}

/**
 * Parses `text` (a full item file: frontmatter plus body) into its header
 * and body. Throws an `Error` naming `file` and the offending line on any
 * grammar violation.
 */
export function parseDocument(text: string, file: string): ParsedDocument {
  const lines = toLines(text);
  const opening = lines[0];
  if (opening === undefined || opening.text !== "---") {
    throw parseError(file, 1, "missing opening '---' frontmatter delimiter");
  }
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.text === "---");
  if (closingIndex === -1) {
    throw parseError(file, lines.length, "missing closing '---' frontmatter delimiter");
  }
  const frontmatterLines = lines.slice(1, closingIndex);
  const { map } = parseMapBlock(frontmatterLines, 0, 0, file, 0);
  const body = lines
    .slice(closingIndex + 1)
    .map((line) => line.text)
    .join("\n");
  return { header: map, body };
}

function needsQuoting(value: string): boolean {
  if (value.length === 0) return true;
  if (value === "[]") return true;
  if (/^\s/u.test(value) || /\s$/u.test(value)) return true;
  if (value.includes("\n")) return true;
  if (value.startsWith('"') || value.startsWith("'") || value.startsWith("-") || value.startsWith("#")) {
    return true;
  }
  if (value.includes(": ") || value.endsWith(":")) return true;
  return false;
}

function escapeQuoted(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function serializeScalar(value: string): string {
  return needsQuoting(value) ? `"${escapeQuoted(value)}"` : value;
}

/** Type guard, not a bare `typeof`, so the narrowing satisfies `anti-slop/no-runtime-typeof`. */
function isScalar(value: FrontmatterValue): value is FrontmatterScalar {
  return typeof value === "string";
}

function appendEntry(lines: string[], key: string, value: FrontmatterValue, indent: number): void {
  const pad = " ".repeat(indent);
  if (isScalar(value)) {
    lines.push(`${pad}${key}: ${serializeScalar(value)}`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${pad}${key}: []`);
      return;
    }
    lines.push(`${pad}${key}:`);
    for (const item of value) lines.push(`${pad}  - ${serializeScalar(item)}`);
    return;
  }
  lines.push(`${pad}${key}:`);
  for (const [subkey, subvalue] of Object.entries(value)) {
    appendEntry(lines, subkey, subvalue, indent + 2);
  }
}

/**
 * The inverse of `parseDocument`: renders `header` and `body` back into one
 * item file, `---`-fenced frontmatter first, `body` appended verbatim.
 */
export function serializeDocument(header: FrontmatterHeader, body: string): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(header)) {
    appendEntry(lines, key, value, 0);
  }
  lines.push("---");
  return `${lines.join("\n")}\n${body}`;
}
