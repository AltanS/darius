/**
 * Tracker validation error types and formatters.
 *
 * Replaces the Zod-error translator with a purpose-built error type that
 * is thrown directly from our hand-rolled parsers. No Zod dependency.
 */

// ---------------------------------------------------------------------------
// TrackerValidationError — the canonical validation error type
// ---------------------------------------------------------------------------

export class TrackerValidationError extends Error {
  readonly path: string;
  readonly expected: string;
  readonly actual: string;
  readonly sourcePath: string | undefined;

  constructor(opts: {
    path: string;
    expected: string;
    actual: string;
    sourcePath?: string;
  }) {
    const loc = opts.sourcePath ? ` in ${opts.sourcePath}` : "";
    super(
      `Validation error${loc}: frontmatter.${opts.path}: expected ${opts.expected}, got ${opts.actual}`,
    );
    this.name = "TrackerValidationError";
    this.path = opts.path;
    this.expected = opts.expected;
    this.actual = opts.actual;
    this.sourcePath = opts.sourcePath;
  }
}

// ---------------------------------------------------------------------------
// Legacy compat types — kept so test imports don't break
// ---------------------------------------------------------------------------

export type TrackerFieldError = {
  filePath: string | null;
  fieldPath: string;
  message: string;
  example: string;
};

export type TrackerParseError = {
  kind: "parse-error";
  filePath: string | null;
  errors: TrackerFieldError[];
};

/**
 * Build a TrackerParseError from a TrackerValidationError.
 * Used by tests that call translateZodError / formatParseError.
 */
export function translateZodError(
  error: unknown,
  filePath: string | null = null,
): TrackerParseError {
  if (error instanceof TrackerValidationError) {
    return {
      kind: "parse-error",
      filePath,
      errors: [
        {
          filePath,
          fieldPath: error.path,
          message: `Expected ${error.expected} but received ${error.actual}`,
          example: exampleForExpected(error.expected),
        },
      ],
    };
  }

  // Generic Error fallback
  const message = error instanceof Error ? error.message : String(error);
  return {
    kind: "parse-error",
    filePath,
    errors: [
      {
        filePath,
        fieldPath: "(unknown)",
        message,
        example: "(see schema for valid values)",
      },
    ],
  };
}

/**
 * Format a TrackerParseError into a human-readable string suitable for stderr.
 */
export function formatParseError(err: TrackerParseError): string {
  const lines: string[] = [];
  const loc = err.filePath ? ` in ${err.filePath}` : "";
  lines.push(`Parse error${loc}:`);

  for (const fe of err.errors) {
    lines.push(`  Field: ${fe.fieldPath}`);
    lines.push(`  Problem: ${fe.message}`);
    lines.push(`  Example: ${fe.example}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function exampleForExpected(expected: string): string {
  const examples: Record<string, string> = {
    string: '"example text"',
    number: "42",
    boolean: "true",
    array: "[]",
    object: "{}",
    null: "null",
    undefined: "(omit this field)",
    date: "2026-01-01",
  };
  return examples[expected] ?? `(a ${expected} value)`;
}
