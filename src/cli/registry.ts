/**
 * The CLI kernel every command module shares: the argument shape a command's
 * `run()` receives, the command contract, the registry command modules join
 * by calling `register()` at import time, and the one error type a command
 * throws to signal a usage mistake instead of a failure.
 *
 * src/cli/commands.ts imports every command module for its side effects;
 * src/cli.ts looks commands up here and dispatches into them. See
 * docs/plan-tonight.md, "Module contracts", for the contract this file
 * implements.
 */

/**
 * What a parsed command line hands to a command's `run()`.
 *
 * `repeated` is the one addition to the plan's contract (see src/cli/args.ts
 * for where it is filled in): a flag given more than once
 * (`--question a --question b`) can only keep its last value in `flags` (a
 * plain object holds one value per key), so a command that needs every
 * occurrence reads `repeated.question` instead. Boolean flags are not
 * collected here -- repeating one carries no extra information over setting
 * it once.
 */
export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
  json: boolean;
  stdin?: string;
  repeated: Record<string, string[]>;
}

/** A command registered under one top-level verb, e.g. `darius ritual ...`. */
export interface Command {
  name: string;
  summary: string;
  /**
   * `"session"`: a working Claude Code session needs this verb, so
   * `darius skill` lists it (src/cli/skill.ts). Absent: hidden from the
   * skill. `darius help` lists every command either way.
   */
  audience?: "session";
  /** The verb's shape for the skill's table, e.g. `run start|complete <run>`. Defaults to the name. */
  usage?: string;
  /**
   * The full usage text `darius <name> --help` prints (stdout, exit 0).
   * Absent: `usage: darius <usage or name>` and the summary.
   */
  help?: string;
  /**
   * Every flag the command reads, without the dashes. Present: an unknown
   * flag is a usage error (exit 2, "unknown option --x") before the command
   * runs. Absent: no check. `json`, `help`, `stdin` and `project` are always
   * accepted (src/cli/args.ts, `GLOBAL_FLAGS`).
   */
  flags?: readonly string[];
  run(args: ParsedArgs): Promise<number>;
}

/**
 * The caller passed something this CLI cannot act on: an unknown verb, a
 * missing required flag, a malformed value. A command throws this instead of
 * returning a boolean or an ad hoc error, and the dispatcher in src/cli.ts
 * maps it to exit 2 -- the probe contract's "the caller is wrong", never 1
 * ("the work failed").
 */
export { NotFoundError, UsageError } from "../core/model.ts";

const commands = new Map<string, Command>();

/** Called once per command module, at import time, to join the registry. */
export function register(command: Command): void {
  if (commands.has(command.name)) {
    throw new Error(`darius: command "${command.name}" registered twice`);
  }
  commands.set(command.name, command);
}

/** The text `darius <command> --help` prints. */
export function commandHelp(command: Command): string {
  if (command.help !== undefined) return command.help;
  return `usage: darius ${command.usage ?? command.name}\n${command.summary}`;
}

/** Looks up a registered command by its exact top-level name. */
export function getCommand(name: string): Command | undefined {
  return commands.get(name);
}

/** Every registered command, sorted by name -- what `help` lists. */
export function listCommands(): Command[] {
  return [...commands.values()].toSorted((a, b) => a.name.localeCompare(b.name));
}
