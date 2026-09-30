/**
 * Turns `argv` (already stripped of the top-level command name) into a
 * `ParsedArgs`. Supported syntax:
 *
 *   --flag value      value is the next token, UNLESS the flag is in
 *                      BOOLEAN_FLAGS, or the next token starts with "--" or
 *                      is the "--" terminator -- write --flag=value instead
 *                      when a valued flag must be followed by a flag-looking
 *                      positional argument.
 *   --flag=value      always a value, whatever it looks like.
 *   --flag            a boolean flag: true, when no value form matched.
 *   --question a --question b
 *                      both values are kept, in order, in `repeated.question`;
 *                      `flags.question` holds only the last one ("b").
 *   --                everything after this token is positional, even a
 *                      token that looks like a flag.
 *
 * Reading stdin is a separate step (`readStdin`) so `parseArgs` itself stays
 * synchronous and side-effect free -- src/cli.ts calls `readStdin()` only
 * when the parsed flags say `--stdin` was given, so a command that never
 * asks for it never blocks on a caller who did not intend to pipe anything.
 */

import { readFileSync } from "node:fs";

import type { ParsedArgs } from "./registry.ts";

/**
 * Flags that never take a value. Without this list `darius import --json
 * /path/.tracker` would bind the path to `json` and drop the positional, and
 * the heuristic above cannot tell the two apart. A new boolean flag joins
 * this list in the same change that introduces it.
 */
const BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  "json",
  "stdin",
  "findings-stdin",
  "output-stdin",
  "dry-run",
  "all-projects",
  "include-heavy",
  "classify-only",
  "unattended",
  "open",
  "heavy",
  "remote",
  "systemd",
  "pull-only",
  "preflight",
  "check",
  "major",
  "help",
]);

function looksLikeFlag(token: string): boolean {
  return token.startsWith("--") && token.length > 2;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const repeated: Record<string, string[]> = {};
  let flagsEnded = false;

  const setValue = (name: string, value: string): void => {
    flags[name] = value;
    (repeated[name] ??= []).push(value);
  };

  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (token === undefined) break;

    if (!flagsEnded && token === "--") {
      flagsEnded = true;
      index += 1;
      continue;
    }

    if (flagsEnded || !looksLikeFlag(token)) {
      positional.push(token);
      index += 1;
      continue;
    }

    const body = token.slice(2);
    const equalsAt = body.indexOf("=");
    if (equalsAt >= 0) {
      setValue(body.slice(0, equalsAt), body.slice(equalsAt + 1));
      index += 1;
      continue;
    }

    const next = argv[index + 1];
    if (!BOOLEAN_FLAGS.has(body) && next !== undefined && next !== "--" && !looksLikeFlag(next)) {
      setValue(body, next);
      index += 2;
      continue;
    }

    flags[body] = true;
    index += 1;
  }

  return { positional, flags, json: flags.json === true, repeated };
}

/**
 * Reads all of stdin, blocking until EOF. Only called when `--stdin` was
 * given (src/cli.ts checks the parsed flag first), so a command that never
 * asks for stdin never waits on a caller who piped nothing in.
 */
export function readStdin(): string {
  return readFileSync(0, "utf8");
}
