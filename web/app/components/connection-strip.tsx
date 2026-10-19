/**
 * The connection strip: one line under the phone top bar, and under the
 * Places head on a desktop. It is an overlay, so it moves no layout.
 *
 * Red while the host is away: "No connection. Showing what was saved at
 * 07:24." with Retry (ask /healthz, then reload the data) and a close button.
 * A close lasts one outage: the next outage shows the strip again. Green
 * "Connected" for 1.8 s when the host is back. One strip at a time.
 *
 * The state comes from lib/connection.ts; the time is the saved time of the
 * copy on screen, else the read time of the page.
 */

import { useState } from "react";
import { useRevalidator } from "react-router";

import { NavIcon } from "./nav-icons.tsx";
import { useClock } from "../lib/clock.tsx";
import { probeHost, shownTime, useConnection } from "../lib/connection.ts";
import { clockTime } from "../lib/format.ts";

interface ConnectionStripProps {
  /** When the root data on screen was read: the time to name when the worker named none. */
  generatedAt: string;
}

export function ConnectionStrip({ generatedAt }: ConnectionStripProps): React.ReactNode {
  const state = useConnection();
  const { offset } = useClock();
  const { revalidate } = useRevalidator();
  // The outage that was closed, by its start: a new outage has another start and shows again.
  const [closed, setClosed] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const retry = async (): Promise<void> => {
    setChecking(true);
    try {
      if (await probeHost()) await revalidate();
    } finally {
      setChecking(false);
    }
  };
  const lost = state.lost && state.since !== closed;
  // The live region is always in the page, so a screen reader hears the line when it appears.
  return (
    <div className="conn-slot" role="status">
      {lost ? (
        <div className="conn-strip tone-bad">
          <span className="conn-text">{`No connection. Showing what was saved at ${clockTime(shownTime(state, generatedAt), offset)}.`}</span>
          <button type="button" className="conn-btn" onClick={() => void retry()} disabled={checking} aria-busy={checking}>
            Retry
          </button>
          <button type="button" className="conn-btn conn-close" aria-label="Hide this notice" onClick={() => setClosed(state.since)}>
            <NavIcon name="close" size={16} />
          </button>
        </div>
      ) : state.justConnected ? (
        <div className="conn-strip tone-ok">
          <span className="conn-text">Connected</span>
        </div>
      ) : null}
    </div>
  );
}
