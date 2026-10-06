/**
 * Scope: which workspaces a page covers. A workspace is a darius project.
 * The scope is one workspace (`/w/<ws>/...`) or all of them (`/vigils`,
 * `/rituals`, `/milestones`, `/all`); `/` redirects to the operator's default
 * workspace, or to all of them. The all-workspaces scope leaves out the
 * self-test workspace unless the operator shows it in the settings.
 * Everything here is pure: loaders call it with the status and the settings,
 * the shell calls it with the path.
 */

import { data } from "react-router";

import type { HostStatus, ProjectStatus, WorkspaceIcon } from "../../../src/web/api.ts";
import { buildAgenda, vigilsDue } from "./agenda.ts";
import { needCounts, scopeProjects, selftestLines, workspaceIcon, type HomeScope, type SelftestLine } from "./home.ts";
import type { Place } from "./paths.ts";
import { readScopeCookie, readSettings, type Settings } from "./settings.ts";

/** The badges on the tabs: vigils due today or late, rituals darius runs that are late, findings that need the operator. */
export interface TabCounts {
  vigils: number;
  rituals: number;
  findings: number;
}

export function tabCounts(projects: readonly ProjectStatus[], today: string): TabCounts {
  const rituals = buildAgenda({ projects, today, only: "ritual" });
  return { vigils: vigilsDue(projects, today), rituals: rituals.overdue, findings: projects.reduce((sum, project) => sum + project.findings.needsYou, 0) };
}

/** The default workspace from the settings, when this host has it; otherwise null (all workspaces). */
export function defaultWorkspaceOf(status: HostStatus, settings: Settings): string | null {
  const name = settings.defaultWorkspace;
  return name !== null && status.projects.some((project) => project.name === name) ? name : null;
}

/**
 * The scope you were last in: from the `darius_scope` cookie when this host
 * still has that workspace (or the cookie says all workspaces), else the
 * default workspace, else null (all workspaces).
 */
export function lastScopeOf(status: HostStatus, settings: Settings, cookieHeader: string | null): string | null {
  const saved = readScopeCookie(cookieHeader);
  if (saved === null) return null;
  if (saved !== undefined && status.projects.some((project) => project.name === saved)) return saved;
  return defaultWorkspaceOf(status, settings);
}

/**
 * The scope the frame shows for a place: the scope of the path, except on a
 * host page and on a path with no scope at all (a 404), which show the last scope.
 */
export function effectiveScope(place: Place, lastScope: string | null): string | null {
  if (place.kind === "host" || (place.kind === "unknown" && place.scope === null)) return lastScope;
  return place.scope;
}

/** What a loader needs to draw a page for its scope. */
export interface Scoped {
  settings: Settings;
  scope: HomeScope;
  projects: ProjectStatus[];
}

/**
 * The scope of a request. A `ws` param names a workspace (404 when this host
 * has none of that name). Any path without a `ws` param is all workspaces;
 * `/` is a redirect and never gets here.
 */
export function scopeOfRequest(status: HostStatus, request: Request, workspace: string | undefined): Scoped {
  const settings = readSettings(request.headers.get("Cookie"));
  const includeSelftest = settings.showSelftest;
  if (workspace !== undefined) {
    if (!status.projects.some((project) => project.name === workspace)) throw data(`No workspace named ${workspace} on this host.`, { status: 404 });
    const scope: HomeScope = { workspace, includeSelftest };
    return { settings, scope, projects: scopeProjects(status, scope) };
  }
  const scope: HomeScope = { workspace: null, includeSelftest };
  return { settings, scope, projects: scopeProjects(status, scope) };
}

/** One workspace in Places. */
export interface WorkspaceEntry {
  name: string;
  /** darius could not read it. */
  error: boolean;
  /** The things that need the operator here. */
  needs: number;
  tabs: TabCounts;
  /** The icon its marker names; null when it has none or darius could not read it. */
  icon: WorkspaceIcon | null;
}

/** The workspaces Places lists: the self-test one only when it is shown. */
export function workspaceEntries(status: HostStatus, settings: Settings, needsBy: Readonly<Record<string, number>>): WorkspaceEntry[] {
  return scopeProjects(status, { workspace: null, includeSelftest: settings.showSelftest }).map((project) => ({
    name: project.name,
    error: project.error !== null,
    needs: needsBy[project.name] ?? 0,
    tabs: tabCounts([project], status.today),
    icon: workspaceIcon(project),
  }));
}

/** What the frame needs from the store, on every page: Places, the tabs and the host line. */
export interface ShellData {
  /** The things that need the operator over all workspaces: the number in the all-workspaces verdict. */
  needs: number;
  /** The self-test lines at the end of Places; empty when the operator shows the self-test workspace. */
  selftest: SelftestLine[];
  workspaces: WorkspaceEntry[];
  /** The tab badges of the all-workspaces scope. */
  allTabs: TabCounts;
  /** The workspace `/` opens; null for all workspaces. Only a workspace this host has. */
  defaultWorkspace: string | null;
  /** The scope the host pages and the error pages point at: the last one you visited (cookie `darius_scope`); null for all workspaces. */
  lastScope: string | null;
}

export function shellData(status: HostStatus, request: Request): ShellData {
  const settings = readSettings(request.headers.get("Cookie"));
  const counts = needCounts(status, settings.showSelftest);
  return {
    needs: counts.total,
    selftest: settings.showSelftest ? [] : selftestLines(status),
    workspaces: workspaceEntries(status, settings, counts.byProject),
    allTabs: tabCounts(scopeProjects(status, { workspace: null, includeSelftest: settings.showSelftest }), status.today),
    defaultWorkspace: defaultWorkspaceOf(status, settings),
    lastScope: lastScopeOf(status, settings, request.headers.get("Cookie")),
  };
}
