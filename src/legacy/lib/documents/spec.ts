/**
 * Spec document types and parsers — no external dependencies.
 *
 * SpecInput  — fields on disk (human-authored front-matter + body)
 * SpecView   — SpecInput + derived status / verified count
 * SpecJSON   — CLI --json output consumed by skills
 *
 * Legacy front-matter fields (`status`, `verified`) are tolerated via
 * passthrough so existing files are NOT rejected. They will be stripped
 * by the spec-07 migration.
 */

import { parseFrontmatter, serializeFrontmatter } from "../markdown/frontmatter.ts";
import { parseChecklist, type ChecklistItem } from "../markdown/checklist.ts";
import { canonicalize } from "../markdown/canonical.ts";
import { TrackerValidationError } from "../markdown/errors.ts";

// ---------------------------------------------------------------------------
// Ground Truth scaffold
// ---------------------------------------------------------------------------

/**
 * The exact placeholder comment `tracker add spec` scaffolds into every new
 * spec's `## Ground Truth` section.
 *
 * It is a single literal shared by three places so they can never drift:
 *   1. the spec templates (`templates/spec-*.md`) that addSpec copies,
 *   2. `tracker doctor`, which warns while the placeholder is still present,
 *   3. the tests that assert 1 and 2 agree.
 *
 * Presence of this exact string means the section was scaffolded and never
 * filled in. Legacy specs (authored before the scaffold existed) never contain
 * it, so doctor stays quiet on them.
 */
export const GROUND_TRUTH_PLACEHOLDER =
  '<!-- REQUIRED before scoping: files read first-hand, commands run, findings with file:line. If claiming "X does not exist", name the search that failed AND the most likely home of X. -->';

/** Heading of the section the placeholder lives under. */
export const GROUND_TRUTH_HEADING = "## Ground Truth";

// ---------------------------------------------------------------------------
// SpecInput interface + validator
// ---------------------------------------------------------------------------

export interface SpecInput {
  agent?: string;
  counsel?: string;
  depends_on?: string[];
  template?: string;
  updated?: string;
  /** passthrough: any additional unknown fields are allowed */
  [key: string]: unknown;
}

function isStringOrUndefined(v: unknown): v is string | undefined {
  return v === undefined || typeof v === "string";
}

function isStringArrayOrUndefined(v: unknown): v is string[] | undefined {
  if (v === undefined) return true;
  if (!Array.isArray(v)) return false;
  return v.every((item) => typeof item === "string");
}

/**
 * Validate that raw frontmatter data conforms to SpecInput.
 * Throws TrackerValidationError on invalid field types.
 * Unknown extra fields are tolerated (passthrough).
 */
function validateSpecInput(
  data: Record<string, unknown>,
  sourcePath?: string,
): SpecInput {
  if (!isStringOrUndefined(data["agent"])) {
    throw new TrackerValidationError({
      path: "agent",
      expected: "string",
      actual: typeof data["agent"],
      sourcePath,
    });
  }
  if (!isStringOrUndefined(data["counsel"])) {
    throw new TrackerValidationError({
      path: "counsel",
      expected: "string",
      actual: typeof data["counsel"],
      sourcePath,
    });
  }
  if (!isStringArrayOrUndefined(data["depends_on"])) {
    throw new TrackerValidationError({
      path: "depends_on",
      expected: "string[]",
      actual: Array.isArray(data["depends_on"]) ? "array with non-string elements" : typeof data["depends_on"],
      sourcePath,
    });
  }
  if (!isStringOrUndefined(data["template"])) {
    throw new TrackerValidationError({
      path: "template",
      expected: "string",
      actual: typeof data["template"],
      sourcePath,
    });
  }
  if (!isStringOrUndefined(data["updated"])) {
    throw new TrackerValidationError({
      path: "updated",
      expected: "string",
      actual: typeof data["updated"],
      sourcePath,
    });
  }

  // Return with all original fields (passthrough)
  return data as SpecInput;
}

/**
 * SpecInputSchema-compatible API shim for code that calls .safeParse() / .parse().
 * Used by doctor.ts and other callers that still use schema-style calls.
 */
export const SpecInputSchema = {
  safeParse(data: unknown): { success: true; data: SpecInput } | { success: false; error: { message: string } } {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return { success: false, error: { message: "Expected an object" } };
    }
    try {
      const result = validateSpecInput(data as Record<string, unknown>);
      return { success: true, data: result };
    } catch (err) {
      return {
        success: false,
        error: { message: err instanceof Error ? err.message : String(err) },
      };
    }
  },

  parse(data: unknown): SpecInput {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new TrackerValidationError({
        path: "(root)",
        expected: "object",
        actual: Array.isArray(data) ? "array" : typeof data,
      });
    }
    return validateSpecInput(data as Record<string, unknown>);
  },
};

// ---------------------------------------------------------------------------
// SpecView interface
// ---------------------------------------------------------------------------

export type SpecStatusType =
  | "Not Started"
  | "In Progress"
  | "Complete"
  | "Blocked"
  | "Skipped";

export interface SpecView extends SpecInput {
  /** Computed from checklist: how many items are checked */
  verifiedCount: number;
  /** Computed from checklist: how many items are intentionally skipped (`[-]`) */
  skippedCount: number;
  /** Computed from checklist: how many items are blocked (`[!]`) */
  blockedCount: number;
  /** Computed from checklist: how many items are actively in progress (`[~]`) */
  inProgressCount: number;
  /** Total number of checklist items */
  totalCount: number;
  /** Derived status — never stored on disk */
  computedStatus: SpecStatusType;
  /** The document title (first H1 heading) */
  title: string;
  /** Parsed checklist items */
  checklistItems: ChecklistItem[];
  /** Raw body content (after front-matter), stored for round-trip use */
  rawContent: string;
}

// ---------------------------------------------------------------------------
// SpecJSON interface + validator
// ---------------------------------------------------------------------------

export interface SpecTask {
  index: number;
  checked: boolean;
  /** Item state — mirrors the checkbox marker ([ ], [x], [~], [!], [-]). */
  state: "pending" | "verified" | "in_progress" | "skipped" | "blocked";
  label: string;
  command: string | null;
  expected: string | null;
}

export interface SpecJSON {
  path: string;
  title: string;
  status: SpecStatusType;
  verified: number;
  total: number;
  tasks: SpecTask[];
  /** Additional front-matter fields (passthrough) */
  meta: Record<string, unknown>;
}

const VALID_STATUSES: SpecStatusType[] = [
  "Not Started",
  "In Progress",
  "Complete",
  "Blocked",
  "Skipped",
];

function isValidStatus(v: unknown): v is SpecStatusType {
  return typeof v === "string" && (VALID_STATUSES as string[]).includes(v);
}

/**
 * SpecJSONSchema-compatible API shim for code that calls .safeParse().
 */
export const SpecJSONSchema = {
  parse(data: unknown): SpecJSON {
    const result = SpecJSONSchema.safeParse(data);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  },

  safeParse(
    data: unknown,
  ): { success: true; data: SpecJSON } | { success: false; error: { message: string } } {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return { success: false, error: { message: "Expected an object" } };
    }
    const d = data as Record<string, unknown>;

    if (typeof d["path"] !== "string") {
      return { success: false, error: { message: "path: expected string" } };
    }
    if (typeof d["title"] !== "string") {
      return { success: false, error: { message: "title: expected string" } };
    }
    if (!isValidStatus(d["status"])) {
      return { success: false, error: { message: `status: must be one of ${VALID_STATUSES.join(", ")}` } };
    }
    if (typeof d["verified"] !== "number" || !Number.isInteger(d["verified"]) || d["verified"] < 0) {
      return { success: false, error: { message: "verified: expected non-negative integer" } };
    }
    if (typeof d["total"] !== "number" || !Number.isInteger(d["total"]) || d["total"] < 0) {
      return { success: false, error: { message: "total: expected non-negative integer" } };
    }
    if (!Array.isArray(d["tasks"])) {
      return { success: false, error: { message: "tasks: expected array" } };
    }
    if (typeof d["meta"] !== "object" || d["meta"] === null || Array.isArray(d["meta"])) {
      return { success: false, error: { message: "meta: expected object" } };
    }

    return {
      success: true,
      data: d as unknown as SpecJSON,
    };
  },
};

// ---------------------------------------------------------------------------
// Parse / serialize helpers
// ---------------------------------------------------------------------------

/**
 * Parse a raw spec file string and produce a validated SpecView.
 * Throws a TrackerValidationError on schema violation.
 */
export function parseSpec(raw: string, filePath: string | null = null): SpecView {
  const { data, content } = parseFrontmatter(raw);

  const fm = validateSpecInput(data, filePath ?? undefined);
  const title = extractTitle(content);
  const checklistItems = parseChecklist(content);
  const verifiedCount = checklistItems.filter((i) => i.state === "verified").length;
  const skippedCount = checklistItems.filter((i) => i.state === "skipped").length;
  const blockedCount = checklistItems.filter((i) => i.state === "blocked").length;
  const inProgressCount = checklistItems.filter((i) => i.state === "in_progress").length;
  const totalCount = checklistItems.length;
  const computedStatus = deriveStatus(checklistItems);

  const view: SpecView = {
    ...fm,
    verifiedCount,
    skippedCount,
    blockedCount,
    inProgressCount,
    totalCount,
    computedStatus,
    title,
    checklistItems,
    rawContent: content,
  };

  return view;
}

/**
 * Serialize a SpecView back to a canonical markdown string.
 *
 * Derived fields (verifiedCount, totalCount, computedStatus, title,
 * checklistItems, rawContent) are stripped from front-matter — they are
 * computed or already live in the body.
 */
export function serializeSpec(view: SpecView): string {
  const {
    verifiedCount: _v,
    skippedCount: _sk,
    blockedCount: _bl,
    inProgressCount: _ip,
    totalCount: _t,
    computedStatus: _s,
    title: _ti,
    checklistItems: _ci,
    rawContent,
    ...frontmatterFields
  } = view;

  return canonicalize(
    serializeFrontmatter(frontmatterFields as Record<string, unknown>, rawContent),
  );
}

/**
 * Convert a SpecView into the SpecJSON shape for CLI --json output.
 */
export function toSpecJSON(view: SpecView, filePath: string): SpecJSON {
  const {
    verifiedCount,
    totalCount,
    computedStatus,
    title,
    checklistItems,
    agent: _a,
    counsel: _c,
    depends_on: _d,
    template: _tm,
    updated: _u,
    rawContent: _r,
    ...rest
  } = view as SpecView & { rawContent?: unknown };

  // Remove derived/internal fields from meta
  const meta = rest as Record<string, unknown>;
  delete meta["verifiedCount"];
  delete meta["skippedCount"];
  delete meta["blockedCount"];
  delete meta["inProgressCount"];
  delete meta["totalCount"];
  delete meta["computedStatus"];

  return {
    path: filePath,
    title,
    status: computedStatus,
    verified: verifiedCount,
    total: totalCount,
    tasks: checklistItems,
    meta,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractTitle(content: string): string {
  const lines = content.split("\n");
  for (const line of lines) {
    const match = /^#\s+(.+)$/.exec(line.trim());
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return "(untitled)";
}

/**
 * Derive a spec's status from its checklist markers.
 *
 * This is THE definition of a spec's status — frontmatter `status:` is
 * passthrough-only and never read back. Exported so the write path
 * (`tracker-writer.ts`) can sync a legacy `status:` field to the same value it
 * would compute on read, instead of leaving the two disagreeing.
 */
export function deriveStatus(items: ChecklistItem[]): SpecStatusType {
  if (items.length === 0) return "Not Started";

  let pending = 0;
  let verified = 0;
  let skipped = 0;
  let inProgress = 0;
  let blocked = 0;
  for (const item of items) {
    if (item.state === "verified") verified++;
    else if (item.state === "skipped") skipped++;
    else if (item.state === "in_progress") inProgress++;
    else if (item.state === "blocked") blocked++;
    else pending++;
  }

  // Terminal: every item is either verified or skipped.
  if (pending === 0 && inProgress === 0 && blocked === 0) {
    if (verified === 0) return "Skipped";
    return "Complete";
  }

  if (blocked > 0) return "Blocked";
  if (verified > 0 || inProgress > 0) return "In Progress";
  return "Not Started";
}
