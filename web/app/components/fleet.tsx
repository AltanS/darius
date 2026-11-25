/**
 * The parts of the fleet pages (0.140.0): a health word with its dot, the
 * reasons, the host chips of a workspace (checkout or copy), and the
 * workspace header that heads a workspace Overview: health, where it lives,
 * four compact count links and its djinns. Colour is never the only signal: every
 * dot comes with its word.
 */

import { Link } from "react-router";

import type { FleetDjinn, FleetWorkspace, WorkspaceHealth, WorkspacePlace } from "../../../src/web/api.ts";
import { healthWord, shownReasons } from "../lib/fleet.ts";
import { href } from "../lib/paths.ts";
import { outcomeTone, type Tone } from "../lib/tone.ts";
import { Status, Time } from "./ui.tsx";

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

interface PlaceChipsProps {
  places: readonly WorkspacePlace[];
  self: string;
  /** Chips link to their machine page; off inside a row that is itself a link. */
  links?: boolean;
}

/** One chip per host that holds the workspace: its name and "checkout" or "copy". */
export function PlaceChips({ places, self, links = true }: PlaceChipsProps): React.ReactNode {
  return (
    <span className="fl-chips">
      {places.map((place) => {
        const inner = (
          <>
            <span className="fl-chip-host">{place.host}</span>
            <span className="fl-chip-kind">{place.kind}</span>
          </>
        );
        const className = `fl-chip${place.kind === "checkout" ? " is-checkout" : ""}${place.host === self ? " is-self" : ""}`;
        return links ? (
          <Link key={place.host} to={href({ to: "machine", host: place.host })} className={className}>
            {inner}
          </Link>
        ) : (
          <span key={place.host} className={className}>
            {inner}
          </span>
        );
      })}
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
          <span className="text-muted">any host</span>
        ) : (
          <>
            {djinn.host === self ? <span>here</span> : <span className="fl-runs-on">{`runs on ${djinn.host}`}</span>}
            <span className="text-muted">{` (${djinn.why === "pinned" ? "pinned" : "checkout"})`}</span>
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
 * The top block of a workspace Overview: health and reasons, where it lives, four counts in one row, its djinns.
 * The reasons are the health reasons: a finding that needs a decision reads "n open findings", never "need you",
 * as in the Overview's summary line, which counts findings apart from what needs you.
 */
export function WorkspaceHeader({ workspace, self }: HeaderProps): React.ReactNode {
  const ws = workspace.name;
  const { counts } = workspace;
  const djinns = workspace.djinns.slice(0, HEADER_DJINNS);
  const ritualsHref = href({ to: "section", ws, section: "rituals" });
  return (
    <section className="fl-head panel" aria-label={`${ws}: health and placement`}>
      <p className="fl-head-line">
        <HealthWord health={workspace.health} />
        {workspace.reasons.length === 0 ? null : <span className="fl-head-reasons">{workspace.reasons.join(", ")}</span>}
      </p>
      <p className="fl-head-line fl-lives">
        <span className="text-muted">Lives on</span>
        <PlaceChips places={workspace.places} self={self} />
        {workspace.here === "copy" ? (
          <span className="text-muted">
            copy here, synced <Time iso={workspace.lastSync} />
          </span>
        ) : null}
      </p>
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
  );
}
