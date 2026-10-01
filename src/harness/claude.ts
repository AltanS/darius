/**
 * The Claude Code adapter (docs/concept.md, "App design" > "Unattended
 * runner", and "Harnesses, profiles and surfaces").
 *
 * Per run it writes `<run>/settings.json`: a PreToolUse hook on Bash that
 * runs the gate, exec form (no shell, so no quoting). The executable is
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

/** Scope shell: the hook sees Bash only, as the allowlist handles the rest. Scope full: it sees every tool. */
function hookSettings(gate: readonly string[], scope: GateScope): JsonValue {
  const [command = "", ...args] = gate;
  const matcher = scope === "full" ? "*" : "Bash";
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
 * Claude Code keeps a session as `<home>/projects/<dir>/<id>.jsonl`, where
 * `<dir>` is the working dir in its own encoding. darius looks for the file
 * in every `<dir>` instead of copying that encoding. The file exists only on
 * the host that ran the session, so a resume on another host starts fresh.
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
    return {
      headless: buildArgv(input, settings, "headless"),
      interactive: buildArgv(input, settings, "interactive"),
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
    const path = isJsonRecord(toolInput) ? (toolInput.file_path ?? toolInput.notebook_path) : undefined;
    if (isJsonText(path)) call.path = path;
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
};
