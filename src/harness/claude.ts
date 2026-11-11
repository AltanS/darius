/**
 * The Claude Code adapter (docs/concept.md, "App design" > "Unattended
 * runner", and "Harnesses, profiles and surfaces").
 *
 * Per run it writes `<run>/settings.json`: a PreToolUse hook that runs the
 * gate, exec form (no shell, so no quoting), on Bash and the read tools in
 * scope shell, and on every tool in scope full. The executable is
 * config `[runner] claude`, else `$DARIUS_CLAUDE`, else `claude` on PATH.
 *
 * Two facts from the Claude Code hook docs (code.claude.com/docs/en/hooks,
 * read 2026-09-28) shape this file: settings files that fail validation are
 * ignored SILENTLY under `-p`, and a hook command that cannot start (exit
 * 127) is a non-blocking error, so the tool call proceeds.
 *
 * Permissions `skip` is the default since 0.20.0: Claude's own permission
 * system is off, and the hook is the only gate, in scope `full`. The
 * preflight proves per run that the hook starts; the gate check per harness
 * version (src/runner/harness-check.ts) proves that Claude obeys it.
 * Permissions `gated` adds Claude's allowlist (`--allowedTools`) as the
 * first layer, in `dontAsk` mode: a call the allowlist does not name is
 * refused, never asked about. `--permission-prompts none` does that only
 * under `-p`; in a herdr tab Claude asked and waited (2026-09-30). Probed 2026-09-28 on 2.1.283: the hook
 * still blocks with permissions skipped, and it also fires inside subagents.
 */

import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { BoxError, type BoxHarnessPath, type HostPort } from "../core/box.ts";
import type { JsonValue, Policy } from "../core/model.ts";
import type { DenyOutput, HarnessAdapter, HarnessLaunch, PlanInput, ResolvedProfile, ResultFacts, ToolCall, ToolClass } from "./contract.ts";
import { allowsSubagents, type GateScope } from "./gate.ts";

/** The subagent tool's names; older builds call it Task. */
const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(["Agent", "Task"]);
/** Tools every unattended run may use, whatever the policy says. */
export const READ_ONLY_TOOLS: readonly string[] = ["Read", "Grep", "Glob"];
/** Denied in every mode. */
const DISALLOWED_ALWAYS: readonly string[] = ["NotebookEdit"];
/**
 * Denied unless permissions are skipped. With permissions skipped the gate
 * sees every write and lets through only a scratch file under /tmp (0.23.0);
 * a gated run has no gate on writes, so the tools stay off.
 */
const DISALLOWED_GATED: readonly string[] = ["Write", "Edit"];
/** Denied in `report` mode on top of the above. */
const DISALLOWED_REPORT: readonly string[] = ["WebFetch", "WebSearch"];
/**
 * Denied when permissions are skipped, unless the policy's `may` names Agent
 * (0.21.0). Probed on 2.1.283: with permissions skipped, a subagent ran a
 * tool the parent's --disallowedTools named, and --disallowedTools Agent
 * removed the subagent tool itself. So a subagent's calls are held to the
 * policy by the gate alone, which sees them (2.1.285: the payload carries
 * agent_id).
 */
const DISALLOWED_SKIP: readonly string[] = ["Agent"];
export const DEFAULT_MAX_TURNS = 20;
/**
 * What a run in the box may write under `~/.claude` and keep (0.122.0): the
 * login (token refresh) and the prompt history. The projects folder of the
 * run's own work dir comes on top, see `boxWritable`.
 */
const BOX_WRITABLE: readonly string[] = [".credentials.json", "history.jsonl"];
/**
 * Per run and empty in the box (0.122.0): the operator's own sessions read
 * these later, unboxed. Every Bash call sources a file in `shell-snapshots`.
 */
const BOX_SCRATCH: readonly string[] = ["shell-snapshots", "session-env", "todos", "tasks", "debug", "statsig", "file-history"];
/** Claude Code cuts a longer projects folder name and adds a hash of its own; the box does not guess that hash. */
const MAX_PROJECT_DIR_NAME = 200;
/** The API and login hosts Claude Code reaches, in every `net` mode. */
const BOX_HOSTS: readonly HostPort[] = ["api.anthropic.com", "console.anthropic.com", "platform.claude.com", "claude.ai", "statsig.anthropic.com"].map((host) => ({ host, port: 443 }));
export const CLAUDE_EFFORTS: readonly string[] = ["low", "medium", "high", "xhigh", "max", "ultracode"];

/**
 * Flags darius sets itself or that could remove or bypass the gate.
 * `--fallback-model` too (0.29.0): the operator names the model they trust,
 * and a profile must not let Claude Code swap it for another one.
 */
const RESERVED_ARGS: readonly string[] = [
  "-p",
  "--print",
  "--output-format",
  "--model",
  "--fallback-model",
  "--max-turns",
  "--effort",
  "--permission-mode",
  "--permission-prompts",
  "--dangerously-skip-permissions",
  "--allow-dangerously-skip-permissions",
  "--settings",
  "--setting-sources",
  "--system-prompt",
  "--system-prompt-file",
  "--append-system-prompt",
  "--append-system-prompt-file",
  "--allowedTools",
  "--allowed-tools",
  "--disallowedTools",
  "--disallowed-tools",
  "--tools",
  // The session: darius resumes one itself (`run resume`), a profile may not.
  "--resume",
  "-r",
  "--continue",
  "-c",
  "--session-id",
  "--fork-session",
];

/** Claude Code tool names per class. A name not listed here is `other`. */
const TOOL_CLASSES: ReadonlyMap<string, ToolClass> = new Map<string, ToolClass>([
  ["Bash", "shell"],
  ["Read", "read"],
  ["Grep", "read"],
  ["Glob", "read"],
  ["LS", "read"],
  ["NotebookRead", "read"],
  ["Write", "write"],
  ["Edit", "write"],
  ["MultiEdit", "write"],
  ["NotebookEdit", "write"],
  ["WebFetch", "web"],
  ["WebSearch", "web"],
  // The subagent tool; older builds call it Task.
  ["Agent", "agent"],
  ["Task", "agent"],
  // A session to-do list and tool-schema loading: no effect outside the session.
  ["ToolSearch", "internal"],
  // Loads a skill's instructions; what the skill then does goes through the gate.
  ["Skill", "internal"],
  ["TodoWrite", "internal"],
  ["TaskCreate", "internal"],
  ["TaskUpdate", "internal"],
  ["TaskList", "internal"],
  ["TaskGet", "internal"],
]);

const EXIT_DENY = 2;

/** `--allowedTools`: the policy's `may` rules plus the read-only defaults, and Skill for a ritual that names one. */
/**
 * The gated allowlist. Never the subagent tool: gated mode has no proof that
 * a subagent keeps to the parent's permissions, so subagents need
 * permissions skipped, where the gate judges each of their calls (0.21.0).
 */
export function allowedTools(policy: Policy, withSkill = false): string[] {
  const may = policy.may.filter((rule) => !SUBAGENT_TOOLS.has(rule));
  return [...new Set([...may, ...READ_ONLY_TOOLS, ...(withSkill ? ["Skill"] : [])])];
}

export function disallowedTools(policy: Policy, permissions: ResolvedProfile["permissions"] = "gated"): string[] {
  const tools = permissions === "skip" ? [...DISALLOWED_ALWAYS] : [...DISALLOWED_GATED, ...DISALLOWED_ALWAYS];
  if (policy.mode === "report") tools.push(...DISALLOWED_REPORT);
  if (permissions === "skip" && !allowsSubagents(policy.may)) tools.push(...DISALLOWED_SKIP);
  return tools;
}

/**
 * The hook's matcher in scope shell (0.114.0): Bash, and the read tools, so the
 * secret path check can fire. The gate allows every other call of a read tool
 * there. Claude Code reads a matcher as a regex.
 */
export const SHELL_SCOPE_MATCHER = "Bash|Read|Grep|Glob|NotebookRead|LS";

/** Scope shell: the hook sees Bash and the read tools, as the allowlist handles the rest. Scope full: it sees every tool. */
function hookSettings(gate: readonly string[], scope: GateScope): JsonValue {
  const [command = "", ...args] = gate;
  const matcher = scope === "full" ? "*" : SHELL_SCOPE_MATCHER;
  return {
    hooks: {
      PreToolUse: [{ matcher, hooks: [{ type: "command", command, args }] }],
    },
  };
}

function firstMessage(input: PlanInput): string {
  return input.message ?? `Run ritual ${input.ritual.slug} now. Run id ${input.run}. Follow the protocol in your system prompt.`;
}

/**
 * The claude argv. Headless, `-p` and the short user message come first.
 * The two tool lists are variadic, so they go last, where the next `--flag`
 * or the end of argv closes them. Interactive has no `-p`, no JSON output
 * and no turn limit (a print-mode flag); the surface's timeout bounds it.
 * A resume passes every flag again: the session keeps its transcript, not
 * the tools, the hook or the system prompt of the process that made it.
 */
function buildArgv(input: PlanInput, settings: string, mode: "headless" | "interactive"): string[] {
  const { policy } = input.ritual;
  const { profile } = input;
  const argv = mode === "headless" ? ["-p", firstMessage(input), "--output-format", "json"] : [];
  if (input.sessionId !== undefined) argv.push("--resume", input.sessionId);
  if (profile.model !== undefined && profile.model !== "") argv.push("--model", profile.model);
  if (mode === "headless") argv.push("--max-turns", String(profile.maxTurns ?? DEFAULT_MAX_TURNS));
  if (profile.effort !== undefined) argv.push("--effort", profile.effort);
  if (profile.permissions === "skip") argv.push("--dangerously-skip-permissions");
  else {
    argv.push("--permission-mode", "dontAsk");
    if (mode === "headless") argv.push("--permission-prompts", "none");
  }
  argv.push("--settings", settings, "--append-system-prompt-file", input.files.prompt);
  argv.push(...profile.args);
  if (profile.permissions === "gated") argv.push("--allowedTools", ...allowedTools(policy, input.ritual.skill !== undefined));
  argv.push("--disallowedTools", ...disallowedTools(policy, profile.permissions));
  return argv;
}

/** A Claude Code session id is a UUID; anything else is not looked up. */
const SESSION_ID = /^[0-9A-Za-z-]{8,64}$/u;

/** `$CLAUDE_CONFIG_DIR`, else `~/.claude`. */
function claudeHome(): string {
  const configured = process.env.CLAUDE_CONFIG_DIR;
  return configured !== undefined && configured !== "" ? configured : join(homedir(), ".claude");
}

/**
 * The name of a work dir's folder under `~/.claude/projects`: every
 * character but a letter or a digit becomes `-`, so `/srv/my.repo` is
 * `-srv-my-repo`. The box binds only that folder writable (0.122.0). A name
 * over 200 characters is a BoxError: Claude Code then cuts it and adds a hash
 * the box cannot know, and the run must not start without its session folder.
 */
export function claudeProjectDirName(workDir: string): string {
  const name = workDir.replaceAll(/[^a-zA-Z0-9]/gu, "-");
  if (name.length > MAX_PROJECT_DIR_NAME) throw new BoxError(`the work dir ${workDir} is too long for the box: Claude Code names its session folder with a hash past ${String(MAX_PROJECT_DIR_NAME)} characters`);
  return name;
}

/**
 * Claude Code keeps a session as `<home>/projects/<dir>/<id>.jsonl`, where
 * `<dir>` is the working dir in its own encoding (`claudeProjectDirName`).
 * darius looks for the file in every `<dir>`, so a session from before the
 * box, or under a longer name, is found too. The file exists only on the host
 * that ran the session, so a resume on another host starts fresh.
 */
function hasSession(sessionId: string): boolean {
  if (!SESSION_ID.test(sessionId)) return false;
  const projects = join(claudeHome(), "projects");
  if (!existsSync(projects)) return false;
  return readdirSync(projects).some((dir) => existsSync(join(projects, dir, `${sessionId}.jsonl`)));
}

// --- JSON helpers --------------------------------------------------------------------

function isJsonRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isJsonNumber(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Where a Glob call really starts: its `path`, and the part of its pattern
 * before the first wildcard, so `/home/me/.ssh/*` and `.config/darius/*` count.
 * Undefined means the working dir.
 */
function globRoot(path: string | undefined, pattern: string): string | undefined {
  const words = pattern.split("/");
  const wild = words.findIndex((word) => /[*?[{]/u.test(word));
  const fixed = (wild === -1 ? words.slice(0, -1) : words.slice(0, wild)).join("/");
  if (fixed === "") return pattern.startsWith("/") ? "/" : path;
  const isAnchored = /^(?:\/|~|\$HOME|\$\{HOME\})/u.test(fixed);
  return isAnchored || path === undefined ? fixed : `${path}/${fixed}`;
}

/** The path of a tool call: the file a tool targets, or where a search starts. */
function toolPath(name: string, input: { readonly [key: string]: JsonValue }): string | undefined {
  const { file_path: file, notebook_path: notebook, path, pattern } = input;
  if (isJsonText(file)) return file;
  if (isJsonText(notebook)) return notebook;
  const root = isJsonText(path) ? path : undefined;
  return name === "Glob" && isJsonText(pattern) ? globRoot(root, pattern) : root;
}

function parseResultObject(stdout: string): { readonly [key: string]: JsonValue } | null {
  const text = stdout.trim();
  if (text === "") return null;
  try {
    const parsed: JsonValue = JSON.parse(text);
    return isJsonRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// --- the adapter ----------------------------------------------------------------------

export const claudeHarness: HarnessAdapter = {
  id: "claude",
  efforts: CLAUDE_EFFORTS,
  reservedArgs: RESERVED_ARGS,

  // Gated, the allowlist enforces `may`; skipped, nothing does but the gate.
  gateScope(profile: ResolvedProfile): GateScope {
    return profile.permissions === "skip" ? "full" : "shell";
  },

  resolveBin(configured: string | undefined): string {
    if (configured !== undefined && configured !== "") return configured;
    const fromEnv = process.env.DARIUS_CLAUDE;
    if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
    return "claude";
  },

  prepare(input: PlanInput): HarnessLaunch {
    const settings = join(input.files.dir, "settings.json");
    writeFileSync(settings, `${JSON.stringify(hookSettings(input.gate, input.scope), null, 2)}\n`);
    const interactive = buildArgv(input, settings, "interactive");
    // The prompt goes first: the two tool lists at the end are variadic and would take it as a tool name.
    return {
      headless: buildArgv(input, settings, "headless"),
      interactive,
      prompted: [firstMessage(input), ...interactive],
      message: firstMessage(input),
    };
  },

  gateInput(payload: JsonValue): ToolCall {
    if (!isJsonRecord(payload) || !isJsonText(payload.tool_name)) throw new Error("hook input has no tool_name");
    const name = payload.tool_name;
    const call: ToolCall = { class: TOOL_CLASSES.get(name) ?? "other", name };
    const toolInput = payload.tool_input;
    if (isJsonRecord(toolInput) && isJsonText(toolInput.command)) call.command = toolInput.command;
    if (isJsonText(payload.session_id)) call.sessionId = payload.session_id;
    // Inside a subagent the payload carries agent_id (probed on 2.1.283 and 2.1.285).
    if (isJsonText(payload.agent_id)) call.agentId = payload.agent_id;
    // The session's current dir: it follows a `cd` in an earlier Bash call.
    if (isJsonText(payload.cwd) && payload.cwd !== "") call.cwd = payload.cwd;
    const path = isJsonRecord(toolInput) ? toolPath(name, toolInput) : undefined;
    if (path !== undefined) call.path = path;
    if (name === "Grep" || name === "Glob") call.isSearch = true;
    const isolation = isJsonRecord(toolInput) ? toolInput.isolation : undefined;
    if (isolation !== undefined && isolation !== null && isolation !== "") call.isolation = isJsonText(isolation) ? isolation : JSON.stringify(isolation);
    return call;
  },

  // Per the hook docs, exit 2 blocks the call whatever stdout says; the JSON
  // gives the model the reason.
  denyOutput(reason: string, isHeld: boolean): DenyOutput {
    const next = isHeld
      ? "The run is now held for an operator. Stop and do nothing else."
      : "Do not retry it. Go on with what the policy allows, or hold the run if you need a person.";
    const decision = {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `darius policy: ${reason}. ${next}`,
      },
    };
    return { stdout: JSON.stringify(decision), exitCode: EXIT_DENY };
  },

  preflightPayload: JSON.stringify({
    session_id: "darius-preflight",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "true" },
  }),

  parseResult(stdout: string): ResultFacts {
    const result = parseResultObject(stdout);
    const facts: ResultFacts = { result };
    if (result !== null && isJsonText(result.session_id)) facts.sessionId = result.session_id;
    if (result !== null && isJsonNumber(result.total_cost_usd)) facts.costUsd = result.total_cost_usd;
    return facts;
  },

  canResume: hasSession,

  // `claude --version` prints `2.1.285 (Claude Code)`.
  versionArgs: ["--version"],
  parseVersion(stdout: string): string | undefined {
    return /^\s*(\d+\.\d+\.\d+\S*)/u.exec(stdout)?.[1];
  },
  checkModel: "haiku",

  // The box (0.117.0): the login and session state Claude Code writes. Settings, hooks,
  // plugins, skills, agents and CLAUDE.md stay read-only; `harness check` in the box proves the list.
  // Since 0.122.0 only this work dir's projects folder persists, for `run resume`. Its memory folder
  // stays read-only: the operator's next session in this work dir loads it.
  boxWritable(home: string, workDir: string): BoxHarnessPath[] {
    const project = join(home, ".claude", "projects", claudeProjectDirName(workDir));
    return [
      ...BOX_WRITABLE.map((name) => ({ path: join(home, ".claude", name) })),
      { path: project, isMadeWhenMissing: true },
      { path: join(project, "memory"), isReadOnly: true, isMadeWhenMissing: true },
    ];
  },
  boxScratch(home: string): string[] {
    return BOX_SCRATCH.map((name) => join(home, ".claude", name));
  },
  boxCopies(home: string): string[] {
    return [join(home, ".claude.json")];
  },
  boxHosts: BOX_HOSTS,
  // The harness login, when the operator gives it by environment: the run is the harness.
  boxEnv: ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"],
};
