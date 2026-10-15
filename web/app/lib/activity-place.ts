/**
 * The Activity place (0.94.0): which events a filter keeps, what the filter
 * says in words, and the lead of an entry ("ritual Fact check"). Pure: the
 * loader passes the entries and the parsed filter (`activityFilterOf` in
 * paths.ts). The entries come newest first from `WebContext.activity`.
 */

import type { ActivityEntry, ActivityKind } from "../../../src/web/api.ts";
import { ACTIVITY_DAYS, ACTIVITY_KINDS, type ActivityFilter } from "./paths.ts";

/** The most entries the all-workspaces page shows. A workspace page has no cap. */
export const ACTIVITY_CAP = 500;

const DAY_MS = 24 * 3_600_000;

/** What a kind is called on its chip. */
export const KIND_WORDS = {
  "run-started": "run started",
  "follow-up-started": "follow-up started",
  "run-held": "run held",
  "run-answered": "question answered",
  "run-resumed": "run resumed",
  "run-completed": "run completed",
  "run-failed": "run failed",
  "ack-answered": "answered",
  "ack-dismissed": "dismissed",
  "ack-note": "noted",
  "ack-follow-up": "follow-up chosen",
  "vigil-swept": "vigil checked",
  "vigil-paused": "vigil paused",
  "vigil-resumed": "vigil resumed",
  "vigil-closed": "vigil closed",
  "finding-closed": "finding closed",
  "finding-reopened": "finding reopened",
  "finding-reset": "findings reset",
  "ritual-lifecycle": "ritual state changed",
  "ritual-rescheduled": "ritual rescheduled",
  "start-requested": "starting",
  "start-refused": "start refused",
  "start-lost": "start lost",
} as const satisfies Record<ActivityKind, string>;

/** True when the entry passes the `kind` and `by` parts of the filter. The window is cut apart, by `inWindow`. */
export function entryMatches(entry: ActivityEntry, filter: ActivityFilter): boolean {
  return (filter.kind === "" || entry.kind === filter.kind) && (filter.by === "" || entry.actor === filter.by);
}

/** The ISO time a window of `days` days starts at, counted back from `now` (ms). */
export function windowStart(now: number, days: number): string {
  return new Date(now - days * DAY_MS).toISOString();
}

/** The next wider window, or null at the widest. */
export function olderDays(days: ActivityFilter["days"]): ActivityFilter["days"] | null {
  return ACTIVITY_DAYS[ACTIVITY_DAYS.indexOf(days) + 1] ?? null;
}

/** A start the web asked for that shows no run yet: it sits on top of the page as "starting". */
export function isStarting(entry: ActivityEntry): boolean {
  return entry.kind === "start-requested";
}

/** The kinds the entries hold, in the order of `ACTIVITY_KINDS`: the kind chips offer these and no others. */
export function kindsOf(entries: readonly ActivityEntry[]): ActivityKind[] {
  const seen = new Set(entries.map((entry) => entry.kind));
  return ACTIVITY_KINDS.filter((kind) => seen.has(kind));
}

/** The lead of an entry: the kind word and the title of what it is about. A run event is about the run; the lead names its ritual or vigil. */
export function leadOf(entry: ActivityEntry) {
  if (entry.item.type === "run") return { word: entry.links.vigil === undefined ? "ritual" : "vigil", title: entry.item.title } as const;
  return { word: entry.item.type, title: entry.item.title } as const;
}

/** The sentence of an entry after its lead: "Answered by web:altan" reads "answered by web:altan". A word like "Q1" keeps its capital. */
export function afterLead(text: string): string {
  const second = text.charAt(1);
  return second !== "" && second === second.toLowerCase() && !/\d/u.test(second) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

const BY_WORDS = { "": "", web: ", done on the web", timer: ", done by the timer", cli: ", done from the command line", run: ", done by runs" } as const satisfies Record<ActivityFilter["by"], string>;

/** The filter in words: "Everything that happened in the last 7 days in every workspace, newest first." */
export function filterSentence(filter: ActivityFilter, project: string): string {
  const where = project === "" ? "every workspace" : project;
  const what = filter.kind === "" ? "Everything that happened" : `Only "${KIND_WORDS[filter.kind]}" events`;
  return `${what}${BY_WORDS[filter.by]} in the last ${filter.days} days in ${where}, newest first.`;
}
