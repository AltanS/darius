/**
 * `darius milestone archive <milestone> [--dry-run] [--keep] [--json]`
 *
 * The mechanical end of `/darius-archive` (0.73.0): after the skill wrote the
 * archive document, this removes the milestone folder. It refuses (exit 1):
 *
 *   - when `.tracker/archive/<folder>.md` is missing or empty (the name the
 *     archive skill writes and the worklog distill gate reads);
 *   - while a worklog thread of the milestone is open (a parked thread is
 *     closed, so it does not count). A thread belongs to the milestone when
 *     its worklog file names the folder or its spec is in the folder.
 *
 * The worklog is not a gate: `worklog distill` needs the folder gone first,
 * so the verb only reports whether the worklog still waits for its stub.
 *
 * Then (unless `--keep`):
 *
 *   store mode (the marker's kinds list milestone): it removes the folder,
 *     one `tree.removed` line per file, all at one time, then the apply
 *     deletes them (src/core/tree-history.ts), and rebuilds `00-INDEX.md`
 *     through the legacy writer. `darius tree restore .tracker/<folder>/`
 *     brings the folder back; the verb prints that line.
 *   git mode: it writes nothing, because native code never writes a git
 *     `.tracker/`. It prints the command for the caller to run,
 *     `git rm -r -q .tracker/<folder>/` (`action: "print"`, `command` in
 *     `--json`). Git is the safety net there.
 *
 * `--dry-run` prints every check and every file, and writes nothing.
 */

import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { openWorklogThreads, rebuildTrackerIndex, worklogFiles, type LegacyThread } from "../core/legacy-entry.ts";
import { findMarker } from "../core/marker.ts";
import { findTrackerDir } from "../core/paths.ts";
import type { Project } from "../core/store.ts";
import { filesUnder, removeTreeFolder } from "../core/tree-history.ts";
import { ensureTreeLink, syncTree, treeDir } from "../core/tree.ts";
import { errorMessage } from "../runtime.ts";
import { UsageError, type Command, type ParsedArgs } from "./registry.ts";
import { storeTree } from "./tree.ts";

const USAGE = "usage: darius milestone archive <milestone> [--dry-run] [--keep] [--json]";
const MILESTONE_DIR = /^M\d+-.+$/u;

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

interface Where {
  mode: "store" | "git";
  root: string;
  project?: Project;
}

/** The tracker root this verb acts on, and its mode. */
function where(cwd: string, dryRun: boolean): Where {
  const marker = findMarker(cwd);
  if (marker !== null && marker.kinds.includes("milestone")) {
    const tree = storeTree(cwd);
    if ("error" in tree) throw new Error(tree.error);
    if (!dryRun) {
      // Like a tracker verb: the link, then this host's edits and the other hosts' changes.
      ensureTreeLink(tree.checkout, tree.project);
      syncTree(tree.project);
    }
    return { mode: "store", root: treeDir(tree.project), project: tree.project };
  }
  const root = findTrackerDir(cwd);
  if (root === null) throw new Error("no .tracker/ here or above. Run darius init in the repo root to create one.");
  return { mode: "git", root };
}

/** The active milestone folder for `arg`: the folder name, its slug without `M<n>-`, or `M<n>`. */
function resolveFolder(root: string, arg: string): string {
  const wanted = arg.replace(/^\.tracker\//u, "").replace(/\/+$/u, "").toLowerCase();
  const folders = existsSync(root)
    ? readdirSync(root).filter((name) => MILESTONE_DIR.test(name) && lstatSync(join(root, name)).isDirectory())
    : [];
  const found = folders.filter((name) => {
    const lower = name.toLowerCase();
    return lower === wanted || lower.replace(/^m\d+-/u, "") === wanted || lower.startsWith(`${wanted}-`) && /^m\d+$/u.test(wanted);
  });
  const exact = found.find((name) => name.toLowerCase() === wanted);
  if (exact !== undefined) return exact;
  if (found.length === 1 && found[0] !== undefined) return found[0];
  if (found.length > 1) throw new UsageError(`${arg} matches more than one milestone: ${found.join(", ")}`);
  throw new Error(`no active milestone ${arg} in ${root}`);
}

/** `archive/<folder>.md`, case-insensitive like the distill gate, when it exists. */
function archiveDoc(root: string, folder: string): string | null {
  const dir = join(root, "archive");
  if (!existsSync(dir)) return null;
  const name = readdirSync(dir).find((entry) => entry.toLowerCase() === `${folder.toLowerCase()}.md`);
  return name === undefined ? null : `archive/${name}`;
}

function archiveCheck(root: string, folder: string): Check {
  const doc = archiveDoc(root, folder);
  if (doc === null) return { name: "archive doc", ok: false, detail: `archive/${folder}.md is missing; write the archive document first` };
  const text = readFileSync(join(root, doc), "utf8");
  if (text.trim() === "") return { name: "archive doc", ok: false, detail: `${doc} is empty` };
  return { name: "archive doc", ok: true, detail: `${doc} (${String(Buffer.byteLength(text))} bytes)` };
}

/** The worklog file names of a milestone: `M1-alpha.md`, and `alpha.md` (what `worklog open alpha` writes). */
function worklogNames(folder: string): string[] {
  const lower = folder.toLowerCase();
  return [`${lower}.md`, `${lower.replace(/^m\d+-/u, "")}.md`];
}

function belongs(thread: LegacyThread, folder: string): boolean {
  const lower = folder.toLowerCase();
  const file = thread.worklogFile.toLowerCase();
  if (file.includes(lower) || worklogNames(folder).includes(file)) return true;
  return thread.specPath !== undefined && thread.specPath.toLowerCase().includes(`${lower}/`);
}

async function threadCheck(root: string, folder: string): Promise<{ check: Check; open: LegacyThread[] }> {
  const open = (await openWorklogThreads(root)).filter((thread) => belongs(thread, folder));
  if (open.length === 0) return { check: { name: "open threads", ok: true, detail: "none" }, open };
  const list = open.map((thread) => `${thread.threadId} (${thread.worklogFile})`).join(", ");
  return { check: { name: "open threads", ok: false, detail: `${String(open.length)} open: ${list}; close or park them first (darius worklog close|park)` }, open };
}

/** The worklog's state. Not a gate: distill needs the folder gone first. */
async function worklogNote(root: string, folder: string): Promise<Check> {
  const names = worklogNames(folder);
  const file = (await worklogFiles(root)).find((entry) => names.includes(entry.worklogFile.toLowerCase()));
  if (file === undefined) return { name: "worklog", ok: true, detail: "no worklog file" };
  if (file.state === "distilled") return { name: "worklog", ok: true, detail: `worklog/${file.worklogFile} is distilled` };
  return { name: "worklog", ok: true, detail: `worklog/${file.worklogFile} is not distilled yet; after the archive run darius worklog distill ${file.worklogFile} --stdin` };
}

function filesOf(place: Where, folder: string): string[] {
  if (place.project !== undefined) return filesUnder(place.project, folder);
  const files: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).toSorted()) {
      const path = `${prefix}/${name}`;
      if (lstatSync(join(dir, name)).isDirectory()) walk(join(dir, name), path);
      else files.push(path);
    }
  };
  walk(join(place.root, folder), folder);
  return files;
}

function undoLine(mode: Where["mode"], folder: string): string {
  return mode === "store" ? `darius tree restore .tracker/${folder}/` : `git checkout HEAD -- .tracker/${folder}/`;
}

async function runArchive(args: ParsedArgs): Promise<number> {
  const arg = args.positional[1];
  if (arg === undefined || args.positional.length > 2) throw new UsageError(USAGE);
  const dryRun = args.flags["dry-run"] === true;
  const keep = args.flags.keep === true;
  const place = where(process.cwd(), dryRun);
  const folder = resolveFolder(place.root, arg);
  const threads = await threadCheck(place.root, folder);
  const checks = [archiveCheck(place.root, folder), threads.check, await worklogNote(place.root, folder)];
  const files = filesOf(place, folder).map((path) => `.tracker/${path}`);
  const refused = checks.some((check) => !check.ok);
  const undo = undoLine(place.mode, folder);

  let removed: string[] = [];
  const problems: string[] = [];
  const act = !refused && !dryRun && !keep;
  // Git mode never deletes: the caller runs this command, and git keeps the history.
  const command = act && place.mode === "git" ? `git rm -r -q .tracker/${folder}/` : null;
  if (act && place.project !== undefined) {
    const removal = removeTreeFolder(place.project, folder);
    removed = removal.removed.map((path) => `.tracker/${path}`);
    problems.push(...removal.problems);
    try {
      await rebuildTrackerIndex(place.root);
    } catch (cause) {
      problems.push(`cannot rebuild 00-INDEX.md: ${errorMessage(cause)}`);
    }
  }
  const action = !act ? "none" : command === null ? "remove" : "print";
  const outcome = refused ? "refused" : dryRun ? "dry-run" : keep ? "kept" : command === null ? "archived" : "ready";
  if (args.json) {
    const json = { milestone: folder, mode: place.mode, outcome, action, command, dry_run: dryRun, keep, checks, files, removed, undo: removed.length > 0 || command !== null || dryRun ? undo : null, problems };
    console.log(JSON.stringify(json));
  } else {
    console.log(`milestone archive ${folder} (${place.mode === "store" ? "tracker tree in the darius store" : "tracker in git"})`);
    for (const check of checks) console.log(`  ${check.ok ? "ok     " : "refused"}  ${check.name}: ${check.detail}`);
    for (const problem of problems) console.error(`darius: ${problem}`);
    if (refused) {
      console.log("refused: nothing was removed");
    } else if (keep) {
      console.log(`--keep: ${folder} stays (${String(files.length)} files)`);
    } else if (command !== null) {
      console.log(`checks passed; darius writes nothing to a tracker in git. Remove the ${String(files.length)} files, then commit the delete with the archive document:`);
      console.log(`run: ${command}`);
      console.log(`undo before the commit: ${undo} (after it: git revert)`);
    } else {
      console.log(dryRun ? `would remove ${String(files.length)} files:` : `removed ${String(removed.length)} files:`);
      for (const file of dryRun ? files : removed) console.log(`  ${file}`);
      console.log(`undo: ${undo}`);
    }
  }
  if (refused) return 1;
  return place.mode === "store" && act && removed.length < files.length ? 1 : 0;
}

export const milestoneCommand: Command = {
  name: "milestone",
  summary: "archive a milestone: check it is done and remove its folder",
  usage: "milestone archive <milestone> [--dry-run] [--keep]",
  async run(args) {
    if (args.positional[0] === "archive") return runArchive(args);
    throw new UsageError(USAGE);
  },
};
