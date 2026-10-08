/**
 * The merge of two concurrent versions of a spec file whose only difference
 * is checklist progress (0.75.0).
 *
 * Two hosts that tick different items of one spec before they sync make a
 * concurrent edit (src/core/tree.ts). Last-writer-wins would undo one host's
 * ticks. This merge keeps both, and it is conservative: any other difference
 * returns null, and the tree keeps last-writer-wins and records the conflict.
 *
 * A spec is `M<n>-<slug>/<NN>-<name>.md`, not the `00-` README.
 *
 * Mergeable means: after the frontmatter, the two bodies are the same line
 * for line once every checkbox marker (`- [?] `, the legacy `mark` pattern) is
 * blanked; and in the frontmatter only these keys differ:
 *
 *   updated                the later date
 *   verification_passed    the later time; `verification_method` goes with it
 *   verified               recomputed from the merged items (`<x>/<total>`)
 *   status                 recomputed from the merged items when each side's
 *                          status is the one its own items derive; kept when
 *                          both sides hold the same status set by hand; any
 *                          other status difference is no tick
 *
 * Each item takes the further state. `[ ]` < `[~]` < `[x]` (`[X]` counts as
 * `[x]`). `[!]` (blocked) and `[-]` (skipped) record a decision, not
 * progress: such a marker wins over `[ ]` only. Against `[~]` or `[x]` the
 * progress wins. When both sides hold a decision that differs (`[!]` against
 * `[-]`), the winner's stays.
 *
 * The result is a pure function of the two inputs.
 */

/** The legacy `mark` pattern for a checkbox line. */
const BOX_RE = /^(\s*- \[)([^\]]+)(\] .*)$/u;
/** The legacy checklist parser's item pattern (what counts as an item). */
const ITEM_RE = /^(\s*)- \[([ xX~!-])\] (.*)$/u;
const KEY_RE = /^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/u;
const SPEC_PATH_RE = /^M\d+[^/]*\/\d+-[^/]+\.md$/u;

/** Frontmatter keys a tick may change. Every other key must match byte for byte. */
const TICK_KEYS: ReadonlySet<string> = new Set(["updated", "verified", "status", "verification_passed", "verification_method"]);

/** True for a spec file of the tree: `M<n>-<slug>/<NN>-<name>.md`, not the `00-` README. */
export function isSpecPath(path: string): boolean {
  return SPEC_PATH_RE.test(path) && !/\/00-[^/]*$/u.test(path);
}

interface Field {
  key: string;
  /** The key line and its continuation lines. */
  lines: string[];
}

interface Spec {
  /** null when the file has no frontmatter. */
  fields: Field[] | null;
  body: string[];
}

function parseSpec(text: string): Spec | null {
  const lines = text.split("\n");
  if (lines[0] !== "---") return { fields: null, body: lines };
  const end = lines.indexOf("---", 1);
  if (end < 0) return null;
  const fields: Field[] = [];
  for (const line of lines.slice(1, end)) {
    const key = KEY_RE.exec(line);
    const last = fields.at(-1);
    if (key !== null) fields.push({ key: key[1] ?? "", lines: [line] });
    else if (last !== undefined) last.lines.push(line);
    else return null;
  }
  return { fields, body: lines.slice(end + 1) };
}

function scalar(field: Field | undefined): string | null {
  if (field === undefined) return null;
  const value = (field.lines[0] ?? "").slice(field.key.length + 1).trim();
  return value.replace(/^'(.*)'$/u, "$1").replace(/^"(.*)"$/u, "$1");
}

type Box = " " | "~" | "x" | "!" | "-";

function boxOf(marker: string): Box | null {
  if (marker === "x" || marker === "X") return "x";
  if (marker === " " || marker === "~" || marker === "!" || marker === "-") return marker;
  return null;
}

const PROGRESS = new Map<Box, number>([
  [" ", 0],
  ["~", 1],
  ["x", 2],
]);

/** The merged marker of one item: the further state (see the file header). */
function furtherBox(winner: string, other: string): string {
  if (winner === other) return winner;
  const a = boxOf(winner);
  const b = boxOf(other);
  if (a === null || b === null) return winner;
  const pa = PROGRESS.get(a);
  const pb = PROGRESS.get(b);
  if (pa !== undefined && pb !== undefined) return pb > pa ? other : winner;
  if (pa === undefined && pb === undefined) return winner;
  // One side is a decision ([!] or [-]): it beats [ ] only.
  if (pa === undefined) return pb === 0 ? winner : other;
  return pa === 0 ? other : winner;
}

function blank(line: string): string {
  const match = BOX_RE.exec(line);
  return match === null ? line : `${match[1] ?? ""}?${match[3] ?? ""}`;
}

/** The legacy `deriveStatus` over the items of `body`. */
function deriveStatus(body: readonly string[]): string {
  const counts = { " ": 0, x: 0, "~": 0, "!": 0, "-": 0 };
  let total = 0;
  for (const line of body) {
    const item = ITEM_RE.exec(line);
    if (item === null) continue;
    total += 1;
    const box = boxOf(item[2] ?? " ") ?? " ";
    counts[box] += 1;
  }
  if (total === 0) return "Not Started";
  if (counts[" "] === 0 && counts["~"] === 0 && counts["!"] === 0) return counts.x === 0 ? "Skipped" : "Complete";
  if (counts["!"] > 0) return "Blocked";
  if (counts.x > 0 || counts["~"] > 0) return "In Progress";
  return "Not Started";
}

function verifiedCount(body: readonly string[]): string {
  let total = 0;
  let done = 0;
  for (const line of body) {
    const item = ITEM_RE.exec(line);
    if (item === null) continue;
    total += 1;
    if (boxOf(item[2] ?? " ") === "x") done += 1;
  }
  return `${String(done)}/${String(total)}`;
}

function laterOf(a: string | null, b: string | null): "a" | "b" {
  if (a === null) return b === null ? "a" : "b";
  if (b === null) return "a";
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return b > a ? "b" : "a";
  return tb > ta ? "b" : "a";
}

/** A field line `key: value`, quoted the way the legacy serializer quotes a colon-bearing or date-like scalar. */
function fieldLine(key: string, value: string, like: Field | undefined): string {
  const original = like === undefined ? "" : (like.lines[0] ?? "").slice(key.length + 1).trim();
  if (original.startsWith("'")) return `${key}: '${value}'`;
  if (original.startsWith('"')) return `${key}: "${value}"`;
  return `${key}: ${value}`;
}

function mergeFields(winner: readonly Field[], other: readonly Field[], body: readonly string[], bodies: { winner: string[]; other: string[] }): Field[] | null {
  const ours = new Map(winner.map((field) => [field.key, field]));
  const theirs = new Map(other.map((field) => [field.key, field]));
  for (const key of new Set([...ours.keys(), ...theirs.keys()])) {
    if (TICK_KEYS.has(key)) continue;
    if (ours.get(key)?.lines.join("\n") !== theirs.get(key)?.lines.join("\n")) return null;
  }
  const values = new Map<string, string>();
  const pick = (key: string, side: "a" | "b"): void => {
    const value = scalar(side === "a" ? ours.get(key) : theirs.get(key));
    if (value !== null) values.set(key, value);
  };
  const updatedA = scalar(ours.get("updated"));
  const updatedB = scalar(theirs.get("updated"));
  pick("updated", updatedB !== null && (updatedA === null || updatedB > updatedA) ? "b" : "a");
  const passed = laterOf(scalar(ours.get("verification_passed")), scalar(theirs.get("verification_passed")));
  pick("verification_passed", passed);
  pick("verification_method", passed);
  if (ours.has("verified") || theirs.has("verified")) values.set("verified", verifiedCount(body));
  const statusA = scalar(ours.get("status"));
  const statusB = scalar(theirs.get("status"));
  if (statusA !== null || statusB !== null) {
    const derived = (statusA === null || statusA === deriveStatus(bodies.winner)) && (statusB === null || statusB === deriveStatus(bodies.other));
    // A status set by hand on both sides stays; set by hand on one side only is no tick.
    if (derived) values.set("status", deriveStatus(body));
    else if (statusA === statusB && statusA !== null) values.set("status", statusA);
    else return null;
  }
  const fields: Field[] = [];
  const write = (key: string, like: Field | undefined): void => {
    const value = values.get(key);
    const keep = like !== undefined && (!TICK_KEYS.has(key) || value === undefined || value === scalar(like));
    if (keep) fields.push(like);
    else if (value !== undefined) fields.push({ key, lines: [fieldLine(key, value, like ?? theirs.get(key))] });
  };
  for (const field of winner) write(field.key, field);
  for (const field of other) if (!ours.has(field.key)) write(field.key, undefined);
  return fields;
}

function render(spec: { fields: Field[] | null; body: string[] }): string {
  if (spec.fields === null) return spec.body.join("\n");
  return ["---", ...spec.fields.flatMap((field) => field.lines), "---", ...spec.body].join("\n");
}

function decode(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * The merge of two versions of a spec file that differ only in checklist
 * progress (see the file header). Returns the winner's own bytes when the
 * other adds nothing, and null for any other difference.
 */
export function mergeSpecTicks(winner: Uint8Array, other: Uint8Array): Uint8Array | null {
  const winnerText = decode(winner);
  const otherText = decode(other);
  if (winnerText === null || otherText === null) return null;
  const ours = parseSpec(winnerText);
  const theirs = parseSpec(otherText);
  if (ours === null || theirs === null) return null;
  if ((ours.fields === null) !== (theirs.fields === null)) return null;
  if (ours.body.length !== theirs.body.length) return null;
  const body: string[] = [];
  for (const [index, line] of ours.body.entries()) {
    const theirLine = theirs.body[index] ?? "";
    if (blank(line) !== blank(theirLine)) return null;
    const a = BOX_RE.exec(line);
    const b = BOX_RE.exec(theirLine);
    if (a === null || b === null) {
      body.push(line);
      continue;
    }
    body.push(`${a[1] ?? ""}${furtherBox(a[2] ?? "", b[2] ?? "")}${a[3] ?? ""}`);
  }
  let fields: Field[] | null = null;
  if (ours.fields !== null && theirs.fields !== null) {
    fields = mergeFields(ours.fields, theirs.fields, body, { winner: ours.body, other: theirs.body });
    if (fields === null) return null;
  }
  const merged = render({ fields, body });
  if (merged === winnerText) return winner;
  return new TextEncoder().encode(merged);
}
