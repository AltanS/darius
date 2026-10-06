/**
 * `darius skill [install|uninstall|status|hook]`: teach a Claude Code session
 * darius with one generated skill file, 11 static procedure skills and the
 * darius agent (docs/concept.md, "Claude Code sessions and skills").
 *
 *   darius skill              print the generated SKILL.md text (also `darius --skill`)
 *   darius skill install      write 13 stamped files under <claude>, which is
 *                             $CLAUDE_CONFIG_DIR, else ~/.claude:
 *                               skills/darius/SKILL.md          generated
 *                               skills/darius-<name>/SKILL.md   11 procedure skills
 *                               agents/darius.md                the darius agent
 *                             The static text lives in `skills/` of this repo
 *                             (see skills/README.md). No write when a file is
 *                             the same. A file there without a darius stamp is
 *                             refused (exit 1); the others are still written.
 *   darius skill uninstall    remove every stamped file, and its dir when empty
 *                             (never the `agents` dir)
 *   darius skill status       one line per file: ok, outdated (older stamped
 *                             text), edited (the body no longer matches its
 *                             stamp), unstamped or missing; then one line per
 *                             hook in <claude>/settings.json: ok, differs,
 *                             missing or unreadable (read-only). Exit 0 when the
 *                             generated skill teaches sessions here (user-level,
 *                             or an installed plugin's skills/darius/SKILL.md),
 *                             else exit 1; hooks never change the exit code.
 *                             --json prints one array with both kinds of entry.
 *   darius skill hook         print the SessionStart, Stop and PostToolUse hooks
 *                             for settings.json; the operator pastes them,
 *                             darius never writes settings.json
 *
 * The generated rules are static text; the verb table comes from the registry,
 * only commands marked `audience: "session"`. The last line of every file is a
 * stamp: the version and the first 12 hex digits of the sha256 of everything
 * above it. `darius setup` refreshes every stamped file of the set
 * (`refreshSkillFiles`), so `darius update` keeps every host current. When the
 * generated skill is installed at user level and stamped (the operator opted
 * in), setup also installs any file of the set that is missing, such as a
 * procedure skill a new release adds. With no such skill, setup installs
 * nothing. Only the generated text is capped, at 6144 bytes.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
  ["Vigils", "`vigil add|list|set-body|set|close`"],
  ["Hooks", "`hook-stop`, `hook-drift`, `delegation validate|return-validate <json>`"],
  ["Health", "`doctor [--fix]`, `migrate`, `scan artifacts|stubs <path>`"],
];

const HEAD = `---
name: darius
description: darius, the one project tracker CLI. Use for milestones, specs, tasks, worklogs, vigils, rituals, runs, or what is next or due in a repo with a .tracker/ or a .darius.toml.
---

# darius

darius owns every tracker verb. Rituals and runs live in the darius store; the rest is in the store or git, as \`kinds\` in .darius.toml says.

## Rules

- Never edit darius store files (~/.local/share/darius). Use darius verbs.
- \`kinds\` in .darius.toml says what the store owns (default: rituals only). With \`vigil\`, vigils are store items; imported open ones are heavy (the sweep skips them) until \`vigil set <slug> --no-heavy\`. With \`milestone\`, the tracker tree is in the store and .tracker/ in the checkout is a link to it; nothing under it is in git, so never \`git add\` it.
- A real .tracker/ folder in git is moved by \`darius onboard\`: run \`onboard scan\` first, and \`onboard\` only when the operator asks.
- In .tracker/, use a darius verb wherever one exists: task marks, statuses, the index, worklogs, vigils. Write spec text by hand.
- Run darius inside the repo. A repo without .darius.toml or .tracker/ needs \`darius init\` first; darius says so.
- In a v3 project rituals are defined in .darius.toml: edit it and commit, then \`ritual reconcile\`. \`ritual set\` changes only host, owner, tags and due. Add to a policy with \`may_extra\` and \`hold_extra\`; \`marker check --resolved <slug>\` prints the effective policy. Pass input to the skill with \`args\` (one line); procedure belongs in the skill.
- Pass --json where a verb takes it and read stdout. Pass a ritual or vigil body over --stdin and run findings over --findings-stdin.
- A tracker verb with no arguments prints its usage.

## Prose

For worklog entries, findings, handoff and vigil bodies.

- Short sentences. Facts, not narrative. One line per item.
- Name the thing, its state, the next step. No recap. At most 8 lines per entry.
- Findings: at most 4000 characters. The result block holds the items.

## Exit codes

- 0: done.
- 1: refused or failed. Tracker verbs also exit 1 on a usage error. Read stderr. Never fall back to editing files.
- 2: usage error. Fix the command line.
- 3: the environment is inconclusive. Stop and report to the operator.

## Verbs
`;

function trackerVerbs(): string {
  const lines = TRACKER_VERB_GROUPS.map(([group, verbs]) => `- ${group}: ${verbs}`);
  return `\nTracker verbs, on .tracker/ (each is \`darius <verb>\`):\n\n${lines.join("\n")}\n`;
}

const TAIL = `
\`run now\` starts a ritual unattended in its own session and refuses mode off. For that one, run \`run start\`, do the work, then \`run complete\`.
\`run follow-up <run> --approve N|--item KEY\` is for a person: a new run that runs the lines of question N as written, or the proposal of item KEY.
Findings are items a ritual reports with a \`key\`. \`finding list|show\` read them; \`finding close|reopen <key>\` and \`finding reset\` are for a person.
On the wrong host \`run now\`, \`run resume\` and \`run follow-up\` refuse and print the \`ssh <host> darius ...\` command for the right one; a person may add \`--on <host>\`, a run never does.

## Backups

A snapshot is a dated tar.gz of this host's store, in a local folder and optionally an S3 bucket.

- Read: \`snapshot status\`, \`snapshot list [--remote]\`, \`snapshot config\`, \`snapshot credentials\`.
- Act: \`snapshot create\` makes one now. \`snapshot check\` tests the bucket.
- Settings: \`snapshot config set <key> <value>\`, \`snapshot config unset <key>\`. Set \`endpoint\` and \`bucket\` in one call.
- Key pair: \`printf %s "$SECRET" | darius snapshot credentials set --key-id ID\`. The secret comes on stdin only. \`snapshot credentials clear\` removes it.
- Never put the secret in a command line, a flag, or a file in the repo.
- Exit 1: refused. Exit 2: an unknown key, or a secret on a terminal. Exit 3: the bucket could not be reached; the local snapshot is fine.
- Restore is by hand with \`tar -xzf\`, and only when the operator asks.

## Examples

The next task, and rituals due:

    darius next
    darius due --json

Start a run by hand, then complete it with its findings:

    darius run start weekly-report --json
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

/** `body` with its stamp as the last line. A body without a final newline gets one first. */
export function stampText(body: string, version: string = VERSION): string {
  const text = body.endsWith("\n") ? body : `${body}\n`;
  return `${text}${stampLine(text, version)}\n`;
}

/** The stamp of a skill file's text, or null when it has none. */
export function readStamp(text: string): { version: string; hash: string } | null {
  const match = STAMP.exec(text);
  if (match === null) return null;
  const [, version, hash] = match;
  if (version === undefined || hash === undefined) return null;
  return { version, hash };
}

/** True when the hash in the stamp is the hash of the text above it. False for an unstamped text. */
export function stampMatchesBody(text: string): boolean {
  const match = STAMP.exec(text);
  const hash = match?.[2];
  if (match === null || hash === undefined) return false;
  return createHash("sha256").update(text.slice(0, match.index)).digest("hex").slice(0, 12) === hash;
}

/** `<claude>/skills/darius/SKILL.md`. */
export function skillPath(dir: string = claudeDir()): string {
  return join(dir, "skills", "darius", "SKILL.md");
}

/** The 11 procedure skills of the tracker plugin. Each is `skills/<name>.md` in this repo. */
export const PROCEDURE_SKILLS: readonly string[] = [
  "work",
  "work-plan",
  "work-verify",
  "commit",
  "sync",
  "archive",
  "wrap-up",
  "enrich",
  "dream",
  "worklog",
  "structural-review",
];

/** The agent's static text is `skills/agent-darius.md`. */
const AGENT_SOURCE = "agent-darius";

/** The static skill text: `skills/` at the root of this checkout or install, found from this module. */
export function skillSourceDir(): string {
  return fileURLToPath(new URL("../../skills/", import.meta.url));
}

/** One file darius keeps under `<claude>`: its name, where it goes and the stamped text it should hold. */
export interface ManagedFile {
  /** `darius`, `darius-work`, ..., or `agent darius`. */
  name: string;
  path: string;
  text: string;
  /** False for the agent, whose parent dir is Claude Code's own and never removed. */
  ownsDir: boolean;
}

/**
 * The 13 files of the set, in order: the generated skill, the 11 procedure
 * skills, the agent. Throws when a static source file is missing.
 */
export function managedFiles(
  commands: readonly SkillVerb[] = listCommands(),
  dir: string = claudeDir(),
  version: string = VERSION,
  sourceDir: string = skillSourceDir(),
): ManagedFile[] {
  const files: ManagedFile[] = [
    { name: "darius", path: skillPath(dir), text: renderSkill(commands, version), ownsDir: true },
  ];
  for (const slug of PROCEDURE_SKILLS) {
    files.push({
      name: `darius-${slug}`,
      path: join(dir, "skills", `darius-${slug}`, "SKILL.md"),
      text: stampText(readFileSync(join(sourceDir, `${slug}.md`), "utf8"), version),
      ownsDir: true,
    });
  }
  files.push({
    name: "agent darius",
    path: join(dir, "agents", "darius.md"),
    text: stampText(readFileSync(join(sourceDir, `${AGENT_SOURCE}.md`), "utf8"), version),
    ownsDir: false,
  });
  return files;
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

/** Removes a stamped skill file, and its dir when that is then empty (`removeDir`, on by default). */
export function uninstallSkill(file: string, removeDir: boolean = true): UninstallResult {
  if (!existsSync(file)) return "absent";
  if (readStamp(readFileSync(file, "utf8")) === null) return "refused";
  unlinkSync(file);
  const dir = dirname(file);
  if (removeDir && readdirSync(dir).length === 0) rmdirSync(dir);
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

/**
 * What `darius setup` does with the whole set: refresh every stamped file
 * whose text changed, leave an unstamped file alone. When the generated skill
 * is installed at user level and stamped (the operator opted in), a file of
 * the set that is missing is installed too. Otherwise nothing new is
 * installed. The generated skill keeps its own messages (not installed, a
 * plugin teaches it, no stamp). The detail lists installed and refreshed paths
 * separately.
 */
export function refreshSkillFiles(files: readonly ManagedFile[], plugin: string | null = null): RefreshResult {
  const [generated, ...rest] = files;
  if (generated === undefined) return { ok: true, skipped: true, detail: "no skill files" };
  const optedIn = isStamped(generated.path);
  const first = refreshSkill(generated.text, generated.path, plugin);
  const written: string[] = first.skipped ? [] : [generated.path];
  const installed: string[] = [];
  const notes: string[] = [];
  for (const file of rest) {
    if (!existsSync(file.path)) {
      if (optedIn && installSkill(file.text, file.path) === "written") installed.push(file.path);
      continue;
    }
    if (readStamp(readFileSync(file.path, "utf8")) === null) {
      notes.push(`${file.path} has no darius stamp; left alone`);
      continue;
    }
    if (installSkill(file.text, file.path) === "written") written.push(file.path);
  }
  const parts: string[] = [];
  if (installed.length > 0) parts.push(`installed ${installed.join(", ")}`);
  if (written.length > 0) parts.push(`refreshed ${written.join(", ")}`);
  if (parts.length === 0) return notes.length === 0 ? first : { ...first, detail: `${first.detail}; ${notes.join("; ")}` };
  return { ok: true, skipped: false, detail: [...parts, ...notes].join("; ") };
}

export const HOOK_COMMAND = "command -v darius >/dev/null 2>&1 && darius due --brief || true";
export const HOOK_STOP_COMMAND = "command -v darius >/dev/null 2>&1 && darius hook-stop || true";
export const HOOK_DRIFT_COMMAND = "command -v darius >/dev/null 2>&1 && darius hook-drift || true";

/** The SessionStart, Stop and PostToolUse snippet for Claude Code's settings.json. */
export function hookSnippet(): string {
  const snippet = {
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: HOOK_COMMAND, timeout: 5 }] }],
      Stop: [{ hooks: [{ type: "command", command: HOOK_STOP_COMMAND, timeout: 15 }] }],
      PostToolUse: [{ matcher: "Edit|Write|MultiEdit", hooks: [{ type: "command", command: HOOK_DRIFT_COMMAND, timeout: 10 }] }],
    },
  };
  return JSON.stringify(snippet, null, 2);
}

/** The state of one hook in settings.json. */
export type HookState = "ok" | "differs" | "missing" | "unreadable";

/** One hook darius suggests: its event, command, the verb that marks a variant of it, and the tools its matcher must cover. */
interface HookSpec {
  event: "SessionStart" | "Stop" | "PostToolUse";
  command: string;
  verb: string;
  tools: readonly string[];
}

const HOOK_SPECS: readonly HookSpec[] = [
  { event: "SessionStart", command: HOOK_COMMAND, verb: "darius due", tools: [] },
  { event: "Stop", command: HOOK_STOP_COMMAND, verb: "darius hook-stop", tools: [] },
  { event: "PostToolUse", command: HOOK_DRIFT_COMMAND, verb: "darius hook-drift", tools: ["Edit", "Write"] },
];

/** The state of one hook, read from the parsed `hooks` table of settings.json. */
function hookEntryState(spec: HookSpec, hooks: JsonValue | undefined): HookState {
  const groups = hooks !== undefined && isRecord(hooks) ? hooks[spec.event] : undefined;
  if (!Array.isArray(groups)) return "missing";
  let differs = false;
  for (const group of groups) {
    if (!isRecord(group) || !Array.isArray(group.hooks)) continue;
    const matcher = isText(group.matcher) ? group.matcher : "";
    const covers = spec.tools.every((tool) => matcher.includes(tool));
    for (const hook of group.hooks) {
      if (!isRecord(hook) || !isText(hook.command)) continue;
      if (hook.command === spec.command && covers) return "ok";
      if (hook.command.includes(spec.verb)) differs = true;
    }
  }
  return differs ? "differs" : "missing";
}

/** One hook line of `darius skill status`. Same fields as a file entry. */
export interface HookStatusEntry {
  name: string;
  path: string;
  state: HookState;
  version: null;
  source: "user";
}

/**
 * Whether the three hooks of `darius skill hook` are in `<claude>/settings.json`. Read-only:
 * darius never writes settings.json; the operator pastes the hooks. A missing file is
 * `missing`; a file that is not valid JSON is `unreadable`.
 */
export function hookStatus(dir: string = claudeDir()): HookStatusEntry[] {
  const path = join(dir, "settings.json");
  let hooks: JsonValue | undefined;
  let whole: HookState | null = null;
  if (!existsSync(path)) {
    whole = "missing";
  } else {
    try {
      const parsed: JsonValue = JSON.parse(readFileSync(path, "utf8"));
      hooks = isRecord(parsed) ? parsed.hooks : undefined;
    } catch {
      whole = "unreadable";
    }
  }
  return HOOK_SPECS.map((spec) => ({ name: `hook ${spec.event}`, path, state: whole ?? hookEntryState(spec, hooks), version: null, source: "user" }));
}

/** A short note for `darius setup` when any hook is not ok, such as `hooks: missing Stop, differs PostToolUse; see darius skill hook`. Null when all three are ok. */
export function hookNote(dir: string = claudeDir()): string | null {
  const bad = hookStatus(dir).filter((entry) => entry.state !== "ok");
  if (bad.length === 0) return null;
  return `hooks: ${bad.map((entry) => `${entry.state} ${entry.name.slice("hook ".length)}`).join(", ")}; see darius skill hook`;
}

function currentSkill(): string {
  return renderSkill(listCommands());
}

function install(args: ParsedArgs): number {
  const files = managedFiles();
  const results = files.map((file) => ({ name: file.name, path: file.path, result: installSkill(file.text, file.path) }));
  const refused = results.filter((entry) => entry.result === "refused");
  const generated = results[0];
  if (args.json) {
    console.log(JSON.stringify({ ok: refused.length === 0, path: generated?.path, result: generated?.result, files: results }));
  } else {
    for (const entry of refused) console.error(`darius: ${entry.path} exists and has no darius stamp; move it away first`);
    for (const entry of results) if (entry.result !== "refused") console.log(entry.path);
  }
  return refused.length === 0 ? 0 : 1;
}

/** The state of one file against the text it should hold. */
export type FileState = "ok" | "outdated" | "edited" | "unstamped" | "missing";

/** `ok` when the file is the current text, `outdated` for older stamped text, `edited` when its body no longer matches its stamp. */
export function fileState(file: string, expected: string): FileState {
  if (!existsSync(file)) return "missing";
  const text = readFileSync(file, "utf8");
  if (readStamp(text) === null) return "unstamped";
  if (text === expected) return "ok";
  return stampMatchesBody(text) ? "outdated" : "edited";
}

/** One line of `darius skill status`. */
export interface StatusEntry {
  name: string;
  path: string;
  state: FileState | HookState;
  version: string | null;
  /** `plugin` for a generated skill that an installed plugin teaches, else `user`. */
  source: "user" | "plugin";
}

/** The status of every file of the set. Exit 0 in `status` when the generated skill teaches sessions here. */
export function skillStatus(files: readonly ManagedFile[] = managedFiles(), dir: string = claudeDir()): StatusEntry[] {
  const entries: StatusEntry[] = [];
  for (const file of files) {
    let path = file.path;
    let source: "user" | "plugin" = "user";
    if (file === files[0]) {
      const found = skillSource(dir);
      if (found !== null) {
        path = found.path;
        source = found.kind;
      }
    }
    const stamp = existsSync(path) ? readStamp(readFileSync(path, "utf8")) : null;
    entries.push({ name: file.name, path, state: fileState(path, file.text), version: stamp?.version ?? null, source });
  }
  return entries;
}

/**
 * `darius skill status`: one line per file, then one per hook. Exit 0 when a session learns
 * darius here, else exit 1 and the fix. The hook lines never change the exit code.
 * darius never writes settings.json, so a bad hook gets a line that says how to fix it.
 */
function status(args: ParsedArgs): number {
  const entries: StatusEntry[] = [...skillStatus(), ...hookStatus()];
  const taught = skillSource() !== null;
  if (args.json) {
    console.log(JSON.stringify(entries));
  } else {
    if (!taught) console.log("no darius skill on this host. To teach Claude Code sessions darius: darius skill install");
    for (const entry of entries) {
      const where = entry.source === "plugin" ? `${entry.path} (from a plugin)` : entry.path;
      console.log(`${entry.state.padEnd(9)} ${entry.name.padEnd(24)} ${where}`);
    }
    const hooks = entries.filter((entry) => entry.name.startsWith("hook "));
    const first = hooks.find((entry) => entry.state !== "ok");
    if (first !== undefined) console.log(`To fix the hooks, paste the output of darius skill hook into ${first.path}`);
  }
  return taught ? 0 : 1;
}

function uninstall(args: ParsedArgs): number {
  const files = managedFiles();
  const results = files.map((file) => ({ name: file.name, path: file.path, result: uninstallSkill(file.path, file.ownsDir) }));
  const refused = results.filter((entry) => entry.result === "refused");
  const generated = results[0];
  if (args.json) {
    console.log(JSON.stringify({ ok: refused.length === 0, path: generated?.path, result: generated?.result, files: results }));
  } else {
    for (const entry of refused) console.error(`darius: ${entry.path} has no darius stamp; left alone`);
    const removed = results.filter((entry) => entry.result === "removed");
    for (const entry of removed) console.log(`removed ${entry.path}`);
    if (removed.length === 0 && refused.length === 0) console.log(`no skill at ${generated?.path ?? skillPath()}`);
  }
  return refused.length === 0 ? 0 : 1;
}

export const skillCommand: Command = {
  name: "skill",
  summary:
    "print the Claude Code skill for darius; install | uninstall the skill, 11 procedure skills and the agent; status lists them and checks the hooks; hook prints the SessionStart, Stop and PostToolUse hooks",
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
