/**
 * `darius tree log <path> [--json]`
 * `darius tree restore <path> [--at <sha|ledger-id>] [--dry-run] [--force] [--json]`
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
 * Exit codes: 0 done (or nothing to do), 1 refused, 2 usage.
 */

import { findMarker } from "../core/marker.ts";
import { openProject, type Project } from "../core/store.ts";
import { planRestore, restoreRefusal, restoreTree, treeLog, treeTarget, type RestorePlan, type TreeTarget } from "../core/tree-history.ts";
import { ensureTreeLink, foldTree } from "../core/tree.ts";
import { UsageError, type Command, type ParsedArgs } from "./registry.ts";

const USAGE = "usage: darius tree log <path> [--json] | darius tree restore <path> [--at <sha|ledger-id>] [--dry-run] [--force] [--json]";

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

function runRestore(args: ParsedArgs): number {
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
  if (args.json) {
    console.log(JSON.stringify({ project: tree.project.name, path: label(target), dry_run: false, basis: result.plan.basis, steps: result.plan.steps, restored: result.restored, problems: [...problems, ...result.problems] }));
  } else {
    for (const problem of [...problems, ...result.problems]) console.error(`darius: ${problem}`);
    printPlan(result.plan, `restored ${label(target)}`);
    console.log(`${String(result.restored.length)} file(s) written back and recorded as tree.put`);
  }
  return result.restored.length === result.plan.steps.filter((step) => step.state !== "same").length ? 0 : 1;
}

export const treeCommand: Command = {
  name: "tree",
  summary: "read the tracker tree's history in the store and restore a past version",
  usage: "tree log|restore <path>",
  async run(args) {
    const sub = args.positional[0];
    if (sub === "log") return runLog(args);
    if (sub === "restore") return runRestore(args);
    throw new UsageError(USAGE);
  },
};
