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
 * one line each: `{at, tool, class, verdict, reason?, command?, agent?, hold_pattern?}`. The gate
 * check per harness version reads it (src/runner/harness-check.ts). A line
 * that cannot be written never changes the decision.
 *
 * GRANTS (0.47.1). A policy with grants is trusted only as darius wrote it:
 * the file must hash to the `policy_sha` of the run's start line, else every
 * call is denied. Its `cwd` and the payload's are compared with symlinks
 * resolved (src/harness/gate.ts, isGranted).
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

import { appendFileSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { readLedger } from "../core/ledger.ts";
import type { JsonValue, LedgerLine } from "../core/model.ts";
import { openProject, sha256Hex } from "../core/store.ts";
import { claudeHarness } from "../harness/claude.ts";
import type { HarnessAdapter, ToolCall } from "../harness/contract.ts";
import { decide, grantRefusal, type DariusBinCheck, type GateDecision, type GateScope, type RunPolicy } from "../harness/gate.ts";
import { HARNESS_IDS, harnessById } from "../harness/registry.ts";
import { errorMessage } from "../runtime.ts";
import { recordHold } from "../runner/hold.ts";
import { dariusBin } from "../runner/launch.ts";
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
  return parseRunPolicy(readPolicyText(path), path);
}

function readPolicyText(path: string): string {
  if (!existsSync(path)) throw new Error(`run policy ${path} does not exist`);
  return readFileSync(path, "utf8");
}

/** policy.json as text, checked; `path` names it in errors. */
export function parseRunPolicy(text: string, path: string): RunPolicy {
  const parsed = parseJsonText(text, path);
  if (!isJsonRecord(parsed)) throw new Error(`${path}: not a JSON object`);
  const { project, ritual, run, mode, may, hold, gate, result, grants, follow_up_of: followUpOf, cwd, on_hold: onHold } = parsed;
  const knownMode = MODES.find((candidate) => candidate === mode);
  if (!isJsonText(project) || !isJsonText(ritual) || !isJsonText(run) || knownMode === undefined) {
    throw new Error(`${path}: needs project, ritual, run and mode`);
  }
  if (!isJsonTextList(may) || !isJsonTextList(hold)) throw new Error(`${path}: may and hold must be string lists`);
  const policy: RunPolicy = { v: 1, project, ritual, run, mode: knownMode, may: [...may], hold: [...hold], grants: readGrants(grants, path) };
  if (gate !== undefined) {
    const scope = SCOPES.find((candidate) => candidate === gate);
    if (scope === undefined) throw new Error(`${path}: gate must be "shell" or "full"`);
    policy.gate = scope;
  }
  if (result === "required") policy.result = "required";
  if (onHold !== undefined) {
    if (onHold !== "deny") throw new Error(`${path}: on_hold must be "deny" or absent`);
    policy.on_hold = onHold;
  }
  if (followUpOf !== undefined) {
    if (!isJsonText(followUpOf) || followUpOf === "") throw new Error(`${path}: follow_up_of must be a run id`);
    policy.follow_up_of = followUpOf;
  }
  if (cwd !== undefined) {
    if (!isJsonText(cwd) || !isAbsolute(cwd)) throw new Error(`${path}: cwd must be an absolute path`);
    policy.cwd = cwd;
  }
  return policy;
}

/**
 * The run's granted lines (0.46.0); absent means none. Each is checked
 * again: a policy file with a line that is not one plain command is an
 * error, and the hook then denies every call.
 */
function readGrants(grants: JsonValue | undefined, path: string): string[] {
  if (grants === undefined) return [];
  if (!isJsonTextList(grants)) throw new Error(`${path}: grants must be a string list`);
  for (const line of grants) {
    const refused = grantRefusal(line);
    if (refused !== undefined) throw new Error(`${path}: grant "${line.slice(0, 80)}" is not one plain command (${refused})`);
  }
  return [...grants];
}

// --- ledger -----------------------------------------------------------------------

function isRunHeld(policy: RunPolicy, ledger: readonly LedgerLine[]): boolean {
  return viewRun(ledger, policy.run).phase === "held";
}

/**
 * A run with grants trusts its policy.json only as darius wrote it (0.47.1):
 * the run's latest `run.started` or `run.resumed` line records the sha256 of
 * the file (`policy_sha`), and the file must still hash to it. Throws
 * otherwise, so the hook denies every call. A run without grants is not
 * checked here: an edit there gains no grant (backlog: the full guard).
 */
function checkPolicySha(policy: RunPolicy, text: string, ledger: readonly LedgerLine[]): void {
  if (policy.grants.length === 0) return;
  const start = ledger.findLast((line) => line.run === policy.run && (line.type === "run.started" || line.type === "run.resumed"));
  const recorded = start?.policy_sha;
  if (!isJsonText(recorded) || recorded !== sha256Hex(text)) throw new Error("policy.json changed since the run started");
}

/**
 * The dir with its symlinks resolved, so `/home/x` and `/var/home/x` agree;
 * the path as given when it does not exist. Only a grant reads it.
 */
function canonicalDir(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return resolve(dir);
  }
}

/**
 * The protocol may name darius by an absolute path (0.66.0), but only one
 * that resolves to the binary this hook runs from: a `darius` under /tmp
 * that the run wrote itself is not darius.
 */
export function installedDarius(own: string = dariusBin()): DariusBinCheck {
  const target = canonicalDir(own);
  return (path) => existsSync(path) && canonicalDir(path) === target;
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
  /** The hold-list pattern that matched (0.66.0): on a hold, and on the deny of an `on_hold = "deny"` policy. */
  hold_pattern?: string;
}

/** Appends the decision to `<run>/gate.jsonl`. Best effort: the decision stands whatever happens here. */
function logDecision(policyFile: string, call: ToolCall, decision: GateDecision): void {
  const line: GateLogLine = { at: new Date().toISOString(), tool: call.name, class: call.class, verdict: decision.verdict };
  if (decision.verdict !== "allow") {
    line.reason = decision.reason;
    if (decision.holdPattern !== undefined) line.hold_pattern = decision.holdPattern;
  }
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
  const text = readPolicyText(policyFile);
  const policy = parseRunPolicy(text, policyFile);
  if (policy.cwd !== undefined) policy.cwd = canonicalDir(policy.cwd);
  if (call.cwd !== undefined) call.cwd = canonicalDir(call.cwd);
  // The preflight runs before run.started exists, so it cannot check the sha; it denies anyway.
  if (args.flags.preflight === true) {
    decide(call, { policy, isHeld: false, isDariusBin: installedDarius() });
    return deny(harness, "preflight");
  }
  const ledger = readLedger(openProject(policy.project));
  checkPolicySha(policy, text, ledger);
  const decision = decide(call, { policy, isHeld: isRunHeld(policy, ledger), isDariusBin: installedDarius() });
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
