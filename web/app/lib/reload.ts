/**
 * Looking again after an action (0.89.0). A POST starts a CLI process, and
 * the ledger line that shows its result lands a moment later: a run a second
 * or two, a check minutes. After any reply, a pending one and an error too,
 * the page loads its data again at these delays, so the "starting" entry or
 * the receipt shows without a manual reload.
 */

import { useCallback } from "react";
import { useRevalidator } from "react-router";

/** Milliseconds after the reply. */
export const RELOAD_STEPS_MS = [1500, 5000, 15000];

/**
 * A function that schedules the reloads. The timers are not tied to the
 * component: a card that unmounts when its data changes does not cancel the
 * later looks. The three steps cover a run (seconds); a check that takes
 * minutes shows its "starting" entry and then waits for the 60 s refresh of
 * the root.
 */
export function useReloadSoon(): () => void {
  const { revalidate } = useRevalidator();
  return useCallback(() => {
    for (const delay of RELOAD_STEPS_MS) setTimeout(() => void revalidate(), delay);
  }, [revalidate]);
}
