/**
 * The `WebContext` (src/web/api.ts) that `darius serve` hands the web app
 * with each request. The web dev server (`web/server/dev.ts`) uses it too,
 * so dev and production read the store the same way.
 */

import { randomBytes } from "node:crypto";

import type { ActivityOptions, FindingRow, ProjectActivityEntry, WebContext } from "./api.ts";
import { collectFindings, type Finding } from "../core/finding-index.ts";
import type { Ritual, Vigil } from "../core/model.ts";
import { listProjects, openProject } from "../core/store.ts";
import { resolveSnapshotSettings } from "../core/snapshot-settings.ts";
import { hostId, readLedger } from "../core/ledger.ts";
import { followUpReadiness } from "../runner/follow-up-ready.ts";
import { LOOPBACK_FOLLOW_UP } from "./action-api.ts";
import { activityOf } from "./activity.ts";
import { collectBackups } from "./backups.ts";
import { collectSystem } from "./system.ts";
import { collectStatus, milestoneDetail, ritualDetail, runDetail, vigilDetail } from "./status.ts";

/** A finding the web shows: every status but `lapsed` (0.66.0), which the CLI shows only under `--all`. */
function isShown(finding: Finding): finding is Finding & { status: FindingRow["status"] } {
  return finding.status !== "lapsed";
}

/**
 * The findings of every project of this host, project by project, worst
 * first within each. A project that cannot be read adds none. Lapsed
 * findings are left out.
 */
export function collectFindingRows(): FindingRow[] {
  return listProjects().flatMap((name) => {
    try {
      const project = openProject(name);
      return collectFindings(project, readLedger(project))
        .filter((finding) => isShown(finding))
        .map((finding): FindingRow => Object.assign({ project: name }, finding));
    } catch {
      return [];
    }
  });
}

/**
 * The activity of one project, or of every project of this host (0.88.0), newest first.
 * A project that cannot be read adds none. Titles of rituals and vigils come from the store.
 */
export function collectActivity(project: string | null, options: ActivityOptions = {}): ProjectActivityEntry[] {
  const names = project === null ? listProjects() : listProjects().filter((name) => name === project);
  const entries = names.flatMap((name): ProjectActivityEntry[] => {
    try {
      const store = openProject(name);
      // One read per title for the whole call, not one per entry.
      const titles = new Map<string, string | undefined>();
      const titleOf = (type: "ritual" | "vigil", id: string): string | undefined => {
        const key = `${type}/${id}`;
        if (!titles.has(key)) titles.set(key, (type === "ritual" ? store.readItem<Ritual>("ritual", id) : store.readItem<Vigil>("vigil", id))?.header.title);
        return titles.get(key);
      };
      // Each project gives at most `limit` entries: the merged newest `limit` come from those.
      return activityOf(name, readLedger(store), { ...options, titleOf }).map((entry) => Object.assign({ project: name }, entry));
    } catch {
      return [];
    }
  });
  const merged = project === null ? entries.toSorted((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0)) : entries;
  return options.limit === undefined ? merged : merged.slice(0, Math.max(0, options.limit));
}

export function newNonce(): string {
  return randomBytes(16).toString("base64");
}

/** `local` is the loopback viewer: its pages offer no follow-up and no Acknowledge button, as the POST would refuse it. */
export function webContext(viewer: string, nonce: string = newNonce(), local = false): WebContext {
  return {
    viewer,
    nonce,
    canWrite: !local,
    status: () => collectStatus(),
    ritual: (project, slug) => ritualDetail(project, slug),
    vigil: (project, slug) => vigilDetail(project, slug),
    run: (project, run) => runDetail(project, run),
    milestone: (project, milestone) => milestoneDetail(project, milestone),
    system: () => collectSystem({ backupDir: resolveSnapshotSettings().settings.dir }),
    backups: () => collectBackups(),
    findings: () => Promise.resolve(collectFindingRows()),
    activity: (project, options) => collectActivity(project, options),
    followUp: (project, run) => (local ? Promise.resolve({ ready: false, host: hostId(), reason: LOOPBACK_FOLLOW_UP }) : followUpReadiness(project, run)),
  };
}
