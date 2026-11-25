/**
 * The parts of the workspace pages (0.140.0, 0.141.0): a health word with
 * its dot, the reasons, and the head of a workspace Overview: the trail, the
 * name as the title with its health word, the status sentence, four compact
 * count links and its djinns. Colour is never the only signal: every dot
 * comes with its word.
 */

import { Link } from "react-router";

import type { FleetDjinn, FleetWorkspace, WorkspaceHealth } from "../../../src/web/api.ts";
import { healthWord, shownReasons, workspaceSentence } from "../lib/fleet.ts";
import { href } from "../lib/paths.ts";
import { outcomeTone, type Tone } from "../lib/tone.ts";
import { Crumbs } from "./crumbs.tsx";
import { Sentence } from "./sentence.tsx";
import { Status, Time } from "./ui.tsx";
import { WorkspaceGlyph } from "./workspace-icon.tsx";

interface HealthProps {
  health: WorkspaceHealth;
}

/** The health word with a square dot in its colour. */
export function HealthWord({ health }: HealthProps): React.ReactNode {
  const word = healthWord(health);
  return (
    <span className={`fl-health tone-${word.tone}`}>
      <span className="fl-dot" aria-hidden="true" />
      <span className="fl-word">{word.label}</span>
    </span>
  );
}

interface ReasonsProps {
  reasons: readonly string[];
  max?: number;
}

/** The counted reasons, at most `max`, then "+n". */
export function Reasons({ reasons, max = 2 }: ReasonsProps): React.ReactNode {
  if (reasons.length === 0) return null;
  const { shown, more } = shownReasons(reasons, max);
  return (
    <span className="fl-reasons" title={reasons.join(", ")}>
      {shown.join(", ")}
      {more === 0 ? null : <span className="fl-more">{` +${String(more)}`}</span>}
    </span>
  );
}

const DJINN_STATES = {
  running: { tone: "run", label: "running" },
  held: { tone: "wait", label: "held" },
  late: { tone: "late", label: "late" },
  due: { tone: "wait", label: "due today" },
  idle: { tone: "idle", label: "next due" },
} as const;

/** The tone of a last run: an open one (running, held) is blue, a closed one has its outcome's tone. */
function lastTone(outcome: string): Tone {
  return outcome === "running" || outcome === "held" ? "run" : outcomeTone(outcome);
}

interface DjinnRowProps {
  ws: string;
  djinn: FleetDjinn;
  self: string;
}

function DjinnRow({ ws, djinn, self }: DjinnRowProps): React.ReactNode {
  const state = DJINN_STATES[djinn.state];
  return (
    <li className="fl-djinn">
      <Link to={href({ to: "ritual", ws, slug: djinn.slug })} className="fl-djinn-name">
        {djinn.title}
      </Link>
      <span className="fl-djinn-state">
        <Status tone={state.tone} label={state.label} />
        {djinn.state === "idle" && djinn.nextDue !== null ? <span className="text-muted">{` ${djinn.nextDue}`}</span> : null}
      </span>
      <span className="fl-djinn-host">
        {djinn.host === null ? (
          <span className="text-muted">any machine</span>
        ) : (
          <>
            {djinn.host === self ? <span>runs here</span> : <span className="fl-runs-on">{`runs on ${djinn.host}`}</span>}
            {djinn.why === "pinned" ? <span className="text-muted"> (pinned)</span> : null}
          </>
        )}
      </span>
      <span className="fl-djinn-last">
        {djinn.lastOutcome === null ? (
          <span className="text-muted">no run yet</span>
        ) : (
          <>
            <Status tone={lastTone(djinn.lastOutcome)} label={djinn.lastOutcome} /> <Time iso={djinn.lastAt} />
          </>
        )}
      </span>
    </li>
  );
}

interface CountLinkProps {
  to: string;
  label: string;
  count: number;
  alarm: number;
  alarmText: string;
  tone: "late" | "bad" | "wait";
  /** A second line under the label: "11 djinns". */
  sub?: string;
}

function CountLink({ to, label, count, alarm, alarmText, tone, sub }: CountLinkProps): React.ReactNode {
  return (
    <Link to={to} className="fl-count">
      <span className="fl-count-n">{count}</span>
      <span className="fl-count-main">
        <span className="fl-count-label">{label}</span>
        {alarm === 0 ? null : <span className={`fl-count-alarm ink-${tone}`}>{`${String(alarm)} ${alarmText}`}</span>}
      </span>
      {sub === undefined ? null : <span className="fl-count-sub">{sub}</span>}
    </Link>
  );
}

/** The djinns the header lists before "Show all". */
const HEADER_DJINNS = 3;

interface HeaderProps {
  workspace: FleetWorkspace;
  self: string;
}

/**
 * The head of a workspace Overview (0.141.0): the trail "Workspaces / name",
 * the name as the title with its health word, the status sentence, then four
 * counts in one row and its djinns.
 */
export function WorkspaceHeader({ workspace, self }: HeaderProps): React.ReactNode {
  const ws = workspace.name;
  const { counts } = workspace;
  const djinns = workspace.djinns.slice(0, HEADER_DJINNS);
  const ritualsHref = href({ to: "section", ws, section: "rituals" });
  return (
    <>
      <header className="page-head ws-head">
        <Crumbs />
        <h1 className="page-title ws-title">
          <WorkspaceGlyph icon={workspace.icon} className="ws-title-icon" />
          <span className="ws-title-name">{ws}</span>
          <HealthWord health={workspace.health} />
        </h1>
        <Sentence className="ws-sentence" parts={workspaceSentence(workspace, self)} />
      </header>
      <section className="fl-head panel" aria-label={`${ws}: counts and djinns`}>
        <nav className="fl-counts" aria-label={`${ws}: counts`}>
          <CountLink to={ritualsHref} label="Rituals" count={counts.rituals} alarm={counts.ritualsLate} alarmText="late" tone="late" sub={`${String(counts.djinns)} ${counts.djinns === 1 ? "djinn" : "djinns"}`} />
          <CountLink to={href({ to: "section", ws, section: "vigils" })} label="Vigils" count={counts.vigilsOpen} alarm={counts.vigilsFlagged} alarmText="flagged" tone="bad" />
          <CountLink to={href({ to: "section", ws, section: "candles" })} label="Candles" count={counts.candlesLit} alarm={0} alarmText="" tone="wait" />
          <CountLink to={href({ to: "section", ws, section: "findings" })} label="Findings" count={counts.findingsOpen} alarm={counts.findingsNeedYou} alarmText="to decide" tone="wait" />
        </nav>
        <div id="djinns" className="fl-djinns">
          <p className="fl-djinns-head">
            <span className="label">Djinns</span>
            {workspace.djinns.length > HEADER_DJINNS ? <Link to={ritualsHref}>{`Show all ${String(workspace.djinns.length)}`}</Link> : null}
          </p>
          {djinns.length === 0 ? (
            <p className="text-muted">darius runs no djinn here.</p>
          ) : (
            <ul className="fl-djinn-list">
              {djinns.map((djinn) => (
                <DjinnRow key={djinn.slug} ws={ws} djinn={djinn} self={self} />
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
