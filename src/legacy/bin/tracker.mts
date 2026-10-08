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
 *   worklog open <milestone-slug> --spec <path> [--message "..."] [--session <id>]
 *   worklog set-stage <thread-id> <stage> [--commit <sha>] [--no-git] [--force --reason "..."]
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
  findActiveMilestone,
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
  scanWorklogDir,
  threadArtifactPaths,
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
  isReviewTranscript,
  parseReviewTranscript,
  applyReviewGate,
  ReviewFormatError,
  REVIEW_ITEMS,
  reviewFenceProblem,
  type GateDecision,
  type ReviewParseResult,
  type SingleDissentMode,
} from "../lib/counsel-gate.ts";
import {
  selectVerifiedUncommitted,
  selectVerifiedThreads,
  markerListsMilestone,
  hasVerificationPassed,
  type ThreadForGate,
} from "../lib/uncommitted.ts";
import {
  readClaims,
  mutateClaims,
  inspectClaim,
  listClaims,
  formatClaimLine,
  claimHolder,
  releaseClaim,
  normalizeClaimRef,
  canonicalSpecRef,
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
import { StageRefusal, gitPrefix, projectRootOf } from "../lib/stage-evidence.ts";
import { hostName } from "../lib/host-stamp.ts";
import {
  appendCounselLog,
  checkCounselStamp,
  sha256OfFile,
  specContentSha256,
  spentRounds,
} from "../lib/counsel-stamp.ts";
import { discoverAgents } from "../lib/agent-discovery.ts";
import { execFileSync, spawnSync } from "node:child_process";
import { runDelegation } from "../lib/delegation.ts";
import { runHookDrift, runHookStop } from "../lib/hooks.ts";
import { usageFor, wantsHelp } from "../lib/usage.ts";

/** Verbs that print their own usage for `--help`. */
const SELF_HELP_VERBS: ReadonlySet<string> = new Set(["migrate", "agents", "uncommitted-verified", "claim", "release", "loop-check"]);

/**
 * Runs one tracker command. `argv` excludes the program name. Returns the exit code (verbs that fail call process.exit themselves).
 *
 * The contract around every verb (docs/concept.md, "CLI contract"): `--help`
 * or `-h` anywhere prints the usage on stdout, exits 0 and runs nothing; a
 * mistake in the command line that `node:util` parseArgs finds (an unknown
 * option, a missing value) is a usage error, exit 2.
 */
export async function main(argv: string[]): Promise<number> {
  const verb = argv[0];
  if (verb !== undefined && !SELF_HELP_VERBS.has(verb) && wantsHelp(argv.slice(1))) {
    const usage = usageFor(argv);
    if (usage !== null) {
      process.stdout.write(`${usage.join("\n")}\n`);
      return 0;
    }
  }
  try {
    return await dispatch(argv);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const code = "code" in error && typeof error.code === "string" ? error.code : "";
    if (!code.startsWith("ERR_PARSE_ARGS_")) throw error;
    const unknown = /^Unknown option '(--?[^']+)'/u.exec(error.message);
    const text = unknown === null ? error.message : `unknown option ${unknown[1] ?? ""}`;
    process.stderr.write(`darius ${argv[0] ?? ""}: ${text}\n`);
    return 2;
  }
}

async function dispatch(argv: string[]): Promise<number> {
  const rawArgs = argv;
  const subcommand = rawArgs[0];

  if (subcommand === "root") {
    runRoot(rawArgs.slice(1));
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
    await runWorklog(rawArgs.slice(1));
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
    await runCounselGate(rawArgs.slice(1));
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

  if (subcommand === "hook-stop" || subcommand === "hook-drift") {
    // A hook takes no arguments: its input is JSON on stdin. A stray flag is a usage error.
    if (rawArgs.length > 1) {
      process.stderr.write(`darius ${subcommand}: unknown option ${rawArgs[1] ?? ""} (a hook takes no arguments)\n`);
      return 2;
    }
    return subcommand === "hook-stop" ? runHookStop() : runHookDrift();
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
    process.stderr.write("Usage: darius <subcommand> [args]\n");
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
    process.stderr.write("  worklog set-stage <thread-id> <planned|dispatched|verified|committed|reviewed> [--commit <sha>] [--no-git] [--force --reason \"...\"]\n");
    process.stderr.write("  counsel-gate <transcript-path> [--spec <spec-path>] [--threshold N] [--max-rounds N] [--ack-dissent] [--json]\n");
    process.stderr.write("      reads a ```darius-review block (one reviewer, 0.74.0) or the older four-advisor transcript.\n");
    process.stderr.write("  agents [--json]\n");
    process.stderr.write("  uncommitted-verified [--json]\n");
    process.stderr.write("  claim <spec-ref> [--session <id>] [--ttl 8h] [--takeover] [--json]\n");
    process.stderr.write("  claim --list [--json]\n");
    process.stderr.write("  release <spec-ref> [--session <id>] [--force] [--json]\n");
    process.stderr.write("  loop-check [--json] [--session <id>] [--bounce <id>] [--max-bounces N]\n");
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
    return 2;
  }

  process.stderr.write(`darius: unknown command: ${subcommand}\n`);
  return 2;
}

// ---------------------------------------------------------------------------
// tracker root
// ---------------------------------------------------------------------------

function runRoot(args: string[]): void {
  parseArgs({ args, options: {}, allowPositionals: false });
  const trackerDir = findTrackerRoot(process.cwd());
  if (trackerDir === null) {
    process.stderr.write("darius: no .tracker/ directory found\n");
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
    process.stderr.write("Usage: darius show <spec-path> [--json]\n");
    process.exit(2);
  }

  const filePath = resolve(pathArg);

  if (!existsSync(filePath)) {
    process.stderr.write(`darius show: file not found: ${filePath}\n`);
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
    process.stderr.write(`darius show: ${message}\n`);
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
    process.stderr.write("darius: no .tracker/ directory found\n");
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

  process.stderr.write("Usage: darius list <milestones|specs> [options]\n");
  process.exit(2);
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
    process.stderr.write("darius: no .tracker/ directory found\n");
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
    process.stderr.write("darius: no .tracker/ directory found\n");
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
          host: claim.claim?.host ?? null,
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
        ? `  [CLAIM STALE: ${claimHolder(claim.claim)}, ${claim.expiryLabel}]`
        : claim.state === "own"
          ? `  [CLAIMED by this session, ${claim.expiryLabel}]`
          : `  [CLAIMED: ${claimHolder(claim.claim)}, ${claim.ageLabel} ago]`;
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
      json: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const trackerRoot = findTrackerRoot(process.cwd());
  if (trackerRoot === null) {
    process.stderr.write("darius: no .tracker/ directory found\n");
    process.exit(1);
  }

  const state = readTrackerState(trackerRoot);
  const session = resolveSessionId(values.session);
  const claims = readClaims(trackerRoot);
  // Specs with open work that another live session holds (0.76.0): skipped,
  // so the next free spec is handed out instead.
  const skippedClaimed: { spec: string; session: string | null; host: string | null }[] = [];
  const emit = (out: Record<string, unknown>, human: string): void => {
    if (values.json) process.stdout.write(JSON.stringify({ ...out, skippedClaimed }, null, 2) + "\n");
    else process.stdout.write(human);
  };

  // Walk milestones in order, then specs in order, then tasks in order.
  // Skip terminal milestones, Waiting specs, and items that are not actionable.
  for (const milestone of state.milestones) {
    if (isTerminalMilestone(milestone.status)) {
      continue;
    }

    if (milestone.brokenSpecs.length > 0) {
      const b = milestone.brokenSpecs[0]!;
      emit(
        { status: "broken", file: b.file, milestone: milestone.slug, error: b.error },
        `[!] Fix unparseable spec: ${b.file} (${milestone.slug}) — ${b.error}\n`,
      );
      return;
    }

    for (const spec of milestone.specs) {
      if (spec.effectiveStatus === "Waiting") continue;
      if (spec.view.computedStatus === "Complete") continue;
      if (spec.view.computedStatus === "Skipped") continue;

      const item = spec.view.checklistItems.find((i) => i.state === "pending" || i.state === "in_progress");
      if (item === undefined) continue;

      // Gate at the point of HANDING OUT the work, not while scanning: a spec
      // claimed by someone else but already complete is never offered anyway.
      const ref = normalizeClaimRef({ trackerRoot, ref: spec.absolutePath });
      const claim = inspectClaim(claims, ref, session);
      if (claim.state === "held" && !values.force) {
        skippedClaimed.push({ spec: ref, session: claim.claim?.session ?? null, host: claim.claim?.host ?? null });
        continue;
      }
      if (claim.state === "held") {
        process.stderr.write(
          `darius next: ⚠ --force: offering ${ref} despite a LIVE claim by ${claimHolder(claim.claim)}.\n`,
        );
      } else if (claim.state === "stale") {
        process.stderr.write(
          `darius next: NOTE: ${ref} carries a STALE claim by ${claimHolder(claim.claim)} (${claim.expiryLabel}).\n`,
        );
      }
      if (skippedClaimed.length > 0 && !values.json) {
        process.stderr.write(
          `darius next: skipped ${skippedClaimed.length} spec(s) claimed by another live session: ` +
            `${skippedClaimed.map((c) => c.spec).join(", ")}\n`,
        );
      }
      emit(
        { status: "task", label: item.label, file: spec.file, spec: ref, milestone: milestone.slug },
        `[ ] ${item.label} (${spec.file})\n`,
      );
      return;
    }
  }

  if (skippedClaimed.length > 0) {
    if (values.json) {
      process.stdout.write(JSON.stringify({ status: "claimed", skippedClaimed }, null, 2) + "\n");
    }
    process.stderr.write(
      `darius next: REFUSED: every ready spec is claimed by another live session: ` +
        `${skippedClaimed.map((c) => `${c.spec} (${c.session ?? "unknown"})`).join(", ")}. ` +
        "Wait, or re-run with --force.\n",
    );
    process.exit(1);
  }

  emit({ status: "complete" }, "All tasks complete\n");
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
    process.stderr.write(`darius init: ${message}\n`);
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

  process.stderr.write("Usage: darius add <milestone|spec> [options]\n");
  process.exit(2);
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
      "Usage: darius add milestone --name <name> --slug <slug> --owner <email> [--target <date>] [--number N]\n",
    );
    process.exit(2);
  }

  // Explicit number is opt-in; auto-mint is the default. Either way the
  // namespace guard in addMilestone refuses a number an active or ARCHIVED
  // milestone already holds under any prefix (M / DLP / ATH / BLD).
  let explicitNumber: number | undefined;
  if (values.number !== undefined) {
    if (!/^\d+$/.test(values.number)) {
      process.stderr.write(
        `darius add milestone: invalid --number "${values.number}" (expected a positive integer)\n`,
      );
      process.exit(2);
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
        `darius add milestone: milestone with slug "${values.slug}" already exists at ${result.folderPath}\n`,
      );
      return;
    }

    process.stdout.write(
      `darius add milestone: created M${result.number}-${values.slug} at ${result.folderPath}\n`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`darius add milestone: ${message}\n`);
    process.exit(failCode(err));
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
      "Usage: darius add spec --milestone <slug> --name <name> --template <generic|api-endpoint|ui-component|library> [--depends-on <path>...] [--agent <name>] [--manual --owner <who> --expires <YYYY-MM-DD>]\n",
    );
    process.exit(2);
  }

  // --manual is all-or-nothing: an operator decision with no owner and no
  // expiry is the promise this guard exists to refuse.
  if (values.manual && (!values.owner || !values.expires)) {
    process.stderr.write(
      "darius add spec: --manual requires --owner <who> and --expires <YYYY-MM-DD>\n",
    );
    process.exit(2);
  }
  if (!values.manual && (values.owner || values.expires)) {
    process.stderr.write(
      "darius add spec: --owner/--expires only apply with --manual\n",
    );
    process.exit(2);
  }

  const validTemplates: TemplateKind[] = ["generic", "api-endpoint", "ui-component", "library"];
  if (!validTemplates.includes(values.template as TemplateKind)) {
    process.stderr.write(
      `darius add spec: invalid template "${values.template}". Allowed: ${validTemplates.join(", ")}\n`,
    );
    process.exit(2);
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
        `darius add spec: spec "${values.name}" already exists at ${result.filePath}\n`,
      );
      return;
    }

    process.stdout.write(
      `darius add spec: created ${result.filePath}\n`,
    );
    if (!values.manual) {
      process.stdout.write(
        `  Scaffolded checks fail on purpose (\`${SCAFFOLD_PLACEHOLDER_COMMAND}\`) — replace each\n` +
          "  Command with a real assertion. A placeholder that exits 0 reads like a check and is not one.\n",
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`darius add spec: ${message}\n`);
    process.exit(failCode(err));
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
      override: { type: "string" },
    },
    allowPositionals: true,
  });

  const specPath = positionals[0];
  const taskIdxStr = positionals[1];

  if (!specPath || !taskIdxStr) {
    process.stderr.write(
      "Usage: darius mark <spec-path> <task-idx> --verified|--in-progress|--blocked|--skipped|--pending [--evidence \"...\"]\n",
    );
    process.exit(2);
  }

  const taskIndex = parseInt(taskIdxStr, 10);
  if (isNaN(taskIndex) || taskIndex < 0) {
    process.stderr.write(`darius mark: invalid task index "${taskIdxStr}"\n`);
    process.exit(2);
  }

  let state: MarkState;
  if (values.verified) state = "verified";
  else if (values["in-progress"]) state = "in-progress";
  else if (values.blocked) state = "blocked";
  else if (values.skipped) state = "skipped";
  else if (values.pending) state = "pending";
  else {
    process.stderr.write(
      "darius mark: must specify one of --verified, --in-progress, --blocked, --skipped, --pending\n",
    );
    process.exit(2);
    return;
  }

  const evidence = values.evidence?.trim();

  if (evidence !== undefined && evidence !== "" && state !== "verified") {
    process.stderr.write(
      `darius mark: --evidence only applies to --verified (got --${state})\n`,
    );
    process.exit(1);
  }

  const override = values.override?.trim();
  if (override !== undefined && (override === "" || state !== "verified")) {
    process.stderr.write(
      'darius mark: --override needs a non-empty reason and applies to --verified only: --override "<why the check cannot run>"\n',
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

  // A runnable check (0.76.0): its Command is real, so verify-item must run
  // it. A hand mark needs --override "<reason>" and evidence, and the ledger
  // line says manual-override.
  const classified =
    targetItem === null
      ? null
      : classifyItem({ index: targetItem.index, label: targetItem.label, command: targetItem.command, expected: targetItem.expected });
  const runnable = classified !== null && (classified.kind === "would-execute" || classified.kind === "file-check");
  if (state === "verified" && runnable && override === undefined) {
    process.stderr.write(
      `darius mark: REFUSED: task ${taskIndex} has a runnable check (${JSON.stringify(targetItem?.command ?? "")}). ` +
        "Run it instead:\n" +
        `  darius verify-item ${specPath} ${taskIndex}\n` +
        "  If it truly cannot run here, mark it with a reason and evidence:\n" +
        `  darius mark ${specPath} ${taskIndex} --verified --override "<why it cannot run>" --evidence "<what was checked>"\n`,
    );
    process.exit(1);
  }
  if (override !== undefined && !runnable) {
    process.stderr.write(
      `darius mark: --override is for a runnable check; task ${taskIndex} is manual. Use --evidence "..." alone\n`,
    );
    process.exit(1);
  }
  if (override !== undefined && (evidence === undefined || evidence === "")) {
    process.stderr.write(
      `darius mark: --override needs --evidence "<what was checked, how, by whom>" too\n`,
    );
    process.exit(1);
  }

  if (state === "verified" && commandIsTrivial && (evidence === undefined || evidence === "")) {
    process.stderr.write(
      `darius mark: task ${taskIndex} has a shell no-op Command ` +
        `(${JSON.stringify(targetItem?.command ?? "")}) — running it proves nothing, so a bare\n` +
        `  --verified would be an unevidenced claim. Re-run with what you actually checked:\n` +
        `  darius mark ${specPath} ${taskIndex} --verified --evidence "<what was checked, how, by whom/which agent, tier>"\n`,
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
        outcome: override !== undefined ? "manual-override" : "manual",
        evidence,
        ...(override !== undefined ? { override } : {}),
      });
      if (!logged) {
        process.stderr.write(
          `darius mark: warning — could not append to ${LEDGER_FILENAME}; the [x] stands but is unevidenced\n`,
        );
      }
    }

    process.stdout.write(`darius mark: task ${taskIndex} marked as ${state} in ${specPath}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`darius mark: ${message}\n`);
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
      "Usage: darius set-status <spec-path|milestone-folder> <status>\n" +
        "  Spec statuses: Not Started | In Progress | Complete | Blocked | Archived\n" +
        "  Milestone-only statuses: Skipped | Deferred | Closed\n",
    );
    process.exit(2);
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
      `darius set-status: invalid status "${statusArg}". Allowed: ${validStatuses.join(", ")}\n`,
    );
    process.exit(2);
  }

  const trackerRoot = requireTrackerRoot();

  try {
    setStatus({
      target: resolve(target),
      status: statusArg as SpecStatus | MilestoneOverrideStatus,
      trackerRoot,
    });
    process.stdout.write(`darius set-status: set status to "${statusArg}" in ${target}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`darius set-status: ${message}\n`);
    process.exit(failCode(err));
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
    process.stderr.write("Usage: darius index --rebuild\n");
    process.exit(2);
  }

  const trackerRoot = requireTrackerRoot();

  try {
    rebuildIndex(trackerRoot);
    process.stdout.write(`darius index: rebuilt ${join(trackerRoot, "00-INDEX.md")}\n`);

    // The worklog index rides the same rebuild so update-index and wrap-up get
    // it for free. A project with no worklog directory has nothing to index —
    // that is a silent no-op, not a failure.
    const worklogIndex = rebuildWorklogIndex(trackerRoot);
    if (worklogIndex !== null) {
      process.stdout.write(
        `darius index: rebuilt ${worklogIndex.path} (${worklogIndex.rows.length} worklog file(s))\n`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`darius index: ${message}\n`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// requireTrackerRoot — exit 1 if no .tracker/ found
// ---------------------------------------------------------------------------

/**
 * The exit code for an error a verb caught: a message that starts with
 * "Invalid" names a bad flag value (usage, 2); anything else is a failure (1).
 */
function failCode(cause: unknown): number {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /^Invalid\b/u.test(message) ? 2 : 1;
}

function requireTrackerRoot(): string {
  const trackerRoot = findTrackerRoot(process.cwd());
  if (trackerRoot === null) {
    process.stderr.write("darius: no .tracker/ directory found\n");
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
      `darius ${command}: --timeout takes a positive whole number of seconds (got ${JSON.stringify(raw)})\n`,
    );
    process.exit(2);
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
    `DRY RUN (darius ${opts.command}) — nothing was executed and nothing was written ` +
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
      "Usage: darius verify <spec-path> [--dry-run] [--recheck] [--timeout <seconds>]\n",
    );
    process.exit(2);
  }

  const absPath = resolve(specPath);
  if (!existsSync(absPath)) {
    process.stderr.write(`darius verify: spec not found: ${absPath}\n`);
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
    process.stderr.write(`darius verify: parse error: ${message}\n`);
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
        process.stderr.write(`darius verify: failed to mark task ${item.index}: ${message}\n`);
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
        `      darius mark ${specPath} ${m.index} --verified --evidence "<what was checked, how, by whom/which agent, tier>"\n`,
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
        `then re-run: darius verify ${specPath} --recheck\n`,
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
      "Usage: darius verify-item <spec-path> <task-idx> [--dry-run] [--recheck] [--timeout <seconds>]\n",
    );
    process.exit(2);
  }

  const taskIndex = parseInt(taskIdxStr, 10);
  if (isNaN(taskIndex) || taskIndex < 0) {
    process.stderr.write(`darius verify-item: invalid task index "${taskIdxStr}"\n`);
    process.exit(2);
  }

  const absPath = resolve(specPath);
  if (!existsSync(absPath)) {
    process.stderr.write(`darius verify-item: spec not found: ${absPath}\n`);
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
    process.stderr.write(`darius verify-item: parse error: ${message}\n`);
    process.exit(1);
  }

  const item = view.checklistItems.find((i) => i.index === taskIndex);
  if (!item) {
    process.stderr.write(
      `darius verify-item: task index ${taskIndex} not found (${view.checklistItems.length} items)\n`,
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
    process.stderr.write(`darius verify-item: task ${taskIndex} has no Command/Expected pair\n`);
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
      `darius verify-item: warning — task ${taskIndex} contains an absolute path; specs must use repo-relative paths (issue #4). Stripped at run time, but fix the spec.\n`,
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
      `darius verify-item: task ${taskIndex} NOT verified — ${result.reason}\n`,
    );
    process.stderr.write(
      `  darius mark ${specPath} ${taskIndex} --verified --evidence "<what was checked, how, by whom/which agent, tier>"\n`,
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
      process.stderr.write(`darius verify-item: failed to mark task: ${message}\n`);
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
      `darius verify-item: task ${taskIndex} TIMED OUT after ${timeoutMs / 1000}s — ${result.reason}\n`,
    );
    process.exit(1);
  }

  if (isRegression) {
    process.stderr.write(
      `darius verify-item: !!! REGRESSION — task ${taskIndex} was already [x] and no longer passes: ${result.reason}\n`,
    );
    process.stderr.write(
      `  The [x] was NOT removed — a tick records that the check passed then. Fix the code (or re-scope\n` +
        `  the item), then re-run: darius verify-item ${specPath} ${taskIndex} --recheck\n`,
    );
    process.exit(1);
  }

  process.stderr.write(`darius verify-item: task ${taskIndex} failed: ${result.reason}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// tracker worklog open|append|close|list
// ---------------------------------------------------------------------------

async function runWorklog(args: string[]): Promise<void> {
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
    await runWorklogSetStage(args.slice(1));
    return;
  }

  if (subcommand === "dispatch") {
    await runWorklogDispatch(args.slice(1));
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
    "Usage: darius worklog <open|append|close|list|set-stage|dispatch|park|distill|index> [options]\n",
  );
  process.exit(2);
}

function runWorklogOpen(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    options: {
      spec: { type: "string" },
      message: { type: "string" },
      stage: { type: "string" },
      session: { type: "string" },
      takeover: { type: "boolean", default: false },
      "as-other-session": { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  // The first positional is the milestone slug (required)
  const slug = positionals[0];

  // Only `planned` is a legal opening stage — later stages are reached via
  // set-stage/dispatch as the Work Loop progresses.
  if (values.stage !== undefined && values.stage !== "planned") {
    process.stderr.write(
      `darius worklog open: --stage must be "planned" at open, got "${values.stage}"\n`,
    );
    process.exit(2);
  }

  const trackerRoot = requireTrackerRoot();
  const worklogDir = join(trackerRoot, "worklog");
  if (!slug) {
    process.stderr.write(
      "darius worklog open: name the milestone: worklog open <milestone-slug>\n",
    );
    process.exit(2);
  }
  const fileName = `${slug}.md`;

  // Every worklog enumeration skips `00-` files as generated index docs, so a
  // thread opened into one would be written and then be invisible to list,
  // append and close forever. Refuse at the door rather than exit 0 on a
  // thread nobody can reach again.
  if (isWorklogIndexFile(fileName)) {
    process.stderr.write(
      `darius worklog open: "${fileName}" is a generated index name — ` +
        "00- files are excluded from every worklog listing, so this thread " +
        "would be unreachable. Pick a slug that does not start with 00-.\n",
    );
    process.exit(1);
  }

  // A worklog belongs to a milestone. Archived milestones take no new worklog,
  // so only the active tree counts. The file name stays exactly as passed.
  if (findActiveMilestone(trackerRoot, slug) === null) {
    process.stderr.write(
      `darius worklog open: "${slug}" names no milestone in .tracker/. ` +
        "A worklog belongs to a milestone: add it first (darius add milestone <name>), " +
        "or put findings in a plain doc in the repo.\n",
    );
    process.exit(1);
  }

  const worklogPath = join(worklogDir, fileName);
  const acting = sessionForWrite("worklog open", values.session, values["as-other-session"] === true);

  // Opening a thread on a spec is taking the work (0.76.0): a live claim by
  // another session refuses it, as `claim` does. --takeover overrides.
  if (values.spec) {
    const blocked = claimGate({
      trackerRoot,
      specRef: values.spec,
      sessionFlag: acting.session ?? undefined,
      force: values.takeover === true,
      command: "worklog open",
      overrideFlag: "--takeover",
    });
    if (blocked) process.exit(1);
  }

  try {
    const threadId = openThread({
      worklogPath,
      slug,
      specPath: values.spec,
      message: values.message,
      stage: values.stage as WorklogStage | undefined,
      session: acting.session,
    });
    if (acting.acting !== null) {
      appendThread({
        worklogPath,
        threadId,
        section: "note",
        message: `Opened for session ${acting.session ?? ""} by session ${acting.acting} (--as-other-session)`,
      });
    }
    process.stdout.write(`${threadId}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`darius worklog open: ${message}\n`);
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
      'Usage: darius worklog append <thread-id> --section "<section>" --message "..."\n',
    );
    process.exit(2);
  }

  if (!values.section || !values.message) {
    process.stderr.write("darius worklog append: --section and --message are required\n");
    process.exit(2);
  }

  const trackerRoot = requireTrackerRoot();

  // Find the worklog file for this thread
  const worklogPath = findWorklogFileForThread({ trackerRoot, threadId });
  if (!worklogPath) {
    process.stderr.write(`darius worklog append: thread not found: ${threadId}\n`);
    process.exit(1);
  }

  try {
    appendThread({
      worklogPath,
      threadId,
      section: values.section,
      message: values.message,
    });
    process.stdout.write(`darius worklog append: appended to ${threadId}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`darius worklog append: ${message}\n`);
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
      "Usage: darius worklog close <thread-id> --status <done|blocked|cancelled>\n",
    );
    process.exit(2);
  }

  const validStatuses = ["done", "blocked", "cancelled"];
  if (!values.status || !validStatuses.includes(values.status)) {
    process.stderr.write(
      `darius worklog close: --status must be one of: ${validStatuses.join(", ")}\n`,
    );
    process.exit(2);
  }

  const trackerRoot = requireTrackerRoot();
  const worklogPath = findWorklogFileForThread({ trackerRoot, threadId });
  if (!worklogPath) {
    process.stderr.write(`darius worklog close: thread not found: ${threadId}\n`);
    process.exit(1);
  }

  try {
    closeThread({
      worklogPath,
      threadId,
      status: values.status as "done" | "blocked" | "cancelled",
    });
    process.stdout.write(`darius worklog close: closed ${threadId} with status ${values.status}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`darius worklog close: ${message}\n`);
    process.exit(1);
  }
}

async function runWorklogSetStage(args: string[]): Promise<void> {
  const usage =
    `Usage: darius worklog set-stage <thread-id> <${WORKLOG_STAGES.join("|")}> ` +
    `[--commit <sha>] [--no-git] [--no-code "<why>"] [--force --reason "<why>"] [--session <id>]\n`;
  let values: { commit?: string; "no-git"?: boolean; "no-code"?: string; force?: boolean; reason?: string; session?: string };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args,
      options: {
        commit: { type: "string" },
        "no-git": { type: "boolean", default: false },
        "no-code": { type: "string" },
        force: { type: "boolean", default: false },
        reason: { type: "string" },
        session: { type: "string" },
      },
      allowPositionals: true,
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`darius worklog set-stage: ${message}\n${usage}`);
    process.exit(2);
  }

  const threadId = positionals[0];
  const stage = positionals[1];
  if (!threadId || !stage) {
    process.stderr.write(usage);
    process.exit(1);
  }

  if (!(WORKLOG_STAGES as readonly string[]).includes(stage)) {
    process.stderr.write(
      `darius worklog set-stage: invalid stage "${stage}". Allowed: ${WORKLOG_STAGES.join(", ")}\n`,
    );
    process.exit(2);
  }

  if (values.force && !values.reason?.trim()) {
    process.stderr.write(
      'darius worklog set-stage: --force needs a non-empty --reason "<why>". It is recorded on the thread.\n',
    );
    process.exit(2);
  }

  const trackerRoot = requireTrackerRoot();
  const worklogPath = findWorklogFileForThread({ trackerRoot, threadId });
  if (!worklogPath) {
    process.stderr.write(`darius worklog set-stage: thread not found: ${threadId}\n`);
    process.exit(1);
  }

  // `dispatched` hands out the work, as `worklog dispatch` does: a spec that
  // needs a review needs a stamp counsel-gate wrote (0.76.0). --force skips it.
  if (stage === "dispatched" && !values.force) {
    const thread = listThreads({ trackerRoot }).find((t) => t.threadId === threadId);
    if (thread?.specPath && (await reviewGateBlocks(trackerRoot, thread.specPath, "worklog set-stage"))) {
      process.exit(1);
    }
  }

  try {
    setStage({
      worklogPath,
      threadId,
      stage: stage as WorklogStage,
      trackerRoot,
      commit: values.commit,
      noGit: values["no-git"],
      ...(values["no-code"] !== undefined ? { noCode: values["no-code"] } : {}),
      force: values.force,
      reason: values.reason,
      session: resolveSessionId(values.session),
    });
    const forced = values.force ? " (forced)" : "";
    process.stdout.write(`darius worklog set-stage: ${threadId} → ${stage}${forced}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`darius worklog set-stage: ${message}\n`);
    process.exit(err instanceof StageRefusal ? err.exitCode : 1);
  }
}

async function runWorklogDispatch(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      agent: { type: "string" },
      reason: { type: "string" },
      session: { type: "string" },
      force: { type: "boolean", default: false },
      "as-other-session": { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  const threadId = positionals[0];
  if (!threadId || !values.agent) {
    process.stderr.write(
      'Usage: darius worklog dispatch <thread-id> --agent <invocable> [--reason "<one-line>"]\n',
    );
    process.exit(2);
  }

  const trackerRoot = requireTrackerRoot();
  const worklogPath = findWorklogFileForThread({ trackerRoot, threadId });
  if (!worklogPath) {
    process.stderr.write(`darius worklog dispatch: thread not found: ${threadId}\n`);
    process.exit(1);
  }

  const acting = sessionForWrite("worklog dispatch", values.session, values["as-other-session"] === true);

  // Dispatch is the other place work is handed out. A thread with no `spec:`
  // has nothing to collide on and passes straight through.
  const thread = listThreads({ trackerRoot }).find((t) => t.threadId === threadId);
  if (thread?.specPath) {
    const blocked = claimGate({
      trackerRoot,
      specRef: thread.specPath,
      sessionFlag: acting.session ?? undefined,
      force: values.force,
      command: "worklog dispatch",
    });
    if (blocked) process.exit(1);
    // The review gate (0.76.0) is not a claim: --force does not skip it.
    if (await reviewGateBlocks(trackerRoot, thread.specPath, "worklog dispatch")) process.exit(1);
  }

  try {
    dispatchThread({
      worklogPath,
      threadId,
      agent: values.agent,
      reason: values.reason,
      session: acting.session,
      actingSession: acting.acting,
    });
    process.stdout.write(
      `darius worklog dispatch: ${threadId} → dispatched (agent: ${values.agent})\n`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`darius worklog dispatch: ${message}\n`);
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
      'Usage: darius worklog park <thread-id> --reason "<why this work is being deferred>"\n',
    );
    process.exit(2);
  }

  const trackerRoot = requireTrackerRoot();
  const worklogPath = findWorklogFileForThread({ trackerRoot, threadId });
  if (!worklogPath) {
    process.stderr.write(`darius worklog park: thread not found: ${threadId}\n`);
    process.exit(1);
  }

  try {
    parkThread({ worklogPath, threadId, reason: values.reason });
    process.stdout.write(`darius worklog park: ${threadId} parked (closed: blocked)\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`darius worklog park: ${message}\n`);
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
        `darius worklog index: no ${join(trackerRoot, "worklog")} directory — nothing to index\n`,
      );
      return;
    }
    process.stdout.write(
      `darius worklog index: rebuilt ${result.path} (${result.rows.length} file(s))\n`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`darius worklog index: ${message}\n`);
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
      "darius worklog distill: --list surveys every file and cannot be combined with " +
        "--check or a <file> argument\n",
    );
    process.exit(2);
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
      "Usage: darius worklog distill <file> (--content <path> | --stdin) [--force] [--min-age-days N]\n" +
        "       darius worklog distill <file> --check [--min-age-days N]\n" +
        "       darius worklog distill --list [--json] [--min-age-days N]\n",
    );
    process.exit(2);
  }

  if (values.check) {
    const gate = evaluateDistillEligibility({ trackerRoot, file, minAgeDays });
    // The reason is the contract on stdout — scriptable. Detail rides stderr.
    process.stdout.write(`${gate.reason}\n`);
    if (!gate.eligible) {
      process.stderr.write(`darius worklog distill: ${gate.detail}\n`);
      process.exit(1);
    }
    return;
  }

  const contentPath = values.content;
  if ((contentPath !== undefined) === values.stdin) {
    process.stderr.write(
      "darius worklog distill: exactly one of --content <path> or --stdin is required\n",
    );
    process.exit(2);
  }

  let content = "";
  try {
    // fd 0 — darius and other Bash-only callers have no Write tool, so piping
    // the stub in has to work as well as pointing at a file.
    content =
      contentPath === undefined ? readFileSync(0, "utf-8") : readFileSync(contentPath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`darius worklog distill: cannot read stub content: ${message}\n`);
    process.exit(1);
  }

  if (content.trim() === "") {
    process.stderr.write(
      "darius worklog distill: refusing to distill to empty content — the stub must say something\n",
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
        `darius worklog distill: warning — stub is ${result.bytes} bytes, ` +
          `over the ${STUB_WARN_BYTES}-byte anchor budget\n`,
      );
    }
    process.stdout.write(
      `darius worklog distill: ${result.worklogFile} → anchor stub ` +
        `(raw ${result.rawPreserved}: ${result.rawPath}, ` +
        `sha256 ${result.sourceSha256.slice(0, 12)}…)\n`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`darius worklog distill: ${message}\n`);
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
      `darius worklog distill: --min-age-days must be a non-negative number, got "${raw}"\n`,
    );
    process.exit(2);
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
      json: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.quick && values.json) {
    process.stderr.write("darius doctor: --quick prints one line and has no --json form\n");
    process.exit(2);
  }

  if (values.quick) {
    runDoctorQuick();
    return;
  }

  const trackerRoot = requireTrackerRoot();

  try {
    const report = executeDoctorCheck({ trackerRoot, fix: values.fix });
    if (values.json) {
      process.stdout.write(JSON.stringify({ ok: report.healthy, ...report }, null, 2) + "\n");
      if (!report.healthy) process.exit(1);
      return;
    }
    const output = formatDoctorReport(report);
    process.stdout.write(output + "\n");

    if (!report.healthy) {
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Check if this is the future-version error from the schema check
    if (message.includes("plugin is too old")) {
      process.stderr.write(`darius doctor: ${message}\n`);
      process.exit(1);
    }
    process.stderr.write(`darius doctor: ${message}\n`);
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
      "tracker: clean, run `darius doctor` to stamp schema version\n",
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

  process.stderr.write("Usage: darius scan <artifacts|stubs> <path>\n");
  process.exit(2);
}

function runScanArtifacts(args: string[]): void {
  const { positionals } = parseArgs({
    args,
    options: {},
    allowPositionals: true,
  });

  const scanPath = positionals[0];
  if (!scanPath) {
    process.stderr.write("Usage: darius scan artifacts <path>\n");
    process.exit(2);
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
    process.stderr.write("Usage: darius scan stubs <path>\n");
    process.exit(2);
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
      "Usage: darius migrate [--from v1|v8|auto] [--dry-run|--apply]\n" +
        "\n" +
        "Upgrade a legacy darius to v9 CLI-native format.\n" +
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
        `darius migrate: invalid --from value "${fromArg}". Allowed: v1, v8, auto\n`,
      );
      process.exit(2);
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
      process.stdout.write("darius migrate: nothing to do.\n");
      return;
    }

    if (!dryRun) {
      process.stdout.write(
        `darius migrate: applied ${result.changeCount} change(s).\n`,
      );
      if (result.logPath) {
        process.stdout.write(`darius migrate: log written to ${result.logPath}\n`);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`darius migrate: ${message}\n`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// tracker counsel-gate <transcript-path> [--spec <spec-path>] [--threshold N] [--json]
// ---------------------------------------------------------------------------

async function runCounselGate(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      spec: { type: "string" },
      threshold: { type: "string" },
      "max-rounds": { type: "string" },
      "single-dissent": { type: "string" },
      "ack-dissent": { type: "boolean", default: false },
      override: { type: "string" },
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  // `--spec <s> --override "<reason>"` (0.76.0): skip the review for a
  // blocked or exhausted spec, on the record. It needs no transcript.
  if (values.override !== undefined) {
    runCounselOverride(values.spec, values.override, values.json === true);
    return;
  }

  const transcriptArg = positionals[0];
  if (!transcriptArg) {
    process.stderr.write(
      "Usage: darius counsel-gate <transcript-path> [--spec <spec-path>] [--threshold N] [--single-dissent surface|confirm|ignore] [--ack-dissent] [--json]\n",
    );
    process.exit(2);
  }

  const transcriptPath = resolve(transcriptArg);
  if (!existsSync(transcriptPath)) {
    process.stderr.write(`darius counsel-gate: transcript not found: ${transcriptPath}\n`);
    process.exit(1);
  }

  const raw = readFileSync(transcriptPath, "utf-8");

  // Exactly one ```darius-review block, and no near miss (0.76.0).
  const fenceProblem = reviewFenceProblem(raw);
  if (fenceProblem !== null) {
    process.stderr.write(`darius counsel-gate: bad review transcript: ${fenceProblem}\n`);
    process.exit(2);
  }

  // The one-reviewer format (0.74.0): a fenced ```darius-review block. A
  // transcript without one is the older four-advisor format, read as before.
  let review: ReviewParseResult | null = null;
  if (isReviewTranscript(raw)) {
    try {
      review = parseReviewTranscript(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const prefix = err instanceof ReviewFormatError ? "bad review transcript" : "parse error";
      process.stderr.write(`darius counsel-gate: ${prefix}: ${message}\n`);
      process.exit(2);
    }
  }

  // A high-risk spec takes the review format only (0.76.0).
  let specKey: string | null = null;
  let trackerRoot: string | null = null;
  if (values.spec) {
    trackerRoot = findTrackerRoot(process.cwd());
    specKey = trackerRoot === null ? null : canonicalSpecRef({ trackerRoot, ref: values.spec });
    if (review === null && trackerRoot !== null && specKey !== null) {
      if (await specIsHighRisk(join(trackerRoot, specKey))) {
        process.stderr.write(
          "darius counsel-gate: bad review transcript: the spec is high risk, so only a ```darius-review block is accepted\n",
        );
        process.exit(2);
      }
    }
  }

  let parse: { thumbsDown: number; thumbsUp: number; thumbsSideways: number };
  let baseDecision: GateDecision;
  if (review !== null) {
    parse = { thumbsDown: review.blockers, thumbsSideways: review.concerns, thumbsUp: review.oks };
    baseDecision = applyReviewGate(review, values["ack-dissent"] === true);
  } else {
    const threshold = resolveCounselThreshold(values.threshold);
    // --ack-dissent collapses a confirm-mode lone dissent back to "surface" so
    // the gate returns ready (the user has acknowledged it). The threshold count
    // still owns blocking — ack never overrides a >= threshold rejection.
    const singleDissentMode = values["ack-dissent"]
      ? "surface"
      : resolveSingleDissentMode(values["single-dissent"]);

    let counsel;
    try {
      counsel = parseCounselTranscript(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`darius counsel-gate: parse error: ${message}\n`);
      process.exit(1);
    }

    if (counsel.advisors.length === 0) {
      process.stderr.write(
        `darius counsel-gate: no advisor verdicts found in ${transcriptPath}\n`,
      );
      process.exit(1);
    }
    parse = counsel;
    baseDecision = applyGate(counsel, threshold, singleDissentMode);
  }

  // Round budget is only meaningful with a --spec to read/persist the counter.
  // An --ack-dissent re-run resolves a confirm-mode dissent the user already
  // acknowledged; it is not a fresh deliberation, so it does NOT consume a round.
  let decision = baseDecision;
  if (values.spec) {
    const specPath = resolve(values.spec);
    const isAck = values["ack-dissent"] === true;
    const maxRounds = resolveMaxCounselRounds(values["max-rounds"]);
    // The rounds spent come from the CLI's log (0.76.0), never fewer than the
    // frontmatter counter: lowering `counsel_rounds:` does not reset the budget.
    const frontmatterRounds = readCounselRounds(specPath);
    const priorRounds =
      trackerRoot !== null && specKey !== null ? spentRounds(trackerRoot, specKey, frontmatterRounds) : frontmatterRounds;
    const roundsUsed = isAck ? priorRounds : priorRounds + 1;
    decision = applyRoundBudget(baseDecision, roundsUsed, maxRounds);
    const sha256 = sha256OfFile(transcriptPath);
    const transcriptKey =
      trackerRoot !== null ? (canonicalSpecRef({ trackerRoot, ref: transcriptPath }) ?? transcriptPath) : transcriptPath;
    // A missing spec is reported by writeCounselFrontmatter.
    const specSha256 = existsSync(specPath) ? specContentSha256(readFileSync(specPath, "utf-8")) : "";
    writeCounselFrontmatter(specPath, decision, roundsUsed, { transcript: transcriptKey, sha256, specSha256 });
    if (trackerRoot !== null && specKey !== null) {
      appendCounselLog(trackerRoot, {
        spec: specKey,
        kind: isAck ? "ack" : "round",
        status: decision.status,
        at: new Date().toISOString(),
        transcript: transcriptKey,
        sha256,
        spec_sha256: specSha256,
        format: review === null ? "counsel" : "review",
        rounds: roundsUsed,
      });
    }
  }

  if (values.json) {
    process.stdout.write(JSON.stringify(decisionToJSON(decision, parse, review), null, 2) + "\n");
    return;
  }

  process.stdout.write(formatCounselGate(decision, parse, review));
}

/** `darius spec check` says high risk (whatever the review gate setting). */
async function specIsHighRisk(absSpec: string): Promise<boolean> {
  // SAFETY: darius's own spec check module; the export is checked before use.
  const mod = (await import(SPEC_CHECK_MODULE.href)) as Partial<{
    checkSpecFile(specPath: string, cwd: string): Promise<{ result: { risk: string } }>;
  }>;
  if (typeof mod.checkSpecFile !== "function") throw new Error("spec check is missing checkSpecFile");
  return (await mod.checkSpecFile(absSpec, process.cwd())).result.risk === "high";
}

/** `counsel-gate --spec <s> --override "<reason>"`: stamp `counsel: overridden` and log the reason. */
function runCounselOverride(specArg: string | undefined, reasonArg: string, json: boolean): void {
  const reason = reasonArg.trim();
  if (!specArg || reason === "") {
    process.stderr.write('Usage: darius counsel-gate --spec <spec-path> --override "<reason>"\n');
    process.exit(2);
  }
  const trackerRoot = requireTrackerRoot();
  const spec = canonicalSpecRef({ trackerRoot, ref: specArg });
  if (spec === null) {
    process.stderr.write(`darius counsel-gate: --spec not found in .tracker/: ${specArg}\n`);
    process.exit(1);
  }
  const absSpec = join(trackerRoot, spec);
  const { data, content } = parseFrontmatter(readFileSync(absSpec, "utf-8"));
  data["counsel"] = "overridden";
  data["counsel_override"] = reason;
  atomicWriteFileSync(absSpec, serializeFrontmatter(data, content));
  const at = new Date().toISOString();
  appendCounselLog(trackerRoot, { spec, kind: "override", status: "overridden", at, reason });
  if (json) {
    process.stdout.write(JSON.stringify({ status: "overridden", spec, reason, at }, null, 2) + "\n");
    return;
  }
  process.stdout.write(`STATUS: overridden\nSPEC: ${spec}\nREASON: ${reason}\n`);
}

function resolveCounselThreshold(flagValue: string | undefined): number {
  if (typeof flagValue === "string") {
    const parsed = Number.parseInt(flagValue, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      process.stderr.write(
        `darius counsel-gate: --threshold must be a positive integer, got ${flagValue}\n`,
      );
      process.exit(2);
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

/**
 * The round budget: `max_counsel_rounds:` in config, else 2. Since 0.76.0
 * `--max-rounds` may only lower it; a higher value is capped, with a note.
 */
function resolveMaxCounselRounds(flagValue: string | undefined): number {
  let budget = 2;
  const fromConfig = readScalarFromConfig(/^\s*max_counsel_rounds\s*:\s*(\d+)\s*$/m);
  if (fromConfig !== null) {
    const n = Number.parseInt(fromConfig, 10);
    if (Number.isInteger(n) && n >= 1) budget = n;
  }

  if (typeof flagValue === "string") {
    const parsed = Number.parseInt(flagValue, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      process.stderr.write(
        `darius counsel-gate: --max-rounds must be a positive integer, got ${flagValue}\n`,
      );
      process.exit(2);
    }
    if (parsed > budget) {
      process.stderr.write(
        `darius counsel-gate: NOTE: --max-rounds ${parsed} cannot raise the budget; using ${budget} (max_counsel_rounds)\n`,
      );
      return budget;
    }
    return parsed;
  }

  return budget;
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
    `darius counsel-gate: --single-dissent must be surface|confirm|ignore, got ${fromFlag}\n`,
  );
  process.exit(2);
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
  transcript: { transcript: string; sha256: string; specSha256: string },
): void {
  if (!existsSync(specPath)) {
    process.stderr.write(`darius counsel-gate: --spec not found: ${specPath}\n`);
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
    // The stamp names the transcript and its hash (0.76.0); dispatch checks both.
    data["counsel_transcript"] = transcript.transcript;
    data["counsel_sha256"] = transcript.sha256;
    // The hash of the spec text the review saw (0.77.0); dispatch refuses a changed spec.
    data["counsel_spec_sha256"] = transcript.specSha256;
  }

  const updated = serializeFrontmatter(data, content);
  atomicWriteFileSync(specPath, updated);
}

function formatCounselGate(
  decision: GateDecision,
  parse: { thumbsDown: number; thumbsUp: number; thumbsSideways: number },
  review: ReviewParseResult | null = null,
): string {
  const lines: string[] = [];
  lines.push(`STATUS: ${decision.status}`);
  if (review !== null) {
    lines.push("FORMAT: review");
    lines.push(`REVIEWER: ${review.reviewer}`);
    lines.push(`BLOCKERS: ${review.blockers}`);
    lines.push(`CONCERNS: ${review.concerns}`);
    lines.push(`OK: ${review.oks}`);
    for (const name of REVIEW_ITEMS) {
      lines.push(`ITEM ${name}: ${review.items[name].verdict}, ${review.items[name].reason}`);
    }
    if (typeof decision.rounds === "number") lines.push(`ROUNDS: ${decision.rounds}`);
    if (typeof decision.maxRounds === "number") lines.push(`MAX_ROUNDS: ${decision.maxRounds}`);
    lines.push(`REASON: ${decision.reason}`);
    if (decision.dissentSummary) lines.push(`DISSENT_SUMMARY: ${decision.dissentSummary}`);
    if (decision.blockingSummary) lines.push(`BLOCKING_SUMMARY: ${decision.blockingSummary}`);
    return lines.join("\n") + "\n";
  }
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
  review: ReviewParseResult | null = null,
) {
  // Every field the four-advisor format emitted stays. The review format
  // fills them (thumbsDown = blockers, thumbsSideways = concerns, thumbsUp =
  // ok) and adds format, reviewer and items.
  return {
    format: review === null ? "counsel" : "review",
    ...(review === null ? {} : { reviewer: review.reviewer, items: review.items }),
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
    process.stdout.write("Usage: darius agents [--json]\n");
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
    process.stdout.write("  No expert agents found. The main thread can implement, or use a general-purpose agent.\n");
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

/**
 * Store mode: the nearest `.darius.toml` at or above the project root lists
 * `milestone` in `kinds`. Same fact as `treeRoute` in src/cli.ts, read here
 * without importing darius code into the vendored engine. A missing or
 * unreadable marker means git mode.
 */
function projectOwnsTrackerTree(projectRoot: string): boolean {
  let dir = projectRoot;
  for (let depth = 0; depth < 50; depth++) {
    const file = join(dir, ".darius.toml");
    if (existsSync(file)) {
      try {
        return markerListsMilestone(readFileSync(file, "utf-8"));
      } catch {
        return false;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
  return false;
}

/** Every worklog thread, reduced to the fields the store-mode gate reads. */
function collectThreadsForGate(trackerRoot: string): ThreadForGate[] {
  const threads: ThreadForGate[] = [];
  for (const { file, doc } of scanWorklogDir(trackerRoot)) {
    for (const thread of doc.threads) {
      threads.push({
        threadId: thread.threadId,
        worklogFile: file,
        specPath: thread.specPath,
        stage: thread.stage,
        closed: Boolean(thread.closedAt),
        artifacts: threadArtifactPaths(thread, projectRootOf(trackerRoot)),
      });
    }
  }
  return threads;
}

function runUncommittedVerified(args: string[]): void {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write("Usage: darius uncommitted-verified [--json]\n");
    process.stdout.write("\n");
    process.stdout.write("List verified-but-uncommitted spec files (dirty in git AND carrying a\n");
    process.stdout.write("verification_passed: stamp). Exit 0 with an empty list when none.\n");
    process.stdout.write("\n");
    process.stdout.write("When the .darius.toml marker lists milestone in kinds, .tracker is a\n");
    process.stdout.write("git-ignored link and git sees no spec. Then each open worklog thread at\n");
    process.stdout.write("stage verified is listed instead. Its entry has source \"thread\", threadId,\n");
    process.stdout.write("gitStatus \"verified-uncommitted\", and dirtyArtifacts (its artifacts that\n");
    process.stdout.write("are dirty in git).\n");
    return;
  }

  const { values } = parseArgs({
    args,
    options: { json: { type: "boolean", default: false } },
    allowPositionals: false,
  });

  const trackerRoot = findTrackerRoot(process.cwd());
  const projectRoot = trackerRoot !== null ? resolve(join(trackerRoot, "..")) : process.cwd();

  const storeMode = trackerRoot !== null && projectOwnsTrackerTree(projectRoot);

  let porcelain: string;
  try {
    // -c core.quotePath=false keeps unicode/space paths unquoted so the path
    // regex matches. Scope to the repo containing the tracker. Store mode adds
    // -uall so an untracked artifact is listed as a file, not as its folder.
    porcelain = execFileSync(
      "git",
      ["-c", "core.quotePath=false", "status", "--porcelain", ...(storeMode ? ["-uall"] : [])],
      { cwd: projectRoot, encoding: "utf-8" },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`darius uncommitted-verified: git status failed: ${message}\n`);
    process.exit(1);
  }

  const specs =
    storeMode && trackerRoot !== null
      ? selectVerifiedThreads(collectThreadsForGate(trackerRoot), porcelain, gitPrefix(projectRoot))
      : selectVerifiedUncommitted(porcelain, (repoRelPath) => {
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
    process.stderr.write(`darius ${command}: ${NO_SESSION_MESSAGE}\n`);
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
      "Usage: darius claim <spec-ref> [--session <id>] [--ttl 8h] [--takeover] [--json]\n",
    );
    process.stdout.write("       darius claim --list [--json]\n");
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
      "Usage: darius claim <spec-ref> [--session <id>] [--ttl 8h] [--takeover] [--json]\n",
    );
    process.exit(2);
  }

  let ttlMs: number;
  try {
    ttlMs = parseTtl(values.ttl);
  } catch (err) {
    const message = err instanceof TtlParseError ? err.message : String(err);
    process.stderr.write(`darius claim: ${message}\n`);
    process.exit(1);
  }

  const { trackerRoot, session } = requireClaimContext(values.session, "claim");
  const ref = canonicalSpecRef({ trackerRoot, ref: refArg });
  if (ref === null) {
    process.stderr.write(`darius claim: no spec at ${refArg} in .tracker/. A claim names an existing spec.\n`);
    process.exit(1);
  }
  // With --json stdout carries the JSON only; the human lines go to stderr.
  const say = (text: string): void => {
    (values.json ? process.stderr : process.stdout).write(text);
  };

  const now = new Date();
  const claim: SessionClaim = {
    session,
    at: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    host: hostName(),
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
    if (doc.released !== undefined) delete doc.released[ref];
    return { doc, write: true, result: { action, previous } };
  });

  const { action, previous } = decision;
  const other = claimHolder(previous.claim);

  if (action === "refused") {
    process.stderr.write(
      `darius claim: REFUSED — ${ref} is claimed by ${other} ` +
        `(claimed ${previous.ageLabel} ago, ${previous.expiryLabel}).\n`,
    );
    process.stderr.write(
      `  That session is presumed live. Pick another spec, or re-run with --takeover ` +
        `if you know it is gone.\n`,
    );
    if (values.json) {
      process.stdout.write(
        JSON.stringify(
          { action, ref, session, heldBy: previous.claim?.session ?? "unknown", heldOn: previous.claim?.host ?? null, ageMs: previous.ageMs },
          null,
          2,
        ) + "\n",
      );
    }
    process.exit(1);
  }

  if (action === "takeover-stale") {
    say(
      `STALE CLAIM TAKEN OVER: ${ref} was claimed by ${other} ` +
        `${previous.ageLabel} ago and ${previous.expiryLabel} — that session is presumed dead.\n`,
    );
  }

  if (action === "takeover-live") {
    say(
      `⚠ TAKEOVER: ${ref} was claimed by ${other} ${previous.ageLabel} ago and ` +
        `is still LIVE (${previous.expiryLabel}). That session may be working this spec right now.\n`,
    );
  }

  const verb = action === "refreshed" ? "CLAIMED (refreshed — already yours)" : "CLAIMED";
  say(
    `${verb}: ${ref}\n  session ${session}, ttl ${formatTtl(ttlMs)}, expires ${claim.expiresAt}\n`,
  );

  const projectRoot = resolve(join(trackerRoot, ".."));
  for (const line of formatClaimPreflight(projectRoot)) {
    say(`${line}\n`);
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
          host: claim.host,
          previousSession: previous.claim?.session ?? null,
          previousHost: previous.claim?.host ?? null,
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
          host: s.claim?.host ?? null,
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
      "Usage: darius release <spec-ref> [--session <id>] [--force] [--json]\n",
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
    process.stderr.write("Usage: darius release <spec-ref> [--session <id>] [--force] [--json]\n");
    process.exit(2);
  }

  const { trackerRoot, session } = requireClaimContext(values.session, "release");
  const ref = normalizeClaimRef({ trackerRoot, ref: refArg });
  if (canonicalSpecRef({ trackerRoot, ref: refArg }) === null && readClaims(trackerRoot).claims[ref] === undefined) {
    process.stderr.write(`darius release: no spec at ${refArg} in .tracker/, and no claim under that name.\n`);
    process.exit(1);
  }
  const now = new Date();
  // With --json stdout carries the JSON only; the human lines go to stderr.
  const say = (text: string): void => {
    (values.json ? process.stderr : process.stdout).write(text);
  };

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

    releaseClaim(doc, ref, session, now);
    return { doc, write: true, result: { action, previous } };
  });

  const { action, previous } = decision;
  const other = claimHolder(previous.claim);

  if (action === "refused") {
    process.stderr.write(
      `darius release: REFUSED — ${ref} is claimed by another live ${other} ` +
        `(claimed ${previous.ageLabel} ago, ${previous.expiryLabel}). Use --force to release it anyway.\n`,
    );
    process.exit(1);
  }

  if (action === "absent") {
    say(`NO CLAIM: ${ref} was not claimed — nothing to release.\n`);
  } else if (action === "released-stale") {
    say(
      `RELEASED: ${ref} — STALE claim by ${other} (${previous.expiryLabel}).\n`,
    );
  } else if (action === "released-forced") {
    say(
      `⚠ RELEASED: ${ref} — FORCE-released a LIVE claim held by ${other} ` +
        `(claimed ${previous.ageLabel} ago).\n`,
    );
  } else {
    say(`RELEASED: ${ref} (held ${previous.ageLabel}).\n`);
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
  /** The flag that overrides a live claim, named in the refusal (default `--force`). */
  overrideFlag?: string;
}): boolean {
  const { trackerRoot, specRef, sessionFlag, force, command } = opts;
  const overrideFlag = opts.overrideFlag ?? "--force";
  const session = resolveSessionId(sessionFlag);
  const status = inspectClaim(readClaims(trackerRoot), normalizeClaimRef({ trackerRoot, ref: specRef }), session);

  if (status.state === "stale") {
    process.stderr.write(
      `darius ${command}: NOTE — ${status.ref} carries a STALE claim by ` +
        `${claimHolder(status.claim)} (claimed ${status.ageLabel} ago, ${status.expiryLabel}). ` +
        `Proceeding; run \`darius claim ${status.ref}\` to take it over cleanly.\n`,
    );
    return false;
  }

  if (status.state !== "held") return false;

  if (force) {
    process.stderr.write(
      `darius ${command}: ⚠ ${overrideFlag} — proceeding despite a LIVE claim on ${status.ref} ` +
        `by ${claimHolder(status.claim)} (claimed ${status.ageLabel} ago).\n`,
    );
    return false;
  }

  process.stderr.write(
    `darius ${command}: REFUSED — ${status.ref} is claimed by ${claimHolder(status.claim)} ` +
      `(claimed ${status.ageLabel} ago, ${status.expiryLabel}).\n`,
  );
  process.stderr.write(
    `  Another session is working this spec on the same checkout. Pick different work, ` +
      `or re-run with ${overrideFlag}.\n`,
  );
  return true;
}

/**
 * The acting session of `worklog open` and `dispatch` (0.76.0). A `--session`
 * that differs from the env session id is refused (exit 1) unless
 * `--as-other-session` is given; then `acting` is the env session and the
 * caller records it. Without an env id, `--session` works as before.
 */
function sessionForWrite(
  command: string,
  flag: string | undefined,
  asOther: boolean,
): { session: string | null; acting: string | null } {
  const env = resolveSessionId(undefined);
  const fromFlag = flag?.trim() ?? "";
  if (fromFlag !== "" && env !== null && fromFlag !== env) {
    if (!asOther) {
      process.stderr.write(
        `darius ${command}: REFUSED: --session ${fromFlag} is not this session (${env}). ` +
          "Pass --as-other-session to act for it; that is recorded.\n",
      );
      process.exit(1);
    }
    return { session: fromFlag, acting: env };
  }
  return { session: resolveSessionId(flag), acting: null };
}

const SPEC_CHECK_MODULE = new URL("../../core/spec-check.ts", import.meta.url);

type SpecCheckModule = {
  checkSpecFile(specPath: string, cwd: string): Promise<{ result: { reviewRequired: boolean } }>;
};

/**
 * The review gate at dispatch (0.76.0). Returns true, after a refusal on
 * stderr, when `darius spec check` says the spec needs a review and the spec
 * has no stamp that counsel-gate wrote (see lib/counsel-stamp.ts). A spec that
 * does not resolve to a file is left to the other gates.
 */
async function reviewGateBlocks(trackerRoot: string, specRef: string, command: string): Promise<boolean> {
  const spec = canonicalSpecRef({ trackerRoot, ref: specRef });
  if (spec === null) return false;
  const absSpec = join(trackerRoot, spec);
  let reviewRequired: boolean;
  try {
    // SAFETY: darius's own spec check module; the export is checked before use.
    const mod = (await import(SPEC_CHECK_MODULE.href)) as Partial<SpecCheckModule>;
    if (typeof mod.checkSpecFile !== "function") throw new Error("spec check is missing checkSpecFile");
    reviewRequired = (await mod.checkSpecFile(absSpec, process.cwd())).result.reviewRequired;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`darius ${command}: REFUSED: spec check failed on ${spec}: ${message}\n`);
    return true;
  }
  if (!reviewRequired) return false;
  const check = checkCounselStamp(trackerRoot, spec, absSpec);
  if (check.ok) return false;
  process.stderr.write(`darius ${command}: REFUSED: ${check.reason}\n`);
  return true;
}

// ---------------------------------------------------------------------------
// tracker loop-check [--json] [--session <id>] [--bounce <id>] [--max-bounces N]
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
    process.stdout.write("Usage: darius loop-check [--json] [--session <id>] [--bounce <id>] [--max-bounces N]\n");
    process.stdout.write("\n");
    process.stdout.write("Detect Work Loop threads stuck in a pre-terminal stage. With --session\n");
    process.stdout.write("(--bounce is the older name), only threads owned by that session count,\n");
    process.stdout.write("each thread has its own block budget (default max 2 per 24 h), and\n");
    process.stdout.write("STATUS: exhausted (exit 0) is reported once every own thread spent it.\n");
    process.stdout.write("Threads of other sessions are listed in a NOTICE line and never block.\n");
    return;
  }

  let values: { json?: boolean; bounce?: string; session?: string; "max-bounces"?: string };
  try {
    ({ values } = parseArgs({
      args,
      options: {
        json: { type: "boolean", default: false },
        bounce: { type: "string" },
        session: { type: "string" },
        "max-bounces": { type: "string" },
      },
      allowPositionals: false,
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`darius loop-check: ${message}\n`);
    // Exit 1 means "stuck" to the Stop hook; a bad command line is a usage error.
    process.exit(2);
  }

  let maxBounces: number | undefined;
  if (values["max-bounces"] !== undefined) {
    maxBounces = Number.parseInt(values["max-bounces"], 10);
    if (!Number.isInteger(maxBounces) || maxBounces < 1) {
      process.stderr.write(
        `darius loop-check: --max-bounces must be a positive integer, got ${values["max-bounces"]}\n`,
      );
      process.exit(2);
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
    result = runLoopCheck({ trackerRoot, session: values.session, bounceId: values.bounce, maxBounces });
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

  process.stderr.write("Usage: darius ritual <add|run|complete|list> [options]\n");
  process.exit(2);
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
      "Usage: darius ritual add --name <name> --slug <slug> [--cadence <7d|2w|1m>] [--due <YYYY-MM-DD>] [--agent <name>] [--owner <email>]\n",
    );
    process.exit(2);
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
      process.stdout.write(`darius ritual add: already exists at ${result.dirPath}\n`);
    } else {
      process.stdout.write(`darius ritual add: created ${result.ritualPath}\n`);
    }
  } catch (err) {
    process.stderr.write(
      `darius ritual add: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(failCode(err));
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
    process.stderr.write("Usage: darius ritual run <slug> [--date <YYYY-MM-DD>]\n");
    process.exit(2);
  }

  const trackerRoot = requireTrackerRoot();
  try {
    const result = stampRun({ trackerRoot, slug, date: values.date });
    if (result.kind === "exists") {
      process.stdout.write(`darius ritual run: run already exists at ${result.runPath}\n`);
    } else {
      process.stdout.write(`darius ritual run: stamped ${result.runPath}\n`);
    }
  } catch (err) {
    process.stderr.write(
      `darius ritual run: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(failCode(err));
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
    process.stderr.write("Usage: darius ritual complete <slug> [--today <YYYY-MM-DD>]\n");
    process.exit(2);
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
      `darius ritual complete: ${slug} ran ${result.lastRun}, ${rolled}${pruned}\n`,
    );
  } catch (err) {
    process.stderr.write(
      `darius ritual complete: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(failCode(err));
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

  process.stderr.write("Usage: darius vigil <add|list|set-body|close> [options]\n");
  process.exit(2);
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
      'Usage: darius vigil add <slug> [--name "Title"] [--due <YYYY-MM-DD>] [--until "<event>"] [--from <ref>] [--agent <name>] [--stdin | --content <path>]\n',
    );
    process.exit(2);
  }

  if (values.content !== undefined && values.stdin) {
    process.stderr.write(
      "darius vigil add: --content <path> and --stdin are mutually exclusive\n",
    );
    process.exit(2);
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
      process.stdout.write(`darius vigil add: already exists at ${result.vigilPath}\n`);
      // Never silently drop a body the caller piped in: `add` is idempotent by
      // design, so the second run has to say which command would land it.
      if (bodySupplied) {
        process.stdout.write(
          `  body NOT written — replace it with \`darius vigil set-body ${slug} --stdin\`\n`,
        );
      }
    } else {
      process.stdout.write(
        `darius vigil add: created ${result.vigilPath} ` +
          `(${result.executableCommands} executable Command${result.executableCommands === 1 ? "" : "s"})\n`,
      );
    }
    warnIfGuardedSpecNeverShipped(trackerRoot, values.from);
  } catch (err) {
    process.stderr.write(
      `darius vigil add: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(failCode(err));
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
      "Usage: darius vigil set-body <slug> (--stdin | --content <path>)\n",
    );
    process.exit(2);
  }

  if ((values.content !== undefined) === values.stdin) {
    process.stderr.write(
      "darius vigil set-body: exactly one of --content <path> or --stdin is required\n",
    );
    process.exit(2);
  }

  const body = readVigilBody("vigil set-body", values.content);

  const trackerRoot = requireTrackerRoot();
  try {
    const result = setVigilBody({ trackerRoot, slug, body });
    process.stdout.write(
      `darius vigil set-body: wrote ${result.vigilPath} ` +
        `(${result.executableCommands} executable Command${result.executableCommands === 1 ? "" : "s"})\n`,
    );
  } catch (err) {
    process.stderr.write(
      `darius vigil set-body: ${err instanceof Error ? err.message : String(err)}\n`,
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
    process.stderr.write(`darius ${command}: cannot read body: ${message}\n`);
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
    `darius vigil add: WARNING — ${specPath} has 0 verified items.\n` +
      "  A vigil guards work that shipped. If this spec has not shipped, the vigil cannot be\n" +
      "  closed by any evidence and will sit in `darius due` forever. Confirm the deploy, or\n" +
      "  arm the vigil after `darius verify` has ticked the spec.\n",
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
      "Usage: darius vigil close <slug> --verdict <held|failed> [--date <YYYY-MM-DD>]\n",
    );
    process.exit(2);
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
        `darius vigil close: ${slug} already closed (verdict ${result.verdict}${resolved}) — not overwritten\n`,
      );
      return;
    }
    process.stdout.write(
      `darius vigil close: ${slug} closed — verdict ${result.verdict}, resolved ${result.resolved}\n`,
    );
    if (result.verdict === "failed") {
      process.stdout.write(
        "  Remediation goes to a new spec via darius add. Never bolt it onto the vigil.\n",
      );
    }
  } catch (err) {
    process.stderr.write(
      `darius vigil close: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(failCode(err));
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
 * `/darius-archive` calls this in its validate step, before anything is
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
    process.stderr.write("Usage: darius archive-check <milestone-folder|slug> [--json]\n");
    process.exit(2);
  }

  const trackerRoot = requireTrackerRoot();

  let milestonePath: string;
  try {
    milestonePath = resolveMilestonePath(trackerRoot, milestoneArg);
  } catch (err) {
    process.stderr.write(
      `darius archive-check: ${err instanceof Error ? err.message : String(err)}\n`,
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
      `darius archive-check: clear — no armed vigil from ${basename(milestonePath)} is unrunnable\n`,
    );
    return;
  }

  process.stderr.write(
    `darius archive-check: REFUSED — ${basename(milestonePath)} armed ${blocking.length} vigil(s) ` +
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
      "  darius vigil close <slug> --verdict held|failed\n",
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
