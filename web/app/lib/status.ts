/**
 * One status read per request. The root loader and a page loader run with
 * the same context object, so they share the read instead of reading the
 * store twice.
 */

import type { AppLoadContext } from "react-router";

import type { FleetWorkspaces, HostStatus, ProjectStatus, RunRow } from "../../../src/web/api.ts";

const cache = new WeakMap<AppLoadContext, HostStatus>();
const workspacesCache = new WeakMap<AppLoadContext, FleetWorkspaces>();

export function statusOf(context: AppLoadContext): HostStatus {
  const cached = cache.get(context);
  if (cached !== undefined) return cached;
  const status = context.status();
  cache.set(context, status);
  return status;
}

/**
 * Every workspace with its health, read once per request (0.141.0): Places
 * in the root loader and the Workspaces, machine and workspace pages share it.
 */
export function workspacesOf(context: AppLoadContext): FleetWorkspaces {
  const cached = workspacesCache.get(context);
  if (cached !== undefined) return cached;
  const workspaces = context.workspaces();
  workspacesCache.set(context, workspaces);
  return workspaces;
}

/** A run with the project it belongs to. */
export interface ProjectRun extends RunRow {
  project: string;
}

/** The recent runs of every project, newest first. */
export function allRuns(projects: readonly ProjectStatus[]): ProjectRun[] {
  return projects
    .flatMap((project) => project.runs.map((run) => ({ ...run, project: project.name })))
    .toSorted((left, right) => right.startedAt.localeCompare(left.startedAt));
}
