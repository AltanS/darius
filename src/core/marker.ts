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
 * A file with these tables must say `v = 2`. An older darius refuses a v2
 * file with its "upgrade darius" error, so a host that cannot read the
 * profiles skips the project instead of running it with the wrong one.
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

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { Policy, ProfileFields } from "./model.ts";
import { parseToml, type TomlDocument, type TomlValue } from "./toml.ts";

export const MARKER_FILE = ".darius.toml";
/** The newest `v` this darius reads. 1 and 2 are both read. */
export const MARKER_VERSION = 2;
const PROFILES_VERSION = 2;

export type Mode = Policy["mode"];

export interface Marker {
  /** The directory holding the file: the checkout root. */
  dir: string;
  file: string;
  project: string;
  maxMode?: Mode;
  /** `[profiles.<name>]` tables, by name. Empty for a v1 file. */
  profiles: Record<string, ProfileFields>;
  /** `[defaults] ritual`. */
  defaultRitual?: string;
  /** `[defaults] follow_up`: the profile a follow-up run uses, over the ritual's. */
  defaultFollowUp?: string;
}

const KEYS: ReadonlySet<string> = new Set(["v", "project", "max_mode"]);
const PROFILE_KEYS: ReadonlySet<string> = new Set(["harness", "model", "effort", "permissions", "surface", "max_turns", "args"]);
const DEFAULTS_KEYS: ReadonlySet<string> = new Set(["ritual", "follow_up"]);
const PROFILE_NAME = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
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

/** The `[profiles.*]` and `[defaults]` tables into `marker`. Any other section is an error. */
function decodeSections(document: TomlDocument, file: string, version: TomlValue, marker: Marker): void {
  const { lines } = document;
  for (const [section, table] of Object.entries(document.sections)) {
    const at = { file, lines, prefix: section };
    const firstLine = lines[`${section}.${Object.keys(table)[0] ?? ""}`];
    const isProfile = section.startsWith("profiles.");
    if (!isProfile && section !== "defaults") {
      throw new Error(`${where(file, firstLine)}: [${section}] is not a ${MARKER_FILE} section (known: [profiles.<name>], [defaults])`);
    }
    if (version !== PROFILES_VERSION) {
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
    const name = section.slice("profiles.".length);
    if (!PROFILE_NAME.test(name)) {
      throw new Error(`${where(file, firstLine)}: [${section}]: a profile name is lowercase letters, digits, '-', '_' or '.'`);
    }
    marker.profiles[name] = decodeProfile(table, at);
  }
}

function decodeMarker(text: string, file: string): Marker {
  const document = parseToml(text, file);
  const { root, lines } = document;
  checkKeys(root, KEYS, { file, lines, prefix: "" });
  const version = root.v ?? 1;
  if (version !== 1 && version !== MARKER_VERSION) {
    throw new Error(
      `${where(file, lines.v)}: v = ${String(version)} is not a version this darius reads (it reads 1 to ${String(MARKER_VERSION)}); upgrade darius`,
    );
  }
  const project = root.project;
  if (!isText(project) || project === "") {
    throw new Error(`${where(file, lines.project)}: project = "<name>" is required`);
  }
  const marker: Marker = { dir: dirname(file), file, project, profiles: {} };
  const maxMode = root.max_mode;
  if (maxMode !== undefined) {
    if (!isMode(maxMode)) {
      throw new Error(`${where(file, lines.max_mode)}: max_mode must be "off", "report" or "act"`);
    }
    marker.maxMode = maxMode;
  }
  decodeSections(document, file, version, marker);
  return marker;
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
