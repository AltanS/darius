/**
 * The Milestones page, as data: the legacy tracker's milestones of a
 * workspace, grouped (In progress, Not started, Complete, and Closed for
 * the ones the owner skipped, deferred or closed), ordered, and worded. Pure,
 * so the server, the browser and the tests agree.
 *
 * A spec is ticked when all its checks are done and it has some
 * (`done === total && total > 0`), whatever its verified flag says. A target
 * date before today is "past", in the late tone, unless the milestone is
 * complete.
 */

import type { MilestoneRow, ProjectStatus, SpecRow } from "../../../src/web/api.ts";
import { shortDate } from "./format.ts";
import type { Badge, Tone } from "./tone.ts";

export type GroupKey = "progress" | "notstarted" | "complete" | "closed";

/** A date that can be compared: the tracker writes YYYY-MM-DD. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

/** A spec slug such as `m77-01-name`, for the label fallback. */
const SPEC_SLUG = /^m(\d+)-(\d+)-/u;

/** The tick rule: all checks done, and at least one check. */
export function isTicked(done: number, total: number): boolean {
  return total > 0 && done === total;
}

/** "103 of 143 checks done"; "1 of 1 check done"; "No checks yet". */
export function checksText(done: number, total: number): string {
  if (total === 0) return "No checks yet";
  return `${done} of ${total} ${total === 1 ? "check" : "checks"} done`;
}

/** A spec's count without the verb: "4 of 6 checks". */
export function specChecksText(done: number, total: number): string {
  if (total === 0) return "no checks";
  return `${done} of ${total} ${total === 1 ? "check" : "checks"}`;
}

/** A YYYY-MM-DD date as "15 Oct", or "3 Nov 2025" in another year than today's. Anything else stays as written. */
export function dateText(date: string, today: string): string {
  if (!ISO_DATE.test(date)) return date;
  return date.slice(0, 4) === today.slice(0, 4) ? shortDate(date) : `${shortDate(date)} ${date.slice(0, 4)}`;
}

/** A target before today is past; a complete milestone has no late target, and a date in another shape is never past. */
export function targetPast(target: string | null, today: string, complete: boolean): boolean {
  return target !== null && !complete && ISO_DATE.test(target) && target < today;
}

/** The group a status belongs to. */
export function groupOf(status: string): GroupKey {
  if (status === "In Progress") return "progress";
  if (status === "Complete") return "complete";
  if (status === "Not Started") return "notstarted";
  return "closed";
}

const GROUPS: ReadonlyArray<{ key: GroupKey; title: string; tone: Tone }> = [
  { key: "progress", title: "In progress", tone: "gold" },
  { key: "notstarted", title: "Not started", tone: "idle" },
  { key: "complete", title: "Complete", tone: "ok" },
  { key: "closed", title: "Closed", tone: "idle" },
];

/** The word of a spec that is blocked, waiting or skipped; the others have no word. */
export function specWord(status: string): Badge | null {
  if (status === "Blocked") return { tone: "bad", label: "Blocked" };
  if (status === "Waiting") return { tone: "wait", label: "Waiting" };
  if (status === "Skipped") return { tone: "idle", label: "Skipped" };
  return null;
}

/** The word of a milestone that is not open work: skipped, deferred or closed. */
function milestoneWord(status: string): Badge | null {
  return groupOf(status) === "closed" ? { tone: "idle", label: status } : null;
}

export interface SpecView {
  slug: string;
  label: string;
  title: string;
  ticked: boolean;
  checks: string;
  /** The labels of the specs this one waits for: "M316/07". */
  dependsOn: string[];
  word: Badge | null;
}

export interface MilestoneView {
  slug: string;
  id: string;
  title: string;
  done: number;
  total: number;
  checks: string;
  /** Every check is done: the bar is green. */
  ticked: boolean;
  started: string | null;
  /** The target in words, and whether it is past. */
  target: { text: string; past: boolean } | null;
  word: Badge | null;
  specs: SpecView[];
}

export interface MilestoneGroup {
  key: GroupKey;
  title: string;
  tone: Tone;
  rows: MilestoneView[];
}

export interface WorkspaceMilestones {
  name: string;
  groups: MilestoneGroup[];
  archived: number;
  /** Set when darius could not read the workspace. */
  error: string | null;
}

/** `M77` to 77, for ordering; 0 for an id without a number. */
function idNumber(id: string): number {
  const match = /(\d+)/u.exec(id);
  return match === null ? 0 : Number.parseInt(match[1] ?? "0", 10);
}

/** Most recently started first, a milestone with no start date last, then the lower number first. */
export function byStartedThenId(left: MilestoneRow, right: MilestoneRow): number {
  if (left.started !== right.started) {
    if (left.started === null) return 1;
    if (right.started === null) return -1;
    return left.started < right.started ? 1 : -1;
  }
  return idNumber(left.id) - idNumber(right.id);
}

/** What the page calls a spec slug: its label when a spec of the workspace has it, else `M77/01` read from the slug, else the slug. */
function labelOf(slug: string, labels: ReadonlyMap<string, string>): string {
  const known = labels.get(slug);
  if (known !== undefined) return known;
  const match = SPEC_SLUG.exec(slug);
  return match === null ? slug : `M${match[1] ?? ""}/${match[2] ?? ""}`;
}

function specView(spec: SpecRow, labels: ReadonlyMap<string, string>): SpecView {
  return {
    slug: spec.slug,
    label: spec.label,
    title: spec.title,
    ticked: isTicked(spec.done, spec.total),
    checks: specChecksText(spec.done, spec.total),
    dependsOn: spec.dependsOn.map((slug) => labelOf(slug, labels)),
    word: specWord(spec.status),
  };
}

function milestoneView(row: MilestoneRow, today: string, labels: ReadonlyMap<string, string>): MilestoneView {
  const complete = row.status === "Complete";
  return {
    slug: row.slug,
    id: row.id,
    title: row.title,
    done: row.done,
    total: row.total,
    checks: checksText(row.done, row.total),
    ticked: isTicked(row.done, row.total),
    started: row.started === null ? null : dateText(row.started, today),
    target: row.target === null ? null : { text: dateText(row.target, today), past: targetPast(row.target, today, complete) },
    word: milestoneWord(row.status),
    specs: [...row.specs].toSorted((left, right) => left.number - right.number).map((spec) => specView(spec, labels)),
  };
}

/** The milestones in their groups, in order; a group with no milestone is left out. */
export function groupMilestones(rows: readonly MilestoneRow[], today: string): MilestoneGroup[] {
  const labels = new Map(rows.flatMap((row) => row.specs.map((spec): [string, string] => [spec.slug, spec.label])));
  return GROUPS.map((group) => {
    const members = rows.filter((row) => groupOf(row.status) === group.key);
    // Work not begun reads in the order to do it; the rest, newest first.
    const ordered = group.key === "notstarted" ? members.toSorted((left, right) => idNumber(left.id) - idNumber(right.id)) : members.toSorted(byStartedThenId);
    return { key: group.key, title: group.title, tone: group.tone, rows: ordered.map((row) => milestoneView(row, today, labels)) };
  }).filter((group) => group.rows.length > 0);
}

/** One workspace of the page. */
export function workspaceMilestones(project: ProjectStatus, today: string): WorkspaceMilestones {
  return { name: project.name, groups: groupMilestones(project.milestones, today), archived: project.milestonesArchived, error: project.error };
}

/** A workspace has something to show: open milestones or archived ones. */
export function hasMilestones(workspace: WorkspaceMilestones): boolean {
  return workspace.groups.length > 0 || workspace.archived > 0;
}
