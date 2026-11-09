/**
 * The milestone finder (0.125.0), as data: the rows of one workspace, the
 * two short lists of an empty query, and the filter and rank of a query.
 * Pure, so the server, the browser and the tests agree.
 *
 * An empty query shows "Last worked on" (the newest `lastActivity` first, a
 * milestone with none left out) and "Newest" (the highest milestone number
 * first: the number is the order the milestones were made in). A query
 * shows one list: every word of it must be in the id, the title or the slug,
 * any case. An exact id comes first, then a hit at the start of the id or
 * the title, then the rest; inside each, the newest work first.
 */

import type { MilestoneRow, ProjectStatus } from "../../../src/web/api.ts";
import { idNumber, milestoneRef } from "./milestones.ts";
import { placeOf } from "./paths.ts";

/** One milestone in the finder: what a row shows and where it goes. */
export interface FinderRow {
  id: string;
  /** What the detail page URL names it by (`milestoneRef`). */
  ref: string;
  title: string;
  slug: string;
  status: string;
  lastActivity: string | null;
}

/** One list of the finder; an empty query has two, a query one with no title. */
export interface FinderSection {
  title: string | null;
  rows: FinderRow[];
}

/** How many rows each list of an empty query shows. */
export const FINDER_SHORT = 5;

/** The rows of a workspace's milestones, every status. */
export function finderRows(rows: readonly MilestoneRow[]): FinderRow[] {
  return rows.map((row) => ({ id: row.id, ref: milestoneRef(rows, row), title: row.title, slug: row.slug, status: row.status, lastActivity: row.lastActivity }));
}

/** The finder of the workspace a path is in: its name and its rows. Null outside a workspace, and for a workspace this host does not have. */
export function finderOf(projects: ReadonlyArray<Pick<ProjectStatus, "name" | "milestones">>, pathname: string): { ws: string; rows: FinderRow[] } | null {
  const ws = placeOf(pathname).scope;
  if (ws === null) return null;
  const project = projects.find((candidate) => candidate.name === ws);
  return project === undefined ? null : { ws, rows: finderRows(project.milestones) };
}

/** Newest work first, a row with no time last; then the higher number first. */
function byActivity(left: FinderRow, right: FinderRow): number {
  if (left.lastActivity !== right.lastActivity) {
    if (left.lastActivity === null) return 1;
    if (right.lastActivity === null) return -1;
    return left.lastActivity < right.lastActivity ? 1 : -1;
  }
  return idNumber(right.id) - idNumber(left.id);
}

/** The milestones worked on last: newest first, those with no time left out. */
export function lastWorkedOn(rows: readonly FinderRow[], limit: number = FINDER_SHORT): FinderRow[] {
  return rows
    .filter((row) => row.lastActivity !== null)
    .toSorted(byActivity)
    .slice(0, limit);
}

/** The newest milestones: the highest number first. */
export function newest(rows: readonly FinderRow[], limit: number = FINDER_SHORT): FinderRow[] {
  return rows.toSorted((left, right) => idNumber(right.id) - idNumber(left.id) || left.ref.localeCompare(right.ref)).slice(0, limit);
}

/** The words of a query, lower case. */
export function queryTerms(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/u)
    .filter((term) => term !== "");
}

/** Every word is in the id, the title or the slug. */
export function matches(row: FinderRow, terms: readonly string[]): boolean {
  const fields = [row.id, row.title, row.slug].map((field) => field.toLowerCase());
  return terms.every((term) => fields.some((field) => field.includes(term)));
}

/** 0: the first word is the id (`m12`, or `12`); 1: the id or the title starts with it; 2: any other hit. */
function rank(row: FinderRow, first: string): number {
  const id = row.id.toLowerCase();
  const number = String(idNumber(row.id));
  if (id === first || number === first) return 0;
  if (id.startsWith(first) || (/^\d+$/u.test(first) && number.startsWith(first)) || row.title.toLowerCase().startsWith(first)) return 1;
  return 2;
}

/** The rows a query finds, best first. An empty query finds nothing. */
export function search(rows: readonly FinderRow[], query: string): FinderRow[] {
  const terms = queryTerms(query);
  const first = terms[0];
  if (first === undefined) return [];
  return rows
    .filter((row) => matches(row, terms))
    .map((row) => ({ row, rank: rank(row, first) }))
    .toSorted((left, right) => left.rank - right.rank || byActivity(left.row, right.row))
    .map(({ row }) => row);
}

/** What the finder lists for a query: the two short lists when it is empty, else the hits. A list with no row is left out. */
export function finderSections(rows: readonly FinderRow[], query: string): FinderSection[] {
  if (queryTerms(query).length > 0) return [{ title: null, rows: search(rows, query) }];
  return [
    { title: "Last worked on", rows: lastWorkedOn(rows) },
    { title: "Newest", rows: newest(rows) },
  ].filter((section) => section.rows.length > 0);
}

/** The keys that open the finder: `/` outside a text field, and Ctrl+K or Cmd+K anywhere. */
export function opensFinder(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }, inTextField: boolean): boolean {
  if (event.altKey) return false;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") return true;
  return event.key === "/" && !event.ctrlKey && !event.metaKey && !inTextField;
}
