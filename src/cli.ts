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
import { commandHelp, getCommand, listCommands, register, UsageError, type Command, type ParsedArgs } from "./cli/registry.ts";
import { isInteractive } from "./cli/tui.ts";
import { DEFAULT_KINDS, kindOfVerb, LEGACY_VERBS, routeVerb } from "./core/kinds.ts";
import { rebuildTrackerIndex, runLegacy } from "./core/legacy-entry.ts";
import { withJsonErrors, wantsJson } from "./core/json-errors.ts";
import { readLedger } from "./core/ledger.ts";
import { findTrackerDir, isUnlinkedTrackerRepo, ownedKinds, type OwnedKinds } from "./core/paths.ts";
import { openProject, type Project } from "./core/store.ts";
import { closestNames } from "./core/suggest.ts";
import { captureTree, ensureTreeDir, isIndexMissing, syncTree, TREE_INDEX_FILE, treeDir } from "./core/tree.ts";
import { applyEngineEnv, doctorNotes, removeOwnTreeLink, resolveTrackerRoot, type TrackerWhere } from "./core/tracker-root.ts";
import { conflictAdvice, readTreeConflicts } from "./core/tree-conflicts.ts";
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
  console.log("store when the marker's kinds list milestone (darius root prints where), else in .tracker/:");
  console.log(`  ${[...LEGACY_VERBS].join(", ")}`);
  console.log("\nThe full command surface is planned in docs/concept.md.");
}

const helpCommand: Command = {
  name: "help",
  summary: "list every registered command",
  usage: "help [<command>]",
  async run(args) {
    const topic = args.positional[0];
    const asked = topic === undefined ? undefined : getCommand(topic);
    if (asked !== undefined) {
      console.log(commandHelp(asked));
      return 0;
    }
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

/** True when `--help` or `-h` is among `args`, before a bare `--`. */
function wantsHelp(args: readonly string[]): boolean {
  for (const token of args) {
    if (token === "--") return false;
    if (token === "--help" || token === "-h") return true;
  }
  return false;
}

/** The line for a verb nobody knows: the closest verbs when there are any (docs/concept.md, "CLI contract"). */
function unknownCommandMessage(name: string): string {
  const known = [...listCommands().map((command) => command.name), ...LEGACY_VERBS];
  const near = closestNames(name, known);
  if (near.length === 0) return `darius: unknown command: ${name}. Run 'darius help'.`;
  return `darius: unknown command: ${name}. Did you mean: ${near.join(", ")}?`;
}

/**
 * The command line, with the JSON error contract around it (src/core/json-errors.ts):
 * with `--json` a failure that printed no JSON prints `{"ok":false,...}` on stdout.
 */
async function main(argv: string[]): Promise<number> {
  return withJsonErrors(wantsJson(argv), () => dispatch(argv));
}

async function dispatch(argv: string[]): Promise<number> {
  const first = argv[0];

  if (first === "--version" || first === "-v") {
    console.log(`darius ${VERSION} (${isBun ? "bun" : "node"})`);
    return 0;
  }

  const name = resolveCommandName(first);
  const owned = ownedKinds(argv, process.cwd());
  // A broken marker must never send a vigil write to the legacy writer.
  if (!owned.ok && name === "vigil" && argv[1] !== "sweep" && !wantsHelp(argv.slice(1))) {
    console.error(`darius: ${owned.error}`);
    return 1;
  }
  const kinds = owned.ok ? owned.kinds : DEFAULT_KINDS;
  const route = routeVerb(name, argv[1], (verb) => getCommand(verb) !== undefined, kinds);
  const command = getCommand(name);
  // --help prints the usage and does nothing else: no store, no tree, no link.
  if (name !== "help" && wantsHelp(argv.slice(1))) {
    if (route === "legacy") return runLegacy(argv);
    if (command !== undefined) {
      console.log(commandHelp(command));
      return 0;
    }
  }
  // `root` and `help` read only (`root` reports `linked`), so they never migrate.
  if (route !== "unknown" && name !== "root" && name !== "help") migrateTreeLink();
  if (route === "legacy") return runLegacyVerb(argv, owned);
  if (route === "unknown" || command === undefined) {
    console.error(unknownCommandMessage(name));
    return 2;
  }

  let args: ParsedArgs;
  try {
    args = parseArgs(argv.slice(1), command.flags);
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
  // A native verb may call into the vendored engine (the index, worklogs):
  // it gets the same store tree a legacy verb gets.
  applyEngineEnv(storeWhere(process.cwd()));

  try {
    return await command.run(args);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message.startsWith("usage: ") ? error.message : `darius: ${error.message}`);
      return 2;
    }
    console.error(`darius: ${errorMessage(error)}`);
    return 1;
  }
}

/**
 * Migration (0.78.0): a checkout from before 0.78.0 has a `.tracker` link
 * into the store. The next verb removes it (only a link into this project's
 * own store tree) and says so in one stderr line, never on stdout.
 */
function migrateTreeLink(): void {
  const notice = removeOwnTreeLink(process.cwd());
  if (notice !== null) console.error(notice);
}

/**
 * Legacy verbs that run as before when the store owns the tracker tree. The
 * hooks must stay fast and fail open; they read the tree the router hands
 * over (`DARIUS_TRACKER_ROOT`). The others read no tree, or only read it.
 */
const TREE_PLAIN_VERBS: ReadonlySet<string> = new Set(["hook-stop", "hook-drift", "delegation", "agents", "scan", "counsel-gate"]);
const TREE_HOOKS: ReadonlySet<string> = new Set(["hook-stop", "hook-drift"]);

/**
 * How a legacy verb meets the tracker tree. `where` is the store tree the
 * engine gets in its env (null: the engine walks up for a `.tracker/` folder).
 */
type TreeRoute =
  | { mode: "plain"; where: TrackerWhere | null }
  | { mode: "refuse"; message: string }
  | { mode: "tree"; project: Project; checkout: string; where: TrackerWhere };

/**
 * The tracker tree a legacy verb acts on. The marker found from the cwd
 * decides (src/core/tracker-root.ts). With `milestone` in its kinds the tree
 * is in the store, and the engine gets it through `DARIUS_TRACKER_ROOT`; the
 * checkout has no `.tracker` path. A broken marker stops every verb that may
 * write, so nothing writes a `.tracker/` the store may own.
 */
function treeRoute(verb: string, owned: OwnedKinds, cwd: string): TreeRoute {
  const plain = TREE_PLAIN_VERBS.has(verb);
  if (!owned.ok) return plain ? { mode: "plain", where: null } : { mode: "refuse", message: owned.error };
  try {
    const where = resolveTrackerRoot(cwd);
    if (where.mode !== "store") return { mode: "plain", where: null };
    if (TREE_HOOKS.has(verb)) {
      // A hook is fast and fails open: no sync, no store writes, only the tree's path.
      return { mode: "plain", where };
    }
    if (plain) return { mode: "plain", where };
    return { mode: "tree", project: openProject(where.project, { create: true }), checkout: where.checkout, where };
  } catch (cause) {
    return plain ? { mode: "plain", where: null } : { mode: "refuse", message: errorMessage(cause) };
  }
}

function noop(): void {}

/** The store-mode tree for `cwd`, or null (git mode, none, or a marker that does not parse). */
function storeWhere(cwd: string): TrackerWhere | null {
  try {
    const where = resolveTrackerRoot(cwd);
    return where.mode === "store" ? where : null;
  } catch {
    return null;
  }
}

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
 * Prepares the tree for a legacy verb: the tree dir, a capture and an apply,
 * the vigil files, and a missing `00-INDEX.md` (a host that got the tree by
 * sync has none). Returns the capture to run after the verb (once), or an
 * error message when the verb must not run.
 */
async function openTree(route: { project: Project }): Promise<{ finish: () => void } | { error: string }> {
  const { project } = route;
  try {
    ensureTreeDir(project);
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
 * After the legacy `doctor` (not `--quick`) on a tree in the store: the open
 * tree conflicts as warnings, each with the commands that end it
 * (src/core/tree-conflicts.ts). A warning never changes the exit code.
 */
function printTreeConflicts(project: Project): void {
  try {
    const open = readTreeConflicts(readLedger(project)).open;
    if (open.length === 0) return;
    const lines = ["", "## Tree conflicts", ""];
    for (const conflict of open) {
      const [first = "", ...rest] = conflictAdvice(conflict);
      lines.push(`  WARN: ${first}`, ...rest.map((line) => `    ${line}`));
    }
    process.stdout.write(`${lines.join("\n")}\n`);
  } catch (cause) {
    console.error(`darius: cannot read the tree conflicts: ${errorMessage(cause)}`);
  }
}

function isFullDoctor(argv: readonly string[]): boolean {
  return argv[0] === "doctor" && !argv.includes("--quick") && !argv.includes("--help") && !argv.includes("-h");
}

function printDoctorNotes(argv: readonly string[]): void {
  const notes = doctorNotes(process.cwd());
  if (notes.length === 0) return;
  if (argv.includes("--json")) {
    for (const note of notes) console.error(`darius: ${note}`);
    return;
  }
  process.stdout.write(`\n## Tracker location\n\n${notes.map((note) => `  ${note}`).join("\n")}\n`);
}

/**
 * A verb darius does not own: the legacy CLI gets the argv as given, and its
 * exit code passes through. When it fails and there is no `.tracker/` here
 * or above, one more stderr line names the fix. It hooks `exit` because a
 * legacy verb may end the process itself. `delegation` is a pure validator and
 * needs no `.tracker/`, so it never gets the line.
 *
 * When the store owns the tracker tree (`treeRoute`), the verb runs on the
 * store tree, which the engine gets in `DARIUS_TRACKER_ROOT` (the checkout
 * in `DARIUS_CHECKOUT_ROOT`): first the tree is captured and applied, then
 * the verb runs, then the change is captured, also when the verb ends the
 * process itself.
 */
async function runLegacyVerb(argv: string[], owned: OwnedKinds): Promise<number> {
  const route = treeRoute(argv[0] ?? "", owned, process.cwd());
  if (route.mode === "refuse") {
    console.error(`darius: ${route.message}`);
    return 1;
  }
  applyEngineEnv(route.where);
  let finish = noop;
  let doctorDone = false;
  const fullDoctor = isFullDoctor(argv);
  if (route.mode === "tree") {
    const opened = await openTree(route);
    if ("error" in opened) {
      console.error(`darius: ${opened.error}`);
      return 1;
    }
    const project = route.project;
    finish = fullDoctor
      ? (): void => {
          opened.finish();
          if (doctorDone) return;
          doctorDone = true;
          printTreeConflicts(project);
          printDoctorNotes(argv);
        }
      : opened.finish;
  } else if (fullDoctor) {
    finish = (): void => {
      if (doctorDone) return;
      doctorDone = true;
      printDoctorNotes(argv);
    };
  }
  const storeTree = route.where !== null;
  process.once("exit", (code) => {
    finish();
    if (code === 1 && !storeTree && argv[0] !== "delegation" && findTrackerDir(process.cwd()) === null) {
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
