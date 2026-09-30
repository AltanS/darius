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

import type { MilestoneDetail, MilestoneFile, MilestoneRow, MilestoneWorklog, ProjectStatus, SpecRow } from "../../../src/web/api.ts";
import { sectionPath, shortDate } from "./format.ts";
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
  /** What the detail page URL names it by: the id, or `M12-cart` when two open milestones share the id. */
  ref: string;
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

export function specView(spec: SpecRow, labels: ReadonlyMap<string, string>): SpecView {
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

/**
 * The name of a milestone in its detail page URL: its id, or its directory
 * name (`M12-cart`) when another open milestone of the workspace has the same
 * id. src/core/legacy-milestone-detail.ts reads it back the same way.
 */
export function milestoneRef(rows: readonly MilestoneRow[], row: MilestoneRow): string {
  const shared = rows.filter((candidate) => candidate.id === row.id).length > 1;
  return shared ? `${row.id}-${row.slug}` : row.id;
}

/** The detail page of a milestone: `/w/<ws>/milestones/<ref>`. */
export function milestonePath(workspace: string, ref: string): string {
  return `${sectionPath(workspace, "milestones")}/${encodeURIComponent(ref)}`;
}

/** The labels of every spec of the workspace, for "depends on M12/01". */
export function specLabels(rows: readonly MilestoneRow[]): Map<string, string> {
  return new Map(rows.flatMap((row) => row.specs.map((spec): [string, string] => [spec.slug, spec.label])));
}

export function milestoneView(row: MilestoneRow, today: string, labels: ReadonlyMap<string, string>, ref: string = row.id): MilestoneView {
  const complete = row.status === "Complete";
  return {
    slug: row.slug,
    id: row.id,
    ref,
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
  const labels = specLabels(rows);
  return GROUPS.map((group) => {
    const members = rows.filter((row) => groupOf(row.status) === group.key);
    // Work not begun reads in the order to do it; the rest, newest first.
    const ordered = group.key === "notstarted" ? members.toSorted((left, right) => idNumber(left.id) - idNumber(right.id)) : members.toSorted(byStartedThenId);
    return { key: group.key, title: group.title, tone: group.tone, rows: ordered.map((row) => milestoneView(row, today, labels, milestoneRef(rows, row))) };
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

// --- the detail page (0.42.0) ----------------------------------------------------------------

/** The state of a milestone in words, in its group's tone: "In progress", "Deferred". */
export function milestoneStatusWord(status: string): Badge {
  const key = groupOf(status);
  const group = GROUPS.find((candidate) => candidate.key === key);
  return { tone: group?.tone ?? "idle", label: key === "closed" ? status : (group?.title ?? status) };
}

/** A file size: "812 B", "4.2 KB", "1.3 MB" (1 KB is 1024 bytes). */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A spec with this many lines of text or fewer starts open on the detail page; a longer one starts folded. */
export const OPEN_SPEC_LINES = 40;

/** Why a file's text is not on the page. */
export function omittedText(omitted: MilestoneFile["omitted"]): string | null {
  if (omitted === "binary") return "not text, not shown";
  if (omitted === "too-large") return "larger than 256 KB, not shown";
  if (omitted === "unreadable") return "could not be read";
  return null;
}

export interface SpecDetailView {
  view: SpecView;
  file: MilestoneFile;
  verifiedAt: string | null;
  /** Start open: the text is short. */
  open: boolean;
}

/** The counts of the status strip. */
export interface DetailCounts {
  done: number;
  open: number;
  waiting: number;
  blocked: number;
  worklogs: number;
}

export interface MilestoneDetailView {
  project: string;
  dir: string;
  head: MilestoneView;
  status: Badge;
  readme: MilestoneFile | null;
  specs: SpecDetailView[];
  counts: DetailCounts;
  worklogs: MilestoneWorklog[];
  others: MilestoneFile[];
}

/** The detail page as data. `rows` are the workspace's milestones, for the labels of specs in other milestones. */
export function milestoneDetailView(detail: MilestoneDetail, rows: readonly MilestoneRow[], today: string): MilestoneDetailView {
  const labels = specLabels([detail.row, ...rows]);
  const specs = detail.specs.map(({ row, file }) => ({
    view: specView(row, labels),
    file,
    verifiedAt: row.verifiedAt === null ? null : dateText(row.verifiedAt.slice(0, 10), today),
    open: file.lines <= OPEN_SPEC_LINES,
  }));
  const counts: DetailCounts = { done: 0, open: 0, waiting: 0, blocked: 0, worklogs: detail.worklogs.length };
  for (const { row } of detail.specs) {
    if (isTicked(row.done, row.total)) counts.done += 1;
    else if (row.status === "Blocked") counts.blocked += 1;
    else if (row.status === "Waiting") counts.waiting += 1;
    else if (row.status !== "Skipped") counts.open += 1;
  }
  return {
    project: detail.project,
    dir: detail.dir,
    head: milestoneView(detail.row, today, labels),
    status: milestoneStatusWord(detail.row.status),
    readme: detail.readme,
    specs,
    counts,
    worklogs: detail.worklogs,
    others: detail.others,
  };
}
