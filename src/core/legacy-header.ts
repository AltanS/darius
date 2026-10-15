/**
 * The header parser shared by the read-only readers of the legacy tracker
 * (`legacy-vigils.ts`, `legacy-milestones.ts`). It reads the `---` block at the
 * top of a file. It never throws: a line it does not understand is skipped.
 */

export interface LegacyHeader {
  /** `key: value` lines, quotes removed. A key with no value holds "". */
  fields: Map<string, string>;
  /** Keys that hold a list: block items (`  - a`) or an inline `[a, b]`. */
  lists: Map<string, string[]>;
  /** An inline list the tracker CLI refuses: a nested `[` or `{`, or no closing `]`. A flat `[a, b]` is read. */
  unsupported: boolean;
  /** False when the text has no header, or the header never closes. */
  closed: boolean;
  /** Everything after the closing `---`; the whole text when `closed` is false. */
  body: string;
}

/** A YAML scalar without its quotes: `"a"` is a, `'it''s'` is it's. */
export function unquote(value: string): string {
  const double = /^"(.*)"$/u.exec(value);
  if (double !== null) return double[1] ?? "";
  const single = /^'(.*)'$/u.exec(value);
  return single === null ? value : (single[1] ?? "").replaceAll("''", "'");
}

/** An inline list read: its items, and whether the tracker CLI accepts it. */
interface InlineList {
  items: string[];
  supported: boolean;
}

/**
 * The items of an inline list, `[a, 'b, c']`; a comma inside quotes stays.
 * `supported` is false for a nested `[` or `{` outside quotes (the tracker CLI refuses it).
 */
function inlineItems(value: string): InlineList {
  const items: string[] = [];
  let supported = true;
  let current = "";
  let quote = "";
  for (const char of value.slice(1, -1)) {
    if (quote !== "") {
      if (char === quote) quote = "";
      current += char;
    } else if ((char === '"' || char === "'") && current.trim() === "") {
      quote = char;
      current += char;
    } else if (char === "[" || char === "{" || char === "]" || char === "}") {
      supported = false;
      current += char;
    } else if (char === ",") {
      items.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  items.push(current);
  return { items: items.map((item) => unquote(item.trim())).filter((item) => item !== ""), supported: supported && quote === "" };
}

/**
 * Split a file into its header and body. Only a file that starts with `---`
 * has a header. A header that never closes keeps the fields read so far, and
 * `closed` is false.
 */
export function parseHeader(text: string): LegacyHeader {
  const none: LegacyHeader = { fields: new Map(), lists: new Map(), unsupported: false, closed: false, body: text };
  if (!text.startsWith("---")) return none;
  const first = text.indexOf("\n");
  if (first === -1 || text.slice(0, first).trim() !== "---") return none;

  const fields = new Map<string, string>();
  const lists = new Map<string, string[]>();
  let listKey: string | null = null;
  let unsupported = false;
  let position = first + 1;
  while (position <= text.length) {
    const next = text.indexOf("\n", position);
    const end = next === -1 ? text.length : next;
    const line = text.slice(position, end);
    const after = next === -1 ? text.length : next + 1;
    if (line.trim() === "---") return { fields, lists, unsupported, closed: true, body: text.slice(after) };
    const item = /^\s+-\s+(.*)$/u.exec(line);
    if (item !== null && listKey !== null) {
      lists.get(listKey)?.push(unquote((item[1] ?? "").trim()));
    } else {
      const match = /^([A-Za-z_][\w-]*):\s*(.*)$/u.exec(line);
      listKey = null;
      if (match !== null) {
        const key = match[1] ?? "";
        const raw = (match[2] ?? "").trim();
        if (raw.startsWith("[") && raw.endsWith("]")) {
          const parsed = inlineItems(raw);
          lists.set(key, parsed.items);
          if (!parsed.supported) unsupported = true;
        } else if (raw.startsWith("[")) {
          unsupported = true;
        } else {
          fields.set(key, unquote(raw));
          if (raw === "") {
            listKey = key;
            lists.set(key, []);
          }
        }
      }
    }
    if (next === -1) break;
    position = after;
  }
  return { fields, lists, unsupported, closed: false, body: text };
}
