/**
 * `darius tree log <path> [--json]`
 * `darius tree restore <path> [--at <sha|ledger-id>] [--dry-run] [--force] [--json]`
 * `darius tree resolve <path> [--json]`
 *
 * The history of the tracker tree in the store (0.73.0, src/core/tree-history.ts).
 * Only in a project whose marker lists `milestone` in `kinds`: there the tree
 * is not in git, and these verbs are how a past file version comes back. In
 * any other repo git has the history, and both verbs refuse (exit 1).
 *
 * `log` reads only. `restore` without `--at` undoes the latest removal of the
 * path (for a folder: every file that one delete took). It refuses when the
 * working copy holds another version of a file, unless `--force`.
 * `--dry-run` prints the plan and writes nothing.
 *
 * `resolve` (0.75.0) keeps the current version of a file (or of every file
 * under a folder) that has an open tree conflict: one `tree.resolved` line
 * per path, so `darius doctor` and `darius due` stop showing it
 * (src/core/tree-conflicts.ts). The lost version stays a blob.
 *
 * Exit codes: 0 done (or nothing to do), 1 refused, 2 usage.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { worklogFiles } from "../core/legacy-entry.ts";
import { findMarker } from "../core/marker.ts";
import { openProject, type Project } from "../core/store.ts";
import { planRestore, restoreRefusal, restoreTree, treeLog, treeTarget, type RestorePlan, type TreeTarget } from "../core/tree-history.ts";
import { appendLines, defaultWho, readLedger } from "../core/ledger.ts";
import { readTreeConflicts, TREE_RESOLVED } from "../core/tree-conflicts.ts";
import { ensureTreeLink, foldTree, treeDir, TREE_PUT } from "../core/tree.ts";
import type { TreeLine } from "../core/tree.ts";
import { NotFoundError, UsageError, type Command, type ParsedArgs } from "./registry.ts";

const USAGE =
  "usage: darius tree log <path> [--json] | darius tree restore <path> [--at <sha|ledger-id>] [--dry-run] [--force] [--json] | darius tree resolve <path> [--json]";

/** The store project whose tree this checkout links, or the refusal. */
export function storeTree(cwd: string): { project: Project; checkout: string } | { error: string } {
  const marker = findMarker(cwd);
  if (marker === null) return { error: "no .darius.toml here or above; the tracker tree of this repo is in git, so use git log and git restore" };
  if (!marker.kinds.includes("milestone")) {
    return { error: `the tracker tree of ${marker.project} is in git (kinds does not list milestone); use git log and git restore on .tracker/` };
  }
  return { project: openProject(marker.project, { create: true }), checkout: marker.dir };
}

function shortSha(sha: string | null): string {
  return sha === null ? "-".padEnd(12) : sha.slice(0, 12);
}

function label(target: TreeTarget): string {
  if (target.prefix === "") return ".tracker/";
  return `.tracker/${target.prefix}${target.folder ? "/" : ""}`;
}

function pathArg(args: ParsedArgs): string {
  const path = args.positional[1];
  if (path === undefined || args.positional.length > 2) throw new UsageError(USAGE);
  return path;
}

function runLog(args: ParsedArgs): number {
  const tree = storeTree(process.cwd());
  if ("error" in tree) {
    console.error(`darius: ${tree.error}`);
    return 1;
  }
  const problems: string[] = [];
  const history = foldTree(tree.project, problems);
  const target = treeTarget(tree.project, pathArg(args), tree.checkout, history);
  const entries = treeLog(history, target);
  // A path with no history and no file is not in the tree: that is an error, not an empty log.
  if (entries.length === 0 && target.prefix !== "" && !existsSync(join(tree.checkout, ".tracker", target.prefix))) {
    throw new NotFoundError(`no tree lines and no file or folder at ${label(target)}; check the path (darius tree log .tracker/ lists the whole tree)`);
  }
  if (args.json) {
    console.log(JSON.stringify({ project: tree.project.name, path: label(target), folder: target.folder, lines: entries, problems }));
    return 0;
  }
  for (const problem of problems) console.error(`darius: ${problem}`);
  if (entries.length === 0) {
    console.log(`no tree lines for ${label(target)}`);
    return 0;
  }
  for (const entry of entries) {
    const type = entry.type === "tree.put" ? "put    " : "removed";
    const size = entry.size === null ? "" : `${String(entry.size)} B`;
    console.log(`${entry.id}  ${entry.at}  ${`${entry.host}/${entry.who}`.padEnd(28)}  ${type}  ${shortSha(entry.sha)}  ${size.padStart(9)}  ${entry.path}`);
  }
  return 0;
}

const STATE_WORDS = { restore: "restore", same: "same   ", differs: "differs", "no-blob": "no blob" } as const;

function printPlan(plan: RestorePlan, heading: string): void {
  console.log(`${heading} (${plan.basis}):`);
  for (const step of plan.steps) {
    console.log(`  ${STATE_WORDS[step.state]}  ${shortSha(step.sha)}  ${String(step.size).padStart(7)} B  .tracker/${step.path}`);
  }
}

const MILESTONE_FOLDER = /^M\d+-[^/]+$/u;

/** The sha of the version of `path` before its newest put (what a distill replaced), short; null when there is none. */
function versionBeforeNewest(history: ReadonlyMap<string, TreeLine[]>, path: string): string | null {
  const puts = (history.get(path) ?? []).filter((line) => line.type === TREE_PUT);
  const before = puts.at(-2)?.after;
  return before === undefined || before === null ? null : before.slice(0, 12);
}

/**
 * After a restore of a milestone folder: what else lists or hides it. An archive
 * document in `archive/` lists the milestone a second time, and a distilled
 * worklog stub holds none of its threads. Each warning names the commands that
 * end it. Reads only.
 */
async function restoreFollowUps(project: Project, target: TreeTarget, history: ReadonlyMap<string, TreeLine[]>): Promise<string[]> {
  if (!target.folder || !MILESTONE_FOLDER.test(target.prefix)) return [];
  const folder = target.prefix;
  const lines: string[] = [];
  const archiveDir = join(treeDir(project), "archive");
  const archive = existsSync(archiveDir) ? readdirSync(archiveDir).find((name) => name.toLowerCase() === `${folder.toLowerCase()}.md`) : undefined;
  if (archive !== undefined) {
    lines.push(
      `${folder} has an archive document, archive/${archive}, so the milestone is now listed twice.`,
      `  Remove the document: rm .tracker/archive/${archive}`,
      `  or rename it:        mv .tracker/archive/${archive} .tracker/archive/${archive.replace(/\.md$/u, "")}.old`,
    );
  }
  const names = new Set([`${folder.toLowerCase()}.md`, `${folder.toLowerCase().replace(/^m\d+-/u, "")}.md`]);
  const stubs = (await worklogFiles(treeDir(project))).filter((entry) => entry.state === "distilled" && names.has(entry.worklogFile.toLowerCase()));
  for (const stub of stubs) {
    const path = `worklog/${stub.worklogFile}`;
    const sha = versionBeforeNewest(history, path) ?? "<sha of the pre-distill version>";
    lines.push(
      `worklog/${stub.worklogFile} is a distilled stub, so the threads of ${folder} are not in it.`,
      `  Bring the threads back: darius tree restore .tracker/${path} --at ${sha} --force`,
      `  (find the version with: darius tree log .tracker/${path})`,
    );
  }
  return lines;
}

async function runRestore(args: ParsedArgs): Promise<number> {
  const tree = storeTree(process.cwd());
  if ("error" in tree) {
    console.error(`darius: ${tree.error}`);
    return 1;
  }
  const at = args.flags.at;
  if (at === true) throw new UsageError(USAGE);
  const atValue = at === undefined || at === false ? undefined : at;
  const force = args.flags.force === true;
  const problems: string[] = [];
  const target = treeTarget(tree.project, pathArg(args), tree.checkout, foldTree(tree.project, problems));
  if (args.flags["dry-run"] === true) {
    const plan = planRestore(tree.project, foldTree(tree.project, problems), target, atValue);
    const refusal = restoreRefusal(plan, force);
    if (args.json) {
      console.log(JSON.stringify({ project: tree.project.name, path: label(target), dry_run: true, basis: plan.basis, steps: plan.steps, refusal, problems }));
    } else {
      printPlan(plan, `would restore ${label(target)}`);
      if (refusal !== null) console.log(`refused: ${refusal}`);
    }
    return refusal === null ? 0 : 1;
  }
  ensureTreeLink(tree.checkout, tree.project);
  const result = restoreTree(tree.project, target, { at: atValue, force });
  const followUp = result.restored.length > 0 ? await restoreFollowUps(tree.project, target, foldTree(tree.project, [])) : [];
  if (args.json) {
    console.log(JSON.stringify({ project: tree.project.name, path: label(target), dry_run: false, basis: result.plan.basis, steps: result.plan.steps, restored: result.restored, problems: [...problems, ...result.problems], follow_up: followUp }));
  } else {
    for (const problem of [...problems, ...result.problems]) console.error(`darius: ${problem}`);
    printPlan(result.plan, result.restored.length > 0 ? `restored ${label(target)}` : `nothing to write for ${label(target)}`);
    console.log(`${String(result.restored.length)} file(s) written back and recorded as tree.put`);
    for (const line of followUp) console.log(line.startsWith(" ") ? line : `warning: ${line}`);
  }
  return result.restored.length === result.plan.steps.filter((step) => step.state !== "same").length ? 0 : 1;
}

function runResolve(args: ParsedArgs): number {
  const tree = storeTree(process.cwd());
  if ("error" in tree) {
    console.error(`darius: ${tree.error}`);
    return 1;
  }
  const problems: string[] = [];
  const target = treeTarget(tree.project, pathArg(args), tree.checkout, foldTree(tree.project, problems));
  const inside = (path: string): boolean => target.prefix === "" || (target.folder ? path.startsWith(`${target.prefix}/`) : path === target.prefix);
  const open = readTreeConflicts(readLedger(tree.project)).open.filter((conflict) => inside(conflict.path));
  const paths = [...new Set(open.map((conflict) => conflict.path))].toSorted();
  const who = defaultWho();
  appendLines(tree.project, paths.map((path) => ({ who, type: TREE_RESOLVED, path })));
  if (args.json) {
    console.log(JSON.stringify({ project: tree.project.name, path: label(target), resolved: paths, conflicts: open, problems }));
    return 0;
  }
  for (const problem of problems) console.error(`darius: ${problem}`);
  if (paths.length === 0) {
    console.log(`no open conflict under ${label(target)}`);
    return 0;
  }
  for (const path of paths) console.log(`resolved .tracker/${path}: the current version stays, the lost version stays a blob`);
  return 0;
}

export const treeCommand: Command = {
  name: "tree",
  help: USAGE,
  flags: ["at", "dry-run", "force"],
  summary: "read the tracker tree's history in the store, restore a past version, resolve a conflict",
  usage: "tree log|restore|resolve <path>",
  async run(args) {
    const sub = args.positional[0];
    if (sub === "log") return runLog(args);
    if (sub === "restore") return await runRestore(args);
    if (sub === "resolve") return runResolve(args);
    throw new UsageError(USAGE);
  },
};
