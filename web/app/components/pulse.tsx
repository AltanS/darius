/** Small parts of the pages: one count of the status strip, a list that is short on a phone, a run clock. */

import { useEffect, useState } from "react";
import { Link } from "react-router";

import { useClock } from "../lib/clock.tsx";
import { duration } from "../lib/format.ts";
import type { Kind } from "../lib/kind.ts";
import type { Tone } from "../lib/tone.ts";
import { KindIcon } from "./kind.tsx";

interface PillProps {
  label: string;
  value: number;
  /** The colour while the count is above zero; a zero is always grey. */
  tone: Tone;
  /** A `#anchor` scrolls the page, anything else opens the route; null when there is nothing to open. */
  href: string | null;
  /** Sweep a light along the top edge while the count is above zero. */
  live?: boolean;
  /** Mark the segment with the icon of a kind instead of a square. */
  kind?: Kind | null;
}

/** One count of the status strip. The whole segment is the link. */
export function Pill({ label, value, tone, href: target, live = false, kind = null }: PillProps): React.ReactNode {
  const on = value > 0;
  const className = `pill tone-${on ? tone : "idle"}`;
  const body = (
    <>
      {on && live ? <span className="live-bar" aria-hidden="true" /> : null}
      {kind === null ? <span className="pill-dot" aria-hidden="true" /> : <KindIcon kind={kind} size={14} className={`pill-kind${on ? "" : " is-off"}`} />}
      <span className="pill-n">{value}</span>
      <span className="pill-l">{label}</span>
    </>
  );
  if (target === null) return <div className={className}>{body}</div>;
  if (target.startsWith("#")) {
    return (
      <a href={target} className={className}>
        {body}
      </a>
    );
  }
  return (
    <Link to={target} className={className}>
      {body}
    </Link>
  );
}

interface PhoneMoreProps {
  /** How many rows the phone hides until the button is pressed. */
  hidden: number;
  /** What one row is, for the button: "Show 6 more runs". */
  noun: string;
  /** Start open, for a link that points at a hidden row. */
  open?: boolean;
  children: React.ReactNode;
}

/**
 * A list that is short on a phone: rows marked `phone-extra` stay hidden until
 * the button under them is pressed. On a wide screen every row shows and the button does not.
 */
export function PhoneMore({ hidden, noun, open = false, children }: PhoneMoreProps): React.ReactNode {
  const [expanded, setExpanded] = useState(open);
  useEffect(() => {
    if (open) setExpanded(true);
  }, [open]);
  if (hidden <= 0) return children;
  return (
    <div className={`phone-more${expanded ? " is-open" : ""}`}>
      {children}
      <button type="button" className="phone-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        {expanded ? "Show fewer" : `Show ${hidden} more ${noun}${hidden === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}

interface ElapsedProps {
  since: string;
}

/** How long a run has run, against the page clock (it ticks every 30 s). */
export function Elapsed({ since }: ElapsedProps): React.ReactNode {
  const { now } = useClock();
  return <span>{duration(since, new Date(now).toISOString()) || "just now"}</span>;
}
