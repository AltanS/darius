/**
 * What a workspace Overview adds to the home view (lib/home.ts): the latest
 * report of each djinn (a ritual that follows a repo skill) and the recent
 * runs. The project page used to hold them.
 */

import type { ProjectStatus, RitualRow, RunDetail, VigilRow } from "../../../src/web/api.ts";
import { activity, isDjinn, isUnattended, reportExcerpt, type ActivityRun, type Excerpt } from "./view.ts";

/** Recent runs listed on a page. */
export const RECENT = 10;

export interface Djinn {
  ritual: RitualRow;
  last: ActivityRun | null;
  report: Excerpt | null;
}

export interface WorkspaceExtras {
  name: string;
  checkout: string | null;
  maxMode: string | null;
  lastSync: string | null;
  djinns: Djinn[];
  /** The project has rituals darius runs, but none follows a skill: the Latest reports section has nothing to say. */
  hasUnattendedWithoutDjinn: boolean;
  recent: ActivityRun[];
}

type ReadRun = (project: string, run: string) => RunDetail | null;

export function workspaceExtras(project: ProjectStatus, readRun: ReadRun): WorkspaceExtras {
  const runs = activity([project], { withImported: false });
  const djinns = project.rituals
    .filter((ritual) => isDjinn(ritual))
    .map((ritual) => {
      const finished = runs.find((run) => run.slug === ritual.slug && run.findingsSha !== null) ?? null;
      return { ritual, last: runs.find((run) => run.slug === ritual.slug) ?? null, report: finished === null ? null : reportExcerpt(readRun(project.name, finished.run)) };
    });
  return {
    name: project.name,
    checkout: project.checkout,
    maxMode: project.maxMode,
    lastSync: project.lastSync,
    djinns,
    hasUnattendedWithoutDjinn: djinns.length === 0 && project.rituals.some((ritual) => isUnattended(ritual)),
    recent: runs.slice(0, RECENT),
  };
}

/** A closed vigil with its workspace, for the fold of the Vigils section. */
export interface ClosedVigil {
  project: string;
  vigil: VigilRow;
}

export function closedVigils(projects: readonly ProjectStatus[]): ClosedVigil[] {
  return projects.flatMap((project) => project.vigils.filter((vigil) => vigil.state === "closed").map((vigil) => ({ project: project.name, vigil })));
}
