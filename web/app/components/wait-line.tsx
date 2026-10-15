/**
 * The lines with the busy gem (0.98.0): "Waiting for <host>…" under a button
 * that waits for a host, and the line a follow-up card shows while its
 * readiness loads. After 10 s a waiting line says that the run may start
 * after the page answers. The wait line sits in a live region for screen readers.
 */

import { useEffect, useState } from "react";
import { useRouteLoaderData } from "react-router";

import type { loader as rootLoader } from "../root.tsx";
import { waitingText } from "../lib/follow-up-load.ts";
import { Gem } from "./nav-icons.tsx";

/** One line with a busy gem and a text. It is no live region by itself: a region that appears with its text is not announced, so a caller that adds the line later wraps it in a `role="status"` element that is already there. */
export function GemLine({ text }: { text: string }): React.ReactNode {
  return (
    <p className="gem-line">
      <Gem size={14} busy />
      <span>{text}</span>
    </p>
  );
}

interface WaitLineProps {
  /** True while the POST has no reply. */
  active: boolean;
  /** The host that answers; the host of this page when absent. */
  host?: string;
}

/** The line under a busy button: it shows while `active`, and its text changes after 10 s. Only an empty live region renders otherwise. */
export function WaitLine({ active, host }: WaitLineProps): React.ReactNode {
  const own = useRouteLoaderData<typeof rootLoader>("root")?.host ?? "the host";
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - started), 1000);
    return () => clearInterval(timer);
  }, [active]);
  // The live region stays in the page, so a screen reader announces the line when it fills.
  return <div role="status">{active ? <GemLine text={waitingText(host ?? own, elapsed)} /> : null}</div>;
}
