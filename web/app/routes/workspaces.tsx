/**
 * Workspaces (0.140.0 as Fleet, renamed in 0.141.0): how many workspaces,
 * and how healthy. One headline sentence whose counts filter the table; the
 * legend; the workspace table, worst first (health, reasons, the machines
 * that run it, djinns, vigils, candles, last activity), a card per workspace
 * on a phone. A page in no workspace. Read-only. `/fleet` and `/topology`
 * redirect here.
 */

import { Link } from "react-router";

import type { FleetMirrorFailure, FleetWorkspace, FleetWorkspaces } from "../../../src/web/api.ts";
import type { Route } from "./+types/workspaces";
import { HealthWord, Reasons } from "../components/fleet.tsx";
import { Section, Time } from "../components/ui.tsx";
import { WorkspaceGlyph } from "../components/workspace-icon.tsx";
import { copiesMark, headlineOf, LEGEND, healthFilterOf, healthWord, hostCount, runsOnOf, type HeadlinePart } from "../lib/fleet.ts";
import { isSelftest } from "../lib/home.ts";
import { href } from "../lib/paths.ts";
import { peersOf } from "../lib/peers.ts";
import { readSettings } from "../lib/settings.ts";
import { workspacesOf } from "../lib/status.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

export async function loader({ context, request }: Route.LoaderArgs) {
  const fleet = workspacesOf(context);
  const peers = await peersOf(context);
  // All workspaces, as the settings show them: the self-test workspace only when the operator shows it.
  const showSelftest = readSettings(request.headers.get("cookie")).showSelftest;
  const workspaces = fleet.workspaces.filter((workspace) => showSelftest || !isSelftest(workspace.name));
  return { fleet: { ...fleet, workspaces }, hosts: hostCount(peers, fleet.hosts), filter: healthFilterOf(new URL(request.url).searchParams) };
}

export const meta: Route.MetaFunction = () => [{ title: "Workspaces | darius" }];

function PartLink({ part }: { part: HeadlinePart }): React.ReactNode {
  return (
    <Link to={href({ to: "host", page: "workspaces", query: { health: part.health }, hash: "workspaces" })} className={`ink-${healthWord(part.health).tone}`}>
      {part.text}
    </Link>
  );
}

function Headline({ fleet, hosts }: { fleet: FleetWorkspaces; hosts: number }): React.ReactNode {
  const line = headlineOf(fleet.workspaces, hosts);
  return (
    <p className="fl-headline">
      {line.lead}
      {line.parts.length === 0 ? "" : ": "}
      {line.parts.map((part, index) => (
        <span key={part.health}>
          {index === 0 ? "" : ", "}
          <PartLink part={part} />
        </span>
      ))}
      {line.quiet === null ? (
        "."
      ) : (
        <>
          {". Also "}
          <PartLink part={line.quiet} />.
        </>
      )}
    </p>
  );
}

/** A number of the table; a zero is muted, so the eye finds the numbers that matter. */
function Num({ value }: { value: number }): React.ReactNode {
  return <span className={value === 0 ? "fl-n is-zero" : "fl-n"}>{value}</span>;
}

function Count({ value, alarm, alarmText, tone }: { value: number; alarm: number; alarmText: string; tone: "late" | "bad" }): React.ReactNode {
  return (
    <>
      <Num value={value} />
      {alarm === 0 ? null : <span className={`fl-alarm ink-${tone}`}>{`${String(alarm)} ${alarmText}`}</span>}
    </>
  );
}

/** The machines that run a workspace, in bold, then "+2 copies" muted with their names in the title; "no machine" when none runs it. */
function RunsOn({ workspace }: { workspace: FleetWorkspace }): React.ReactNode {
  const { runs, copies } = runsOnOf(workspace);
  const mark = copiesMark(copies);
  return (
    <span className="fl-runs">
      {runs.length === 0 ? <span className="text-muted">no machine</span> : <span className="fl-runs-names">{runs.join(", ")}</span>}
      {mark === null ? null : (
        <span className="fl-copies" title={mark.title}>
          {` ${mark.text}`}
        </span>
      )}
    </span>
  );
}

function WorkspaceRow({ workspace }: { workspace: FleetWorkspace }): React.ReactNode {
  const { counts } = workspace;
  return (
    <li>
      <Link to={href({ to: "overview", ws: workspace.name })} className="fl-row">
        <span className="fl-c fl-c-health">
          <HealthWord health={workspace.health} />
        </span>
        <span className="fl-c fl-c-name">
          <WorkspaceGlyph icon={workspace.icon} className="fl-icon" />
          <span className="fl-name">{workspace.name}</span>
        </span>
        <span className="fl-c fl-c-reasons">
          <Reasons reasons={workspace.reasons} />
        </span>
        <span className="fl-c fl-c-where">
          <span className="fl-label">Runs on</span>
          <RunsOn workspace={workspace} />
        </span>
        <span className="fl-c fl-c-num">
          <span className="fl-label">Djinns</span>
          <Count value={counts.djinns} alarm={counts.djinnsLate} alarmText="late" tone="late" />
        </span>
        <span className="fl-c fl-c-num">
          <span className="fl-label">Vigils</span>
          <Count value={counts.vigilsOpen} alarm={counts.vigilsFlagged} alarmText="flagged" tone="bad" />
        </span>
        <span className="fl-c fl-c-num">
          <span className="fl-label">Candles</span>
          <Num value={counts.candlesLit} />
        </span>
        <span className="fl-c fl-c-last">
          <span className="fl-label">Last activity</span>
          <Time iso={workspace.lastActivity} />
        </span>
      </Link>
    </li>
  );
}

function WorkspaceTable({ workspaces }: { workspaces: readonly FleetWorkspace[] }): React.ReactNode {
  return (
    <div className="fl-table">
      <div className="fl-row fl-thead" aria-hidden="true">
        <span>Health</span>
        <span>Workspace</span>
        <span>Why</span>
        <span>Runs on</span>
        <span>Djinns</span>
        <span>Vigils</span>
        <span>Candles</span>
        <span>Last activity</span>
      </div>
      <ul className="fl-rows">
        {workspaces.map((workspace) => (
          <WorkspaceRow key={workspace.name} workspace={workspace} />
        ))}
      </ul>
    </div>
  );
}

function MirrorFailures({ failures }: { failures: readonly FleetMirrorFailure[] }): React.ReactNode {
  return (
    <Section title="Not copied to this machine yet">
      <ul className="sy-list panel">
        {failures.map((failure) => (
          <li key={failure.project} className="sy-item">
            <p className="sy-item-head">
              <span className="sy-name">{failure.project}</span>
              <Time iso={failure.at} />
            </p>
            <p className="sy-meta ink-bad">{failure.error}</p>
          </li>
        ))}
      </ul>
      <p className="text-muted">The mirror tries each one again 24 hours after it failed.</p>
    </Section>
  );
}

export default function WorkspacesPage({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { fleet, hosts, filter } = loaderData;
  const shown = filter === null ? fleet.workspaces : fleet.workspaces.filter((workspace) => workspace.health === filter);
  return (
    <div className="stack">
      <header className="page-head page-head-tight">
        <h1 className="page-title">Workspaces</h1>
        <Headline fleet={fleet} hosts={hosts} />
      </header>
      <div id="workspaces" className="fl-list">
        <p className="fl-legend">
          {LEGEND}
          {filter === null ? null : (
            <>
              {" "}
              <Link to={href({ to: "host", page: "workspaces", hash: "workspaces" })}>{`Only ${healthWord(filter).label}. Show all`}</Link>
            </>
          )}
        </p>
        {shown.length === 0 ? <p className="empty">No workspace here.</p> : <WorkspaceTable workspaces={shown} />}
      </div>
      {fleet.mirrorFailures.length === 0 ? null : <MirrorFailures failures={fleet.mirrorFailures} />}
    </div>
  );
}
