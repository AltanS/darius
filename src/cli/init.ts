/**
 * `darius init [--project <name>] [--no-import] [--json]`: from nothing to a
 * working repo in one command (docs/concept.md, "Migration plan").
 *
 * Run it anywhere inside a repo. The repo root is the dir of the nearest
 * `.darius.toml`, else of the nearest `.tracker/`, else the git root, else
 * the current dir. Then:
 *
 *   no .darius.toml, no .tracker/    fresh repo: write `.darius.toml` (v3,
 *                                    `project` defaults to the dir name, kinds
 *                                    ritual, vigil and milestone), link this
 *                                    checkout, scaffold the tracker tree in the
 *                                    store through the vendored writer. Nothing
 *                                    else is written in the checkout: no
 *                                    `.tracker` path, no `.gitignore` line
 *                                    (0.78.0).
 *   no .darius.toml, a .tracker/     legacy repo: import its rituals, runs and
 *                                    verification log into the store (read-only
 *                                    on `.tracker/`), write the marker, link.
 *                                    `darius onboard` moves the tracker later.
 *   a .darius.toml                   link it when this host has no link yet,
 *                                    scaffold `.tracker/` when it is missing,
 *                                    never import. Safe to re-run: a linked
 *                                    repo prints `already linked`. When its
 *                                    kinds list milestone: bring the store tree
 *                                    up to date, never scaffold.
 *
 * Refusals, each with its fix on the line: the store already holds rituals
 * for the project and there is no marker yet (the import would run twice;
 * `--no-import` links without it); the project is linked to another checkout
 * on this host; `--project` disagrees with the marker; the root is the home
 * dir or `/`; the name is not a project name.
 *
 * Every write goes through its one writer: the marker here, the link through
 * `linkCheckout`, `.tracker/` through the vendored `initTracker`, the store
 * through `importTracker`, the tree through src/core/tree.ts. Nothing is
 * written before every check passed.
 *
 * Exit codes: 0 done or nothing to do, 1 refused or failed, 2 usage.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { importTracker, type ImportReport } from "../core/import.ts";
import { scaffoldTracker, scaffoldStoreTree } from "../core/legacy-entry.ts";
import { defaultWho } from "../core/ledger.ts";
import { readLinks } from "../core/links.ts";
import { findMarker, MARKER_FILE, MARKER_VERSION, readMarker } from "../core/marker.ts";
import { findTrackerDir, projectDir } from "../core/paths.ts";
import { isProjectName, openProject } from "../core/store.ts";
import { tomlString } from "../core/toml.ts";
import { captureTree, ensureTreeDir, syncTree } from "../core/tree.ts";
import { conflictingLink, linkCheckout } from "./link.ts";
import { UsageError, type Command, type ParsedArgs } from "./registry.ts";

const USAGE = "usage: darius init [--project <name>] [--no-import] [--json]";
const TRACKER = ".tracker";
const MAX_SEARCH_DEPTH = 64;

/** Where init works, and what it found there. */
interface Repo {
  root: string;
  /** The project named by the marker, when there is one. */
  markerProject?: string;
  hasTracker: boolean;
  inGit: boolean;
}

/** What `init --json` prints. */
interface InitResult {
  project: string;
  dir: string;
  marker: "written" | "present";
  link: "linked" | "unchanged";
  tracker: "created" | "present";
  import: ImportReport | null;
  /** The commands to run next, in order. */
  next: string[];
}

function isDir(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
}

/** The nearest dir at `start` or above it that holds `.git` (a dir, or a file in a worktree), or null. */
function gitRoot(start: string): string | null {
  let dir = resolve(start);
  for (let depth = 0; depth < MAX_SEARCH_DEPTH; depth += 1) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/** True when `dir` is `top` or below it. */
function isWithin(dir: string, top: string): boolean {
  return dir === top || dir.startsWith(`${top}/`);
}

/**
 * The repo init works on. A marker or a `.tracker/` above the git root
 * belongs to another repo, so the git root bounds the walk up.
 */
function findRepo(cwd: string): Repo {
  const top = gitRoot(cwd);
  const inRepo = (dir: string | undefined): string | undefined => (dir !== undefined && (top === null || isWithin(dir, top)) ? dir : undefined);
  const marker = findMarker(cwd);
  const markerDir = inRepo(marker?.dir);
  const tracker = findTrackerDir(cwd);
  const root = markerDir ?? inRepo(tracker === null ? undefined : dirname(tracker)) ?? top ?? resolve(cwd);
  const repo: Repo = { root, hasTracker: isDir(join(root, TRACKER)), inGit: top !== null };
  if (markerDir !== undefined && marker !== null) repo.markerProject = marker.project;
  return repo;
}

/** The directory name made into a project name: runs of other characters become '-'. Empty when nothing is left. */
export function projectNameFrom(dir: string): string {
  return basename(dir)
    .replaceAll(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/^[^A-Za-z0-9]+/u, "")
    .replace(/[^A-Za-z0-9]+$/u, "")
    .slice(0, 128);
}

function projectFlag(args: ParsedArgs): string | undefined {
  const value = args.flags.project;
  if (value === undefined) return undefined;
  if (value === true || value === false || value === "") throw new UsageError(`--project needs a name. ${USAGE}`);
  return value;
}

/** How many rituals this host's store holds for `project`. */
function storedRituals(project: string): number {
  if (!existsSync(projectDir(project))) return 0;
  return openProject(project).listItems("ritual").length;
}

/** How many rituals `.tracker/rituals/` holds: dirs with a `ritual.md`. */
function trackerRituals(root: string): number {
  const dir = join(root, TRACKER, "rituals");
  if (!isDir(dir)) return 0;
  return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, "ritual.md"))).length;
}

/** True when `.tracker/` holds something `darius import` reads. */
function hasImportable(root: string): boolean {
  return isDir(join(root, TRACKER, "rituals")) || existsSync(join(root, TRACKER, ".verification-log.jsonl"));
}

function markerText(project: string, isTree: boolean): string {
  return [
    "# darius: this repo's project. Commit this file; each host links its checkout with darius init.",
    `v = ${String(MARKER_VERSION)}`,
    `project = ${tomlString(project)}`,
    // A v3 marker needs a root zone: the host's, which the operator may change.
    `tz = ${tomlString(Intl.DateTimeFormat().resolvedOptions().timeZone)}`,
    // A fresh repo keeps its whole tracker in the darius store.
    ...(isTree ? ['kinds = ["ritual", "vigil", "milestone"]'] : []),
    "",
  ].join("\n");
}

/** True when the repo's marker lists `milestone`: the store owns the tracker tree. A broken marker is false. */
function isTreeMarker(root: string): boolean {
  try {
    return readMarker(root)?.kinds.includes("milestone") === true;
  } catch {
    return false;
  }
}

/** The owner for the milestone example: git's user.email, else the login name. */
function ownerHint(root: string): string {
  try {
    const email = execFileSync("git", ["-C", root, "config", "user.email"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (email !== "") return email;
  } catch {
    // No git, or no user.email: fall through to the login name.
  }
  return defaultWho();
}

function plural(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? "" : "s"}`;
}

/** Checks that must pass before init writes a marker. Throws with the fix on the line. */
function checkNewMarker(repo: Repo, project: string, noImport: boolean): void {
  if (repo.root === homedir() || repo.root === "/") {
    throw new Error(`${repo.root} is not a repo. cd into the repo, then run darius init there`);
  }
  if (!isProjectName(project)) {
    throw new UsageError(
      `"${project}" cannot be a project name: use letters, digits, '-', '_' or '.', a letter or digit first. Pass one: darius init --project <name>`,
    );
  }
  const other = conflictingLink(project, repo.root);
  if (other !== undefined) {
    throw new Error(`project ${project} is already linked to ${other} on this host. Pick another name: darius init --project <name>`);
  }
  const rituals = storedRituals(project);
  if (rituals > 0 && !noImport) {
    throw new Error(
      `the darius store already holds ${plural(rituals, "ritual")} for project ${project}, so init will not import again. ` +
        `If this repo is ${project}: darius init --no-import. If not, pick another name: darius init --project <name>`,
    );
  }
}

/** What init prints after its ✓ lines, and the same as bare commands for `--json`. */
interface NextSteps {
  lines: string[];
  commands: string[];
}

/** True when the repo's marker is v3: rituals are defined there, and `ritual add` is refused. */
function isV3(root: string): boolean {
  try {
    return (readMarker(root)?.version ?? 0) >= 3;
  } catch {
    return false;
  }
}

/** The lines after the ✓ lines: what to run next. */
function nextSteps(repo: Repo, project: string, wrote: { marker: boolean; tracker: boolean }): NextSteps {
  const lines: string[] = [];
  const commands: string[] = [];
  const isTree = isTreeMarker(repo.root);
  const paths = [wrote.marker ? MARKER_FILE : null, wrote.tracker && !isTree ? TRACKER : null].filter((path) => path !== null);
  if (paths.length > 0) {
    const commit = `git add ${paths.join(" ")} && git commit -m "darius init"`;
    if (repo.inGit) {
      lines.push(`Commit ${paths.join(" and ")}: ${commit}`);
      commands.push(commit);
    } else {
      lines.push(`This dir is not in git. Put it in git, then commit ${paths.join(" and ")}.`);
    }
  }
  const owner = ownerHint(repo.root);
  const plan = [
    `darius add milestone --name "First milestone" --slug first-milestone --owner ${owner}`,
    `darius add spec --milestone first-milestone --name "First spec" --template generic`,
    "darius next",
  ];
  const ritual = [`darius ritual add weekly-review --title "Weekly review" --cadence 7d --mode report`, "darius run now weekly-review --dry-run"];
  const where = isTree ? "the tracker" : ".tracker/";
  if (wrote.tracker) {
    lines.push(`Plan work in ${where}, then see the first open task:`, ...plan.map((line) => `  ${line}`));
    commands.push(...plan);
  } else {
    lines.push(`See the next open task in ${where}: darius next`);
    commands.push("darius next");
  }
  if (repo.hasTracker && !isTree && isV3(repo.root)) lines.push("Next: darius onboard moves the tracker into the darius store.");
  if (isV3(repo.root)) {
    lines.push(
      "Rituals live in .darius.toml (v = 3): add [rituals.<slug>] with title, cadence, skill and mode, commit it, then run darius ritual reconcile.",
    );
  } else if (storedRituals(project) === 0) {
    lines.push("Add a recurring ritual, then see what an unattended run would do:", ...ritual.map((line) => `  ${line}`));
    commands.push(...ritual);
  } else {
    lines.push("See which rituals are due: darius due");
    commands.push("darius due");
  }
  return { lines, commands };
}

function importLine(report: ImportReport): string {
  const counts = `${plural(report.rituals.found, "ritual")}, ${plural(report.runs.new, "run")} and ${plural(report.evidence.new, "evidence line")}`;
  return `✓ imported ${counts} from .tracker/ into the darius store (.tracker/ is not changed)`;
}

async function run(args: ParsedArgs): Promise<number> {
  if (args.positional.length > 0) throw new UsageError(USAGE);
  const repo = findRepo(process.cwd());
  const flag = projectFlag(args);
  const noImport = args.flags["no-import"] === true;
  const out: string[] = [];

  let project: string;
  let markerState: InitResult["marker"];
  let report: ImportReport | null = null;
  if (repo.markerProject === undefined) {
    project = flag ?? projectNameFrom(repo.root);
    if (project === "") throw new UsageError(`cannot make a project name from ${repo.root}. Pass one: darius init --project <name>`);
    checkNewMarker(repo, project, noImport);
    // The import runs first: when it fails, no marker points at a half-filled project.
    if (repo.hasTracker && !noImport && hasImportable(repo.root)) {
      report = importTracker({ source: join(repo.root, TRACKER), project, dryRun: false });
    }
    writeFileSync(join(repo.root, MARKER_FILE), markerText(project, !repo.hasTracker));
    markerState = "written";
    out.push(`✓ wrote ${MARKER_FILE}: project = "${project}"`);
  } else {
    project = repo.markerProject;
    if (flag !== undefined && flag !== project) {
      throw new UsageError(`${MARKER_FILE} says project = "${project}", but --project names "${flag}". Drop --project, or edit ${MARKER_FILE}`);
    }
    const other = conflictingLink(project, repo.root);
    if (other !== undefined) {
      throw new Error(`${project} is already linked to ${other} on this host. If this checkout replaces it: darius link --force`);
    }
    markerState = "present";
  }

  const wasLinked = readLinks().get(project) === repo.root;
  const linked = linkCheckout(project, repo.root, false);
  if (wasLinked && markerState === "present") out.push(`· already linked: ${project} at ${repo.root}`);
  else out.push(`✓ linked ${project} to ${repo.root} on this host`);

  let trackerState: InitResult["tracker"] = "present";
  if (isTreeMarker(repo.root)) {
    const store = openProject(project, { create: true });
    const tree = ensureTreeDir(store);
    if (markerState === "written") {
      // The vendored writer scaffolds the tree in the store with only the
      // derived 00-INDEX.md; nothing is written in the checkout.
      if (!existsSync(join(tree, "00-INDEX.md"))) await scaffoldStoreTree(repo.root, tree);
      captureTree(store);
      trackerState = "created";
      out.push(`✓ created the tracker in the darius store: ${tree} (darius root prints it)`);
    } else {
      const synced = syncTree(store);
      out.push(`✓ the tracker is in the darius store: ${tree}`, ...[...synced.capture.problems, ...synced.apply.problems].map((problem) => `! ${problem}`));
    }
  } else if (!repo.hasTracker) {
    await scaffoldTracker(repo.root);
    trackerState = "created";
    out.push(`✓ created ${TRACKER}/00-INDEX.md`);
  }

  if (report !== null) {
    out.push(importLine(report), ...report.problems.map((problem) => `! ${problem}`));
  } else if (repo.hasTracker && markerState === "written") {
    out.push(noImport ? "· --no-import: .tracker/ was not imported" : "· nothing to import: .tracker/ has no rituals/ and no .verification-log.jsonl");
  } else if (markerState === "present" && storedRituals(project) === 0 && trackerRituals(repo.root) > 0) {
    out.push(
      `! .tracker/rituals/ has ${plural(trackerRituals(repo.root), "ritual")}, and this host's store has none for ${project}. ` +
        "If sync is set up: darius sync. If no host ever imported them: darius import .tracker",
    );
  }

  const next = nextSteps(repo, project, { marker: markerState === "written", tracker: trackerState === "created" });
  if (args.json) {
    const result: InitResult = { project, dir: repo.root, marker: markerState, link: linked.outcome, tracker: trackerState, import: report, next: next.commands };
    console.log(JSON.stringify(result));
    return 0;
  }
  for (const line of [...out, ...next.lines]) console.log(line);
  return 0;
}

export const initCommand: Command = {
  name: "init",
  help: USAGE,
  flags: ["no-import"],
  summary: "set up this repo: write .darius.toml, link this checkout, create the tracker or import its rituals. --project, --no-import",
  audience: "session",
  usage: "init [--project <name>] [--no-import]",
  run,
};
