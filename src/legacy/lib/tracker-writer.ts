/**
 * tracker-writer.ts — all mutation operations for the tracker CLI.
 *
 * Every write goes through atomicWriteFileSync.
 * Every operation is idempotent.
 * All paths are absolute.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { atomicWriteFileSync } from "./atomic.ts";
import {
  parseFrontmatter,
  serializeFrontmatter,
  splitRawFrontmatter,
} from "./markdown/frontmatter.ts";
import { parseChecklist } from "./markdown/checklist.ts";
import { parseSpec, deriveStatus } from "./documents/spec.ts";
import { parseRitual } from "./documents/ritual.ts";
import {
  assertValidVigilSlug,
  assertVigilHasGate,
  assertValidVerdict,
  type VigilVerdict,
} from "./documents/vigil.ts";
import { readTrackerState } from "./tracker-reader.ts";
import { isTrivialCommand } from "./verification/runner.ts";
import { countVigilCommands } from "./vigil-health.ts";
import type { VerificationMethod } from "./verification/ledger.ts";
import { rebuildIndexDoc } from "./index-rebuilder.ts";
import { todayIso, isIsoDate, parseCadence, rollByCadence } from "./dates.ts";

// ---------------------------------------------------------------------------
// Template root (relative to THIS file's location at runtime)
// ---------------------------------------------------------------------------

// The templates directory is at src/legacy/templates/ relative to the
// repo root. We compute the path relative to this module file's location:
// src/legacy/lib/tracker-writer.ts → ../templates/
import { fileURLToPath } from "node:url";

function getTemplatesDir(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return resolve(moduleDir, "..", "templates");
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SpecStatus =
  | "Not Started"
  | "In Progress"
  | "Complete"
  | "Blocked"
  | "Archived";

/** Terminal overrides only valid on milestone READMEs, not spec files */
export type MilestoneOverrideStatus = "Skipped" | "Deferred" | "Closed";

export type MarkState = "verified" | "in-progress" | "blocked" | "skipped" | "pending";

// ---------------------------------------------------------------------------
// tracker init
// ---------------------------------------------------------------------------

const INIT_INDEX_CONTENT = `---
name: Project Tracker
type: main-index
version: 2
---

# Project — Tracker

## Progress Dashboard

| Milestone | Name | Progress | Verified | Status |
|-----------|------|----------|----------|--------|

## Current Focus

_No milestones yet. Run \`tracker add milestone\` to create one._

## Blockers

None

---

## Status Legend

- \`[x]\` — Verified (implementation complete, tests pass)
- \`[ ]\` — Pending (not started)
- \`[~]\` — In Progress (actively being worked on)
- \`[!]\` — Blocked (has dependency, can't proceed)
- \`[-]\` — Skipped (intentionally not implementing)

## Archived Milestones

_None yet_
`;

/**
 * Scaffold a fresh .tracker/ directory.
 * Throws if .tracker/ already exists (idempotent guard).
 */
export function initTracker(opts: { projectRoot: string }): void {
  const trackerDir = join(opts.projectRoot, ".tracker");

  if (existsSync(trackerDir)) {
    throw new Error(
      `.tracker/ already exists at ${trackerDir}. Remove it first or use the existing tracker.`,
    );
  }

  mkdirSync(trackerDir, { recursive: true });
  atomicWriteFileSync(join(trackerDir, "00-INDEX.md"), INIT_INDEX_CONTENT);
}

// ---------------------------------------------------------------------------
// tracker add milestone
// ---------------------------------------------------------------------------

export type AddMilestoneOpts = {
  trackerRoot: string;
  name: string;
  slug: string;
  owner: string;
  target?: string;
  /**
   * Explicit milestone number. Omit to auto-mint above the highest occupied
   * number. Supplying one that an active or archived milestone already holds
   * (under ANY prefix) throws, naming the collider.
   */
  number?: number;
};

export type AddMilestoneResult =
  | { kind: "created"; folderPath: string; number: number }
  | { kind: "exists"; folderPath: string };

/**
 * Create a new milestone directory with 00-README.md.
 * Auto-increments N from the highest existing milestone number.
 * Idempotent: if a directory with the same slug already exists, returns {kind:'exists'}.
 */
export function addMilestone(opts: AddMilestoneOpts): AddMilestoneResult {
  const { trackerRoot, name, slug, owner, target } = opts;

  // Check for existing milestone with same slug
  const existing = findMilestoneBySlug(trackerRoot, slug);
  if (existing !== null) {
    return { kind: "exists", folderPath: existing };
  }

  // Explicit number → refuse a collision (naming the collider).
  // No number → auto-mint above every occupied number, any prefix.
  let nextN: number;
  if (opts.number !== undefined) {
    assertMilestoneNumberAvailable(trackerRoot, opts.number);
    nextN = opts.number;
  } else {
    nextN = getNextMilestoneNumber(trackerRoot);
  }
  const folderName = `M${nextN}-${slug}`;
  const folderPath = join(trackerRoot, folderName);

  mkdirSync(folderPath, { recursive: true });

  const today = todayIsoString();
  const templatePath = join(getTemplatesDir(), "milestone-README.md");
  const templateRaw = readFileSync(templatePath, "utf-8");

  // Split the template into its (placeholder-laden) frontmatter and body. We
  // can't parseFrontmatter() the raw template because the {{PLACEHOLDER}} tokens
  // aren't valid YAML — we only need the body to substitute and the frontmatter
  // comment lines to preserve.
  const { frontmatterBlock, body: templateBody } = splitTemplate(templateRaw);

  // Frontmatter is built as a data object and emitted through the YAML-safe
  // serializer, so EVERY value — not just the name — is quoted when it would
  // otherwise be misread as YAML. Raw text substitution bypassed serializeScalar
  // entirely, which is why a `--name "[INFRA] Foo"` produced the invalid bare
  // scalar `name: [INFRA] Foo` (an inline sequence the parser rejects).
  // NOTE: no `status:` is stamped. A milestone's status is derived from its
  // specs (tracker-reader.deriveMilestoneStatus); the frontmatter field is
  // read ONLY as a terminal override (Complete/Skipped/Deferred/Closed —
  // tracker-reader.ts parseMilestoneStatusOverride). Stamping "Not Started"
  // wrote a value that parses to `null` override — i.e. it changed nothing,
  // while looking authoritative to any agent that reads the file instead of
  // running the CLI. That gap is the drift mechanism; don't create it.
  const frontmatter: Record<string, unknown> = {
    name,
    slug,
    started: today,
    target: target ?? "TBD",
    owner,
  };

  // serializeFrontmatter intentionally omits YAML comments; keep the template's
  // comment lines verbatim so the `lessons: skip` hint survives.
  const frontmatterComments = frontmatterBlock
    .split("\n")
    .filter((line) => line.trimStart().startsWith("#"));

  // The body is prose, not YAML — placeholder substitution stays here.
  const body = templateBody
    .replace(/\{\{MILESTONE_NAME\}\}/g, name)
    .replace(/\{\{ONE_SENTENCE_GOAL\}\}/g, "<!-- TODO: describe the goal -->")
    .replace(/\{\{MOTIVATION\}\}/g, "<!-- TODO: why does this matter? -->")
    .replace(/\{\{CRITERION_1\}\}/g, "<!-- TODO: success criterion 1 -->")
    .replace(/\{\{CRITERION_2\}\}/g, "<!-- TODO: success criterion 2 -->")
    .replace(/\{\{NON_GOAL_1\}\}/g, "<!-- TODO: non-goal 1 -->");

  const content = attachFrontmatterComments(
    serializeFrontmatter(frontmatter, body),
    frontmatterComments,
  );

  atomicWriteFileSync(join(folderPath, "00-README.md"), content);

  // Regenerate the index
  rebuildIndex(trackerRoot);

  return { kind: "created", folderPath, number: nextN };
}

// ---------------------------------------------------------------------------
// tracker add spec
// ---------------------------------------------------------------------------

export type TemplateKind = "generic" | "api-endpoint" | "ui-component" | "library";

export type AddSpecOpts = {
  trackerRoot: string;
  milestoneArg: string; // e.g. "M2-tracker-cli-refactor" or "tracker-cli-refactor"
  name: string;
  template: TemplateKind;
  dependsOn?: string[];
  agent?: string;
  /**
   * Scaffold the placeholder checks as operator decisions instead of failing
   * assertions. Requires a named owner and an expiry date — an unowned,
   * open-ended "someone will check this by hand" is the exact promise this
   * milestone exists to stop.
   */
  manual?: ManualScaffold;
};

/** Owner + expiry for `tracker add spec --manual`. */
export type ManualScaffold = {
  /** Who makes the call (a person or a team, never "we"). */
  owner: string;
  /** ISO date the decision must be recorded by. */
  expires: string;
};

export type AddSpecResult =
  | { kind: "created"; filePath: string; number: number }
  | { kind: "exists"; filePath: string };

/**
 * Create a new spec file inside a milestone directory.
 * Auto-increments NN from highest existing spec number.
 * Idempotent: if a spec with the same slug (name → kebab) already exists, returns {kind:'exists'}.
 */
export function addSpec(opts: AddSpecOpts): AddSpecResult {
  const { trackerRoot, milestoneArg, name, template, dependsOn, agent, manual } = opts;

  if (manual !== undefined) assertValidManualScaffold(manual);

  const milestonePath = resolveMilestonePath(trackerRoot, milestoneArg);
  if (!existsSync(milestonePath)) {
    throw new Error(`Milestone not found: ${milestoneArg}`);
  }

  const specSlug = toKebabCase(name);

  // Idempotency check: look for any file matching NN-<slug>.md
  const existing = findSpecBySlug(milestonePath, specSlug);
  if (existing !== null) {
    return { kind: "exists", filePath: existing };
  }

  const nextN = getNextSpecNumber(milestonePath);
  const fileName = `${String(nextN).padStart(2, "0")}-${specSlug}.md`;
  const filePath = join(milestonePath, fileName);

  const today = todayIsoString();
  const templateFileName = `spec-${template}.md`;
  const templatePath = join(getTemplatesDir(), templateFileName);
  const templateRaw = readFileSync(templatePath, "utf-8");

  // Same YAML-safety split as addMilestone: frontmatter goes through the
  // serializer (every spec template shares the identical six-field block, with
  // `template:` matching the template arg), so free-text values like a
  // bracket-prefixed --agent can't land as invalid bare scalars. Body prose
  // keeps plain placeholder substitution.
  const { frontmatterBlock, body: templateBody } = splitTemplate(templateRaw);

  // NOTE: no `status:`/`verified:` are stamped. Both are DERIVED from the
  // checklist markers on every read (documents/spec.ts deriveStatus +
  // verifiedCount) and the frontmatter copies were never read back — nothing
  // updated them either, so they froze at "Not Started" / "0/0" while the work
  // completed. Measured on this workspace 2026-08-03: 68 of 106 specs (64%)
  // carried a frontmatter status that disagreed with the computed one, in both
  // directions. Agents Read files; they saw the stale copy. Fix at the source:
  // never write a derived field at creation.
  const frontmatter: Record<string, unknown> = {
    updated: today,
    depends_on: dependsOn ?? [],
    agent: agent ?? "unassigned",
    template,
  };

  const frontmatterComments = frontmatterBlock
    .split("\n")
    .filter((line) => line.trimStart().startsWith("#"));

  // Substitute placeholders
  let bodyContent = templateBody
    .replace(/\{\{FEATURE_NAME\}\}/g, name)
    .replace(/\{\{ENDPOINT_NAME\}\}/g, name)
    .replace(/\{\{LIBRARY_NAME\}\}/g, name)
    .replace(/\{\{COMPONENT_NAME\}\}/g, name)
    .replace(/\{\{ONE_SENTENCE_GOAL\}\}/g, "<!-- TODO: one sentence goal -->")
    .replace(/\{\{WHAT_AND_WHY\}\}/g, "<!-- TODO: what and why -->")
    .replace(/\{\{METHOD\}\}/g, "GET")
    .replace(/\{\{PATH\}\}/g, "/todo")
    .replace(/\{\{REQUEST_SHAPE\}\}/g, "<!-- TODO -->")
    .replace(/\{\{SUCCESS_SHAPE\}\}/g, "<!-- TODO -->")
    .replace(/\{\{AUTH_REQUIREMENT\}\}/g, "<!-- TODO -->")
    .replace(/\{\{RATE_LIMIT\}\}/g, "none")
    .replace(/\{\{REQUIREMENT_1\}\}/g, "<!-- TODO: requirement 1 -->")
    .replace(/\{\{REQUIREMENT_2\}\}/g, "<!-- TODO: requirement 2 -->")
    .replace(/\{\{TASK_1\}\}/g, "<!-- TODO: task 1 -->")
    .replace(/\{\{TASK_2\}\}/g, "<!-- TODO: task 2 -->")
    .replace(/\{\{CMD_1\}\}/g, scaffoldPlaceholderCommand(manual))
    .replace(/\{\{CMD_2\}\}/g, scaffoldPlaceholderCommand(manual))
    .replace(/\{\{INTEGRATION_1\}\}/g, "<!-- TODO: integration test 1 -->")
    .replace(/\{\{INT_CMD_1\}\}/g, scaffoldPlaceholderCommand(manual))
    .replace(/\{\{PROP_1\}\}/g, "children")
    .replace(/\{\{TYPE_1\}\}/g, "ReactNode")
    .replace(/\{\{DESC_1\}\}/g, "<!-- TODO -->")
    .replace(/\{\{PROP_2\}\}/g, "className")
    .replace(/\{\{TYPE_2\}\}/g, "string")
    .replace(/\{\{DESC_2\}\}/g, "<!-- TODO -->")
    .replace(/\{\{BEHAVIOR_1\}\}/g, "<!-- TODO: behavior 1 -->")
    .replace(/\{\{BEHAVIOR_2\}\}/g, "<!-- TODO: behavior 2 -->")
    .replace(/\{\{EXPORT_1\}\}/g, "<!-- TODO -->")
    .replace(/\{\{SIGNATURE_1\}\}/g, "")
    .replace(/\{\{DESC_1\}\}/g, "<!-- TODO -->")
    .replace(/\{\{EXPORT_2\}\}/g, "<!-- TODO -->")
    .replace(/\{\{SIGNATURE_2\}\}/g, "")
    .replace(/\{\{INVARIANT_1\}\}/g, "<!-- TODO: invariant 1 -->")
    .replace(/\{\{INVARIANT_2\}\}/g, "<!-- TODO: invariant 2 -->")
    // remaining template placeholders
    .replace(/\{\{[A-Z0-9_]+\}\}/g, "<!-- TODO -->");

  if (manual !== undefined) {
    bodyContent = applyManualExpectations(bodyContent, manual);
  }

  // The structural refusal (M315/07). Nothing reaches disk with a Command that
  // cannot fail — not from a template regression, not from a caller.
  assertScaffoldCommandsRunnable(bodyContent, `tracker add spec (${fileName})`);

  const content = attachFrontmatterComments(
    serializeFrontmatter(frontmatter, bodyContent),
    frontmatterComments,
  );

  atomicWriteFileSync(filePath, content);

  // Regenerate the index
  rebuildIndex(trackerRoot);

  return { kind: "created", filePath, number: nextN };
}

// ---------------------------------------------------------------------------
// Scaffold command hygiene (M315/07)
// ---------------------------------------------------------------------------

/**
 * The placeholder `Command:` a fresh scaffold carries.
 *
 * It is a REAL assertion that fails: `test -f` on a path that will never exist.
 * The old placeholder was `echo todo`, which exits 0 — so a scaffolded spec
 * looked verifiable, `tracker verify` classified it as manual, and the item sat
 * there for weeks reading like a check. Measured on this estate on 2026-09-02:
 * 460 of 1,575 `Command:` lines fleet-wide were shell no-ops, and the vigil
 * template alone minted three per vigil.
 *
 * A placeholder that fails is honest: the spec is red until someone writes the
 * check, which is exactly the truth about a spec nobody has scoped yet.
 */
export const SCAFFOLD_PLACEHOLDER_COMMAND =
  "test -f /nonexistent/replace-me-with-a-real-check";

/** The no-op a `--manual` scaffold carries, paired with a `manual (...)` Expected. */
function manualPlaceholderCommand(manual: ManualScaffold): string {
  return `echo "operator decision (whose: ${manual.owner}) — record it, do not run this"`;
}

function scaffoldPlaceholderCommand(manual: ManualScaffold | undefined): string {
  return manual === undefined
    ? SCAFFOLD_PLACEHOLDER_COMMAND
    : manualPlaceholderCommand(manual);
}

/** `manual (owner: <who>, expires: <date>)` — the sanctioned non-assertion. */
export function manualExpectation(manual: ManualScaffold): string {
  return `manual (owner: ${manual.owner}, expires: ${manual.expires})`;
}

function assertValidManualScaffold(manual: ManualScaffold): void {
  if (manual.owner.trim() === "") {
    throw new Error("--manual needs --owner <who>: an unowned manual check is nobody's job");
  }
  if (!isIsoDate(manual.expires)) {
    throw new Error(
      `--manual needs --expires <YYYY-MM-DD> (got "${manual.expires}"): a manual check with no ` +
        "expiry never comes back",
    );
  }
}

/**
 * Rewrite the `Expected:` line that follows every manual placeholder Command.
 *
 * Line-scoped on purpose: only the Expected directly under a manual placeholder
 * is touched, so a template that mixes real checks with placeholders keeps its
 * real assertions.
 */
function applyManualExpectations(body: string, manual: ManualScaffold): string {
  const placeholder = manualPlaceholderCommand(manual);
  const lines = body.split("\n");
  let previousWasManualCommand = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const commandMatch = /^(\s*)- Command:\s*`(.*)`\s*$/.exec(line);
    if (commandMatch) {
      previousWasManualCommand = commandMatch[2] === placeholder;
      continue;
    }
    const expectedMatch = /^(\s*)- Expected:\s*`.*`\s*$/.exec(line);
    if (expectedMatch && previousWasManualCommand) {
      lines[i] = `${expectedMatch[1]}- Expected: \`${manualExpectation(manual)}\``;
    }
    previousWasManualCommand = false;
  }

  return lines.join("\n");
}

/**
 * Refuse to write a checklist whose `Command:` cannot fail.
 *
 * This is the scaffold-time half of the no-op sweep. `tracker doctor` finding a
 * no-op weeks later is a report; refusing to create one is a consequence. The
 * one sanctioned exception is an item whose `Expected:` is the `manual (owner:
 * …, expires: …)` form — an operator decision with a name and a date on it.
 *
 * Runs on the rendered body, so it also catches a template regression: put
 * `echo todo` back into a template and `tracker add` stops working.
 */
export function assertScaffoldCommandsRunnable(body: string, context: string): void {
  for (const item of parseChecklist(body)) {
    if (item.command === null) continue;
    if (item.expected !== null && /^\s*manual\b/i.test(item.expected)) continue;
    if (!isTrivialCommand(item.command)) continue;
    const label = item.label.trim() === "" ? "(unlabelled)" : item.label.trim();
    throw new Error(
      `${context}: checklist item ${item.index} ("${label}") has a shell no-op Command ` +
        `(\`${item.command}\`). A Command that cannot fail is not a check. Write a real ` +
        "assertion, or scaffold it as an operator decision with " +
        "`--manual --owner <who> --expires <YYYY-MM-DD>`.",
    );
  }
}

// ---------------------------------------------------------------------------
// Legacy derived-field sync
// ---------------------------------------------------------------------------

/**
 * Re-point a spec's LEGACY derived frontmatter at the values the CLI computes
 * from the same file, so the two can never disagree after a write.
 *
 * Only fields that are ALREADY present are touched — this never introduces
 * `status:`/`verified:` onto a clean spec (that would re-create the drift
 * surface `addSpec` just stopped writing). Specs authored before this change
 * keep their fields and get them corrected; specs authored after never grow
 * them. `tracker doctor --fix` still deletes them outright — this is the
 * in-between guarantee for estates that haven't run it.
 *
 * @param includeStatus  false for `set-status`, whose entire contract is to
 *                       write an explicit `status:` the caller chose.
 */
function syncLegacyDerivedFields(
  data: Record<string, unknown>,
  body: string,
  opts: { includeStatus: boolean },
): Record<string, unknown> {
  const hasStatus = Object.prototype.hasOwnProperty.call(data, "status");
  const hasVerified = Object.prototype.hasOwnProperty.call(data, "verified");
  if (!hasStatus && !hasVerified) return data;

  const items = parseChecklist(body);
  const synced: Record<string, unknown> = { ...data };

  if (hasVerified) {
    const verifiedCount = items.filter((i) => i.state === "verified").length;
    synced["verified"] = `${verifiedCount}/${items.length}`;
  }
  if (hasStatus && opts.includeStatus) {
    synced["status"] = deriveStatus(items);
  }

  return synced;
}

// ---------------------------------------------------------------------------
// tracker mark
// ---------------------------------------------------------------------------

export type MarkOpts = {
  specPath: string;
  taskIndex: number;
  state: MarkState;
  trackerRoot: string;
  /**
   * How this `[x]` was earned. Defaults to `manual` — the conservative answer:
   * a caller that does not say it executed anything did not execute anything.
   * Only the verify/verify-item flows, which have just run a real command and
   * evaluated its Expected clause, pass `executed`.
   */
  method?: VerificationMethod;
};

/**
 * Set the state of a checklist item by 0-based index.
 *
 * Mark states map to checkbox markers:
 *   verified     → [x]
 *   in-progress  → [~]
 *   blocked      → [!]
 *   skipped      → [-]
 *   pending      → [ ]
 *
 * Also updates `updated:` frontmatter to today. When the state is `verified`,
 * additionally stamps:
 *   - `verification_passed:` — ISO timestamp; the signal the commit-first gate
 *     (`hasVerificationPassed` in uncommitted.ts) and the commit skill key on.
 *   - `verification_method:` — `executed` or `manual`. The ledger
 *     (`.verification-log.jsonl`) is the full evidence trail, but agents read
 *     spec FILES; without a stamp in the frontmatter a hand-asserted tick and a
 *     command-earned tick look identical to every `Read` and every `grep`.
 *
 * Other states never write or clear either stamp.
 */
export function markTask(opts: MarkOpts): void {
  const { specPath, taskIndex, state, trackerRoot, method = "manual" } = opts;
  const absPath = resolve(specPath);

  if (!existsSync(absPath)) {
    throw new Error(`Spec not found: ${absPath}`);
  }

  const raw = readFileSync(absPath, "utf-8");
  const { data, content } = parseFrontmatter(raw);

  // Parse lines and find checklist items
  const lines = content.split("\n");
  let itemIdx = 0;
  let found = false;

  const newLines = lines.map((line) => {
    // Match any checkbox marker: [ ], [x], [X], [~], [!], [-]
    const match = /^(\s*- \[)([^\]]+)(\] .*)$/.exec(line);
    if (!match) return line;

    if (itemIdx === taskIndex) {
      found = true;
      const marker = stateToMarker(state);
      itemIdx++;
      return `${match[1]}${marker}${match[3]}`;
    }

    itemIdx++;
    return line;
  });

  if (!found) {
    throw new Error(
      `Task index ${taskIndex} out of range (found ${itemIdx} checklist items)`,
    );
  }

  // Update frontmatter: set updated to today. On `verified`, also stamp
  // `verification_passed:` — the marker the commit-first gate reads. Routed
  // through serializeFrontmatter (below), which quotes the colon-bearing ISO
  // value automatically; never hand-rolled. Other states leave the stamp as-is.
  const updatedData: Record<string, unknown> = { ...data, updated: todayIsoString() };
  if (state === "verified") {
    updatedData["verification_passed"] = new Date().toISOString();
    updatedData["verification_method"] = method;
  }
  const newContent = newLines.join("\n");

  // A mark is exactly the moment a legacy `status:`/`verified:` copy goes
  // stale. Re-point both at the post-mark computed values rather than writing
  // the file back with the old ones intact.
  const syncedData = syncLegacyDerivedFields(updatedData, newContent, {
    includeStatus: true,
  });

  const serialized = serializeFrontmatter(
    syncedData as Record<string, unknown>,
    newContent,
  );

  // Ensure trailing newline
  const final = serialized.endsWith("\n") ? serialized : `${serialized}\n`;

  atomicWriteFileSync(absPath, final);

  // Regenerate the index
  rebuildIndex(trackerRoot);
}

function stateToMarker(state: MarkState): string {
  switch (state) {
    case "verified":
      return "x";
    case "in-progress":
      return "~";
    case "blocked":
      return "!";
    case "skipped":
      return "-";
    case "pending":
      return " ";
  }
}

// ---------------------------------------------------------------------------
// tracker set-status
// ---------------------------------------------------------------------------

export type SetStatusOpts = {
  target: string; // absolute path to spec file or milestone folder
  status: SpecStatus | MilestoneOverrideStatus;
  trackerRoot: string;
};

/**
 * Set the `status:` frontmatter field of a spec file or milestone README.
 *
 * For spec files: sets `status` directly. Note: this is an override —
 * the computed status from checklists takes precedence in display unless
 * explicitly stored.
 * For milestone folders: sets the `status` field in 00-README.md. Milestone
 * targets additionally accept the terminal overrides Skipped, Deferred,
 * and Closed.
 */
export function setStatus(opts: SetStatusOpts): void {
  const { target, status, trackerRoot } = opts;
  const absTarget = resolve(target);

  const SPEC_STATUSES: SetStatusOpts["status"][] = [
    "Not Started",
    "In Progress",
    "Complete",
    "Blocked",
    "Archived",
  ];
  const MILESTONE_STATUSES: SetStatusOpts["status"][] = [
    ...SPEC_STATUSES,
    "Skipped",
    "Deferred",
    "Closed",
  ];

  let filePath: string;
  let allowed: SetStatusOpts["status"][];
  let isMilestoneReadme: boolean;

  if (statSync(absTarget).isDirectory()) {
    // Milestone folder — edit 00-README.md
    filePath = join(absTarget, "00-README.md");
    allowed = MILESTONE_STATUSES;
    isMilestoneReadme = true;
    if (!existsSync(filePath)) {
      throw new Error(`No 00-README.md found in ${absTarget}`);
    }
  } else {
    filePath = absTarget;
    allowed = SPEC_STATUSES;
    isMilestoneReadme = false;
  }

  if (!allowed.includes(status)) {
    throw new Error(
      `Invalid status: "${status}". Allowed: ${allowed.join(", ")}`,
    );
  }

  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const raw = readFileSync(filePath, "utf-8");
  const { data, content } = parseFrontmatter(raw);

  const updatedData: Record<string, unknown> = { ...data, status };

  // On a SPEC, `verified:` is a pure derived copy that this command would
  // otherwise carry forward stale — sync it. `status:` is left as the caller
  // asked: setting it is the whole point of the command, and on a spec it is
  // an explicit human override that no reader consumes (every display path
  // uses computedStatus — tracker-reader.ts:524/554, index-rebuilder.ts:239).
  //
  // On a MILESTONE README nothing is synced: there `status:` IS read, as the
  // terminal override (tracker-reader.ts:363), and a README has no checklist
  // to derive from.
  const syncedData = isMilestoneReadme
    ? updatedData
    : syncLegacyDerivedFields(updatedData, content, { includeStatus: false });

  const serialized = serializeFrontmatter(
    syncedData as Record<string, unknown>,
    content,
  );
  const final = serialized.endsWith("\n") ? serialized : `${serialized}\n`;

  atomicWriteFileSync(filePath, final);

  // Regenerate the index
  rebuildIndex(trackerRoot);
}

// ---------------------------------------------------------------------------
// tracker index --rebuild
// ---------------------------------------------------------------------------

/**
 * Regenerate .tracker/00-INDEX.md from spec reality.
 * Idempotent: running twice with no changes produces no diff.
 */
export function rebuildIndex(trackerRoot: string): void {
  const state = readTrackerState(trackerRoot);
  const content = rebuildIndexDoc(state);
  atomicWriteFileSync(join(trackerRoot, "00-INDEX.md"), content);
}

// ---------------------------------------------------------------------------
// Rituals — recurring work that rolls forward instead of completing
// ---------------------------------------------------------------------------

/** How many run files to keep live per ritual before pruning into the ledger. */
const RUN_RETENTION = 8;

export type AddRitualOpts = {
  trackerRoot: string;
  name: string;
  slug: string;
  cadence?: string;
  due?: string;
  agent?: string;
  owner?: string;
};

export type AddRitualResult =
  | { kind: "created"; dirPath: string; ritualPath: string }
  | { kind: "exists"; dirPath: string };

/**
 * Create a new ritual definition at rituals/<slug>/ritual.md (plus an empty
 * runs/ dir). Idempotent: returns {kind:'exists'} if the slug already exists.
 * `due` defaults to today (immediately due); `cadence` is optional — omit it
 * for an on-demand ritual that goes dormant after each run.
 */
export function addRitual(opts: AddRitualOpts): AddRitualResult {
  const { trackerRoot, name, slug } = opts;

  const cadence =
    opts.cadence && opts.cadence.trim() !== "" ? opts.cadence.trim() : undefined;
  if (cadence !== undefined && parseCadence(cadence) === null) {
    throw new Error(`Invalid cadence: "${cadence}" (expected e.g. 7d, 2w, 1m)`);
  }

  const today = todayIso();
  const due = opts.due && opts.due.trim() !== "" ? opts.due.trim() : today;
  if (!isIsoDate(due)) {
    throw new Error(`Invalid due date: "${due}" (expected YYYY-MM-DD)`);
  }

  const dirPath = join(trackerRoot, "rituals", slug);
  if (existsSync(dirPath)) {
    return { kind: "exists", dirPath };
  }

  mkdirSync(join(dirPath, "runs"), { recursive: true });

  const templateRaw = readFileSync(join(getTemplatesDir(), "ritual.md"), "utf-8");
  const { content: templateBody } = parseFrontmatter(templateRaw);
  const body = templateBody.replace(/\{\{RITUAL_NAME\}\}/g, name);

  const agent =
    opts.agent && opts.agent.trim() !== "" ? opts.agent.trim() : undefined;
  const owner =
    opts.owner && opts.owner.trim() !== "" ? opts.owner.trim() : undefined;

  const frontmatter: Record<string, unknown> = {
    type: "ritual",
    name,
    slug,
    cadence,
    due,
    last_run: undefined,
    agent,
    owner,
    started: today,
  };

  const ritualPath = join(dirPath, "ritual.md");
  atomicWriteFileSync(
    ritualPath,
    ensureTrailingNewline(serializeFrontmatter(frontmatter, body)),
  );

  rebuildIndex(trackerRoot);

  return { kind: "created", dirPath, ritualPath };
}

export type StampRunOpts = {
  trackerRoot: string;
  slug: string;
  date?: string;
};

export type StampRunResult =
  | { kind: "created"; runPath: string; date: string }
  | { kind: "exists"; runPath: string; date: string };

/**
 * Stamp a new run from a ritual's step template into runs/<date>.md.
 * The run is an ordinary spec (checkboxes reset, run-specific frontmatter and
 * title) that the Work Loop ticks through. Idempotent per date.
 */
export function stampRun(opts: StampRunOpts): StampRunResult {
  const { trackerRoot, slug } = opts;

  const dirPath = findRitualDir(trackerRoot, slug);
  if (dirPath === null) {
    throw new Error(`Ritual not found: ${slug}`);
  }

  const date =
    opts.date && opts.date.trim() !== "" ? opts.date.trim() : todayIso();
  if (!isIsoDate(date)) {
    throw new Error(`Invalid run date: "${date}" (expected YYYY-MM-DD)`);
  }

  const runsDir = join(dirPath, "runs");
  mkdirSync(runsDir, { recursive: true });
  const runPath = join(runsDir, `${date}.md`);
  if (existsSync(runPath)) {
    return { kind: "exists", runPath, date };
  }

  const ritualRaw = readFileSync(join(dirPath, "ritual.md"), "utf-8");
  const { input, content } = parseRitual(ritualRaw, join(dirPath, "ritual.md"));
  const name = input.name ?? slug;
  const agent =
    typeof input.agent === "string" && input.agent.trim() !== ""
      ? input.agent.trim()
      : undefined;

  let runBody = resetCheckboxes(content);
  runBody = replaceFirstH1(runBody, `${name} — run ${date}`);

  const frontmatter: Record<string, unknown> = {
    type: "run",
    ritual: slug,
    started: date,
    depends_on: [],
    agent,
  };

  atomicWriteFileSync(
    runPath,
    ensureTrailingNewline(serializeFrontmatter(frontmatter, runBody)),
  );

  rebuildIndex(trackerRoot);

  return { kind: "created", runPath, date };
}

export type CompleteRunOpts = {
  trackerRoot: string;
  slug: string;
  /** Defaults to today; injectable for deterministic tests. */
  today?: string;
};

export type CompleteRunResult = {
  lastRun: string;
  /** New due date after rolling by cadence, or null if the ritual went dormant. */
  rolledDue: string | null;
  /** Run dates pruned into the ledger by retention. */
  pruned: string[];
};

/**
 * Record that a ritual ran: stamp `last_run`, and roll `due` forward by the
 * ritual's cadence (interval-since-completion). A ritual with no cadence goes
 * dormant (due cleared) until re-armed by hand. Old runs beyond RUN_RETENTION
 * are collapsed into runs/_ledger.md.
 */
export function completeRun(opts: CompleteRunOpts): CompleteRunResult {
  const { trackerRoot, slug } = opts;

  const dirPath = findRitualDir(trackerRoot, slug);
  if (dirPath === null) {
    throw new Error(`Ritual not found: ${slug}`);
  }

  const today =
    opts.today && opts.today.trim() !== "" ? opts.today.trim() : todayIso();
  if (!isIsoDate(today)) {
    throw new Error(`Invalid date: "${today}" (expected YYYY-MM-DD)`);
  }

  const ritualPath = join(dirPath, "ritual.md");
  const { data, content } = parseFrontmatter(readFileSync(ritualPath, "utf-8"));

  const rawCadence = data["cadence"];
  const cadence =
    typeof rawCadence === "string" && rawCadence.trim() !== ""
      ? rawCadence.trim()
      : null;
  const rolledDue = cadence === null ? null : rollByCadence(today, cadence);

  const updated: Record<string, unknown> = {
    ...data,
    last_run: today,
    due: rolledDue ?? undefined,
  };
  atomicWriteFileSync(
    ritualPath,
    ensureTrailingNewline(serializeFrontmatter(updated, content)),
  );

  const pruned = pruneRuns(dirPath, RUN_RETENTION);

  rebuildIndex(trackerRoot);

  return { lastRun: today, rolledDue, pruned };
}

// ---- ritual internal helpers ----

function getRitualsDir(trackerRoot: string): string {
  return join(trackerRoot, "rituals");
}

function findRitualDir(trackerRoot: string, slug: string): string | null {
  const dirPath = join(getRitualsDir(trackerRoot), slug);
  if (existsSync(dirPath) && statSync(dirPath).isDirectory()) {
    return dirPath;
  }
  return null;
}

/** Run files are YYYY-MM-DD.md; underscore-prefixed files (e.g. _ledger.md) are excluded. */
function listRunFiles(runsDir: string): string[] {
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
    .sort();
}

function pruneRuns(dirPath: string, keep: number): string[] {
  const runsDir = join(dirPath, "runs");
  const runs = listRunFiles(runsDir);
  if (runs.length <= keep) return [];

  const toPrune = runs.slice(0, runs.length - keep);
  const prunedDates: string[] = [];
  const summaries: string[] = [];

  for (const file of toPrune) {
    const filePath = join(runsDir, file);
    const date = file.replace(/\.md$/, "");
    let summary = `- ${date}`;
    try {
      const view = parseSpec(readFileSync(filePath, "utf-8"), filePath);
      summary = `- ${date}: ${view.title} — ${view.verifiedCount}/${view.totalCount} verified`;
    } catch {
      // Unparseable run — keep the bare-date summary.
    }
    prunedDates.push(date);
    summaries.push(summary);
    rmSync(filePath);
  }

  const ledgerPath = join(runsDir, "_ledger.md");
  const header =
    "# Run ledger\n\nRuns pruned by retention (newest live runs kept in this folder).\n\n";
  const existing = existsSync(ledgerPath)
    ? readFileSync(ledgerPath, "utf-8")
    : header;
  atomicWriteFileSync(ledgerPath, `${existing}${summaries.join("\n")}\n`);

  return prunedDates;
}

function resetCheckboxes(body: string): string {
  return body.replace(/^(\s*- \[).(\])/gm, "$1 $2");
}

function replaceFirstH1(body: string, title: string): string {
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (/^#\s+\S/.test(lines[i]!)) {
      lines[i] = `# ${title}`;
      return lines.join("\n");
    }
  }
  return `# ${title}\n\n${body}`;
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s : `${s}\n`;
}

// ---------------------------------------------------------------------------
// Vigils — one-shot pending verifications that terminate with a verdict
// ---------------------------------------------------------------------------

export type AddVigilOpts = {
  trackerRoot: string;
  slug: string;
  name: string;
  /** Optional date gate (ISO YYYY-MM-DD). */
  due?: string;
  /** Optional event gate (free prose). */
  until?: string;
  /** Optional provenance pointer (free text, e.g. "M77/S02"). */
  from?: string;
  agent?: string;
  /** Date the vigil was opened; defaults to today. Injectable for tests. */
  opened?: string;
  /**
   * Markdown BODY for the vigil, replacing the scaffold. When omitted the
   * template body is written as before. When supplied it must carry a
   * `## Verification Checklist` with at least one executable `Command:` —
   * see assertVigilBodyIsWorkable.
   */
  body?: string;
};

export type AddVigilResult =
  | { kind: "created"; vigilPath: string; executableCommands: number }
  | { kind: "exists"; vigilPath: string };

/**
 * Create a new vigil at vigils/<slug>.md (flat — one file per vigil, no runs/).
 * The vigil file itself is the spec you work when it fires. Idempotent: returns
 * {kind:'exists'} if the slug already exists. Requires at least one gate
 * (`due` and/or `until`) — a vigil with no gate could never surface.
 */
export function addVigil(opts: AddVigilOpts): AddVigilResult {
  const { trackerRoot, slug, name } = opts;

  assertValidVigilSlug(slug);

  const due = opts.due && opts.due.trim() !== "" ? opts.due.trim() : undefined;
  if (due !== undefined && !isIsoDate(due)) {
    throw new Error(`Invalid due date: "${due}" (expected YYYY-MM-DD)`);
  }
  const until = opts.until && opts.until.trim() !== "" ? opts.until.trim() : undefined;
  assertVigilHasGate(due, until);

  const opened =
    opts.opened && opts.opened.trim() !== "" ? opts.opened.trim() : todayIso();
  if (!isIsoDate(opened)) {
    throw new Error(`Invalid opened date: "${opened}" (expected YYYY-MM-DD)`);
  }

  const vigilsDir = join(trackerRoot, "vigils");
  const vigilPath = join(vigilsDir, `${slug}.md`);
  if (existsSync(vigilPath)) {
    return { kind: "exists", vigilPath };
  }

  const body = prepareVigilBody({
    supplied: opts.body,
    name,
    context: `refusing to write ${vigilPath}`,
    slug,
  });

  mkdirSync(vigilsDir, { recursive: true });

  const from = opts.from && opts.from.trim() !== "" ? opts.from.trim() : undefined;
  const agent = opts.agent && opts.agent.trim() !== "" ? opts.agent.trim() : undefined;

  // Frontmatter is built as a data object and emitted through the YAML-safe
  // serializer, so free-prose fields (`until`, `from`) with colons/quotes are
  // quoted correctly rather than producing invalid bare scalars.
  const frontmatter: Record<string, unknown> = {
    type: "vigil",
    name,
    slug,
    due,
    until,
    from,
    agent,
    opened,
    resolved: undefined,
    verdict: undefined,
  };

  atomicWriteFileSync(
    vigilPath,
    ensureTrailingNewline(serializeFrontmatter(frontmatter, body)),
  );

  // A vigil that does not read back is worse than no vigil: `vigil list`,
  // `due`, `doctor` and `status` all walk vigils/, so one unparseable file
  // takes every command down. Prove the write before anything else sees it,
  // and take the file back out on failure — a half-written vigil must not
  // survive the refusal that names it.
  try {
    assertVigilReadsBack(vigilPath, slug);
  } catch (err) {
    rmSync(vigilPath, { force: true });
    throw err;
  }

  rebuildIndex(trackerRoot);

  return {
    kind: "created",
    vigilPath,
    executableCommands: countVigilCommands(body).executableCount,
  };
}

// ---------------------------------------------------------------------------
// Vigil bodies — the checklist you work when the gate fires
// ---------------------------------------------------------------------------

/** The section every vigil body must carry; the Work Loop ticks its items. */
const VIGIL_CHECKLIST_HEADING_RE = /^##[ \t]+Verification Checklist[ \t]*$/m;

/**
 * A vigil Command that invokes `fc vigil-sweep` itself. a project's own sweep script
 * executes every open vigil's `Command:` lines unattended; a vigil whose own
 * Command re-invokes the sweep recurses one level deeper per run. Measured
 * 2026-09-03: one such vigil recursed 14 levels deep and nearly killed the
 * host. Rejected outright — there is no legitimate reason for a vigil Command
 * to call the sweep that is executing it.
 */
const FC_VIGIL_SWEEP_RE = /\bfc\s+vigil-sweep\b/;

/**
 * A vigil Command that MUTATES tracker state instead of observing production.
 *
 * `fc vigil-sweep` runs every open vigil's Commands unattended, once a day. A
 * Command that closes the vigil, stamps a ritual, or ticks a spec item is
 * therefore a machine writing its own evidence: the sweep would record a
 * `held` verdict nobody judged, and the tick is a historical claim that no
 * longer means anything.
 *
 * Measured 2026-09-05 on this estate: nine armed vigils carried such a
 * Command, four of them shaped as a runnable `node <cli> vigil close … --verdict
 * held`. All nine happened to fail only because the pinned CLI path had moved
 * and `tracker` is not on PATH. That is luck, not a design.
 *
 * Recording a verdict is a CLOSE ACTION taken by a person after reading the
 * evidence. It is never a precondition of closing, and never a check.
 */
const TRACKER_STATE_MUTATION_RE =
  /\bvigil\s+(?:close|add|set-body)\b|\britual\s+(?:run|complete)\b|\bmark\b[^|;&]*--verified\b/;

/**
 * A vigil Command that reads its OWN `verdict:` or `resolved:` frontmatter.
 *
 * This is circular by construction. An armed vigil has no verdict, so the check
 * fails; and the vigil cannot be closed while a check fails. Measured
 * 2026-09-05: fifteen armed vigils carried one, and it is the single reason
 * `m309-site-local-day-window-evening` sat in `wouldFail` while the behaviour
 * it guards was verified healthy in production.
 *
 * Reading ANOTHER vigil's verdict is legitimate and stays allowed — one vigil
 * can properly wait on another's outcome.
 */
function selfVerdictReadRe(slug: string): RegExp {
  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\.md`);
}
// Tolerates the alternation shapes seen in the wild, e.g.
// `grep -cE '^(verdict|resolved): .+'`, where a `)` sits between the
// field name and its colon.
const VERDICT_FIELD_READ_RE = /\b(?:verdict|resolved)\b[^\w\n]{0,4}:/;

////////////////////////////////
// M346/03 — a Command the PARSER cannot run must never be armed.
//
// Both the tracker runner and a project's own sweep script read ONLY THE FIRST LINE of a `Command:`.
// A Command written across several lines therefore reaches the shell truncated, with its opening
// backtick still attached, and the shell dies on an unterminated quote or heredoc. The sweep files
// that as an ordinary failure, so a check that has never once executed is indistinguishable from a
// check that ran and failed.
//
// Measured 2026-09-10 across 222 vigil files: 13 carried a `<<` heredoc and 18 carried an
// unquoted `<placeholder>`. `m320-09` carried BOTH, and every daily sweep since it was armed had
// run `/bin/sh: unexpected EOF` for it.
//
// These three refusals are STATIC. They read the markdown and never execute anything, which is
// what keeps them safe at write time: the CLI has no production credentials and no time budget.
// Whether a runnable Command actually PROVES anything is a separate question, decided at run time
// by the sweep. The CLI decides what a check IS; the sweep decides what a check DID.
////////////////////////////////

/** Every raw `- Command:` line, before any parser has normalised it. */
const RAW_COMMAND_LINE_RE = /^[ \t]*-[ \t]*Command:[ \t]*(.*)$/gm;

/** A `<<` heredoc, which needs lines the parser will never read. */
const HEREDOC_RE = /<<-?\s*['"]?[A-Za-z_]/;

/** An angle-bracketed placeholder, e.g. `<deploy-timestamp>`. */
const ANGLE_PLACEHOLDER_RE = /<[A-Za-z][\w.-]*>/;

/**
 * Blank out single- and double-quoted spans so a quoted `<word>` reads as inert.
 *
 * A placeholder inside quotes is a plain string the shell never interprets, which is the correct
 * way to leave a token for a human to substitute later. Only an UNQUOTED one is a redirect.
 */
function stripQuotedSpans(command: string): string {
  let out = "";
  let quote: string | null = null;
  for (const ch of command) {
    if (quote === null && (ch === "'" || ch === '"')) {
      quote = ch;
      out += " ";
      continue;
    }
    if (quote !== null && ch === quote) {
      quote = null;
      out += " ";
      continue;
    }
    out += quote === null ? ch : " ";
  }
  return out;
}

/**
 * Refuse the three shapes that make a `Command:` unrunnable by the one-line parser.
 *
 * Exported because `doctor` applies the identical rules to files that already exist — the write
 * path and the health check must not disagree about what "runnable" means.
 *
 * @returns one refusal reason per offending Command, empty when the body is clean.
 */
export function findUnrunnableCommandShapes(body: string): string[] {
  const reasons: string[] = [];

  for (const match of body.matchAll(RAW_COMMAND_LINE_RE)) {
    const raw = match[1] ?? "";
    const shown = raw.trim().slice(0, 80);

    const backticks = (raw.match(/`/g) ?? []).length;
    if (backticks % 2 !== 0) {
      reasons.push(
        `a Command line has an unbalanced backtick (\`${shown}\`). Both parsers read only the ` +
          "FIRST LINE of a `Command:`, so a Command spanning several lines reaches the shell " +
          "truncated and dies on an unterminated quote. Put the whole command on one line.",
      );
      continue;
    }

    if (HEREDOC_RE.test(raw)) {
      reasons.push(
        `a Command line uses a \`<<\` heredoc (\`${shown}\`). The heredoc body is on the ` +
          "following lines, which the parser never reads, so the shell receives an unterminated " +
          "heredoc and exits 2. Use `printf '%s\\n' ... | ...` on one line instead.",
      );
      continue;
    }

    if (ANGLE_PLACEHOLDER_RE.test(stripQuotedSpans(raw))) {
      reasons.push(
        `a Command line carries an unquoted \`<placeholder>\` (\`${shown}\`). The shell reads ` +
          "`<` as a redirect, not as a token to fill in, so the command fails on a missing file. " +
          "Quote it, or substitute the real value before arming.",
      );
    }
  }

  return reasons;
}

/** Refusal text shared by `vigil add --stdin` and `vigil set-body --stdin`. */
const EMPTY_VIGIL_BODY_MESSAGE =
  "refusing to write an empty body — the vigil IS the spec you work when its gate fires";

/**
 * Refuse a vigil body nobody could ever work, before it reaches the disk.
 *
 * Three ways a body fails, two of them measured on this estate (M315/06 found
 * 23 of 48 open vigils unrunnable) and the third measured 2026-09-03, when a
 * vigil Command that re-invoked `fc vigil-sweep` recursed 14 levels deep and
 * nearly killed the host:
 *
 *  - a `Command:` that invokes `fc vigil-sweep` itself — rejected outright,
 *    there is no legitimate reason for a vigil to call the sweep executing it;
 *  - a `Command:` that is a shell no-op and is NOT declared an operator
 *    decision — the `echo todo` that reads like a check and exits 0. Same
 *    refusal family as `tracker add spec`, with the advice pointed at the
 *    body grammar, since a hand-written body has no `--manual` flag to reach
 *    for;
 *  - no executable `Command:` anywhere, so `tracker doctor` would fail on the
 *    file the moment it existed.
 *
 * The classifier is `isTrivialCommand` and the counter is `countVigilCommands`
 * — the same two `doctor` uses, so the write path cannot disagree with the
 * health check about what "executable" means.
 *
 * @returns how many checklist items carry an executable Command.
 */
export function assertVigilBodyIsWorkable(
  body: string,
  context: string,
  slug?: string,
): number {
  if (!VIGIL_CHECKLIST_HEADING_RE.test(body)) {
    throw new Error(
      `${context} — the body has no \`## Verification Checklist\` heading. A vigil is worked ` +
        "from that section when its gate fires; without one there is nothing to work.",
    );
  }

  const unrunnable = findUnrunnableCommandShapes(body);
  if (unrunnable.length > 0) {
    throw new Error(`${context} — ${unrunnable[0]}`);
  }

  for (const item of parseChecklist(body)) {
    if (item.command === null) continue;
    if (FC_VIGIL_SWEEP_RE.test(item.command)) {
      throw new Error(
        "vigil Commands run unattended by fc vigil-sweep; a vigil that invokes the sweep " +
          "recurses. Read .tracker/.fc-vigil-sweep-latest.json instead.",
      );
    }
    if (TRACKER_STATE_MUTATION_RE.test(item.command)) {
      throw new Error(
        `${context} — checklist item ${item.index} has a Command that writes tracker state ` +
          `(\`${item.command.trim().slice(0, 80)}\`). vigil Commands run unattended by ` +
          "fc vigil-sweep, so this one would close the vigil, stamp the ritual or tick the spec " +
          "with nobody reading the evidence. Recording a verdict is a close action a person " +
          "takes afterwards, not a check. Assert the production state instead.",
      );
    }
    if (
      slug !== undefined &&
      VERDICT_FIELD_READ_RE.test(item.command) &&
      selfVerdictReadRe(slug).test(item.command)
    ) {
      throw new Error(
        `${context} — checklist item ${item.index} reads this vigil's own \`verdict:\`/` +
          "`resolved:` frontmatter. That is circular: an armed vigil has no verdict, so the " +
          "check fails, and the vigil cannot close while a check fails. Reading ANOTHER " +
          "vigil's verdict is fine. Assert the production state this vigil guards instead.",
      );
    }
    if (!isTrivialCommand(item.command)) continue;
    if (item.expected !== null && /^\s*manual\b/i.test(item.expected)) continue;
    const label = item.label.trim() === "" ? "(unlabelled)" : item.label.trim();
    throw new Error(
      `${context} — checklist item ${item.index} ("${label}") has a shell no-op Command ` +
        `(\`${item.command}\`). A Command that cannot fail is not a check. Write a real ` +
        "assertion, or declare it an operator decision with " +
        "`- Expected: manual (owner: <who>, expires: <YYYY-MM-DD>)`.",
    );
  }

  const { executableCount } = countVigilCommands(body);
  if (executableCount === 0) {
    throw new Error(
      `${context} — no checklist item carries an executable \`Command:\`. An armed vigil with ` +
        "nothing to run can never be closed by any evidence, and `tracker doctor` fails on one. " +
        "Give at least one item a real assertion.",
    );
  }

  return executableCount;
}

/**
 * Resolve the body a vigil write will land: the caller's markdown when one was
 * supplied, otherwise the template scaffold.
 *
 * A supplied body keeps the author's own H1; only a body with no H1 at all
 * gets `# <name>` prepended, which is what the template produces anyway. Both
 * routes are validated, so a template regression is caught by the same rule as
 * a hand-written body.
 */
function prepareVigilBody(opts: {
  supplied: string | undefined;
  name: string;
  context: string;
  slug?: string;
}): string {
  if (opts.supplied !== undefined && opts.supplied.trim() === "") {
    throw new Error(EMPTY_VIGIL_BODY_MESSAGE);
  }

  const raw =
    opts.supplied ??
    parseFrontmatter(
      readFileSync(join(getTemplatesDir(), "vigil.md"), "utf-8"),
    ).content.replace(/\{\{VIGIL_NAME\}\}/g, opts.name);

  const body = ensureH1(raw, opts.name);
  assertVigilBodyIsWorkable(body, opts.context, opts.slug);
  return body;
}

/** Prepend `# <title>` only when the body carries no H1 of its own. */
function ensureH1(body: string, title: string): string {
  const hasH1 = body.split("\n").some((line) => /^#\s+\S/.test(line));
  return hasH1 ? body : `# ${title}\n\n${body}`;
}

/**
 * Re-read a freshly written vigil through the SAME parser `vigil list --json`
 * uses, and fail loudly when it does not come back.
 *
 * Not paranoia: one malformed frontmatter block in this estate's tracker took
 * down every CLI command at once, because `readTrackerState` walks vigils/ on
 * the way to almost everything. A body write is the one place a caller's text
 * lands next to that block, so it proves itself.
 */
function assertVigilReadsBack(vigilPath: string, slug: string): void {
  const { data } = parseFrontmatter(readFileSync(vigilPath, "utf-8"));
  const parsed =
    typeof data["slug"] === "string" && data["slug"].trim() !== ""
      ? data["slug"].trim()
      : basename(vigilPath, ".md");
  if (parsed !== slug) {
    throw new Error(
      `wrote ${vigilPath} but it re-reads as slug "${parsed}" (expected "${slug}") — ` +
        "the file was not left in place",
    );
  }
}

export type SetVigilBodyOpts = {
  trackerRoot: string;
  slug: string;
  /** Replacement markdown body. Validated exactly like `vigil add --stdin`. */
  body: string;
};

export type SetVigilBodyResult = {
  vigilPath: string;
  /** Checklist items carrying an executable Command after the write. */
  executableCommands: number;
};

/**
 * Replace the BODY of an existing vigil, preserving its frontmatter byte for
 * byte.
 *
 * This exists because the doctor rule (v10.9.0) makes a real checklist
 * mandatory while `vigil add` had no route to supply one — so bodies were
 * being spliced in by hand, by scripts, or not at all. Frontmatter is copied
 * verbatim rather than re-serialised: `opened`, `until` and `from` are
 * historical fields, and a body edit has no business re-quoting them.
 *
 * Refuses a CLOSED vigil. A verdict is a historical claim about what was
 * observed; rewriting the checklist under it would rewrite the evidence.
 */
export function setVigilBody(opts: SetVigilBodyOpts): SetVigilBodyResult {
  const { trackerRoot, slug } = opts;

  const vigilPath = findVigilFile(trackerRoot, slug);
  if (vigilPath === null) {
    throw new Error(`Vigil not found: ${slug}`);
  }

  const original = readFileSync(vigilPath, "utf-8");
  const split = splitRawFrontmatter(original);
  if (split === null) {
    throw new Error(
      `${vigilPath} has no frontmatter block — refusing to rewrite a file the vigil reader ` +
        "cannot place. Repair the file by hand first.",
    );
  }

  const { data } = parseFrontmatter(original);
  const verdict = typeof data["verdict"] === "string" ? data["verdict"].trim() : "";
  if (verdict !== "") {
    const resolved =
      typeof data["resolved"] === "string" && data["resolved"].trim() !== ""
        ? `, resolved ${data["resolved"].trim()}`
        : "";
    throw new Error(
      `${slug} is closed (verdict ${verdict}${resolved}) — a closed vigil is a historical ` +
        "claim, not a draft, and its body is not rewritten. Route any follow-up to a new spec " +
        "via darius add.",
    );
  }

  const name =
    typeof data["name"] === "string" && data["name"].trim() !== ""
      ? data["name"].trim()
      : slug;
  const body = prepareVigilBody({
    supplied: opts.body,
    name,
    context: `refusing to rewrite ${vigilPath}`,
    slug,
  });

  atomicWriteFileSync(
    vigilPath,
    ensureTrailingNewline(`${split.frontmatter}\n${body.replace(/^\n+/, "")}`),
  );

  try {
    assertVigilReadsBack(vigilPath, slug);
  } catch (err) {
    // Put the previous file back. `add` deletes on a failed read-back because
    // there was nothing there before; here there was, and losing it would cost
    // more than the failed edit.
    atomicWriteFileSync(vigilPath, original);
    throw err;
  }

  rebuildIndex(trackerRoot);

  return { vigilPath, executableCommands: countVigilCommands(body).executableCount };
}

export type CloseVigilOpts = {
  trackerRoot: string;
  verdict: string;
  slug: string;
  /** Resolution date; defaults to today. Injectable for tests. */
  date?: string;
};

export type CloseVigilResult =
  | { kind: "closed"; verdict: VigilVerdict; resolved: string }
  | { kind: "already-closed"; verdict: string; resolved: string | null };

/**
 * Close a vigil with a terminal verdict (`held` | `failed`), stamping
 * `resolved` and `verdict` in its frontmatter. Idempotent and non-destructive:
 * an already-closed vigil is not overwritten — its existing verdict is reported.
 * A closed vigil keeps its file as the provenance record (findings live in the
 * body). A `failed` verdict emits no automatic follow-up — remediation is routed
 * to a new spec via darius add.
 */
export function closeVigil(opts: CloseVigilOpts): CloseVigilResult {
  const { trackerRoot, slug } = opts;

  const verdict: string = opts.verdict;
  assertValidVerdict(verdict);

  const vigilPath = findVigilFile(trackerRoot, slug);
  if (vigilPath === null) {
    throw new Error(`Vigil not found: ${slug}`);
  }

  const { data, content } = parseFrontmatter(readFileSync(vigilPath, "utf-8"));

  const existingVerdict =
    typeof data["verdict"] === "string" && data["verdict"].trim() !== ""
      ? data["verdict"].trim()
      : null;
  if (existingVerdict !== null) {
    const existingResolved =
      typeof data["resolved"] === "string" && data["resolved"].trim() !== ""
        ? data["resolved"].trim()
        : null;
    return { kind: "already-closed", verdict: existingVerdict, resolved: existingResolved };
  }

  const resolved =
    opts.date && opts.date.trim() !== "" ? opts.date.trim() : todayIso();
  if (!isIsoDate(resolved)) {
    throw new Error(`Invalid date: "${resolved}" (expected YYYY-MM-DD)`);
  }

  // Spread preserves original key order; resolved/verdict already exist as
  // (empty) keys so they stay in their frontmatter positions.
  const updated: Record<string, unknown> = {
    ...data,
    resolved,
    verdict,
  };
  atomicWriteFileSync(
    vigilPath,
    ensureTrailingNewline(serializeFrontmatter(updated, content)),
  );

  rebuildIndex(trackerRoot);

  return { kind: "closed", verdict, resolved };
}

function findVigilFile(trackerRoot: string, slug: string): string | null {
  const vigilPath = join(trackerRoot, "vigils", `${slug}.md`);
  if (existsSync(vigilPath) && statSync(vigilPath).isFile()) {
    return vigilPath;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function todayIsoString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Split a template file into its frontmatter block (the raw text between the
 * `---` delimiters — NOT parsed as YAML, since {{PLACEHOLDER}} tokens aren't
 * valid YAML scalars) and the body that follows the closing `---`.
 */
function splitTemplate(templateRaw: string): { frontmatterBlock: string; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(templateRaw);
  if (!match) {
    throw new Error("Template is missing a --- frontmatter block");
  }
  return { frontmatterBlock: match[1] ?? "", body: match[2] ?? "" };
}

/**
 * Re-insert comment lines into a `serializeFrontmatter()` output, just before
 * the closing `---` delimiter (the same position they held in the source
 * template). serializeFrontmatter has no concept of YAML comments, so they're
 * stripped out before serialization and restored verbatim here.
 */
function attachFrontmatterComments(serialized: string, comments: string[]): string {
  if (comments.length === 0) return serialized;
  const commentBlock = `${comments.join("\n")}\n`;
  return serialized.replace(/\n---\n/, `\n${commentBlock}---\n`);
}

function toKebabCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Walk trackerRoot for M{N}-<slug> directories; return the matching folder path
 * if a directory contains `slug` as a substring of its name, or null.
 */
function findMilestoneBySlug(trackerRoot: string, slug: string): string | null {
  const entries = readdirSync(trackerRoot);
  for (const entry of entries) {
    const fullPath = join(trackerRoot, entry);
    if (!statSync(fullPath).isDirectory()) continue;
    if (!/^M\d+-.+$/.test(entry)) continue;

    // The folder name is M{N}-{slug}, so strip the M{N}- prefix
    const folderSlug = entry.replace(/^M\d+-/, "");
    if (folderSlug === slug) {
      return fullPath;
    }
  }
  return null;
}

/**
 * Resolve a milestone path from an argument like "M2-tracker-cli-refactor"
 * or just "tracker-cli-refactor".
 */
export function resolveMilestonePath(trackerRoot: string, milestoneArg: string): string {
  // Direct match (full folder name)
  const directPath = join(trackerRoot, milestoneArg);
  if (existsSync(directPath)) return directPath;

  // Try as slug (strip M{N}- prefix)
  const bySlug = findMilestoneBySlug(trackerRoot, milestoneArg);
  if (bySlug !== null) return bySlug;

  throw new Error(`Milestone not found: ${milestoneArg}`);
}

/**
 * Find a spec file in a milestone directory whose name matches NN-<slug>.md.
 */
function findSpecBySlug(milestonePath: string, slug: string): string | null {
  const entries = readdirSync(milestonePath);
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    if (entry === "00-README.md") continue;

    // Match NN-<slug>.md
    const match = /^\d{2}-(.+)\.md$/.exec(entry);
    if (!match) continue;

    if (match[1] === slug) {
      return join(milestonePath, entry);
    }
  }
  return null;
}

/**
 * Milestone-id prefixes that share ONE number namespace.
 *
 * Per-repo trackers were merged into a single workspace tracker (M231); the
 * milestones they brought with them were archived under a source prefix —
 * `DLP` (acme-web), `ATH` (another source repo), `BLD` (a third) — instead of being
 * renumbered. The prefixes are documented alongside the others in the workspace's
 * `MIGRATION-MAP.md`. `DLP269` and a freshly minted `M269` are therefore the
 * SAME milestone number wearing two hats: worklogs, MIGRATION-MAP entries and
 * commit messages that say "269" become ambiguous the moment both exist.
 *
 * So every prefix here occupies the number for all of them.
 */
export const MILESTONE_ID_PREFIXES = ["M", "DLP", "ATH", "BLD", "DJ"] as const;

/**
 * `M247-foo` / `DLP269-bar.md` → the number 247 / 269.
 * Anchored and requiring the `-` separator so a date-stamped file
 * (`2026-07-29-notes.md`) can never be read as milestone 2026.
 */
const MILESTONE_ID_RE = new RegExp(
  `^(?:${[...MILESTONE_ID_PREFIXES].sort((a, b) => b.length - a.length).join("|")})(\\d+)-`,
);

/**
 * Every milestone number already spoken for, mapped to the entry that claims
 * it (for naming the collider in an error). Scans BOTH the active tree
 * (`.tracker/M{N}-slug/`) AND the archive (`.tracker/archive/M{N}-slug.md`
 * consolidated files, legacy `.tracker/archive/M{N}-slug/` directories, and
 * prefixed `.tracker/archive/DLP{N}-slug.md` merges) — archiving a milestone
 * must never free its number for reassignment.
 *
 * See the M249 collision (only the active tree was scanned) and the
 * DLP252–269 collision class (only the `M` prefix was scanned, so the next 18
 * mints would each have landed on an archived acme-web milestone).
 */
export function collectOccupiedMilestoneNumbers(
  trackerRoot: string,
): Map<number, string> {
  const occupied = new Map<number, string>();

  const scan = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir).sort()) {
      const match = MILESTONE_ID_RE.exec(entry);
      if (!match) continue;
      const n = parseInt(match[1] ?? "0", 10);
      if (!Number.isFinite(n)) continue;
      // First (sorted) claimant wins, so the reported collider is stable.
      if (!occupied.has(n)) occupied.set(n, entry);
    }
  };

  scan(trackerRoot);
  scan(join(trackerRoot, "archive"));

  return occupied;
}

/**
 * Throw if `n` is already claimed by an active or archived milestone under any
 * prefix. The error names the collider — "taken" without saying by what sends
 * the caller hunting.
 */
export function assertMilestoneNumberAvailable(
  trackerRoot: string,
  n: number,
): void {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid milestone number: ${n} (expected a positive integer)`);
  }
  const collider = collectOccupiedMilestoneNumbers(trackerRoot).get(n);
  if (collider !== undefined) {
    throw new Error(
      `Milestone number ${n} is already taken by "${collider}". ` +
        `Archived milestones keep their numbers (prefixes: ${MILESTONE_ID_PREFIXES.join(", ")}); ` +
        `pick a free number or omit --number to auto-mint.`,
    );
  }
}

/**
 * Get the highest occupied milestone number across ALL prefixes and return
 * next (highest + 1). Returns 1 if no milestones exist.
 */
function getNextMilestoneNumber(trackerRoot: string): number {
  const occupied = collectOccupiedMilestoneNumbers(trackerRoot);
  let highest = 0;
  for (const n of occupied.keys()) {
    if (n > highest) highest = n;
  }
  return highest + 1;
}

/**
 * Get the highest existing spec number in a milestone directory and return next.
 * Specs start at 01. Returns 1 if no specs exist.
 */
function getNextSpecNumber(milestonePath: string): number {
  const entries = readdirSync(milestonePath);
  let highest = 0;

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    if (entry === "00-README.md") continue;

    const match = /^(\d+)-.+\.md$/.exec(entry);
    if (!match) continue;
    const n = parseInt(match[1] ?? "0", 10);
    if (n > highest) highest = n;
  }

  return highest + 1;
}

// Re-export parseChecklist for internal use in mark (not really needed but good for cohesion)
export { parseChecklist };
