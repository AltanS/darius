/**
 * Milestone document types and parser — no external dependencies.
 *
 * A milestone README (00-README.md) describes a milestone's goal, scope, and
 * tracks its overall status. Front-matter fields follow the tracker template.
 */

import { TrackerValidationError } from "../markdown/errors.ts";

// ---------------------------------------------------------------------------
// MilestoneInput interface
// ---------------------------------------------------------------------------

export interface MilestoneInput {
  name?: string;
  slug?: string;
  started?: string;
  target?: string;
  owner?: string;
  /** passthrough: any additional unknown fields are allowed */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// MilestoneInputSchema-compatible API shim
// ---------------------------------------------------------------------------

/**
 * Validate and parse milestone frontmatter data.
 * All fields are optional; unknown fields are tolerated (passthrough).
 */
function validateMilestoneInput(
  data: Record<string, unknown>,
  sourcePath?: string,
): MilestoneInput {
  const stringFields = ["name", "slug", "started", "target", "owner"] as const;

  for (const field of stringFields) {
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

  return data as MilestoneInput;
}

export const MilestoneInputSchema = {
  safeParse(
    data: unknown,
  ): { success: true; data: MilestoneInput } | { success: false; error: { message: string } } {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return { success: false, error: { message: "Expected an object" } };
    }
    try {
      const result = validateMilestoneInput(data as Record<string, unknown>);
      return { success: true, data: result };
    } catch (err) {
      return {
        success: false,
        error: { message: err instanceof Error ? err.message : String(err) },
      };
    }
  },

  parse(data: unknown): MilestoneInput {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new TrackerValidationError({
        path: "(root)",
        expected: "object",
        actual: Array.isArray(data) ? "array" : typeof data,
      });
    }
    return validateMilestoneInput(data as Record<string, unknown>);
  },
};
