/**
 * Session claims — advisory, expiring locks on specs in a SHARED checkout.
 *
 * Sessions here share one checkout per repo and one branch (branching during
 * parallel work is banned). M242 is what that costs without a claim mechanism:
 * four specs were dispatched, discovered mid-flight to collide with a concurrent
 * session, and parked — yet their artifacts landed anyway; two more were written
 * by sessions the operator killed, leaving a fresh session to adopt and re-read
 * the diff line-by-line before it could trust anything.
 *
 * A claim is ADVISORY and EXPIRING, not a distributed lock:
 *
 * - Advisory — nothing is prevented. `--force` / `--takeover` always wins. The
 *   goal is that the second session *sees* the collision before doing the work,
 *   not that concurrency is impossible.
 * - Expiring — a killed session must not hold a spec forever. Past `expiresAt` a
 *   claim is STALE: reported as such and takeable without ceremony. Never
 *   silently honoured (that is a deadlock), never silently ignored (that is the
 *   collision this module exists to surface).
 *
 * State lives in `<trackerRoot>/.session-claims.json`. In a git tracker this
 * file is gitignored: a committed claim would arrive at a teammate's checkout
 * already stale and always wrong. When the darius store owns the tree
 * (0.75.0) the file syncs between hosts with the tree, merged per spec, newest
 * claim wins (src/core/claims-merge.ts). So each claim names its `host`, and a
 * release leaves a tombstone in `released`, so the merge does not bring back
 * a claim the other host still had. Old entries without `host` still read.
 *
 * Everything below the I/O helpers is pure so the interesting rules (staleness,
 * ownership, TTL parsing, ref normalization) are unit-testable without a repo.
 */

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { atomicWriteFileSync } from "./atomic.ts";
import { hostName } from "./host-stamp.ts";
import { withLock } from "./worklog.ts";

export const CLAIMS_FILENAME = ".session-claims.json";

/** 8 hours — long enough for a working session, short enough that a killed one clears by the next. */
export const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;

/** Env var carrying the Claude Code session id. */
export const SESSION_ENV_VAR = "CLAUDE_CODE_SESSION_ID";

/** Older name, still read after {@link SESSION_ENV_VAR} for back compat. */
export const LEGACY_SESSION_ENV_VAR = "CLAUDE_SESSION_ID";

export type SessionClaim = {
  /** Opaque session identifier — whatever `--session` / $CLAUDE_CODE_SESSION_ID says. */
  session: string;
  /** ISO-8601 instant the claim was taken. */
  at: string;
  /** ISO-8601 instant after which the claim is STALE. */
  expiresAt: string;
  /** The host the claim was taken on (0.75.0). Absent in older entries. */
  host?: string;
};

export type ClaimsDoc = {
  version: 1;
  /** Keyed by normalized spec ref (repo-relative path where resolvable). */
  claims: Record<string, SessionClaim>;
  /**
   * Tombstones of released claims (0.75.0), keyed like `claims`: `at` is the
   * release time, `expiresAt` the end of the claim it released. Only the tree
   * merge reads them; they drop out once expired.
   */
  released?: Record<string, SessionClaim>;
};

export function emptyClaimsDoc(): ClaimsDoc {
  return { version: 1, claims: {} };
}

// ---------------------------------------------------------------------------
// Paths and I/O
// ---------------------------------------------------------------------------

export function claimsPath(trackerRoot: string): string {
  return join(trackerRoot, CLAIMS_FILENAME);
}

/**
 * Read the claims file.
 *
 * Tolerant by design: missing, empty, corrupt, or wrong-shaped content all read
 * as "no claims". This is advisory ephemeral state — a half-written file left by
 * a killed session must degrade to "nothing is claimed", never crash `next`,
 * `doctor` or `list`.
 */
export function readClaims(trackerRoot: string): ClaimsDoc {
  const path = claimsPath(trackerRoot);
  if (!existsSync(path)) return emptyClaimsDoc();

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return emptyClaimsDoc();
  }

  if (typeof parsed !== "object" || parsed === null) return emptyClaimsDoc();
  const rawClaims = (parsed as { claims?: unknown }).claims;
  if (typeof rawClaims !== "object" || rawClaims === null) return emptyClaimsDoc();

  const doc = emptyClaimsDoc();
  const claims: Record<string, SessionClaim> = {};
  readEntries(rawClaims, claims);
  doc.claims = canonicalKeys(trackerRoot, claims);
  const rawReleased = (parsed as { released?: unknown }).released;
  if (typeof rawReleased === "object" && rawReleased !== null) {
    const released: Record<string, SessionClaim> = {};
    readEntries(rawReleased, released);
    if (Object.keys(released).length > 0) doc.released = canonicalKeys(trackerRoot, released);
  }
  return doc;
}

function readEntries(raw: object, into: Record<string, SessionClaim>): void {
  for (const [ref, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const { session, at, expiresAt, host } = value as Partial<SessionClaim>;
    if (typeof session !== "string" || session.trim() === "") continue;
    if (typeof at !== "string" || typeof expiresAt !== "string") continue;
    const claim: SessionClaim = { session, at, expiresAt };
    if (typeof host === "string" && host !== "") claim.host = host;
    into[ref] = claim;
  }
}

/**
 * Record a release: drop the claim and leave a tombstone that outlives it, so
 * a tree merge with an older copy of the file does not bring the claim back.
 */
export function releaseClaim(doc: ClaimsDoc, ref: string, session: string, now: Date = new Date()): void {
  const previous = doc.claims[ref];
  delete doc.claims[ref];
  const at = now.toISOString();
  const end = previous === undefined ? null : parseInstant(previous.expiresAt);
  const expiresAt = end !== null && end > now.getTime() ? previous!.expiresAt : at;
  if (expiresAt === at) return;
  doc.released = { ...doc.released, [ref]: { session, at, expiresAt, host: hostName() } };
}

/** Drop expired tombstones, and the tombstone of a ref that holds a claim again. */
export function pruneReleased(doc: ClaimsDoc, now: Date = new Date()): void {
  if (doc.released === undefined) return;
  for (const [ref, tomb] of Object.entries(doc.released)) {
    const end = parseInstant(tomb.expiresAt);
    if (doc.claims[ref] !== undefined || end === null || end <= now.getTime()) delete doc.released[ref];
  }
  if (Object.keys(doc.released).length === 0) delete doc.released;
}

export function writeClaims(trackerRoot: string, doc: ClaimsDoc): void {
  atomicWriteFileSync(claimsPath(trackerRoot), `${JSON.stringify(doc, null, 2)}\n`);
}

/**
 * Read-modify-write under an O_EXCL lock.
 *
 * The read and the write must not straddle another session's write, or two
 * sessions claiming *different* specs at the same moment would clobber each
 * other's entry — the exact failure mode this module is supposed to prevent.
 * `withLock` is the same helper the worklog uses for its own RMW cycles.
 *
 * `mutate` returns the value the caller wants back out (the decision it made
 * while holding the lock), so refusals never write.
 */
export function mutateClaims<T>(
  trackerRoot: string,
  mutate: (doc: ClaimsDoc) => { doc: ClaimsDoc; write: boolean; result: T },
): T {
  let out!: T;
  withLock(claimsPath(trackerRoot), () => {
    const current = readClaims(trackerRoot);
    const { doc, write, result } = mutate(current);
    if (write) {
      pruneReleased(doc);
      writeClaims(trackerRoot, doc);
    }
    out = result;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Session identity
// ---------------------------------------------------------------------------

/**
 * Resolve the acting session id: `--session` flag, else $CLAUDE_CODE_SESSION_ID, else $CLAUDE_SESSION_ID.
 *
 * Returns null when neither is present. Callers that WRITE a claim must refuse
 * on null — an anonymous claim names nobody, so the refusal message it produces
 * later ("claimed by session ''") would be useless. Callers that only READ
 * (`next`, `worklog dispatch`) treat null as "not me", which is the safe
 * direction: an unattributable session sees other sessions' claims rather than
 * silently inheriting them.
 */
export function resolveSessionId(
  flag: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const fromFlag = flag?.trim();
  if (fromFlag) return fromFlag;
  const fromEnv = env[SESSION_ENV_VAR]?.trim();
  if (fromEnv) return fromEnv;
  const fromLegacyEnv = env[LEGACY_SESSION_ENV_VAR]?.trim();
  if (fromLegacyEnv) return fromLegacyEnv;
  return null;
}

export const NO_SESSION_MESSAGE =
  `no session id — pass --session <id> or set $${SESSION_ENV_VAR} ($${LEGACY_SESSION_ENV_VAR} also works). ` +
  `A claim that names no session cannot tell the next session who to go ask.`;

// ---------------------------------------------------------------------------
// TTL
// ---------------------------------------------------------------------------

export class TtlParseError extends Error {}

/**
 * Parse a TTL: `8h`, `90m`, `2d`, or a bare number (hours).
 *
 * Bare numbers mean HOURS because the default TTL is expressed in hours — a
 * bare `4` meaning 4 minutes would be a silent 120x error in the direction that
 * drops claims early.
 */
export function parseTtl(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_TTL_MS;

  const trimmed = raw.trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/.exec(trimmed);
  if (match === null) {
    throw new TtlParseError(
      `invalid --ttl ${JSON.stringify(raw)} — use <n>[ms|s|m|h|d], e.g. 8h, 90m, 2d (a bare number means hours)`,
    );
  }

  const value = Number.parseFloat(match[1]!);
  const unit = match[2] ?? "h";
  const multiplier =
    unit === "ms" ? 1
    : unit === "s" ? 1000
    : unit === "m" ? 60 * 1000
    : unit === "d" ? 24 * 60 * 60 * 1000
    : 60 * 60 * 1000;

  const ms = Math.round(value * multiplier);
  if (ms <= 0) {
    throw new TtlParseError(`invalid --ttl ${JSON.stringify(raw)} — must be greater than zero`);
  }
  return ms;
}

/** Render a TTL back as the shortest exact unit, for echoing in messages. */
export function formatTtl(ms: number): string {
  if (ms % (24 * 60 * 60 * 1000) === 0) return `${ms / (24 * 60 * 60 * 1000)}d`;
  if (ms % (60 * 60 * 1000) === 0) return `${ms / (60 * 60 * 1000)}h`;
  if (ms % (60 * 1000) === 0) return `${ms / (60 * 1000)}m`;
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}

// ---------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------

/** Compact human duration: `45s`, `12m`, `3h12m`, `2d3h`. Negative clamps to 0s. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;

  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) return restMinutes === 0 ? `${hours}h` : `${hours}h${restMinutes}m`;

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days}d` : `${days}d${restHours}h`;
}

// ---------------------------------------------------------------------------
// Inspection
// ---------------------------------------------------------------------------

export type ClaimState =
  /** Nobody holds this ref. */
  | "unclaimed"
  /** Held by the acting session. */
  | "own"
  /** Held by ANOTHER session and not yet expired — the collision case. */
  | "held"
  /** Held by another session but past `expiresAt` — takeable, with a notice. */
  | "stale";

export type ClaimStatus = {
  ref: string;
  state: ClaimState;
  claim: SessionClaim | null;
  /** How long ago the claim was taken (ms). 0 when unclaimed. */
  ageMs: number;
  /** ms until expiry; negative once expired. 0 when unclaimed. */
  expiresInMs: number;
  /** `12m` — age, pre-formatted for messages. */
  ageLabel: string;
  /** `expires in 7h48m` / `expired 2h ago` / `` when unclaimed. */
  expiryLabel: string;
};

function parseInstant(iso: string): number | null {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/**
 * Classify one ref against the acting session.
 *
 * An UNPARSEABLE `expiresAt` is treated as already expired (STALE) rather than
 * as live: a corrupt timestamp must not be able to hold a spec hostage forever,
 * and STALE is the state that still names the holder out loud.
 */
export function inspectClaim(
  doc: ClaimsDoc,
  ref: string,
  session: string | null,
  now: Date = new Date(),
  host: string = hostName(),
): ClaimStatus {
  const claim = doc.claims[ref];
  if (claim === undefined) {
    return {
      ref,
      state: "unclaimed",
      claim: null,
      ageMs: 0,
      expiresInMs: 0,
      ageLabel: "0s",
      expiryLabel: "",
    };
  }

  const nowMs = now.getTime();
  const atMs = parseInstant(claim.at);
  const expMs = parseInstant(claim.expiresAt);
  const ageMs = atMs === null ? 0 : nowMs - atMs;
  const expiresInMs = expMs === null ? -1 : expMs - nowMs;
  const expired = expiresInMs <= 0;

  // A claim taken on another host is never this session's, whatever its id:
  // it is a live peer claim until its TTL. An old entry has no host.
  const sameHost = claim.host === undefined || claim.host === host;
  const state: ClaimState =
    session !== null && claim.session === session && sameHost ? "own" : expired ? "stale" : "held";

  return {
    ref,
    state,
    claim,
    ageMs,
    expiresInMs,
    ageLabel: formatDuration(ageMs),
    expiryLabel: expired
      ? `expired ${formatDuration(-expiresInMs)} ago`
      : `expires in ${formatDuration(expiresInMs)}`,
  };
}

/** Every outstanding claim, oldest-claimed first, classified against `session`. */
export function listClaims(
  doc: ClaimsDoc,
  session: string | null = null,
  now: Date = new Date(),
  host: string = hostName(),
): ClaimStatus[] {
  return Object.keys(doc.claims)
    .map((ref) => inspectClaim(doc, ref, session, now, host))
    .sort((a, b) => b.ageMs - a.ageMs || a.ref.localeCompare(b.ref));
}

/**
 * Who holds a claim, for messages: `session <id>`, and ` on <host>` when the
 * claim names a host other than this one (0.75.0).
 */
export function claimHolder(claim: SessionClaim | null, host: string = hostName()): string {
  if (claim === null) return "session unknown";
  const where = claim.host !== undefined && claim.host !== host ? ` on ${claim.host}` : "";
  return `session ${claim.session}${where}`;
}

/** One line per claim, for doctor / `claim --list`. */
export function formatClaimLine(status: ClaimStatus, host: string = hostName()): string {
  const claim = status.claim;
  if (claim === null) return `${status.ref} — unclaimed`;
  const stale = status.state === "stale" ? "STALE " : "";
  const mine = status.state === "own" ? " (this session)" : "";
  return `${status.ref} — ${stale}${claimHolder(claim, host)}, claimed ${status.ageLabel} ago, ${status.expiryLabel}${mine}`;
}

// ---------------------------------------------------------------------------
// Ref normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a spec reference to the key used in the claims file.
 *
 * Since 0.76.0 the key is the TRACKER-relative path (`M1-x/02-y.md`), the
 * same whatever form was passed, so two sessions can never hold one spec
 * under two keys. Resolution order, first form that exists on disk wins:
 *   1. relative to `cwd` (what a human types), unless `cwd` is null
 *   2. relative to the repo root (`.tracker/M1-x/02-y.md`, a thread's `spec:`)
 *   3. relative to `.tracker/` (`M1-x/02-y.md`)
 *
 * A ref that resolves to nothing, or to a file outside `.tracker/`, is kept
 * verbatim (minus `./`). `claim` and `release` refuse such a ref; readers
 * keep old entries as they are.
 */
export function normalizeClaimRef(opts: {
  trackerRoot: string;
  ref: string;
  cwd?: string | null;
}): string {
  return canonicalSpecRef(opts) ?? opts.ref.trim().replace(/^\.\//, "");
}

/**
 * The tracker-relative path of an existing spec file inside `.tracker/`, or
 * null (0.76.0). See {@link normalizeClaimRef} for the resolution order.
 */
export function canonicalSpecRef(opts: { trackerRoot: string; ref: string; cwd?: string | null }): string | null {
  const { trackerRoot, ref } = opts;
  const cwd = opts.cwd === undefined ? process.cwd() : opts.cwd;
  const repoRoot = dirname(resolve(trackerRoot));
  const trimmed = ref.trim().replace(/^\.\//, "");
  if (trimmed === "") return null;

  const candidates = isAbsolute(trimmed)
    ? [trimmed]
    : [...(cwd === null ? [] : [resolve(cwd, trimmed)]), resolve(repoRoot, trimmed), resolve(trackerRoot, trimmed)];

  for (const candidate of candidates) {
    if (!existsSync(candidate) || !isFileSafe(candidate)) continue;
    const inside = insideTracker(trackerRoot, candidate);
    if (inside !== null) return inside;
  }
  return null;
}

function isFileSafe(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** `candidate` relative to `.tracker/` when it lies inside it (through the link or its target). */
function insideTracker(trackerRoot: string, candidate: string): string | null {
  const direct = relative(resolve(trackerRoot), resolve(candidate));
  if (direct !== "" && !direct.startsWith("..") && !isAbsolute(direct)) return direct.split(sep).join("/");
  try {
    const real = relative(realpathSync(trackerRoot), realpathSync(candidate));
    if (real !== "" && !real.startsWith("..") && !isAbsolute(real)) return real.split(sep).join("/");
  } catch {
    return null;
  }
  return null;
}

/**
 * Re-key a claims map through {@link normalizeClaimRef} without the cwd, so
 * entries written under an older key form (repo-relative, absolute) read as
 * the canonical key. On a collision the newer claim (`at`) wins.
 */
function canonicalKeys(trackerRoot: string, entries: Record<string, SessionClaim>): Record<string, SessionClaim> {
  const out: Record<string, SessionClaim> = {};
  for (const [ref, claim] of Object.entries(entries)) {
    const key = normalizeClaimRef({ trackerRoot, ref, cwd: null });
    const prev = out[key];
    if (prev === undefined || (parseInstant(claim.at) ?? 0) > (parseInstant(prev.at) ?? 0)) out[key] = claim;
  }
  return out;
}
