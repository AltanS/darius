/**
 * `darius marker check [<dir>] [--json]`: parse a repo's `.darius.toml` with
 * the same code run-due uses, and say what is wrong before a commit does.
 *
 * Without `<dir>` it takes the nearest marker at or above the working
 * directory. With one it reads the marker in that directory. Exit 0 and
 * `ok: v3, 2 rituals, 1 policies` when the file parses, 1 with the first
 * error as `file:line: message` when it does not, 2 when there is no file.
 * A ritual whose skill file is missing in this checkout is an error too
 * (exit 1): run-due would skip it as `skill-missing`. Warnings never change
 * the exit code: a policy no ritual names, a v3 marker with no rituals, two
 * rituals whose resolved `hold` lists mostly overlap (factor them into a
 * `[policies.<name>]` with `hold_extra`), and a `notes` text over 300
 * characters (procedure belongs in the skill, rules in `hold`).
 *
 * The parser never touches the file system; the skill-file check lives here
 * (and in run-due's preflight).
 *
 * `--resolved <slug>` prints the effective policy of one ritual instead: the
 * policy it names plus its `may_extra` and `hold_extra`, which is what a run
 * uses. `mode: <mode>`, then one `may: <rule>` line per rule and one
 * `hold: <pattern>` line per pattern, each list sorted. Two forms of one
 * policy (inline, or factored into `[policies.*]`) print the same bytes. An
 * unknown slug is a usage error that names the known ones.
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { findMarker, MARKER_FILE, readMarker, resolvedLines, resolvedPolicy, type Marker, type ResolvedView } from "../core/marker.ts";
import { errorMessage } from "../runtime.ts";
import { UsageError, type Command, type ParsedArgs } from "./registry.ts";

const USAGE = "usage: darius marker check [<dir>] [--resolved <slug>] [--json]";

interface CheckReport {
  ok: boolean;
  file?: string;
  version?: number;
  rituals?: number;
  policies?: number;
  errors: string[];
  warnings: string[];
}

/** The errors that need the file system: a ritual whose skill file is not in this checkout. */
function skillErrorsFor(marker: Marker): string[] {
  const errors: string[] = [];
  if (marker.version !== 3) return errors;
  for (const ritual of marker.rituals) {
    const skillFile = join(".claude", "skills", ritual.skill, "SKILL.md");
    if (!existsSync(join(marker.dir, skillFile))) {
      errors.push(`[rituals.${ritual.slug}] skill "${ritual.skill}" has no ${skillFile} in this checkout`);
    }
  }
  return errors;
}

/** A pair shares enough `hold` patterns to warn when the shorter list has this many entries or more. */
const OVERLAP_MIN_PATTERNS = 5;
/** ... and this share of the shorter list is in the other one. */
const OVERLAP_MIN_SHARE = 0.8;
/** A `notes` text longer than this many characters is a warning. */
const NOTES_MAX_LENGTH = 300;

/** One warning per pair of rituals whose resolved `hold` lists overlap. A pair that names the same policy is skipped. */
function overlapWarnings(marker: Marker): string[] {
  const warnings: string[] = [];
  const { rituals } = marker;
  rituals.forEach((first, index) => {
    for (const second of rituals.slice(index + 1)) {
      if (first.policyName !== undefined && first.policyName === second.policyName) continue;
      const left = new Set(first.policy.hold);
      const right = new Set(second.policy.hold);
      const smaller = Math.min(left.size, right.size);
      const shared = [...left].filter((pattern) => right.has(pattern)).length;
      if (smaller < OVERLAP_MIN_PATTERNS || shared < smaller * OVERLAP_MIN_SHARE) continue;
      warnings.push(
        `[rituals.${first.slug}] and [rituals.${second.slug}] share ${String(shared)} of ${String(smaller)} hold patterns: factor into [policies.<name>] with hold_extra`,
      );
    }
  });
  return warnings;
}

/** A warning for each policy `notes` and each ritual's own `notes` over 300 characters. The two are counted apart, not joined. */
function notesWarnings(marker: Marker): string[] {
  const warnings: string[] = [];
  const tell = (section: string, notes: string | undefined): void => {
    if (notes === undefined || notes.length <= NOTES_MAX_LENGTH) return;
    warnings.push(`[${section}] notes is ${String(notes.length)} characters: procedure belongs in the skill, rules in hold`);
  };
  for (const [name, policy] of Object.entries(marker.policies)) tell(`policies.${name}`, policy.notes);
  // A ritual that names a policy carries that policy's notes, which are reported once above. Its own notes are counted alone.
  for (const ritual of marker.rituals) tell(`rituals.${ritual.slug}`, ritual.policyName === undefined ? ritual.policy.notes : ritual.ownNotes);
  return warnings;
}

/** The warnings for a parsed marker. */
function warningsFor(marker: Marker): string[] {
  const warnings: string[] = [];
  if (marker.version !== 3) return warnings;
  if (marker.rituals.length === 0) warnings.push("no [rituals.<slug>] tables: this v3 marker defines no rituals");
  const used = new Set(marker.rituals.map((ritual) => ritual.policyName));
  for (const name of Object.keys(marker.policies)) {
    if (!used.has(name)) warnings.push(`[policies.${name}] is not used by any ritual`);
  }
  return [...warnings, ...overlapWarnings(marker), ...notesWarnings(marker)];
}

interface Target {
  marker: Marker | null;
  where: string;
}

function readTarget(dir: string | undefined): Target {
  if (dir === undefined) {
    const start = process.cwd();
    return { marker: findMarker(start), where: `${start} or above it` };
  }
  const target = resolve(dir);
  return { marker: readMarker(target), where: target };
}

function check(dir: string | undefined): CheckReport {
  const report: CheckReport = { ok: true, errors: [], warnings: [] };
  let found: Target;
  try {
    found = readTarget(dir);
  } catch (cause) {
    return { ok: false, errors: [errorMessage(cause)], warnings: [] };
  }
  const { marker } = found;
  if (marker === null) throw new UsageError(`no ${MARKER_FILE} in ${found.where}`);
  report.file = marker.file;
  report.version = marker.version;
  report.rituals = marker.rituals.length;
  report.policies = Object.keys(marker.policies).length;
  report.errors = skillErrorsFor(marker);
  report.ok = report.errors.length === 0;
  report.warnings = warningsFor(marker);
  return report;
}

function printReport(report: CheckReport): void {
  for (const error of report.errors) console.error(`error: ${error}`);
  for (const warning of report.warnings) console.log(`warning: ${warning}`);
  if (!report.ok) return;
  const counts = report.version === 3 ? `, ${String(report.rituals)} rituals, ${String(report.policies)} policies` : "";
  console.log(`ok: v${String(report.version)}${counts}`);
}

/** What `--resolved <slug> --json` prints. */
interface ResolvedReport extends ResolvedView {
  ok: true;
  file: string;
  slug: string;
  /** The `[policies.*]` name, when the ritual names one. */
  policy?: string;
}

/** `--resolved <slug>`: the effective policy of one ritual, sorted, or the parse error. */
function printResolved(dir: string | undefined, slug: string, isJson: boolean): number {
  let found: Target;
  try {
    found = readTarget(dir);
  } catch (cause) {
    const report: CheckReport = { ok: false, errors: [errorMessage(cause)], warnings: [] };
    if (isJson) console.log(JSON.stringify(report));
    else printReport(report);
    return 1;
  }
  const { marker } = found;
  if (marker === null) throw new UsageError(`no ${MARKER_FILE} in ${found.where}`);
  const ritual = marker.rituals.find((one) => one.slug === slug);
  if (ritual === undefined) {
    const known = marker.rituals.map((one) => one.slug);
    throw new UsageError(`no [rituals.${slug}] in ${marker.file}; known: ${known.length === 0 ? "none" : known.join(", ")}`);
  }
  const view = resolvedPolicy(ritual);
  if (isJson) {
    const json: ResolvedReport = { ok: true, file: marker.file, slug, ...view };
    if (ritual.policyName !== undefined) json.policy = ritual.policyName;
    console.log(JSON.stringify(json));
  } else {
    for (const line of resolvedLines(view)) console.log(line);
  }
  return 0;
}

async function runCheck(args: ParsedArgs): Promise<number> {
  const [, dir, ...extra] = args.positional;
  if (extra.length > 0) throw new UsageError(USAGE);
  const resolved = args.repeated.resolved?.at(-1);
  if (resolved !== undefined) {
    if (resolved === "") throw new UsageError(USAGE);
    return printResolved(dir, resolved, args.json);
  }
  const report = check(dir);
  if (args.json) console.log(JSON.stringify(report));
  else printReport(report);
  return report.ok ? 0 : 1;
}

export const markerCommand: Command = {
  name: "marker",
  summary: "check a repo's .darius.toml: marker check [<dir>] parses it as run-due does, errors on a missing skill file and lists warnings (unused policy, overlapping hold lists, long notes); --resolved <slug> prints a ritual's effective policy",
  audience: "session",
  usage: "marker check [dir] [--resolved <slug>]",
  async run(args: ParsedArgs): Promise<number> {
    if (args.positional[0] === "check") return runCheck(args);
    throw new UsageError(USAGE);
  },
};
