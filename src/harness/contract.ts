/**
 * The harness contract (docs/concept.md, "Harnesses, profiles and
 * surfaces"). A harness is the agent CLI that drives a model session:
 * Claude Code today; Codex, opencode and pi later. darius owns the run: the
 * lease, the ledger lines, the prompt and protocol, the policy, the timeout.
 * An adapter only translates between darius and one harness.
 */

import type { JsonValue, Ritual } from "../core/model.ts";
import type { GateScope } from "./gate.ts";

export type HarnessId = "claude";

/**
 * What a tool call does, whatever the harness calls the tool. The gate
 * (src/harness/gate.ts) decides per class.
 *
 *   read      reads files (Read, Grep, Glob)
 *   shell     runs a shell command
 *   write     writes or edits files
 *   web       fetches from or searches the web
 *   agent     starts a subagent
 *   internal  harness bookkeeping with no effect outside the session (a to-do list)
 *   other     anything else, MCP tools included
 */
export type ToolClass = "read" | "shell" | "write" | "web" | "agent" | "internal" | "other";

/** One tool call as the gate sees it. `name` is the harness's own tool name. */
export interface ToolCall {
  class: ToolClass;
  name: string;
  command?: string;
  /** The harness session that made the call, for the ledger's `who`. */
  sessionId?: string;
  /** Set when a subagent made the call: the harness's id for that subagent. */
  agentId?: string;
  /** A subagent call's `isolation` (Claude Code: worktree, remote): where the subagent would run. */
  isolation?: string;
  /** The file a write tool targets, as the harness gave it. */
  path?: string;
}

/** The files one run needs, under `<store>/<project>/runs/<run>/`. */
export interface RunFiles {
  dir: string;
  policy: string;
  prompt: string;
}

/**
 * A profile after resolution (src/harness/profile.ts): every field the
 * launch needs, with the defaults filled in.
 */
export interface ResolvedProfile {
  /** The profile's name, or undefined for the built-in default. */
  name?: string;
  harness: HarnessId;
  model?: string;
  effort?: string;
  permissions: "gated" | "skip";
  surface: "headless" | "herdr";
  maxTurns?: number;
  args: string[];
}

export interface PlanInput {
  ritual: Ritual;
  run: string;
  files: RunFiles;
  profile: ResolvedProfile;
  /** How much the gate enforces for this run; the hook must see every tool when it is `full`. */
  scope: GateScope;
  /** The `darius policy-check ...` argv the harness hook runs, program first. */
  gate: readonly string[];
  /** The first message, when not the adapter's own "run the ritual now" (a resume). */
  message?: string;
  /** Go on with this harness session instead of a new one (`darius run resume`). */
  sessionId?: string;
}

/** Facts read from a finished headless run's stdout. Every field may be absent. */
export interface ResultFacts {
  /** The harness's final JSON object, when stdout was one. */
  result: { readonly [key: string]: JsonValue } | null;
  sessionId?: string;
  costUsd?: number;
}

/**
 * How to start one run. `headless` is the whole argv of a background run,
 * first message included. `interactive` starts the harness's own UI in a
 * terminal pane, and `message` is then typed into it as the first prompt.
 */
export interface HarnessLaunch {
  headless: string[];
  interactive: string[];
  message: string;
}

/** What the hook prints to deny a call, and the exit code that makes the harness block it. */
export interface DenyOutput {
  stdout: string;
  exitCode: number;
}

export interface HarnessAdapter {
  id: HarnessId;
  /** The `effort` values this harness takes. */
  efforts: readonly string[];
  /**
   * Flags a profile's `args` may not carry: the ones darius sets itself, and
   * the ones that could remove or bypass the gate. `--flag=value` counts too.
   */
  reservedArgs: readonly string[];
  /** How much the gate must enforce for this profile (src/harness/gate.ts). */
  gateScope(profile: ResolvedProfile): GateScope;
  /** The executable: host config, else the harness's env variable, else its name on PATH. */
  resolveBin(configured: string | undefined): string;
  /** Writes the harness's own run files (the gate wiring) and returns the argv for each surface. */
  prepare(input: PlanInput): HarnessLaunch;
  /** The harness's hook payload as one neutral tool call. Throws on a payload it cannot read. */
  gateInput(payload: JsonValue): ToolCall;
  /** `isHeld`: the run is held and the model must stop; else the model is told to go on within the policy. */
  denyOutput(reason: string, isHeld: boolean): DenyOutput;
  /** A payload the preflight feeds to the gate; any well-formed call will do. */
  preflightPayload: string;
  parseResult(stdout: string): ResultFacts;
  /** True when this host still has the session, so `sessionId` can resume it. */
  canResume(sessionId: string): boolean;
  /** The arguments that make the harness print its version (src/runner/harness-check.ts). */
  versionArgs: readonly string[];
  /** The version from that output, or undefined when the output has none. */
  parseVersion(stdout: string): string | undefined;
  /** The cheapest model, for the gate check per harness version. */
  checkModel: string;
}
