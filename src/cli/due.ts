/**
 * `darius due [--project P | --all-projects] [--json]` — ritual status
 * computed from the ledger (src/core/due.ts, T6a), plus the vigils of a
 * project whose marker owns `vigil` (`kinds`, src/core/kinds.ts): the legacy
 * `due` listed them. Sync conflicts and held runs beyond a ritual's own join
 * once T5's sync is wired into this same command (concept.md, "App design").
 *
 * Vigils: a date-due open vigil is "due", an open vigil that waits on an
 * event is "armed" (src/core/vigil-view.ts, the legacy selection). The JSON
 * adds `vigils: { due: [...], armed: [...] }` next to `rituals`, always
 * present, empty for a project that does not own `vigil`. Each row holds the
 * legacy vigil fields (slug, name, due, until, from, agent, opened,
 * resolved, verdict) and `project`; a due row also holds `daysOverdue`.
 * The text prints the legacy sections after the ritual lines.
 *
 * Open tree conflicts (0.75.0, src/core/tree-conflicts.ts): one text line
 * per project that has any, and `treeConflicts: [...]` in the JSON, always
 * present. Each row is a `TreeConflict` and its `project`.
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
 *
 * `--brief` (0.38.0) is for a Claude Code SessionStart hook (`darius skill
 * hook`): at most one plain line for the project in cwd, naming what waits
 * and the next command, or nothing. It reads the local store only (no sync,
 * no network), prints no colour, and always exits 0, so a hook never fails a
 * session start.
 */

import { readLedger } from "../core/ledger.ts";
import type { LedgerLine } from "../core/model.ts";
import { readTreeConflicts, type TreeConflict } from "../core/tree-conflicts.ts";
import { ritualState, type RitualState } from "../core/due.ts";
import { linkedDir } from "../core/links.ts";
import { findMarker, readMarker } from "../core/marker.ts";
import type { Ritual } from "../core/model.ts";
import { resolveProject } from "../core/paths.ts";
import { listProjects, openProject, type Project } from "../core/store.ts";
import { localToday } from "../core/sweep.ts";
import { readVigilViews, selectDueVigils, type DueVigil, type DueVigils, type VigilView } from "../core/vigil-view.ts";
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

/** The legacy `due` text puts an em dash before the vigil name. Kept only so the output stays compatible. */
const LEGACY_DASH = "\u2014";

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

function collectRows(project: Project, ledger: LedgerLine[]): DueRow[] {
  const now = new Date();
  return project.listItems("ritual").flatMap((slug) => {
    const doc = project.readItem<Ritual>("ritual", slug);
    if (doc === null) return [];
    return [toRow(project, doc.header, ritualState(doc, ledger, { now }))];
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

/** True when the marker of project `name` lists `vigil` in `kinds`: the store owns its vigils. Never throws. */
function ownsVigil(name: string): boolean {
  try {
    const dir = linkedDir(name);
    const marker = dir === undefined ? findMarker(process.cwd()) : readMarker(dir);
    return marker !== null && marker.project === name && marker.kinds.includes("vigil");
  } catch {
    return false;
  }
}

/** An open tree conflict of the JSON (src/core/tree-conflicts.ts), with its project. */
type ConflictRow = TreeConflict & { project: string };

function collectConflicts(project: Project, ledger: readonly LedgerLine[]): ConflictRow[] {
  return readTreeConflicts(ledger).open.map((conflict) => Object.assign(conflict, { project: project.name }));
}

/** One line per project with open tree conflicts. */
function printConflicts(conflicts: readonly ConflictRow[]): void {
  const byProject = new Map<string, number>();
  for (const row of conflicts) byProject.set(row.project, (byProject.get(row.project) ?? 0) + 1);
  for (const [project, count] of byProject) {
    console.log(`tree: ${project} has ${String(count)} open conflict(s) in the tracker tree; darius doctor shows how to get the lost version back`);
  }
}

/** A vigil row of the JSON: the legacy fields, and the project. */
type VigilRow = (VigilView | DueVigil) & { project: string };

function vigilRow(project: Project, view: VigilView | DueVigil): VigilRow {
  return { ...view, project: project.name };
}

interface VigilRows {
  due: VigilRow[];
  armed: VigilRow[];
}

/** The vigils of one project that wait on the operator, empty unless the project owns `vigil`. */
function collectVigils(project: Project): VigilRows {
  if (!ownsVigil(project.name)) return { due: [], armed: [] };
  const picked: DueVigils = selectDueVigils(readVigilViews(project), localToday());
  return { due: picked.due.map((view) => vigilRow(project, view)), armed: picked.armed.map((view) => vigilRow(project, view)) };
}

function printRows(rows: readonly DueRow[], vigils: VigilRows, conflicts: readonly ConflictRow[]): void {
  if (rows.length === 0 && vigils.due.length === 0 && vigils.armed.length === 0) {
    console.log("no rituals due");
  } else {
    for (const row of rows) console.log(rowLine(row));
    printVigils(vigils);
  }
  printConflicts(conflicts);
}

/** The legacy `due` sections, with the `project/slug` name this command gives rituals. */
function printVigils(vigils: VigilRows): void {
  if (vigils.due.length > 0) console.log("Vigils due:");
  for (const row of vigils.due) {
    const when = "daysOverdue" in row && row.daysOverdue > 0 ? `overdue ${String(row.daysOverdue)}d` : "due today";
    const from = row.from === null ? "" : `  [from ${row.from}]`;
    console.log(`  ${row.project}/${row.slug}  (${when}, due ${row.due ?? ""})  ${LEGACY_DASH} ${row.name}${from}`);
  }
  if (vigils.armed.length > 0) console.log("Vigils armed (event-gated):");
  for (const row of vigils.armed) {
    const opened = row.opened === null ? "" : `  (opened ${row.opened})`;
    console.log(`  ${row.project}/${row.slug}  ${LEGACY_DASH} waiting on: ${row.until ?? ""}${opened}`);
  }
}

/** The one line `--brief` prints, or null when nothing waits. Pure. */
export function briefLine(rows: readonly { slug: string; isDue: boolean; heldRun: string | null; mode: Ritual["policy"]["mode"] }[]): string | null {
  const due = rows.filter((row) => row.isDue);
  const held = rows.filter((row) => row.heldRun !== null);
  const parts: string[] = [];
  if (due.length > 0) parts.push(`${listed(due.map((row) => row.slug))} due`);
  if (held.length > 0) parts.push(`${listed(held.map((row) => row.slug))} held with questions for the operator`);
  const first = due[0];
  const firstHeld = held[0];
  let next: string;
  if (first !== undefined) {
    next = first.mode === "off" ? `darius run start ${first.slug}` : `darius run now ${first.slug}`;
  } else if (firstHeld !== undefined && firstHeld.heldRun !== null) {
    next = `darius run answer ${firstHeld.heldRun} <n> <text>`;
  } else {
    return null;
  }
  return `darius: ${parts.join("; ")}, run: ${next}`;
}

const BRIEF_NAMES = 3;

function listed(slugs: readonly string[]): string {
  const shown = slugs.slice(0, BRIEF_NAMES).join(", ");
  return slugs.length > BRIEF_NAMES ? `${shown} and ${String(slugs.length - BRIEF_NAMES)} more` : shown;
}

/** `due --brief`: one line or nothing, exit 0 whatever happens. */
function printBrief(args: ParsedArgs): number {
  try {
    const project = openProject(resolveProject(stringFlag(args, "project")));
    const ledger = readLedger(project);
    const now = new Date();
    const rows = project.listItems("ritual").flatMap((slug) => {
      const doc = project.readItem<Ritual>("ritual", slug);
      if (doc === null) return [];
      const state = ritualState(doc, ledger, { now });
      return [{ slug, isDue: state.isDue, heldRun: state.heldRun ?? null, mode: doc.header.policy.mode }];
    });
    const line = briefLine(rows);
    if (line !== null) console.log(line);
  } catch {
    // Outside a project, or a store this darius cannot read: say nothing.
  }
  return 0;
}

export const dueCommand: Command = {
  name: "due",
  flags: ["all-projects", "brief"],
  summary: "rituals and vigils due now, computed from the ledger.",
  audience: "session",
  usage: "due [--all-projects] [--brief]",
  async run(args: ParsedArgs): Promise<number> {
    if (args.flags.brief === true) return printBrief(args);
    if (args.flags["all-projects"] === true) {
      const projects = listProjects();
      const opened = projects.map((name) => {
        const project = openProject(name);
        return { project, ledger: readLedger(project) };
      });
      const rituals = opened.flatMap(({ project, ledger }) => collectRows(project, ledger));
      const found = opened.map(({ project }) => collectVigils(project));
      const vigils = { due: found.flatMap((one) => one.due), armed: found.flatMap((one) => one.armed) };
      const treeConflicts = opened.flatMap(({ project, ledger }) => collectConflicts(project, ledger));
      if (args.json) printJson({ projects, rituals, vigils, treeConflicts });
      else printRows(rituals, vigils, treeConflicts);
      return 0;
    }
    const project = openProject(resolveProject(stringFlag(args, "project")));
    const ledger = readLedger(project);
    const rituals = collectRows(project, ledger);
    const vigils = collectVigils(project);
    const treeConflicts = collectConflicts(project, ledger);
    if (args.json) printJson({ project: project.name, rituals, vigils, treeConflicts });
    else printRows(rituals, vigils, treeConflicts);
    return 0;
  },
};
