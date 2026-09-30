/**
 * Counsel gate — deterministic parser + threshold evaluator.
 *
 * The LLM running the work-plan skill cannot be trusted to count verdicts and
 * apply a numeric threshold reliably. v9.6.0 tried this in prompt only and it
 * was overridden by the model's "severity beats threshold" prior. This module
 * does the counting and the threshold check in plain TypeScript and returns a
 * structured result the skill just echoes.
 *
 * Transcript format (set by the counsel skill):
 *
 *   ## Advisor 3 — Pragmatic Skeptic
 *
 *   **Verdict**: thumbs_down
 *
 *   **Assessment**: ...
 *
 * The verdict line is matched case-insensitively. Whitespace around the
 * marker is tolerated. Stray text on the line after the verdict token is
 * ignored.
 */

export type Verdict = "thumbs_up" | "thumbs_sideways" | "thumbs_down";

/**
 * How a lone thumbs_down (below the blocking threshold) is handled.
 *
 *   - "surface" (default): proceed, but emit `dissentSummary` so the planner
 *     surfaces the concern to the user. No gate — display only.
 *   - "confirm": emit `needs_ack` so the planner must obtain explicit user
 *     acknowledgement before dispatch. The decision is deterministic (owned
 *     here, not by the LLM) — re-run with the ack flag to clear it.
 *   - "ignore": proceed silently, no dissent surfaced.
 *
 * The threshold count stays authoritative for *blocking*; this only governs
 * the single-dissent case the threshold lets through.
 */
export type SingleDissentMode = "surface" | "confirm" | "ignore";

export type AdvisorVerdict = {
  /** 1-indexed advisor number from the heading. */
  index: number;
  /** Persona name from the heading (e.g. "Pragmatic Skeptic"). */
  persona: string;
  verdict: Verdict;
  /** First non-empty Assessment line, if present. */
  assessment: string;
};

export type CounselParseResult = {
  advisors: AdvisorVerdict[];
  thumbsDown: number;
  thumbsUp: number;
  thumbsSideways: number;
};

export type GateDecision = {
  status: "ready" | "blocked" | "needs_ack" | "counsel_exhausted";
  reason: string;
  thumbsDown: number;
  threshold: number;
  /** Set when thumbsDown === 1 under "surface" or "confirm" mode. */
  dissentSummary?: string;
  /** Set when status === "blocked" or "counsel_exhausted". */
  blockingSummary?: string;
  /** Counsel deliberation rounds consumed so far (including this one). */
  rounds?: number;
  /** Maximum rounds allowed before the gate stops re-counseling. */
  maxRounds?: number;
};

/**
 * Parse a counsel transcript markdown string into structured verdicts.
 *
 * Robust to:
 *   - Different advisor heading styles ("## Advisor 1 — Senior Developer",
 *     "### Senior Developer — thumbs_sideways", "## Senior Developer")
 *   - Verdict before or after assessment
 *   - Mixed-case verdict markers
 *   - Stray prose around the verdict line
 *
 * The parser uses the `**Verdict**: thumbs_X` line as the source of truth.
 * If an advisor section contains no such line, that advisor is skipped.
 */
export function parseCounselTranscript(raw: string): CounselParseResult {
  const advisors: AdvisorVerdict[] = [];

  // Split on ## or ### advisor headings. We capture everything between two
  // headings (or the last heading and EOF) as a section.
  const sections = splitOnAdvisorHeadings(raw);

  let index = 0;
  for (const section of sections) {
    index += 1;
    const verdict = extractVerdict(section.body);
    if (verdict === null) {
      // Section without a Verdict line — skip silently.
      // (Brief, Consensus, or other meta-sections.)
      continue;
    }
    const assessment = extractAssessment(section.body);
    advisors.push({
      index,
      persona: section.persona,
      verdict,
      assessment,
    });
  }

  return {
    advisors,
    thumbsDown: advisors.filter((a) => a.verdict === "thumbs_down").length,
    thumbsUp: advisors.filter((a) => a.verdict === "thumbs_up").length,
    thumbsSideways: advisors.filter((a) => a.verdict === "thumbs_sideways")
      .length,
  };
}

/**
 * Apply the threshold rule to a parse result.
 *
 * - thumbsDown >= threshold → blocked (the only case where counsel: rejected
 *   is written to spec frontmatter).
 * - thumbsDown === 1 → governed by `singleDissentMode`:
 *     - "surface" (default): ready with `dissentSummary` so the planner can
 *       surface the lone concern to the user. Spec receives `counsel: <ISO>`.
 *     - "confirm": needs_ack with `dissentSummary` — dispatch must wait for an
 *       explicit user acknowledgement. Spec frontmatter is left untouched so
 *       the spec stays gated until acked.
 *     - "ignore": ready, no dissent surfaced.
 * - thumbsDown === 0 → ready, no dissent.
 *
 * Blocking is always decided by the threshold count — `singleDissentMode` only
 * governs the single-dissent case the threshold lets through. Threshold must be
 * a positive integer (defaults to 2).
 */
export function applyGate(
  parse: CounselParseResult,
  threshold: number = 2,
  singleDissentMode: SingleDissentMode = "surface",
): GateDecision {
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new Error(
      `counsel-gate: threshold must be a positive integer, got ${threshold}`,
    );
  }

  const down = parse.thumbsDown;

  if (down >= threshold) {
    return {
      status: "blocked",
      reason: `counsel rejected (${down} thumbs_down >= ${threshold})`,
      thumbsDown: down,
      threshold,
      blockingSummary: summarizeDissent(parse, "thumbs_down"),
    };
  }

  if (down === 1) {
    if (singleDissentMode === "ignore") {
      return {
        status: "ready",
        reason: `1 thumbs_down below threshold ${threshold} — single_dissent: ignore`,
        thumbsDown: down,
        threshold,
      };
    }
    if (singleDissentMode === "confirm") {
      return {
        status: "needs_ack",
        reason: `1 thumbs_down below threshold ${threshold} — single_dissent: confirm requires acknowledgement before dispatch`,
        thumbsDown: down,
        threshold,
        dissentSummary: summarizeDissent(parse, "thumbs_down"),
      };
    }
    return {
      status: "ready",
      reason: `1 thumbs_down below threshold ${threshold} — proceeding with advisory dissent`,
      thumbsDown: down,
      threshold,
      dissentSummary: summarizeDissent(parse, "thumbs_down"),
    };
  }

  return {
    status: "ready",
    reason: `${down} thumbs_down below threshold ${threshold}`,
    thumbsDown: down,
    threshold,
  };
}

/**
 * Bound the counsel deliberation loop deterministically.
 *
 * The threshold gate (`applyGate`) is stateless across rounds: it has no idea
 * whether this is counsel run #1 or #4 on the same spec. Left unbounded, the
 * cycle `blocked → enrich → re-counsel → blocked → …` can spin forever — the
 * only brake was a prose "twice is a smell" hint in the darius prompt, which is
 * exactly the judgment that fails in practice. This makes the brake mechanical.
 *
 * A `blocked` decision that has consumed `>= maxRounds` rounds is converted to
 * a terminal `counsel_exhausted`. The planner cannot re-invoke counsel on an
 * exhausted spec — it must surface the unresolved feedback to the user and
 * either proceed with an explicit override or park the spec. Only `blocked`
 * decisions are subject to the budget; `ready` / `needs_ack` already resolved.
 *
 * @param roundsUsed total counsel rounds consumed, INCLUDING the current one.
 * @param maxRounds  positive integer cap (defaults to 2).
 */
export function applyRoundBudget(
  decision: GateDecision,
  roundsUsed: number,
  maxRounds: number = 2,
): GateDecision {
  if (!Number.isInteger(maxRounds) || maxRounds < 1) {
    throw new Error(
      `counsel-gate: maxRounds must be a positive integer, got ${maxRounds}`,
    );
  }

  const withRounds: GateDecision = {
    ...decision,
    rounds: roundsUsed,
    maxRounds,
  };

  if (decision.status === "blocked" && roundsUsed >= maxRounds) {
    return {
      ...withRounds,
      status: "counsel_exhausted",
      reason: `counsel exhausted after ${roundsUsed} round(s) (max ${maxRounds}) — ${decision.reason}`,
    };
  }

  return withRounds;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type AdvisorSection = {
  persona: string;
  body: string;
};

/**
 * Split a transcript into advisor sections.
 *
 * Recognized heading forms (matched case-insensitively for the word "Advisor"):
 *   ## Advisor N — Persona Name
 *   ## Advisor N - Persona Name
 *   ### Persona Name — thumbs_X     (legacy form from older counsel template)
 *
 * Headings without "Advisor" and without a trailing verdict are ignored — they
 * may be "## Brief", "## Consensus", etc.
 */
function splitOnAdvisorHeadings(raw: string): AdvisorSection[] {
  const lines = raw.split("\n");
  const sections: AdvisorSection[] = [];
  let current: AdvisorSection | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const heading = extractAdvisorHeading(trimmed);
    if (heading !== null) {
      if (current !== null) {
        sections.push(current);
      }
      current = { persona: heading, body: "" };
      continue;
    }

    if (current !== null) {
      current.body += line + "\n";
    }
  }

  if (current !== null) {
    sections.push(current);
  }

  return sections;
}

/**
 * Return the persona name if `line` is an advisor heading, else null.
 *
 * "## Advisor 3 — Pragmatic Skeptic" → "Pragmatic Skeptic"
 * "## Advisor 1 - Senior Developer" → "Senior Developer"
 * "### Senior Developer — thumbs_sideways" → "Senior Developer"
 * "## Brief" → null
 * "## Consensus" → null
 */
function extractAdvisorHeading(line: string): string | null {
  // "## Advisor N [—-] Persona" or "### Advisor N [—-] Persona"
  const m1 = /^#{2,3}\s+Advisor\s+\d+\s*[—\-]\s*(.+?)\s*$/i.exec(line);
  if (m1 !== null) {
    return stripTrailingVerdict(m1[1]!);
  }

  // Legacy: "### Persona Name — thumbs_X"
  const m2 = /^#{2,3}\s+(.+?)\s*[—\-]\s*thumbs_(up|sideways|down)\s*$/i.exec(
    line,
  );
  if (m2 !== null) {
    return m2[1]!.trim();
  }

  return null;
}

function stripTrailingVerdict(persona: string): string {
  // Some templates put the verdict at the end of the heading.
  return persona.replace(/\s*[—\-]\s*thumbs_(up|sideways|down)\s*$/i, "").trim();
}

/**
 * Find the verdict on a `**Verdict**: thumbs_X` line. Case-insensitive.
 * Returns null if no verdict line is found.
 */
function extractVerdict(body: string): Verdict | null {
  // **Verdict**: thumbs_X    (with optional whitespace, surrounding asterisks
  // tolerated as bold markdown)
  const m = /\*\*\s*Verdict\s*\*\*\s*:\s*thumbs_(up|sideways|down)\b/i.exec(
    body,
  );
  if (m !== null) {
    return `thumbs_${m[1]!.toLowerCase()}` as Verdict;
  }

  // Tolerate non-bold form: "Verdict: thumbs_X"
  const m2 = /^\s*Verdict\s*:\s*thumbs_(up|sideways|down)\b/im.exec(body);
  if (m2 !== null) {
    return `thumbs_${m2[1]!.toLowerCase()}` as Verdict;
  }

  return null;
}

/**
 * Pull the first non-empty Assessment line for dissent-summary purposes.
 * Returns the empty string if no assessment is found.
 */
function extractAssessment(body: string): string {
  const m = /\*\*\s*Assessment\s*\*\*\s*:\s*(.+?)(?:\n|$)/i.exec(body);
  if (m !== null) {
    return m[1]!.trim();
  }
  return "";
}

function summarizeDissent(
  parse: CounselParseResult,
  verdict: Verdict,
): string {
  const dissenters = parse.advisors.filter((a) => a.verdict === verdict);
  if (dissenters.length === 0) {
    return "";
  }
  return dissenters
    .map((a) => `${a.persona}: ${a.assessment || "(no assessment line)"}`)
    .join(" | ");
}
