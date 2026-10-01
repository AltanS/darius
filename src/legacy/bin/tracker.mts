#!/usr/bin/env -S node --experimental-strip-types --no-warnings
/**
 * tracker — CLI entrypoint
 *
 * Subcommands:
 *   root                          Walk up from cwd to find the .tracker/ directory
 *   show <spec-path> [--json]     Parse a spec file and display it
 *   status [--json]               Show tracker progress dashboard
 *   list milestones [--json]      List all milestones
 *   list specs [--milestone M1]   List specs (optionally filtered by milestone)
 *   next                          Return the next uncompleted task
 *   verify <spec-path> [--dry-run] [--recheck] [--timeout <s>]      Run all Command/Expected pairs
 *   verify-item <spec-path> <idx> [--dry-run] [--recheck] [--timeout <s>]  Verify one item
 *   mark <spec-path> <idx> --verified [--evidence "..."]  Set a checklist state
 *
 * Verification evidence:
 *   Every check appends one JSON line to <trackerRoot>/.verification-log.jsonl
 *   (committed — it is the evidence behind each `[x]`). A Command that is a
 *   shell no-op (echo/printf/true/:) classifies as `manual`: nothing runs,
 *   nothing is auto-marked, and `mark --verified` on it requires --evidence.
 *   worklog open <thread-id> --spec <path> [--message "..."]
 *   worklog append <thread-id> --section "<s>" --message "..."
 *   worklog close <thread-id> --status <done|blocked|cancelled>
 *   worklog list [--active] [--milestone M1] [--json]
 *   worklog index                 Rebuild worklog/00-INDEX.md (one row per file)
 *   claim <spec-ref> [--ttl 8h] [--takeover]   Advisory, expiring session claim
 *   release <spec-ref> [--force]               Drop a claim
 *   doctor [--fix]                Health check
 *   scan artifacts <path>         Scan for debug artifacts
 *   scan stubs <path>             Scan for stub implementations
 *   due [--json]                  List rituals + vigils that are due now
 *   ritual <add|run|complete|list>  Manage recurring rituals
 *   vigil <add|list|set-body|close> Manage one-shot pending verifications (vigils)
 *
 * Usage:
 *   node --experimental-strip-types --no-warnings bin/tracker.mts <subcommand> [args]
 */

import { realpathSync, readFileSync, existsSync, accessSync, statSync, constants as fsConstants } from "node:fs";
import { resolve, dirname, join, basename, delimiter } from "node:path";
import { isatty } from "node:tty";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parseSpec, toSpecJSON } from "../lib/documents/spec.ts";
import {
  readTrackerState,
  formatTrackerStatus,
  isTerminalMilestone,
  selectDueRituals,
  selectDueVigils,
  MilestoneJSONSchema,
  SpecListEntrySchema,
} from "../lib/tracker-reader.ts";
import type { DueRitual, MilestoneEntry, SpecEntry, VigilRecord } from "../lib/tracker-reader.ts";
import {
  initTracker,
  addMilestone,
  addSpec,
  markTask,
  setStatus,
  rebuildIndex,
  addRitual,
  stampRun,
  completeRun,
  addVigil,
  setVigilBody,
  closeVigil,
  resolveMilestonePath,
  SCAFFOLD_PLACEHOLDER_COMMAND,
} from "../lib/tracker-writer.ts";
import type {
  MarkState,
  MilestoneOverrideStatus,
  SpecStatus,
  TemplateKind,
} from "../lib/tracker-writer.ts";
import { todayIso } from "../lib/dates.ts";
import {
  runVerification,
  classifyItem,
  hasCwdPrefix,
  isTrivialCommand,
  DEFAULT_COMMAND_TIMEOUT_MS,
  type VerifyItemInput,
  type RunOptions,
} from "../lib/verification/runner.ts";
import {
  appendLedgerEntry,
  LEDGER_FILENAME,
} from "../lib/verification/ledger.ts";
import {
  openThread,
  appendThread,
  closeThread,
  listThreads,
  listWorklogFiles,
  findWorklogFileForThread,
  setStage,
  dispatchThread,
  parkThread,
  isWorklogIndexFile,
  WORKLOG_STAGES,
  type WorklogStage,
} from "../lib/worklog.ts";
import {
  distillWorklogFile,
  evaluateDistillEligibility,
  listDistillCandidates,
  DEFAULT_MIN_AGE_DAYS,
  STUB_WARN_BYTES,
} from "../lib/worklog-distill.ts";
import { rebuildWorklogIndex } from "../lib/worklog-index.ts";
import { runDoctor as executeDoctorCheck, formatDoctorReport } from "../lib/doctor.ts";
import {
  isUnrunnable,
  readAllVigilHealth,
  resolveFromMilestone,
  resolveFromSpec,
} from "../lib/vigil-health.ts";
import { scanArtifacts, scanStubs, formatScanMatches } from "../lib/scan.ts";
import {
  runMigrate,
  type TrackerVersion,
} from "../lib/migrate.ts";
import { CURRENT_SCHEMA_VERSION } from "../lib/version.ts";
import {
  runLoopCheck,
  formatLoopCheckReport,
  type LoopCheckResult,
} from "../lib/loop-check.ts";
import { parseFrontmatter, serializeFrontmatter } from "../lib/markdown/frontmatter.ts";
import { parseChecklist, type ChecklistItem } from "../lib/markdown/checklist.ts";
import {
  parseCounselTranscript,
  applyGate,
  applyRoundBudget,
  type GateDecision,
  type SingleDissentMode,
} from "../lib/counsel-gate.ts";
import {
  selectVerifiedUncommitted,
  hasVerificationPassed,
} from "../lib/uncommitted.ts";
import {
  readClaims,
  mutateClaims,
  inspectClaim,
  listClaims,
  formatClaimLine,
  normalizeClaimRef,
  resolveSessionId,
  parseTtl,
  formatTtl,
  formatDuration,
  claimsPath,
  TtlParseError,
  NO_SESSION_MESSAGE,
  CLAIMS_FILENAME,
  type ClaimStatus,
  type ClaimsDoc,
  type SessionClaim,
} from "../lib/session-claims.ts";
import { atomicWriteFileSync } from "../lib/atomic.ts";
import { discoverAgents } from "../lib/agent-discovery.ts";
import { execFileSync, spawnSync } from "node:child_process";
import { runDelegation } from "../lib/delegation.ts";
import { runHookDrift, runHookStop } from "../lib/hooks.ts";

/** Runs one tracker command. `argv` excludes the program name. Returns the exit code (verbs that fail call process.exit themselves). */
export async function main(argv: string[]): Promise<number> {
  const rawArgs = argv;
  const subcommand = rawArgs[0];

  if (subcommand === "root") {
    runRoot();
    return 0;
  }

  if (subcommand === "show") {
    runShow(rawArgs.slice(1));
    return 0;
  }

  if (subcommand === "status") {
    runStatus(rawArgs.slice(1));
    return 0;
  }

  if (subcommand === "list") {
    runList(rawArgs.slice(1));
    return 0;
  }

  if (subcommand === "next") {
    runNext(rawArgs.slice(1));
    return 0;
  }

  if (subcommand === "init") {
    runInit(rawArgs.slice(1));
    return 0;
  }

  if (subcommand === "add") {
    runAdd(rawArgs.slice(1));
    return 0;
  }

  if (subcommand === "mark") {
    runMark(rawArgs.slice(1));
    return 0;
  }

  if (subcommand === "set-status") {
    runSetStatus(rawArgs.slice(1));
    return 0;
  }

  if (subcommand === "index") {
    runIndex(rawArgs.slice(1));
    return 0;
  }

  if (subcommand === "verify") {
    runVerify(rawArgs.slice(1));
    return 0;
  }

  if (subcommand === "verify-item") {
    runVerifyItem(rawArgs.slice(1));
    return 0;
  }

  if (subcommand === "worklog") {
    runWorklog(rawArgs.slice(1));
    return 0;
  }

  if (subcommand === "doctor") {
    runDoctor(rawArgs.slice(1));
    return 0;
  }

  if (subcommand === "scan") {
    runScan(rawArgs.slice(1));
    return 0;
  }

  if (subcommand === "migrate") {
    runMigrateCommand(rawArgs.slice(1));
    return 0;
  }

  if (subcommand === "counsel-gate") {
    runCounselGate(rawArgs.slice(1));
    return 0;
  }

  if (subcommand === "agents") {
    runAgents(rawArgs.slice(1));
    return 0;
  }

  if (subcommand === "uncommitted-verified") {
    runUncommittedVerified(rawArgs.slice(1));
    return 0;
  }

  if (subcommand === "claim") {
    runClaim(rawArgs.slice(1));
    return 0;
  }

  if (subcommand === "release") {
    runRelease(rawArgs.slice(1));
    return 0;
  }

  if (subcommand === "loop-check") {
    runLoopCheckCommand(rawArgs.slice(1));
    return 0;
  }

  if (subcommand === "hook-stop") {
    return runHookStop();
  }

  if (subcommand === "hook-drift") {
    return runHookDrift();
  }

  if (subcommand === "delegation") {
    return runDelegation(rawArgs.slice(1));
  }

  if (subcommand === "due") {
    runDue(rawArgs.slice(1));
    return 0;
  }

  if (subcommand === "ritual") {
    runRitual(rawArgs.slice(1));
    return 0;
  }

  if (subcommand === "vigil") {
    runVigil(rawArgs.slice(1));
    return 0;
  }

  if (subcommand === "archive-check") {
    runArchiveCheck(rawArgs.slice(1));
    return 0;
  }

  if (!subcommand) {
    process.stderr.write("Usage: tracker <subcommand> [args]\n");
    process.stderr.write("  root\n");
    process.stderr.write("  show <spec-path> [--json]\n");
    process.stderr.write("  status [--json]\n");
    process.stderr.write("  list milestones [--json]\n");
    process.stderr.write("  list specs [--milestone <slug>] [--json]\n");
    process.stderr.write("  next\n");
    process.stderr.write("  init\n");
    process.stderr.write("  add milestone --name <name> --slug <slug> --owner <email> [--target <date>] [--number N]\n");
    process.stderr.write("  add spec --milestone <slug> --name <name> --template <generic|api-endpoint|ui-component|library> [--depends-on <path>...] [--agent <name>] [--manual --owner <who> --expires <YYYY-MM-DD>]\n");
    process.stderr.write("      Scaffolded Commands are deliberate failures (`test -f /nonexistent/...`) — replace them with real\n");
    process.stderr.write("      assertions. --manual scaffolds operator decisions instead, and needs a named owner and an expiry.\n");
    process.stderr.write("  mark <spec-path> <task-idx> --verified|--in-progress|--blocked|--skipped|--pending [--evidence \"...\"]\n");
    process.stderr.write("  set-status <spec-path|milestone-folder> <status>\n");
    process.stderr.write("  index --rebuild\n");
    process.stderr.write("  worklog index\n");
    process.stderr.write("  counsel-gate <transcript-path> [--spec <spec-path>] [--threshold N] [--max-rounds N] [--json]\n");
    process.stderr.write("  agents [--json]\n");
    process.stderr.write("  uncommitted-verified [--json]\n");
    process.stderr.write("  claim <spec-ref> [--session <id>] [--ttl 8h] [--takeover] [--json]\n");
    process.stderr.write("  claim --list [--json]\n");
    process.stderr.write("  release <spec-ref> [--session <id>] [--force] [--json]\n");
    process.stderr.write("  loop-check [--json] [--bounce <agent-id>] [--max-bounces N]\n");
    process.stderr.write("  hook-stop   (Stop hook, reads the hook JSON on stdin)\n");
    process.stderr.write("  hook-drift  (PostToolUse hook, reads the hook JSON on stdin)\n");
    process.stderr.write("  delegation <validate|return-validate> '<json>'\n");
    process.stderr.write("  due [--json]\n");
    process.stderr.write("  ritual add --name <name> --slug <slug> [--cadence <7d|2w|1m>] [--due <date>] [--agent <name>] [--owner <email>]\n");
    process.stderr.write("  ritual run <slug> [--date <YYYY-MM-DD>]\n");
    process.stderr.write("  ritual complete <slug> [--today <YYYY-MM-DD>]\n");
    process.stderr.write("  ritual list [--json]\n");
    process.stderr.write('  vigil add <slug> [--name <name>] [--due <YYYY-MM-DD>] [--until "<event>"] [--from <ref>] [--agent <name>] [--stdin | --content <path>]\n');
    process.stderr.write("      --stdin reads the vigil BODY (its `## Verification Checklist`) from stdin, replacing the scaffold.\n");
    process.stderr.write("  vigil set-body <slug> (--stdin | --content <path>)\n");
    process.stderr.write("  vigil list [--all] [--json]\n");
    process.stderr.write("  vigil close <slug> --verdict <held|failed> [--date <YYYY-MM-DD>]\n");
    process.stderr.write("  archive-check <milestone-folder|slug>\n");
    return 1;
  }

  process.stderr.write(`Unknown subcommand: ${subcommand}\n`);
  return 1;
}

// ---------------------------------------------------------------------------
// tracker root
// ---------------------------------------------------------------------------

function runRoot(): void {
  const trackerDir = findTrackerRoot(process.cwd());
  if (trackerDir === null) {
    process.stderr.write("tracker: no .tracker/ directory found\n");
    process.exit(1);
  }
  process.stdout.write(`${trackerDir}\n`);
}

/**
 * Walk up from `startDir` looking for a `.tracker/` directory.
 * Returns the absolute path to the `.tracker/` directory, or null.
 */
function findTrackerRoot(startDir: string): string | null {
  let dir = resolve(startDir);

  const maxDepth = 50;
  let depth = 0;

  while (depth < maxDepth) {
    const candidate = join(dir, ".tracker");
    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }

    dir = parent;
    depth++;
  }

  return null;
}

// ---------------------------------------------------------------------------
// tracker show <spec-path> [--json]
// ---------------------------------------------------------------------------

function runShow(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  const pathArg = positionals[0];

  if (!pathArg) {
    process.stderr.write("Usage: tracker show <spec-path> [--json]\n");
    process.exit(1);
  }

  const filePath = resolve(pathArg);

  if (!existsSync(filePath)) {
    process.stderr.write(`tracker show: file not found: ${filePath}\n`);
    process.exit(1);
  }

  const raw = readFileSync(filePath, "utf-8");

  try {
    const view = parseSpec(raw, filePath);

    if (values.json) {
      const json = toSpecJSON(view, filePath);
      process.stdout.write(JSON.stringify(json, null, 2) + "\n");
      return;
    }

    // Human-readable output (non-JSON mode)
    process.stdout.write(`Title:  ${view.title}\n`);
    process.stdout.write(`Status: ${view.computedStatus}\n`);
    process.stdout.write(`Tasks:  ${view.verifiedCount}/${view.totalCount}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`tracker show: ${message}\n`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// tracker status [--json]
// ---------------------------------------------------------------------------

function runStatus(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
      detailed: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const trackerRoot = findTrackerRoot(process.cwd());
  if (trackerRoot === null) {
    process.stderr.write("tracker: no .tracker/ directory found\n");
    process.exit(1);
  }

  const state = readTrackerState(trackerRoot);

  if (values.json) {
    // Emit JSON representation of the full tracker state
    const json = {
      projectName: state.projectName,
      milestones: state.milestones.map(milestoneToJSON),
    };
    process.stdout.write(JSON.stringify(json, null, 2) + "\n");
    return;
  }

  const output = formatTrackerStatus(state);
  process.stdout.write(output);
}

// ---------------------------------------------------------------------------
// tracker list milestones [--json]
// ---------------------------------------------------------------------------

function runList(args: string[]): void {
  const subcommand = args[0];

  if (subcommand === "milestones") {
    runListMilestones(args.slice(1));
    return;
  }

  if (subcommand === "specs") {
    runListSpecs(args.slice(1));
    return;
  }

  process.stderr.write("Usage: tracker list <milestones|specs> [options]\n");
  process.exit(1);
}

function runListMilestones(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const trackerRoot = findTrackerRoot(process.cwd());
  if (trackerRoot === null) {
    process.stderr.write("tracker: no .tracker/ directory found\n");
    process.exit(1);
  }

  const state = readTrackerState(trackerRoot);

  if (values.json) {
    const json = state.milestones.map(milestoneToJSON);
    // Validate before emitting
    const validated = json.map((m) => MilestoneJSONSchema.parse(m));
    process.stdout.write(JSON.stringify(validated, null, 2) + "\n");
    return;
  }

  // Human-readable
  for (const m of state.milestones) {
    const brokenSuffix =
      m.brokenSpecs.length > 0 ? `  ⚠ ${m.brokenSpecs.length} broken` : "";
    process.stdout.write(
      `M${m.number}  ${m.name}  ${m.verified}/${m.total}  ${m.status}${brokenSuffix}\n`,
    );
  }
}

function runListSpecs(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
      milestone: { type: "string" },
      session: { type: "string" },
    },
    allowPositionals: false,
  });

  const trackerRoot = findTrackerRoot(process.cwd());
  if (trackerRoot === null) {
    process.stderr.write("tracker: no .tracker/ directory found\n");
    process.exit(1);
  }

  const state = readTrackerState(trackerRoot);

  let specs: Array<{ spec: SpecEntry; milestone: MilestoneEntry }> = [];
  for (const milestone of state.milestones) {
    if (
      values.milestone &&
      !milestone.slug.toLowerCase().includes(values.milestone.toLowerCase())
    ) {
      continue;
    }
    for (const spec of milestone.specs) {
      specs.push({ spec, milestone });
    }
  }

  // Claims are read ONCE for the whole listing (one small file), and only
  // annotate — a claimed spec is still listed, because hiding it would make
  // the collision less visible, not more.
  const claimsDoc = readClaims(trackerRoot);
  const listSession = resolveSessionId(values.session);
  const claimFor = (spec: SpecEntry): ClaimStatus =>
    inspectClaim(
      claimsDoc,
      normalizeClaimRef({ trackerRoot, ref: spec.absolutePath }),
      listSession,
    );

  if (values.json) {
    const json = specs.map(({ spec, milestone }) => {
      const entry = {
        path: spec.relativePath,
        file: spec.file,
        milestoneSlug: milestone.slug,
        title: spec.view.title,
        status: spec.effectiveStatus,
        verified: spec.view.verifiedCount,
        total: spec.view.totalCount,
        depends_on: spec.view.depends_on ?? [],
      };
      const claim = claimFor(spec);
      const parsed = SpecListEntrySchema.parse(entry);
      if (claim.state === "unclaimed") return parsed;
      return {
        ...parsed,
        claim: {
          state: claim.state,
          session: claim.claim?.session ?? null,
          at: claim.claim?.at ?? null,
          expiresAt: claim.claim?.expiresAt ?? null,
        },
      };
    });
    process.stdout.write(JSON.stringify(json, null, 2) + "\n");
    return;
  }

  // Human-readable
  for (const { spec, milestone } of specs) {
    const claim = claimFor(spec);
    const marker =
      claim.state === "unclaimed" ? ""
      : claim.state === "stale"
        ? `  [CLAIM STALE: session ${claim.claim?.session}, ${claim.expiryLabel}]`
        : claim.state === "own"
          ? `  [CLAIMED by this session, ${claim.expiryLabel}]`
          : `  [CLAIMED: session ${claim.claim?.session}, ${claim.ageLabel} ago]`;
    process.stdout.write(
      `${milestone.slug}/${spec.file}  ${spec.view.verifiedCount}/${spec.view.totalCount}  ${spec.effectiveStatus}${marker}\n`,
    );
  }
}

// ---------------------------------------------------------------------------
// tracker next
// ---------------------------------------------------------------------------

function runNext(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: {
      session: { type: "string" },
      force: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const trackerRoot = findTrackerRoot(process.cwd());
  if (trackerRoot === null) {
    process.stderr.write("tracker: no .tracker/ directory found\n");
    process.exit(1);
  }

  const state = readTrackerState(trackerRoot);

  // Walk milestones in order, then specs in order, then tasks in order.
  // Skip terminal milestones, Waiting specs, and items that are not actionable.
  for (const milestone of state.milestones) {
    if (isTerminalMilestone(milestone.status)) {
      continue;
    }

    if (milestone.brokenSpecs.length > 0) {
      const b = milestone.brokenSpecs[0]!;
      process.stdout.write(
        `[!] Fix unparseable spec: ${b.file} (${milestone.slug}) — ${b.error}\n`,
      );
      return;
    }

    for (const spec of milestone.specs) {
      if (spec.effectiveStatus === "Waiting") continue;
      if (spec.view.computedStatus === "Complete") continue;
      if (spec.view.computedStatus === "Skipped") continue;

      for (const item of spec.view.checklistItems) {
        if (item.state === "pending" || item.state === "in_progress") {
          // Gate at the point of HANDING OUT the work, not while scanning:
          // a spec claimed by someone else but already complete would
          // otherwise refuse a task it was never going to offer.
          const blocked = claimGate({
            trackerRoot,
            specRef: spec.absolutePath,
            sessionFlag: values.session,
            force: values.force,
            command: "next",
          });
          if (blocked) process.exit(1);

          process.stdout.write(
            `[ ] ${item.label} (${spec.file})\n`,
          );
          return;
        }
      }
    }
  }

  process.stdout.write("All tasks complete\n");
}

// ---------------------------------------------------------------------------
// tracker init
// ---------------------------------------------------------------------------

function runInit(_args: string[]): void {
  const projectRoot = process.cwd();
  try {
    initTracker({ projectRoot });
    process.stdout.write(`tracker: initialized .tracker/ in ${projectRoot}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`tracker init: ${message}\n`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// tracker add milestone | spec
// ---------------------------------------------------------------------------

function runAdd(args: string[]): void {
  const kind = args[0];

  if (kind === "milestone") {
    runAddMilestone(args.slice(1));
    return;
  }

  if (kind === "spec") {
    runAddSpec(args.slice(1));
    return;
  }

  process.stderr.write("Usage: tracker add <milestone|spec> [options]\n");
  process.exit(1);
}

function runAddMilestone(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: {
      name: { type: "string" },
      slug: { type: "string" },
      owner: { type: "string" },
      target: { type: "string" },
      number: { type: "string" },
    },
    allowPositionals: false,
  });

  if (!values.name || !values.slug || !values.owner) {
    process.stderr.write(
      "Usage: tracker add milestone --name <name> --slug <slug> --owner <email> [--target <date>] [--number N]\n",
    );
    process.exit(1);
  }

  // Explicit number is opt-in; auto-mint is the default. Either way the
  // namespace guard in addMilestone refuses a number an active or ARCHIVED
  // milestone already holds under any prefix (M / DLP / ATH / BLD).
  let explicitNumber: number | undefined;
  if (values.number !== undefined) {
    if (!/^\d+$/.test(values.number)) {
      process.stderr.write(
        `tracker add milestone: invalid --number "${values.number}" (expected a positive integer)\n`,
      );
      process.exit(1);
    }
    explicitNumber = parseInt(values.number, 10);
  }

  const trackerRoot = requireTrackerRoot();

  try {
    const result = addMilestone({
      trackerRoot,
      name: values.name,
      slug: values.slug,
      owner: values.owner,
      target: values.target,
      number: explicitNumber,
    });

    if (result.kind === "exists") {
      process.stdout.write(
        `tracker add milestone: milestone with slug "${values.slug}" already exists at ${result.folderPath}\n`,
      );
      return;
    }

    process.stdout.write(
      `tracker add milestone: created M${result.number}-${values.slug} at ${result.folderPath}\n`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`tracker add milestone: ${message}\n`);
    process.exit(1);
  }
}

function runAddSpec(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: {
      milestone: { type: "string" },
      name: { type: "string" },
      template: { type: "string" },
      "depends-on": { type: "string", multiple: true },
      agent: { type: "string" },
      manual: { type: "boolean", default: false },
      owner: { type: "string" },
      expires: { type: "string" },
    },
    allowPositionals: false,
  });

  if (!values.milestone || !values.name || !values.template) {
    process.stderr.write(
      "Usage: tracker add spec --milestone <slug> --name <name> --template <generic|api-endpoint|ui-component|library> [--depends-on <path>...] [--agent <name>] [--manual --owner <who> --expires <YYYY-MM-DD>]\n",
    );
    process.exit(1);
  }

  // --manual is all-or-nothing: an operator decision with no owner and no
  // expiry is the promise this guard exists to refuse.
  if (values.manual && (!values.owner || !values.expires)) {
    process.stderr.write(
      "tracker add spec: --manual requires --owner <who> and --expires <YYYY-MM-DD>\n",
    );
    process.exit(1);
  }
  if (!values.manual && (values.owner || values.expires)) {
    process.stderr.write(
      "tracker add spec: --owner/--expires only apply with --manual\n",
    );
    process.exit(1);
  }

  const validTemplates: TemplateKind[] = ["generic", "api-endpoint", "ui-component", "library"];
  if (!validTemplates.includes(values.template as TemplateKind)) {
    process.stderr.write(
      `tracker add spec: invalid template "${values.template}". Allowed: ${validTemplates.join(", ")}\n`,
    );
    process.exit(1);
  }

  const trackerRoot = requireTrackerRoot();

  try {
    const result = addSpec({
      trackerRoot,
      milestoneArg: values.milestone,
      name: values.name,
      template: values.template as TemplateKind,
      dependsOn: values["depends-on"],
      agent: values.agent,
      manual: values.manual
        ? { owner: values.owner as string, expires: values.expires as string }
        : undefined,
    });

    if (result.kind === "exists") {
      process.stdout.write(
        `tracker add spec: spec "${values.name}" already exists at ${result.filePath}\n`,
      );
      return;
    }

    process.stdout.write(
      `tracker add spec: created ${result.filePath}\n`,
    );
    if (!values.manual) {
      process.stdout.write(
        `  Scaffolded checks fail on purpose (\`${SCAFFOLD_PLACEHOLDER_COMMAND}\`) — replace each\n` +
          "  Command with a real assertion. A placeholder that exits 0 reads like a check and is not one.\n",
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`tracker add spec: ${message}\n`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// tracker mark <spec-path> <task-idx> --verified|--in-progress|--blocked|--skipped|--pending
// ---------------------------------------------------------------------------

function runMark(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    options: {
      verified: { type: "boolean", default: false },
      "in-progress": { type: "boolean", default: false },
      blocked: { type: "boolean", default: false },
      skipped: { type: "boolean", default: false },
      pending: { type: "boolean", default: false },
      evidence: { type: "string" },
    },
    allowPositionals: true,
  });

  const specPath = positionals[0];
  const taskIdxStr = positionals[1];

  if (!specPath || !taskIdxStr) {
    process.stderr.write(
      "Usage: tracker mark <spec-path> <task-idx> --verified|--in-progress|--blocked|--skipped|--pending [--evidence \"...\"]\n",
    );
    process.exit(1);
  }

  const taskIndex = parseInt(taskIdxStr, 10);
  if (isNaN(taskIndex) || taskIndex < 0) {
    process.stderr.write(`tracker mark: invalid task index "${taskIdxStr}"\n`);
    process.exit(1);
  }

  let state: MarkState;
  if (values.verified) state = "verified";
  else if (values["in-progress"]) state = "in-progress";
  else if (values.blocked) state = "blocked";
  else if (values.skipped) state = "skipped";
  else if (values.pending) state = "pending";
  else {
    process.stderr.write(
      "tracker mark: must specify one of --verified, --in-progress, --blocked, --skipped, --pending\n",
    );
    process.exit(1);
    return;
  }

  const evidence = values.evidence?.trim();

  if (evidence !== undefined && evidence !== "" && state !== "verified") {
    process.stderr.write(
      `tracker mark: --evidence only applies to --verified (got --${state})\n`,
    );
    process.exit(1);
  }

  const trackerRoot = requireTrackerRoot();
  const absSpecPath = resolve(specPath);

  // Read the item's Command so a trivial one can be refused BEFORE the file is
  // written. Parsed straight from raw frontmatter + checklist rather than
  // through parseSpec: a legacy spec that fails schema validation must still be
  // markable, exactly as it was before this check existed.
  const targetItem = findChecklistItem(absSpecPath, taskIndex);
  const commandIsTrivial =
    targetItem?.command !== null &&
    targetItem?.command !== undefined &&
    isTrivialCommand(targetItem.command);

  if (state === "verified" && commandIsTrivial && (evidence === undefined || evidence === "")) {
    process.stderr.write(
      `tracker mark: task ${taskIndex} has a shell no-op Command ` +
        `(${JSON.stringify(targetItem?.command ?? "")}) — running it proves nothing, so a bare\n` +
        `  --verified would be an unevidenced claim. Re-run with what you actually checked:\n` +
        `  tracker mark ${specPath} ${taskIndex} --verified --evidence "<what was checked, how, by whom/which agent, tier>"\n`,
    );
    process.exit(1);
  }

  try {
    markTask({
      specPath: absSpecPath,
      taskIndex,
      state,
      trackerRoot,
      // `mark` never executes anything — every tick it writes is an assertion.
      method: "manual",
    });

    if (state === "verified") {
      const logged = appendLedgerEntry({
        trackerRoot,
        specPath: absSpecPath,
        index: taskIndex,
        label: targetItem?.label ?? "",
        command: targetItem?.command ?? null,
        expected: targetItem?.expected ?? null,
        exitCode: null,
        outcome: "manual",
        evidence,
      });
      if (!logged) {
        process.stderr.write(
          `tracker mark: warning — could not append to ${LEDGER_FILENAME}; the [x] stands but is unevidenced\n`,
        );
      }
    }

    process.stdout.write(`tracker mark: task ${taskIndex} marked as ${state} in ${specPath}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`tracker mark: ${message}\n`);
    process.exit(1);
  }
}

/**
 * Read one checklist item straight out of a spec file, or null when the file is
 * missing/unreadable or the index is out of range.
 *
 * Deliberately does NOT go through parseSpec: `mark` must keep working on specs
 * whose frontmatter fails schema validation (that is half of what `mark` is for),
 * and this lookup is advisory — it decides whether evidence is required, and
 * `markTask` still does the authoritative range check.
 */
function findChecklistItem(
  absSpecPath: string,
  taskIndex: number,
): ChecklistItem | null {
  try {
    const raw = readFileSync(absSpecPath, "utf-8");
    const { content } = parseFrontmatter(raw);
    return parseChecklist(content).find((i) => i.index === taskIndex) ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// tracker set-status <spec-path|milestone-folder> <status>
// ---------------------------------------------------------------------------

function runSetStatus(args: string[]): void {
  const { positionals } = parseArgs({
    args,
    options: {},
    allowPositionals: true,
  });

  const target = positionals[0];
  const statusArg = positionals[1];

  if (!target || !statusArg) {
    process.stderr.write(
      "Usage: tracker set-status <spec-path|milestone-folder> <status>\n" +
        "  Spec statuses: Not Started | In Progress | Complete | Blocked | Archived\n" +
        "  Milestone-only statuses: Skipped | Deferred | Closed\n",
    );
    process.exit(1);
  }

  const validStatuses: (SpecStatus | MilestoneOverrideStatus)[] = [
    "Not Started",
    "In Progress",
    "Complete",
    "Blocked",
    "Archived",
    "Skipped",
    "Deferred",
    "Closed",
  ];

  if (!validStatuses.includes(statusArg as SpecStatus | MilestoneOverrideStatus)) {
    process.stderr.write(
      `tracker set-status: invalid status "${statusArg}". Allowed: ${validStatuses.join(", ")}\n`,
    );
    process.exit(1);
  }

  const trackerRoot = requireTrackerRoot();

  try {
    setStatus({
      target: resolve(target),
      status: statusArg as SpecStatus | MilestoneOverrideStatus,
      trackerRoot,
    });
    process.stdout.write(`tracker set-status: set status to "${statusArg}" in ${target}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`tracker set-status: ${message}\n`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// tracker index --rebuild
// ---------------------------------------------------------------------------

function runIndex(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: {
      rebuild: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (!values.rebuild) {
    process.stderr.write("Usage: tracker index --rebuild\n");
    process.exit(1);
  }

  const trackerRoot = requireTrackerRoot();

  try {
    rebuildIndex(trackerRoot);
    process.stdout.write(`tracker index: rebuilt ${join(trackerRoot, "00-INDEX.md")}\n`);

    // The worklog index rides the same rebuild so update-index and wrap-up get
    // it for free. A project with no worklog directory has nothing to index —
    // that is a silent no-op, not a failure.
    const worklogIndex = rebuildWorklogIndex(trackerRoot);
    if (worklogIndex !== null) {
      process.stdout.write(
        `tracker index: rebuilt ${worklogIndex.path} (${worklogIndex.rows.length} worklog file(s))\n`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`tracker index: ${message}\n`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// requireTrackerRoot — exit 1 if no .tracker/ found
// ---------------------------------------------------------------------------

function requireTrackerRoot(): string {
  const trackerRoot = findTrackerRoot(process.cwd());
  if (trackerRoot === null) {
    process.stderr.write("tracker: no .tracker/ directory found\n");
    process.exit(1);
  }
  return trackerRoot;
}

// ---------------------------------------------------------------------------
// Verification run environment — shared by `verify` and `verify-item`
// ---------------------------------------------------------------------------

/**
 * Parse `--timeout <seconds>` into milliseconds.
 *
 * Seconds, not milliseconds: the flag exists so a human can say "this vitest
 * suite needs four minutes", and nobody writes 240000 for that. Refuses
 * anything that is not a positive whole number rather than silently falling
 * back to the default — a mistyped budget that quietly reverts to 60s would
 * reintroduce the very failure the flag exists to fix.
 */
function parseTimeoutFlag(raw: string | undefined, command: string): number {
  if (raw === undefined) return DEFAULT_COMMAND_TIMEOUT_MS;
  const seconds = Number(raw);
  if (!Number.isInteger(seconds) || seconds <= 0) {
    process.stderr.write(
      `tracker ${command}: --timeout takes a positive whole number of seconds (got ${JSON.stringify(raw)})\n`,
    );
    process.exit(1);
  }
  return seconds * 1000;
}

/**
 * The directory every Command runs in: the workspace root, i.e. the parent of
 * `.tracker/`.
 *
 * Deterministic by construction. Before v10.7.1 the child inherited the CLI's
 * own cwd, so the same checklist item could pass when run from the repo root
 * and fail when run from a subdirectory — and nothing in the spec said which
 * one it was written against. The consequence for spec authors: in a multi-repo
 * workspace a repo-scoped command must carry its own `cd <repo> && …`.
 */
function verificationCwd(trackerRoot: string): string {
  return dirname(resolve(trackerRoot));
}

type DryRunBucket =
  | "would-execute"
  | "would-stat"
  | "manual"
  | "grammar-error"
  | "no-pair"
  | "already-done";

type DryRunVerdict = { bucket: DryRunBucket; verdict: string; detail: string[] };

/**
 * Decide — without running, statting, or writing anything — what a real run
 * would do with this item.
 */
function dryRunVerdictFor(
  item: ChecklistItem,
  opts: { runOptions: RunOptions; recheck: boolean },
): DryRunVerdict {
  const wouldRecheck = opts.recheck && item.state === "verified";

  if (item.state === "skipped") {
    return { bucket: "already-done", verdict: "SKIPPED — left alone", detail: [] };
  }
  if (item.state === "verified" && !wouldRecheck) {
    return {
      bucket: "already-done",
      verdict: "ALREADY DONE — not re-run (add --recheck to re-execute it)",
      detail: [],
    };
  }

  const classification = classifyItem(
    {
      command: item.command,
      expected: item.expected,
      index: item.index,
      label: item.label,
    },
    opts.runOptions,
  );

  const prefix = wouldRecheck ? "RECHECK — " : "";

  switch (classification.kind) {
    case "no-pair":
      return {
        bucket: "no-pair",
        verdict: "NO COMMAND/EXPECTED PAIR — nothing to run",
        detail: [],
      };
    case "grammar-error":
      return {
        bucket: "grammar-error",
        verdict: `GRAMMAR ERROR — ${classification.reason}`,
        detail: [`Expected: ${item.expected ?? "(none)"}`],
      };
    case "manual":
      return {
        bucket: "manual",
        verdict: "MANUAL — Command is a shell no-op; it is never executed and never auto-marked",
        detail: [`Command:  ${item.command ?? "(none)"}`],
      };
    case "file-check":
      return {
        bucket: "would-stat",
        verdict: `${prefix}WOULD STAT — file existence only, no subprocess`,
        detail: [`Path:     ${classification.path}`],
      };
    case "would-execute":
      return {
        bucket: "would-execute",
        verdict: `${prefix}WOULD EXECUTE`,
        detail: [
          `Command:  ${classification.command}`,
          `Expected: ${classification.expected}`,
        ],
      };
  }
}

/**
 * Print the dry-run report for a set of checklist items.
 *
 * This is the entire implementation of `--dry-run`: classification and
 * reporting, zero subprocesses, zero writes. Before v10.7.1 `--dry-run`
 * executed every Command and merely suppressed the ledger append and the `[x]`
 * — so previewing a spec whose Command hits production ran it against
 * production.
 */
function printDryRunReport(opts: {
  command: string;
  items: ChecklistItem[];
  runOptions: RunOptions;
  recheck: boolean;
}): void {
  const counts: Record<DryRunBucket, number> = {
    "would-execute": 0,
    "would-stat": 0,
    manual: 0,
    "grammar-error": 0,
    "no-pair": 0,
    "already-done": 0,
  };

  const timeoutSeconds = (opts.runOptions.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS) / 1000;

  process.stdout.write(
    `DRY RUN (tracker ${opts.command}) — nothing was executed and nothing was written ` +
      `(no ledger line, no [x]).\n` +
      `Commands would run from: ${opts.runOptions.cwd ?? process.cwd()} (timeout ${timeoutSeconds}s)\n\n`,
  );

  for (const item of opts.items) {
    const { bucket, verdict, detail } = dryRunVerdictFor(item, {
      runOptions: opts.runOptions,
      recheck: opts.recheck,
    });
    counts[bucket]++;
    process.stdout.write(`  [${item.index}] ${item.label} — ${verdict}\n`);
    for (const line of detail) {
      process.stdout.write(`      ${line}\n`);
    }
  }

  process.stdout.write(
    `\n${counts["would-execute"]} would execute, ${counts["would-stat"]} would stat, ` +
      `${counts.manual} manual, ${counts["grammar-error"]} grammar error, ` +
      `${counts["no-pair"]} no pair, ${counts["already-done"]} already done\n`,
  );
}

// ---------------------------------------------------------------------------
// tracker verify <spec-path> [--dry-run] [--recheck] [--timeout <seconds>]
// ---------------------------------------------------------------------------

function runVerify(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    options: {
      "dry-run": { type: "boolean", default: false },
      recheck: { type: "boolean", default: false },
      timeout: { type: "string" },
    },
    allowPositionals: true,
  });

  const specPath = positionals[0];
  if (!specPath) {
    process.stderr.write(
      "Usage: tracker verify <spec-path> [--dry-run] [--recheck] [--timeout <seconds>]\n",
    );
    process.exit(1);
  }

  const absPath = resolve(specPath);
  if (!existsSync(absPath)) {
    process.stderr.write(`tracker verify: spec not found: ${absPath}\n`);
    process.exit(1);
  }

  const timeoutMs = parseTimeoutFlag(values.timeout, "verify");
  const trackerRoot = requireTrackerRoot();
  const runOptions: RunOptions = { cwd: verificationCwd(trackerRoot), timeoutMs };
  const raw = readFileSync(absPath, "utf-8");

  let view;
  try {
    view = parseSpec(raw, absPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`tracker verify: parse error: ${message}\n`);
    process.exit(1);
  }

  // --dry-run is a classification pass and returns here: nothing below this
  // line — no spawn, no ledger append, no mark — may run under it.
  if (values["dry-run"]) {
    printDryRunReport({
      command: "verify",
      items: view.checklistItems,
      runOptions,
      recheck: values.recheck,
    });
    return;
  }

  let verified = 0;
  let failed = 0;
  let alreadyDone = 0;
  let manual = 0;
  let timedOut = 0;
  let rechecked = 0;
  const failures: Array<{ index: number; label: string; reason: string }> = [];
  const manualItems: Array<{ index: number; label: string }> = [];
  const timeouts: Array<{ index: number; label: string; reason: string }> = [];
  const regressions: Array<{ index: number; label: string; reason: string }> = [];
  const unrecheckable: Array<{ index: number; label: string; reason: string }> = [];

  for (const item of view.checklistItems) {
    // --recheck re-executes items that are ALREADY `[x]`. Without it, verify is
    // a ratchet: it walks past every tick it ever wrote and so can never see a
    // check that used to pass and no longer does.
    const isRecheck = values.recheck && item.state === "verified";

    if ((item.state === "verified" || item.state === "skipped") && !isRecheck) {
      alreadyDone++;
      continue;
    }

    if (item.command === null || item.expected === null) {
      if (isRecheck) {
        alreadyDone++;
        unrecheckable.push({
          index: item.index,
          label: item.label,
          reason: "no Command/Expected pair — the [x] rests on manual evidence",
        });
      }
      continue;
    }

    const input: VerifyItemInput = {
      command: item.command,
      expected: item.expected,
      index: item.index,
      label: item.label,
    };

    const result = runVerification(input, runOptions);

    // A previously-verified item that now fails is a REGRESSION, not a fail:
    // it passed once. The distinction is kept in the ledger because that is the
    // record someone reads months later.
    const isRegression =
      isRecheck && (result.outcome === "fail" || result.outcome === "error");

    // Ledger every check attempt — including the ones that classified as
    // manual and never ran.
    appendLedgerEntry({
      trackerRoot,
      specPath: absPath,
      index: item.index,
      label: item.label,
      command: item.command,
      expected: item.expected,
      exitCode: result.exitCode,
      outcome: isRegression ? "regression" : result.outcome,
    });

    if (result.outcome === "pass") {
      try {
        markTask({
          specPath: absPath,
          taskIndex: item.index,
          state: "verified",
          trackerRoot,
          method: "executed",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`tracker verify: failed to mark task ${item.index}: ${message}\n`);
      }
      if (isRecheck) {
        // Re-stamps verification_passed: the tick is now backed by a run that
        // happened today, not one from whenever the box was first ticked.
        rechecked++;
      } else {
        verified++;
      }
    } else if (result.outcome === "manual") {
      if (isRecheck) {
        alreadyDone++;
        unrecheckable.push({
          index: item.index,
          label: item.label,
          reason: "Command is a shell no-op — the [x] rests on manual evidence",
        });
      } else {
        // Never auto-marked: nothing ran, so there is nothing to stand behind
        // the tick. The item simply stays unchecked until someone records what
        // they actually did.
        manual++;
        manualItems.push({ index: item.index, label: item.label });
      }
    } else if (result.outcome === "timeout") {
      timedOut++;
      timeouts.push({ index: item.index, label: item.label, reason: result.reason });
    } else if (isRegression) {
      regressions.push({ index: item.index, label: item.label, reason: result.reason });
    } else if (result.outcome === "fail" || result.outcome === "error") {
      failed++;
      failures.push({ index: item.index, label: item.label, reason: result.reason });
    }
  }

  // Print summary
  let summary = `${verified} verified, ${failed} failed, ${alreadyDone} already done, ${manual} manual`;
  if (timedOut > 0) {
    summary += `, ${timedOut} timed out`;
  }
  if (values.recheck) {
    summary += `, ${rechecked} rechecked, ${regressions.length} regression${regressions.length === 1 ? "" : "s"}`;
  }
  process.stdout.write(`${summary}\n`);

  if (unrecheckable.length > 0) {
    process.stdout.write(
      "\nUnrecheckable items (already [x], but nothing executable to re-run — evidence is manual):\n",
    );
    for (const u of unrecheckable) {
      process.stdout.write(`  [${u.index}] ${u.label}: ${u.reason}\n`);
    }
  }

  if (manualItems.length > 0) {
    process.stdout.write(
      "\nManual items (Command is a shell no-op — running it proves nothing, so they were NOT marked):\n",
    );
    for (const m of manualItems) {
      process.stdout.write(`  [${m.index}] ${m.label}\n`);
      process.stdout.write(
        `      tracker mark ${specPath} ${m.index} --verified --evidence "<what was checked, how, by whom/which agent, tier>"\n`,
      );
    }
  }

  if (timeouts.length > 0) {
    process.stderr.write(
      `\nTimed out (limit ${timeoutMs / 1000}s — nothing proven either way; raise it with --timeout <seconds>):\n`,
    );
    for (const t of timeouts) {
      process.stderr.write(`  [${t.index}] ${t.label}: ${t.reason}\n`);
    }
  }

  if (regressions.length > 0) {
    process.stderr.write(
      `\n!!! REGRESSION — ${regressions.length} previously-verified item${regressions.length === 1 ? "" : "s"} no longer pass${regressions.length === 1 ? "es" : ""}:\n`,
    );
    for (const r of regressions) {
      process.stderr.write(`  [${r.index}] ${r.label}: ${r.reason}\n`);
    }
    process.stderr.write(
      "The [x] was NOT removed — a tick records that the check passed then, and unticking it\n" +
        "would erase the only evidence that this ever worked. Fix the code (or re-scope the item),\n" +
        `then re-run: tracker verify ${specPath} --recheck\n`,
    );
  }

  if (failures.length > 0) {
    process.stderr.write("\nFailed items:\n");
    for (const f of failures) {
      process.stderr.write(`  [${f.index}] ${f.label}: ${f.reason}\n`);
    }
  }

  if (failures.length > 0 || regressions.length > 0 || timeouts.length > 0) {
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// tracker verify-item <spec-path> <task-idx> [--dry-run] [--recheck] [--timeout <seconds>]
// ---------------------------------------------------------------------------

function runVerifyItem(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    options: {
      "dry-run": { type: "boolean", default: false },
      recheck: { type: "boolean", default: false },
      timeout: { type: "string" },
    },
    allowPositionals: true,
  });

  const specPath = positionals[0];
  const taskIdxStr = positionals[1];

  if (!specPath || !taskIdxStr) {
    process.stderr.write(
      "Usage: tracker verify-item <spec-path> <task-idx> [--dry-run] [--recheck] [--timeout <seconds>]\n",
    );
    process.exit(1);
  }

  const taskIndex = parseInt(taskIdxStr, 10);
  if (isNaN(taskIndex) || taskIndex < 0) {
    process.stderr.write(`tracker verify-item: invalid task index "${taskIdxStr}"\n`);
    process.exit(1);
  }

  const absPath = resolve(specPath);
  if (!existsSync(absPath)) {
    process.stderr.write(`tracker verify-item: spec not found: ${absPath}\n`);
    process.exit(1);
  }

  const timeoutMs = parseTimeoutFlag(values.timeout, "verify-item");
  const trackerRoot = requireTrackerRoot();
  const cwd = verificationCwd(trackerRoot);
  const runOptions: RunOptions = { cwd, timeoutMs };
  const raw = readFileSync(absPath, "utf-8");

  let view;
  try {
    view = parseSpec(raw, absPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`tracker verify-item: parse error: ${message}\n`);
    process.exit(1);
  }

  const item = view.checklistItems.find((i) => i.index === taskIndex);
  if (!item) {
    process.stderr.write(
      `tracker verify-item: task index ${taskIndex} not found (${view.checklistItems.length} items)\n`,
    );
    process.exit(1);
  }

  // --dry-run is a classification pass and returns here: nothing below this
  // line — no spawn, no ledger append, no mark — may run under it.
  if (values["dry-run"]) {
    printDryRunReport({
      command: "verify-item",
      items: [item],
      runOptions,
      recheck: values.recheck,
    });
    return;
  }

  const isRecheck = values.recheck && item.state === "verified";

  if (item.state === "verified" && !isRecheck) {
    process.stdout.write(`task ${taskIndex} already done (pass --recheck to re-execute it)\n`);
    return;
  }

  if (item.state === "skipped") {
    process.stdout.write(`task ${taskIndex} is skipped\n`);
    return;
  }

  if (item.command === null || item.expected === null) {
    if (isRecheck) {
      // Already ticked, nothing executable behind it: unrecheckable, not
      // failed. Reporting this as a failure would punish every honestly
      // hand-verified item on every recheck sweep.
      process.stdout.write(
        `task ${taskIndex} is not recheckable — no Command/Expected pair; the [x] rests on manual evidence\n`,
      );
      return;
    }
    process.stderr.write(`tracker verify-item: task ${taskIndex} has no Command/Expected pair\n`);
    process.exit(1);
  }

  // Issue #4: specs are committed, so paths must be repo-relative. If a stray
  // absolute path slipped in, warn (the runner strips it at run time) so the
  // author notices and fixes the stored spec. Checked against the directory the
  // command will actually run in, not the CLI's own cwd.
  if (
    hasCwdPrefix(item.command, cwd) ||
    (item.expected !== null && hasCwdPrefix(item.expected, cwd))
  ) {
    process.stderr.write(
      `tracker verify-item: warning — task ${taskIndex} contains an absolute path; specs must use repo-relative paths (issue #4). Stripped at run time, but fix the spec.\n`,
    );
  }

  const input: VerifyItemInput = {
    command: item.command,
    expected: item.expected,
    index: item.index,
    label: item.label,
  };

  const result = runVerification(input, runOptions);

  const isRegression =
    isRecheck && (result.outcome === "fail" || result.outcome === "error");

  appendLedgerEntry({
    trackerRoot,
    specPath: absPath,
    index: item.index,
    label: item.label,
    command: item.command,
    expected: item.expected,
    exitCode: result.exitCode,
    outcome: isRegression ? "regression" : result.outcome,
  });

  if (result.outcome === "manual") {
    if (isRecheck) {
      process.stdout.write(
        `task ${taskIndex} is not recheckable — Command is a shell no-op; the [x] rests on manual evidence\n`,
      );
      return;
    }
    // Refuse, and exit 1 — same consequence as the existing "no
    // Command/Expected pair" refusal above. The caller asked for this one item
    // to be verified and it was not; an exit 0 here would read as success and
    // is exactly how a no-op earns a green tick.
    process.stderr.write(
      `tracker verify-item: task ${taskIndex} NOT verified — ${result.reason}\n`,
    );
    process.stderr.write(
      `  tracker mark ${specPath} ${taskIndex} --verified --evidence "<what was checked, how, by whom/which agent, tier>"\n`,
    );
    process.exit(1);
  }

  if (result.outcome === "pass") {
    try {
      markTask({
        specPath: absPath,
        taskIndex: item.index,
        state: "verified",
        trackerRoot,
        method: "executed",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`tracker verify-item: failed to mark task: ${message}\n`);
      process.exit(1);
    }
    process.stdout.write(
      isRecheck
        ? `task ${taskIndex} re-verified (recheck passed; verification_passed re-stamped)\n`
        : `task ${taskIndex} passed\n`,
    );
    return;
  }

  if (result.outcome === "timeout") {
    process.stderr.write(
      `tracker verify-item: task ${taskIndex} TIMED OUT after ${timeoutMs / 1000}s — ${result.reason}\n`,
    );
    process.exit(1);
  }

  if (isRegression) {
    process.stderr.write(
      `tracker verify-item: !!! REGRESSION — task ${taskIndex} was already [x] and no longer passes: ${result.reason}\n`,
    );
    process.stderr.write(
      `  The [x] was NOT removed — a tick records that the check passed then. Fix the code (or re-scope\n` +
        `  the item), then re-run: tracker verify-item ${specPath} ${taskIndex} --recheck\n`,
    );
    process.exit(1);
  }

  process.stderr.write(`tracker verify-item: task ${taskIndex} failed: ${result.reason}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// tracker worklog open|append|close|list
// ---------------------------------------------------------------------------

function runWorklog(args: string[]): void {
  const subcommand = args[0];

  if (subcommand === "open") {
    runWorklogOpen(args.slice(1));
    return;
  }

  if (subcommand === "append") {
    runWorklogAppend(args.slice(1));
    return;
  }

  if (subcommand === "close") {
    runWorklogClose(args.slice(1));
    return;
  }

  if (subcommand === "list") {
    runWorklogList(args.slice(1));
    return;
  }

  if (subcommand === "set-stage") {
    runWorklogSetStage(args.slice(1));
    return;
  }

  if (subcommand === "dispatch") {
    runWorklogDispatch(args.slice(1));
    return;
  }

  if (subcommand === "park") {
    runWorklogPark(args.slice(1));
    return;
  }

  if (subcommand === "distill") {
    runWorklogDistill(args.slice(1));
    return;
  }

  if (subcommand === "index") {
    runWorklogIndex(args.slice(1));
    return;
  }

  process.stderr.write(
    "Usage: tracker worklog <open|append|close|list|set-stage|dispatch|park|distill|index> [options]\n",
  );
  process.exit(1);
}

function runWorklogOpen(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    options: {
      spec: { type: "string" },
      message: { type: "string" },
      stage: { type: "string" },
    },
    allowPositionals: true,
  });

  // The first positional is the slug (optional)
  const slug = positionals[0];

  // Only `planned` is a legal opening stage — later stages are reached via
  // set-stage/dispatch as the Work Loop progresses.
  if (values.stage !== undefined && values.stage !== "planned") {
    process.stderr.write(
      `tracker worklog open: --stage must be "planned" at open, got "${values.stage}"\n`,
    );
    process.exit(1);
  }

  const trackerRoot = requireTrackerRoot();
  const worklogDir = join(trackerRoot, "worklog");
  const fileName = slug ? `${slug}.md` : `default.md`;

  // Every worklog enumeration skips `00-` files as generated index docs, so a
  // thread opened into one would be written and then be invisible to list,
  // append and close forever. Refuse at the door rather than exit 0 on a
  // thread nobody can reach again.
  if (isWorklogIndexFile(fileName)) {
    process.stderr.write(
      `tracker worklog open: "${fileName}" is a generated index name — ` +
        "00- files are excluded from every worklog listing, so this thread " +
        "would be unreachable. Pick a slug that does not start with 00-.\n",
    );
    process.exit(1);
  }

  const worklogPath = join(worklogDir, fileName);

  try {
    const threadId = openThread({
      worklogPath,
      slug,
      specPath: values.spec,
      message: values.message,
      stage: values.stage as WorklogStage | undefined,
    });
    process.stdout.write(`${threadId}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`tracker worklog open: ${message}\n`);
    process.exit(1);
  }
}

function runWorklogAppend(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    options: {
      section: { type: "string" },
      message: { type: "string" },
    },
    allowPositionals: true,
  });

  const threadId = positionals[0];
  if (!threadId) {
    process.stderr.write(
      'Usage: tracker worklog append <thread-id> --section "<section>" --message "..."\n',
    );
    process.exit(1);
  }

  if (!values.section || !values.message) {
    process.stderr.write("tracker worklog append: --section and --message are required\n");
    process.exit(1);
  }

  const trackerRoot = requireTrackerRoot();

  // Find the worklog file for this thread
  const worklogPath = findWorklogFileForThread({ trackerRoot, threadId });
  if (!worklogPath) {
    process.stderr.write(`tracker worklog append: thread not found: ${threadId}\n`);
    process.exit(1);
  }

  try {
    appendThread({
      worklogPath,
      threadId,
      section: values.section,
      message: values.message,
    });
    process.stdout.write(`tracker worklog append: appended to ${threadId}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`tracker worklog append: ${message}\n`);
    process.exit(1);
  }
}

function runWorklogClose(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    options: {
      status: { type: "string" },
    },
    allowPositionals: true,
  });

  const threadId = positionals[0];
  if (!threadId) {
    process.stderr.write(
      "Usage: tracker worklog close <thread-id> --status <done|blocked|cancelled>\n",
    );
    process.exit(1);
  }

  const validStatuses = ["done", "blocked", "cancelled"];
  if (!values.status || !validStatuses.includes(values.status)) {
    process.stderr.write(
      `tracker worklog close: --status must be one of: ${validStatuses.join(", ")}\n`,
    );
    process.exit(1);
  }

  const trackerRoot = requireTrackerRoot();
  const worklogPath = findWorklogFileForThread({ trackerRoot, threadId });
  if (!worklogPath) {
    process.stderr.write(`tracker worklog close: thread not found: ${threadId}\n`);
    process.exit(1);
  }

  try {
    closeThread({
      worklogPath,
      threadId,
      status: values.status as "done" | "blocked" | "cancelled",
    });
    process.stdout.write(`tracker worklog close: closed ${threadId} with status ${values.status}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`tracker worklog close: ${message}\n`);
    process.exit(1);
  }
}

function runWorklogSetStage(args: string[]): void {
  const { positionals } = parseArgs({ args, options: {}, allowPositionals: true });

  const threadId = positionals[0];
  const stage = positionals[1];
  if (!threadId || !stage) {
    process.stderr.write(
      `Usage: tracker worklog set-stage <thread-id> <${WORKLOG_STAGES.join("|")}>\n`,
    );
    process.exit(1);
  }

  if (!(WORKLOG_STAGES as readonly string[]).includes(stage)) {
    process.stderr.write(
      `tracker worklog set-stage: invalid stage "${stage}". Allowed: ${WORKLOG_STAGES.join(", ")}\n`,
    );
    process.exit(1);
  }

  const trackerRoot = requireTrackerRoot();
  const worklogPath = findWorklogFileForThread({ trackerRoot, threadId });
  if (!worklogPath) {
    process.stderr.write(`tracker worklog set-stage: thread not found: ${threadId}\n`);
    process.exit(1);
  }

  try {
    setStage({ worklogPath, threadId, stage: stage as WorklogStage });
    process.stdout.write(`tracker worklog set-stage: ${threadId} → ${stage}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`tracker worklog set-stage: ${message}\n`);
    process.exit(1);
  }
}

function runWorklogDispatch(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    options: {
      agent: { type: "string" },
      reason: { type: "string" },
      session: { type: "string" },
      force: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  const threadId = positionals[0];
  if (!threadId || !values.agent) {
    process.stderr.write(
      'Usage: tracker worklog dispatch <thread-id> --agent <invocable> [--reason "<one-line>"]\n',
    );
    process.exit(1);
  }

  const trackerRoot = requireTrackerRoot();
  const worklogPath = findWorklogFileForThread({ trackerRoot, threadId });
  if (!worklogPath) {
    process.stderr.write(`tracker worklog dispatch: thread not found: ${threadId}\n`);
    process.exit(1);
  }

  // Dispatch is the other place work is handed out. A thread with no `spec:`
  // has nothing to collide on and passes straight through.
  const thread = listThreads({ trackerRoot }).find((t) => t.threadId === threadId);
  if (thread?.specPath) {
    const blocked = claimGate({
      trackerRoot,
      specRef: thread.specPath,
      sessionFlag: values.session,
      force: values.force,
      command: "worklog dispatch",
    });
    if (blocked) process.exit(1);
  }

  try {
    dispatchThread({ worklogPath, threadId, agent: values.agent, reason: values.reason });
    process.stdout.write(
      `tracker worklog dispatch: ${threadId} → dispatched (agent: ${values.agent})\n`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`tracker worklog dispatch: ${message}\n`);
    process.exit(1);
  }
}

function runWorklogPark(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    options: {
      reason: { type: "string" },
    },
    allowPositionals: true,
  });

  const threadId = positionals[0];
  if (!threadId || !values.reason || !values.reason.trim()) {
    process.stderr.write(
      'Usage: tracker worklog park <thread-id> --reason "<why this work is being deferred>"\n',
    );
    process.exit(1);
  }

  const trackerRoot = requireTrackerRoot();
  const worklogPath = findWorklogFileForThread({ trackerRoot, threadId });
  if (!worklogPath) {
    process.stderr.write(`tracker worklog park: thread not found: ${threadId}\n`);
    process.exit(1);
  }

  try {
    parkThread({ worklogPath, threadId, reason: values.reason });
    process.stdout.write(`tracker worklog park: ${threadId} parked (closed: blocked)\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`tracker worklog park: ${message}\n`);
    process.exit(1);
  }
}

function runWorklogList(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: {
      active: { type: "boolean", default: false },
      milestone: { type: "string" },
      json: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const trackerRoot = requireTrackerRoot();

  const threads = listThreads({
    trackerRoot,
    activeOnly: values.active,
    milestoneSlug: values.milestone,
  });
  // Legacy (pre-CLI, marker-less) files have no threads to list, so they ride
  // alongside the threads as per-file rows instead of vanishing from the view.
  const files = listWorklogFiles({ trackerRoot, milestoneSlug: values.milestone });

  if (values.json) {
    process.stdout.write(JSON.stringify({ threads, files }, null, 2) + "\n");
    return;
  }

  // Thread-less files (pre-CLI prose, or a distilled anchor stub) have no
  // thread rows of their own, so they get a per-file row instead.
  const threadlessFiles = files.filter((f) => f.state !== "clean" && f.threadCount === 0);

  if (threads.length === 0 && threadlessFiles.length === 0) {
    process.stdout.write("No worklog threads found\n");
    return;
  }

  for (const t of threads) {
    const status = t.closedAt ? `closed (${t.closeStatus})` : "open";
    const stage = t.stage ? `  stage:${t.stage}` : "";
    const legacy = t.legacy ? "  (legacy)" : "";
    process.stdout.write(
      `${t.threadId}  ${t.label}  ${status}${stage}  ${t.entryCount} entries${legacy}\n`,
    );
  }

  for (const f of threadlessFiles) {
    const note =
      f.state === "distilled" ? "distilled anchor stub" : "no threads — freeform prose only";
    process.stdout.write(`${f.worklogFile}  (${f.state})  ${note}\n`);
  }
}

// ---------------------------------------------------------------------------
// tracker worklog index
// ---------------------------------------------------------------------------

function runWorklogIndex(args: string[]): void {
  parseArgs({ args, options: {}, allowPositionals: false });

  const trackerRoot = requireTrackerRoot();

  try {
    const result = rebuildWorklogIndex(trackerRoot);
    if (result === null) {
      process.stdout.write(
        `tracker worklog index: no ${join(trackerRoot, "worklog")} directory — nothing to index\n`,
      );
      return;
    }
    process.stdout.write(
      `tracker worklog index: rebuilt ${result.path} (${result.rows.length} file(s))\n`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`tracker worklog index: ${message}\n`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// tracker worklog distill <file> (--content <path> | --stdin) | --check | --list
// ---------------------------------------------------------------------------

function runWorklogDistill(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    options: {
      content: { type: "string" },
      stdin: { type: "boolean", default: false },
      check: { type: "boolean", default: false },
      list: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      "min-age-days": { type: "string" },
    },
    allowPositionals: true,
  });

  const trackerRoot = requireTrackerRoot();
  const minAgeDays = parseMinAgeDays(values["min-age-days"]);

  // `--list` surveys the whole directory; `--check` and a positional both name
  // one file. Combining them used to let `--list` win silently and answer a
  // question the caller did not ask — the same trap the --content/--stdin XOR
  // already closes.
  if (values.list && (values.check || positionals.length > 0)) {
    process.stderr.write(
      "tracker worklog distill: --list surveys every file and cannot be combined with " +
        "--check or a <file> argument\n",
    );
    process.exit(1);
  }

  if (values.list) {
    const candidates = listDistillCandidates({ trackerRoot, minAgeDays });

    if (values.json) {
      process.stdout.write(JSON.stringify({ minAgeDays, files: candidates }, null, 2) + "\n");
      return;
    }

    if (candidates.length === 0) {
      process.stdout.write("No worklog files found\n");
      return;
    }

    for (const c of candidates) {
      process.stdout.write(
        c.eligible
          ? `${c.worklogFile}  eligible\n`
          : `${c.worklogFile}  not eligible — ${c.reason}\n`,
      );
    }
    return;
  }

  const file = positionals[0];
  if (!file) {
    process.stderr.write(
      "Usage: tracker worklog distill <file> (--content <path> | --stdin) [--force] [--min-age-days N]\n" +
        "       tracker worklog distill <file> --check [--min-age-days N]\n" +
        "       tracker worklog distill --list [--json] [--min-age-days N]\n",
    );
    process.exit(1);
  }

  if (values.check) {
    const gate = evaluateDistillEligibility({ trackerRoot, file, minAgeDays });
    // The reason is the contract on stdout — scriptable. Detail rides stderr.
    process.stdout.write(`${gate.reason}\n`);
    if (!gate.eligible) {
      process.stderr.write(`tracker worklog distill: ${gate.detail}\n`);
      process.exit(1);
    }
    return;
  }

  const contentPath = values.content;
  if ((contentPath !== undefined) === values.stdin) {
    process.stderr.write(
      "tracker worklog distill: exactly one of --content <path> or --stdin is required\n",
    );
    process.exit(1);
  }

  let content = "";
  try {
    // fd 0 — darius and other Bash-only callers have no Write tool, so piping
    // the stub in has to work as well as pointing at a file.
    content =
      contentPath === undefined ? readFileSync(0, "utf-8") : readFileSync(contentPath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`tracker worklog distill: cannot read stub content: ${message}\n`);
    process.exit(1);
  }

  if (content.trim() === "") {
    process.stderr.write(
      "tracker worklog distill: refusing to distill to empty content — the stub must say something\n",
    );
    process.exit(1);
  }

  try {
    const result = distillWorklogFile({
      trackerRoot,
      file,
      content,
      minAgeDays,
      force: values.force,
    });

    if (result.oversize) {
      process.stdout.write(
        `tracker worklog distill: warning — stub is ${result.bytes} bytes, ` +
          `over the ${STUB_WARN_BYTES}-byte anchor budget\n`,
      );
    }
    process.stdout.write(
      `tracker worklog distill: ${result.worklogFile} → anchor stub ` +
        `(raw ${result.rawPreserved}: ${result.rawPath}, ` +
        `sha256 ${result.sourceSha256.slice(0, 12)}…)\n`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`tracker worklog distill: ${message}\n`);
    process.exit(1);
  }
}

/**
 * Parse `--min-age-days`. Rejects anything that is not a non-negative number so
 * a typo can never silently widen the gate.
 */
function parseMinAgeDays(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_MIN_AGE_DAYS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    process.stderr.write(
      `tracker worklog distill: --min-age-days must be a non-negative number, got "${raw}"\n`,
    );
    process.exit(1);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// tracker doctor [--fix] [--quick]
// ---------------------------------------------------------------------------

function runDoctor(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: {
      fix: { type: "boolean", default: false },
      quick: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.quick) {
    runDoctorQuick();
    return;
  }

  const trackerRoot = requireTrackerRoot();

  try {
    const report = executeDoctorCheck({ trackerRoot, fix: values.fix });
    const output = formatDoctorReport(report);
    process.stdout.write(output + "\n");

    if (!report.healthy) {
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Check if this is the future-version error from the schema check
    if (message.includes("plugin is too old")) {
      process.stderr.write(`tracker doctor: ${message}\n`);
      process.exit(1);
    }
    process.stderr.write(`tracker doctor: ${message}\n`);
    process.exit(1);
  }
}

/**
 * Read the major plugin version from plugin.json.
 * Returns "9" for "9.1.0". Falls back to "?" on read errors.
 */
function readPluginMajorVersion(): string {
  try {
    const binDir = dirname(fileURLToPath(import.meta.url));
    const pluginJsonPath = resolve(binDir, "../../.claude-plugin/plugin.json");
    const raw = readFileSync(pluginJsonPath, "utf-8");
    const json = JSON.parse(raw) as { version?: string };
    const major = json.version?.split(".")[0];
    return major ?? "?";
  } catch {
    return "?";
  }
}

/**
 * Fast version check — reads only .tracker/00-INDEX.md frontmatter.
 * Target: ≤30ms warm. Emits a single-line message.
 *
 * Exit codes:
 *   0 — ok, clean unstamped, or drift detected (informational)
 *   1 — future version detected (plugin too old)
 */
function runDoctorQuick(): void {
  const trackerRoot = findTrackerRoot(process.cwd());

  // No tracker — silent exit 0
  if (trackerRoot === null || !existsSync(trackerRoot)) {
    return;
  }

  const indexPath = join(trackerRoot, "00-INDEX.md");
  if (!existsSync(indexPath)) {
    // Tracker dir exists but no index — treat as no tracker
    return;
  }

  const pluginVersion = readPluginMajorVersion();

  let onDiskVersion: number | null = null;
  try {
    const raw = readFileSync(indexPath, "utf-8");
    // Strip leading HTML comment (generated header) so gray-matter can find frontmatter
    const stripped = raw.replace(/^<!--[\s\S]*?-->\s*/m, "");
    const { data } = parseFrontmatter(stripped);
    if (typeof data["schema_version"] === "number") {
      onDiskVersion = data["schema_version"];
    }
  } catch {
    // Unreadable index — treat as missing stamp
  }

  if (onDiskVersion === null) {
    process.stdout.write(
      "tracker: clean, run `tracker doctor` to stamp schema version\n",
    );
    return;
  }

  if (onDiskVersion > CURRENT_SCHEMA_VERSION) {
    process.stdout.write(
      `tracker: schema v${onDiskVersion} — plugin v${pluginVersion} is too old, upgrade tracker plugin\n`,
    );
    process.exit(1);
    return;
  }

  if (onDiskVersion < CURRENT_SCHEMA_VERSION) {
    process.stdout.write(
      `tracker: schema v${onDiskVersion} detected — ask darius to migrate\n`,
    );
    return;
  }

  // onDiskVersion === CURRENT_SCHEMA_VERSION — healthy
  process.stdout.write(`tracker: ok (v${pluginVersion}, schema ${CURRENT_SCHEMA_VERSION})\n`);
}

// ---------------------------------------------------------------------------
// tracker scan artifacts|stubs <path>
// ---------------------------------------------------------------------------

function runScan(args: string[]): void {
  const subcommand = args[0];

  if (subcommand === "artifacts") {
    runScanArtifacts(args.slice(1));
    return;
  }

  if (subcommand === "stubs") {
    runScanStubs(args.slice(1));
    return;
  }

  process.stderr.write("Usage: tracker scan <artifacts|stubs> <path>\n");
  process.exit(1);
}

function runScanArtifacts(args: string[]): void {
  const { positionals } = parseArgs({
    args,
    options: {},
    allowPositionals: true,
  });

  const scanPath = positionals[0];
  if (!scanPath) {
    process.stderr.write("Usage: tracker scan artifacts <path>\n");
    process.exit(1);
  }

  const absPath = resolve(scanPath);
  const matches = scanArtifacts({ path: absPath });

  if (matches.length === 0) {
    process.stdout.write("No artifacts found\n");
    return;
  }

  process.stdout.write(formatScanMatches(matches) + "\n");
  process.exit(1);
}

function runScanStubs(args: string[]): void {
  const { positionals } = parseArgs({
    args,
    options: {},
    allowPositionals: true,
  });

  const scanPath = positionals[0];
  if (!scanPath) {
    process.stderr.write("Usage: tracker scan stubs <path>\n");
    process.exit(1);
  }

  const absPath = resolve(scanPath);
  const matches = scanStubs({ path: absPath });

  if (matches.length === 0) {
    process.stdout.write("No stubs found\n");
    return;
  }

  process.stdout.write(formatScanMatches(matches) + "\n");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// tracker migrate [--from v1|v8|auto] [--dry-run|--apply]
// ---------------------------------------------------------------------------

function runMigrateCommand(args: string[]): void {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(
      "Usage: tracker migrate [--from v1|v8|auto] [--dry-run|--apply]\n" +
        "\n" +
        "Upgrade a legacy tracker to v9 CLI-native format.\n" +
        "\n" +
        "Options:\n" +
        "  --from v1|v8|auto   Force version detection (default: auto)\n" +
        "  --dry-run           Print diff without making changes (default)\n" +
        "  --apply             Execute migration and write changes\n" +
        "\n" +
        "Default mode is --dry-run. Pass --apply to execute.\n" +
        "\n" +
        "Steps performed:\n" +
        "  migrateV1ToV2             Move flat .md files into M1-migrated/ folder\n" +
        "  migrateLegacyFrontmatter  Strip status:/verified: from spec frontmatter\n" +
        "  normalizeDates            Convert datetime strings to plain YYYY-MM-DD\n" +
        "  regenerateIndex           Rebuild 00-INDEX.md with canonical generator header\n" +
        "  normalizeWorklog          Re-write worklog bullet prefixes to -\n",
    );
    return;
  }

  const { values } = parseArgs({
    args,
    options: {
      from: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      apply: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const fromArg = values.from;
  let fromVersion: TrackerVersion | undefined;

  if (fromArg && fromArg !== "auto") {
    if (fromArg !== "v1" && fromArg !== "v8") {
      process.stderr.write(
        `tracker migrate: invalid --from value "${fromArg}". Allowed: v1, v8, auto\n`,
      );
      process.exit(1);
    }
    fromVersion = fromArg;
  }

  // Default is dry-run unless --apply is explicitly passed
  const dryRun = !values.apply;

  const trackerRoot = requireTrackerRoot();

  try {
    // Default is dry-run unless --apply is explicitly passed
    const result = runMigrate({ trackerRoot, fromVersion, dryRun });

    process.stdout.write(result.diffText + "\n");

    if (result.noOp) {
      process.stdout.write("tracker migrate: nothing to do.\n");
      return;
    }

    if (!dryRun) {
      process.stdout.write(
        `tracker migrate: applied ${result.changeCount} change(s).\n`,
      );
      if (result.logPath) {
        process.stdout.write(`tracker migrate: log written to ${result.logPath}\n`);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`tracker migrate: ${message}\n`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// tracker counsel-gate <transcript-path> [--spec <spec-path>] [--threshold N] [--json]
// ---------------------------------------------------------------------------

function runCounselGate(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    options: {
      spec: { type: "string" },
      threshold: { type: "string" },
      "max-rounds": { type: "string" },
      "single-dissent": { type: "string" },
      "ack-dissent": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  const transcriptArg = positionals[0];
  if (!transcriptArg) {
    process.stderr.write(
      "Usage: tracker counsel-gate <transcript-path> [--spec <spec-path>] [--threshold N] [--single-dissent surface|confirm|ignore] [--ack-dissent] [--json]\n",
    );
    process.exit(1);
  }

  const transcriptPath = resolve(transcriptArg);
  if (!existsSync(transcriptPath)) {
    process.stderr.write(`tracker counsel-gate: transcript not found: ${transcriptPath}\n`);
    process.exit(1);
  }

  const threshold = resolveCounselThreshold(values.threshold);
  // --ack-dissent collapses a confirm-mode lone dissent back to "surface" so
  // the gate returns ready (the user has acknowledged it). The threshold count
  // still owns blocking — ack never overrides a >= threshold rejection.
  const singleDissentMode = values["ack-dissent"]
    ? "surface"
    : resolveSingleDissentMode(values["single-dissent"]);

  let parse;
  try {
    const raw = readFileSync(transcriptPath, "utf-8");
    parse = parseCounselTranscript(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`tracker counsel-gate: parse error: ${message}\n`);
    process.exit(1);
  }

  if (parse.advisors.length === 0) {
    process.stderr.write(
      `tracker counsel-gate: no advisor verdicts found in ${transcriptPath}\n`,
    );
    process.exit(1);
  }

  const baseDecision = applyGate(parse, threshold, singleDissentMode);

  // Round budget is only meaningful with a --spec to read/persist the counter.
  // An --ack-dissent re-run resolves a confirm-mode dissent the user already
  // acknowledged; it is not a fresh deliberation, so it does NOT consume a round.
  let decision = baseDecision;
  if (values.spec) {
    const specPath = resolve(values.spec);
    const isAck = values["ack-dissent"] === true;
    const maxRounds = resolveMaxCounselRounds(values["max-rounds"]);
    const priorRounds = readCounselRounds(specPath);
    const roundsUsed = isAck ? priorRounds : priorRounds + 1;
    decision = applyRoundBudget(baseDecision, roundsUsed, maxRounds);
    writeCounselFrontmatter(specPath, decision, roundsUsed);
  }

  if (values.json) {
    process.stdout.write(JSON.stringify(decisionToJSON(decision, parse), null, 2) + "\n");
    return;
  }

  process.stdout.write(formatCounselGate(decision, parse));
}

function resolveCounselThreshold(flagValue: string | undefined): number {
  if (typeof flagValue === "string") {
    const parsed = Number.parseInt(flagValue, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      process.stderr.write(
        `tracker counsel-gate: --threshold must be a positive integer, got ${flagValue}\n`,
      );
      process.exit(1);
    }
    return parsed;
  }

  const configThreshold = readCounselThresholdFromConfig();
  if (configThreshold !== null) {
    return configThreshold;
  }

  return 2;
}

function readCounselThresholdFromConfig(): number | null {
  const trackerRoot = findTrackerRoot(process.cwd());
  if (trackerRoot === null) return null;

  const configPath = join(trackerRoot, "config.yml");
  if (!existsSync(configPath)) return null;

  try {
    const raw = readFileSync(configPath, "utf-8");
    // Minimal scalar parse — we only care about counsel_threshold: N
    const m = /^\s*counsel_threshold\s*:\s*(\d+)\s*$/m.exec(raw);
    if (m === null) return null;
    const n = Number.parseInt(m[1]!, 10);
    if (!Number.isInteger(n) || n < 1) return null;
    return n;
  } catch {
    return null;
  }
}

function resolveMaxCounselRounds(flagValue: string | undefined): number {
  if (typeof flagValue === "string") {
    const parsed = Number.parseInt(flagValue, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      process.stderr.write(
        `tracker counsel-gate: --max-rounds must be a positive integer, got ${flagValue}\n`,
      );
      process.exit(1);
    }
    return parsed;
  }

  const fromConfig = readScalarFromConfig(/^\s*max_counsel_rounds\s*:\s*(\d+)\s*$/m);
  if (fromConfig !== null) {
    const n = Number.parseInt(fromConfig, 10);
    if (Number.isInteger(n) && n >= 1) return n;
  }

  return 2;
}

/**
 * Read the `counsel_rounds:` counter from a spec's frontmatter.
 * Returns 0 when the field is absent, malformed, or the file is unreadable.
 */
function readCounselRounds(specPath: string): number {
  if (!existsSync(specPath)) return 0;
  try {
    const raw = readFileSync(specPath, "utf-8");
    const m = /^\s*counsel_rounds\s*:\s*(\d+)\s*$/m.exec(raw);
    if (m === null) return 0;
    const n = Number.parseInt(m[1]!, 10);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function readScalarFromConfig(pattern: RegExp): string | null {
  const trackerRoot = findTrackerRoot(process.cwd());
  if (trackerRoot === null) return null;
  const configPath = join(trackerRoot, "config.yml");
  if (!existsSync(configPath)) return null;
  try {
    const raw = readFileSync(configPath, "utf-8");
    const m = pattern.exec(raw);
    return m === null ? null : m[1]!;
  } catch {
    return null;
  }
}

function resolveSingleDissentMode(
  flagValue: string | undefined,
): SingleDissentMode {
  const fromFlag = flagValue ?? readSingleDissentModeFromConfig();
  if (fromFlag === null || fromFlag === undefined) {
    return "surface";
  }
  if (
    fromFlag === "surface" ||
    fromFlag === "confirm" ||
    fromFlag === "ignore"
  ) {
    return fromFlag;
  }
  process.stderr.write(
    `tracker counsel-gate: --single-dissent must be surface|confirm|ignore, got ${fromFlag}\n`,
  );
  process.exit(1);
}

function readSingleDissentModeFromConfig(): string | null {
  const trackerRoot = findTrackerRoot(process.cwd());
  if (trackerRoot === null) return null;

  const configPath = join(trackerRoot, "config.yml");
  if (!existsSync(configPath)) return null;

  try {
    const raw = readFileSync(configPath, "utf-8");
    // Minimal scalar parse — counsel_single_dissent: surface|confirm|ignore
    const m = /^\s*counsel_single_dissent\s*:\s*([A-Za-z]+)\s*$/m.exec(raw);
    if (m === null) return null;
    return m[1]!.toLowerCase();
  } catch {
    return null;
  }
}

function writeCounselFrontmatter(
  specPath: string,
  decision: GateDecision,
  roundsUsed: number,
): void {
  if (!existsSync(specPath)) {
    process.stderr.write(`tracker counsel-gate: --spec not found: ${specPath}\n`);
    process.exit(1);
  }

  // needs_ack is not a terminal decision — the lone dissent still awaits user
  // acknowledgement. Leave frontmatter untouched so the spec stays gated; the
  // ack re-run (--ack-dissent) returns "ready" and stamps counsel then.
  if (decision.status === "needs_ack") {
    return;
  }

  const raw = readFileSync(specPath, "utf-8");
  const { data, content } = parseFrontmatter(raw);

  // Persist the round counter so the next counsel run on this spec knows how
  // many deliberations have already been spent (the brake against spinning).
  data["counsel_rounds"] = roundsUsed;

  if (decision.status === "counsel_exhausted") {
    // Terminal: the loop budget is spent. The planner must not re-counsel —
    // it surfaces the unresolved feedback and waits for an explicit override.
    data["counsel"] = "exhausted";
  } else if (decision.status === "blocked") {
    data["counsel"] = "rejected";
  } else {
    data["counsel"] = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  const updated = serializeFrontmatter(data, content);
  atomicWriteFileSync(specPath, updated);
}

function formatCounselGate(
  decision: GateDecision,
  parse: { thumbsDown: number; thumbsUp: number; thumbsSideways: number },
): string {
  const lines: string[] = [];
  lines.push(`STATUS: ${decision.status}`);
  lines.push(`THUMBS_DOWN: ${decision.thumbsDown}`);
  lines.push(`THUMBS_SIDEWAYS: ${parse.thumbsSideways}`);
  lines.push(`THUMBS_UP: ${parse.thumbsUp}`);
  lines.push(`THRESHOLD: ${decision.threshold}`);
  if (typeof decision.rounds === "number") {
    lines.push(`ROUNDS: ${decision.rounds}`);
  }
  if (typeof decision.maxRounds === "number") {
    lines.push(`MAX_ROUNDS: ${decision.maxRounds}`);
  }
  lines.push(`REASON: ${decision.reason}`);
  if (decision.dissentSummary) {
    lines.push(`DISSENT_SUMMARY: ${decision.dissentSummary}`);
  }
  if (decision.blockingSummary) {
    lines.push(`BLOCKING_SUMMARY: ${decision.blockingSummary}`);
  }
  return lines.join("\n") + "\n";
}

function decisionToJSON(
  decision: GateDecision,
  parse: { thumbsDown: number; thumbsUp: number; thumbsSideways: number },
) {
  return {
    status: decision.status,
    reason: decision.reason,
    thumbsDown: decision.thumbsDown,
    thumbsSideways: parse.thumbsSideways,
    thumbsUp: parse.thumbsUp,
    threshold: decision.threshold,
    rounds: decision.rounds,
    maxRounds: decision.maxRounds,
    dissentSummary: decision.dissentSummary,
    blockingSummary: decision.blockingSummary,
  };
}


// ---------------------------------------------------------------------------
// tracker agents [--json]
// ---------------------------------------------------------------------------

function runAgents(args: string[]): void {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write("Usage: tracker agents [--json]\n");
    process.stdout.write("\n");
    process.stdout.write("List all dispatchable agents discovered from installed plugins,\n");
    process.stdout.write("project .claude/agents/, and user ~/.claude/agents/.\n");
    process.stdout.write("\n");
    process.stdout.write("Options:\n");
    process.stdout.write("  --json   Emit JSON array of AgentDescriptor objects\n");
    return;
  }

  const { values } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  // Resolve project root from tracker root to ensure cwd-independent discovery.
  // Agents enabled via the project .claude/settings.json are relative to the
  // project root (parent of .tracker/), NOT the current working directory.
  // Falling back to cwd causes project-enabled agents to vanish when the CLI
  // is invoked from a subdirectory.
  const agentOpts = resolveAgentOptsFromTrackerRoot();
  const agents = discoverAgents(agentOpts);

  if (values.json) {
    process.stdout.write(JSON.stringify(agents, null, 2) + "\n");
    return;
  }

  if (agents.length === 0) {
    process.stdout.write("No agents found\n");
    return;
  }

  for (const agent of agents) {
    process.stdout.write(`${agent.invocable} — ${agent.description}\n`);
  }
}

// ---------------------------------------------------------------------------
// tracker uncommitted-verified [--json]
//
// The commit-first gate: list specs that are verified (carry a
// `verification_passed:` stamp) but still dirty in git. work-plan calls this
// FIRST and refuses to plan new work while the list is non-empty — the
// deterministic brake against "verified the spec, never committed it".
// ---------------------------------------------------------------------------

function runUncommittedVerified(args: string[]): void {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write("Usage: tracker uncommitted-verified [--json]\n");
    process.stdout.write("\n");
    process.stdout.write("List verified-but-uncommitted spec files (dirty in git AND carrying a\n");
    process.stdout.write("verification_passed: stamp). Exit 0 with an empty list when none.\n");
    return;
  }

  const { values } = parseArgs({
    args,
    options: { json: { type: "boolean", default: false } },
    allowPositionals: false,
  });

  const trackerRoot = findTrackerRoot(process.cwd());
  const projectRoot = trackerRoot !== null ? resolve(join(trackerRoot, "..")) : process.cwd();

  let porcelain: string;
  try {
    // -c core.quotePath=false keeps unicode/space paths unquoted so the path
    // regex matches. Scope to the repo containing the tracker.
    porcelain = execFileSync(
      "git",
      ["-c", "core.quotePath=false", "status", "--porcelain"],
      { cwd: projectRoot, encoding: "utf-8" },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`tracker uncommitted-verified: git status failed: ${message}\n`);
    process.exit(1);
  }

  const specs = selectVerifiedUncommitted(porcelain, (repoRelPath) => {
    const abs = resolve(projectRoot, repoRelPath);
    if (!existsSync(abs)) return false;
    try {
      return hasVerificationPassed(readFileSync(abs, "utf-8"));
    } catch {
      return false;
    }
  });

  if (values.json) {
    process.stdout.write(JSON.stringify(specs, null, 2) + "\n");
    return;
  }

  if (specs.length === 0) {
    process.stdout.write("No verified-but-uncommitted specs.\n");
    return;
  }

  process.stdout.write(`VERIFIED_UNCOMMITTED: ${specs.length}\n`);
  for (const spec of specs) {
    process.stdout.write(`  ${spec.gitStatus} ${spec.path}\n`);
  }
}

// ---------------------------------------------------------------------------
// tracker claim <spec-ref> / tracker release <spec-ref>
//
// Advisory, expiring claims on a SHARED checkout. Nothing is prevented — the
// point is that the second session SEES the collision before doing the work.
// See lib/session-claims.ts for the model.
// ---------------------------------------------------------------------------

/**
 * Resolve the tracker root and the acting session, or exit 1 with a clear
 * message. Used by the two commands that WRITE claims — a claim naming no
 * session is worse than no claim at all.
 */
function requireClaimContext(sessionFlag: string | undefined, command: string): {
  trackerRoot: string;
  session: string;
} {
  const trackerRoot = requireTrackerRoot();
  const session = resolveSessionId(sessionFlag);
  if (session === null) {
    process.stderr.write(`tracker ${command}: ${NO_SESSION_MESSAGE}\n`);
    process.exit(1);
  }
  return { trackerRoot, session };
}

/**
 * One-line-per-path summary of everything uncommitted on the shared tree.
 *
 * Printed right after a successful claim, because on a shared checkout a killed
 * session's leftovers are indistinguishable from your own work five minutes
 * later — and the moment to notice them is BEFORE starting, not while reading a
 * confusing diff at commit time.
 *
 * Fails soft: no git, not a repo, anything at all → a single note. A preflight
 * that can abort a claim would make the claim command less reliable than the
 * problem it guards.
 */
function formatClaimPreflight(projectRoot: string, maxPaths = 5): string[] {
  let porcelain: string;
  try {
    porcelain = execFileSync(
      "git",
      ["-c", "core.quotePath=false", "status", "--porcelain"],
      // stderr is PIPED, not inherited: outside a git repo, git writes
      // "fatal: not a git repository" straight to the terminal, and a soft
      // failure that shouts is not soft.
      { cwd: projectRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return [`PREFLIGHT: git status unavailable (${message})`];
  }

  const lines = porcelain
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.trim() !== "");

  if (lines.length === 0) {
    return ["PREFLIGHT: 0 uncommitted changes — shared tree is clean"];
  }

  const out = [
    `PREFLIGHT: ${lines.length} uncommitted change(s) on the shared tree ` +
      `(a killed session's leftovers look exactly like this):`,
  ];
  for (const line of lines.slice(0, maxPaths)) out.push(`  ${line}`);
  if (lines.length > maxPaths) out.push(`  … and ${lines.length - maxPaths} more`);
  return out;
}

type ClaimAction = "claimed" | "refreshed" | "takeover-stale" | "takeover-live" | "refused";

function runClaim(args: string[]): void {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(
      "Usage: tracker claim <spec-ref> [--session <id>] [--ttl 8h] [--takeover] [--json]\n",
    );
    process.stdout.write("       tracker claim --list [--json]\n");
    process.stdout.write("\n");
    process.stdout.write(
      "Take an advisory, expiring claim on a spec so a concurrent session on the\n" +
        "same checkout sees the collision. Refuses a spec another session claimed\n" +
        "recently (--takeover overrides). A claim past its TTL is STALE and can be\n" +
        "taken over without --takeover, with a notice.\n",
    );
    return;
  }

  const { values, positionals } = parseArgs({
    args,
    options: {
      session: { type: "string" },
      ttl: { type: "string" },
      takeover: { type: "boolean", default: false },
      list: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  if (values.list) {
    runClaimList(values.session, values.json);
    return;
  }

  const refArg = positionals[0];
  if (!refArg) {
    process.stderr.write(
      "Usage: tracker claim <spec-ref> [--session <id>] [--ttl 8h] [--takeover] [--json]\n",
    );
    process.exit(1);
  }

  let ttlMs: number;
  try {
    ttlMs = parseTtl(values.ttl);
  } catch (err) {
    const message = err instanceof TtlParseError ? err.message : String(err);
    process.stderr.write(`tracker claim: ${message}\n`);
    process.exit(1);
  }

  const { trackerRoot, session } = requireClaimContext(values.session, "claim");
  const ref = normalizeClaimRef({ trackerRoot, ref: refArg });

  const now = new Date();
  const claim: SessionClaim = {
    session,
    at: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  };

  const decision = mutateClaims<{
    action: ClaimAction;
    previous: ClaimStatus;
  }>(trackerRoot, (doc: ClaimsDoc) => {
    const previous = inspectClaim(doc, ref, session, now);

    if (previous.state === "held" && !values.takeover) {
      return { doc, write: false, result: { action: "refused" as const, previous } };
    }

    const action: ClaimAction =
      previous.state === "own" ? "refreshed"
      : previous.state === "stale" ? "takeover-stale"
      : previous.state === "held" ? "takeover-live"
      : "claimed";

    doc.claims[ref] = claim;
    return { doc, write: true, result: { action, previous } };
  });

  const { action, previous } = decision;
  const other = previous.claim?.session ?? "unknown";

  if (action === "refused") {
    process.stderr.write(
      `tracker claim: REFUSED — ${ref} is claimed by session ${other} ` +
        `(claimed ${previous.ageLabel} ago, ${previous.expiryLabel}).\n`,
    );
    process.stderr.write(
      `  That session is presumed live. Pick another spec, or re-run with --takeover ` +
        `if you know it is gone.\n`,
    );
    if (values.json) {
      process.stdout.write(
        JSON.stringify(
          { action, ref, session, heldBy: other, ageMs: previous.ageMs },
          null,
          2,
        ) + "\n",
      );
    }
    process.exit(1);
  }

  if (action === "takeover-stale") {
    process.stdout.write(
      `STALE CLAIM TAKEN OVER: ${ref} was claimed by session ${other} ` +
        `${previous.ageLabel} ago and ${previous.expiryLabel} — that session is presumed dead.\n`,
    );
  }

  if (action === "takeover-live") {
    process.stdout.write(
      `⚠ TAKEOVER: ${ref} was claimed by session ${other} ${previous.ageLabel} ago and ` +
        `is still LIVE (${previous.expiryLabel}). That session may be working this spec right now.\n`,
    );
  }

  const verb = action === "refreshed" ? "CLAIMED (refreshed — already yours)" : "CLAIMED";
  process.stdout.write(
    `${verb}: ${ref}\n  session ${session}, ttl ${formatTtl(ttlMs)}, expires ${claim.expiresAt}\n`,
  );

  const projectRoot = resolve(join(trackerRoot, ".."));
  for (const line of formatClaimPreflight(projectRoot)) {
    process.stdout.write(`${line}\n`);
  }

  if (values.json) {
    process.stdout.write(
      JSON.stringify(
        {
          action,
          ref,
          session,
          at: claim.at,
          expiresAt: claim.expiresAt,
          previousSession: previous.claim?.session ?? null,
        },
        null,
        2,
      ) + "\n",
    );
  }
}

function runClaimList(sessionFlag: string | undefined, json: boolean): void {
  const trackerRoot = requireTrackerRoot();
  const session = resolveSessionId(sessionFlag);
  const statuses = listClaims(readClaims(trackerRoot), session);

  if (json) {
    process.stdout.write(
      JSON.stringify(
        statuses.map((s) => ({
          ref: s.ref,
          state: s.state,
          session: s.claim?.session ?? null,
          at: s.claim?.at ?? null,
          expiresAt: s.claim?.expiresAt ?? null,
          ageMs: s.ageMs,
        })),
        null,
        2,
      ) + "\n",
    );
    return;
  }

  if (statuses.length === 0) {
    process.stdout.write("No outstanding session claims.\n");
    return;
  }

  process.stdout.write(`OUTSTANDING CLAIMS: ${statuses.length}\n`);
  for (const status of statuses) {
    process.stdout.write(`  ${formatClaimLine(status)}\n`);
  }
}

function runRelease(args: string[]): void {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(
      "Usage: tracker release <spec-ref> [--session <id>] [--force] [--json]\n",
    );
    process.stdout.write("\n");
    process.stdout.write(
      "Drop this session's claim on a spec. Releasing another session's LIVE claim\n" +
        "requires --force; a STALE claim is released with a notice and no ceremony.\n",
    );
    return;
  }

  const { values, positionals } = parseArgs({
    args,
    options: {
      session: { type: "string" },
      force: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  const refArg = positionals[0];
  if (!refArg) {
    process.stderr.write("Usage: tracker release <spec-ref> [--session <id>] [--force] [--json]\n");
    process.exit(1);
  }

  const { trackerRoot, session } = requireClaimContext(values.session, "release");
  const ref = normalizeClaimRef({ trackerRoot, ref: refArg });
  const now = new Date();

  const decision = mutateClaims<{
    action: "released" | "released-stale" | "released-forced" | "absent" | "refused";
    previous: ClaimStatus;
  }>(trackerRoot, (doc: ClaimsDoc) => {
    const previous = inspectClaim(doc, ref, session, now);

    if (previous.state === "unclaimed") {
      return { doc, write: false, result: { action: "absent" as const, previous } };
    }
    if (previous.state === "held" && !values.force) {
      return { doc, write: false, result: { action: "refused" as const, previous } };
    }

    const action =
      previous.state === "own" ? ("released" as const)
      : previous.state === "stale" ? ("released-stale" as const)
      : ("released-forced" as const);

    delete doc.claims[ref];
    return { doc, write: true, result: { action, previous } };
  });

  const { action, previous } = decision;
  const other = previous.claim?.session ?? "unknown";

  if (action === "refused") {
    process.stderr.write(
      `tracker release: REFUSED — ${ref} is claimed by another live session ${other} ` +
        `(claimed ${previous.ageLabel} ago, ${previous.expiryLabel}). Use --force to release it anyway.\n`,
    );
    process.exit(1);
  }

  if (action === "absent") {
    process.stdout.write(`NO CLAIM: ${ref} was not claimed — nothing to release.\n`);
  } else if (action === "released-stale") {
    process.stdout.write(
      `RELEASED: ${ref} — STALE claim by session ${other} (${previous.expiryLabel}).\n`,
    );
  } else if (action === "released-forced") {
    process.stdout.write(
      `⚠ RELEASED: ${ref} — FORCE-released a LIVE claim held by session ${other} ` +
        `(claimed ${previous.ageLabel} ago).\n`,
    );
  } else {
    process.stdout.write(`RELEASED: ${ref} (held ${previous.ageLabel}).\n`);
  }

  if (values.json) {
    process.stdout.write(
      JSON.stringify({ action, ref, session, previousSession: previous.claim?.session ?? null }, null, 2) +
        "\n",
    );
  }
}

/**
 * Claim gate for the commands that HAND OUT work (`next`, `worklog dispatch`).
 *
 * Returns true when the caller should stop. A live claim by another session is
 * a refusal (exit 1, `--force` overrides); a STALE claim is a notice and the
 * work proceeds — a killed session must not park a spec forever.
 */
function claimGate(opts: {
  trackerRoot: string;
  specRef: string;
  sessionFlag: string | undefined;
  force: boolean;
  command: string;
}): boolean {
  const { trackerRoot, specRef, sessionFlag, force, command } = opts;
  const session = resolveSessionId(sessionFlag);
  const status = inspectClaim(readClaims(trackerRoot), normalizeClaimRef({ trackerRoot, ref: specRef }), session);

  if (status.state === "stale") {
    process.stderr.write(
      `tracker ${command}: NOTE — ${status.ref} carries a STALE claim by session ` +
        `${status.claim?.session} (claimed ${status.ageLabel} ago, ${status.expiryLabel}). ` +
        `Proceeding; run \`tracker claim ${status.ref}\` to take it over cleanly.\n`,
    );
    return false;
  }

  if (status.state !== "held") return false;

  if (force) {
    process.stderr.write(
      `tracker ${command}: ⚠ --force — proceeding despite a LIVE claim on ${status.ref} ` +
        `by session ${status.claim?.session} (claimed ${status.ageLabel} ago).\n`,
    );
    return false;
  }

  process.stderr.write(
    `tracker ${command}: REFUSED — ${status.ref} is claimed by session ${status.claim?.session} ` +
      `(claimed ${status.ageLabel} ago, ${status.expiryLabel}).\n`,
  );
  process.stderr.write(
    `  Another session is working this spec on the same checkout. Pick different work, ` +
      `or re-run with --force.\n`,
  );
  return true;
}

// ---------------------------------------------------------------------------
// tracker loop-check [--json] [--bounce <agent-id>] [--max-bounces N]
//
// The Work Loop exit gate's decision engine: detects threads stuck in a
// pre-terminal stage (planned|dispatched|verified) at turn end. Called by
// lib/loop-gate.sh from the SubagentStop hook. FAILS OPEN — internal errors
// and missing trackers exit 0 so a broken gate never bricks darius.
//
// Exit codes: 0 = clean/exhausted (stop allowed), 1 = stuck (block the stop).
// ---------------------------------------------------------------------------

function runLoopCheckCommand(args: string[]): void {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write("Usage: tracker loop-check [--json] [--bounce <agent-id>] [--max-bounces N]\n");
    process.stdout.write("\n");
    process.stdout.write("Detect Work Loop threads stuck in a pre-terminal stage. With --bounce,\n");
    process.stdout.write("track a per-agent-invocation block budget (default max 2) and report\n");
    process.stdout.write("STATUS: exhausted (exit 0) once it is spent.\n");
    return;
  }

  let values: { json?: boolean; bounce?: string; "max-bounces"?: string };
  try {
    ({ values } = parseArgs({
      args,
      options: {
        json: { type: "boolean", default: false },
        bounce: { type: "string" },
        "max-bounces": { type: "string" },
      },
      allowPositionals: false,
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`tracker loop-check: ${message}\n`);
    process.exit(1);
  }

  let maxBounces: number | undefined;
  if (values["max-bounces"] !== undefined) {
    maxBounces = Number.parseInt(values["max-bounces"], 10);
    if (!Number.isInteger(maxBounces) || maxBounces < 1) {
      process.stderr.write(
        `tracker loop-check: --max-bounces must be a positive integer, got ${values["max-bounces"]}\n`,
      );
      process.exit(1);
    }
  }

  const trackerRoot = findTrackerRoot(process.cwd());
  if (trackerRoot === null) {
    // No tracker — nothing to gate. Fail open.
    if (values.json) {
      process.stdout.write(JSON.stringify({ status: "clean", threads: [] }, null, 2) + "\n");
    } else {
      process.stdout.write("STATUS: clean\n");
    }
    return;
  }

  let result: LoopCheckResult;
  try {
    result = runLoopCheck({ trackerRoot, bounceId: values.bounce, maxBounces });
  } catch {
    // Fail open on any internal error.
    result = { status: "clean", threads: [] };
  }

  if (values.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write(formatLoopCheckReport(result) + "\n");
  }

  if (result.status === "stuck") {
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// tracker due — list rituals + vigils that are due now (the pickable queue)
// ---------------------------------------------------------------------------

function runDue(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: { json: { type: "boolean", default: false } },
    allowPositionals: false,
  });

  const trackerRoot = requireTrackerRoot();
  const state = readTrackerState(trackerRoot);
  const today = todayIso();
  const rituals = selectDueRituals(state.rituals, today);
  const vigils = selectDueVigils(state.vigils, today);

  if (values.json) {
    process.stdout.write(JSON.stringify({ rituals, vigils }, null, 2) + "\n");
    return;
  }

  const nothing =
    rituals.length === 0 && vigils.due.length === 0 && vigils.armed.length === 0;
  if (nothing) {
    process.stdout.write("No rituals due, no vigils pending\n");
    return;
  }

  for (const r of rituals) {
    const when = r.daysOverdue === 0 ? "due today" : `overdue ${r.daysOverdue}d`;
    process.stdout.write(`${r.slug}  (${when}, due ${r.due})  — ${r.name}\n`);
  }

  if (vigils.due.length > 0) {
    process.stdout.write("Vigils due:\n");
    for (const v of vigils.due) {
      const when = v.daysOverdue === 0 ? "due today" : `overdue ${v.daysOverdue}d`;
      const from = v.from ? `  [from ${v.from}]` : "";
      process.stdout.write(`  ${v.slug}  (${when}, due ${v.due})  — ${v.name}${from}\n`);
    }
  }

  if (vigils.armed.length > 0) {
    process.stdout.write("Vigils armed (event-gated):\n");
    for (const v of vigils.armed) {
      const opened = v.opened ? `  (opened ${v.opened})` : "";
      process.stdout.write(`  ${v.slug}  — waiting on: ${v.until}${opened}\n`);
    }
  }
}

// ---------------------------------------------------------------------------
// tracker ritual <add|run|complete|list>
// ---------------------------------------------------------------------------

function runRitual(args: string[]): void {
  const sub = args[0];

  if (sub === "add") {
    runRitualAdd(args.slice(1));
    return;
  }
  if (sub === "run") {
    runRitualRun(args.slice(1));
    return;
  }
  if (sub === "complete") {
    runRitualComplete(args.slice(1));
    return;
  }
  if (sub === "list") {
    runRitualList(args.slice(1));
    return;
  }

  process.stderr.write("Usage: tracker ritual <add|run|complete|list> [options]\n");
  process.exit(1);
}

function runRitualAdd(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: {
      name: { type: "string" },
      slug: { type: "string" },
      cadence: { type: "string" },
      due: { type: "string" },
      agent: { type: "string" },
      owner: { type: "string" },
    },
    allowPositionals: false,
  });

  if (!values.name || !values.slug) {
    process.stderr.write(
      "Usage: tracker ritual add --name <name> --slug <slug> [--cadence <7d|2w|1m>] [--due <YYYY-MM-DD>] [--agent <name>] [--owner <email>]\n",
    );
    process.exit(1);
  }

  const trackerRoot = requireTrackerRoot();
  try {
    const result = addRitual({
      trackerRoot,
      name: values.name,
      slug: values.slug,
      cadence: values.cadence,
      due: values.due,
      agent: values.agent,
      owner: values.owner,
    });
    if (result.kind === "exists") {
      process.stdout.write(`tracker ritual add: already exists at ${result.dirPath}\n`);
    } else {
      process.stdout.write(`tracker ritual add: created ${result.ritualPath}\n`);
    }
  } catch (err) {
    process.stderr.write(
      `tracker ritual add: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}

function runRitualRun(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    options: {
      slug: { type: "string" },
      date: { type: "string" },
    },
    allowPositionals: true,
  });

  const slug = values.slug ?? positionals[0];
  if (!slug) {
    process.stderr.write("Usage: tracker ritual run <slug> [--date <YYYY-MM-DD>]\n");
    process.exit(1);
  }

  const trackerRoot = requireTrackerRoot();
  try {
    const result = stampRun({ trackerRoot, slug, date: values.date });
    if (result.kind === "exists") {
      process.stdout.write(`tracker ritual run: run already exists at ${result.runPath}\n`);
    } else {
      process.stdout.write(`tracker ritual run: stamped ${result.runPath}\n`);
    }
  } catch (err) {
    process.stderr.write(
      `tracker ritual run: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}

function runRitualComplete(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    options: {
      slug: { type: "string" },
      today: { type: "string" },
    },
    allowPositionals: true,
  });

  const slug = values.slug ?? positionals[0];
  if (!slug) {
    process.stderr.write("Usage: tracker ritual complete <slug> [--today <YYYY-MM-DD>]\n");
    process.exit(1);
  }

  const trackerRoot = requireTrackerRoot();
  try {
    const result = completeRun({ trackerRoot, slug, today: values.today });
    const rolled = result.rolledDue
      ? `next due ${result.rolledDue}`
      : "now dormant (no cadence; set --due to re-arm)";
    const pruned =
      result.pruned.length > 0 ? `, pruned ${result.pruned.length} run(s) to ledger` : "";
    process.stdout.write(
      `tracker ritual complete: ${slug} ran ${result.lastRun}, ${rolled}${pruned}\n`,
    );
  } catch (err) {
    process.stderr.write(
      `tracker ritual complete: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}

function runRitualList(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: { json: { type: "boolean", default: false } },
    allowPositionals: false,
  });

  const trackerRoot = requireTrackerRoot();
  writeRitualList(readTrackerState(trackerRoot).rituals, values.json);
}

/** The `tracker ritual list` output, shared by the `.tracker/` reader. */
function writeRitualList(
  records: ReadonlyArray<{
    slug: string;
    cadence: string | null;
    lastRun: string | null;
    due: string | null;
    runsCount: number;
  }>,
  json: boolean,
): void {
  if (json) {
    process.stdout.write(JSON.stringify(records, null, 2) + "\n");
    return;
  }

  if (records.length === 0) {
    process.stdout.write("No rituals\n");
    return;
  }

  for (const r of records) {
    process.stdout.write(
      `${r.slug}  cadence=${r.cadence ?? "—"}  last_run=${r.lastRun ?? "—"}  due=${r.due ?? "—"}  runs=${r.runsCount}\n`,
    );
  }
}

// ---------------------------------------------------------------------------
// tracker vigil <add|list|close>
// ---------------------------------------------------------------------------

function runVigil(args: string[]): void {
  const sub = args[0];

  if (sub === "add") {
    runVigilAdd(args.slice(1));
    return;
  }
  if (sub === "set-body") {
    runVigilSetBody(args.slice(1));
    return;
  }
  if (sub === "list") {
    runVigilList(args.slice(1));
    return;
  }
  if (sub === "close") {
    runVigilClose(args.slice(1));
    return;
  }

  process.stderr.write("Usage: tracker vigil <add|list|set-body|close> [options]\n");
  process.exit(1);
}

function runVigilAdd(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    options: {
      slug: { type: "string" },
      name: { type: "string" },
      due: { type: "string" },
      until: { type: "string" },
      from: { type: "string" },
      agent: { type: "string" },
      opened: { type: "string" },
      stdin: { type: "boolean", default: false },
      content: { type: "string" },
    },
    allowPositionals: true,
  });

  const slug = values.slug ?? positionals[0];
  if (!slug) {
    process.stderr.write(
      'Usage: tracker vigil add <slug> [--name "Title"] [--due <YYYY-MM-DD>] [--until "<event>"] [--from <ref>] [--agent <name>] [--stdin | --content <path>]\n',
    );
    process.exit(1);
  }

  if (values.content !== undefined && values.stdin) {
    process.stderr.write(
      "tracker vigil add: --content <path> and --stdin are mutually exclusive\n",
    );
    process.exit(1);
  }

  const bodySupplied = values.stdin || values.content !== undefined;
  const body = bodySupplied ? readVigilBody("vigil add", values.content) : undefined;

  const trackerRoot = requireTrackerRoot();
  try {
    const result = addVigil({
      trackerRoot,
      slug,
      name: values.name ?? slug,
      due: values.due,
      until: values.until,
      from: values.from,
      agent: values.agent,
      opened: values.opened,
      body,
    });
    if (result.kind === "exists") {
      process.stdout.write(`tracker vigil add: already exists at ${result.vigilPath}\n`);
      // Never silently drop a body the caller piped in: `add` is idempotent by
      // design, so the second run has to say which command would land it.
      if (bodySupplied) {
        process.stdout.write(
          `  body NOT written — replace it with \`tracker vigil set-body ${slug} --stdin\`\n`,
        );
      }
    } else {
      process.stdout.write(
        `tracker vigil add: created ${result.vigilPath} ` +
          `(${result.executableCommands} executable Command${result.executableCommands === 1 ? "" : "s"})\n`,
      );
    }
    warnIfGuardedSpecNeverShipped(trackerRoot, values.from);
  } catch (err) {
    process.stderr.write(
      `tracker vigil add: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}

/**
 * `tracker vigil set-body <slug> (--stdin | --content <path>)` — replace the
 * checklist of an armed vigil, frontmatter untouched.
 *
 * Mirrors `worklog distill`'s input contract exactly (XOR of --stdin and
 * --content, fd 0 for the pipe) because it serves the same caller: an agent
 * with no Write tool holding a heredoc.
 */
function runVigilSetBody(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    options: {
      slug: { type: "string" },
      stdin: { type: "boolean", default: false },
      content: { type: "string" },
    },
    allowPositionals: true,
  });

  const slug = values.slug ?? positionals[0];
  if (!slug) {
    process.stderr.write(
      "Usage: tracker vigil set-body <slug> (--stdin | --content <path>)\n",
    );
    process.exit(1);
  }

  if ((values.content !== undefined) === values.stdin) {
    process.stderr.write(
      "tracker vigil set-body: exactly one of --content <path> or --stdin is required\n",
    );
    process.exit(1);
  }

  const body = readVigilBody("vigil set-body", values.content);

  const trackerRoot = requireTrackerRoot();
  try {
    const result = setVigilBody({ trackerRoot, slug, body });
    process.stdout.write(
      `tracker vigil set-body: wrote ${result.vigilPath} ` +
        `(${result.executableCommands} executable Command${result.executableCommands === 1 ? "" : "s"})\n`,
    );
  } catch (err) {
    process.stderr.write(
      `tracker vigil set-body: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}

/** Read a vigil body from fd 0, or from `--content <path>` when given. */
function readVigilBody(command: string, contentPath: string | undefined): string {
  try {
    return contentPath === undefined
      ? readFileSync(0, "utf-8")
      : readFileSync(contentPath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`tracker ${command}: cannot read body: ${message}\n`);
    process.exit(1);
  }
}

/**
 * Warn — never refuse — when `--from` points at a spec with nothing verified.
 *
 * A soak observes shipped code. Four vigils on this estate guarded specs at 0
 * ticks and stayed armed for 26 days before anyone read the premise; no
 * evidence could ever have closed them. But arming a vigil the same hour a
 * deploy lands, before `verify` has caught up with the checklist, is normal and
 * correct — so this is a warning the operator judges, not a gate. A `--from`
 * that names no spec on disk is skipped in silence.
 */
function warnIfGuardedSpecNeverShipped(trackerRoot: string, from: string | undefined): void {
  if (from === undefined || from.trim() === "") return;
  const milestoneDir = resolveFromMilestone(trackerRoot, from);
  if (milestoneDir === null) return;
  const specPath = resolveFromSpec(milestoneDir, from);
  if (specPath === null) return;

  const spec = parseSpec(readFileSync(specPath, "utf-8"), specPath);
  const verified = spec.checklistItems.filter((i) => i.state === "verified").length;
  if (verified > 0) return;

  process.stderr.write(
    `tracker vigil add: WARNING — ${specPath} has 0 verified items.\n` +
      "  A vigil guards work that shipped. If this spec has not shipped, the vigil cannot be\n" +
      "  closed by any evidence and will sit in `tracker due` forever. Confirm the deploy, or\n" +
      "  arm the vigil after `tracker verify` has ticked the spec.\n",
  );
}

function isOpenVigil(v: VigilRecord): boolean {
  return v.verdict === null || v.verdict === "";
}

function vigilGateSummary(v: VigilRecord): string {
  const parts: string[] = [];
  if (v.due) parts.push(`due ${v.due}`);
  if (v.until) parts.push(`until: ${v.until}`);
  return parts.length > 0 ? `(${parts.join("; ")})` : "(no gate)";
}

function runVigilList(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: {
      all: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const trackerRoot = requireTrackerRoot();
  const state = readTrackerState(trackerRoot);
  const shown = values.all ? state.vigils : state.vigils.filter(isOpenVigil);

  if (values.json) {
    process.stdout.write(JSON.stringify(shown, null, 2) + "\n");
    return;
  }

  if (shown.length === 0) {
    process.stdout.write(values.all ? "No vigils\n" : "No open vigils\n");
    return;
  }

  for (const v of shown) {
    const from = v.from ? `  [from ${v.from}]` : "";
    if (isOpenVigil(v)) {
      process.stdout.write(
        `${v.slug}  ${vigilGateSummary(v)}  — ${v.name}  (opened ${v.opened ?? "—"})${from}\n`,
      );
    } else {
      process.stdout.write(
        `${v.slug}  [${v.verdict}, resolved ${v.resolved ?? "—"}]  — ${v.name}${from}\n`,
      );
    }
  }
}

function runVigilClose(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    options: {
      slug: { type: "string" },
      verdict: { type: "string" },
      date: { type: "string" },
    },
    allowPositionals: true,
  });

  const slug = values.slug ?? positionals[0];
  if (!slug || !values.verdict) {
    process.stderr.write(
      "Usage: tracker vigil close <slug> --verdict <held|failed> [--date <YYYY-MM-DD>]\n",
    );
    process.exit(1);
  }

  const trackerRoot = requireTrackerRoot();
  try {
    const result = closeVigil({
      trackerRoot,
      slug,
      verdict: values.verdict,
      date: values.date,
    });
    if (result.kind === "already-closed") {
      const resolved = result.resolved ? `, resolved ${result.resolved}` : "";
      process.stdout.write(
        `tracker vigil close: ${slug} already closed (verdict ${result.verdict}${resolved}) — not overwritten\n`,
      );
      return;
    }
    process.stdout.write(
      `tracker vigil close: ${slug} closed — verdict ${result.verdict}, resolved ${result.resolved}\n`,
    );
    if (result.verdict === "failed") {
      process.stdout.write(
        "  Remediation goes to a new spec via /tracker:add — never bolt it onto the vigil.\n",
      );
    }
  } catch (err) {
    process.stderr.write(
      `tracker vigil close: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Resolve AgentDiscoveryOptions anchored to the project root.
 *
 * The project root is the parent of the .tracker/ directory.  Using it as the
 * base for projectSettingsPath and projectAgentsDir ensures that agents enabled
 * via <repo-root>/.claude/settings.json are discovered regardless of what
 * directory the CLI was invoked from.
 *
 * Falls back to process.cwd() when no .tracker/ directory can be located
 * (e.g. running tracker agents outside of a tracked repo).
 */
// ---------------------------------------------------------------------------
// tracker archive-check <milestone> (M315/07)
// ---------------------------------------------------------------------------

/**
 * Refuse to archive a milestone while a vigil it armed is unrunnable.
 *
 * Archiving is where a milestone stops being watched. If it left behind an
 * armed vigil with no executable `Command:`, that vigil outlives the folder
 * that explains it: nobody can work it, nobody can close it, and it accretes in
 * `tracker due` as permanent noise. The M315/06 sweep found 23 such vigils
 * across 48, several belonging to milestones archived weeks earlier.
 *
 * There is no `--force`. The two ways past this gate are the two honest ones:
 * give the vigil a real Command, or close it with a verdict.
 *
 * Exit 0 = clear to archive. Exit 1 = refused (or the milestone does not exist).
 * `/tracker:archive` calls this in its validate step, before anything is
 * written or deleted.
 */
function runArchiveCheck(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    options: {
      milestone: { type: "string" },
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  const milestoneArg = values.milestone ?? positionals[0];
  if (!milestoneArg) {
    process.stderr.write("Usage: tracker archive-check <milestone-folder|slug> [--json]\n");
    process.exit(1);
  }

  const trackerRoot = requireTrackerRoot();

  let milestonePath: string;
  try {
    milestonePath = resolveMilestonePath(trackerRoot, milestoneArg);
  } catch (err) {
    process.stderr.write(
      `tracker archive-check: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
    return;
  }

  const blocking = readAllVigilHealth(trackerRoot).filter(
    (v) => isUnrunnable(v) && v.milestoneDir === milestonePath,
  );

  if (values.json) {
    process.stdout.write(
      JSON.stringify(
        {
          milestone: milestonePath,
          clear: blocking.length === 0,
          blocking: blocking.map((v) => ({
            slug: v.slug,
            file: v.file,
            from: v.from,
            commandCount: v.commandCount,
          })),
        },
        null,
        2,
      ) + "\n",
    );
    if (blocking.length > 0) process.exit(1);
    return;
  }

  if (blocking.length === 0) {
    process.stdout.write(
      `tracker archive-check: clear — no armed vigil from ${basename(milestonePath)} is unrunnable\n`,
    );
    return;
  }

  process.stderr.write(
    `tracker archive-check: REFUSED — ${basename(milestonePath)} armed ${blocking.length} vigil(s) ` +
      "that nobody can run:\n",
  );
  for (const v of blocking) {
    const cause =
      v.commandCount === 0
        ? "no Command: line at all"
        : `all ${v.commandCount} Command: lines are shell no-ops`;
    process.stderr.write(`  - ${v.slug} (${cause})\n    ${v.file}\n`);
  }
  process.stderr.write(
    "\nArchiving would orphan them: the milestone that explains the check disappears and the\n" +
      "vigil stays due forever. Fix each one — give it a real Command — or close it:\n" +
      "  tracker vigil close <slug> --verdict held|failed\n",
  );
  process.exit(1);
}

function resolveAgentOptsFromTrackerRoot(): import("../lib/agent-discovery.ts").AgentDiscoveryOptions {
  const trackerRoot = findTrackerRoot(process.cwd());
  // project root = parent of .tracker/
  const projectRoot = trackerRoot !== null ? join(trackerRoot, "..") : process.cwd();
  return {
    projectSettingsPath: join(projectRoot, ".claude", "settings.json"),
    projectAgentsDir: join(projectRoot, ".claude", "agents"),
  };
}

function milestoneToJSON(m: MilestoneEntry) {
  return {
    slug: m.slug,
    name: m.name,
    number: m.number,
    verified: m.verified,
    total: m.total,
    status: m.status,
    specCount: m.specs.length,
    brokenSpecCount: m.brokenSpecs.length,
  };
}

// Self-run guard: an import (darius dispatch) must not execute the CLI.
// `import.meta.main` needs Node 24, so compare the entry path instead.
const entry = process.argv[1];
if (entry !== undefined && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2));
}
