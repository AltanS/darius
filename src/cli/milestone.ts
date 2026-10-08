/**
 * `darius milestone archive <milestone> [--dry-run] [--keep] [--json]`
 *
 * The mechanical end of `/darius-archive` (0.73.0): after the skill wrote the
 * archive document, this removes the milestone folder. It refuses (exit 1):
 *
 *   - when `.tracker/archive/<folder>.md` is missing or empty (the name the
 *     archive skill writes and the worklog distill gate reads);
 *   - while a spec of the milestone has an item that is not `[x]` and not
 *     skipped (0.77.0). The refusal lists the open items.
 *     `--incomplete "<reason>"` archives anyway; the reason is in the output
 *     and, in store mode, on every `tree.removed` line as `note`;
 *   - while a worklog thread of the milestone is open at a stage before
 *     `reviewed` (a parked thread is closed, so it does not count). A thread
 *     belongs to the milestone when its worklog file names the folder or its
 *     spec is in the folder. A thread at stage `reviewed` is done: the run
 *     closes it (`worklog close <id> --status done`); a dry run lists it as
 *     "will close"; in git mode the verb prints the command instead.
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

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { checklistItems, closeWorklogThreadDone, openWorklogThreads, rebuildTrackerIndex, worklogFiles, type LegacyThread } from "../core/legacy-entry.ts";
import { findMarker } from "../core/marker.ts";
import { findTrackerDir } from "../core/paths.ts";
import type { Project } from "../core/store.ts";
import { filesUnder, removeTreeFolder } from "../core/tree-history.ts";
import { ensureTreeLink, syncTree, treeDir } from "../core/tree.ts";
import { errorMessage } from "../runtime.ts";
import { UsageError, type Command, type ParsedArgs } from "./registry.ts";
import { storeTree } from "./tree.ts";

const USAGE = 'usage: darius milestone archive <milestone> [--dry-run] [--keep] [--incomplete "<reason>"] [--json]';
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

/** A thread at stage `reviewed` is done: archive closes it. Any other open thread blocks. */
function isReviewed(thread: LegacyThread): boolean {
  return thread.stage === "reviewed";
}

function threadNames(threads: readonly LegacyThread[]): string {
  return threads.map((thread) => `${thread.threadId} (${thread.worklogFile})`).join(", ");
}

async function threadCheck(root: string, folder: string): Promise<{ check: Check; blocking: LegacyThread[]; closable: LegacyThread[] }> {
  const open = (await openWorklogThreads(root)).filter((thread) => belongs(thread, folder));
  const closable = open.filter(isReviewed);
  const blocking = open.filter((thread) => !isReviewed(thread));
  if (blocking.length > 0) {
    const reviewed = closable.length === 0 ? "" : `; ${String(closable.length)} reviewed thread(s) would close: ${threadNames(closable)}`;
    return { check: { name: "open threads", ok: false, detail: `${String(blocking.length)} open before stage reviewed: ${threadNames(blocking)}; close or park them first (darius worklog close|park)${reviewed}` }, blocking, closable };
  }
  if (closable.length > 0) return { check: { name: "open threads", ok: true, detail: `${String(closable.length)} reviewed thread(s) will close as done: ${threadNames(closable)}` }, blocking, closable };
  return { check: { name: "open threads", ok: true, detail: "none" }, blocking, closable };
}

/** An item of a spec that blocks the archive: neither `[x]` nor skipped. */
interface OpenItem {
  spec: string;
  index: number;
  label: string;
  state: string;
}

const SPEC_FILE = /\.md$/u;

/** The spec files of a milestone folder: every markdown file but the README, the way the tracker reads them. */
function specFiles(root: string, folder: string): string[] {
  const dir = join(root, folder);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => SPEC_FILE.test(name) && name !== "00-README.md" && !name.startsWith(".") && !name.startsWith("_") && lstatSync(join(dir, name)).isFile())
    .toSorted();
}

async function openItems(root: string, folder: string): Promise<OpenItem[]> {
  const open: OpenItem[] = [];
  for (const spec of specFiles(root, folder)) {
    let items: Awaited<ReturnType<typeof checklistItems>>;
    try {
      items = await checklistItems(readFileSync(join(root, folder, spec), "utf8"));
    } catch (cause) {
      open.push({ spec, index: -1, label: `cannot read the checklist: ${errorMessage(cause)}`, state: "unreadable" });
      continue;
    }
    for (const item of items) {
      if (item.state === "verified" || item.state === "skipped") continue;
      open.push({ spec, index: item.index, label: item.label, state: item.state });
    }
  }
  return open;
}

function itemsCheck(open: readonly OpenItem[], incomplete: string | undefined): Check {
  if (open.length === 0) return { name: "items", ok: true, detail: "every item is done or skipped" };
  const shown = open.slice(0, 12).map((item) => (item.index < 0 ? `${item.spec}: ${item.label}` : `${item.spec} #${String(item.index)} [${item.state}] ${item.label}`));
  const more = open.length > shown.length ? ` (and ${String(open.length - shown.length)} more)` : "";
  const list = `${shown.join("; ")}${more}`;
  if (incomplete !== undefined) return { name: "items", ok: true, detail: `${String(open.length)} open, archived anyway (--incomplete: ${incomplete}): ${list}` };
  return { name: "items", ok: false, detail: `${String(open.length)} not done: ${list}; finish them, mark them skipped, or pass --incomplete "<reason>"` };
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

/** True when git tracks files under `.tracker/<folder>/`. False when it does not, or git is not there. */
function trackedByGit(root: string, folder: string): boolean {
  const result = spawnSync("git", ["-C", dirname(root), "ls-files", "--", `.tracker/${folder}/`], { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim() !== "";
}

function undoLine(mode: Where["mode"], folder: string, tracked: boolean): string | null {
  if (mode === "store") return `darius tree restore .tracker/${folder}/`;
  return tracked ? `git checkout HEAD -- .tracker/${folder}/` : null;
}

/** `--incomplete "<reason>"`: undefined when absent; a usage error when empty. */
function incompleteReason(args: ParsedArgs): string | undefined {
  const value = args.flags.incomplete;
  if (value === undefined) return undefined;
  if (value === true || value === false || value.trim() === "") throw new UsageError('--incomplete needs a reason: --incomplete "<why this milestone is archived with open items>"');
  return value.trim();
}

async function runArchive(args: ParsedArgs): Promise<number> {
  const arg = args.positional[1];
  if (arg === undefined || args.positional.length > 2) throw new UsageError(USAGE);
  const dryRun = args.flags["dry-run"] === true;
  const keep = args.flags.keep === true;
  const incomplete = incompleteReason(args);
  const place = where(process.cwd(), dryRun);
  const folder = resolveFolder(place.root, arg);
  const threads = await threadCheck(place.root, folder);
  const open = await openItems(place.root, folder);
  const checks = [archiveCheck(place.root, folder), itemsCheck(open, incomplete), threads.check, await worklogNote(place.root, folder)];
  const files = filesOf(place, folder).map((path) => `.tracker/${path}`);
  const refused = checks.some((check) => !check.ok);
  const tracked = place.mode === "git" && trackedByGit(place.root, folder);
  const undo = undoLine(place.mode, folder, tracked);
  const closeCommands = threads.closable.map((thread) => `darius worklog close ${thread.threadId} --status done`);

  let removed: string[] = [];
  const closed: string[] = [];
  const problems: string[] = [];
  const act = !refused && !dryRun && !keep;
  // Git mode never deletes: the caller runs this command, and git keeps the history.
  const remove = tracked ? `git rm -r -q .tracker/${folder}/` : `rm -r .tracker/${folder}/`;
  const command = act && place.mode === "git" ? remove : null;
  if (act && place.project !== undefined) {
    // The legacy writer closes the reviewed threads in the working copy; the removal below captures that first.
    for (const thread of threads.closable) {
      try {
        await closeWorklogThreadDone(join(place.root, "worklog", thread.worklogFile), thread.threadId);
        closed.push(thread.threadId);
      } catch (cause) {
        problems.push(`cannot close ${thread.threadId}: ${errorMessage(cause)}`);
      }
    }
    const removal = removeTreeFolder(place.project, folder, incomplete === undefined || open.length === 0 ? {} : { note: `archived incomplete: ${incomplete}` });
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
    const json = {
      milestone: folder,
      mode: place.mode,
      outcome,
      action,
      command,
      dry_run: dryRun,
      keep,
      checks,
      files,
      removed,
      undo: removed.length > 0 || command !== null || dryRun ? undo : null,
      tracked_by_git: place.mode === "git" ? tracked : null,
      incomplete: incomplete !== undefined && open.length > 0 ? incomplete : null,
      open_items: open,
      will_close: threads.closable.map((thread) => thread.threadId),
      closed,
      close_commands: place.mode === "git" && act ? closeCommands : [],
      problems,
    };
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
      for (const line of closeCommands) console.log(`run first: ${line}`);
      console.log(`checks passed; darius writes nothing to a tracker in git. Remove the ${String(files.length)} files, then commit the delete with the archive document:`);
      console.log(`run: ${command}`);
      if (undo !== null) console.log(`undo before the commit: ${undo} (after it: git revert)`);
      else console.log(`the files are not tracked by git, so nothing can bring them back after the delete. Copy .tracker/${folder}/ first if you want a backup.`);
    } else {
      if (dryRun) for (const line of threads.closable) console.log(`will close: ${line.threadId} (${line.worklogFile}), stage reviewed`);
      for (const id of closed) console.log(`closed: ${id} (stage reviewed) as done`);
      console.log(dryRun ? `would remove ${String(files.length)} files:` : `removed ${String(removed.length)} files:`);
      for (const file of dryRun ? files : removed) console.log(`  ${file}`);
      if (undo !== null) console.log(`undo: ${undo}`);
    }
  }
  if (refused) return 1;
  return place.mode === "store" && act && removed.length < files.length ? 1 : 0;
}

export const milestoneCommand: Command = {
  name: "milestone",
  help: USAGE,
  flags: ["dry-run", "keep", "incomplete"],
  summary: "archive a milestone: check it is done and remove its folder",
  usage: "milestone archive <milestone> [--dry-run] [--keep] [--incomplete <reason>]",
  async run(args) {
    if (args.positional[0] === "archive") return runArchive(args);
    throw new UsageError(USAGE);
  },
};
