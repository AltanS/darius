/**
 * The `WebContext` (src/web/api.ts) that `darius serve` hands the web app
 * with each request. The web dev server (`web/server/dev.ts`) uses it too,
 * so dev and production read the store the same way.
 */

import { randomBytes } from "node:crypto";

import type { ActivityOptions, FindingRow, PendingStart, ProjectActivityEntry, VigilDetail, WebContext } from "./api.ts";
import { collectFindings, type Finding } from "../core/finding-index.ts";
import type { LedgerLine, Ritual, Vigil } from "../core/model.ts";
import { listProjects, openProject } from "../core/store.ts";
import { resolveSnapshotSettings } from "../core/snapshot-settings.ts";
import { hostId, readLedger } from "../core/ledger.ts";
import { followUpReadiness } from "../runner/follow-up-ready.ts";
import { LOOPBACK_FOLLOW_UP } from "./action-api.ts";
import { activityOf, pendingActivity } from "./activity.ts";
import { collectBackups } from "./backups.ts";
import { pendingStarts, vigilCheckOf } from "./pending.ts";
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

/** A reader of project ledgers that reads each one once. It throws for a project that cannot be read. */
function cachedLedgers(): (name: string) => LedgerLine[] {
  const ledgers = new Map<string, LedgerLine[]>();
  return (name) => {
    let lines = ledgers.get(name);
    if (lines === undefined) {
      lines = readLedger(openProject(name));
      ledgers.set(name, lines);
    }
    return lines;
  };
}

/**
 * The activity of one project, or of every project of this host (0.88.0), newest first.
 * A project that cannot be read adds none. Titles of rituals and vigils come from the store.
 * Since 0.89.0 the starts the web asked for that show no start yet (starting, refused, lost) are in it.
 */
export function collectActivity(project: string | null, options: ActivityOptions = {}): ProjectActivityEntry[] {
  const names = project === null ? listProjects() : listProjects().filter((name) => name === project);
  const ledgerOf = cachedLedgers();
  const starts = pendingStarts(project, (name) => (names.includes(name) ? safeLedger(ledgerOf, name) : []));
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
      const own = activityOf(name, ledgerOf(name), { ...options, titleOf });
      const waiting = pendingActivity(starts.filter((start) => start.project === name), { ...options, titleOf });
      const merged = [...own, ...waiting].toSorted(newestFirst);
      const cut = options.limit === undefined ? merged : merged.slice(0, Math.max(0, options.limit));
      return cut.map((entry) => Object.assign({ project: name }, entry));
    } catch {
      return [];
    }
  });
  const merged = project === null ? entries.toSorted(newestFirst) : entries;
  return options.limit === undefined ? merged : merged.slice(0, Math.max(0, options.limit));
}

function newestFirst(left: { at: string }, right: { at: string }): number {
  if (left.at < right.at) return 1;
  return left.at > right.at ? -1 : 0;
}

/** The ledger of a project, or nothing when it cannot be read. */
function safeLedger(ledgerOf: (name: string) => LedgerLine[], name: string): LedgerLine[] {
  try {
    return ledgerOf(name);
  } catch {
    return [];
  }
}

/** The starts the web asked for on this host in the last 24 hours (0.89.0), for one project or all. */
export function collectPending(project: string | null): PendingStart[] {
  const names = new Set(listProjects());
  if (project !== null && !names.has(project)) return [];
  const ledgerOf = cachedLedgers();
  return pendingStarts(project, (name) => (names.has(name) ? safeLedger(ledgerOf, name) : []));
}

/** The vigil with its pending check (0.95.0), from the registry of this host. */
function withCheck(detail: VigilDetail | null): VigilDetail | null {
  if (detail === null) return null;
  // A sweep that skipped the vigil is how a refused check answers (`pending.ts`): it must not hide that refusal.
  const sweptAt = detail.sweeps.find((sweep) => sweep.outcome !== "skipped")?.at ?? null;
  return { ...detail, pending: vigilCheckOf(collectPending(detail.project), detail.row.slug, sweptAt) };
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
    vigil: (project, slug) => withCheck(vigilDetail(project, slug)),
    run: (project, run) => runDetail(project, run),
    milestone: (project, milestone) => milestoneDetail(project, milestone),
    system: () => collectSystem({ backupDir: resolveSnapshotSettings().settings.dir }),
    backups: () => collectBackups(),
    findings: () => Promise.resolve(collectFindingRows()),
    activity: (project, options) => collectActivity(project, options),
    pending: (project) => collectPending(project),
    followUp: (project, run) => (local ? Promise.resolve({ ready: false, host: hostId(), reason: LOOPBACK_FOLLOW_UP }) : followUpReadiness(project, run)),
  };
}
