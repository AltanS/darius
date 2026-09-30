/**
 * Vigil health — is an armed vigil actually workable? (M315/07)
 *
 * A vigil is a one-shot pending verification: shipped work waiting on a future
 * check. Two failure modes made vigils accumulate as permanent "due" noise in
 * this estate, both measured first-hand on 2026-09-02 across 48 open vigils:
 *
 * 1. **Unrunnable.** The vigil's checklist carries no executable `Command:` —
 *    usually the scaffold's `echo todo`, still there weeks later. 23 of 48.
 *    Nothing can ever answer it, so it can never close. This is a FAILURE.
 *
 * 2. **Premise unshipped.** The vigil guards a spec at 0 verified items whose
 *    milestone README carries no deploy line — a line naming a deploy AND a sha
 *    or a date, not prose about deploying. Four of 48. A soak over work
 *    that never shipped observes nothing. This is a WARNING, not a failure —
 *    arming a vigil the same hour a deploy lands, before `verify` has caught
 *    up, is legitimate.
 *
 * This module is the single reader for both questions. `doctor`, `vigil add`
 * and `archive-check` all consume it, so they cannot disagree about what
 * "unrunnable" means.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { parseFrontmatter } from "./markdown/frontmatter.ts";
import { parseChecklist } from "./markdown/checklist.ts";
import { isTrivialCommand } from "./verification/runner.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VigilHealth = {
  /** Slug from frontmatter, falling back to the filename. */
  slug: string;
  /** Absolute path to the vigil file. */
  file: string;
  /** Armed = no terminal verdict yet. */
  armed: boolean;
  /** Raw `from:` provenance pointer, or null. */
  from: string | null;
  /** Total `Command:` lines found in the vigil body. */
  commandCount: number;
  /** Commands that would actually run (non-empty and not a shell no-op). */
  executableCount: number;
  /** Milestone folder the `from:` pointer names, when one exists on disk. */
  milestoneDir: string | null;
  /** Spec file the `from:` pointer names, when it resolves to a real file. */
  fromSpecPath: string | null;
  /** Verified checklist items in that spec (null when the spec did not resolve). */
  fromSpecVerified: number | null;
  /** Whether that milestone's 00-README.md carries a real deploy line (verb + sha or date). */
  milestoneMentionsDeploy: boolean;
  /** Whether any `Command:` line looks expensive enough to skip on the daily sweep. */
  hasHeavyCommand: boolean;
};

/** An armed vigil nobody can ever work: no executable `Command:` anywhere. */
export function isUnrunnable(v: VigilHealth): boolean {
  return v.armed && v.executableCount === 0;
}

/** An armed vigil guarding a spec with nothing verified and no deploy on record. */
export function isPremiseUnshipped(v: VigilHealth): boolean {
  return (
    v.armed &&
    v.fromSpecPath !== null &&
    v.fromSpecVerified === 0 &&
    !v.milestoneMentionsDeploy
  );
}

/**
 * A vigil `Command:` that `fc vigil-sweep` treats as heavy — a toolbox
 * container spin-up, a full evaluation run, a bounded-`--runs` batch, or a
 * discovery/check sub-invocation of the `fc` CLI. The daily sweep skips these
 * unless run with `--include-heavy`, so an armed vigil carrying one waits
 * longer than its `until`/`due` gate implies.
 */
const HEAVY_COMMAND_RE = /\btoolbox run\b|\beval-|--runs\b|\bfc\s+discover\b|\bfc\s+check\b/;

/** An armed vigil whose only reads happen via the daily `fc vigil-sweep`. */
export function isHeavyCommand(v: VigilHealth): boolean {
  return v.armed && v.hasHeavyCommand;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Absolute paths of every live vigil file.
 *
 * `.tracker/vigils/` only — `.tracker/archive/vigils/` holds closed provenance
 * records and must never be re-litigated.
 */
export function listVigilFiles(trackerRoot: string): string[] {
  const dir = join(trackerRoot, "vigils");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .filter((entry) => entry.endsWith(".md") && !entry.startsWith("00-"))
    .map((entry) => join(dir, entry))
    .filter((p) => statSync(p).isFile());
}

/**
 * Count the `Command:` lines in a vigil body, and how many of them would
 * actually run.
 *
 * Exported because the WRITE path (`vigil add --stdin`, `vigil set-body`) has
 * to refuse exactly what `doctor` later fails on. Two counters that disagreed
 * would let the CLI write a vigil its own health check calls unrunnable — the
 * failure this module exists to end.
 */
export function countVigilCommands(body: string): {
  commandCount: number;
  executableCount: number;
} {
  let commandCount = 0;
  let executableCount = 0;
  for (const item of parseChecklist(body)) {
    if (item.command === null) continue;
    commandCount++;
    if (item.command.trim() === "") continue;
    if (isTrivialCommand(item.command)) continue;
    executableCount++;
  }
  return { commandCount, executableCount };
}

/** Does any `Command:` line in this body look heavy (see `HEAVY_COMMAND_RE`)? */
export function bodyHasHeavyCommand(body: string): boolean {
  for (const item of parseChecklist(body)) {
    if (item.command === null) continue;
    if (HEAVY_COMMAND_RE.test(item.command)) return true;
  }
  return false;
}

/**
 * Read one vigil and answer both health questions about it.
 *
 * Unparseable frontmatter is reported as an armed vigil with no commands rather
 * than thrown: doctor's schema checks own the parse error, and a vigil nobody
 * can parse is certainly not runnable.
 */
export function readVigilHealth(trackerRoot: string, file: string): VigilHealth {
  const raw = readFileSync(file, "utf-8");
  const fallbackSlug = basename(file, ".md");

  let data: Record<string, unknown> = {};
  let body = "";
  try {
    ({ data, content: body } = parseFrontmatter(raw));
  } catch {
    return {
      slug: fallbackSlug,
      file,
      armed: true,
      from: null,
      commandCount: 0,
      executableCount: 0,
      milestoneDir: null,
      fromSpecPath: null,
      fromSpecVerified: null,
      milestoneMentionsDeploy: false,
      hasHeavyCommand: false,
    };
  }

  const verdict = typeof data["verdict"] === "string" ? data["verdict"].trim() : "";
  const slugField = typeof data["slug"] === "string" ? data["slug"].trim() : "";
  const fromField = typeof data["from"] === "string" ? data["from"].trim() : "";

  const { commandCount, executableCount } = countVigilCommands(body);

  const milestoneDir = fromField === "" ? null : resolveFromMilestone(trackerRoot, fromField);
  const fromSpecPath = milestoneDir === null ? null : resolveFromSpec(milestoneDir, fromField);

  return {
    slug: slugField !== "" ? slugField : fallbackSlug,
    file,
    armed: verdict === "",
    from: fromField === "" ? null : fromField,
    commandCount,
    executableCount,
    milestoneDir,
    fromSpecPath,
    fromSpecVerified: fromSpecPath === null ? null : countVerified(fromSpecPath),
    milestoneMentionsDeploy: milestoneDir === null ? false : mentionsDeploy(milestoneDir),
    hasHeavyCommand: bodyHasHeavyCommand(body),
  };
}

/** Read every live vigil's health in filename order. */
export function readAllVigilHealth(trackerRoot: string): VigilHealth[] {
  return listVigilFiles(trackerRoot).map((f) => readVigilHealth(trackerRoot, f));
}

// ---------------------------------------------------------------------------
// `from:` resolution
// ---------------------------------------------------------------------------

/**
 * Milestone folder a `from:` pointer names, or null.
 *
 * `from:` is free text by design, and the shapes in this estate are
 * `M306/04`, `M296-factcheck-0824-upstream-defects/01`,
 * `M225-external-placement-clickouts/01-external-placement-flag.md`, bare
 * `M175`, and non-milestone pointers like `docs/architecture/plan.md`. Anything
 * that is not a milestone reference resolves to null and every caller skips it
 * silently — guessing at a pointer's meaning is how a health check starts
 * inventing findings.
 */
export function resolveFromMilestone(trackerRoot: string, from: string): string | null {
  const cleaned = from.trim().replace(/^["']|["']$/g, "");
  const head = (cleaned.split("/")[0] ?? "").trim();
  if (head === "") return null;
  if (!/^(M|DLP|ATH|BLD)\d+/.test(head)) return null;

  const exact = join(trackerRoot, head);
  if (existsSync(exact) && statSync(exact).isDirectory()) return exact;

  // `M306` → the `M306-…` folder. Anchored on the number so `M30` never
  // matches `M306-…`.
  const numberPrefix = /^((?:M|DLP|ATH|BLD)\d+)/.exec(head)?.[1];
  if (numberPrefix === undefined) return null;
  if (!existsSync(trackerRoot)) return null;

  for (const entry of readdirSync(trackerRoot).sort()) {
    if (!entry.startsWith(`${numberPrefix}-`)) continue;
    const full = join(trackerRoot, entry);
    if (statSync(full).isDirectory()) return full;
  }
  return null;
}

/**
 * Spec file a `from:` pointer names inside its milestone folder, or null when
 * the pointer stops at the milestone (`from: M175`) or names nothing on disk.
 *
 * Accepts `…/07`, `…/S07` and `…/07-full-file-name.md`.
 */
export function resolveFromSpec(milestoneDir: string, from: string): string | null {
  const cleaned = from.trim().replace(/^["']|["']$/g, "");
  const slashIndex = cleaned.indexOf("/");
  if (slashIndex === -1) return null;
  const rest = cleaned.slice(slashIndex + 1).trim();
  if (rest === "") return null;

  if (rest.endsWith(".md")) {
    const direct = join(milestoneDir, basename(rest));
    return existsSync(direct) ? direct : null;
  }

  const numeric = /^[sS]?(\d{1,3})$/.exec(rest)?.[1];
  if (numeric === undefined) return null;
  const padded = numeric.padStart(2, "0");
  if (!existsSync(milestoneDir)) return null;

  for (const entry of readdirSync(milestoneDir).sort()) {
    if (!entry.endsWith(".md")) continue;
    if (!entry.startsWith(`${padded}-`)) continue;
    return join(milestoneDir, entry);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function countVerified(specPath: string): number {
  let body: string;
  try {
    ({ content: body } = parseFrontmatter(readFileSync(specPath, "utf-8")));
  } catch {
    return 0;
  }
  return parseChecklist(body).filter((i) => i.state === "verified").length;
}

/**
 * Does the milestone README record an actual deploy?
 *
 * Substring-testing for the word "deploy" was a false negative on exactly the
 * case this rule exists for. Measured 2026-09-02: 11 vigils were re-pointed
 * from closed per-day milestones onto P-series specs at 0 ticks, and every one
 * of them went silent, because every P-series README carries the shared
 * Constraints paragraph "…a last-before-deploy item… only then deploy". Prose
 * ABOUT deploying is not a deploy.
 *
 * A deploy line must therefore carry evidence on the same line: a deploy verb
 * AND either a commit sha (7-40 hex) or an ISO date. "Deployed fa4e2e5a on
 * 2026-08-30" counts; "benchmark BEFORE and AFTER deploy" does not. Anything
 * looser suppresses the warning it was built to raise.
 */
const DEPLOY_VERB_RE = /\b(deployed|deploying|deploys|deploy|shipped|live on)\b/i;

/** A commit sha as written in prose — short (7) through full (40). */
const DEPLOY_SHA_RE = /\b[0-9a-f]{7,40}\b/;

/** An ISO calendar date, the other admissible form of deploy evidence. */
const DEPLOY_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/;

export function isDeployLine(line: string): boolean {
  if (!DEPLOY_VERB_RE.test(line)) return false;
  return DEPLOY_SHA_RE.test(line) || DEPLOY_DATE_RE.test(line);
}

function mentionsDeploy(milestoneDir: string): boolean {
  const readme = join(milestoneDir, "00-README.md");
  if (!existsSync(readme)) return false;
  try {
    return readFileSync(readme, "utf-8").split("\n").some(isDeployLine);
  } catch {
    return false;
  }
}
