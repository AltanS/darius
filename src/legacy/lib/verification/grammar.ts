/**
 * Verification grammar parser — reusable module.
 *
 * Parses `Expected:` clause values from spec checklist items into a
 * discriminated-union VerificationStep.
 *
 * EBNF (from spec 01):
 *   expectation       = exit-form | stdout-contains | stdout-matches | file-exists
 *   exit-form         = "exit" SP integer
 *   stdout-contains   = "stdout" SP "contains" SP quoted-string
 *   stdout-matches    = "stdout" SP "matches" SP regex-literal
 *   file-exists       = "file" SP "exists" SP path
 *   quoted-string     = '"' { string-char | "\\" any-char } '"'
 *   regex-literal     = "/" { regex-char | "\\" any-char } "/" flags?
 *   flags             = { "d"|"g"|"i"|"m"|"s"|"u"|"v"|"y" }
 *   path              = non-whitespace string
 *   integer           = "-"? digit { digit }
 *
 * Decisions:
 * - One assertion per checklist item (no "|" chaining)
 * - Case-sensitive stdout contains
 * - ECMAScript regex flavor (Node RegExp)
 * - file-exists path resolved by caller (relative to spec file dir)
 * - stdout contains / stdout matches check combined stdout+stderr
 */

export type VerificationStep =
  | { kind: "exit"; code: number }
  | { kind: "stdout-contains"; needle: string }
  | { kind: "stdout-matches"; pattern: RegExp }
  | { kind: "file-exists"; path: string };

export type GrammarError = { error: string };
export type ParseResult = VerificationStep | GrammarError;

/**
 * Parse a raw `Expected:` string into a VerificationStep.
 *
 * Returns a `{ error: string }` if the string does not match any known form.
 * Never throws.
 */
export function parseExpectation(raw: string): ParseResult {
  const trimmed = raw.trim();
  if (!trimmed) return { error: "empty expectation string" };

  const exitResult = tryParseExit(trimmed);
  if (exitResult !== null) return exitResult;

  const containsResult = tryParseStdoutContains(trimmed);
  if (containsResult !== null) return containsResult;

  const matchesResult = tryParseStdoutMatches(trimmed);
  if (matchesResult !== null) return matchesResult;

  const fileResult = tryParseFileExists(trimmed);
  if (fileResult !== null) return fileResult;

  return { error: `unknown expectation form: ${trimmed}` };
}

/**
 * Type guard: is the result a grammar error?
 */
export function isGrammarError(result: ParseResult): result is GrammarError {
  return "error" in result;
}

/**
 * Type guard: is the result a valid VerificationStep?
 */
export function isVerificationStep(
  result: ParseResult,
): result is VerificationStep {
  return "kind" in result;
}

// ---------------------------------------------------------------------------
// Internal parsers
// ---------------------------------------------------------------------------

function tryParseExit(s: string): VerificationStep | null {
  const match = /^exit\s+(-?\d+)$/.exec(s);
  if (!match) return null;
  const code = Number.parseInt(match[1] ?? "0", 10);
  return { kind: "exit", code };
}

function tryParseStdoutContains(s: string): VerificationStep | GrammarError | null {
  const match = /^stdout\s+contains\s+(.+)$/s.exec(s);
  if (!match) return null;
  const raw = (match[1] ?? "").trim();
  const needle = stripSurroundingQuotes(raw);
  return { kind: "stdout-contains", needle };
}

function tryParseStdoutMatches(s: string): VerificationStep | GrammarError | null {
  const match = /^stdout\s+matches\s+(.+)$/s.exec(s);
  if (!match) return null;
  let raw = (match[1] ?? "").trim();
  let flags = "";

  // Strip surrounding slashes from regex literal, preserving trailing flags
  // (e.g. /^ok$/m). Anything after the closing slash used to be silently
  // discarded, so authors could not opt into multiline/case-insensitive
  // matching; invalid flags now surface as a grammar error via the RegExp
  // constructor below.
  if (raw.startsWith("/") && raw.length >= 2) {
    const lastSlash = raw.lastIndexOf("/");
    if (lastSlash > 0) {
      flags = raw.slice(lastSlash + 1);
      raw = raw.slice(1, lastSlash);
    }
  }

  try {
    const pattern = new RegExp(raw, flags);
    return { kind: "stdout-matches", pattern };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: `invalid regex: ${message}` };
  }
}

function tryParseFileExists(s: string): VerificationStep | null {
  const match = /^file\s+exists\s+(\S+)$/.exec(s);
  if (!match) return null;
  const path = stripSurroundingQuotes((match[1] ?? "").trim());
  return { kind: "file-exists", path };
}

function stripSurroundingQuotes(s: string): string {
  if (s.length < 2) return s;
  const first = s[0];
  const last = s[s.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return s.slice(1, -1);
  }
  return s;
}
