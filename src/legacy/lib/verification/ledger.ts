/**
 * Verification ledger — the append-only evidence trail behind every `[x]`.
 *
 * A checkbox in a spec says a thing was verified. It does not say *how*, *when*,
 * by which plugin version, or whether anything ran at all — and a `[x]` typed by
 * hand is indistinguishable from one earned by a command. This module is the
 * missing half: one JSON line per check, appended to
 * `<trackerRoot>/.verification-log.jsonl`.
 *
 * The file is EVIDENCE and is meant to be committed alongside the spec it
 * vouches for. It is deliberately not gitignored — a ledger you throw away
 * proves nothing, and the diff of a commit that ticks a box should carry the
 * line that justifies the tick.
 *
 * Format: JSON Lines (one object per line, newline-terminated). Append-only;
 * nothing in the CLI ever rewrites or truncates it.
 */

import { appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunOutcome } from "./runner.ts";
import { gitHead, hostName } from "../host-stamp.ts";
import { projectRootOf, repoStylePath } from "../tracker-root.ts";

export const LEDGER_FILENAME = ".verification-log.jsonl";

/**
 * How a `[x]` was earned.
 *
 * - `executed` — a real (non-trivial) Command ran and its Expected clause held.
 * - `manual`   — a human/agent asserted it; the Command was a no-op, absent, or
 *                never run. Always accompanied by evidence text in the ledger.
 */
export type VerificationMethod = "executed" | "manual";

/**
 * What a ledger line records.
 *
 * Every `RunOutcome` the runner can produce, plus `regression` — the one
 * outcome that only exists at the ledger/CLI layer: an item that was ALREADY
 * `[x]` and, on `verify --recheck`, no longer passes. The runner cannot know
 * that (it sees one item, not its history), and it must not be filed as a plain
 * `fail`: a fail is "this never passed", a regression is "this passed once and
 * stopped", and only the second one means something broke after the tick.
 */
export type LedgerOutcome = RunOutcome | "regression" | "manual-override";

export type LedgerEntry = {
  /** Spec path relative to the repo root (the parent of `.tracker/`). */
  spec: string;
  /** 0-based checklist index within that spec. */
  index: number;
  label: string;
  command: string | null;
  expected: string | null;
  /** Process exit code when something actually ran; null otherwise. */
  exitCode: number | null;
  outcome: LedgerOutcome;
  /** Free text: what was checked, how, by whom/which agent, at which tier. */
  evidence?: string;
  pluginVersion: string;
  /** ISO-8601 timestamp. */
  at: string;
  /** Git HEAD of the checkout when the line was written, or `none` (0.72.0; absent on older lines). */
  head?: string;
  /** Host that wrote the line (0.72.0; absent on older lines). */
  host?: string;
  /**
   * `mark --verified --override "<reason>"` on a runnable check (0.76.0): why
   * it was not run. Its outcome is `manual-override`.
   */
  override?: string;
};

// ---------------------------------------------------------------------------
// Size bounds
// ---------------------------------------------------------------------------

/**
 * Per-field caps.
 *
 * Appends are a single `write(2)` on an O_APPEND fd, which POSIX makes atomic
 * with respect to other appenders — but only reliably so below PIPE_BUF (4096
 * bytes) when writers race. Two parallel agents verifying the same tracker is
 * the normal case here (the work loop fans out), so every line is kept well
 * under that ceiling by construction rather than by hope. Truncated values keep
 * an explicit `…[truncated]` marker so a reader never mistakes a clipped
 * command for the whole command.
 */
const MAX_EVIDENCE_CHARS = 1000;
const MAX_FIELD_CHARS = 500;
const TRUNCATION_MARKER = "…[truncated]";

function clamp(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max) + TRUNCATION_MARKER;
}

// ---------------------------------------------------------------------------
// Plugin version
// ---------------------------------------------------------------------------

let cachedPluginVersion: string | null = null;

/**
 * Version of the tracker plugin that wrote a ledger line.
 *
 * Read from `plugins/tracker/.claude-plugin/plugin.json` (three levels above
 * `lib/verification/`). Ledger lines outlive the plugin that wrote them, and a
 * behaviour change in classification or grammar makes old lines mean something
 * slightly different — the version is how a reader can tell which contract a
 * line was written under. Falls back to `"unknown"` rather than throwing: a
 * missing manifest must never break verification.
 */
export function getPluginVersion(): string {
  if (cachedPluginVersion !== null) return cachedPluginVersion;

  const here = dirname(fileURLToPath(import.meta.url));
  const manifestPath = resolve(here, "..", "..", "..", ".claude-plugin", "plugin.json");

  let version = "unknown";
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf-8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { version?: unknown }).version === "string"
    ) {
      version = (parsed as { version: string }).version;
    }
  } catch {
    // Manifest unreadable — "unknown" is a truthful answer, and losing the
    // ledger line over it would be a worse outcome.
  }

  cachedPluginVersion = version;
  return version;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function ledgerPath(trackerRoot: string): string {
  return join(trackerRoot, LEDGER_FILENAME);
}

/**
 * Normalize an absolute spec path to the repo-relative form stored in the
 * ledger (e.g. `.tracker/M247-foo/02-bar.md`).
 *
 * Repo-relative because the ledger is committed and read on other machines —
 * an absolute path would key entries to one developer's home directory. Same
 * rule the specs themselves follow (runner.ts `stripCwdPrefix`).
 */
export function toLedgerSpecPath(trackerRoot: string, specPath: string): string {
  // Store mode keeps the `.tracker/...` form too, so old ledger lines still match.
  return repoStylePath(trackerRoot, resolve(specPath));
}

/** Stable identity of one checklist item: `<repo-relative spec>#<index>`. */
export function ledgerKey(spec: string, index: number): string {
  return `${spec}#${index}`;
}

// ---------------------------------------------------------------------------
// Append
// ---------------------------------------------------------------------------

export type AppendLedgerOpts = {
  trackerRoot: string;
  /** Absolute or relative path to the spec; normalized before storing. */
  specPath: string;
  index: number;
  label: string;
  command: string | null;
  expected: string | null;
  exitCode: number | null;
  outcome: LedgerOutcome;
  evidence?: string;
  /** Why a runnable check was marked by hand (0.76.0). */
  override?: string;
  /** Injectable for tests; defaults to now. */
  at?: string;
  /** Injectable for tests; defaults to the checkout's git HEAD. */
  head?: string;
  /** Injectable for tests; defaults to this host's name. */
  host?: string;
};

/**
 * Append one entry. Creates the ledger (and `.tracker/`) if missing.
 *
 * Single `appendFileSync` call with the default `a` flag → one O_APPEND write,
 * so concurrent appenders interleave whole lines, never halves. Never throws
 * outward: a ledger failure must not turn a passing verification into a failing
 * one, so I/O errors are swallowed and reported through the return value.
 *
 * @returns true if the line was written.
 */
export function appendLedgerEntry(opts: AppendLedgerOpts): boolean {
  const entry: LedgerEntry = {
    spec: toLedgerSpecPath(opts.trackerRoot, opts.specPath),
    index: opts.index,
    label: clamp(opts.label, MAX_FIELD_CHARS),
    command: opts.command === null ? null : clamp(opts.command, MAX_FIELD_CHARS),
    expected: opts.expected === null ? null : clamp(opts.expected, MAX_FIELD_CHARS),
    exitCode: opts.exitCode,
    outcome: opts.outcome,
    pluginVersion: getPluginVersion(),
    at: opts.at ?? new Date().toISOString(),
    head: opts.head ?? gitHead(projectRootOf(opts.trackerRoot)),
    host: opts.host ?? hostName(),
  };

  if (opts.evidence !== undefined && opts.evidence.trim() !== "") {
    entry.evidence = clamp(opts.evidence.trim(), MAX_EVIDENCE_CHARS);
  }
  if (opts.override !== undefined && opts.override.trim() !== "") {
    entry.override = clamp(opts.override.trim(), MAX_FIELD_CHARS);
  }

  try {
    if (!existsSync(opts.trackerRoot)) {
      mkdirSync(opts.trackerRoot, { recursive: true });
    }
    appendFileSync(ledgerPath(opts.trackerRoot), `${JSON.stringify(entry)}\n`, "utf-8");
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read every parseable entry. A malformed line is skipped, not fatal — the
 * ledger is append-only evidence, and one corrupt line (a crashed writer, a
 * bad merge resolution) must not blind every reader to the rest.
 */
export function readLedger(trackerRoot: string): LedgerEntry[] {
  const path = ledgerPath(trackerRoot);
  if (!existsSync(path)) return [];

  const entries: LedgerEntry[] = [];
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as LedgerEntry).spec === "string" &&
        typeof (parsed as LedgerEntry).index === "number"
      ) {
        entries.push(parsed as LedgerEntry);
      }
    } catch {
      continue;
    }
  }
  return entries;
}

/** Set of `<spec>#<index>` keys with at least one ledger entry. */
export function ledgerKeys(trackerRoot: string): Set<string> {
  const keys = new Set<string>();
  for (const entry of readLedger(trackerRoot)) {
    keys.add(ledgerKey(entry.spec, entry.index));
  }
  return keys;
}
