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
  const logged = log.some((l) => l.sha256 === sha && l.status === "ready" && (l.kind === "round" || l.kind === "ack"));
  if (!logged) {
    return { ok: false, reason: `no counsel-gate run recorded a ready review of ${spec} with transcript ${sha.slice(0, 12)}. Re-run counsel-gate` };
  }
  return { ok: true, how: `reviewed ${counsel}` };
}
