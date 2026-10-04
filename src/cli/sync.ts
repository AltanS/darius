/**
 * `darius sync [--project P | --all-projects] [--pull-only] [--json]`
 *
 * Syncs one project, or every project in the local state dir, with the
 * bucket in config.toml `[remote]` (src/core/sync.ts does the work).
 *
 * Exit codes (probe contract): 0 every project synced; 3 at least one was
 * skipped because the bucket was unreachable or another process held the
 * lease; 1 a real error in any project (the others still run) or no
 * `[remote]` configured; 2 usage.
 *
 * `--project P` creates the local store when it does not exist yet: that is
 * how a second host gets a project for the first time. `--all-projects`
 * covers the projects this host already has, plus the reserved `_global`
 * project (store-wide profiles), which it creates when missing, so every
 * host that syncs gets the profiles.
 *
 * A project whose store holds a tracker tree (src/core/tree.ts) gets its
 * working copy captured before the sync and applied after it, so a tree
 * change on this host goes out with the push, and one pulled from another
 * host lands in the working copy. The report gets `tree: {captured,
 * applied, problems}`. Tree problems are printed, and never change the
 * exit code.
 *
 * `--json` prints one object: {ok, projects: SyncReport[], errors: [{project, error}]}.
 */

import { loadConfig } from "../core/config.ts";
import { loadCredentials } from "../core/credentials.ts";
import { resolveProject } from "../core/paths.ts";
import { createS3 } from "../core/s3.ts";
import type { S3 } from "../core/s3.ts";
import { GLOBAL_PROJECT, listProjects, openProject } from "../core/store.ts";
import { flushAlerts } from "../core/alerts.ts";
import { syncProject } from "../core/sync.ts";
import type { SyncReport } from "../core/sync.ts";
import { applyTree, captureTree, hasTree } from "../core/tree.ts";
import type { Config } from "../core/config.ts";
import { errorMessage } from "../runtime.ts";
import { UsageError } from "./registry.ts";
import type { Command, ParsedArgs } from "./registry.ts";

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_INCONCLUSIVE = 3;

interface ProjectError {
  project: string;
  error: string;
}

/** What sync did to a project's tracker tree. */
interface TreeSyncReport {
  /** Lines the capture before the sync wrote. */
  captured: number;
  /** Files the apply after the sync wrote or removed. */
  applied: number;
  problems: string[];
}

/** One project's sync report, with its tree when it has one. */
interface ProjectSyncReport extends SyncReport {
  tree?: TreeSyncReport;
}

interface SyncRun {
  reports: ProjectSyncReport[];
  errors: ProjectError[];
}

interface ProjectSelection {
  names: string[];
  /** Create a missing local store (an explicit --project, and `_global`), or only sync existing ones. */
  isCreate: (name: string) => boolean;
}

function projectNames(args: ParsedArgs): ProjectSelection {
  const flag = args.flags.project;
  const isAll = args.flags["all-projects"] === true;
  if (flag === true || flag === false) throw new UsageError("--project needs a project name");
  if (isAll && flag !== undefined) throw new UsageError("use --project or --all-projects, not both");
  if (isAll) return { names: [GLOBAL_PROJECT, ...listProjects()], isCreate: (name) => name === GLOBAL_PROJECT };
  return { names: [resolveProject(flag)], isCreate: () => true };
}

function remoteClient(cfg: Config): S3 {
  if (cfg.remote === undefined) {
    throw new Error("no [remote] in config.toml: add the bucket settings, then run 'darius setup --remote'");
  }
  return createS3(cfg.remote, loadCredentials(cfg.remote.credentials));
}

async function syncAll(args: ParsedArgs): Promise<SyncRun> {
  const { names, isCreate } = projectNames(args);
  const cfg = loadConfig();
  const s3 = remoteClient(cfg);
  const run: SyncRun = { reports: [], errors: [] };
  for (const name of names) {
    try {
      const project = openProject(name, { create: isCreate(name) });
      const isTree = hasTree(project);
      // Before the push: a tree change on this host becomes ledger lines and blobs that go out.
      const captured = isTree ? captureTree(project) : null;
      const report: ProjectSyncReport = await syncProject(project, s3, cfg, { pullOnly: args.flags["pull-only"] === true });
      // After the pull: lines from other hosts reach the working copy.
      if (captured !== null) {
        const applied = applyTree(project);
        report.tree = {
          captured: captured.put + captured.removed,
          applied: applied.written + applied.removed,
          problems: [...captured.problems, ...applied.problems],
        };
      }
      run.reports.push(report);
    } catch (cause) {
      if (cause instanceof UsageError) throw cause;
      run.errors.push({ project: name, error: errorMessage(cause) });
    }
  }
  return run;
}

function describeTree(report: ProjectSyncReport): string[] {
  const tree = report.tree;
  if (tree === undefined) return [];
  return [`  tree: ${String(tree.captured)} captured, ${String(tree.applied)} applied`, ...tree.problems.map((problem) => `  ! ${problem}`)];
}

function describe(report: SyncReport): string {
  if (report.skipped === "offline") return `· ${report.project}: skipped, the bucket is unreachable`;
  if (report.skipped === "lease-held") {
    return `· ${report.project}: skipped, lease held by ${report.leaseHolder ?? "another host"}; retry in a minute`;
  }
  const conflicts = report.conflicts.length === 0 ? "" : `, conflicts: ${report.conflicts.join(" ")}`;
  return (
    `✓ ${report.project}: chunks ${report.pulledChunks} in / ${report.pushedChunks} out, ` +
    `items ${report.itemsPulled} in / ${report.itemsPushed} out, ` +
    `blobs ${report.blobsPulled} in / ${report.blobsPushed} out${conflicts}`
  );
}

/**
 * A lease held by another host is a normal skip, exit 0, as in `vigil sweep`:
 * that host is syncing now, and the next timer run catches up. Both hosts'
 * timers fire on the same quarter hour, so exit 3 failed the unit several
 * times a day (0.41.1). An unreachable bucket stays exit 3.
 */
function exitCode(run: SyncRun): number {
  if (run.errors.length > 0) return EXIT_FAILED;
  if (run.reports.some((report) => report.skipped === "offline")) return EXIT_INCONCLUSIVE;
  return EXIT_OK;
}

/**
 * The sync timer runs every 15 minutes, so it also sends what this host's
 * ledgers hold and nobody was told yet (src/core/alerts.ts, 0.29.0): lines a
 * session wrote by hand, and sends that failed before. Best effort, quiet on
 * stdout, and it never changes the exit code.
 */
async function alertAfterSync(): Promise<void> {
  try {
    for (const failure of (await flushAlerts())?.failed ?? []) console.error(`darius sync: alert: ${failure}`);
  } catch (cause) {
    console.error(`darius sync: alert: ${errorMessage(cause)}`);
  }
}

export const syncCommand: Command = {
  name: "sync",
  summary: "pull from and push to the bucket: --project P | --all-projects, --pull-only",
  async run(args: ParsedArgs): Promise<number> {
    const run = await syncAll(args);
    const code = exitCode(run);
    await alertAfterSync();
    if (args.json) {
      console.log(JSON.stringify({ ok: code === EXIT_OK, projects: run.reports, errors: run.errors }));
      for (const failure of run.errors) console.error(`darius sync: ${failure.project}: ${failure.error}`);
      return code;
    }
    for (const report of run.reports) console.log([describe(report), ...describeTree(report)].join("\n"));
    for (const failure of run.errors) console.error(`! ${failure.project}: ${failure.error}`);
    if (run.reports.length === 0 && run.errors.length === 0) console.log("· no projects in the local store");
    return code;
  },
};
