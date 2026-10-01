/**
 * Turns `argv` (already stripped of the top-level command name) into a
 * `ParsedArgs`. Supported syntax:
 *
 *   --flag value      value is the next token, whatever it looks like
 *                      (`--hold '--confirm\b'` holds `--confirm\b`),
 *                      UNLESS the flag is in BOOLEAN_FLAGS. A valued flag
 *                      with no token after it is a UsageError (0.42.3:
 *                      before, a value starting with "--" was dropped
 *                      silently and the flag read as true).
 *   --flag=value      always a value, whatever it looks like.
 *   --flag            a flag in BOOLEAN_FLAGS: true.
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

import { UsageError } from "../core/model.ts";
import type { ParsedArgs } from "./registry.ts";

/**
 * Flags that never take a value. Without this list `darius import --json
 * /path/.tracker` would bind the path to `json` and drop the positional.
 * Every flag not listed here takes the next token as its value. A new
 * boolean flag joins this list in the same change that introduces it.
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
  "keep-stopped",
  "pull-only",
  "preflight",
  "check",
  "major",
  "help",
  "brief",
  "no-import",
  "force",
  "list",
  "daily",
  "headless",
  "banner",
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

    if (BOOLEAN_FLAGS.has(body)) {
      flags[body] = true;
      index += 1;
      continue;
    }

    const next = argv[index + 1];
    if (next === undefined) throw new UsageError(`--${body} needs a value`);
    setValue(body, next);
    index += 2;
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
