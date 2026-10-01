/**
 * The TOML subset darius reads and writes: flat tables, strings, booleans,
 * integers, and one-line arrays of strings. That is what keeps a hand-rolled
 * parser honest, and it is why darius has its own instead of a dependency for
 * a handful of key/value pairs.
 *
 * Three files use it: `config.toml` (src/core/config.ts), `links.toml`
 * (src/core/links.ts) and a repo's `.darius.toml` (src/core/marker.ts).
 *
 * A key is a TOML bare key (`A-Za-z0-9_-`) or a quoted key without escapes,
 * so a project name such as `my.project` can be a key in `links.toml`.
 *
 * A section header may carry one dot, such as `[profiles.opus-skip]`. Each
 * part follows the bare-key rule. The section key in `TomlDocument.sections`
 * is then the full dotted string, `profiles.opus-skip`. More than one dot is
 * an error. There is no quoting inside a section header.
 *
 * A value is a quoted string, a literal string, `true`, `false`, an integer,
 * or an array of strings, such as `args = ["--foo", "bar baz", ""]` or
 * `args = []`. A literal string is single-quoted, with no escapes and no
 * newline, so `hold = ['\bdeploy\b']` keeps the two characters `\b`. An array
 * may span lines until its closing bracket. Comments and blank lines are
 * allowed between its items, and one trailing comma before the closing
 * bracket. An array cannot hold a number, a boolean, or another array; each
 * is an error.
 */

export type TomlScalar = string | boolean | number;

/** A TOML value darius can hold: a scalar, or an array of strings. */
export type TomlValue = TomlScalar | readonly string[];

export interface TomlDocument {
  root: Record<string, TomlValue>;
  sections: Record<string, Record<string, TomlValue>>;
  /** The line each key was set on, `<section>.<key>` or `<key>` at the root. */
  lines: Record<string, number>;
  /** The line each section header was first written on, by full section name. */
  sectionLines: Record<string, number>;
}

const SECTION_HEADER = /^\[(.+)\]$/u;
const KEY_VALUE = /^(?:([A-Za-z0-9_-]+)|"([^"\\]+)")\s*=\s*(.*)$/u;
const BARE_KEY = /^[A-Za-z0-9_-]+$/u;
const INTEGER = /^-?\d+$/u;

function stripComment(value: string): string {
  const hashIndex = value.indexOf("#");
  return (hashIndex === -1 ? value : value.slice(0, hashIndex)).trim();
}

/**
 * Parses a double-quoted string in `raw` starting at `raw[start]` (a `"`).
 * Returns the decoded value and the index just past the closing quote.
 */
function parseQuotedString(raw: string, start: number, file: string, lineNumber: number) {
  let out = "";
  let i = start + 1;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '"') {
      return { value: out, end: i + 1 };
    }
    if (ch === "\\") {
      const next = raw[i + 1];
      if (next === '"') out += '"';
      else if (next === "\\") out += "\\";
      else if (next === "n") out += "\n";
      else if (next === "t") out += "\t";
      else throw new Error(`${file}:${lineNumber}: unsupported escape "\\${next ?? ""}"`);
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  throw new Error(`${file}:${lineNumber}: unterminated string`);
}

function parseTomlString(raw: string, file: string, lineNumber: number): string {
  const { value, end } = parseQuotedString(raw, 0, file, lineNumber);
  const trailing = stripComment(raw.slice(end));
  if (trailing !== "") {
    throw new Error(`${file}:${lineNumber}: trailing content after a quoted string`);
  }
  return value;
}

/**
 * Parses a literal string in `raw` starting at `raw[start]` (a `'`).
 * Returns the value and the index just past the closing quote.
 */
function parseLiteralString(raw: string, start: number, file: string, lineNumber: number) {
  let i = start + 1;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === "'") return { value: raw.slice(start + 1, i), end: i + 1 };
    if (ch === "\n") break;
    i += 1;
  }
  throw new Error(`${file}:${lineNumber}: unterminated literal string`);
}

function parseTomlLiteral(raw: string, file: string, lineNumber: number): string {
  const { value, end } = parseLiteralString(raw, 0, file, lineNumber);
  const trailing = stripComment(raw.slice(end));
  if (trailing !== "") {
    throw new Error(`${file}:${lineNumber}: trailing content after a literal string`);
  }
  return value;
}

function isArraySpace(ch: string | undefined): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

interface ParsedArray {
  values: readonly string[];
  end: number;
}

/**
 * Parses an array of strings; `raw` starts with `[` and may hold newlines
 * (the rest of the file from the key's line). Returns the values and the
 * index just past the closing bracket. Errors name the line of the problem.
 */
function parseTomlArray(raw: string, file: string, firstLine: number): ParsedArray {
  const values: string[] = [];
  let i = 1;
  let expectValue = true;
  const lineAt = (index: number): number => firstLine + raw.slice(0, index).split("\n").length - 1;
  const restOfLine = (index: number): string => raw.slice(index).split("\n")[0] ?? "";

  for (;;) {
    while (isArraySpace(raw[i]) || raw[i] === "#") {
      if (raw[i] === "#") {
        while (i < raw.length && raw[i] !== "\n") i += 1;
      } else {
        i += 1;
      }
    }
    if (i >= raw.length) {
      throw new Error(`${file}:${firstLine}: unterminated array`);
    }
    if (raw[i] === "]") {
      i += 1;
      break;
    }
    const lineNumber = lineAt(i);
    if (!expectValue) {
      throw new Error(`${file}:${lineNumber}: expected "," or "]" in array, found "${restOfLine(i)}"`);
    }
    if (raw[i] === '"') {
      const { value, end } = parseQuotedString(raw, i, file, lineNumber);
      values.push(value);
      i = end;
    } else if (raw[i] === "'") {
      const { value, end } = parseLiteralString(raw, i, file, lineNumber);
      values.push(value);
      i = end;
    } else if (raw[i] === "[") {
      throw new Error(`${file}:${lineNumber}: nested arrays are not supported`);
    } else {
      throw new Error(`${file}:${lineNumber}: array elements must be quoted strings, found "${restOfLine(i)}"`);
    }
    while (raw[i] === " " || raw[i] === "\t") i += 1;
    if (raw[i] === ",") {
      i += 1;
      expectValue = true;
      continue;
    }
    expectValue = false;
  }

  const trailing = stripComment(raw.slice(i).split("\n")[0] ?? "");
  if (trailing !== "") {
    throw new Error(`${file}:${lineAt(i)}: trailing content after an array`);
  }
  return { values, end: i };
}

/** A scalar value. Arrays are parsed by parseToml, which can read past the line. */
function parseTomlValue(raw: string, file: string, lineNumber: number): TomlValue {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"')) return parseTomlString(trimmed, file, lineNumber);
  if (trimmed.startsWith("'")) return parseTomlLiteral(trimmed, file, lineNumber);
  const withoutComment = stripComment(trimmed);
  if (withoutComment === "true") return true;
  if (withoutComment === "false") return false;
  if (INTEGER.test(withoutComment)) return Number.parseInt(withoutComment, 10);
  throw new Error(
    `${file}:${lineNumber}: cannot parse value "${raw}" (supported: a quoted string, true, false, an integer, a literal string, or an array of strings)`,
  );
}

/** Parses `text`; every error names `file:line`. */
export function parseToml(text: string, file: string): TomlDocument {
  const root: Record<string, TomlValue> = {};
  const sections: Record<string, Record<string, TomlValue>> = {};
  const lines: Record<string, number> = {};
  const sectionLines: Record<string, number> = {};
  let current = root;
  let prefix = "";

  const allLines = text.split("\n");
  for (let index = 0; index < allLines.length; index += 1) {
    const rawLine = allLines[index] ?? "";
    const line = rawLine.replace(/\r$/u, "").trim();
    const lineNumber = index + 1;
    if (line === "" || line.startsWith("#")) continue;

    const sectionMatch = SECTION_HEADER.exec(line);
    if (sectionMatch !== null) {
      const inner = sectionMatch[1];
      if (inner === undefined) throw new Error(`${file}:${lineNumber}: malformed section header`);
      const parts = inner.split(".");
      if (parts.length > 2) {
        throw new Error(`${file}:${lineNumber}: a section header allows at most one dot, found "[${inner}]"`);
      }
      if (parts.some((part) => !BARE_KEY.test(part))) {
        throw new Error(`${file}:${lineNumber}: malformed section header "[${inner}]"`);
      }
      const name = parts.join(".");
      const table = sections[name] ?? {};
      sections[name] = table;
      sectionLines[name] ??= lineNumber;
      current = table;
      prefix = `${name}.`;
      continue;
    }

    const keyValue = KEY_VALUE.exec(line);
    const key = keyValue?.[1] ?? keyValue?.[2];
    const rawValue = keyValue?.[3];
    if (key === undefined || rawValue === undefined) {
      throw new Error(`${file}:${lineNumber}: cannot parse line "${line}"`);
    }
    if (rawValue.trim().startsWith("[")) {
      const rest = [rawValue.trim(), ...allLines.slice(index + 1)].join("\n");
      const { values, end } = parseTomlArray(rest, file, lineNumber);
      current[key] = values;
      index += rest.slice(0, end).split("\n").length - 1;
    } else {
      current[key] = parseTomlValue(rawValue, file, lineNumber);
    }
    lines[`${prefix}${key}`] = lineNumber;
  }

  return { root, sections, lines, sectionLines };
}

/** A key as TOML writes it: bare when it can be, quoted otherwise. */
export function tomlKey(key: string): string {
  if (BARE_KEY.test(key)) return key;
  if (key === "" || key.includes('"') || key.includes("\\")) {
    throw new Error(`cannot write "${key}" as a TOML key`);
  }
  return `"${key}"`;
}

/** A string value as TOML writes it, with the escapes parseToml reads back. */
export function tomlString(value: string): string {
  const escaped = value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\t", "\\t");
  return `"${escaped}"`;
}

/** A one-line array of strings as TOML writes it, with the escapes parseToml reads back. */
export function tomlArray(values: readonly string[]): string {
  return `[${values.map((value) => tomlString(value)).join(", ")}]`;
}

/** A section header as TOML writes it. Validates the one-dot, bare-parts rule parseToml enforces. */
export function tomlSectionHeader(name: string): string {
  const parts = name.split(".");
  if (parts.length > 2 || parts.length === 0 || parts.some((part) => !BARE_KEY.test(part))) {
    throw new Error(`cannot write "[${name}]" as a TOML section header`);
  }
  return `[${name}]`;
}

/**
 * A string value as a TOML literal: single quotes, nothing escaped, so a
 * regex keeps its backslashes. Falls back to `tomlString` when the text holds
 * a `'` or a newline, which a literal cannot carry.
 */
export function tomlLiteral(value: string): string {
  if (value.includes("'") || value.includes("\n")) return tomlString(value);
  return `'${value}'`;
}

/**
 * An array of strings, one item per line with a trailing comma, indented by
 * two spaces. `quote` picks the item form; the default is `tomlString`.
 */
export function tomlArrayMultiline(values: readonly string[], quote: (value: string) => string = tomlString): string {
  if (values.length === 0) return "[]";
  return `[\n${values.map((value) => `  ${quote(value)},\n`).join("")}]`;
}
