/**
 * The harness-neutral half of launching one unattended run for a ritual
 * (docs/concept.md, "App design" > "Unattended runner", step 3). The harness
 * half is an adapter in src/harness/, the process half a surface in
 * src/surface/.
 *
 * Per run, under `<store>/<project>/runs/<run>/`:
 *
 *   policy.json    what `darius policy-check` enforces: run id, project,
 *                  mode, the `hold` regexes (RunPolicy in src/harness/gate.ts)
 *   prompt.md      the handoff from the previous run (0.26.0), the procedure,
 *                  the policy, and the hold and complete protocol
 *   ...            whatever the adapter needs to wire the gate (Claude Code:
 *                  settings.json)
 *
 * Before the launch, the preflight runs the exact gate command line once with
 * a synthetic call. Claude Code lets a tool call through when its hook cannot
 * start, so a gate that is broken must stop the run before it starts.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

import { handoffSection, type Handoff } from "../core/handoff.ts";
import type { Ritual } from "../core/model.ts";
import { RESULT_PROMPT } from "../core/result.ts";
import type { HarnessAdapter, RunFiles } from "../harness/contract.ts";
import { allowsSubagents, type GateScope, type RunPolicy } from "../harness/gate.ts";
import { errorMessage } from "../runtime.ts";
import type { ChildEnv } from "../surface/headless.ts";

const PREFLIGHT_TIMEOUT_MS = 30_000;

/** `<repo>/bin/darius`, the absolute path the hook runs. Independent of PATH. */
export function dariusBin(): string {
  return fileURLToPath(new URL("../../bin/darius", import.meta.url));
}

/** The gate command line the harness hook runs, program first. Claude Code is the default harness. */
export function gateCommand(files: RunFiles, harness: HarnessAdapter): string[] {
  const argv = [dariusBin(), "policy-check", "--policy", files.policy];
  if (harness.id !== "claude") argv.push("--harness", harness.id);
  return argv;
}

function bulletList(items: readonly string[]): string {
  if (items.length === 0) return "- (none)";
  return items.map((item) => `- \`${item}\``).join("\n");
}

interface PromptInput {
  project: string;
  run: string;
  ritual: Ritual;
  body: string;
  /** What the previous run of the ritual passes on (src/core/handoff.ts); none for the harness check. */
  handoff?: Handoff | null;
}

/**
 * A ritual that names a skill: the checkout supplies the skill, the prompt
 * names it. Unattended runs never write files, so a skill that writes a
 * report hands it in as the findings instead.
 */
function skillSection(ritual: Ritual): string[] {
  if (ritual.skill === undefined) return [];
  return [
    "## Skill",
    "",
    `Invoke the skill \`${ritual.skill}\` of this repository with the Skill tool, and do what it says. If the Skill tool does not list it, find \`.claude/skills/${ritual.skill}/SKILL.md\` in this checkout, read it, and follow it.`,
    "Where the skill says to write a file, do not: put that content into the findings of `darius run complete` instead.",
    "",
  ];
}

/**
 * A ritual that may start subagents (`may` names Agent, 0.21.0): the rules
 * the gate enforces, said up front so the model does not learn them by
 * refusal.
 */
function subagentSection(ritual: Ritual): string[] {
  if (!allowsSubagents(ritual.policy.may)) return [];
  return [
    "## Subagents",
    "",
    "You may start subagents with the Agent tool, for example for an independent second check. Every tool call of a subagent passes the same policy and gate as yours.",
    "Start them without `isolation`. A subagent may not start another subagent, and may not complete the run: it returns its findings to you.",
    "Wait for the result of every subagent before you run `darius run complete`.",
    "",
  ];
}

/** The text appended to the system prompt. Plain words; the model reads it, nothing parses it. */
export function buildPrompt(input: PromptInput): string {
  const { project, run, ritual } = input;
  const scope = `--project ${project}`;
  const modeLine =
    ritual.policy.mode === "report"
      ? "Mode: report. Read and investigate only. Every write verb is denied. Put proposed fixes in the findings. Scratch files may go under /tmp only."
      : "Mode: act. You may run the commands the policy allows. Anything on the hold list stops the run. Scratch files may go under /tmp only.";
  return [
    `# Unattended darius run: ritual ${ritual.slug} (${ritual.title})`,
    "",
    `Project: ${project}`,
    `Run id: ${run}`,
    modeLine,
    "",
    ...handoffSection(input.handoff ?? null),
    "## Protocol",
    "",
    "1. Do the procedure below. Nobody is watching this session; no one answers questions in the chat.",
    "2. When you need a person, or a step matches the hold list, do not do it. Hold the run, then stop. Do not run anything after a hold:",
    "",
    "```bash",
    `darius run hold ${run} ${scope} --question "<one question, no $ or backticks>"`,
    "```",
    "",
    "3. When the procedure is done, finish with your findings in plain markdown, ending with the darius-result block (see Result). This is your last action:",
    "",
    "```bash",
    `darius run complete ${run} ${scope} --outcome complete --findings-stdin <<'FINDINGS'`,
    "<findings>",
    "```darius-result",
    "<result JSON>",
    "```",
    "FINDINGS",
    "```",
    "",
    "4. If the procedure cannot be done, use the same command with `--outcome failed` and say why.",
    "5. When the policy hook denies a tool call and says the run is now held, stop at once. Any other denial: do not retry that call, go on within the policy.",
    "",
    "## Policy",
    "",
    "Allowed tool rules:",
    bulletList(ritual.policy.may),
    "",
    "Hold list (regexes over the Bash command line; a match holds the run):",
    bulletList(ritual.policy.hold),
    ...(ritual.policy.notes === undefined ? [] : ["", "Notes:", ritual.policy.notes]),
    "",
    ...skillSection(ritual),
    ...subagentSection(ritual),
    ...RESULT_PROMPT,
    "## Procedure",
    "",
    input.body.trim(),
    "",
  ].join("\n");
}

/** Writes policy.json and prompt.md under `<projectRoot>/runs/<run>/`. `scope` "shell" is left out, as it is the default. */
export function writeRunFiles(projectRoot: string, input: PromptInput, scope: GateScope = "shell"): RunFiles {
  const dir = join(projectRoot, "runs", input.run);
  mkdirSync(dir, { recursive: true });
  const files: RunFiles = { dir, policy: join(dir, "policy.json"), prompt: join(dir, "prompt.md") };
  const { policy } = input.ritual;
  const runPolicy: RunPolicy = {
    v: 1,
    project: input.project,
    ritual: input.ritual.slug,
    run: input.run,
    mode: policy.mode,
    may: [...policy.may],
    hold: [...policy.hold],
  };
  if (scope !== "shell") runPolicy.gate = scope;
  // Every run darius launches hands in a result (0.22.0); a by-hand run may.
  runPolicy.result = "required";
  writeFileSync(files.policy, `${JSON.stringify(runPolicy, null, 2)}\n`);
  writeFileSync(files.prompt, buildPrompt(input));
  return files;
}

/** The parent env plus the run variables, with `~/.local/bin` on PATH (where `darius` is linked). */
export function buildEnv(input: { project: string; run: string; files: RunFiles; harness: HarnessAdapter }): ChildEnv {
  const env: ChildEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  const localBin = join(homedir(), ".local", "bin");
  const path = env.PATH ?? "";
  const parts = path === "" ? [] : path.split(delimiter);
  if (!parts.includes(localBin)) parts.push(localBin);
  env.PATH = parts.join(delimiter);
  env.DARIUS_RUN = input.run;
  env.DARIUS_RUN_POLICY = input.files.policy;
  env.DARIUS_PROJECT = input.project;
  // Lines the model writes (run hold, run complete) name the run, not the
  // operator's login: without this they read `who: owner` (acceptance finding).
  env.DARIUS_WHO = `${input.harness.id}:${input.run}`;
  return env;
}

/**
 * Runs the gate command line with the adapter's synthetic call and
 * `--preflight`, which decides as usual but always denies and writes nothing.
 * Returns undefined when the gate answered with the harness's deny, else why not.
 */
export function preflightGate(gate: readonly string[], harness: HarnessAdapter, env: ChildEnv): string | undefined {
  const [program = "", ...args] = gate;
  const expected = harness.denyOutput("preflight", true);
  const result = spawnSync(program, [...args, "--preflight"], {
    input: harness.preflightPayload,
    env,
    encoding: "utf8",
    timeout: PREFLIGHT_TIMEOUT_MS,
  });
  if (result.error !== undefined) return `the gate did not run: ${errorMessage(result.error)}`;
  if (result.status === expected.exitCode && result.stdout.includes("deny")) return undefined;
  if (result.status === 0) return "the gate allowed the preflight call; it must deny it";
  const stderr = result.stderr.trim().slice(-500);
  return `the gate exited ${String(result.status ?? result.signal ?? "none")}${stderr === "" ? "" : `: ${stderr}`}`;
}
