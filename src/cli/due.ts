/**
 * `darius due [--project P | --all-projects] [--json]` — ritual status
 * computed from the ledger (src/core/due.ts, T6a). Tonight's `due` only
 * covers rituals: vigils, sync conflicts and held runs beyond a ritual's own
 * join once T9's vigil surface and T5's sync are wired into this same
 * command (concept.md, "App design"); T6b depends only on T6a, T3 and T13.
 *
 * `--json` shape: `{ project, rituals: [...] }` for one project, or
 * `{ projects: [...], rituals: [...] }` for `--all-projects` (every row then
 * also carries its own `project`, since the array is flattened across all of
 * them). Every row carries `RitualState`'s own field names AND the legacy
 * tracker field names the future compatibility router needs
 * (docs/plan-tonight.md, T6b, "old-tracker-compatible field names"): `name`
 * (title), `due` (nextDue), `daysOverdue` (overdueDays), `cadence`, `lastRun`
 * (lastCompleted). An absent optional fact is `null`, never a missing key, so
 * a consumer can read every field without an `in` check first.
 */

import { readLedger } from "../core/ledger.ts";
import { ritualState, type RitualState } from "../core/due.ts";
import type { Ritual } from "../core/model.ts";
import { resolveProject } from "../core/paths.ts";
import { localToday } from "../core/sweep.ts";
import { listProjects, openProject, type Project } from "../core/store.ts";
import { UsageError, type Command, type ParsedArgs } from "./registry.ts";

function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  if (value === undefined || value === false) return undefined;
  if (value === true) throw new UsageError(`--${name} needs a value`);
  return value;
}

function printJson<T>(value: T): void {
  console.log(JSON.stringify(value));
}

interface DueRow {
  project: string;
  slug: string;
  title: string;
  name: string;
  lifecycle: RitualState["lifecycle"];
  cadence: string | null;
  isDue: boolean;
  nextDue: string | null;
  due: string | null;
  overdueDays: number;
  daysOverdue: number;
  lastCompleted: string | null;
  lastRun: string | null;
  heldRun: string | null;
  openRun: string | null;
}

function toRow(project: Project, header: Ritual, state: RitualState): DueRow {
  return {
    project: project.name,
    slug: state.slug,
    title: header.title,
    name: header.title,
    lifecycle: state.lifecycle,
    cadence: header.cadence ?? null,
    isDue: state.isDue,
    nextDue: state.nextDue ?? null,
    due: state.nextDue ?? null,
    overdueDays: state.overdueDays,
    daysOverdue: state.overdueDays,
    lastCompleted: state.lastCompleted ?? null,
    lastRun: state.lastCompleted ?? null,
    heldRun: state.heldRun ?? null,
    openRun: state.openRun ?? null,
  };
}

function collectRows(project: Project): DueRow[] {
  const ledger = readLedger(project);
  const today = localToday();
  return project.listItems("ritual").flatMap((slug) => {
    const doc = project.readItem<Ritual>("ritual", slug);
    if (doc === null) return [];
    return [toRow(project, doc.header, ritualState(doc, ledger, today))];
  });
}

function rowLine(row: DueRow): string {
  const flags = [
    row.isDue ? "DUE" : null,
    row.heldRun !== null ? "HELD" : null,
    row.lifecycle === "active" ? null : row.lifecycle.toUpperCase(),
  ].filter((flag): flag is string => flag !== null);
  const schedule =
    row.nextDue === null
      ? "no schedule"
      : `due ${row.nextDue}${row.overdueDays > 0 ? ` (${String(row.overdueDays)}d overdue)` : ""}`;
  const suffix = flags.length === 0 ? "" : `  [${flags.join(" ")}]`;
  return `${row.project}/${row.slug}  ${row.title}  ${schedule}${suffix}`;
}

function printRows(rows: readonly DueRow[]): void {
  if (rows.length === 0) {
    console.log("no rituals due");
    return;
  }
  for (const row of rows) console.log(rowLine(row));
}

export const dueCommand: Command = {
  name: "due",
  summary: "rituals due now, computed from the ledger. --project P | --all-projects",
  async run(args: ParsedArgs): Promise<number> {
    if (args.flags["all-projects"] === true) {
      const projects = listProjects();
      const rituals = projects.flatMap((name) => collectRows(openProject(name)));
      if (args.json) printJson({ projects, rituals });
      else printRows(rituals);
      return 0;
    }
    const project = openProject(resolveProject(stringFlag(args, "project")));
    const rituals = collectRows(project);
    if (args.json) printJson({ project: project.name, rituals });
    else printRows(rituals);
    return 0;
  },
};
