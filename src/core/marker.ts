/**
 * A repo's `.darius.toml`, the one file darius keeps in git (docs/concept.md,
 * "Git"). It holds identity and limits only; the bucket holds what happened.
 *
 *   v = 1                              format version; absent means 1
 *   project = "acme-web"   the project this checkout belongs to
 *   max_mode = "report"                optional ceiling for a ritual's policy mode
 *
 * Version 2 adds harness profiles (docs/concept.md, "Profiles"), which
 * override the store-wide ones field by field:
 *
 *   [profiles.opus-skip]               harness, model, effort, permissions,
 *   model = "opus"                     surface, max_turns, args
 *   [defaults]
 *   ritual = "opus-skip"               the profile a ritual uses when it names none
 *   follow_up = "opus-skip"            the profile of `darius run follow-up` (0.47.0)
 *
 * Version 3 (docs/concept.md, "Marker v3") keeps rituals and
 * policies in git. It adds a required root `tz` (an IANA
 * zone), `[policies.<name>]` and `[rituals.<slug>]`:
 *
 *   tz = "Europe/Berlin"               the zone of every ritual's `at` and day
 *   [policies.read-only]               mode, may, hold, notes
 *   [rituals.daily-report]             title, cadence, skill, and optionally
 *   at = "07:00"                       anchor, at, tz, from, timeout, profile,
 *   skill = "daily-report"             model, max_turns, and either `policy`
 *   policy = "read-only"               or mode, may, hold, notes
 *
 * A file with profiles or defaults must say `v = 2` or `v = 3`. Rituals,
 * policies and `tz` need `v = 3`. An older darius refuses a newer
 * file with its "upgrade darius" error, so a host that cannot read the
 * tables skips the project instead of running it with the wrong ones.
 *
 * `max_mode` is a review gate, not a trust boundary: anyone with a bucket key
 * can already write the Commands darius runs. It moves the step up to `act`
 * into a reviewed commit. run-due skips a ritual above the ceiling
 * (`policy-capped`), and `ritual add|set --mode` refuses one.
 *
 * Parsing is strict. An unknown key, a section, or a newer `v` is an error
 * that names the file and line, so a typo such as `max-mode` cannot silently
 * lift the ceiling.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { Policy, ProfileFields } from "./model.ts";
import { parseToml, type TomlDocument, type TomlValue } from "./toml.ts";
import { isZone } from "./zone.ts";

export const MARKER_FILE = ".darius.toml";
/** The `v` `darius init` writes. */
export const MARKER_VERSION = 2;
/** The newest `v` this darius reads. 1, 2 and 3 are all read. */
export const MARKER_MAX_VERSION = 3;
const PROFILES_VERSION = 2;
const REPO_VERSION = 3;

export type Mode = Policy["mode"];

/** A `[policies.<name>]` table, or the policy a repo ritual resolves to. */
export interface MarkerPolicy {
  mode: Mode;
  may: string[];
  hold: string[];
  notes?: string;
}

/** One `[rituals.<slug>]` table with its policy inlined and its defaults filled. */
export interface RepoRitual {
  slug: string;
  title: string;
  cadence: string;
  anchor: "due" | "completion";
  at?: string;
  tz?: string;
  from?: string;
  skill: string;
  timeoutMs?: number;
  profile?: string;
  model?: string;
  maxTurns?: number;
  /** The `[policies.*]` name, for display. */
  policyName?: string;
  policy: MarkerPolicy;
  /** The `[rituals.<slug>]` header line, for messages. */
  line: number;
}

export interface Marker {
  /** The directory holding the file: the checkout root. */
  dir: string;
  file: string;
  /** The file's `v`: 1 when absent. */
  version: 1 | 2 | 3;
  project: string;
  maxMode?: Mode;
  /** Root `tz`: required in a v3 file, absent below it. */
  tz?: string;
  /** `[rituals.<slug>]` tables in file order. Empty below v3. */
  rituals: RepoRitual[];
  /** `[policies.<name>]` tables, by name. Empty below v3. */
  policies: Record<string, MarkerPolicy>;
  /** `[profiles.<name>]` tables, by name. Empty for a v1 file. */
  profiles: Record<string, ProfileFields>;
  /** `[defaults] ritual`. */
  defaultRitual?: string;
  /** `[defaults] follow_up`: the profile a follow-up run uses, over the ritual's. */
  defaultFollowUp?: string;
}

const KEYS: ReadonlySet<string> = new Set(["v", "project", "max_mode", "tz"]);
const PROFILE_KEYS: ReadonlySet<string> = new Set(["harness", "model", "effort", "permissions", "surface", "max_turns", "args"]);
const DEFAULTS_KEYS: ReadonlySet<string> = new Set(["ritual", "follow_up"]);
const RITUAL_KEYS: ReadonlySet<string> = new Set([
  "title", "cadence", "anchor", "at", "tz", "from", "skill", "timeout", "profile", "model", "max_turns",
  "policy", "mode", "may", "hold", "notes",
]);
const POLICY_TABLE_KEYS: ReadonlySet<string> = new Set(["mode", "may", "hold", "notes"]);
const PROFILE_NAME = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
/** A repo ritual's slug. No dots: the TOML subset allows one dot in a header, the table separator. */
export const REPO_SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const SKILL_NAME = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const CADENCE_TEXT = /^(\d+)[dwm]$/u;
const AT_TEXT = /^([01]\d|2[0-3]):[0-5]\d$/u;
const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})$/u;
const TIMEOUT_TEXT = /^(\d+)(m|h)$/u;
const MAX_TIMEOUT_MINUTES = 12 * 60;
/** A Claude Code permission rule: a bare tool name, or `Tool(pattern)`. */
export const PERMISSION_RULE_RE = /^[A-Za-z_][A-Za-z0-9_]*(\([^]*\))?$/u;
const MODES: readonly Mode[] = ["off", "report", "act"];
const MAX_SEARCH_DEPTH = 64;

function isText(value: TomlValue | undefined): value is string {
  return typeof value === "string";
}

function isPositiveInteger(value: TomlValue): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isMode(value: TomlValue): value is Mode {
  return typeof value === "string" && MODES.some((mode) => mode === value);
}

function where(file: string, line: number | undefined): string {
  return line === undefined ? file : `${file}:${String(line)}`;
}

type Lines = Readonly<Record<string, number>>;

function checkKeys(table: Readonly<Record<string, TomlValue>>, known: ReadonlySet<string>, at: { file: string; lines: Lines; prefix: string }): void {
  for (const key of Object.keys(table)) {
    if (!known.has(key)) {
      const line = at.lines[at.prefix === "" ? key : `${at.prefix}.${key}`];
      throw new Error(`${where(at.file, line)}: unknown key "${key}" (known: ${[...known].join(", ")})`);
    }
  }
}

/** One `[profiles.<name>]` table as ProfileFields. Shapes only; the harness checks come at resolution. */
function decodeProfile(table: Readonly<Record<string, TomlValue>>, at: { file: string; lines: Lines; prefix: string }): ProfileFields {
  checkKeys(table, PROFILE_KEYS, at);
  const fail = (key: string, expected: string): Error => new Error(`${where(at.file, at.lines[`${at.prefix}.${key}`])}: ${key} must be ${expected}`);
  const fields: ProfileFields = {};
  for (const key of ["harness", "model", "effort"] as const) {
    const value = table[key];
    if (value === undefined) continue;
    if (!isText(value)) throw fail(key, "a string");
    fields[key] = value;
  }
  const { permissions, surface, max_turns: maxTurns, args } = table;
  if (permissions !== undefined) {
    if (permissions !== "gated" && permissions !== "skip") throw fail("permissions", '"gated" or "skip"');
    fields.permissions = permissions;
  }
  if (surface !== undefined) {
    if (surface !== "headless" && surface !== "herdr") throw fail("surface", '"headless" or "herdr"');
    fields.surface = surface;
  }
  if (maxTurns !== undefined) {
    if (!isPositiveInteger(maxTurns)) throw fail("max_turns", "a positive integer");
    fields.max_turns = maxTurns;
  }
  if (args !== undefined) {
    if (!Array.isArray(args)) throw fail("args", 'a list of strings: args = ["--flag"]');
    fields.args = [...args];
  }
  return fields;
}

/** `[defaults] <key>` when set: it must name a profile. */
function profileName(table: Readonly<Record<string, TomlValue>>, key: string, at: { file: string; lines: Lines }): string | undefined {
  const value = table[key];
  if (value === undefined) return undefined;
  if (!isText(value) || !PROFILE_NAME.test(value)) throw new Error(`${where(at.file, at.lines[`defaults.${key}`])}: ${key} must name a profile`);
  return value;
}

type Table = Readonly<Record<string, TomlValue>>;

interface Source {
  file: string;
  lines: Lines;
  sectionLines: Lines;
}

function isTextList(value: TomlValue): value is readonly string[] {
  return Array.isArray(value);
}

function isRealDate(text: string): boolean {
  const match = DATE_TEXT.exec(text);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validRegex(pattern: string): boolean {
  try {
    return new RegExp(pattern, "u") instanceof RegExp;
  } catch {
    return false;
  }
}

/** The `[policies.*]` and `[rituals.*]` shared fields: mode, may, hold, notes. */
interface Rules {
  mode?: Mode;
  may?: string[];
  hold?: string[];
  notes?: string;
}

function decodeRules(table: Table, section: string, source: Source): Rules {
  const fail = (key: string, expected: string): Error =>
    new Error(`${where(source.file, source.lines[`${section}.${key}`])}: ${key} must be ${expected}`);
  const rules: Rules = {};
  const { mode, may, hold, notes } = table;
  if (mode !== undefined) {
    if (!isMode(mode)) throw fail("mode", '"off", "report" or "act"');
    rules.mode = mode;
  }
  if (may !== undefined) {
    if (!isTextList(may)) throw fail("may", 'a list of strings: may = ["Bash(date *)"]');
    const bad = may.find((rule) => !PERMISSION_RULE_RE.test(rule));
    if (bad !== undefined) throw fail("may", `a list of Claude Code permission rules ("Tool" or "Tool(pattern)"), got "${bad}"`);
    rules.may = [...may];
  }
  if (hold !== undefined) {
    if (!isTextList(hold)) throw fail("hold", "a list of regular expressions");
    const bad = hold.find((pattern) => !validRegex(pattern));
    if (bad !== undefined) throw fail("hold", `a list of regular expressions that compile, got "${bad}"`);
    rules.hold = [...hold];
  }
  if (notes !== undefined) {
    if (!isText(notes)) throw fail("notes", "a string");
    rules.notes = notes;
  }
  return rules;
}

/** One `[policies.<name>]` table. `mode` is required here. */
function decodePolicyTable(table: Table, section: string, source: Source): MarkerPolicy {
  checkKeys(table, POLICY_TABLE_KEYS, { file: source.file, lines: source.lines, prefix: section });
  const rules = decodeRules(table, section, source);
  if (rules.mode === undefined) {
    throw new Error(`${where(source.file, source.sectionLines[section])}: [${section}] needs mode = "off", "report" or "act"`);
  }
  const policy: MarkerPolicy = { mode: rules.mode, may: rules.may ?? [], hold: rules.hold ?? [] };
  if (rules.notes !== undefined) policy.notes = rules.notes;
  return policy;
}

/** A string key of a ritual table when set: a non-empty string matching `pattern` when one is given. */
function ritualText(table: Table, key: string, at: { section: string; source: Source }, check?: { pattern: RegExp; expected: string }): string | undefined {
  const value = table[key];
  if (value === undefined) return undefined;
  const line = at.source.lines[`${at.section}.${key}`];
  if (!isText(value) || value === "") {
    throw new Error(`${where(at.source.file, line)}: ${key} must be ${check?.expected ?? "a non-empty string"}`);
  }
  if (check !== undefined && !check.pattern.test(value)) {
    throw new Error(`${where(at.source.file, line)}: ${key} must be ${check.expected}, got "${value}"`);
  }
  return value;
}

function decodeTimeout(table: Table, at: { section: string; source: Source }): number | undefined {
  const text = ritualText(table, "timeout", at, { pattern: TIMEOUT_TEXT, expected: 'like "30m" or "2h"' });
  if (text === undefined) return undefined;
  const match = TIMEOUT_TEXT.exec(text);
  const minutes = Number(match?.[1] ?? "0") * (match?.[2] === "h" ? 60 : 1);
  if (minutes < 1 || minutes > MAX_TIMEOUT_MINUTES) {
    throw new Error(`${where(at.source.file, at.source.lines[`${at.section}.timeout`])}: timeout must be from "1m" to "12h", got "${text}"`);
  }
  return minutes * 60_000;
}

interface ResolvedPolicy {
  policy: MarkerPolicy;
  policyName?: string;
}

/** The policy of a ritual: the named `[policies.*]` table, or its own mode, may, hold and notes. */
function resolveRitualPolicy(
  table: Table,
  at: { section: string; source: Source; policies: Readonly<Record<string, MarkerPolicy>> },
): ResolvedPolicy {
  const { section, source } = at;
  const named = table.policy;
  const own = decodeRules(table, section, source);
  if (named === undefined) {
    const policy: MarkerPolicy = { mode: own.mode ?? "off", may: own.may ?? [], hold: own.hold ?? [] };
    if (own.notes !== undefined) policy.notes = own.notes;
    return { policy };
  }
  const line = source.lines[`${section}.policy`];
  if (!isText(named) || named === "") throw new Error(`${where(source.file, line)}: policy must name a [policies.<name>] table`);
  const clash = ["mode", "may", "hold", "notes"].find((key) => table[key] !== undefined);
  if (clash !== undefined) {
    throw new Error(`${where(source.file, source.lines[`${section}.${clash}`])}: ${clash} cannot be combined with policy = "${named}"; put it in [policies.${named}]`);
  }
  const found = at.policies[named];
  if (found === undefined) throw new Error(`${where(source.file, line)}: policy = "${named}" names no [policies.${named}] table`);
  const policy: MarkerPolicy = { mode: found.mode, may: [...found.may], hold: [...found.hold] };
  if (found.notes !== undefined) policy.notes = found.notes;
  return { policy, policyName: named };
}

/** `mode` against `max_mode`: above the ceiling, or `act` with none, is an error. */
function checkCeiling(ritual: RepoRitual, section: string, source: Source, maxMode: Mode | undefined): void {
  const { mode } = ritual.policy;
  const key = source.lines[`${section}.mode`] === undefined ? "policy" : "mode";
  const line = where(source.file, source.lines[`${section}.${key}`] ?? source.sectionLines[section]);
  if (mode === "act" && maxMode === undefined) {
    throw new Error(`${line}: mode "act" needs max_mode = "act" at the top of ${MARKER_FILE}`);
  }
  if (maxMode !== undefined && MODE_RANK[mode] > MODE_RANK[maxMode]) {
    throw new Error(`${line}: mode "${mode}" is above max_mode "${maxMode}"`);
  }
}

/** One `[rituals.<slug>]` table as a RepoRitual. */
function decodeRitual(
  slug: string,
  table: Table,
  context: { source: Source; policies: Readonly<Record<string, MarkerPolicy>>; maxMode: Mode | undefined },
): RepoRitual {
  const { source } = context;
  const section = `rituals.${slug}`;
  const header = source.sectionLines[section];
  if (!REPO_SLUG.test(slug)) {
    throw new Error(`${where(source.file, header)}: [${section}]: a ritual slug is lowercase letters, digits, '-' or '_', at most 64 characters`);
  }
  checkKeys(table, RITUAL_KEYS, { file: source.file, lines: source.lines, prefix: section });
  const at = { section, source };
  const missing = (key: string): Error => new Error(`${where(source.file, header)}: [${section}] needs ${key}`);
  const title = ritualText(table, "title", at);
  if (title === undefined) throw missing('title = "<text>"');
  const cadence = ritualText(table, "cadence", at, { pattern: CADENCE_TEXT, expected: 'like "1d", "2w" or "1m"' });
  if (cadence === undefined) throw missing('cadence = "1d"');
  if (Number.parseInt(cadence, 10) <= 0) {
    throw new Error(`${where(source.file, source.lines[`${section}.cadence`])}: cadence must be above zero, got "${cadence}"`);
  }
  const skill = ritualText(table, "skill", at, { pattern: SKILL_NAME, expected: "a skill name: lowercase letters, digits, '.', '_' or '-'" });
  if (skill === undefined) throw missing('skill = "<name>"');
  const anchor = ritualText(table, "anchor", at);
  if (anchor !== undefined && anchor !== "due" && anchor !== "completion") {
    throw new Error(`${where(source.file, source.lines[`${section}.anchor`])}: anchor must be "due" or "completion", got "${anchor}"`);
  }
  const hhmm = ritualText(table, "at", at, { pattern: AT_TEXT, expected: 'a time "HH:MM", 00:00 to 23:59' });
  const zone = ritualText(table, "tz", at);
  if (zone !== undefined && !isZone(zone)) {
    throw new Error(`${where(source.file, source.lines[`${section}.tz`])}: tz must be an IANA time zone name, got "${zone}"`);
  }
  const from = ritualText(table, "from", at);
  if (from !== undefined && !isRealDate(from)) {
    throw new Error(`${where(source.file, source.lines[`${section}.from`])}: from must be a date "YYYY-MM-DD", got "${from}"`);
  }
  const timeoutMs = decodeTimeout(table, at);
  const profile = ritualText(table, "profile", at, { pattern: PROFILE_NAME, expected: "a profile name" });
  const model = ritualText(table, "model", at);
  const maxTurns = table.max_turns;
  if (maxTurns !== undefined && !isPositiveInteger(maxTurns)) {
    throw new Error(`${where(source.file, source.lines[`${section}.max_turns`])}: max_turns must be a positive integer`);
  }
  const { policy, policyName } = resolveRitualPolicy(table, { section, source, policies: context.policies });
  const ritual: RepoRitual = { slug, title, cadence, anchor: anchor === "completion" ? "completion" : "due", skill, policy, line: header ?? 0 };
  if (hhmm !== undefined) ritual.at = hhmm;
  if (zone !== undefined) ritual.tz = zone;
  if (from !== undefined) ritual.from = from;
  if (timeoutMs !== undefined) ritual.timeoutMs = timeoutMs;
  if (profile !== undefined) ritual.profile = profile;
  if (model !== undefined) ritual.model = model;
  if (maxTurns !== undefined) ritual.maxTurns = maxTurns;
  if (policyName !== undefined) ritual.policyName = policyName;
  checkCeiling(ritual, section, source, context.maxMode);
  return ritual;
}

/** The profile, defaults, policy and ritual tables into `marker`. Any other section is an error. */
function decodeSections(document: TomlDocument, file: string, marker: Marker): void {
  const { lines, sectionLines } = document;
  const source: Source = { file, lines, sectionLines };
  const rituals: [string, Table][] = [];
  for (const [section, table] of Object.entries(document.sections)) {
    const at = { file, lines, prefix: section };
    const firstLine = lines[`${section}.${Object.keys(table)[0] ?? ""}`] ?? sectionLines[section];
    const isProfile = section.startsWith("profiles.");
    const isPolicy = section.startsWith("policies.");
    const isRitual = section.startsWith("rituals.");
    if (!isProfile && !isPolicy && !isRitual && section !== "defaults") {
      throw new Error(
        `${where(file, firstLine)}: [${section}] is not a ${MARKER_FILE} section (known: [profiles.<name>], [defaults], [rituals.<slug>], [policies.<name>])`,
      );
    }
    if (isPolicy || isRitual) {
      if (marker.version !== REPO_VERSION) {
        throw new Error(`${where(file, firstLine)}: [${section}] needs v = ${String(REPO_VERSION)} at the top of ${MARKER_FILE}`);
      }
      if (isRitual) rituals.push([section.slice("rituals.".length), table]);
      else marker.policies[checkedName(section, "policies.", file, firstLine)] = decodePolicyTable(table, section, source);
      continue;
    }
    if (marker.version < PROFILES_VERSION) {
      throw new Error(`${where(file, firstLine)}: [${section}] needs v = ${String(PROFILES_VERSION)} at the top of ${MARKER_FILE}`);
    }
    if (section === "defaults") {
      checkKeys(table, DEFAULTS_KEYS, at);
      const ritual = profileName(table, "ritual", { file, lines });
      if (ritual !== undefined) marker.defaultRitual = ritual;
      const followUp = profileName(table, "follow_up", { file, lines });
      if (followUp !== undefined) marker.defaultFollowUp = followUp;
      continue;
    }
    marker.profiles[checkedName(section, "profiles.", file, firstLine)] = decodeProfile(table, at);
  }
  for (const [slug, table] of rituals) {
    marker.rituals.push(decodeRitual(slug, table, { source, policies: marker.policies, maxMode: marker.maxMode }));
  }
}

/** The name after `prefix` in `section`, which must follow the profile-name rule. */
function checkedName(section: string, prefix: string, file: string, line: number | undefined): string {
  const name = section.slice(prefix.length);
  if (!PROFILE_NAME.test(name)) {
    const noun = prefix === "profiles." ? "a profile" : "a policy";
    throw new Error(`${where(file, line)}: [${section}]: ${noun} name is lowercase letters, digits, '-', '_' or '.'`);
  }
  return name;
}

function decodeMarker(text: string, file: string): Marker {
  const document = parseToml(text, file);
  const { root, lines } = document;
  checkKeys(root, KEYS, { file, lines, prefix: "" });
  const version = root.v ?? 1;
  if (version !== 1 && version !== 2 && version !== MARKER_MAX_VERSION) {
    throw new Error(
      `${where(file, lines.v)}: v = ${String(version)} is not a version this darius reads (it reads 1 to ${String(MARKER_MAX_VERSION)}); upgrade darius`,
    );
  }
  const project = root.project;
  if (!isText(project) || project === "") {
    throw new Error(`${where(file, lines.project)}: project = "<name>" is required`);
  }
  const marker: Marker = { dir: dirname(file), file, version, project, profiles: {}, rituals: [], policies: {} };
  const maxMode = root.max_mode;
  if (maxMode !== undefined) {
    if (!isMode(maxMode)) {
      throw new Error(`${where(file, lines.max_mode)}: max_mode must be "off", "report" or "act"`);
    }
    marker.maxMode = maxMode;
  }
  decodeRootZone(root.tz, version, { file, lines }, marker);
  decodeSections(document, file, marker);
  return marker;
}

/** Root `tz`: required and valid at v = 3, not allowed below it. */
function decodeRootZone(tz: TomlValue | undefined, version: 1 | 2 | 3, at: { file: string; lines: Lines }, marker: Marker): void {
  if (version !== REPO_VERSION) {
    if (tz !== undefined) throw new Error(`${where(at.file, at.lines.tz)}: tz needs v = ${String(REPO_VERSION)} at the top of ${MARKER_FILE}`);
    return;
  }
  if (tz === undefined) {
    throw new Error(`${where(at.file, at.lines.v)}: v = 3 needs tz = "<IANA zone>" at the top of ${MARKER_FILE}, for example tz = "Europe/Berlin"`);
  }
  if (!isText(tz) || !isZone(tz)) {
    throw new Error(`${where(at.file, at.lines.tz)}: tz must be an IANA time zone name, such as "Europe/Berlin"`);
  }
  marker.tz = tz;
}

/** The marker in `dir` itself, or null. A malformed file throws. */
export function readMarker(dir: string): Marker | null {
  const file = join(resolve(dir), MARKER_FILE);
  if (!existsSync(file)) return null;
  return decodeMarker(readFileSync(file, "utf8"), file);
}

/** The nearest marker at `start` or above it, or null. */
export function findMarker(start: string): Marker | null {
  let dir = resolve(start);
  for (let depth = 0; depth < MAX_SEARCH_DEPTH; depth += 1) {
    const found = readMarker(dir);
    if (found !== null) return found;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

const MODE_RANK = { off: 0, report: 1, act: 2 } as const satisfies Record<Mode, number>;

/** True when `mode` is above the marker's `max_mode`. No marker or no `max_mode`: no ceiling. */
export function isAboveCap(mode: Mode, marker: Marker | null): boolean {
  if (marker?.maxMode === undefined) return false;
  return MODE_RANK[mode] > MODE_RANK[marker.maxMode];
}

function sortedKeys<T extends object>(value: T): T {
  // SAFETY: the same entries in a new order; the shape is unchanged.
  return Object.fromEntries(Object.entries(value).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) as T;
}

/**
 * The sha256 hex of a repo ritual's definition: canonical JSON with the keys
 * sorted at both levels, `line` and `policyName` left out. The same content
 * gives the same hash on every host and commit, whatever the key order or
 * comments in the file.
 */
export function definitionHash(ritual: RepoRitual): string {
  const { line: _line, policyName: _policyName, policy, ...rest } = ritual;
  void _line;
  void _policyName;
  const canonical = sortedKeys({ ...rest, policy: sortedKeys({ ...policy }) });
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
