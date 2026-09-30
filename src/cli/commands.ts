/**
 * The fixed list of command modules wired into the CLI.
 *
 * Every command module (src/cli/<name>.ts) EXPORTS its `Command` objects and
 * never registers itself. This file imports them and registers each one, in
 * one place. A bare side-effect import would fail oxlint's
 * import/no-unassigned-import, and a module that registers itself at import
 * time is registered twice the moment a test imports it too.
 *
 * Add a command: export it from its module, import it here, add it to
 * COMMANDS.
 */

import { register, type Command } from "./registry.ts";
import { dueCommand } from "./due.ts";
import { harnessCommand } from "./harness.ts";
import { importCommand } from "./import.ts";
import { linkCommand } from "./link.ts";
import { policyCheckCommand } from "./policy-check.ts";
import { profileCommand } from "./profile.ts";
import { pushCommand } from "./push.ts";
import { ritualCommand } from "./ritual.ts";
import { runCommand } from "./run.ts";
import { runDueCommand } from "./run-due.ts";
import { selftestCommand } from "./selftest.ts";
import { serveCommand } from "./serve.ts";
import { setupCommand } from "./setup.ts";
import { skillCommand } from "./skill.ts";
import { syncCommand } from "./sync.ts";
import { tuiCommand } from "./tui.ts";
import { updateCommand } from "./update.ts";
import { vigilCommand } from "./vigil.ts";

const COMMANDS: readonly Command[] = [
  dueCommand,
  harnessCommand,
  importCommand,
  linkCommand,
  policyCheckCommand,
  profileCommand,
  pushCommand,
  ritualCommand,
  runCommand,
  runDueCommand,
  selftestCommand,
  serveCommand,
  setupCommand,
  skillCommand,
  syncCommand,
  tuiCommand,
  updateCommand,
  vigilCommand,
];

/** Registers every command above. src/cli.ts calls this once, at startup. */
export function registerCommands(): void {
  for (const command of COMMANDS) register(command);
}
