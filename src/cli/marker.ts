/**
 * `darius marker check [<dir>] [--json]`: parse a repo's `.darius.toml` with
 * the same code run-due uses, and say what is wrong before a commit does.
 *
 * Without `<dir>` it takes the nearest marker at or above the working
 * directory. With one it reads the marker in that directory. Exit 0 and
 * `ok: v3, 2 rituals, 1 policies` when the file parses, 1 with the first
 * error as `file:line: message` when it does not, 2 when there is no file.
 * Warnings never change the exit code: a ritual whose skill file is missing
 * in this checkout, a policy no ritual names, a v3 marker with no rituals.
 *
 * The parser never touches the file system; the skill-file check lives here
 * (and in run-due's preflight).
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { findMarker, MARKER_FILE, readMarker, type Marker } from "../core/marker.ts";
import { errorMessage } from "../runtime.ts";
import { UsageError, type Command, type ParsedArgs } from "./registry.ts";

const USAGE = "usage: darius marker check [<dir>] [--json]";

interface CheckReport {
  ok: boolean;
  file?: string;
  version?: number;
  rituals?: number;
  policies?: number;
  errors: string[];
  warnings: string[];
}

/** The warnings for a parsed marker; `dir` is the checkout holding the skill files. */
function warningsFor(marker: Marker): string[] {
  const warnings: string[] = [];
  if (marker.version !== 3) return warnings;
  if (marker.rituals.length === 0) warnings.push("no [rituals.<slug>] tables: this v3 marker defines no rituals");
  for (const ritual of marker.rituals) {
    const skillFile = join(".claude", "skills", ritual.skill, "SKILL.md");
    if (!existsSync(join(marker.dir, skillFile))) {
      warnings.push(`[rituals.${ritual.slug}] skill "${ritual.skill}" has no ${skillFile} in this checkout`);
    }
  }
  const used = new Set(marker.rituals.map((ritual) => ritual.policyName));
  for (const name of Object.keys(marker.policies)) {
    if (!used.has(name)) warnings.push(`[policies.${name}] is not used by any ritual`);
  }
  return warnings;
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

async function runCheck(args: ParsedArgs): Promise<number> {
  const [, dir, ...extra] = args.positional;
  if (extra.length > 0) throw new UsageError(USAGE);
  const report = check(dir);
  if (args.json) console.log(JSON.stringify(report));
  else printReport(report);
  return report.ok ? 0 : 1;
}

export const markerCommand: Command = {
  name: "marker",
  summary: "check a repo's .darius.toml: marker check [<dir>] parses it as run-due does and lists warnings",
  audience: "session",
  usage: "marker check [dir]",
  async run(args: ParsedArgs): Promise<number> {
    if (args.positional[0] === "check") return runCheck(args);
    throw new UsageError(USAGE);
  },
};
