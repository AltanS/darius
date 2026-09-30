/** The head of a project page: the status strip, and the panel for what is open now. */

import { useEffect, useState } from "react";
import { Link } from "react-router";

import type { VigilRow } from "../../../src/web/api.ts";
import { useClock } from "../lib/clock.tsx";
import { duration, runPath } from "../lib/format.ts";
import type { Kind } from "../lib/kind.ts";
import type { Tone } from "../lib/tone.ts";
import { runState, stuckText, type ActivityRun } from "../lib/view.ts";
import { KindIcon } from "./kind.tsx";
import { SectHead, Status, Time } from "./ui.tsx";

interface PillProps {
  label: string;
  value: number;
  /** A muted line after the label: what else there is to know. */
  sub?: string;
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
export function Pill({ label, value, sub, tone, href, live = false, kind = null }: PillProps): React.ReactNode {
  const on = value > 0;
  const className = `pill tone-${on ? tone : "idle"}`;
  const body = (
    <>
      {on && live ? <span className="live-bar" aria-hidden="true" /> : null}
      {kind === null ? <span className="pill-dot" aria-hidden="true" /> : <KindIcon kind={kind} size={14} className={`pill-kind${on ? "" : " is-off"}`} />}
      <span className="pill-n">{value}</span>
      <span className="pill-l">{label}</span>
      {sub === undefined ? null : <span className="pill-sub">{sub}</span>}
    </>
  );
  if (href === null) return <div className={className}>{body}</div>;
  if (href.startsWith("#")) {
    return (
      <a href={href} className={className}>
        {body}
      </a>
    );
  }
  return (
    <Link to={href} className={className}>
      {body}
    </Link>
  );
}

/** A run that is open or waits for a person, with a word when it may be stuck. */
export interface LiveRun {
  run: ActivityRun;
  stuck: string | null;
}

export interface PulseData {
  project: string;
  live: readonly LiveRun[];
  openVigils: readonly VigilRow[];
  /** Rituals and dated vigils past due: the last segment, a link to Coming up. */
  overdue: number;
  /** Armed vigils without a due date: the vigils segment opens their list. */
  waiting: number;
}

interface PulseProps {
  data: PulseData;
}

/** Whether an armed vigil is due today or late; one without a date never is. */
export function vigilIsDue(vigil: VigilRow, today: string): boolean {
  return vigil.due !== null && vigil.due <= today;
}

/** Running, waiting for you, armed vigils, overdue: one slim strip, each segment opens what it counts. */
export function Pulse({ data }: PulseProps): React.ReactNode {
  const { today } = useClock();
  const running = data.live.filter(({ run }) => run.phase === "running").length;
  const waiting = data.live.length - running;
  const flagged = data.openVigils.filter((vigil) => vigil.flagged).length;
  const due = data.openVigils.filter((vigil) => vigilIsDue(vigil, today)).length;
  const runsHref = (state: string) => `/runs?project=${encodeURIComponent(data.project)}&state=${state}`;
  const vigilSub = [flagged === 0 ? null : `${flagged} flagged`, due === 0 ? null : `${due} due`].filter((part) => part !== null).join(", ");
  return (
    <nav className="pulse stagger" aria-label="Summary">
      <Pill label="running" value={running} tone="run" href={running === 0 ? runsHref("running") : "#now"} live />
      <Pill label="need you" value={waiting} tone="wait" href={waiting === 0 ? runsHref("held") : "#now"} />
      <Pill label="vigils armed" kind="vigil" value={data.openVigils.length} sub={vigilSub === "" ? undefined : vigilSub} tone={flagged > 0 ? "bad" : due > 0 ? "late" : "gold"} href={data.openVigils.length === 0 ? null : data.waiting === 0 ? "#coming-up" : "#waiting"} />
      <Pill label="overdue" value={data.overdue} tone="late" href={data.overdue === 0 ? null : "#coming-up"} />
    </nav>
  );
}

interface PhoneMoreProps {
  /** How many rows the phone hides until the button is pressed. */
  hidden: number;
  /** What the rows are, for the button: "Show 6 more runs". */
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
        {expanded ? "Show fewer" : `Show ${hidden} more ${noun}`}
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

interface LivePanelProps {
  live: readonly LiveRun[];
}

/** Runs that are open now or wait for a person. A running one sweeps a light along its top edge. */
export function LivePanel({ live }: LivePanelProps): React.ReactNode {
  return (
    <section id="now" className="section">
      <SectHead title="Now" />
      <div className="panel">
        {live.length === 0 ? (
          <p className="panel-empty">Nothing runs and nothing waits for you.</p>
        ) : (
          <ul className="rows stagger">
            {live.map(({ run, stuck }) => {
              const state = runState(run);
              const running = run.phase === "running";
              return (
                <li key={run.run}>
                  <Link to={runPath(run.project, run.run)} className={`row row-tight${running ? " row-live" : ""}`}>
                    {running ? <span className="live-bar" aria-hidden="true" /> : null}
                    <span className="row-main">
                      <span className="row-title has-kind">
                        <KindIcon kind={run.kind} titled className="kind-lead" />
                        {run.label}
                      </span>
                      <span className="row-sub">
                        {running ? <Elapsed since={run.startedAt} /> : <Time iso={run.startedAt} />}
                        {run.who === "timer" ? ", by timer" : `, by ${run.who}`}
                      </span>
                      {stuck === null ? null : <span className="row-sub tint tone-late">{stuckText(stuck)}</span>}
                      {run.phase === "held" && run.questions.length > 0 ? (
                        <span className="row-sub">
                          {run.questions.length} question{run.questions.length === 1 ? "" : "s"}
                        </span>
                      ) : null}
                    </span>
                    <Status tone={state.tone} label={state.label} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
