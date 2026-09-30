/**
 * tracker-reader.ts — reads the full tracker state from disk.
 *
 * Walks a .tracker/ directory and returns structured data for all
 * milestones and their specs. No writes, no side effects.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, basename, relative } from "node:path";
import { parseFrontmatter } from "./markdown/frontmatter.ts";
import { parseSpec } from "./documents/spec.ts";
import type { SpecView, SpecStatusType } from "./documents/spec.ts";
import { isDue, daysBetween } from "./dates.ts";

// ---------------------------------------------------------------------------
// MilestoneJSON type — for tracker list milestones --json
// ---------------------------------------------------------------------------

export type MilestoneStatus =
  | "Not Started"
  | "In Progress"
  | "Complete"
  | "Skipped"
  | "Deferred"
  | "Closed";

export interface MilestoneJSON {
  slug: string;
  name: string;
  number: number;
  verified: number;
  total: number;
  status: MilestoneStatus;
  specCount: number;
  /** Specs that failed to parse — excluded from specCount/verified/total. */
  brokenSpecCount: number;
}

/** Schema-compatible shim — validates at call time (identity for typed data). */
export const MilestoneJSONSchema = {
  parse(data: unknown): MilestoneJSON {
    return data as MilestoneJSON;
  },
};

// ---------------------------------------------------------------------------
// SpecListEntry type — for tracker list specs --json
// ---------------------------------------------------------------------------

export interface SpecListEntry {
  path: string;
  file: string;
  milestoneSlug: string;
  title: string;
  status: "Not Started" | "In Progress" | "Complete" | "Blocked" | "Skipped" | "Waiting";
  verified: number;
  total: number;
  depends_on: string[];
}

/** Schema-compatible shim — validates at call time (identity for typed data). */
export const SpecListEntrySchema = {
  parse(data: unknown): SpecListEntry {
    return data as SpecListEntry;
  },
};

// ---------------------------------------------------------------------------
// TrackerState — the full in-memory representation
// ---------------------------------------------------------------------------

export type SpecEntry = {
  file: string;
  absolutePath: string;
  relativePath: string;
  milestoneSlug: string;
  view: SpecView;
  /** Effective status after dependency resolution */
  effectiveStatus: SpecStatusType | "Waiting";
};

export type BrokenSpecEntry = {
  file: string;
  absolutePath: string;
  relativePath: string;
  /** Why the spec failed to parse — first line of the underlying error. */
  error: string;
};

export type MilestoneEntry = {
  slug: string;
  name: string;
  number: number;
  folderPath: string;
  specs: SpecEntry[];
  /**
   * Specs that failed to parse (e.g. `depends_on: [x.md]` inline-sequence
   * YAML, which the strict frontmatter parser rejects). Excluded from
   * specs/verified/total because their real state is unknown — but never
   * silently dropped: deriveMilestoneStatus refuses to report "Complete"
   * while this is non-empty, and status/index output lists them explicitly.
   */
  brokenSpecs: BrokenSpecEntry[];
  /** Aggregate verified/total counts across all specs */
  verified: number;
  total: number;
  /** Milestone-level status derived from spec statuses + README override */
  status: MilestoneStatus;
};

/** A broken spec flattened with its owning milestone, for rollup reporting. */
export type BrokenSpecSummary = {
  milestoneSlug: string;
  file: string;
  error: string;
};

export type ArchivedMilestoneEntry = {
  /** Slug from frontmatter, falling back to the archive filename stem */
  slug: string;
  /** Name from frontmatter, falling back to the first `#` heading, then slug */
  name: string;
  /** Date archived (frontmatter `archived`, falling back to `completed`) */
  archivedDate: string | null;
  /** Path relative to trackerRoot, e.g. "archive/M5-foo.md" */
  file: string;
};

export type RitualRecord = {
  slug: string;
  name: string;
  /** Recurrence interval (e.g. "7d", "2w", "1m"), or null for on-demand. */
  cadence: string | null;
  /** Date a run is due on/after (YYYY-MM-DD), or null when dormant. */
  due: string | null;
  /** Date of the last completed run (YYYY-MM-DD), or null if never run. */
  lastRun: string | null;
  /** Number of live run files (excludes the _ledger.md history). */
  runsCount: number;
  /** Absolute path to the ritual's directory. */
  dir: string;
};

export type VigilRecord = {
  slug: string;
  name: string;
  /** Optional date gate (YYYY-MM-DD), or null when absent. */
  due: string | null;
  /** Optional event gate (free prose), or null when absent. */
  until: string | null;
  /** Optional provenance pointer (free text, e.g. "M77/S02"), or null. */
  from: string | null;
  /** Optional preferred agent, or null. */
  agent: string | null;
  /** Date the vigil was opened (YYYY-MM-DD), or null. */
  opened: string | null;
  /** Date the vigil was resolved/closed (YYYY-MM-DD), or null while open. */
  resolved: string | null;
  /** `held` | `failed` once closed; null while open. A non-null verdict == closed. */
  verdict: string | null;
  /** Absolute path to the vigil's file. */
  path: string;
};

export type TrackerState = {
  trackerRoot: string;
  projectName: string;
  milestones: MilestoneEntry[];
  archivedMilestones: ArchivedMilestoneEntry[];
  rituals: RitualRecord[];
  vigils: VigilRecord[];
};

// ---------------------------------------------------------------------------
// Main reader
// ---------------------------------------------------------------------------

/**
 * Read the full tracker state from the given .tracker/ root directory.
 * Parses all milestones and their specs, resolves dependency-waiting status.
 */
export function readTrackerState(trackerRoot: string): TrackerState {
  const indexPath = join(trackerRoot, "00-INDEX.md");
  const projectName = readProjectName(indexPath);

  const milestones = readMilestones(trackerRoot);
  resolveDependencies(milestones);

  const archivedMilestones = readArchivedMilestones(trackerRoot);
  const rituals = readRituals(trackerRoot);
  const vigils = readVigils(trackerRoot);

  return { trackerRoot, projectName, milestones, archivedMilestones, rituals, vigils };
}

// ---------------------------------------------------------------------------
// Due-ritual selection — the pickable queue answering "what's due?"
// ---------------------------------------------------------------------------

export type DueRitual = {
  slug: string;
  name: string;
  due: string;
  /** Days since the due date (0 = due today, >0 = overdue). */
  daysOverdue: number;
  cadence: string | null;
  lastRun: string | null;
};

/**
 * Select rituals that are due on/before `today`, most-overdue first.
 * Pure: the clock is supplied by the caller so callers (and tests) stay
 * deterministic. Milestone work (`tracker next`) is intentionally separate —
 * ritual due-ness is time-driven, not dependency-driven.
 */
export function selectDueRituals(
  rituals: RitualRecord[],
  today: string,
): DueRitual[] {
  return rituals
    .filter((r) => isDue(r.due, today))
    .map((r) => ({
      slug: r.slug,
      name: r.name,
      due: r.due as string,
      daysOverdue: daysBetween(r.due as string, today),
      cadence: r.cadence,
      lastRun: r.lastRun,
    }))
    .sort((a, b) =>
      b.daysOverdue - a.daysOverdue !== 0
        ? b.daysOverdue - a.daysOverdue
        : a.slug < b.slug
          ? -1
          : 1,
    );
}

// ---------------------------------------------------------------------------
// Due-vigil selection — the one-shot pending-verification queue
// ---------------------------------------------------------------------------

/** A due vigil is a VigilRecord whose date gate has fired, plus how overdue. */
export type DueVigil = VigilRecord & {
  /** Days since the due date (0 = due today, >0 = overdue). */
  daysOverdue: number;
};

/** Grouped view of the open vigils that warrant attention. */
export type DueVigils = {
  /** Date gate has fired (mechanically due). Most-overdue-first, slug tiebreak. */
  due: DueVigil[];
  /** Event-gated and still waiting (CLI can't observe the event). Oldest-opened-first. */
  armed: VigilRecord[];
};

/**
 * Partition OPEN vigils (empty verdict) into `due` and `armed` for a given day.
 * Pure: the clock is supplied by the caller so callers (and tests) stay
 * deterministic. A vigil with a `due` date that has arrived is due (the `until`
 * event, if any, acted as a backstop). An open, not-yet-due vigil with an
 * `until` event stays visible as `armed`. A future-dated vigil with no event
 * gate is hidden until its date arrives.
 */
export function selectDueVigils(
  vigils: VigilRecord[],
  today: string,
): DueVigils {
  const open = vigils.filter((v) => v.verdict === null || v.verdict === "");

  const due: DueVigil[] = [];
  const armed: VigilRecord[] = [];

  for (const v of open) {
    if (isDue(v.due, today)) {
      due.push({ ...v, daysOverdue: daysBetween(v.due as string, today) });
    } else if (v.until !== null && v.until !== "") {
      armed.push(v);
    }
    // else: future-dated with no event gate — hidden from the queue.
  }

  due.sort((a, b) =>
    b.daysOverdue - a.daysOverdue !== 0
      ? b.daysOverdue - a.daysOverdue
      : a.slug < b.slug
        ? -1
        : 1,
  );

  armed.sort((a, b) => {
    const ao = a.opened ?? "";
    const bo = b.opened ?? "";
    if (ao !== bo) return ao < bo ? -1 : 1;
    return a.slug < b.slug ? -1 : 1;
  });

  return { due, armed };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function readProjectName(indexPath: string): string {
  if (!existsSync(indexPath)) return "Project";
  const raw = readFileSync(indexPath, "utf-8");
  const { data } = parseFrontmatter(raw);
  if (typeof data["name"] === "string") {
    // Strip " — Tracker" suffix if present
    return (data["name"] as string).replace(/ —?\s*Tracker\s*$/, "").trim();
  }
  return "Project";
}

function readMilestones(trackerRoot: string): MilestoneEntry[] {
  const entries = readdirSync(trackerRoot).sort();
  const milestones: MilestoneEntry[] = [];

  for (const entry of entries) {
    const fullPath = join(trackerRoot, entry);
    if (!statSync(fullPath).isDirectory()) continue;

    // Only process Mn- prefixed directories
    const milestoneMatch = /^(M(\d+))-(.+)$/.exec(entry);
    if (!milestoneMatch) continue;

    const number = parseInt(milestoneMatch[2] ?? "0", 10);
    const slug = entry;

    const { name, statusOverride } = readMilestoneMeta(fullPath, entry);
    const { specs, broken } = readSpecs(fullPath, slug, trackerRoot);

    const verified = specs.reduce((sum, s) => sum + s.view.verifiedCount, 0);
    const total = specs.reduce((sum, s) => sum + s.view.totalCount, 0);
    const status = deriveMilestoneStatus(specs, broken, statusOverride);

    milestones.push({
      slug,
      name,
      number,
      folderPath: fullPath,
      specs,
      brokenSpecs: broken,
      verified,
      total,
      status,
    });
  }

  return milestones;
}

function readMilestoneMeta(
  folderPath: string,
  fallback: string,
): { name: string; statusOverride: MilestoneStatus | null } {
  const readmePath = join(folderPath, "00-README.md");
  if (!existsSync(readmePath)) return { name: fallback, statusOverride: null };
  const raw = readFileSync(readmePath, "utf-8");
  const { data } = parseFrontmatter(raw);
  const name = typeof data["name"] === "string" ? (data["name"] as string) : fallback;
  const rawStatus = typeof data["status"] === "string" ? (data["status"] as string) : null;
  const statusOverride = parseMilestoneStatusOverride(rawStatus, readmePath);
  return { name, statusOverride };
}

function parseMilestoneStatusOverride(raw: string | null, source: string): MilestoneStatus | null {
  if (raw === null) return null;
  const normalized = raw.trim();
  switch (normalized) {
    case "Deferred":
      return "Deferred";
    case "Skipped":
      return "Skipped";
    case "Complete":
      return "Complete";
    case "Closed":
      return "Closed";
    // Non-terminal values are valid frontmatter but never override the
    // status computed from spec states.
    case "Not Started":
    case "In Progress":
    case "Blocked":
      return null;
    default:
      process.stderr.write(
        `tracker: warning: unrecognized milestone status "${normalized}" in ${source} — ` +
          `ignoring override (recognized terminal values: Complete, Skipped, Deferred, Closed)\n`,
      );
      return null;
  }
}

function readArchivedMilestones(trackerRoot: string): ArchivedMilestoneEntry[] {
  const archiveDir = join(trackerRoot, "archive");
  if (!existsSync(archiveDir)) return [];

  const archived: ArchivedMilestoneEntry[] = [];
  for (const entry of readdirSync(archiveDir).sort()) {
    if (!entry.endsWith(".md")) continue;
    const fullPath = join(archiveDir, entry);
    if (!statSync(fullPath).isFile()) continue;

    const raw = readFileSync(fullPath, "utf-8");
    const { data, content } = parseFrontmatter(raw);

    const stem = basename(entry, ".md");
    const slug = typeof data["slug"] === "string" ? (data["slug"] as string) : stem;
    const heading = /^#\s+(.+)$/m.exec(content)?.[1]?.trim() ?? null;
    const name = typeof data["name"] === "string" ? (data["name"] as string) : (heading ?? slug);
    const archivedDate =
      typeof data["archived"] === "string"
        ? (data["archived"] as string)
        : typeof data["completed"] === "string"
          ? (data["completed"] as string)
          : null;

    archived.push({ slug, name, archivedDate, file: `archive/${entry}` });
  }
  return archived;
}

/**
 * Read all ritual definitions under rituals/<slug>/ritual.md. Returns raw
 * fields only — due-ness ("is it due today?") is computed by the consumer with
 * a `today` value so this reader stays deterministic and clock-free.
 */
function readRituals(trackerRoot: string): RitualRecord[] {
  const ritualsDir = join(trackerRoot, "rituals");
  if (!existsSync(ritualsDir)) return [];

  const rituals: RitualRecord[] = [];
  for (const entry of readdirSync(ritualsDir).sort()) {
    const dir = join(ritualsDir, entry);
    if (!statSync(dir).isDirectory()) continue;
    const ritualPath = join(dir, "ritual.md");
    if (!existsSync(ritualPath)) continue;

    const { data } = parseFrontmatter(readFileSync(ritualPath, "utf-8"));
    const slug = nonEmptyString(data["slug"]) ?? entry;
    const name = nonEmptyString(data["name"]) ?? slug;
    const cadence = nonEmptyString(data["cadence"]);
    const due = nonEmptyString(data["due"]);
    const lastRun = nonEmptyString(data["last_run"]);
    const runsCount = countRunFiles(join(dir, "runs"));

    rituals.push({ slug, name, cadence, due, lastRun, runsCount, dir });
  }
  return rituals;
}

function nonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function countRunFiles(runsDir: string): number {
  if (!existsSync(runsDir)) return 0;
  return readdirSync(runsDir).filter(
    (f) => f.endsWith(".md") && !f.startsWith("_"),
  ).length;
}

/**
 * Read all vigil definitions under vigils/<slug>.md (flat — one file per vigil).
 * Underscore-prefixed files are skipped. Returns raw fields only — due-ness and
 * open/closed grouping are computed by the consumer with a `today` value so this
 * reader stays deterministic and clock-free.
 */
function readVigils(trackerRoot: string): VigilRecord[] {
  const vigilsDir = join(trackerRoot, "vigils");
  if (!existsSync(vigilsDir)) return [];

  const vigils: VigilRecord[] = [];
  for (const entry of readdirSync(vigilsDir).sort()) {
    if (!entry.endsWith(".md")) continue;
    if (entry.startsWith("_")) continue;
    const path = join(vigilsDir, entry);
    if (!statSync(path).isFile()) continue;

    const { data } = parseFrontmatter(readFileSync(path, "utf-8"));
    const slug = nonEmptyString(data["slug"]) ?? basename(entry, ".md");
    const name = nonEmptyString(data["name"]) ?? slug;
    const due = nonEmptyString(data["due"]);
    const until = nonEmptyString(data["until"]);
    const from = nonEmptyString(data["from"]);
    const agent = nonEmptyString(data["agent"]);
    const opened = nonEmptyString(data["opened"]);
    const resolved = nonEmptyString(data["resolved"]);
    const verdict = nonEmptyString(data["verdict"]);

    vigils.push({ slug, name, due, until, from, agent, opened, resolved, verdict, path });
  }
  return vigils;
}

function readSpecs(
  folderPath: string,
  milestoneSlug: string,
  trackerRoot: string,
): { specs: SpecEntry[]; broken: BrokenSpecEntry[] } {
  const entries = readdirSync(folderPath).sort();
  const specs: SpecEntry[] = [];
  const broken: BrokenSpecEntry[] = [];

  for (const entry of entries) {
    // Skip README and non-.md files; skip _counsel directory
    if (!entry.endsWith(".md")) continue;
    if (entry === "00-README.md") continue;

    const absolutePath = join(folderPath, entry);
    const relativePath = relative(join(trackerRoot, ".."), absolutePath);
    const raw = readFileSync(absolutePath, "utf-8");

    try {
      const view = parseSpec(raw, absolutePath);
      specs.push({
        file: entry,
        absolutePath,
        relativePath,
        milestoneSlug,
        view,
        // Will be filled in by resolveDependencies
        effectiveStatus: view.computedStatus,
      });
    } catch (err) {
      // Don't silently drop unparseable specs — a spec that fails to parse
      // still has real (unknown) state, and a milestone must not be able to
      // report "Complete" while one of its specs was never counted.
      const message = err instanceof Error ? err.message : String(err);
      broken.push({ file: entry, absolutePath, relativePath, error: message.split("\n")[0]! });
    }
  }

  return { specs, broken };
}

/**
 * After all specs are loaded, resolve "Waiting" status for specs whose
 * depends_on list contains specs that are not yet Complete.
 */
function resolveDependencies(milestones: MilestoneEntry[]): void {
  // Build a map from multiple path formats to computed status.
  // Supports:
  //   - ".tracker/M2-tracker-cli-refactor/01-schema-and-parser.md"  (M2 format)
  //   - "M1-design-overhaul-benchmark/01-research-recent-plugin-commits.md"  (M1 format)
  //   - "01-research-recent-plugin-commits.md"  (file name only)
  const statusMap = new Map<string, SpecStatusType>();

  for (const milestone of milestones) {
    for (const spec of milestone.specs) {
      // Register all path variants
      const rel = spec.relativePath.replace(/^\.\//, "");
      statusMap.set(rel, spec.view.computedStatus);

      // Also register "milestone/file" and "file" variants
      statusMap.set(`${milestone.slug}/${spec.file}`, spec.view.computedStatus);
      statusMap.set(spec.file, spec.view.computedStatus);
    }
  }

  // Now apply waiting status
  for (const milestone of milestones) {
    for (const spec of milestone.specs) {
      const depsOn = spec.view.depends_on ?? [];
      if (depsOn.length === 0) continue;

      // Check if any dependency is not Complete
      const unmetDeps = depsOn.filter((dep) => {
        const normalized = dep.replace(/^\.\//, "");
        // Try exact match first, then basename-only match
        const depStatus =
          statusMap.get(normalized) ??
          statusMap.get(basename(normalized));
        // If dep status is unknown, treat as unmet
        return depStatus !== "Complete";
      });

      if (unmetDeps.length > 0) {
        spec.effectiveStatus = "Waiting";
      }
    }
  }
}

function deriveMilestoneStatus(
  specs: SpecEntry[],
  broken: BrokenSpecEntry[],
  override: MilestoneStatus | null,
): MilestoneStatus {
  // README `status:` override always wins — it captures human intent
  // (e.g. closing a milestone as Deferred when investigation surfaces
  // that the originally-scoped work isn't warranted).
  if (override !== null) return override;

  if (specs.length === 0 && broken.length === 0) return "Not Started";

  const isTerminal = (s: SpecEntry): boolean =>
    s.view.computedStatus === "Complete" || s.view.computedStatus === "Skipped";

  // A broken spec's real state is unknown — never let a milestone read as
  // "Complete" (or "Skipped") while one exists, no matter how the specs
  // that DID parse look.
  const allTerminal = specs.length > 0 && broken.length === 0 && specs.every(isTerminal);
  if (allTerminal) {
    const anyComplete = specs.some((s) => s.view.computedStatus === "Complete");
    return anyComplete ? "Complete" : "Skipped";
  }

  const anyProgress =
    broken.length > 0 ||
    specs.some(
      (s) =>
        s.view.computedStatus === "In Progress" ||
        s.view.computedStatus === "Blocked" ||
        s.view.verifiedCount > 0,
    );
  if (anyProgress) return "In Progress";

  return "Not Started";
}

// ---------------------------------------------------------------------------
// Status output formatter (matches SKILL.md template exactly)
// ---------------------------------------------------------------------------

/**
 * Format the tracker status dashboard as a markdown string.
 * Output must match the SKILL.md template exactly.
 */
export function formatTrackerStatus(state: TrackerState): string {
  const lines: string[] = [];

  lines.push(`# ${state.projectName} — Tracker Status`);
  lines.push("");

  // Active Milestones / Progress Dashboard table
  // Note: "Progress Dashboard" satisfies the status verification check
  lines.push("## Progress Dashboard");
  lines.push("");
  lines.push("| # | Milestone | Progress | Done | Status |");
  lines.push("|----|-----------|----------|------|--------|");

  for (const m of state.milestones) {
    const bar = progressBar(m.verified, m.total);
    const pct = progressPct(m.verified, m.total);
    const num = `M${m.number}`;
    lines.push(`| ${num} | ${m.name} | ${bar} ${pct}% | ${m.verified}/${m.total} | ${m.status} |`);
  }

  lines.push("");

  // Current Focus: first non-terminal milestone (Complete/Skipped/Deferred are done)
  const focusMilestone = state.milestones.find((m) => !isTerminalMilestone(m.status));

  if (!focusMilestone) {
    lines.push("## All milestones complete");
    lines.push("");
  } else {
    lines.push(`## Current Focus: M${focusMilestone.number} — ${focusMilestone.name}`);
    lines.push("");
    lines.push("| Spec | Done | Status |");
    lines.push("|------|------|--------|");

    for (const spec of focusMilestone.specs) {
      const statusCell = formatSpecStatusCell(spec);
      lines.push(
        `| ${spec.file} | ${spec.view.verifiedCount}/${spec.view.totalCount} | ${statusCell} |`,
      );
    }

    lines.push("");

    // Next task: first [ ] or [~] in focus milestone where spec is not Waiting
    const nextTask = findNextTask(focusMilestone);
    if (nextTask) {
      lines.push(`**Next task:** [ ] ${nextTask.label} (${nextTask.file})`);
    } else {
      lines.push("All tasks complete — ready for next milestone");
    }
    lines.push("");
  }

  // Active Work section: omitted (spec 04 will add worklog support)

  // Blockers
  lines.push("## Blockers");
  lines.push("");
  const blockers = collectBlockers(state);
  if (blockers.length === 0) {
    lines.push("None");
  } else {
    for (const b of blockers) {
      lines.push(`- ${b.label} (${b.file})`);
    }
  }
  lines.push("");

  // Broken specs — only rendered when non-empty, so trackers with none see
  // no change in output. This is the visible half of the "never silently
  // drop an unparseable spec" fix: it can't hide behind a milestone that
  // otherwise looks Complete, because deriveMilestoneStatus won't report
  // Complete while any of these exist.
  const broken = collectBrokenSpecs(state);
  if (broken.length > 0) {
    lines.push("## ⚠ Broken Specs (excluded from counts above)");
    lines.push("");
    for (const b of broken) {
      lines.push(`- **${b.file}** (${b.milestoneSlug}): ${b.error}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** Flatten every milestone's brokenSpecs into one list, in milestone order. */
export function collectBrokenSpecs(state: TrackerState): BrokenSpecSummary[] {
  const result: BrokenSpecSummary[] = [];
  for (const milestone of state.milestones) {
    for (const b of milestone.brokenSpecs) {
      result.push({ milestoneSlug: milestone.slug, file: b.file, error: b.error });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

function progressBar(verified: number, total: number): string {
  if (total === 0) return "░░░░░░░░░░";
  const fraction = verified / total;
  // Round to nearest 10%
  const filled = Math.round(fraction * 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

function progressPct(verified: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((verified / total) * 10) * 10;
}

// ---------------------------------------------------------------------------
// Spec status cell formatting
// ---------------------------------------------------------------------------

function formatSpecStatusCell(spec: SpecEntry): string {
  if (spec.effectiveStatus === "Waiting") {
    // Find unmet deps
    const depsOn = spec.view.depends_on ?? [];
    const unmetDep = depsOn[0] ?? "";
    const depFile = basename(unmetDep);
    return `Waiting (waiting on: ${depFile})`;
  }
  return spec.view.computedStatus;
}

// ---------------------------------------------------------------------------
// Next task finder
// ---------------------------------------------------------------------------

type NextTask = {
  label: string;
  file: string;
};

function findNextTask(milestone: MilestoneEntry): NextTask | null {
  for (const spec of milestone.specs) {
    if (spec.effectiveStatus === "Waiting") continue;
    if (spec.view.computedStatus === "Complete") continue;
    if (spec.view.computedStatus === "Skipped") continue;

    for (const item of spec.view.checklistItems) {
      if (item.state === "pending" || item.state === "in_progress") {
        return { label: item.label, file: spec.file };
      }
    }
  }
  return null;
}

export function isTerminalMilestone(status: MilestoneStatus): boolean {
  return (
    status === "Complete" ||
    status === "Skipped" ||
    status === "Deferred" ||
    status === "Closed"
  );
}

// ---------------------------------------------------------------------------
// Blockers collector
// ---------------------------------------------------------------------------

type Blocker = {
  label: string;
  file: string;
};

function collectBlockers(state: TrackerState): Blocker[] {
  const blockers: Blocker[] = [];
  for (const milestone of state.milestones) {
    for (const spec of milestone.specs) {
      for (const item of spec.view.checklistItems) {
        if (item.state === "blocked") {
          blockers.push({ label: item.label, file: spec.file });
        }
      }
    }
  }
  return blockers;
}
