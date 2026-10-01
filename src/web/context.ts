/**
 * The `WebContext` (src/web/api.ts) that `darius serve` hands the web app
 * with each request. The web dev server (`web/server/dev.ts`) uses it too,
 * so dev and production read the store the same way.
 */

import { randomBytes } from "node:crypto";

import type { WebContext } from "./api.ts";
import { resolveSnapshotSettings } from "../core/snapshot-settings.ts";
import { hostId } from "../core/ledger.ts";
import { followUpReadiness } from "../runner/follow-up-ready.ts";
import { LOOPBACK_FOLLOW_UP } from "./action-api.ts";
import { collectBackups } from "./backups.ts";
import { collectSystem } from "./system.ts";
import { collectStatus, milestoneDetail, ritualDetail, runDetail } from "./status.ts";

export function newNonce(): string {
  return randomBytes(16).toString("base64");
}

/** `local` is the loopback viewer: its run page offers no follow-up, as the POST would refuse it. */
export function webContext(viewer: string, nonce: string = newNonce(), local = false): WebContext {
  return {
    viewer,
    nonce,
    status: () => collectStatus(),
    ritual: (project, slug) => ritualDetail(project, slug),
    run: (project, run) => runDetail(project, run),
    milestone: (project, milestone) => milestoneDetail(project, milestone),
    system: () => collectSystem({ backupDir: resolveSnapshotSettings().settings.dir }),
    backups: () => collectBackups(),
    followUp: (project, run) => (local ? Promise.resolve({ ready: false, host: hostId(), reason: LOOPBACK_FOLLOW_UP }) : followUpReadiness(project, run)),
  };
}
