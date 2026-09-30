/**
 * `darius tui`, and bare `darius` in a terminal: the Due and Run screens
 * (docs/concept.md, "App design" > "TUI"; src/tui/). Answer a held run and
 * resume it without leaving the terminal.
 *
 * It needs a terminal on both ends. Without one it refuses with exit 2
 * (usage): a script that wants the lists calls `darius due` or
 * `darius run list`, and bare `darius` in a pipe prints help (src/cli.ts).
 */

import { defaultDeps, runTui } from "../tui/app.ts";
import { UsageError, type Command } from "./registry.ts";

/** True when stdin and stdout are both terminals. */
export function isInteractive(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

export const tuiCommand: Command = {
  name: "tui",
  summary: "the Due and Run screens: answer held runs, resume them",
  async run(): Promise<number> {
    if (!isInteractive()) throw new UsageError("tui needs a terminal: stdin and stdout must both be a TTY");
    return runTui(defaultDeps());
  },
};
