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
 * A value is a quoted string, `true`, `false`, an integer, or a one-line
 * array of quoted strings, such as `args = ["--foo", "bar baz", ""]` or
 * `args = []`. An array may end with one trailing comma before its closing
 * bracket. An array cannot span more than one line, and it cannot hold a
 * number, a boolean, or another array; each is an error.
 */

export type TomlScalar = string | boolean | number;

/** A TOML value darius can hold: a scalar, or a one-line array of strings. */
export type TomlValue = TomlScalar | readonly string[];

export interface TomlDocument {
  root: Record<string, TomlValue>;
  sections: Record<string, Record<string, TomlValue>>;
  /** The line each key was set on, `<section>.<key>` or `<key>` at the root. */
  lines: Record<string, number>;
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

function isArraySpace(ch: string | undefined): boolean {
  return ch === " " || ch === "\t";
}

/** Parses a one-line array of quoted strings; `raw` starts with `[`. */
function parseTomlArray(raw: string, file: string, lineNumber: number): readonly string[] {
  const values: string[] = [];
  let i = 1;
  let expectValue = true;

  for (;;) {
    while (isArraySpace(raw[i])) i += 1;
    if (i >= raw.length) {
      throw new Error(`${file}:${lineNumber}: unterminated array (arrays cannot span more than one line)`);
    }
    if (raw[i] === "]") {
      i += 1;
      break;
    }
    if (!expectValue) {
      throw new Error(`${file}:${lineNumber}: expected "," or "]" in array, found "${raw.slice(i)}"`);
    }
    if (raw[i] === '"') {
      const { value, end } = parseQuotedString(raw, i, file, lineNumber);
      values.push(value);
      i = end;
    } else if (raw[i] === "[") {
      throw new Error(`${file}:${lineNumber}: nested arrays are not supported`);
    } else {
      throw new Error(`${file}:${lineNumber}: array elements must be quoted strings, found "${raw.slice(i)}"`);
    }
    while (isArraySpace(raw[i])) i += 1;
    if (raw[i] === ",") {
      i += 1;
      expectValue = true;
      continue;
    }
    expectValue = false;
  }

  const trailing = stripComment(raw.slice(i));
  if (trailing !== "") {
    throw new Error(`${file}:${lineNumber}: trailing content after an array`);
  }
  return values;
}

function parseTomlValue(raw: string, file: string, lineNumber: number): TomlValue {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"')) return parseTomlString(trimmed, file, lineNumber);
  if (trimmed.startsWith("[")) return parseTomlArray(trimmed, file, lineNumber);
  const withoutComment = stripComment(trimmed);
  if (withoutComment === "true") return true;
  if (withoutComment === "false") return false;
  if (INTEGER.test(withoutComment)) return Number.parseInt(withoutComment, 10);
  throw new Error(
    `${file}:${lineNumber}: cannot parse value "${raw}" (supported: a quoted string, true, false, an integer, or a one-line array of strings)`,
  );
}

/** Parses `text`; every error names `file:line`. */
export function parseToml(text: string, file: string): TomlDocument {
  const root: Record<string, TomlValue> = {};
  const sections: Record<string, Record<string, TomlValue>> = {};
  const lines: Record<string, number> = {};
  let current = root;
  let prefix = "";

  for (const [index, rawLine] of text.split("\n").entries()) {
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
    current[key] = parseTomlValue(rawValue, file, lineNumber);
    lines[`${prefix}${key}`] = lineNumber;
  }

  return { root, sections, lines };
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
