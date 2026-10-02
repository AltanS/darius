/**
 * The one place that builds or parses an internal URL of the web app. Every
 * link goes through `href()`; `placeOf()` reads a path back into the place it
 * names. test/web-paths.test.ts checks that the two agree, and scans the
 * source for hand-built links.
 */

export type Section = "vigils" | "rituals" | "findings" | "milestones" | "runs";

const SECTIONS: readonly Section[] = ["vigils", "rituals", "findings", "milestones", "runs"];

export type HostPage = "status" | "profiles" | "settings" | "settings/notifications" | "settings/backups" | "settings/about";

export type Target =
  | { to: "overview"; ws: string | null }
  | { to: "section"; ws: string | null; section: Section; query?: Record<string, string> }
  | { to: "ritual"; ws: string; slug: string }
  | { to: "run"; ws: string; run: string }
  | { to: "milestone"; ws: string; ref: string }
  | { to: "vigil"; ws: string; slug: string }
  | { to: "host"; page: HostPage; hash?: string };

function enc(text: string): string {
  return encodeURIComponent(text);
}

/** The id of a vigil row on the Vigils page. */
export function vigilAnchor(slug: string): string {
  return `vigil-${slug}`;
}

function queryText(query: Record<string, string> | undefined): string {
  if (query === undefined) return "";
  const text = new URLSearchParams(Object.entries(query)).toString();
  return text === "" ? "" : `?${text}`;
}

function sectionHref(ws: string | null, section: Section, query: Record<string, string> | undefined): string {
  return `${ws === null ? "" : `/w/${enc(ws)}`}/${section}${queryText(query)}`;
}

/** The address of a place. */
export function href(target: Target): string {
  switch (target.to) {
    case "overview":
      return target.ws === null ? "/all" : `/w/${enc(target.ws)}`;
    case "section":
      return sectionHref(target.ws, target.section, target.query);
    case "ritual":
      return `/w/${enc(target.ws)}/rituals/${enc(target.slug)}`;
    case "run":
      return `/w/${enc(target.ws)}/runs/${enc(target.run)}`;
    case "milestone":
      return `/w/${enc(target.ws)}/milestones/${enc(target.ref)}`;
    case "vigil":
      return `${sectionHref(target.ws, "vigils", undefined)}#${enc(vigilAnchor(target.slug))}`;
    case "host":
      return `/${target.page}${target.hash === undefined ? "" : `#${enc(target.hash)}`}`;
  }
}

/** Where an item (`ritual/<slug>` or `vigil/<slug>`) of a workspace lives. */
export function itemTarget(ws: string, item: string): Target {
  const [kind = "", slug = ""] = item.split("/");
  return kind === "ritual" ? { to: "ritual", ws, slug } : { to: "vigil", ws, slug };
}

/**
 * What a path is. `scope` is the workspace name, or null for all workspaces
 * (and for a path that has no scope). `section` is the section the page
 * belongs to, whatever the kind: a ritual page is in Rituals, a run page in
 * Runs (the run loader knows the item kind and may pass a different section
 * to `crumbsOf`).
 */
export interface Place {
  scope: string | null;
  kind: "overview" | "section" | "detail" | "host" | "unknown";
  section: Section | null;
}

function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function isSection(text: string | undefined): text is Section {
  return SECTIONS.some((section) => section === text);
}

const HOST_ROOTS = new Set(["status", "profiles", "settings"]);

function placeOfWorkspace(scope: string, rest: readonly string[]): Place {
  const [first, second] = rest;
  if (first === undefined) return { scope, kind: "overview", section: null };
  if (!isSection(first)) return { scope, kind: "unknown", section: null };
  if (second === undefined) return { scope, kind: "section", section: first };
  const hasDetail = first === "rituals" || first === "runs" || first === "milestones";
  return { scope, kind: hasDetail && rest.length === 2 ? "detail" : "unknown", section: hasDetail ? first : null };
}

/**
 * The place of a path. It reads the path only: no search string, no default
 * workspace, and `/` is an overview of no scope (it is a redirect).
 */
export function placeOf(pathname: string): Place {
  const parts = pathname.split("/").filter((part) => part !== "");
  const [first, second, ...rest] = parts;
  if (first === undefined || first === "all") return { scope: null, kind: "overview", section: null };
  if (first === "w" && second !== undefined) return placeOfWorkspace(decoded(second), rest);
  if (isSection(first)) return { scope: null, kind: parts.length === 1 ? "section" : "unknown", section: parts.length === 1 ? first : null };
  if (HOST_ROOTS.has(first)) return { scope: null, kind: "host", section: null };
  return { scope: null, kind: "unknown", section: null };
}

const SECTION_LABELS = {
  vigils: "Vigils",
  rituals: "Rituals",
  findings: "Findings",
  milestones: "Milestones",
  runs: "Runs",
} satisfies Record<Section, string>;

/** One step of the trail above a page. The last step is the current page and has no `href`. */
export interface Crumb {
  label: string;
  href: string | null;
}

/**
 * The trail above a page: the scope, the section, the parent when there is
 * one (a run's ritual), and the page's own title. Only the last step is not a
 * link, so a page that gives no `title` (the Runs list) ends in its section.
 * A page with no scope trail (an overview, a host page, an unknown path) has
 * no crumbs.
 */
export function crumbsOf(place: Place, parent?: { label: string; target: Target }, title?: string): Crumb[] {
  if (place.kind !== "section" && place.kind !== "detail") return [];
  const trail: Crumb[] = [{ label: place.scope ?? "All workspaces", href: href({ to: "overview", ws: place.scope }) }];
  if (place.section !== null) trail.push({ label: SECTION_LABELS[place.section], href: href({ to: "section", ws: place.scope, section: place.section }) });
  if (parent !== undefined) trail.push({ label: parent.label, href: href(parent.target) });
  if (title !== undefined) trail.push({ label: title, href: null });
  const last = trail.at(-1);
  if (last !== undefined) last.href = null;
  return trail;
}

/**
 * The section a page lights in the navigation, for the tab bar and for the
 * Places tree alike. A list or a ritual or milestone page lights its own
 * section. A run page lights the section of its item: `itemKind` is the kind
 * of the run's ritual or vigil (the run loader returns it as `kind`), and a
 * run of a ritual lights Rituals, of a vigil Vigils; `placeOf` alone cannot
 * tell, it only reports "runs". The Runs list lights "runs", which the phone
 * tab bar has no tab for, so it lights a Places row and no tab. An overview,
 * a host page and an unknown path light nothing (null).
 */
export function litSection(place: Place, itemKind?: "ritual" | "vigil"): Section | null {
  if (place.kind !== "section" && place.kind !== "detail") return null;
  if (place.kind === "detail" && place.section === "runs") return itemKind === undefined ? null : itemKind === "vigil" ? "vigils" : "rituals";
  return place.section;
}

/** The same place in another scope: a section stays, a detail page goes to its list, anything else to the Overview. */
export function switchTarget(place: Place, ws: string | null): Target {
  if ((place.kind === "section" || place.kind === "detail") && place.section !== null) return { to: "section", ws, section: place.section };
  return { to: "overview", ws };
}
