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
 *   darius skill status       exit 0 and print the path when a stamped skill
 *                             teaches sessions here (user-level, or an installed
 *                             plugin's skills/darius/SKILL.md), else exit 1
 *   darius skill hook         print the SessionStart hook for settings.json;
 *                             the operator pastes it, darius never writes it
 *
 * The rules are static text; the verb table comes from the registry, only
 * commands marked `audience: "session"`. The last line is a stamp: the
 * version and the first 12 hex digits of the sha256 of everything above it.
 * `darius setup` refreshes a stamped file (`refreshSkill`), so `darius
 * update` keeps every host current. The text is capped at 6144 bytes.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { JsonValue } from "../core/model.ts";
import { claudeDir } from "../core/paths.ts";
import { VERSION } from "../version.ts";
import { listCommands, UsageError, type Command, type ParsedArgs } from "./registry.ts";

export const SKILL_MAX_BYTES = 6144;
const STAMP = /^<!-- darius-skill (\S+) ([0-9a-f]{12}) -->$/mu;

/** What the skill needs from a command: the registry's own fields. */
export type SkillVerb = Pick<Command, "name" | "summary" | "audience" | "usage">;

/**
 * The tracker verbs, one group per line. Every verb named here is in
 * `LEGACY_VERBS` (src/core/kinds.ts); a test holds that true.
 */
export const TRACKER_VERB_GROUPS: readonly (readonly [string, string])[] = [
  ["Read", "`status`, `list milestones|specs`, `show <spec>`, `next`, `root`"],
  ["Plan", "`add milestone|spec`, `mark <spec> <idx> --verified|--in-progress|--blocked|--skipped|--pending`, `set-status`, `index --rebuild`"],
  ["Verify", "`verify <spec>`, `verify-item <spec> <idx>`, `archive-check`, `uncommitted-verified`"],
  ["Worklogs", "`worklog open|append|close|list|set-stage|dispatch|park|distill|index`"],
  ["Sessions", "`claim`, `release`, `loop-check`, `counsel-gate`, `agents`"],
  ["Vigils", "`vigil add|list|set-body|close`"],
  ["Health", "`doctor [--fix]`, `migrate`, `scan artifacts|stubs <path>`"],
];

const HEAD = `---
name: darius
description: darius, the one project tracker CLI. Use for milestones, specs, tasks, worklogs, vigils, rituals, runs, or what is next or due in a repo with a .tracker/ or a .darius.toml.
---

# darius

darius owns every tracker verb. Rituals and runs live in the darius store; milestones, specs, worklogs and vigils live in .tracker/ and darius writes them.

## Rules

- Never edit darius store files (~/.local/share/darius). Change rituals and runs with darius verbs only.
- In .tracker/, use a darius verb wherever one exists: task marks, statuses, the index, worklogs, vigils. Write spec text by hand.
- Run darius inside the repo. A repo without .darius.toml or .tracker/ needs \`darius init\` first; darius says so.
- Pass --json where a verb takes it, and read the JSON on stdout.
- In a v3 project rituals are defined in .darius.toml: edit it and commit, then \`ritual reconcile\`. \`ritual set\` changes only host, owner, tags and due.
- Pass a ritual or vigil body over --stdin and run findings over --findings-stdin.
- A tracker verb with no arguments prints its usage.

## Prose

Applies to worklog entries, findings, handoff and vigil bodies.

- Short sentences. Facts, not narrative. One line per item.
- Name the thing, its state, the next step. No preamble, no recap.
- An entry says what changed, what is left, one blocker. At most 8 lines.
- Findings: at most 4000 characters. The result block holds the items.

## Exit codes

- 0: done.
- 1: refused or failed. Tracker verbs also exit 1 on a usage error. Read stderr and act on it. Never fall back to editing files.
- 2: usage error. Fix the command line.
- 3: the environment is inconclusive. Stop and report to the operator.

## Verbs
`;

function trackerVerbs(): string {
  const lines = TRACKER_VERB_GROUPS.map(([group, verbs]) => `- ${group}: ${verbs}`);
  return `\nTracker verbs, on .tracker/ (each is \`darius <verb>\`):\n\n${lines.join("\n")}\n`;
}

const TAIL = `
\`run now\` starts a ritual unattended in its own session and refuses a ritual with mode off. For that one, run \`run start\`, do the work, then \`run complete\`.
\`run follow-up <run> --approve N\` is for a person: a new attended run that may run the command lines of question N as written.
On the wrong host \`run now\`, \`run resume\` and \`run follow-up\` refuse and print the \`ssh <host> darius ...\` command for the right one; a person may add \`--on <host>\`, a run never does.

## Backups

A snapshot is a dated tar.gz of this host's darius store, in a local folder and optionally in an S3 bucket. Each host backs up its own store.

- Read: \`snapshot status\` (settings, timer, last run), \`snapshot list [--remote]\`, \`snapshot config\`, \`snapshot credentials\`.
- Act: \`snapshot create\` makes one now. \`snapshot check\` tests the bucket.
- Settings: \`snapshot config set <key> <value>\`, \`snapshot config unset <key>\`. Set \`endpoint\` and \`bucket\` in one call.
- Key pair: \`printf %s "$SECRET" | darius snapshot credentials set --key-id ID\`. The secret comes on stdin only. \`snapshot credentials clear\` removes it.
- Never put the secret in a command line, a flag, or a file in the repo.
- Exit 1: refused, for example a key the environment sets. Exit 2: an unknown key, or a secret on a terminal. Exit 3: the bucket could not be reached; the local snapshot is fine.
- Restore is by hand with \`tar -xzf\`, and only when the operator asks.

## Examples

The next open task, and the rituals due:

    darius next
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
  const body = `${HEAD}\n| Verb | What it does |\n| --- | --- |\n${rows.join("\n")}\n${trackerVerbs()}${TAIL}\n`;
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

function isRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

/** True when `file` exists and carries a darius stamp. */
function isStamped(file: string): boolean {
  return existsSync(file) && readStamp(readFileSync(file, "utf8")) !== null;
}

/**
 * The stamped `skills/darius/SKILL.md` of a Claude Code plugin installed
 * under `<claude>/plugins` (its `installed_plugins.json`), or null. Where a
 * plugin ships the skill, the plugin teaches darius and `darius skill
 * install` is not needed.
 */
export function findPluginSkill(dir: string = claudeDir()): string | null {
  const file = join(dir, "plugins", "installed_plugins.json");
  if (!existsSync(file)) return null;
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const { plugins } = parsed;
  if (plugins === undefined || !isRecord(plugins)) return null;
  for (const installs of Object.values(plugins)) {
    if (!Array.isArray(installs)) continue;
    for (const entry of installs) {
      if (!isRecord(entry) || !isText(entry.installPath)) continue;
      const skill = join(entry.installPath, "skills", "darius", "SKILL.md");
      if (isStamped(skill)) return skill;
    }
  }
  return null;
}

/** Where a Claude Code session on this host learns darius: the user-level file, a plugin's, or nowhere. */
export function skillSource(dir: string = claudeDir()): { kind: "user" | "plugin"; path: string } | null {
  const user = skillPath(dir);
  if (isStamped(user)) return { kind: "user", path: user };
  const plugin = findPluginSkill(dir);
  return plugin === null ? null : { kind: "plugin", path: plugin };
}

/** One setup step's worth of news about the skill file. */
export interface RefreshResult {
  ok: true;
  skipped: boolean;
  detail: string;
}

/** What `darius setup` does with the skill: refresh a stamped file, touch nothing else. */
export function refreshSkill(text: string, file: string, plugin: string | null = null): RefreshResult {
  if (!existsSync(file)) {
    return plugin === null
      ? { ok: true, skipped: true, detail: "not installed. To teach Claude Code sessions darius: darius skill install" }
      : { ok: true, skipped: true, detail: `a plugin teaches Claude Code sessions darius (${plugin}); nothing to install` };
  }
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

/** `darius skill status`: exit 0 and the path when a session learns darius here, else exit 1 and the fix. */
function status(args: ParsedArgs): number {
  const source = skillSource();
  if (args.json) {
    console.log(JSON.stringify({ ok: source !== null, source: source?.kind ?? null, path: source?.path ?? null }));
  } else if (source === null) {
    console.log("no darius skill on this host. To teach Claude Code sessions darius: darius skill install");
  } else {
    console.log(`${source.kind === "user" ? "installed" : "from a plugin"}: ${source.path}`);
  }
  return source === null ? 1 : 0;
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
  summary: "print the Claude Code skill for darius; install | uninstall it; status says where sessions learn it; hook prints a SessionStart hook",
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
      case "status":
        return status(args);
      case "hook":
        console.log(hookSnippet());
        return 0;
      default:
        throw new UsageError("skill takes no verb, or install | uninstall | status | hook");
    }
  },
};
