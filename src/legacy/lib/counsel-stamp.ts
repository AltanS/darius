/**
 * The review stamp that `counsel-gate` writes, and the check that dispatch
 * runs on it (0.76.0).
 *
 * A spec's `counsel:` frontmatter used to be the whole proof of review, and
 * any agent could type it. Now every gate run also appends one line to
 * `<trackerRoot>/.counsel-log.jsonl` (append-only, merged by line across
 * hosts like the verification ledger). A `ready` stamp names its transcript
 * and the transcript's sha256:
 *
 *   counsel: 2026-10-08T10:00:00Z
 *   counsel_transcript: M1-x/_counsel/02-y.md
 *   counsel_sha256: <64 hex>
 *
 * `worklog dispatch` (and `set-stage dispatched`) accept a spec that needs a
 * review only when the transcript exists, its hash matches the stamp, and the
 * log holds a `ready` line for the spec with that hash; or when the spec says
 * `counsel: overridden` and the log holds an override line with a reason.
 * A hand-written `counsel:` line has no log line, so it fails.
 *
 * Since 0.77.0 the stamp also holds `counsel_spec_sha256`, the hash of the
 * spec text the review saw (see `specContentSha256`): dispatch refuses a spec
 * that changed after its review. A stamp without the field is from an older
 * darius; it stays valid and `doctor` prints an info line.
 *
 * The round budget counts the log's round lines for the spec, never less than
 * the spec's `counsel_rounds:`: deleting or lowering the frontmatter counter
 * does not reset the budget.
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseFrontmatter } from "./markdown/frontmatter.ts";

export const COUNSEL_LOG_FILENAME = ".counsel-log.jsonl";

export type CounselLogKind = "round" | "ack" | "override";

export type CounselLogLine = {
  /** Tracker-relative spec path, as claims key it. */
  spec: string;
  kind: CounselLogKind;
  /** The gate status of this run; `overridden` for an override. */
  status: string;
  at: string;
  /** Tracker-relative transcript path and its sha256 (absent on an override). */
  transcript?: string;
  sha256?: string;
  /** Hash of the reviewed spec text (0.77.0), see `specContentSha256`. */
  spec_sha256?: string;
  format?: "review" | "counsel";
  rounds?: number;
  /** An override's reason. */
  reason?: string;
};

export function counselLogPath(trackerRoot: string): string {
  return join(trackerRoot, COUNSEL_LOG_FILENAME);
}

export function sha256OfFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * The hash of the spec text a review covers (0.77.0): the body without the
 * frontmatter, so the stamp, the ticks and the verification fields do not
 * change it, with every checklist box state read as the same box, so ticking
 * progress does not void the review. Line endings are normalised too.
 */
export function specContentSha256(raw: string): string {
  let body = raw;
  try {
    body = parseFrontmatter(raw).content;
  } catch {
    // A spec whose frontmatter does not parse: hash all of it.
  }
  const normalised = body
    .replace(/\r\n/g, "\n")
    .replace(/^(\s*- \[)[ xX~!-](\] )/gm, "$1 $2");
  return createHash("sha256").update(normalised).digest("hex");
}

export function appendCounselLog(trackerRoot: string, line: CounselLogLine): void {
  appendFileSync(counselLogPath(trackerRoot), `${JSON.stringify(line)}\n`, "utf-8");
}

/** Every parseable line for one spec, oldest first. A bad line is skipped. */
export function readCounselLog(trackerRoot: string, spec: string): CounselLogLine[] {
  const path = counselLogPath(trackerRoot);
  if (!existsSync(path)) return [];
  const out: CounselLogLine[] = [];
  for (const raw of readFileSync(path, "utf-8").split("\n")) {
    if (raw.trim() === "") continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) continue;
      const line = parsed as Partial<CounselLogLine>;
      if (line.spec !== spec || typeof line.kind !== "string" || typeof line.status !== "string") continue;
      out.push(parsed as CounselLogLine);
    } catch {
      continue;
    }
  }
  return out;
}

/** Rounds already spent on a spec: the log's round lines, never fewer than the frontmatter counter. */
export function spentRounds(trackerRoot: string, spec: string, frontmatterRounds: number): number {
  const logged = readCounselLog(trackerRoot, spec).filter((l) => l.kind === "round").length;
  return Math.max(logged, frontmatterRounds);
}

export type StampCheck = { ok: true; how: string } | { ok: false; reason: string };

function scalar(value: unknown): string | null {
  if (value === undefined || value === null || Array.isArray(value)) return null;
  return String(value).trim();
}

/**
 * Does the spec carry a review stamp that counsel-gate wrote? `spec` is the
 * tracker-relative key; `absSpecPath` the file to read.
 */
export function checkCounselStamp(trackerRoot: string, spec: string, absSpecPath: string): StampCheck {
  let data: Record<string, unknown>;
  try {
    data = parseFrontmatter(readFileSync(absSpecPath, "utf-8")).data as Record<string, unknown>;
  } catch (err) {
    return { ok: false, reason: `cannot read the frontmatter of ${spec}: ${err instanceof Error ? err.message : String(err)}` };
  }
  const counsel = scalar(data["counsel"]);
  const log = readCounselLog(trackerRoot, spec);
  if (counsel === null || counsel === "") {
    return { ok: false, reason: `${spec} is high risk and has no review stamp. Run the review and \`darius counsel-gate <transcript> --spec ${spec}\`` };
  }
  if (counsel === "overridden") {
    const override = [...log].reverse().find((l) => l.kind === "override" && typeof l.reason === "string" && l.reason.trim() !== "");
    if (override === undefined) {
      return { ok: false, reason: `${spec} says counsel: overridden, but no override was recorded. Use \`darius counsel-gate --spec ${spec} --override "<reason>"\`` };
    }
    return { ok: true, how: `overridden: ${override.reason ?? ""}` };
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(counsel)) {
    return { ok: false, reason: `${spec} has counsel: ${counsel}, which is not a passed review` };
  }
  const transcript = scalar(data["counsel_transcript"]);
  const sha = scalar(data["counsel_sha256"]);
  if (transcript === null || sha === null) {
    return { ok: false, reason: `${spec} has a counsel: stamp without counsel_transcript and counsel_sha256, so counsel-gate did not write it. Re-run counsel-gate` };
  }
  const file = resolve(trackerRoot, transcript);
  if (!existsSync(file)) {
    return { ok: false, reason: `the review transcript ${transcript} of ${spec} does not exist` };
  }
  if (sha256OfFile(file) !== sha) {
    return { ok: false, reason: `the review transcript ${transcript} changed after counsel-gate stamped ${spec}. Re-run counsel-gate` };
  }
  // Old stamps (before 0.77.0) have no spec hash and stay valid. A stamp
  // whose log line has a spec hash needs it: deleting the field from the
  // frontmatter does not turn a hashed review into an old one.
  const specSha = scalar(data["counsel_spec_sha256"]);
  const loggedHash = log.some((l) => l.sha256 === sha && l.status === "ready" && typeof l.spec_sha256 === "string");
  let current: string | null = null;
  if ((specSha !== null && specSha !== "") || loggedHash) {
    current = specContentSha256(readFileSync(absSpecPath, "utf-8"));
    if (current !== specSha) {
      return { ok: false, reason: `${spec} changed since its review. Run the review again, or use \`darius counsel-gate --spec ${spec} --override "<reason>"\`` };
    }
  }
  const logged = log.some(
    (l) =>
      l.sha256 === sha &&
      l.status === "ready" &&
      (l.kind === "round" || l.kind === "ack") &&
      (current === null || l.spec_sha256 === current),
  );
  if (!logged) {
    return { ok: false, reason: `no counsel-gate run recorded a ready review of ${spec} with transcript ${sha.slice(0, 12)}. Re-run counsel-gate` };
  }
  return { ok: true, how: `reviewed ${counsel}` };
}

/** True when the spec has a counsel-gate stamp from before 0.77.0: no `counsel_spec_sha256`. */
export function hasUnhashedStamp(data: Record<string, unknown>): boolean {
  const counsel = scalar(data["counsel"]);
  if (counsel === null || !/^\d{4}-\d{2}-\d{2}T/.test(counsel)) return false;
  if (scalar(data["counsel_transcript"]) === null) return false;
  const specSha = scalar(data["counsel_spec_sha256"]);
  return specSha === null || specSha === "";
}
