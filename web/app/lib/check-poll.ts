/**
 * How the page follows a "Check now" (0.95.0). A check runs for minutes and
 * writes only its final `vigil.swept` line, so the page asks again until the
 * pending start of the check (`WebContext.pending`, spec 02) is not `starting`
 * any more. Pure: `CheckNow` holds the timer, this file says when to look, how
 * long to keep looking, and what the pending start means.
 */

import type { PendingStart } from "../../../src/web/api.ts";

/** The page stops looking this long after the check was asked for. The pending start stays `starting` for 15 minutes; a person can reload to see more. */
export const CHECK_WINDOW_MS = 3 * 60 * 1000;

/**
 * When the look number `step` (from 0) happens, in milliseconds after the page
 * saw the pending start: 1.5 s, 5 s, then every 5 s (10 s, 15 s, ...).
 */
export function lookAt(step: number): number {
  if (step === 0) return 1500;
  return 5000 * step;
}

/**
 * What a check is doing, for the button: `idle` (no check to follow: none was asked, or it started and
 * its sweep is in the list), `checking` (the page is looking), `stalled` (3 minutes passed with no
 * result: the page stopped looking), `refused` (the command would not start it) and `lost` (no sign
 * after 15 minutes). Only `checking` keeps the timer running.
 */
export type CheckPhase = "idle" | "checking" | "stalled" | "refused" | "lost";

/** The phase of a pending start at time `now` (ms). */
export function checkPhase(pending: Pick<PendingStart, "state" | "at"> | null, now: number): CheckPhase {
  if (pending === null || pending.state === "started") return "idle";
  if (pending.state === "refused") return "refused";
  if (pending.state === "lost") return "lost";
  return now - Date.parse(pending.at) >= CHECK_WINDOW_MS ? "stalled" : "checking";
}

/** The newest check of one vigil that has not started (`starting`), from the starts of a project or of all. Null when there is none. */
export function startingCheck(starts: readonly PendingStart[], project: string, slug: string): PendingStart | null {
  const found = starts.filter((start) => start.kind === "vigil-check" && start.state === "starting" && start.project === project && start.vigil === slug);
  return found.toSorted((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0))[0] ?? null;
}

/** The `project/slug` key of a vigil, for a map of its checks. */
export function checkKey(project: string, slug: string): string {
  return `${project}/${slug}`;
}
