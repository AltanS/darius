/**
 * Ritual document types and parser — no external dependencies.
 *
 * A ritual (`rituals/<slug>/ritual.md`) is the stable definition of recurring
 * work: a repeatable step template plus a `cadence` and a `due` date. Each
 * occurrence is a "run" (`rituals/<slug>/runs/<date>.md`) — an ordinary spec
 * the Work Loop ticks through. Rituals never reach a terminal "done" state;
 * they roll forward on completion (see lib/dates.ts).
 *
 * Mirrors the milestone document module: an Input interface, a plain validator,
 * and a schema-compatible shim. Unknown fields pass through.
 */

import { parseFrontmatter } from "../markdown/frontmatter.ts";
import { TrackerValidationError } from "../markdown/errors.ts";

// ---------------------------------------------------------------------------
// RitualInput interface + validator
// ---------------------------------------------------------------------------

export interface RitualInput {
  type?: string;
  name?: string;
  slug?: string;
  cadence?: string;
  due?: string;
  last_run?: string;
  agent?: string;
  owner?: string;
  started?: string;
  /** passthrough: any additional unknown fields are allowed */
  [key: string]: unknown;
}

const RITUAL_STRING_FIELDS = [
  "type",
  "name",
  "slug",
  "cadence",
  "due",
  "last_run",
  "agent",
  "owner",
  "started",
] as const;

/**
 * Validate and parse ritual frontmatter data.
 * All fields are optional; unknown fields are tolerated (passthrough).
 */
export function validateRitualInput(
  data: Record<string, unknown>,
  sourcePath?: string,
): RitualInput {
  for (const field of RITUAL_STRING_FIELDS) {
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
  return data as RitualInput;
}

export const RitualInputSchema = {
  safeParse(
    data: unknown,
  ): { success: true; data: RitualInput } | { success: false; error: { message: string } } {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return { success: false, error: { message: "Expected an object" } };
    }
    try {
      const result = validateRitualInput(data as Record<string, unknown>);
      return { success: true, data: result };
    } catch (err) {
      return {
        success: false,
        error: { message: err instanceof Error ? err.message : String(err) },
      };
    }
  },

  parse(data: unknown): RitualInput {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new TrackerValidationError({
        path: "(root)",
        expected: "object",
        actual: Array.isArray(data) ? "array" : typeof data,
      });
    }
    return validateRitualInput(data as Record<string, unknown>);
  },
};

// ---------------------------------------------------------------------------
// Parse helper
// ---------------------------------------------------------------------------

export type RitualDoc = {
  input: RitualInput;
  /** First H1 heading, or "(untitled)" */
  title: string;
  /** Markdown body after the frontmatter (the step template) */
  content: string;
};

/**
 * Parse a raw ritual.md string into validated frontmatter + body.
 * Throws TrackerValidationError on a frontmatter type violation.
 */
export function parseRitual(raw: string, filePath: string | null = null): RitualDoc {
  const { data, content } = parseFrontmatter(raw);
  const input = validateRitualInput(data, filePath ?? undefined);
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
