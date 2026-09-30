/** The head of a project page: the status strip, and the panel for what is open now. */

import { useEffect, useState } from "react";
import { Link } from "react-router";

import type { VigilRow } from "../../../src/web/api.ts";
import { useClock } from "../lib/clock.tsx";
import { duration, runPath } from "../lib/format.ts";
import type { Kind } from "../lib/kind.ts";
import { railOf } from "../lib/state-words.ts";
import type { Tone } from "../lib/tone.ts";
import { runState, stuckText, type ActivityRun } from "../lib/view.ts";
import { KindChips } from "./chip.tsx";
import { KindIcon } from "./kind.tsx";
import { Row, RowList } from "./row.tsx";
import { SectHead, Time } from "./ui.tsx";

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
export function Pill({ label, value, tone, href, live = false, kind = null }: PillProps): React.ReactNode {
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
  live: readonly LiveRun[];
  openVigils: readonly VigilRow[];
  /** Rituals and dated vigils past due: the late segment, a link to Coming up. */
  overdue: number;
  /** Rows due today that are not running or held now. */
  dueToday: number;
  /** Armed vigils without a due date: the vigils segment opens their list. */
  waiting: number;
  /** Flagged vigils among those without a due date: the flagged segment opens their list too. */
  flaggedWaiting: number;
}

interface PulseProps {
  data: PulseData;
}

/**
 * The status strip of a project: need you, running, flagged, late, due today,
 * vigils armed. A segment shows only above zero, and the strip not at all
 * when every segment is zero. Each segment opens what it counts.
 */
export function Pulse({ data }: PulseProps): React.ReactNode {
  const running = data.live.filter(({ run }) => run.phase === "running").length;
  const waiting = data.live.length - running;
  const flagged = data.openVigils.filter((vigil) => vigil.flagged).length;
  const armedHref = data.waiting === 0 ? "#coming-up" : "#waiting";
  const segments = [
    waiting === 0 ? null : <Pill key="need" label="need you" value={waiting} tone="wait" href="#now" />,
    running === 0 ? null : <Pill key="running" label="running" value={running} tone="run" href="#now" live />,
    flagged === 0 ? null : <Pill key="flagged" label="flagged" value={flagged} tone="bad" href={data.flaggedWaiting > 0 ? "#waiting" : "#coming-up"} />,
    data.overdue === 0 ? null : <Pill key="late" label="late" value={data.overdue} tone="late" href="#coming-up" />,
    data.dueToday === 0 ? null : <Pill key="today" label="due today" value={data.dueToday} tone="gold" href="#coming-up" />,
    data.openVigils.length === 0 ? null : <Pill key="armed" label="vigils armed" kind="vigil" value={data.openVigils.length} tone="gold" href={armedHref} />,
  ].filter((segment) => segment !== null);
  if (segments.length === 0) return null;
  return (
    <nav className="pulse pulse-home stagger" aria-label="Summary">
      {segments}
    </nav>
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

interface LivePanelProps {
  live: readonly LiveRun[];
}

/** Runs that are open now or wait for a person; nothing at all when there are none. A running one sweeps a light along its top edge. */
export function LivePanel({ live }: LivePanelProps): React.ReactNode {
  if (live.length === 0) return null;
  return (
    <section id="now" className="section">
      <SectHead title="Now" />
      <div className="panel">
        <RowList bare className="stagger">
          {live.map(({ run, stuck }) => {
            const state = runState(run);
            const running = run.phase === "running";
            const questions = run.phase === "held" && run.questions.length > 0 ? `${run.questions.length} question${run.questions.length === 1 ? "" : "s"}` : null;
            return (
              <Row
                key={run.run}
                kind={run.kind}
                href={runPath(run.project, run.run)}
                title={run.label}
                rail={stuck === null ? railOf(state) : "late"}
                live={running}
                chips={<KindChips kind={run.kind} manual={run.manual} />}
                state={state}
                meta={[questions, run.who === "timer" ? "by timer" : `by ${run.who}`].filter((part) => part !== null)}
                time={
                  running ? (
                    <>
                      for <Elapsed since={run.startedAt} />
                    </>
                  ) : (
                    <Time iso={run.startedAt} />
                  )
                }
                detail={stuck === null ? undefined : <span className="ink-late">{stuckText(stuck)}</span>}
              />
            );
          })}
        </RowList>
      </div>
    </section>
  );
}
