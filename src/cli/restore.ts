/**
 * `darius restore <name or path> [--runs-only] [--from-host <host>] [--dry-run] [--yes] [--json]`
 *
 * Brings this host's store back from a snapshot (src/core/restore.ts). Full:
 * the old store is moved aside, never deleted. `--runs-only`: only run
 * folders that are missing here. It refuses (exit 1) on a missing manifest, a
 * SHA-256 that does not match, a snapshot of another host without
 * `--from-host`, an active darius unit, a held lock, an archive entry outside
 * the store, and without `--yes` when stdin is not a terminal. `--dry-run`
 * runs every check and writes nothing.
 *
 * Only a person runs this verb, and only on purpose. There is no web button.
 *
 * Exit codes: 0 done (or a dry run that passed); 1 refused or failed; 2 usage.
 */

import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

import { hostId } from "../core/ledger.ts";
import { stateDir } from "../core/paths.ts";
import { runRestore, type RestoreDeps, type RestoreReport } from "../core/restore.ts";
import { resolveSnapshotSettings } from "../core/snapshot-settings.ts";
import { UsageError, type Command, type ParsedArgs } from "./registry.ts";

const USAGE = "usage: darius restore <name or path> [--runs-only] [--from-host <host>] [--dry-run] [--yes] [--json]";

/** `DARIUS_SYSTEMCTL`, else `systemctl`. The test script points it at a missing file. */
function systemctlProgram(): string {
  const program = process.env.DARIUS_SYSTEMCTL;
  return program === undefined || program === "" ? "systemctl" : program;
}

/**
 * `systemctl --user is-active <unit>`. Active and busy states count as active.
 * No systemctl at all means no units. Any other failure with no state printed
 * (no user session) throws, so the check refuses rather than guesses.
 */
function unitActive(unit: string): boolean {
  const ran = spawnSync(systemctlProgram(), ["--user", "is-active", unit], { encoding: "utf8", timeout: 10_000 });
  if (ran.error !== undefined) {
    if ("code" in ran.error && ran.error.code === "ENOENT") return false;
    throw ran.error;
  }
  const state = ran.stdout.trim().split("\n")[0] ?? "";
  if (state === "") throw new Error(ran.stderr.trim() === "" ? `systemctl exited ${String(ran.status)}` : ran.stderr.trim());
  return ["active", "activating", "reloading", "deactivating", "refreshing"].includes(state);
}

function ask(question: string): Promise<string> {
  const reader = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    reader.question(question, (answer) => {
      reader.close();
      resolve(answer);
    });
  });
}

export const realRestoreDeps: RestoreDeps = {
  unitActive,
  stdinIsTTY: () => process.stdin.isTTY === true,
  ask,
  now: () => new Date(),
};

function print(report: RestoreReport): void {
  const what = report.mode === "full" ? "full restore" : "runs-only restore";
  console.log(`${what} of ${report.name}${report.host === null ? "" : ` (host ${report.host}, ${report.snapshot_at ?? ""})`}${report.dry_run ? ", dry run" : ""}`);
  for (const check of report.checks) console.log(`  ${check.ok ? "ok     " : "refused"}  ${check.name}: ${check.detail}`);
  for (const project of report.projects) {
    console.log(`  · ${project.name}: ${String(project.files)} files, ${String(project.bytes)} bytes, ${String(project.runs)} runs`);
  }
  for (const path of report.trimmed) console.log(`  ${report.dry_run ? "would trim" : "trimmed"} 1 cut line in ${path}`);
  for (const path of report.newline_added) console.log(`  ${report.dry_run ? "would add" : "added"} the missing newline in ${path}`);
  for (const run of report.skipped_runs) console.log(`  skip ${run}`);
  for (const notice of report.notices) console.log(`  ! ${notice}`);
  if (!report.ok) {
    console.log(`refused: ${report.error ?? "a check failed"}`);
    return;
  }
  if (report.dry_run) {
    console.log(report.mode === "full" ? "dry run: every check passed; nothing was written" : `dry run: would restore ${String(report.restored)} run folder(s), skip ${String(report.skipped)}; nothing was written`);
    return;
  }
  if (report.moved_to !== null) console.log(`✓ restored; the old store is in ${report.moved_to}`);
  else console.log("✓ restored");
  console.log("Next:");
  for (const step of report.next) console.log(`  ${step}`);
}

function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  if (value === undefined || value === false) return undefined;
  if (value === true) throw new UsageError(`--${name} needs a value`);
  return value;
}

export async function runRestoreCommand(args: ParsedArgs, deps: RestoreDeps): Promise<number> {
  const target = args.positional[0];
  if (target === undefined || args.positional.length > 1) throw new UsageError(USAGE);
  const report = await runRestore(
    {
      target,
      mode: args.flags["runs-only"] === true ? "runs-only" : "full",
      fromHost: stringFlag(args, "from-host"),
      dryRun: args.flags["dry-run"] === true,
      yes: args.flags.yes === true,
      stateDir: stateDir(),
      snapshotDir: resolveSnapshotSettings().settings.dir,
      host: hostId(),
      run: process.env.DARIUS_RUN,
    },
    deps,
  );
  if (args.json) console.log(JSON.stringify(report));
  else print(report);
  return report.code;
}

export const restoreCommand: Command = {
  name: "restore",
  summary: "bring this host's store back from a snapshot, or only its run folders (--runs-only); a person runs it, never a run",
  usage: "restore <name or path> [--runs-only] [--from-host <host>] [--dry-run] [--yes]",
  run: (args: ParsedArgs): Promise<number> => runRestoreCommand(args, realRestoreDeps),
};
