/**
 * Vigil document types and parser — no external dependencies.
 *
 * A vigil (`vigils/<slug>.md`) is a ONE-SHOT pending verification: work already
 * shipped, but it isn't truly closed until a future check confirms it held. The
 * classic flavor is a "soak" — shipped code observing its first real-world
 * exposure. A vigil is the one-shot sibling of a ritual: it shares the same
 * due-date gating machinery, but instead of rolling forward forever it
 * TERMINATES with a verdict (`held` | `failed`).
 *
 * Mirrors the ritual document module: an Input interface, a plain validator,
 * and a schema-compatible shim. Unknown fields pass through. The throwing
 * semantic validators (slug rules, at-least-one-gate, verdict enum) live here so
 * the writer can enforce them at creation/close time.
 */

import { parseFrontmatter } from "../markdown/frontmatter.ts";
import { TrackerValidationError } from "../markdown/errors.ts";

// ---------------------------------------------------------------------------
// Verdict enum
// ---------------------------------------------------------------------------

export type VigilVerdict = "held" | "failed";

export const VIGIL_VERDICTS: readonly VigilVerdict[] = ["held", "failed"];

export function isVigilVerdict(v: string): v is VigilVerdict {
  return (VIGIL_VERDICTS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// VigilInput interface + validator
// ---------------------------------------------------------------------------

export interface VigilInput {
  type?: string;
  name?: string;
  slug?: string;
  /** Optional date gate (ISO YYYY-MM-DD), "" when absent. */
  due?: string;
  /** Optional event gate (free prose), "" when absent. */
  until?: string;
  /** Optional provenance pointer (free text, e.g. "M77/S02"). */
  from?: string;
  agent?: string;
  opened?: string;
  resolved?: string;
  verdict?: string;
  /** passthrough: any additional unknown fields are allowed */
  [key: string]: unknown;
}

const VIGIL_STRING_FIELDS = [
  "type",
  "name",
  "slug",
  "due",
  "until",
  "from",
  "agent",
  "opened",
  "resolved",
  "verdict",
] as const;

/**
 * Validate and parse vigil frontmatter data (plain type checks only).
 * All fields are optional; unknown fields are tolerated (passthrough).
 * Semantic rules (gate presence, verdict enum) are enforced by the throwing
 * validators below at creation/close time, not on every read.
 */
export function validateVigilInput(
  data: Record<string, unknown>,
  sourcePath?: string,
): VigilInput {
  for (const field of VIGIL_STRING_FIELDS) {
    const v = data[field];
    if (v !== undefined && typeof v !== "string") {
      throw new TrackerValidationError({
        path: field,
        expected: "string",
        actual: typeof v,
        sourcePath,
      });
    }
  }
  return data as VigilInput;
}

export const VigilInputSchema = {
  safeParse(
    data: unknown,
  ): { success: true; data: VigilInput } | { success: false; error: { message: string } } {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return { success: false, error: { message: "Expected an object" } };
    }
    try {
      const result = validateVigilInput(data as Record<string, unknown>);
      return { success: true, data: result };
    } catch (err) {
      return {
        success: false,
        error: { message: err instanceof Error ? err.message : String(err) },
      };
    }
  },

  parse(data: unknown): VigilInput {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new TrackerValidationError({
        path: "(root)",
        expected: "object",
        actual: Array.isArray(data) ? "array" : typeof data,
      });
    }
    return validateVigilInput(data as Record<string, unknown>);
  },
};

// ---------------------------------------------------------------------------
// Semantic validators (throwing) — used by the writer
// ---------------------------------------------------------------------------

/**
 * Slug rules: lowercase kebab-case identifier that is filesystem-safe, since the
 * slug becomes the vigil's filename (`vigils/<slug>.md`). Must start with an
 * alphanumeric and contain only lowercase letters, digits, and hyphens.
 */
const VIGIL_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export function isValidVigilSlug(slug: string): boolean {
  return VIGIL_SLUG_RE.test(slug);
}

export function assertValidVigilSlug(slug: string): void {
  if (!isValidVigilSlug(slug)) {
    throw new Error(
      `Invalid slug: "${slug}" (expected lowercase kebab-case: a-z, 0-9, hyphens)`,
    );
  }
}

/**
 * A vigil needs a gate: at least one of `due` (date) or `until` (event) must be
 * present. Without a gate there is nothing to wait on and the vigil could never
 * surface in the due queue.
 */
export function assertVigilHasGate(
  due: string | undefined,
  until: string | undefined,
): void {
  const hasDue = typeof due === "string" && due.trim() !== "";
  const hasUntil = typeof until === "string" && until.trim() !== "";
  if (!hasDue && !hasUntil) {
    throw new Error(
      'A vigil needs a gate: provide --due <YYYY-MM-DD> and/or --until "<event>"',
    );
  }
}

export function assertValidVerdict(verdict: string): asserts verdict is VigilVerdict {
  if (!isVigilVerdict(verdict)) {
    throw new Error(`Invalid verdict: "${verdict}" (expected held or failed)`);
  }
}

// ---------------------------------------------------------------------------
// Parse helper
// ---------------------------------------------------------------------------

export type VigilDoc = {
  input: VigilInput;
  /** First H1 heading, or "(untitled)" */
  title: string;
  /** Markdown body after the frontmatter (the checklist you work when it fires) */
  content: string;
};

/**
 * Parse a raw vigil.md string into validated frontmatter + body.
 * Throws TrackerValidationError on a frontmatter type violation.
 */
export function parseVigil(raw: string, filePath: string | null = null): VigilDoc {
  const { data, content } = parseFrontmatter(raw);
  const input = validateVigilInput(data, filePath ?? undefined);
  const title = extractTitle(content);
  return { input, title, content };
}

function extractTitle(content: string): string {
  for (const line of content.split("\n")) {
    const match = /^#\s+(.+)$/.exec(line.trim());
    if (match?.[1]) return match[1].trim();
  }
  return "(untitled)";
}
