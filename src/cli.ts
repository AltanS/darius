/**
 * The `darius` command line: the dispatcher.
 *
 * `--version` and bare `help` stay special-cased here -- the version line's
 * exact format (`darius <version> (<bun|node>)`) is a compatibility
 * contract with scripts/test.sh and the operator's scripts, not just a
 * command. Every other verb is a `Command` registered by a module under
 * src/cli/ (src/cli/commands.ts holds the fixed import list; a command
 * module calls `register()` once, at import time), or a verb of the vendored
 * legacy CLI: `routeVerb` in src/core/kinds.ts decides, from the verb and
 * the kinds the repo's marker says the store owns (`ownedKinds`), and a
 * legacy verb gets the whole argv, its output and its exit code unchanged. Exit codes follow the
 * operator's probe contract: 0 ok, 1 refused or failed, 2 usage, 3
 * inconclusive environment.
 */

import { parseArgs, readStdin } from "./cli/args.ts";
import { registerCommands } from "./cli/commands.ts";
import { getCommand, listCommands, register, UsageError, type Command, type ParsedArgs } from "./cli/registry.ts";
import { isInteractive } from "./cli/tui.ts";
import { DEFAULT_KINDS, kindOfVerb, LEGACY_VERBS, routeVerb } from "./core/kinds.ts";
import { rebuildTrackerIndex, runLegacy } from "./core/legacy-entry.ts";
import { findMarker } from "./core/marker.ts";
import { findTrackerDir, isUnlinkedTrackerRepo, ownedKinds, type OwnedKinds } from "./core/paths.ts";
import { openProject, type Project } from "./core/store.ts";
import { captureTree, ensureTreeLink, isIndexMissing, syncTree, TREE_INDEX_FILE, treeDir } from "./core/tree.ts";
import { projectVigils } from "./core/vigil-projection.ts";
import { errorMessage, isBun } from "./runtime.ts";
import { VERSION } from "./version.ts";

const HELP_INTRO = `darius ${VERSION}: rituals, vigils and milestones for agent-driven projects`;

interface HelpEntry {
  name: string;
  summary: string;
}

function helpEntries(): HelpEntry[] {
  return listCommands().map((command) => ({ name: command.name, summary: command.summary }));
}

function printHelpText(): void {
  console.log(`${HELP_INTRO}\n`);
  console.log("Usage:");
  console.log("  darius               open the Due and Run screens (in a terminal; else this help)");
  console.log("  darius --version     print the version and the runtime");
  console.log("  darius --skill       print the Claude Code skill (darius skill)");
  console.log("  darius <command>     run a registered command\n");
  console.log("Commands:");
  for (const entry of helpEntries()) {
    console.log(`  darius ${entry.name.padEnd(12)} ${entry.summary}`);
  }
  console.log("\nTracker verbs (milestones, specs, worklogs, vigils). They act on the tracker tree: in the darius");
  console.log("store when the marker's kinds list milestone (.tracker is then a link to it), else in .tracker/:");
  console.log(`  ${[...LEGACY_VERBS].join(", ")}`);
  console.log("\nThe full command surface is planned in docs/concept.md.");
}

const helpCommand: Command = {
  name: "help",
  summary: "list every registered command",
  async run(args) {
    if (args.json) {
      console.log(JSON.stringify({ version: VERSION, commands: helpEntries() }));
      return 0;
    }
    printHelpText();
    return 0;
  },
};

registerCommands();
register(helpCommand);

/** Bare `darius` opens the TUI in a terminal; in a pipe or a script it prints help, as it always did. */
function resolveCommandName(first: string | undefined): string {
  if (first === undefined) return isInteractive() ? "tui" : "help";
  if (first === "--help" || first === "-h") return "help";
  if (first === "--skill") return "skill";
  return first;
}

async function main(argv: string[]): Promise<number> {
  const first = argv[0];

  if (first === "--version" || first === "-v") {
    console.log(`darius ${VERSION} (${isBun ? "bun" : "node"})`);
    return 0;
  }

  const name = resolveCommandName(first);
  const owned = ownedKinds(argv, process.cwd());
  // A broken marker must never send a vigil write to the legacy writer.
  if (!owned.ok && name === "vigil" && argv[1] !== "sweep") {
    console.error(`darius: ${owned.error}`);
    return 1;
  }
  const kinds = owned.ok ? owned.kinds : DEFAULT_KINDS;
  const route = routeVerb(name, argv[1], (verb) => getCommand(verb) !== undefined, kinds);
  if (route === "legacy") return runLegacyVerb(argv, owned);
  const command = getCommand(name);
  if (route === "unknown" || command === undefined) {
    console.error(`darius: unknown command '${name}'. Run 'darius help'.`);
    return 2;
  }

  let args: ParsedArgs;
  try {
    args = parseArgs(argv.slice(1));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`darius: ${error.message}`);
    return 2;
  }
  const kind = kindOfVerb(name);
  const project = args.flags.project;
  const named = project !== undefined && project !== false && project !== true ? project : undefined;
  if (kind !== null && kinds.has(kind) && isUnlinkedTrackerRepo(named, process.cwd())) {
    console.error("darius: this repo is not linked: run darius init");
    return 1;
  }
  if (args.flags.stdin === true) {
    args.stdin = readStdin();
  }

  try {
    return await command.run(args);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`darius: ${error.message}`);
      return 2;
    }
    console.error(`darius: ${errorMessage(error)}`);
    return 1;
  }
}

/**
 * Legacy verbs that run as before when the store owns the tracker tree. The
 * hooks must stay fast and fail open; they read the tree through the link.
 * The others read no tree, or only read it.
 */
const TREE_PLAIN_VERBS: ReadonlySet<string> = new Set(["hook-stop", "hook-drift", "delegation", "agents", "scan", "counsel-gate"]);
const TREE_HOOKS: ReadonlySet<string> = new Set(["hook-stop", "hook-drift"]);

/** How a legacy verb meets the tracker tree. */
type TreeRoute = { mode: "plain" } | { mode: "refuse"; message: string } | { mode: "tree"; project: Project; checkout: string };

/**
 * The tracker tree a legacy verb acts on. The marker found from the cwd
 * decides, because the legacy CLI finds `.tracker` from the cwd too. With
 * `milestone` in its kinds the tree is in the store; a broken marker stops
 * every verb that may write, so nothing writes a `.tracker/` the store may own.
 */
function treeRoute(verb: string, owned: OwnedKinds, cwd: string): TreeRoute {
  const plain = TREE_PLAIN_VERBS.has(verb);
  if (!owned.ok) return plain ? { mode: "plain" } : { mode: "refuse", message: owned.error };
  try {
    const marker = findMarker(cwd);
    if (marker === null || !marker.kinds.includes("milestone")) return { mode: "plain" };
    if (TREE_HOOKS.has(verb)) {
      try {
        ensureTreeLink(marker.dir, openProject(marker.project, { create: true }));
      } catch {
        // A hook fails open: a missing link only means it sees no tracker.
      }
      return { mode: "plain" };
    }
    if (plain) return { mode: "plain" };
    return { mode: "tree", project: openProject(marker.project, { create: true }), checkout: marker.dir };
  } catch (cause) {
    return plain ? { mode: "plain" } : { mode: "refuse", message: errorMessage(cause) };
  }
}

function noop(): void {}

/** Rebuilds a missing `00-INDEX.md` of the tree, quietly: a failure is one stderr line, never a stop. */
async function rebuildMissingIndex(project: Project): Promise<void> {
  if (!isIndexMissing(project)) return;
  try {
    await rebuildTrackerIndex(treeDir(project));
  } catch (cause) {
    console.error(`darius: cannot rebuild ${TREE_INDEX_FILE} in ${treeDir(project)}: ${errorMessage(cause)}`);
  }
}

function printProblems(problems: readonly string[]): void {
  for (const problem of problems) console.error(`darius: ${problem}`);
}

/**
 * Prepares the tree for a legacy verb: the link, a capture and an apply, the
 * vigil files, and a missing `00-INDEX.md` (a host that got the tree by sync
 * has none). Returns the capture to run after the verb (once), or an error
 * message when the verb must not run.
 */
async function openTree(route: { project: Project; checkout: string }): Promise<{ finish: () => void } | { error: string }> {
  const { project, checkout } = route;
  try {
    ensureTreeLink(checkout, project);
    const synced = syncTree(project);
    printProblems([...synced.capture.problems, ...synced.apply.problems]);
    projectVigils(project, treeDir(project));
  } catch (cause) {
    return { error: errorMessage(cause) };
  }
  await rebuildMissingIndex(project);
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    try {
      printProblems(captureTree(project).problems);
    } catch (cause) {
      console.error(`darius: the tracker change is in ${treeDir(project)} but not in the store yet: ${errorMessage(cause)}`);
    }
  };
  return { finish };
}

/**
 * A verb darius does not own: the legacy CLI gets the argv as given, and its
 * exit code passes through. When it fails and there is no `.tracker/` here
 * or above, one more stderr line names the fix. It hooks `exit` because a
 * legacy verb may end the process itself. `delegation` is a pure validator and
 * needs no `.tracker/`, so it never gets the line.
 *
 * When the store owns the tracker tree (`treeRoute`), the verb runs on the
 * tree through the `.tracker` link: first the tree is captured and applied,
 * then the verb runs, then the change is captured, also when the verb ends
 * the process itself.
 */
async function runLegacyVerb(argv: string[], owned: OwnedKinds): Promise<number> {
  const route = treeRoute(argv[0] ?? "", owned, process.cwd());
  if (route.mode === "refuse") {
    console.error(`darius: ${route.message}`);
    return 1;
  }
  let finish = noop;
  if (route.mode === "tree") {
    const opened = await openTree(route);
    if ("error" in opened) {
      console.error(`darius: ${opened.error}`);
      return 1;
    }
    finish = opened.finish;
  }
  process.once("exit", (code) => {
    finish();
    if (code !== 0 && argv[0] !== "delegation" && findTrackerDir(process.cwd()) === null) {
      console.error("darius: no .tracker/ here or above. Run darius init in the repo root to create one.");
    }
  });
  try {
    return await runLegacy(argv);
  } catch (error) {
    console.error(`darius: ${errorMessage(error)}`);
    return 1;
  } finally {
    finish();
  }
}

process.exitCode = await main(process.argv.slice(2));
