/**
 * `darius skill [install|uninstall|hook]`: teach a Claude Code session darius
 * with one generated skill file (docs/concept.md, "Claude Code sessions and
 * skills").
 *
 *   darius skill              print the SKILL.md text (also `darius --skill`)
 *   darius skill install      write <claude>/skills/darius/SKILL.md and print its path.
 *                             <claude> is $CLAUDE_CONFIG_DIR, else ~/.claude.
 *                             No write when the text is the same. A file there
 *                             without a darius stamp is refused (exit 1).
 *   darius skill uninstall    remove a stamped file and its dir, when empty
 *   darius skill hook         print the SessionStart hook for settings.json;
 *                             the operator pastes it, darius never writes it
 *
 * The rules are static text; the verb table comes from the registry, only
 * commands marked `audience: "session"`. The last line is a stamp: the
 * version and the first 12 hex digits of the sha256 of everything above it.
 * `darius setup` refreshes a stamped file (`refreshSkill`), so `darius
 * update` keeps every host current. The text is capped at 4096 bytes.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { claudeDir } from "../core/paths.ts";
import { VERSION } from "../version.ts";
import { listCommands, UsageError, type Command, type ParsedArgs } from "./registry.ts";

export const SKILL_MAX_BYTES = 4096;
const STAMP = /^<!-- darius-skill (\S+) ([0-9a-f]{12}) -->$/mu;

/** What the skill needs from a command: the registry's own fields. */
export type SkillVerb = Pick<Command, "name" | "summary" | "audience" | "usage">;

const HEAD = `---
name: darius
description: Rituals and runs of darius, the project tracker CLI. Use for a ritual, a ritual run, or what is due in a project with a .darius.toml. The legacy tracker skills own milestones, specs, vigils and the rest for now.
---

# darius

darius owns rituals and runs. For anything else use the tracker skills.

## Rules

- Never edit darius store files (~/.local/share/darius) or any .tracker/ file. Change state with darius verbs only.
- Pass --json and read the one JSON object on stdout.
- Pass a ritual body over --stdin and run findings over --findings-stdin.
- Run darius inside the project checkout, or pass --project P.

## Exit codes

- 0: done.
- 1: refused or failed. Read stderr and the JSON, and act on them. Never fall back to editing files.
- 2: usage error. Fix the command line.
- 3: the environment is inconclusive. Stop and report to the operator.

## Verbs
`;

const TAIL = `
\`run now\` starts a ritual unattended in its own session and refuses a ritual with mode off. For that one, run \`run start\`, do the work, then \`run complete\`.

## Examples

What is due in this project:

    darius due --json

Start a run of a ritual by hand; the JSON holds the run id:

    darius run start weekly-report --json

Complete that run with its findings:

    darius run complete <run> --outcome complete --json --findings-stdin <<'EOF'
    ...findings...
    EOF
`;

function tableCell(text: string): string {
  return text.replaceAll("|", "\\|");
}

/** The SKILL.md text for these commands and this version. Pure. */
export function renderSkill(commands: readonly SkillVerb[], version: string = VERSION): string {
  const rows = commands
    .filter((command) => command.audience === "session")
    .map((command) => `| \`darius ${tableCell(command.usage ?? command.name)}\` | ${tableCell(command.summary)} |`);
  const body = `${HEAD}\n| Verb | What it does |\n| --- | --- |\n${rows.join("\n")}\n${TAIL}\n`;
  return `${body}${stampLine(body, version)}\n`;
}

function stampLine(body: string, version: string): string {
  const hash = createHash("sha256").update(body).digest("hex").slice(0, 12);
  return `<!-- darius-skill ${version} ${hash} -->`;
}

/** The stamp of a skill file's text, or null when it has none. */
export function readStamp(text: string): { version: string; hash: string } | null {
  const match = STAMP.exec(text);
  if (match === null) return null;
  const [, version, hash] = match;
  if (version === undefined || hash === undefined) return null;
  return { version, hash };
}

/** `<claude>/skills/darius/SKILL.md`. */
export function skillPath(dir: string = claudeDir()): string {
  return join(dir, "skills", "darius", "SKILL.md");
}

export type InstallResult = "written" | "unchanged" | "refused";

/** Writes `text` to `file`, unless the file is the same already or is not darius's (no stamp). */
export function installSkill(text: string, file: string): InstallResult {
  if (existsSync(file)) {
    const current = readFileSync(file, "utf8");
    if (readStamp(current) === null) return "refused";
    if (current === text) return "unchanged";
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return "written";
}

export type UninstallResult = "removed" | "absent" | "refused";

/** Removes a stamped skill file, and its dir when that is then empty. */
export function uninstallSkill(file: string): UninstallResult {
  if (!existsSync(file)) return "absent";
  if (readStamp(readFileSync(file, "utf8")) === null) return "refused";
  unlinkSync(file);
  const dir = dirname(file);
  if (readdirSync(dir).length === 0) rmdirSync(dir);
  return "removed";
}

/** One setup step's worth of news about the skill file. */
export interface RefreshResult {
  ok: true;
  skipped: boolean;
  detail: string;
}

/** What `darius setup` does with the skill: refresh a stamped file, touch nothing else. */
export function refreshSkill(text: string, file: string): RefreshResult {
  if (!existsSync(file)) return { ok: true, skipped: true, detail: "not installed (darius skill install)" };
  if (readStamp(readFileSync(file, "utf8")) === null) {
    return { ok: true, skipped: true, detail: `${file} has no darius stamp; left alone` };
  }
  return installSkill(text, file) === "written"
    ? { ok: true, skipped: false, detail: `refreshed ${file}` }
    : { ok: true, skipped: true, detail: `${file} is current` };
}

export const HOOK_COMMAND = "command -v darius >/dev/null 2>&1 && darius due --brief || true";

/** The SessionStart snippet for Claude Code's settings.json. */
export function hookSnippet(): string {
  const snippet = { hooks: { SessionStart: [{ hooks: [{ type: "command", command: HOOK_COMMAND, timeout: 5 }] }] } };
  return JSON.stringify(snippet, null, 2);
}

function currentSkill(): string {
  return renderSkill(listCommands());
}

function install(args: ParsedArgs): number {
  const file = skillPath();
  const result = installSkill(currentSkill(), file);
  if (args.json) {
    console.log(JSON.stringify({ ok: result !== "refused", path: file, result }));
  } else if (result === "refused") {
    console.error(`darius: ${file} exists and has no darius stamp; move it away first`);
  } else {
    console.log(file);
  }
  return result === "refused" ? 1 : 0;
}

function uninstall(args: ParsedArgs): number {
  const file = skillPath();
  const result = uninstallSkill(file);
  if (args.json) {
    console.log(JSON.stringify({ ok: result !== "refused", path: file, result }));
  } else if (result === "refused") {
    console.error(`darius: ${file} has no darius stamp; left alone`);
  } else {
    console.log(result === "removed" ? `removed ${file}` : `no skill at ${file}`);
  }
  return result === "refused" ? 1 : 0;
}

export const skillCommand: Command = {
  name: "skill",
  summary: "print the Claude Code skill for darius; install | uninstall it; hook prints a SessionStart hook",
  async run(args: ParsedArgs): Promise<number> {
    const verb = args.positional[0];
    switch (verb) {
      case undefined:
        process.stdout.write(currentSkill());
        return 0;
      case "install":
        return install(args);
      case "uninstall":
        return uninstall(args);
      case "hook":
        console.log(hookSnippet());
        return 0;
      default:
        throw new UsageError("skill takes no verb, or install | uninstall | hook");
    }
  },
};
