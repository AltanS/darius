/**
 * `darius harness check|list`: the gate check per harness version
 * (docs/concept.md, "Harnesses, profiles and surfaces" > "Gate check, per
 * harness version"; src/runner/harness-check.ts).
 *
 *   harness check [<id>] [--who W]   start the harness for real on this host,
 *                                    with the cheapest model, and prove its
 *                                    gate blocks a call. Exit 0 passed,
 *                                    1 failed, 3 inconclusive.
 *   harness list                     the latest check of each harness
 *                                    version on each host, newest first
 *
 * run-due runs a missing check by itself. This command is for a check that
 * did not pass today, which run-due does not try again until tomorrow.
 * `<id>` defaults to claude.
 */

import { existsSync } from "node:fs";

import { loadConfigIfPresent } from "../core/config.ts";
import { defaultWho, hostId, readLedger } from "../core/ledger.ts";
import type { JsonValue, LedgerLine } from "../core/model.ts";
import { projectDir } from "../core/paths.ts";
import { GLOBAL_PROJECT, openProject } from "../core/store.ts";
import { HARNESS_IDS, harnessById } from "../harness/registry.ts";
import { readVersion, runHarnessCheck, type HarnessCheck } from "../runner/harness-check.ts";
import { UsageError, type Command, type ParsedArgs } from "./registry.ts";

const VERBS = "check | list";
const EXIT_FAILED = 1;
const EXIT_INCONCLUSIVE = 3;

function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  if (value === undefined || value === false) return undefined;
  if (value === true) throw new UsageError(`--${name} needs a value`);
  return value;
}

function isJsonText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isJsonNumber(value: JsonValue | undefined): value is number {
  return typeof value === "number";
}

function describe(result: HarnessCheck, host: string): string {
  const mark = result.outcome === "passed" ? "✓" : "!";
  const cost = result.costUsd === undefined ? "" : ` ($${result.costUsd.toFixed(4)})`;
  const detail = result.detail === undefined ? "" : `: ${result.detail}`;
  const subagents = result.outcome === "passed" ? `, subagents ${result.subagents === "passed" ? "passed" : "not proven"}` : "";
  return `${mark} ${result.harness} ${result.version}: gate check ${result.outcome}${subagents} on ${host}${cost}${detail}`;
}

async function check(args: ParsedArgs): Promise<number> {
  const id = args.positional[1] ?? "claude";
  const harness = harnessById(id);
  if (harness === undefined) throw new UsageError(`unknown harness "${id}" (known: ${HARNESS_IDS.join(", ")})`);
  const cfg = loadConfigIfPresent();
  const bin = harness.resolveBin(harness.id === "claude" ? cfg?.runner.claude : undefined);
  const host = hostId();
  const read = readVersion(harness, bin);
  if ("error" in read) {
    if (args.json) console.log(JSON.stringify({ ok: false, harness: id, host, error: read.error }));
    else console.log(`! ${id}: cannot read the version: ${read.error}`);
    return EXIT_INCONCLUSIVE;
  }
  const global = openProject(GLOBAL_PROJECT, { create: true });
  const who = stringFlag(args, "who") ?? defaultWho();
  const result = await runHarnessCheck({ harness, bin, version: read.version, global, who });
  if (args.json) console.log(JSON.stringify({ ok: result.outcome === "passed", host, ...result }));
  else console.log(describe(result, host));
  if (result.outcome === "passed") return 0;
  return result.outcome === "failed" ? EXIT_FAILED : EXIT_INCONCLUSIVE;
}

interface ListedCheck {
  harness: string;
  version: string;
  host: string;
  outcome: string;
  /** `passed` when the check saw the gate judge a subagent; older checks have none. */
  subagents?: string;
  at: string;
  costUsd?: number;
  detail?: string;
}

function listed(line: LedgerLine): ListedCheck | undefined {
  const { harness, version, outcome } = line;
  if (!isJsonText(harness) || !isJsonText(version) || !isJsonText(outcome)) return undefined;
  const entry: ListedCheck = { harness, version, host: line.host, outcome, at: line.at };
  if (isJsonNumber(line.cost_usd)) entry.costUsd = line.cost_usd;
  if (isJsonText(line.subagents)) entry.subagents = line.subagents;
  if (isJsonText(line.detail)) entry.detail = line.detail;
  return entry;
}

function list(args: ParsedArgs): number {
  const lines = existsSync(projectDir(GLOBAL_PROJECT)) ? readLedger(openProject(GLOBAL_PROJECT)) : [];
  const latest = new Map<string, ListedCheck>();
  for (const line of lines) {
    if (line.type !== "harness.checked") continue;
    const entry = listed(line);
    if (entry !== undefined) latest.set(`${entry.harness}\u0000${entry.version}\u0000${entry.host}`, entry);
  }
  const checks = [...latest.values()].toSorted((a, b) => b.at.localeCompare(a.at));
  if (args.json) {
    console.log(JSON.stringify({ checks }));
    return 0;
  }
  if (checks.length === 0) console.log("· no gate checks yet; run-due runs one before the first run of a harness version");
  for (const entry of checks) {
    const mark = entry.outcome === "passed" ? "✓" : "!";
    const detail = entry.detail === undefined ? "" : `: ${entry.detail}`;
    const subagents = entry.outcome === "passed" ? `, subagents ${entry.subagents === "passed" ? "passed" : "not proven"}` : "";
    console.log(`${mark} ${entry.harness} ${entry.version} on ${entry.host}: ${entry.outcome}${subagents}, ${entry.at}${detail}`);
  }
  return 0;
}

export const harnessCommand: Command = {
  name: "harness",
  flags: ["who"],
  summary: "check that a harness version obeys the darius gate on this host, and list the checks",
  async run(args: ParsedArgs): Promise<number> {
    const verb = args.positional[0];
    switch (verb) {
      case "check":
        return check(args);
      case "list":
        return list(args);
      default:
        throw new UsageError(`harness needs a verb: ${VERBS}`);
    }
  },
};
