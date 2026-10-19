/**
 * The lines about a wait (one gem for each wait, where the
 * person tapped).
 *
 * - `GemLine` is one line with the busy gem. It belongs to a state that owns
 *   its wait: the check that runs ("Checking on ..."), the card that waits
 *   for a start, the follow-up card while its readiness loads.
 * - `WaitLine` is the line under a button whose POST has no reply. The button
 *   already shows the gem, so this line is text only, and it shows after 2 s,
 *   not at once: most replies come sooner.
 *
 * Both sit in a live region for screen readers.
 */

import { useRouteLoaderData } from "react-router";

import type { loader as rootLoader } from "../root.tsx";
import { useAfter } from "../lib/use-after.ts";
import { waitingText, WAIT_LINE_AFTER_MS, type WaitKind } from "../lib/follow-up-load.ts";
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
  /** What the host is asked to start. */
  what?: WaitKind;
}

/** The text under a busy button: "Asking <host> to start the run." It shows after 2 s of `active`, and it has no gem. Only an empty live region renders before. */
export function WaitLine({ active, host, what = "run" }: WaitLineProps): React.ReactNode {
  const own = useRouteLoaderData<typeof rootLoader>("root")?.host ?? "the host";
  const late = useAfter(active, WAIT_LINE_AFTER_MS);
  // The live region stays in the page, so a screen reader announces the line when it fills.
  return <div role="status">{late ? <p className="rail-note">{waitingText(host ?? own, what)}</p> : null}</div>;
}
