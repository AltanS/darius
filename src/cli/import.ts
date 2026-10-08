/**
 * `darius import <path/.tracker> --project <name> [--json] [--dry-run]`
 *
 * Mirrors a legacy tracker's rituals, runs and verification ledger into a
 * darius project, read-only on the source. The mapping and the idempotency
 * rule live in src/core/import.ts. Exported, never self-registered: the
 * coordinator wires it in src/cli/commands.ts.
 *
 * The project defaults to the source repo's `.darius.toml`. When that file
 * names another project than the one given, the import is refused: the
 * rituals would land in the wrong store.
 *
 * Exit codes: 0 imported (or nothing new), 2 usage (no path, no project, the
 * path is not a tracker directory, the source repo's marker names another
 * project), 1 any other failure, for example a ritual slug that already
 * exists in the project and was not imported from this source.
 */

import { dirname, resolve } from "node:path";

import { importTracker } from "../core/import.ts";
import type { ImportCounts, ImportReport } from "../core/import.ts";
import { readMarker } from "../core/marker.ts";
import { resolveProject } from "../core/paths.ts";
import { UsageError } from "./registry.ts";
import type { Command, ParsedArgs } from "./registry.ts";

const USAGE = "usage: darius import <path/.tracker> --project <name> [--json] [--dry-run]";

function isText(value: string | boolean | undefined): value is string {
  return typeof value === "string";
}

function projectFlag(args: ParsedArgs): string | undefined {
  const value = args.flags.project;
  if (value === undefined) return undefined;
  if (!isText(value)) throw new UsageError(`--project needs a name. ${USAGE}`);
  return value;
}

/** The target project: the flag, else DARIUS_PROJECT, else the source repo's marker. Refuses a mismatch. */
function targetProject(args: ParsedArgs, source: string): string {
  const repo = dirname(resolve(source));
  const project = resolveProject(projectFlag(args), repo);
  const marker = readMarker(repo);
  if (marker !== null && marker.project !== project) {
    throw new UsageError(`${marker.file} says project = "${marker.project}", but the import targets "${project}"`);
  }
  if (marker !== null && marker.version >= 3) {
    throw new UsageError(`rituals come from ${marker.file} in a v3 project; import reads a legacy .tracker/ into a v2 project only`);
  }
  return project;
}

function countsLine(label: string, counts: ImportCounts): string {
  return `  ${label.padEnd(12)}${counts.found} found, ${counts.new} new`;
}

function formatReport(report: ImportReport): string[] {
  const verb = report.dryRun ? "would import" : "imported";
  const mark = report.totalNew === 0 ? "·" : "✓";
  const { rituals } = report;
  return [
    `${mark} ${verb} ${report.source} into ${report.project}: ${report.totalNew} new`,
    `  ${"rituals".padEnd(12)}${rituals.found} found, ${rituals.new} new, ${rituals.updated} updated, ${rituals.unchanged} unchanged`,
    countsLine("runs", report.runs),
    countsLine("lifecycle", report.lifecycle),
    countsLine("rescheduled", report.rescheduled),
    countsLine("evidence", report.evidence),
    ...report.problems.map((problem) => `! ${problem}`),
  ];
}

export const importCommand: Command = {
  name: "import",
  help: USAGE,
  flags: ["dry-run"],
  summary: "mirror a legacy .tracker/ (rituals, runs, verification log) into a project, read-only. --project, --dry-run",
  async run(args: ParsedArgs): Promise<number> {
    const [source, ...extra] = args.positional;
    if (source === undefined || extra.length > 0) throw new UsageError(USAGE);
    const report = importTracker({
      source,
      project: targetProject(args, source),
      dryRun: args.flags["dry-run"] === true,
    });
    if (args.json) {
      console.log(JSON.stringify(report));
    } else {
      for (const line of formatReport(report)) console.log(line);
    }
    return 0;
  },
};
