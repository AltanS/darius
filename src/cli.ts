/**
 * The `darius` command line: the dispatcher.
 *
 * `--version` and bare `help` stay special-cased here -- the version line's
 * exact format (`darius <version> (<bun|node>)`) is a compatibility
 * contract with scripts/test.sh and the operator's scripts, not just a
 * command. Every other verb is a `Command` registered by a module under
 * src/cli/ (src/cli/commands.ts holds the fixed import list; a command
 * module calls `register()` once, at import time). Exit codes follow the
 * operator's probe contract: 0 ok, 1 refused or failed, 2 usage, 3
 * inconclusive environment.
 */

import { parseArgs, readStdin } from "./cli/args.ts";
import { registerCommands } from "./cli/commands.ts";
import { getCommand, listCommands, register, UsageError, type Command } from "./cli/registry.ts";
import { isInteractive } from "./cli/tui.ts";
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
  console.log("  darius <command>     run a registered command\n");
  console.log("Commands:");
  for (const entry of helpEntries()) {
    console.log(`  darius ${entry.name.padEnd(12)} ${entry.summary}`);
  }
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
  return first;
}

async function main(argv: string[]): Promise<number> {
  const first = argv[0];

  if (first === "--version" || first === "-v") {
    console.log(`darius ${VERSION} (${isBun ? "bun" : "node"})`);
    return 0;
  }

  const name = resolveCommandName(first);
  const command = getCommand(name);
  if (command === undefined) {
    console.error(`darius: unknown command '${name}'. Run 'darius help'.`);
    return 2;
  }

  const args = parseArgs(argv.slice(1));
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

process.exitCode = await main(process.argv.slice(2));
