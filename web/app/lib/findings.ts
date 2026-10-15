/**
 * The findings page filter (0.62.0): three views and three narrowing
 * filters, all in the address. Pure, so the page and the tests share it.
 *
 *   view      needs-you (the default) | open (needs-you and open) | all
 *   project   a project name
 *   ritual    a ritual slug
 *   severity  critical | high | medium | low | info
 *
 * An unknown value of any of them reads as "no filter", so an old link
 * never shows an empty page for a typo.
 */

import type { FindingRow, FindingStep, ResultSeverity } from "../../../src/web/api.ts";
import { hostDate, shortDate } from "./format.ts";
import { href } from "./paths.ts";
import { itemStateTag } from "./result.ts";

export type FindingView = "needs-you" | "open" | "all";

export const VIEWS: readonly { view: FindingView; label: string }[] = [
  { view: "needs-you", label: "needs you" },
  { view: "open", label: "open" },
  { view: "all", label: "all" },
];

export const SEVERITIES: readonly ResultSeverity[] = ["critical", "high", "medium", "low", "info"];

export interface FindingQuery {
  view: FindingView;
  project: string;
  ritual: string;
  severity: string;
}

export const DEFAULT_QUERY: FindingQuery = { view: "needs-you", project: "", ritual: "", severity: "" };

function isView(text: string | null): text is FindingView {
  return text === "needs-you" || text === "open" || text === "all";
}

function isSeverity(text: string): text is ResultSeverity {
  return SEVERITIES.some((severity) => severity === text);
}

/** The query of an address. */
export function readQuery(params: URLSearchParams): FindingQuery {
  const view = params.get("view");
  const severity = params.get("severity") ?? "";
  return {
    view: isView(view) ? view : DEFAULT_QUERY.view,
    project: params.get("project") ?? "",
    ritual: params.get("ritual") ?? "",
    severity: isSeverity(severity) ? severity : "",
  };
}

/** Whether a finding of this status shows in the view. */
export function inView(row: Pick<FindingRow, "status">, view: FindingView): boolean {
  if (view === "all") return true;
  if (view === "open") return row.status === "needs-you" || row.status === "open";
  return row.status === "needs-you";
}

type Narrowing = Pick<FindingQuery, "project" | "ritual" | "severity">;

function narrows(row: FindingRow, query: Narrowing): boolean {
  return (query.project === "" || row.project === query.project) && (query.ritual === "" || row.ritual === query.ritual) && (query.severity === "" || row.severity === query.severity);
}

/** The findings of the query, in the order given (the host sorts worst first). */
export function filterFindings(rows: readonly FindingRow[], query: FindingQuery): FindingRow[] {
  return rows.filter((row) => inView(row, query.view) && narrows(row, query));
}

/** How many findings a view would show with the other filters of the query on. */
export function viewCount(rows: readonly FindingRow[], query: FindingQuery, view: FindingView): number {
  return filterFindings(rows, { ...query, view }).length;
}

export type Facet = "project" | "ritual" | "severity";

/**
 * The values a chip row offers for one filter: those that some finding in the
 * current view still has when the other filters are on, so no chip leads to
 * an empty page. The chosen value stays, even when nothing has it. Severities
 * come worst first, the rest by name.
 */
export function facetOptions(rows: readonly FindingRow[], query: FindingQuery, facet: Facet): string[] {
  const others: FindingQuery = { ...query, [facet]: "" };
  const values = new Set(filterFindings(rows, others).map((row) => row[facet]));
  if (query[facet] !== "") values.add(query[facet]);
  if (facet === "severity") return SEVERITIES.filter((severity) => values.has(severity));
  return [...values].toSorted((left, right) => left.localeCompare(right));
}

/** The address of a query on the Findings page of `ws` (null: all workspaces); a default value is left out. */
export function findingsHref(ws: string | null, query: FindingQuery): string {
  const extra: Record<string, string> = {};
  if (query.view !== DEFAULT_QUERY.view) extra.view = query.view;
  if (query.project !== "") extra.project = query.project;
  if (query.ritual !== "") extra.ritual = query.ritual;
  if (query.severity !== "") extra.severity = query.severity;
  return href({ to: "section", ws, section: "findings", query: extra });
}

const VIEW_WORDS = new Map<FindingView, string>([
  ["needs-you", "Findings that need you"],
  ["open", "Open findings"],
  ["all", "All findings, with the closed and fixed ones"],
]);

/** The filter in words: "Findings that need you in acme-web, ritual site-check, severity high, worst first." */
export function filterText(query: FindingQuery, scope: string | null): string {
  const where = scope !== null ? ` in ${scope}` : query.project === "" ? " of every project" : ` in ${query.project}`;
  const ritual = query.ritual === "" ? "" : `, ritual ${query.ritual}`;
  const severity = query.severity === "" ? "" : `, severity ${query.severity}`;
  return `${VIEW_WORDS.get(query.view) ?? "Findings"}${where}${ritual}${severity}, worst first.`;
}

/** The line of an empty page. */
export function emptyText(query: FindingQuery): string {
  const narrowed = query.project !== "" || query.ritual !== "" || query.severity !== "";
  if (narrowed) return "No finding matches this filter.";
  if (query.view === "needs-you") return "Nothing needs you.";
  return query.view === "open" ? "No open findings." : "No findings yet.";
}

/** The note of an event as a tail: ": known issue", or nothing. */
function noteTail(note: string | undefined): string {
  return note === undefined || note === "" ? "" : `: ${note}`;
}

/**
 * One step of the history fold (0.96.0), dated on the host's calendar: a
 * report says how bad it was, an event says who did it and why. A reopen with
 * no `who` is the report of a higher severity that ended a close.
 */
export function stepText(step: FindingStep, offset: number): string {
  const date = shortDate(hostDate(step.at, offset));
  if (step.kind === "report") return `${date}, ${step.severity}, ${itemStateTag(step.state).text}`;
  if (step.kind === "closed") return `${date}, closed by ${step.who ?? "someone"}${noteTail(step.note)}`;
  if (step.kind === "reset") return `${date}, history starts after a reset by ${step.who ?? "someone"}${noteTail(step.note)}`;
  if (step.who === undefined) return `Reopened by the run of ${date}, now ${step.severity}`;
  return `${date}, reopened by ${step.who}${noteTail(step.note)}`;
}

/** Whether a step links to a run: the reports, and the reopen a report caused. */
export function stepRun(step: FindingStep): string | null {
  return step.run === "" ? null : step.run;
}

/** The key of a step in a list: a report and the reopen it caused share a run and a time. */
export function stepKey(step: FindingStep, index: number): string {
  return `${String(index)}-${step.kind}-${step.at}`;
}

/** "Closed by web:altan on 12 Oct: known issue" while a close is in force; null otherwise. */
export function closedText(row: Pick<FindingRow, "closed">, offset: number): string | null {
  const { closed } = row;
  if (closed === undefined) return null;
  return `Closed by ${closed.who} on ${shortDate(hostDate(closed.at, offset))}${noteTail(closed.note)}`;
}
