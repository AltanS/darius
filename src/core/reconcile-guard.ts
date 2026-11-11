/**
 * The reconcile guard (0.129.0; docs/concept.md, "Cross-host guards"): a host
 * may reconcile a project's marker into the store only when its checkout is
 * not older than the marker the store was last reconciled from.
 *
 * Why: two hosts hold their own checkouts. A host that had not pulled read
 * its older marker, saw a ritual the newer host had adopted, and retired it.
 * A retired slug never comes back. The two hosts also rewrote each other's
 * definitions on every reconcile.
 *
 * The record is the newest `ritual.defined` ledger line of the project, from
 * any host (reconcile writes one per adopted, updated or retired slug, with
 * `commit`, and since 0.129.0 `marker_hash`). run-due syncs first, so the
 * other host's lines are here. Let R be the record's commit and H this
 * checkout's HEAD:
 *
 *   - `--force`, no record, a record with no commit (an older darius, or a
 *     checkout outside git), or a checkout that is no git work tree or has
 *     no commit: reconcile as before.
 *   - R is H, or R is an ancestor of H: the checkout is the same or newer.
 *     Reconcile.
 *   - Else, when the marker file hashes the same as the record's
 *     `marker_hash`: the store already holds this content. Write nothing.
 *   - Else, when this host wrote the record itself (0.129.1): its own
 *     checkout moved (a rebase, an amend, a branch switch, a checkout of an
 *     older commit). Reconcile as before 0.129.0, with a note.
 *   - Else (H is an ancestor of R, R is not in this repo, or the histories
 *     diverged): the checkout is stale. Write nothing: no adopt, no update,
 *     no retire. run-due skips the project's repo rituals as
 *     `checkout-stale` and says so.
 *
 * Local git only, no fetch, so it works offline. Each git call has a
 * timeout. A git error (no git, a broken repo, a timeout) reconciles as
 * before, with a note: only a proven stale checkout stops a reconcile. A
 * shallow repo that lacks R, or reads as diverged, cannot prove it, so it
 * reconciles too, with a note.
 *
 * Own-host limit: a host that checks out an older commit retires what the
 * newer commit added, as before 0.129.0, and the retire is final. A rule
 * "an own record never retires while the checkout is older" would hold for
 * one pass only: that pass records the older commit.
 *
 * Known limit: "newest" is by ledger id, and an id carries its host's clock.
 * Two hosts whose clocks differ by more than the time between their
 * reconciles can pick the older line, and a host can then judge itself
 * current against an older commit.
 *
 * The stale finding is kept in `<store>/<project>/marker-stale.json` (local,
 * never synced) for `darius doctor`; the next reconcile that is not stale
 * removes it.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { JsonValue, LedgerLine } from "./model.ts";
import type { Project } from "./store.ts";

/** Each local git call of the guard. */
export const GUARD_GIT_TIMEOUT_MS = 5_000;
/** The ledger line type that carries the record (reconcile.ts writes it). */
const RECORD_TYPE = "ritual.defined";
const STALE_FILE = "marker-stale.json";
/** The dirty marker the last reconcile held (0.135.0): local, never synced, for doctor. */
const HELD_FILE = "marker-dirty.json";
/** A commit as darius writes it: hex, 7 to 64 characters. Anything else is no commit. */
const COMMIT_PATTERN = /^[0-9a-f]{7,64}$/u;
const SHORT = 12;

/** The newest reconcile record of a project. */
export interface ReconcileRecord {
  id: string;
  host: string;
  at: string;
  /** The checkout's commit the marker was read from; absent from an older darius or outside git. */
  commit?: string;
  /** sha256 of the marker file; absent before 0.129.0. */
  markerHash?: string;
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The newest `ritual.defined` line of the ledger, as a record, or null when there is none. */
export function latestRecord(ledger: readonly LedgerLine[]): ReconcileRecord | null {
  const line = ledger.findLast((entry) => entry.type === RECORD_TYPE);
  if (line === undefined) return null;
  const record: ReconcileRecord = { id: line.id, host: line.host, at: line.at };
  if (isText(line.commit) && COMMIT_PATTERN.test(line.commit)) record.commit = line.commit;
  if (isText(line.marker_hash)) record.markerHash = line.marker_hash;
  return record;
}

/** sha256 hex of the marker file's bytes, as `marker_hash` records it. */
export function markerHash(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

// --- git ----------------------------------------------------------------------------

type GitCall = { ok: true; out: string } | { ok: false; status: number | null; error: string };

function gitCall(dir: string, args: readonly string[]): GitCall {
  // C locale: headFacts reads git's "not a git repository" text.
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C", LANGUAGE: "" };
  const result = spawnSync("git", args, { cwd: dir, env, encoding: "utf8", timeout: GUARD_GIT_TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"] });
  if (result.error !== undefined) {
    const code = "code" in result.error ? result.error.code : undefined;
    if (code === "ENOENT") return { ok: false, status: null, error: "git is not installed" };
    if (code === "ETIMEDOUT") return { ok: false, status: null, error: `git ${args[0] ?? ""} timed out after ${String(GUARD_GIT_TIMEOUT_MS / 1000)} s` };
    return { ok: false, status: null, error: result.error.message };
  }
  if (result.status !== 0) {
    const first = result.stderr.trim().split("\n")[0]?.trim() ?? "";
    return { ok: false, status: result.status, error: first === "" ? `git ${args[0] ?? ""} exited ${String(result.status)}` : first };
  }
  return { ok: true, out: result.stdout.trim() };
}

/** This checkout's HEAD: a full commit, no git repo here (or no commit yet), or a git error. */
export type HeadFacts = { state: "commit"; head: string } | { state: "none"; reason: string } | { state: "error"; error: string };

export function headFacts(checkout: string): HeadFacts {
  const inside = gitCall(checkout, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok && inside.status !== null && /not a git repository/u.test(inside.error)) return { state: "none", reason: "not a git work tree" };
  if (!inside.ok) return { state: "error", error: inside.error };
  if (inside.out !== "true") return { state: "none", reason: "not a git work tree" };
  const head = gitCall(checkout, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
  if (head.ok) return { state: "commit", head: head.out };
  // --quiet: exit 1 with no output is "no such commit", a repo with no commit yet.
  if (head.status === 1) return { state: "none", reason: "no commit yet" };
  return { state: "error", error: head.error };
}

/** Where R stands from H. `shallow`: the repo is shallow, so `unknown` and `diverged` prove nothing. */
export type Relation = "same" | "newer" | "behind" | "unknown" | "diverged";
export type RelationResult = { relation: Relation; shallow: boolean } | { error: string };

function isShallow(checkout: string): boolean {
  const out = gitCall(checkout, ["rev-parse", "--is-shallow-repository"]);
  return out.ok && out.out === "true";
}

/** The ancestor test: whether `older` is an ancestor of `newer`, or the git error. */
function ancestry(checkout: string, older: string, newer: string): { isAncestor: boolean } | { error: string } {
  const out = gitCall(checkout, ["merge-base", "--is-ancestor", older, newer]);
  if (out.ok) return { isAncestor: true };
  if (out.status === 1) return { isAncestor: false };
  return { error: out.error };
}

/** How the record's commit `recorded` stands from `head` in `checkout`, by local git only. */
export function commitRelation(checkout: string, recorded: string, head: string): RelationResult {
  if (!COMMIT_PATTERN.test(recorded)) return { error: `the recorded commit '${recorded}' is not a commit id` };
  const resolved = gitCall(checkout, ["rev-parse", "--verify", "--quiet", `${recorded}^{commit}`]);
  if (!resolved.ok && resolved.status === 1) return { relation: "unknown", shallow: isShallow(checkout) };
  if (!resolved.ok) return { error: resolved.error };
  if (resolved.out === head) return { relation: "same", shallow: false };
  const forward = ancestry(checkout, resolved.out, head);
  if ("error" in forward) return forward;
  if (forward.isAncestor) return { relation: "newer", shallow: false };
  const backward = ancestry(checkout, head, resolved.out);
  if ("error" in backward) return backward;
  if (backward.isAncestor) return { relation: "behind", shallow: false };
  return { relation: "diverged", shallow: isShallow(checkout) };
}

// --- the decision -----------------------------------------------------------------------

/** A stale checkout: what the store holds, and how this checkout stands from it. */
export interface StaleMarker {
  relation: "behind" | "unknown" | "diverged";
  /** The host of the newest record. */
  host: string;
  /** The record's commit, as recorded. */
  commit: string;
  /** When the record was written. */
  at: string;
}

export type GuardDecision =
  | { action: "reconcile"; why: "force" | "no-record" | "no-commit" | "no-git" | "same" | "newer" | "git-error" | "shallow" | "own-host"; note?: string }
  | { action: "unchanged"; why: "same-marker" }
  | { action: "stale"; stale: StaleMarker };

export interface GuardInput {
  record: ReconcileRecord | null;
  head: HeadFacts;
  markerHash: string;
  force: boolean;
  /** Asked only when the record and the checkout both have a commit. */
  relation: (recorded: string, head: string) => RelationResult;
  /** This host's ledger id (`hostId()`): a record it wrote itself never makes its checkout stale (0.129.1). */
  thisHost: string;
  /** The project's name, for the note. */
  project: string;
}

function shortCommit(commit: string): string {
  return commit.slice(0, SHORT);
}

/** Whether this checkout may reconcile, by the rules in the header. */
export function decideReconcile(input: GuardInput): GuardDecision {
  const { record, head } = input;
  if (input.force) return { action: "reconcile", why: "force" };
  if (record === null) return { action: "reconcile", why: "no-record" };
  if (record.commit === undefined) return { action: "reconcile", why: "no-commit" };
  if (head.state === "none") return { action: "reconcile", why: "no-git" };
  const recorded = record.commit;
  const cannot = (error: string): GuardDecision => ({
    action: "reconcile",
    why: "git-error",
    note: `cannot compare this checkout with the commit of the last reconcile (${shortCommit(recorded)} on ${record.host}): ${error}; reconciled as before`,
  });
  if (head.state === "error") return cannot(head.error);
  const found = input.relation(recorded, head.head);
  if ("error" in found) return cannot(found.error);
  const { relation } = found;
  if (relation === "same" || relation === "newer") return { action: "reconcile", why: relation };
  if (record.markerHash !== undefined && record.markerHash === input.markerHash) return { action: "unchanged", why: "same-marker" };
  // 0.129.1: this host wrote the record, so its own checkout moved (a rebase, an amend, a branch switch). That is the operator's act here, and it reconciles as before 0.129.0.
  if (record.host === input.thisHost) {
    return {
      action: "reconcile",
      why: "own-host",
      note: `the checkout of ${input.project} moved off the commit this host last reconciled (${shortCommit(recorded)}); reconciling from the checkout`,
    };
  }
  if (found.shallow && relation !== "behind") {
    return {
      action: "reconcile",
      why: "shallow",
      note: `this shallow checkout cannot tell whether it is older than the commit of the last reconcile (${shortCommit(recorded)} on ${record.host}); reconciled as before`,
    };
  }
  return { action: "stale", stale: { relation, host: record.host, commit: recorded, at: record.at } };
}

/** The one line the report, the alert and doctor say about a stale checkout. */
export function staleLine(project: string, stale: StaleMarker): string {
  const held = `the marker the store holds (reconciled on ${stale.host} at ${shortCommit(stale.commit)})`;
  if (stale.relation === "behind") return `the checkout of ${project} is older than ${held}: pull it`;
  const rebased = "pull it, or after a rebase run darius ritual reconcile --force";
  if (stale.relation === "unknown") return `the checkout of ${project} lacks the commit of ${held}: ${rebased}`;
  return `the checkout of ${project} is not on the history of ${held}: ${rebased}`;
}

// --- the record doctor reads ------------------------------------------------------------

export interface StaleRecord {
  at: string;
  checkout: string;
  line: string;
}

/** The dirty marker the last reconcile held (0.135.0), in `marker-dirty.json`: the same shape. */
export type HeldRecord = StaleRecord;

function writeRecordFile(file: string, record: StaleRecord | null): void {
  if (record === null) {
    rmSync(file, { force: true });
    return;
  }
  const temp = `${file}.tmp-${String(process.pid)}`;
  writeFileSync(temp, `${JSON.stringify({ v: 1, ...record })}\n`);
  renameSync(temp, file);
}

function readRecordFile(file: string): StaleRecord | null {
  if (!existsSync(file)) return null;
  try {
    const parsed: JsonValue = JSON.parse(readFileSync(file, "utf8"));
    if (!isRecord(parsed)) return null;
    const { at, checkout, line } = parsed;
    if (!isText(at) || !isText(checkout) || !isText(line)) return null;
    return { at, checkout, line };
  } catch {
    return null;
  }
}

/** Writes `marker-stale.json` in the project's local store dir, or removes it when `record` is null. Never synced. */
export function writeStaleRecord(project: Project, record: StaleRecord | null): void {
  writeRecordFile(join(project.root, STALE_FILE), record);
}

/** The last stale finding, or null when there is none or it does not read. */
export function readStaleRecord(project: Project): StaleRecord | null {
  return readRecordFile(join(project.root, STALE_FILE));
}

/** Writes `marker-dirty.json` in the project's local store dir, or removes it when `record` is null. Never synced. */
export function writeHeldRecord(project: Project, record: HeldRecord | null): void {
  writeRecordFile(join(project.root, HELD_FILE), record);
}

/** The dirty marker the last reconcile held, or null when there is none or it does not read. */
export function readHeldRecord(project: Project): HeldRecord | null {
  return readRecordFile(join(project.root, HELD_FILE));
}

/** What `darius doctor` says: one line, or none. */
export function staleDoctorLine(record: StaleRecord | null): string | null {
  if (record === null) return null;
  return `WARN: ${record.line} (reconcile, ${record.at}). Until then this host does not reconcile the marker and skips the project's rituals.`;
}

/** What `darius doctor` says about a held dirty marker: one line, or none. */
export function heldDoctorLine(record: HeldRecord | null): string | null {
  if (record === null) return null;
  return `WARN: ${record.line} (reconcile, ${record.at}). Until then the store keeps the definitions it has.`;
}
