/**
 * `darius marker factor`: move the `may` and `hold` rules that several
 * inline rituals share into new `[policies.<name>]` tables. Each ritual
 * keeps only its own rules, in `may_extra` and `hold_extra`. Extras only add,
 * so every ritual resolves to the same policy as before.
 *
 * Grouping. Only rituals with an inline policy take part; a ritual that names
 * a `policy` is never touched. Two rituals of the same mode and the same
 * `on_hold` (0.66.0) are linked when
 * their resolved `hold` lists overlap by the `marker check` rule
 * (`holdOverlap`: the shorter list has at least 5 patterns, and at least 80
 * percent of them are in the other). A group is a connected component of
 * those links, in marker order, with at least 2 rituals. Its policy is the
 * intersection of the members' `may` lists and of their `hold` lists, in the
 * first member's order. A group whose shared `hold` is empty is dropped.
 *
 * Names. A group's policy is `<mode>-base`, then `<mode>-base-2` and so on,
 * skipping a name an existing `[policies.*]` table has. The operator renames
 * it by hand.
 *
 * The edit is on the text, not a rewrite from the parsed model. Comments, key
 * order, blank lines and every table that is not a member stay byte for byte.
 * In a member table the `mode`, `may`, `hold`, `on_hold`, `may_extra` and `hold_extra`
 * keys go; `policy = "<name>"` and the new extras take the place of the first
 * of them. `notes` and comments above a removed key stay. A new policy table
 * goes right before its first member's table, above the comment lines that
 * sit directly on that table's header.
 *
 * A layout the edit cannot handle safely is refused, naming the ritual: a
 * table written in two places, a key set twice, a comment inside or after a
 * removed value, a multi-line string as a removed value.
 *
 * Proof. The proposed text is parsed with the real parser and compared with
 * the current marker: root keys, profiles, defaults, the existing policies,
 * and per ritual every field, the mode, the sorted `may` and `hold`, and the
 * effective notes. Any difference stops the command before it prints or
 * writes anything.
 */

import { byCodeUnit, decodeMarker, holdOverlap, type Marker, type MarkerPolicy, type Mode, type RepoRitual } from "./marker.ts";
import type { ProfileFields } from "./model.ts";
import { parseToml, tomlArrayMultiline, tomlLiteral, tomlString, type TomlEntry } from "./toml.ts";

/** One ritual of a group: the rules it keeps for itself. */
export interface FactorMember {
  slug: string;
  mayExtra: string[];
  holdExtra: string[];
}

/** One proposed `[policies.<name>]` and the rituals that will name it. */
export interface FactorGroup {
  policy: string;
  mode: Mode;
  /** The members' `on_hold` when it is "deny"; they all share it. */
  onHold?: "deny";
  may: string[];
  hold: string[];
  members: FactorMember[];
}

/** The text edit: current text, the parsed marker, the groups; the proposed text. Throws a FactorRefusal on a layout it cannot handle. */
export type FactorRender = (text: string, marker: Marker, groups: readonly FactorGroup[]) => string;

/** A layout the text edit refuses. */
export class FactorRefusal extends Error {
  override name = "FactorRefusal";
}

export type FactorPlan = { ok: true; groups: FactorGroup[]; proposed: string } | { ok: false; error: string };

/** The keys a member table loses: a ritual that names a policy may not set the first three, and the extras are written anew. */
const MOVED_KEYS: ReadonlySet<string> = new Set(["mode", "may", "hold", "on_hold", "may_extra", "hold_extra"]);

function nextName(mode: Mode, taken: Set<string>): string {
  let name = `${mode}-base`;
  for (let n = 2; taken.has(name); n += 1) name = `${mode}-base-${String(n)}`;
  taken.add(name);
  return name;
}

/** Connected components over the overlap rule, among inline rituals of one mode, in marker order. */
function components(inline: readonly RepoRitual[]): RepoRitual[][] {
  const parent = inline.map((_, index) => index);
  const root = (index: number): number => {
    let at = index;
    while (parent[at] !== at) at = parent[at] ?? at;
    return at;
  };
  inline.forEach((first, i) => {
    inline.slice(i + 1).forEach((second, offset) => {
      if (first.policy.mode !== second.policy.mode || first.policy.on_hold !== second.policy.on_hold) return;
      if (holdOverlap(first.policy.hold, second.policy.hold) === undefined) return;
      const [a, b] = [root(i), root(i + 1 + offset)];
      // The lower index stays the root, so a component is named by its first ritual.
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    });
  });
  const byRoot = new Map<number, RepoRitual[]>();
  inline.forEach((ritual, index) => {
    const key = root(index);
    byRoot.set(key, [...(byRoot.get(key) ?? []), ritual]);
  });
  return [...byRoot.entries()].toSorted(([a], [b]) => a - b).map(([, members]) => members);
}

/** The groups `marker factor` proposes for `marker`. Empty when nothing qualifies. */
export function findGroups(marker: Marker): FactorGroup[] {
  const inline = marker.rituals.filter((ritual) => ritual.policyName === undefined);
  const taken = new Set(Object.keys(marker.policies));
  const groups: FactorGroup[] = [];
  for (const members of components(inline)) {
    const [first, ...rest] = members;
    if (first === undefined || rest.length === 0) continue;
    const hold = first.policy.hold.filter((pattern) => rest.every((other) => other.policy.hold.includes(pattern)));
    if (hold.length === 0) continue;
    const may = first.policy.may.filter((rule) => rest.every((other) => other.policy.may.includes(rule)));
    const { mode, on_hold: onHold } = first.policy;
    const group: FactorGroup = {
      policy: nextName(mode, taken),
      mode,
      may,
      hold,
      members: members.map((ritual) => ({
        slug: ritual.slug,
        mayExtra: ritual.policy.may.filter((rule) => !may.includes(rule)),
        holdExtra: ritual.policy.hold.filter((pattern) => !hold.includes(pattern)),
      })),
    };
    if (onHold !== undefined) group.onHold = onHold;
    groups.push(group);
  }
  return groups;
}

/** `key = [...]`: one line for one item, one item per line for more, nothing for none. */
function listLines(key: string, items: readonly string[], quote: (value: string) => string): string[] {
  if (items.length === 0) return [];
  if (items.length === 1) return [`${key} = [${quote(items[0] ?? "")}]`];
  return `${key} = ${tomlArrayMultiline(items, quote)}`.split("\n");
}

/** True when `text` holds a `#` outside a quoted or literal string. */
function hasComment(text: string): boolean {
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "#") return true;
    if (ch === '"') {
      i += 1;
      while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    } else if (ch === "'") {
      i += 1;
      while (i < text.length && text[i] !== "'") i += 1;
    }
    i += 1;
  }
  return false;
}

interface Edits {
  /** Lines to put before a line (1-based). */
  before: Map<number, string[]>;
  /** Lines that go. */
  removed: Set<number>;
}

/** A member ritual table: its one header and its keys. */
interface MemberTable {
  header: TomlEntry;
  keys: TomlEntry[];
}

/** The entries of `[rituals.<slug>]`, after its one header. Refuses a table written in two places or a key set twice. */
function memberEntries(layout: readonly TomlEntry[], slug: string): MemberTable {
  const section = `rituals.${slug}`;
  const headers = layout.flatMap((entry, index) => (entry.kind === "header" && entry.section === section ? [index] : []));
  const [at] = headers;
  if (at === undefined || headers.length !== 1) {
    throw new FactorRefusal(`[${section}] is written in more than one place; join it into one table first`);
  }
  const keys: TomlEntry[] = [];
  for (const entry of layout.slice(at + 1)) {
    if (entry.kind === "header") break;
    if (keys.some((seen) => seen.key === entry.key)) throw new FactorRefusal(`[${section}] sets ${entry.key ?? ""} twice; remove one first`);
    keys.push(entry);
  }
  const header = layout[at];
  if (header === undefined) throw new FactorRefusal(`[${section}] has no header`);
  return { header, keys };
}

function spanText(lines: readonly string[], entry: TomlEntry): string {
  return lines.slice(entry.start - 1, entry.end).join("\n");
}

/** The member's moved keys go; `policy` and the extras take the place of the first one. */
function editMember(lines: readonly string[], layout: readonly TomlEntry[], member: FactorMember, policy: string, edits: Edits): TomlEntry {
  const { header, keys } = memberEntries(layout, member.slug);
  const moved = keys.filter((entry) => MOVED_KEYS.has(entry.key ?? ""));
  const [first] = moved;
  if (first === undefined) throw new FactorRefusal(`[rituals.${member.slug}] has no mode, may or hold to move`);
  for (const entry of moved) {
    const text = spanText(lines, entry);
    const value = text.slice(text.indexOf("=") + 1).trimStart();
    if (value.startsWith('"""') || value.startsWith("'''")) {
      throw new FactorRefusal(`[rituals.${member.slug}] ${entry.key ?? ""} is a multi-line string; write it on one line first`);
    }
    if (hasComment(text)) {
      throw new FactorRefusal(`[rituals.${member.slug}] ${entry.key ?? ""} holds a comment in its value; move the comment above the key first`);
    }
    for (let line = entry.start; line <= entry.end; line += 1) edits.removed.add(line);
  }
  const indent = /^\s*/u.exec(lines[first.start - 1] ?? "")?.[0] ?? "";
  const added = [
    `policy = ${tomlString(policy)}`,
    ...listLines("may_extra", member.mayExtra, tomlString),
    ...listLines("hold_extra", member.holdExtra, tomlLiteral),
  ];
  edits.before.set(first.start, added.map((line) => `${indent}${line}`));
  return header;
}

/** The line a new policy table goes before: the header, or the first of the comment lines right above it. */
function insertionLine(lines: readonly string[], header: TomlEntry, covered: ReadonlySet<number>): number {
  let line = header.start;
  while (line > 1 && !covered.has(line - 1) && (lines[line - 2] ?? "").trim().startsWith("#")) line -= 1;
  return line;
}

/** The text of a new `[policies.<name>]` table. */
function policyTable(group: FactorGroup): string[] {
  return [
    `[policies.${group.policy}]`,
    `mode = ${tomlString(group.mode)}`,
    ...(group.onHold === undefined ? [] : [`on_hold = ${tomlString(group.onHold)}`]),
    ...listLines("may", group.may, tomlString),
    ...listLines("hold", group.hold, tomlLiteral),
  ];
}

/** The default text edit. See the file comment for what it touches and what it refuses. */
export const renderFactored: FactorRender = (text, marker, groups) => {
  const { layout } = parseToml(text, marker.file);
  const lines = text.split("\n");
  const cr = text.includes("\r\n") ? "\r" : "";
  const covered = new Set(layout.flatMap((entry) => Array.from({ length: entry.end - entry.start }, (_, offset) => entry.start + offset + 1)));
  const edits: Edits = { before: new Map(), removed: new Set() };
  for (const group of groups) {
    const headers = group.members.map((member) => editMember(lines, layout, member, group.policy, edits));
    const firstHeader = headers.toSorted((a, b) => a.start - b.start)[0];
    if (firstHeader === undefined) continue;
    const at = insertionLine(lines, firstHeader, covered);
    const previous = (lines[at - 2] ?? "").trim();
    const table = [...(at > 1 && previous !== "" ? [""] : []), ...policyTable(group), ""];
    edits.before.set(at, [...table, ...(edits.before.get(at) ?? [])]);
  }
  const out: string[] = [];
  lines.forEach((line, index) => {
    const number = index + 1;
    for (const added of edits.before.get(number) ?? []) out.push(`${added}${cr}`);
    if (!edits.removed.has(number)) out.push(line);
  });
  return out.join("\n");
};

/** A value the proof compares, as the parser gives it. */
type Field = string | number | readonly string[] | undefined;

function fieldText(value: Field): string {
  return value === undefined ? "unset" : JSON.stringify(value);
}

/**
 * Every field of a ritual that a run reads, as text by name: the fields as
 * parsed, then the effective mode, the sorted `may` and `hold` and the
 * effective notes. The display-only fields (the policy name, the extras as
 * written, the own notes and the line) are left out.
 */
function ritualFields(ritual: RepoRitual): Map<string, string> {
  const { line: _line, policyName: _policyName, policyExtra: _policyExtra, ownNotes: _ownNotes, policy, ...rest } = ritual;
  void _line;
  void _policyName;
  void _policyExtra;
  void _ownNotes;
  const fields = new Map(Object.entries(rest).map(([key, value]): [string, string] => [key, fieldText(value)]));
  fields.set("mode", fieldText(policy.mode));
  fields.set("resolved may", fieldText(policy.may.toSorted(byCodeUnit)));
  fields.set("resolved hold", fieldText(policy.hold.toSorted(byCodeUnit)));
  fields.set("notes", fieldText(policy.notes));
  fields.set("on_hold", fieldText(policy.on_hold ?? "stop"));
  return fields;
}

/** The first field in which two forms of one ritual differ, or undefined. */
function ritualDifference(before: RepoRitual, after: RepoRitual): string | undefined {
  const [was, now] = [ritualFields(before), ritualFields(after)];
  for (const key of new Set([...was.keys(), ...now.keys()])) {
    const [old, proposed] = [was.get(key) ?? "unset", now.get(key) ?? "unset"];
    if (old !== proposed) return `[rituals.${before.slug}] ${key}: was ${old}, proposed ${proposed}`;
  }
  return undefined;
}

function policyText(policy: MarkerPolicy | undefined): string {
  return policy === undefined ? "unset" : JSON.stringify([policy.mode, policy.may, policy.hold, policy.notes ?? null, policy.on_hold ?? "stop"]);
}

function profilesText(profiles: Readonly<Record<string, ProfileFields>>): string {
  const sorted = Object.entries(profiles)
    .toSorted(([a], [b]) => byCodeUnit(a, b))
    .map(([name, fields]) => [name, Object.entries(fields).toSorted(([a], [b]) => byCodeUnit(a, b))]);
  return JSON.stringify(sorted);
}

function ritualSlugs(marker: Marker): string {
  return marker.rituals.map((ritual) => ritual.slug).join(", ");
}

/**
 * The first difference between the current marker and the proposed one, or
 * undefined when they are the same where it counts. New policies may appear;
 * nothing else may change, and each member must name its group's policy.
 */
export function proofDifference(before: Marker, after: Marker, groups: readonly FactorGroup[]): string | undefined {
  const root: [string, string, string][] = [
    ["v", fieldText(before.version), fieldText(after.version)],
    ["project", fieldText(before.project), fieldText(after.project)],
    ["max_mode", fieldText(before.maxMode), fieldText(after.maxMode)],
    ["tz", fieldText(before.tz), fieldText(after.tz)],
    ["profiles", profilesText(before.profiles), profilesText(after.profiles)],
    ["[defaults] ritual", fieldText(before.defaultRitual), fieldText(after.defaultRitual)],
    ["[defaults] follow_up", fieldText(before.defaultFollowUp), fieldText(after.defaultFollowUp)],
  ];
  for (const [field, was, now] of root) {
    if (was !== now) return `${field}: was ${was}, proposed ${now}`;
  }
  for (const [name, policy] of Object.entries(before.policies)) {
    if (policyText(policy) !== policyText(after.policies[name])) return `[policies.${name}] changed`;
  }
  if (ritualSlugs(before) !== ritualSlugs(after)) return `rituals: were ${ritualSlugs(before)}, proposed ${ritualSlugs(after)}`;
  const named = new Map(groups.flatMap((group) => group.members.map((member): [string, string] => [member.slug, group.policy])));
  for (const [index, was] of before.rituals.entries()) {
    const now = after.rituals[index];
    if (now === undefined) return `[rituals.${was.slug}] is missing`;
    const difference = ritualDifference(was, now);
    if (difference !== undefined) return difference;
    const policy = named.get(was.slug) ?? was.policyName;
    if (now.policyName !== policy) return `[rituals.${was.slug}] policy: expected ${policy ?? "none"}, proposed ${now.policyName ?? "none"}`;
  }
  return undefined;
}

/**
 * The factor proposal for the marker `text` read from `file`: the groups and
 * the proposed text, proven against the parser. `render` is the text edit; a
 * test passes a broken one to see the proof fail.
 */
export function planFactor(text: string, file: string, render: FactorRender = renderFactored): FactorPlan {
  const before = decodeMarker(text, file);
  const groups = findGroups(before);
  if (groups.length === 0) return { ok: true, groups, proposed: text };
  let proposed: string;
  try {
    proposed = render(text, before, groups);
  } catch (cause) {
    if (cause instanceof FactorRefusal) return { ok: false, error: `cannot factor: ${cause.message}` };
    throw cause;
  }
  let after: Marker;
  try {
    after = decodeMarker(proposed, file);
  } catch (cause) {
    return { ok: false, error: `proof failed: the proposed marker does not parse: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  const difference = proofDifference(before, after, groups);
  if (difference !== undefined) return { ok: false, error: `proof failed: ${difference}` };
  return { ok: true, groups, proposed };
}
