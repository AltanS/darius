/**
 * One status read per request. The root loader and a page loader run with
 * the same context object, so they share the read instead of reading the
 * store twice.
 */

import type { AppLoadContext } from "react-router";

import type { HostStatus, ProjectStatus, RunRow } from "../../../src/web/api.ts";

const cache = new WeakMap<AppLoadContext, HostStatus>();

export function statusOf(context: AppLoadContext): HostStatus {
  const cached = cache.get(context);
  if (cached !== undefined) return cached;
  const status = context.status();
  cache.set(context, status);
  return status;
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
