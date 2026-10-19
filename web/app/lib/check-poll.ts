/**
 * The words and the small rules of a "Check now" (spec 02, since 0.95.0).
 * The page follows a check with the light poll of `follow-starts.ts`; this
 * file holds what is left of the old reload polling: which pending start a
 * vigil shows, and every sentence of the check. Pure, so a test can hold each
 * one. The state words are the ones of the design table: a vigil is
 * *checking*, never *starting*.
 */

import type { PendingStart } from "../../../src/web/api.ts";
import { clockTime } from "./format.ts";

/** A check inside this time after the last one is refused (the CLI's cooldown, `SWEEP_COOLDOWN_MS` in src/core/sweep.ts). */
export const COOLDOWN_MS = 2 * 60 * 1000;
/** After this long the line says that the result shows here, since the check takes longer than most. */
export const LONG_CHECK_MS = 3 * 60 * 1000;

/** The newest check of one vigil that has not started (`starting`), from the starts of a project or of all. Null when there is none. */
export function startingCheck(starts: readonly PendingStart[], project: string, slug: string): PendingStart | null {
  const found = starts.filter((start) => start.kind === "vigil-check" && start.state === "starting" && start.project === project && start.vigil === slug);
  return found.toSorted((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0))[0] ?? null;
}

/** The `project/slug` key of a vigil, for a map of its checks. */
export function checkKey(project: string, slug: string): string {
  return `${project}/${slug}`;
}

/** "40 s" under a minute, "4 min" after. */
export function elapsedText(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min`;
}

/** The line of a check that runs. It ticks: the caller passes the time since the ask. */
export function checkingText(host: string, ageMs: number): string {
  const so = `${elapsedText(ageMs)} so far`;
  return ageMs >= LONG_CHECK_MS ? `Still checking on ${host}, ${so}. The result shows here.` : `Checking on ${host}, ${so}. Most checks end within a minute.`;
}

/** What a sweep outcome says in the line of a finished check: `held` closes the vigil (passed), `failed` keeps it flagged. Other outcomes say nothing. */
export function outcomeWord(outcome: string | null): string | null {
  if (outcome === "held") return "passed";
  if (outcome === "failed") return "still failing";
  return null;
}

/** "Checked 07:24: passed." / "Checked 07:24: still failing." / "Checked 07:24." when the outcome is not known. */
export function checkedText(time: string, outcome: string | null): string {
  const word = outcomeWord(outcome);
  return word === null ? `Checked ${time}.` : `Checked ${time}: ${word}.`;
}

/**
 * The label of the disabled button inside the cooldown: "Checked 1 min ago. Check again at 07:26."
 * Null when the cooldown is over. `retryAt` is the server's time when it gave one; otherwise it is the
 * last check plus the cooldown.
 */
export function cooldownText(lastCheckedAt: string, now: number, offset: number, retryAt?: string): string | null {
  const checked = Date.parse(lastCheckedAt);
  if (Number.isNaN(checked)) return null;
  const retryMs = retryAt === undefined ? Number.NaN : Date.parse(retryAt);
  const retry = Number.isNaN(retryMs) ? checked + COOLDOWN_MS : retryMs;
  if (retry <= now) return null;
  const minutes = Math.max(1, Math.round((now - checked) / 60_000));
  return `Checked ${minutes} min ago. Check again at ${clockTime(new Date(retry).toISOString(), offset)}.`;
}

/** The sentence of a check that did not start. The reason is the server's; without one the sentence stops at the host. */
export function refusedText(host: string, reason: string | undefined): string {
  if (reason === undefined || reason.trim() === "") return `${host} did not start the check.`;
  return `${host} did not start it: ${reason.trim().replace(/[.\s]+$/u, "")}.`;
}

/** The sentence of a start that shows nothing after 15 minutes. */
export function lostText(host: string, what: "check" | "run"): string {
  return `No sign of this ${what} on ${host} after 15 minutes.${what === "run" ? " Start it again from the ritual." : ""}`;
}

/** A start the page follows, from a reply or from the loader. */
export interface Asked {
  id: string;
  host: string;
  /** An ISO time. */
  at: string;
}

/** The newer of two asks; null when there is none. */
export function newerAsk(left: Asked | null, right: Asked | null): Asked | null {
  if (left === null) return right;
  if (right === null) return left;
  return right.at > left.at ? right : left;
}
