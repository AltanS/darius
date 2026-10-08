/**
 * `darius spec check <spec-path> [--json]` (0.74.0): the deterministic spec
 * check of src/core/spec-check.ts. It runs no model and writes nothing.
 *
 * Exit codes follow the probe contract: 0 the spec passes, 1 it has
 * problems (each one listed) or the file does not exist, 2 usage (no path).
 *
 * JSON: `{ ok, risk, riskReasons, problems, reviewGate, reviewRequired, counsel }`.
 * `riskReasons` holds `{ pattern, class, line, text }`, one per matching
 * pattern and line.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { checkSpecFile, type SpecCheckResult } from "../core/spec-check.ts";
import { NotFoundError, UsageError, type Command, type ParsedArgs } from "./registry.ts";

const USAGE = "usage: darius spec check <spec-path> [--json]";

function formatText(path: string, result: SpecCheckResult): string {
  const lines = [`${result.ok ? "PASS" : "FAIL"} ${path}`, `RISK: ${result.risk}`];
  for (const reason of result.riskReasons) lines.push(`  ${reason.pattern} (${reason.class}) line ${reason.line}: ${reason.text}`);
  if (result.problems.length > 0) {
    lines.push("PROBLEMS:");
    for (const problem of result.problems) lines.push(`  - ${problem}`);
  }
  const review = result.reviewRequired ? "required" : result.risk === "high" ? "off (review_gate: off)" : "not needed";
  lines.push(`REVIEW: ${review}`);
  if (result.counsel !== null) lines.push(`COUNSEL: ${result.counsel}`);
  return lines.join("\n");
}

async function runCheck(args: ParsedArgs): Promise<number> {
  const path = args.positional[1];
  if (path === undefined || args.positional.length > 2) throw new UsageError(USAGE);
  // A missing file is "not found" (exit 1), not a usage error: the command line was well formed.
  if (!existsSync(resolve(process.cwd(), path))) throw new NotFoundError(`spec check: no spec at ${path}`);
  const checked = await checkSpecFile(path, process.cwd());
  if (checked.warning !== undefined) console.error(`darius: ${checked.warning}`);
  const { result } = checked;
  console.log(args.json ? JSON.stringify(result, null, 2) : formatText(path, result));
  return result.ok ? 0 : 1;
}

export const specCommand: Command = {
  name: "spec",
  help: USAGE,
  flags: [],
  summary: "check a spec without a model: checkable items, depends_on targets, risk and rollback",
  usage: "spec check <spec> [--json]",
  async run(args) {
    if (args.positional[0] === "check") return runCheck(args);
    throw new UsageError(USAGE);
  },
};
