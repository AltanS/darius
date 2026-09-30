/** The dashboard head of a project page: the four tiles, and the panels for what is open and what is scheduled. */

import { useEffect, useState } from "react";
import { Link } from "react-router";

import type { RitualRow, VigilRow } from "../../../src/web/api.ts";
import { useClock } from "../lib/clock.tsx";
import { duration, ritualPath, runPath, vigilAnchor } from "../lib/format.ts";
import type { Badge, Tone } from "../lib/tone.ts";
import { cadenceText, nextText, runState, stuckText, vigilWaits, type ActivityRun } from "../lib/view.ts";
import { Fold, SectHead, Status, Time } from "./ui.tsx";

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
}

/** One count of the status strip. The whole segment is the link. */
export function Pill({ label, value, sub, tone, href, live = false }: PillProps): React.ReactNode {
  const on = value > 0;
  const className = `pill tone-${on ? tone : "idle"}`;
  const body = (
    <>
      {on && live ? <span className="live-bar" aria-hidden="true" /> : null}
      <span className="pill-dot" aria-hidden="true" />
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
  scheduled: readonly ScheduledEntry[];
  openVigils: readonly VigilRow[];
  overdue: number;
  /** How many rituals are done by hand; the last segment opens their list, so it needs one. */
  manual: number;
}

interface PulseProps {
  data: PulseData;
}

/** Whether an armed vigil is due today or late; one without a date never is. */
export function vigilIsDue(vigil: VigilRow, today: string): boolean {
  return vigil.due !== null && vigil.due <= today;
}

/** Running, waiting for you, armed vigils, overdue by hand: one slim strip, each segment opens what it counts. */
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
      <Pill label="vigils armed" value={data.openVigils.length} sub={vigilSub === "" ? undefined : vigilSub} tone={flagged > 0 ? "bad" : due > 0 ? "late" : "gold"} href={data.openVigils.length === 0 ? null : "#vigils"} />
      <Pill label="overdue by hand" value={data.overdue} tone="late" href={data.manual === 0 ? null : "?show=manual#manual"} />
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
                      <span className="row-title">{run.label}</span>
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

/** A ritual darius runs, with the state of its latest run. */
export interface ScheduledEntry {
  ritual: RitualRow;
  /** The state of its latest run, or "No run yet". */
  badge: Badge;
}

interface ScheduledPanelProps {
  project: string;
  entries: readonly ScheduledEntry[];
}

/** What darius runs next, the soonest first. */
export function ScheduledPanel({ project, entries }: ScheduledPanelProps): React.ReactNode {
  const { today } = useClock();
  return (
    <section id="scheduled" className="section">
      <SectHead title="Scheduled" />
      <div className="panel">
        {entries.length === 0 ? (
          <p className="panel-empty">darius runs no ritual of this project.</p>
        ) : (
          <ul className="rows stagger">
            {entries.map(({ ritual, badge }) => (
              <li key={ritual.slug}>
                <Link to={ritualPath(project, ritual.slug)} className="row row-tight">
                  <span className="row-main">
                    <span className="row-title">{ritual.title}</span>
                    <span className="row-sub">{[cadenceText(ritual.cadence), nextText(ritual, today)].filter((part) => part !== null).join(", ")}</span>
                  </span>
                  <Status tone={badge.tone} label={badge.label} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

interface VigilPanelProps {
  vigils: readonly VigilRow[];
  target: string;
}

/** How many armed vigils show before the fold. */
const VIGILS_SHOWN = 3;

/** The state of an armed vigil: flagged, late, due today, or waiting. */
function armedBadge(vigil: VigilRow, today: string): Badge {
  if (vigil.flagged) return { tone: "bad", label: "Flagged" };
  if (vigil.due !== null && vigil.due < today) return { tone: "late", label: "Overdue" };
  if (vigil.due === today) return { tone: "gold", label: "Due today" };
  return { tone: "idle", label: "Armed" };
}

interface VigilRowsProps {
  vigils: readonly VigilRow[];
  target: string;
}

function VigilRows({ vigils, target }: VigilRowsProps): React.ReactNode {
  const { today } = useClock();
  return (
    <ul className="rows stagger">
      {vigils.map((vigil) => {
        const badge = armedBadge(vigil, today);
        const id = vigilAnchor(vigil.slug);
        const waits = vigilWaits(vigil, today);
        return (
          <li key={vigil.slug} id={id} className={`row target-row${vigil.flagged ? " row-flagged tone-bad" : ""}${target === id ? " is-target" : ""}`}>
            <span className="row-main">
              <span className="row-title">{vigil.title}</span>
              <span className="row-sub row-clamp">{waits.length === 0 ? "no date and no event set" : waits.join(", ")}</span>
              {vigil.lastOutcome === null ? null : (
                <span className="row-sub">
                  last check <strong>{vigil.lastOutcome}</strong>
                </span>
              )}
            </span>
            <Status tone={badge.tone} label={badge.label} />
          </li>
        );
      })}
    </ul>
  );
}

/** Armed vigils, the most urgent first (the page sorts them): a few in view, the rest one press away. */
export function VigilPanel({ vigils, target }: VigilPanelProps): React.ReactNode {
  const head = vigils.slice(0, VIGILS_SHOWN);
  const rest = vigils.slice(VIGILS_SHOWN);
  // A link to a vigil in the fold opens the fold.
  const inRest = rest.some((vigil) => vigilAnchor(vigil.slug) === target);
  return (
    <section id="vigils" className="section">
      <SectHead title="Vigils" />
      <div className="panel">
        <VigilRows vigils={head} target={target} />
        {rest.length === 0 ? null : (
          <Fold open={inRest} summary={`${rest.length} more armed`}>
            <VigilRows vigils={rest} target={target} />
          </Fold>
        )}
      </div>
    </section>
  );
}
