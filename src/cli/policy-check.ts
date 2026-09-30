/**
 * `darius policy-check [--policy FILE] [--harness ID] [--preflight]`: the
 * pre-tool hook inside an unattended run (docs/concept.md, "App design" >
 * "Unattended runner", and "Harnesses, profiles and surfaces"). The harness
 * adapter (src/harness/) wires it into the run and reads the hook payload;
 * the gate (src/harness/gate.ts) decides. `--harness` defaults to claude.
 *
 * Input: the harness's hook JSON on stdin. The run's policy comes from
 * `--policy`, else `$DARIUS_RUN_POLICY`.
 *
 * On hold: append `run.held{run, questions:[reason]}` (once per run, and
 * only while the run is running), print the harness's deny output saying the
 * run is held, exit with its blocking code (2 for Claude Code). On deny: the
 * same output without the hold, so the model goes on within the policy.
 * Allow: print nothing, exit 0 (src/harness/gate.ts, "allow, deny or hold").
 *
 * Every decision also goes to `<run>/gate.jsonl` next to the policy file,
 * one line each: `{at, tool, class, verdict, reason?, command?, agent?}`. The gate
 * check per harness version reads it (src/runner/harness-check.ts). A line
 * that cannot be written never changes the decision.
 *
 * `--preflight` is the launcher's check that the gate works at all: it reads
 * the payload and the policy and decides as usual, then always denies and
 * writes nothing. An error (no policy, a bad regex) exits 1 instead of
 * denying, so the launcher refuses a run whose gate would deny every call.
 *
 * FAIL CLOSED. Per the Claude Code hook docs, exit 2 blocks the tool call
 * whatever stdout says, while exit 1 or unparsable output lets it proceed.
 * So every error here (no policy file, bad stdin, bad regex) also prints a
 * deny and exits 2. Exit 2 is the hook contract here, not "usage".
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { readLedger } from "../core/ledger.ts";
import type { JsonValue } from "../core/model.ts";
import { openProject } from "../core/store.ts";
import { claudeHarness } from "../harness/claude.ts";
import type { HarnessAdapter, ToolCall } from "../harness/contract.ts";
import { decide, type GateDecision, type GateScope, type RunPolicy } from "../harness/gate.ts";
import { HARNESS_IDS, harnessById } from "../harness/registry.ts";
import { errorMessage } from "../runtime.ts";
import { recordHold } from "../runner/hold.ts";
import { viewRun } from "../runner/run-due.ts";
import { readStdin } from "./args.ts";
import type { Command, ParsedArgs } from "./registry.ts";

const EXIT_ALLOW = 0;
const EXIT_PREFLIGHT_FAILED = 1;

// --- parsing --------------------------------------------------------------------

function isJsonRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isJsonTextList(value: JsonValue | undefined): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => isJsonText(entry));
}

function parseJsonText(text: string, where: string): JsonValue {
  try {
    const parsed: JsonValue = JSON.parse(text);
    return parsed;
  } catch (cause) {
    throw new Error(`${where}: not valid JSON`, { cause });
  }
}

const MODES: readonly RunPolicy["mode"][] = ["off", "report", "act"];
const SCOPES: readonly GateScope[] = ["shell", "full"];

export function readRunPolicy(path: string): RunPolicy {
  if (!existsSync(path)) throw new Error(`run policy ${path} does not exist`);
  const parsed = parseJsonText(readFileSync(path, "utf8"), path);
  if (!isJsonRecord(parsed)) throw new Error(`${path}: not a JSON object`);
  const { project, ritual, run, mode, may, hold, gate, result } = parsed;
  const knownMode = MODES.find((candidate) => candidate === mode);
  if (!isJsonText(project) || !isJsonText(ritual) || !isJsonText(run) || knownMode === undefined) {
    throw new Error(`${path}: needs project, ritual, run and mode`);
  }
  if (!isJsonTextList(may) || !isJsonTextList(hold)) throw new Error(`${path}: may and hold must be string lists`);
  const policy: RunPolicy = { v: 1, project, ritual, run, mode: knownMode, may: [...may], hold: [...hold] };
  if (gate !== undefined) {
    const scope = SCOPES.find((candidate) => candidate === gate);
    if (scope === undefined) throw new Error(`${path}: gate must be "shell" or "full"`);
    policy.gate = scope;
  }
  if (result === "required") policy.result = "required";
  return policy;
}

// --- ledger -----------------------------------------------------------------------

function isRunHeld(policy: RunPolicy): boolean {
  return viewRun(readLedger(openProject(policy.project)), policy.run).phase === "held";
}

// --- the command ------------------------------------------------------------------

function textFlag(args: ParsedArgs, name: string): string | undefined {
  const flag = args.flags[name];
  if (flag === true) throw new Error(`--${name} needs a value`);
  if (flag === undefined || flag === false || flag === "") return undefined;
  return flag;
}

function policyPath(args: ParsedArgs): string {
  const flag = textFlag(args, "policy");
  if (flag !== undefined) return flag;
  const fromEnv = process.env.DARIUS_RUN_POLICY;
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  throw new Error("no run policy: pass --policy or set DARIUS_RUN_POLICY");
}

function deny(harness: HarnessAdapter, reason: string, isHeld = true): number {
  const output = harness.denyOutput(reason, isHeld);
  console.log(output.stdout);
  return output.exitCode;
}

/** One line of `<run>/gate.jsonl`. */
interface GateLogLine {
  at: string;
  tool: string;
  class: ToolCall["class"];
  verdict: GateDecision["verdict"];
  reason?: string;
  command?: string;
  /** The subagent that made the call, when one did. */
  agent?: string;
}

/** Appends the decision to `<run>/gate.jsonl`. Best effort: the decision stands whatever happens here. */
function logDecision(policyFile: string, call: ToolCall, decision: GateDecision): void {
  const line: GateLogLine = { at: new Date().toISOString(), tool: call.name, class: call.class, verdict: decision.verdict };
  if (decision.verdict !== "allow") line.reason = decision.reason;
  if (call.command !== undefined) line.command = call.command.slice(0, 300);
  if (call.agentId !== undefined) line.agent = call.agentId;
  try {
    appendFileSync(join(dirname(policyFile), "gate.jsonl"), `${JSON.stringify(line)}\n`);
  } catch {
    // A full disk or a read-only run dir must not turn an allow into an error.
  }
}

function check(args: ParsedArgs, harness: HarnessAdapter): number {
  const call = harness.gateInput(parseJsonText(args.stdin ?? readStdin(), "hook input"));
  const policyFile = policyPath(args);
  const policy = readRunPolicy(policyFile);
  if (args.flags.preflight === true) {
    decide(call, { policy, isHeld: false });
    return deny(harness, "preflight");
  }
  const decision = decide(call, { policy, isHeld: isRunHeld(policy) });
  logDecision(policyFile, call, decision);
  if (decision.verdict === "allow") return EXIT_ALLOW;
  if (decision.verdict === "deny") return deny(harness, decision.reason, false);
  const who = call.sessionId === undefined ? "policy-check" : `${harness.id}:${call.sessionId}`;
  recordHold(policy, { question: decision.reason, who });
  return deny(harness, decision.reason);
}

export const policyCheckCommand: Command = {
  name: "policy-check",
  summary: "pre-tool hook for unattended runs: deny held or write commands (reads hook JSON on stdin)",
  async run(args: ParsedArgs): Promise<number> {
    // An unknown harness still gets a deny; exit 2 blocks in every harness darius knows.
    let harness = claudeHarness;
    try {
      const id = textFlag(args, "harness") ?? "claude";
      const known = harnessById(id);
      if (known === undefined) throw new Error(`unknown harness "${id}" (known: ${HARNESS_IDS.join(", ")})`);
      harness = known;
      return check(args, harness);
    } catch (cause) {
      console.error(`darius policy-check: ${errorMessage(cause)}`);
      // A preflight must see the error: this gate would deny every call of the run.
      if (args.flags.preflight === true) return EXIT_PREFLIGHT_FAILED;
      return deny(harness, `policy check failed (${errorMessage(cause)}), denied to be safe`);
    }
  },
};
