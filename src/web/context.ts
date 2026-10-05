/**
 * The `WebContext` (src/web/api.ts) that `darius serve` hands the web app
 * with each request. The web dev server (`web/server/dev.ts`) uses it too,
 * so dev and production read the store the same way.
 */

import { randomBytes } from "node:crypto";

import type { FindingRow, WebContext } from "./api.ts";
import { collectFindings, type Finding } from "../core/finding-index.ts";
import { listProjects, openProject } from "../core/store.ts";
import { resolveSnapshotSettings } from "../core/snapshot-settings.ts";
import { hostId, readLedger } from "../core/ledger.ts";
import { followUpReadiness } from "../runner/follow-up-ready.ts";
import { LOOPBACK_FOLLOW_UP } from "./action-api.ts";
import { collectBackups } from "./backups.ts";
import { collectSystem } from "./system.ts";
import { collectStatus, milestoneDetail, ritualDetail, runDetail } from "./status.ts";

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
    run: (project, run) => runDetail(project, run),
    milestone: (project, milestone) => milestoneDetail(project, milestone),
    system: () => collectSystem({ backupDir: resolveSnapshotSettings().settings.dir }),
    backups: () => collectBackups(),
    findings: () => Promise.resolve(collectFindingRows()),
    followUp: (project, run) => (local ? Promise.resolve({ ready: false, host: hostId(), reason: LOOPBACK_FOLLOW_UP }) : followUpReadiness(project, run)),
  };
}
