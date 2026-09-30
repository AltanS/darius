/**
 * The tool check before a run (docs/concept.md, "The unattended runner").
 * A ritual's `may` rules name the programs it needs: `Bash(pnpm cli *)`
 * needs `pnpm`. When one of them is not on the runner's PATH, every call to
 * it fails with exit 127 and the run is money spent on nothing (the first
 * timer run of `daily-report`, 2026-09-29). So run-due looks each one up
 * first and skips the ritual as `tool-missing` when one is not found.
 */

import { accessSync, constants, statSync } from "node:fs";
import { join } from "node:path";

/** Shell builtins and keywords: never on PATH, always there. */
const BUILTINS: ReadonlySet<string> = new Set([
  ".", ":", "[", "alias", "break", "builtin", "cd", "command", "continue", "declare", "echo", "eval", "exec", "exit",
  "export", "false", "for", "if", "local", "printf", "pwd", "read", "return", "set", "shift", "source", "test", "true",
  "type", "ulimit", "umask", "unset", "wait", "while",
]);

const BASH_RULE = /^Bash\((.*)\)$/su;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u;

/** The program a `Bash(...)` rule starts with, or null for other rules, builtins and patterns. */
function ruleTool(rule: string): string | null {
  const inner = BASH_RULE.exec(rule.trim())?.[1];
  if (inner === undefined) return null;
  const word = inner.trim().split(/\s+/u).find((token) => !ASSIGNMENT.test(token)) ?? "";
  if (word === "" || BUILTINS.has(word) || /[*?$`'"(){}<>|;&]/u.test(word)) return null;
  return word;
}

/** The programs `may` names, each once, in rule order. */
export function namedTools(may: readonly string[]): string[] {
  const tools = may.map((rule) => ruleTool(rule)).filter((tool) => tool !== null);
  return [...new Set(tools)];
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The tools of `may` that `envPath` does not find. A tool with a `/` is looked up as a path. */
export function missingTools(may: readonly string[], envPath: string, found: (path: string) => boolean = isExecutable): string[] {
  const dirs = envPath.split(":").filter((dir) => dir.startsWith("/"));
  return namedTools(may).filter((tool) => (tool.includes("/") ? !found(tool) : !dirs.some((dir) => found(join(dir, tool)))));
}
