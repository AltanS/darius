/**
 * Scope: which workspaces a page covers. A workspace is a darius project.
 * The scope is one workspace (`/w/<ws>/...`) or all of them (`/vigils`,
 * `/rituals`, `/milestones`, `/all`); `/` opens the operator's default
 * workspace, or all of them. The all-workspaces scope leaves out the
 * self-test workspace unless the operator shows it in the settings.
 * Everything here is pure: loaders call it with the status and the settings,
 * the shell calls it with the path.
 */

import { data } from "react-router";

import type { HostStatus, ProjectStatus } from "../../../src/web/api.ts";
import { buildAgenda } from "./agenda.ts";
import { needCounts, scopeProjects, selftestLines, type HomeScope, type SelftestLine } from "./home.ts";
import { readSettings, type Settings } from "./settings.ts";

export type Section = "vigils" | "rituals" | "milestones";

/** The badges on the tabs: vigils due today or late, rituals late. */
export interface TabCounts {
  vigils: number;
  rituals: number;
}

export function tabCounts(projects: readonly ProjectStatus[], today: string): TabCounts {
  const vigils = buildAgenda({ projects, today, only: "vigil" });
  const rituals = buildAgenda({ projects, today, only: "ritual" });
  return { vigils: vigils.overdue + vigils.dueToday, rituals: rituals.overdue };
}

/** The default workspace from the settings, when this host has it; otherwise null (all workspaces). */
export function defaultWorkspaceOf(status: HostStatus, settings: Settings): string | null {
  const name = settings.defaultWorkspace;
  return name !== null && status.projects.some((project) => project.name === name) ? name : null;
}

/** What a loader needs to draw a page for its scope. */
export interface Scoped {
  settings: Settings;
  scope: HomeScope;
  projects: ProjectStatus[];
}

/**
 * The scope of a request. A `ws` param names a workspace (404 when this host
 * has none of that name). `/all` is all workspaces. `/` is the default
 * workspace. Any other path without a `ws` param is all workspaces.
 */
export function scopeOfRequest(status: HostStatus, request: Request, workspace: string | undefined): Scoped {
  const settings = readSettings(request.headers.get("Cookie"));
  const includeSelftest = settings.showSelftest;
  if (workspace !== undefined) {
    if (!status.projects.some((project) => project.name === workspace)) throw data(`No workspace named ${workspace} on this host.`, { status: 404 });
    const scope: HomeScope = { workspace, includeSelftest };
    return { settings, scope, projects: scopeProjects(status, scope) };
  }
  const isRoot = new URL(request.url).pathname === "/";
  const scope: HomeScope = { workspace: isRoot ? defaultWorkspaceOf(status, settings) : null, includeSelftest };
  return { settings, scope, projects: scopeProjects(status, scope) };
}

/** One workspace in the switcher. */
export interface WorkspaceEntry {
  name: string;
  /** darius could not read it. */
  error: boolean;
  /** The things that need the operator here. */
  needs: number;
  tabs: TabCounts;
}

/** The workspaces the switcher lists: the self-test one only when it is shown. */
export function workspaceEntries(status: HostStatus, settings: Settings, needsBy: Readonly<Record<string, number>>): WorkspaceEntry[] {
  return scopeProjects(status, { workspace: null, includeSelftest: settings.showSelftest }).map((project) => ({
    name: project.name,
    error: project.error !== null,
    needs: needsBy[project.name] ?? 0,
    tabs: tabCounts([project], status.today),
  }));
}

/** Where a path sits: its workspace (null for all), its section, and whether it is an Overview. */
export interface Place {
  workspace: string | null;
  /** The section whose tab is lit; null on an Overview or a page outside the sections. */
  section: Section | null;
  overview: boolean;
}

function isSection(text: string | undefined): text is Section {
  return text === "vigils" || text === "rituals" || text === "milestones";
}

function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * The place of a path, for the top bar and the tabs. `/` is the default
 * workspace. A ritual page and the runs pages belong to Rituals. Settings and
 * Profiles keep the default scope.
 */
export function placeOf(pathname: string, search: string, defaultWorkspace: string | null): Place {
  const parts = pathname.split("/").filter((part) => part !== "");
  const [first, second, third] = parts;
  if (parts.length === 0) return { workspace: defaultWorkspace, section: null, overview: true };
  if (first === "all") return { workspace: null, section: null, overview: true };
  if (first === "w" && second !== undefined) {
    const workspace = decoded(second);
    return isSection(third) ? { workspace, section: third, overview: false } : { workspace, section: null, overview: third === undefined };
  }
  if (first === "p" && second !== undefined) return { workspace: decoded(second), section: third === "rituals" ? "rituals" : null, overview: false };
  if (isSection(first)) return { workspace: null, section: first, overview: false };
  if (first === "runs") return { workspace: parts.length === 1 ? new URLSearchParams(search).get("project") : decoded(second ?? ""), section: "rituals", overview: false };
  return { workspace: defaultWorkspace, section: null, overview: false };
}

/** What the top bar and the tabs need from the store, on every page. */
export interface ShellData {
  /** The things that need the operator over all workspaces: the number in the all-workspaces verdict. */
  needs: number;
  /** The self-test line of the footer; empty when the operator shows the self-test workspace. */
  selftest: SelftestLine[];
  workspaces: WorkspaceEntry[];
  /** The tab badges of the all-workspaces scope. */
  allTabs: TabCounts;
  /** The workspace `/` opens; null for all workspaces. Only a workspace this host has. */
  defaultWorkspace: string | null;
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
  };
}
