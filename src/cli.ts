/**
 * The `darius` command line: the dispatcher.
 *
 * `--version` and bare `help` stay special-cased here -- the version line's
 * exact format (`darius <version> (<bun|node>)`) is a compatibility
 * contract with scripts/test.sh and the operator's scripts, not just a
 * command. Every other verb is a `Command` registered by a module under
 * src/cli/ (src/cli/commands.ts holds the fixed import list; a command
 * module calls `register()` once, at import time), or a verb of the vendored
 * legacy CLI: `routeVerb` in src/core/kinds.ts decides, and a legacy verb
 * gets the whole argv, its output and its exit code unchanged. Exit codes follow the
 * operator's probe contract: 0 ok, 1 refused or failed, 2 usage, 3
 * inconclusive environment.
 */

import { parseArgs, readStdin } from "./cli/args.ts";
import { registerCommands } from "./cli/commands.ts";
import { getCommand, listCommands, register, UsageError, type Command } from "./cli/registry.ts";
import { isInteractive } from "./cli/tui.ts";
import { DARIUS_KINDS, kindOfVerb, LEGACY_VERBS, routeVerb } from "./core/kinds.ts";
import { runLegacy } from "./core/legacy-entry.ts";
import { findTrackerDir, isUnlinkedTrackerRepo } from "./core/paths.ts";
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
  console.log("\nTracker verbs (milestones, specs, worklogs, vigils in .tracker/):");
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
  const route = routeVerb(name, argv[1], (verb) => getCommand(verb) !== undefined);
  if (route === "legacy") return runLegacyVerb(argv);
  const command = getCommand(name);
  if (route === "unknown" || command === undefined) {
    console.error(`darius: unknown command '${name}'. Run 'darius help'.`);
    return 2;
  }

  const args = parseArgs(argv.slice(1));
  const kind = kindOfVerb(name);
  const project = args.flags.project;
  const named = project !== undefined && project !== false && project !== true ? project : undefined;
  if (kind !== null && DARIUS_KINDS.has(kind) && isUnlinkedTrackerRepo(named, process.cwd())) {
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
 * A verb darius does not own: the legacy CLI gets the argv as given, and its
 * exit code passes through. When it fails and there is no `.tracker/` here
 * or above, one more stderr line names the fix. It hooks `exit` because a
 * legacy verb may end the process itself.
 */
async function runLegacyVerb(argv: string[]): Promise<number> {
  process.once("exit", (code) => {
    if (code !== 0 && findTrackerDir(process.cwd()) === null) {
      console.error("darius: no .tracker/ here or above. Run darius init in the repo root to create one.");
    }
  });
  try {
    return await runLegacy(argv);
  } catch (error) {
    console.error(`darius: ${errorMessage(error)}`);
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
