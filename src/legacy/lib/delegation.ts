// delegation.ts: typed envelope contract used by darius when delegating
// implementation work to expert agents. The agent roster is NOT fixed here:
// darius discovers it at runtime via `darius agents` (installed ∩ enabled
// plugins) and routes by reading each agent's description. This file validates
// the envelope's shape, agent names are validated structurally (a namespaced
// `plugin:agent` string or a bare name), not against a closed enum.
//
// This file is the canonical schema. Two consumers:
//
//   1. Documentation: agents reference this shape when reading their input
//      prompt. Each labeled field below maps to a `Field: value` line in the
//      delegation prompt darius constructs.
//
//   2. Validation: `validate <json>` mode parses a JSON envelope and either
//      prints "OK" + exits 0, or prints structured errors + exits 1. Doctor
//      and tests use this.
//
// Usage (the `darius delegation` verb, see runDelegation below):
//   darius delegation validate '<json>'         # validate a delegation envelope
//   darius delegation return-validate '<json>'  # validate a delegation return

// ─── Input: darius → expert agent ───────────────────────────────────────────
//
// All fields except `counsel_transcript` and `out_of_domain_hint` are required
// when worklog_path is present (i.e. running inside a tracker context). When
// worklog_path is absent, only `task` is required, the agent works without
// tracker writes.

export type DelegationInput = {
  /** Absolute path to the spec file the task belongs to. */
  spec_path: string;

  /** Milestone slug (e.g. "M2-api-layer"). */
  milestone_slug: string;

  /** Stable identifier for this thread. ULID + slug suffix. */
  thread_id: string;

  /** Absolute path to the worklog file owning this thread. Omitted when
   *  delegating outside a tracker-managed project. */
  worklog_path?: string;

  /** Free-text task description (the checklist item). */
  task: string;

  /** Verification commands and expectations parsed from the spec. */
  verification: VerificationItem[];

  /** Files previously logged in the thread's `### Artifacts` section.
   *  Empty array when this is the first delegation for the thread. */
  prior_artifacts: string[];

  /** Path to the spec's counsel sidecar transcript, when one exists. */
  counsel_transcript?: string;

  /** Optional: darius's guess at the "right" agent if this turns out to be
   *  out-of-domain. Agents follow this hint in `next_agent` of their return.
   *  Must match shape: /^[a-z0-9-]+(:[a-z0-9-]+)?$/, see AGENT_NAME_RE */
  out_of_domain_hint?: string;
};

export type VerificationItem = {
  command: string;
  expected: string; // grammar form: "exit N" | "stdout contains ..." | etc.
};

// ─── Return: expert agent → darius ──────────────────────────────────────────
//
// Returned as the agent's final response text. Agents append the matching
// fields to their thread in the worklog before returning.

export type DelegationReturn = {
  /** Outcome of the delegation. */
  status: "complete" | "blocked" | "out-of-domain";

  /** Absolute paths created or modified during the delegation. Mirrors the
   *  `### Artifacts` section the agent wrote to the worklog. */
  artifacts: string[];

  /** True if the agent ran the spec's verification commands themselves. */
  verification_run: boolean;

  /** When status === "out-of-domain": which agent should pick up next.
   *  Must match shape: /^[a-z0-9-]+(:[a-z0-9-]+)?$/, see AGENT_NAME_RE */
  next_agent?: string;

  /** Free-text findings, decisions, blockers. Kept terse, fuller context
   *  lives in the worklog thread. */
  notes: string;
};

// ─── Validation ─────────────────────────────────────────────────────────────

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString);
}

// Agent names follow the Claude Code naming convention: lowercase letters,
// digits, and hyphens only. No uppercase, no underscores. This is intentional:
// all Claude Code plugin and agent names follow the lowercase-hyphen convention.
// Accepts namespaced format (plugin:agent) or bare name.
const AGENT_NAME_RE = /^[a-z0-9-]+(:[a-z0-9-]+)?$/;

export function validateInput(raw: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, errors: ["envelope must be an object"] };
  }
  const v = raw as Record<string, unknown>;

  if (!isNonEmptyString(v.task)) errors.push("task: required non-empty string");

  // worklog-context fields are required together
  const hasWorklog = v.worklog_path !== undefined;
  if (hasWorklog) {
    if (!isNonEmptyString(v.spec_path)) errors.push("spec_path: required when worklog_path is set");
    if (!isNonEmptyString(v.milestone_slug)) errors.push("milestone_slug: required when worklog_path is set");
    if (!isNonEmptyString(v.thread_id)) errors.push("thread_id: required when worklog_path is set");
    if (!isNonEmptyString(v.worklog_path)) errors.push("worklog_path: must be non-empty string");
    if (!Array.isArray(v.verification)) {
      errors.push("verification: required array (may be empty)");
    } else {
      for (const [i, item] of v.verification.entries()) {
        if (typeof item !== "object" || item === null) {
          errors.push(`verification[${i}]: must be object`);
          continue;
        }
        const it = item as Record<string, unknown>;
        if (!isString(it.command)) errors.push(`verification[${i}].command: required string`);
        if (!isNonEmptyString(it.expected)) errors.push(`verification[${i}].expected: required non-empty string`);
      }
    }
    if (!isStringArray(v.prior_artifacts ?? [])) errors.push("prior_artifacts: must be string[]");
  }

  if (v.counsel_transcript !== undefined && !isString(v.counsel_transcript)) {
    errors.push("counsel_transcript: must be string when present");
  }
  if (v.out_of_domain_hint !== undefined && (typeof v.out_of_domain_hint !== "string" || !AGENT_NAME_RE.test(v.out_of_domain_hint))) {
    errors.push("out_of_domain_hint: must be a valid agent name (e.g. 'plugin:agent' or 'bare-name')");
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function validateReturn(raw: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, errors: ["return must be an object"] };
  }
  const v = raw as Record<string, unknown>;

  const validStatuses = ["complete", "blocked", "out-of-domain"];
  if (!validStatuses.includes(v.status as string)) {
    errors.push(`status: must be one of ${validStatuses.join(", ")}`);
  }
  if (!isStringArray(v.artifacts ?? [])) errors.push("artifacts: must be string[]");
  if (typeof v.verification_run !== "boolean") errors.push("verification_run: must be boolean");
  if (!isString(v.notes ?? "")) errors.push("notes: must be string");

  if (v.status === "out-of-domain") {
    if (!isString(v.next_agent) || !AGENT_NAME_RE.test(v.next_agent)) {
      errors.push("next_agent: required when status=\"out-of-domain\", must be a valid agent name (e.g. 'plugin:agent' or 'bare-name')");
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ─── Public validation helper ────────────────────────────────────────────────

export type DelegationValidationInput = {
  agent: string;
  task: string;
  spec_path: string;
  milestone_slug: string;
  thread_id: string;
  worklog_path: string;
  verification: Array<{ command: string; expected: string }>;
};

/**
 * Validate a delegation envelope. Returns { success: true } or
 * { success: false, error: string }.
 *
 * Agent name must match AGENT_NAME_RE: /^[a-z0-9-]+(:[a-z0-9-]+)?$/
 */
export function validateDelegation(
  input: DelegationValidationInput,
): { success: boolean; error?: string } {
  if (!AGENT_NAME_RE.test(input.agent)) {
    return {
      success: false,
      error: `agent: invalid name "${input.agent}", must match /^[a-z0-9-]+(:[a-z0-9-]+)?$/`,
    };
  }
  if (!input.task || input.task.trim() === "") {
    return { success: false, error: "task: required non-empty string" };
  }
  if (!input.spec_path) {
    return { success: false, error: "spec_path: required" };
  }
  if (!input.milestone_slug) {
    return { success: false, error: "milestone_slug: required" };
  }
  if (!input.thread_id) {
    return { success: false, error: "thread_id: required" };
  }
  if (!input.worklog_path) {
    return { success: false, error: "worklog_path: required" };
  }
  return { success: true };
}

// ─── CLI ────────────────────────────────────────────────────────────────────

/**
 * Runs `darius delegation <validate|return-validate> '<json>'`. `args` is the
 * command line after the verb. Returns the exit code: 0 valid, 1 invalid,
 * 2 usage error or unparsable JSON.
 */
export function runDelegation(args: string[]): number {
  const [mode, payload] = args;
  if (!mode || !payload) {
    process.stderr.write("usage: darius delegation <validate|return-validate> '<json>'\n");
    return 2;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    process.stderr.write(`invalid JSON: ${message}\n`);
    return 2;
  }

  const result = mode === "validate" ? validateInput(parsed)
    : mode === "return-validate" ? validateReturn(parsed)
    : null;

  if (result === null) {
    process.stderr.write(`unknown mode: ${mode}\n`);
    return 2;
  }

  if (result.ok) {
    process.stdout.write("OK\n");
    return 0;
  }

  for (const err of result.errors) {
    process.stderr.write(`${err}\n`);
  }
  return 1;
}
