/**
 * Fleet (0.140.0): how many workspaces, and how healthy. One headline
 * sentence whose counts filter the table; the workspace table, worst first
 * (health, reasons, where it lives, djinns, vigils, candles, last activity),
 * a card per workspace on a phone; and at `#placement` a small matrix of
 * workspaces and hosts. It replaces Topology, which redirects here. A host
 * page, in no workspace. Read-only.
 */

import { Link } from "react-router";

import type { FleetMirrorFailure, FleetWorkspace, FleetWorkspaces } from "../../../src/web/api.ts";
import type { Route } from "./+types/fleet";
import { HealthWord, PlaceChips, Reasons } from "../components/fleet.tsx";
import { Section, Time } from "../components/ui.tsx";
import { WorkspaceGlyph } from "../components/workspace-icon.tsx";
import { headlineOf, healthFilterOf, healthWord, hostCount, type HeadlinePart } from "../lib/fleet.ts";
import { isSelftest } from "../lib/home.ts";
import { href } from "../lib/paths.ts";
import { peersOf } from "../lib/peers.ts";
import { readSettings } from "../lib/settings.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

export async function loader({ context, request }: Route.LoaderArgs) {
  const fleet = context.workspaces();
  const peers = await peersOf(context);
  // All workspaces, as the settings show them: the self-test workspace only when the operator shows it.
  const showSelftest = readSettings(request.headers.get("cookie")).showSelftest;
  const workspaces = fleet.workspaces.filter((workspace) => showSelftest || !isSelftest(workspace.name));
  return { fleet: { ...fleet, workspaces }, hosts: hostCount(peers, fleet.hosts), filter: healthFilterOf(new URL(request.url).searchParams) };
}

export const meta: Route.MetaFunction = () => [{ title: "Fleet | darius" }];

function PartLink({ part }: { part: HeadlinePart }): React.ReactNode {
  return (
    <Link to={href({ to: "host", page: "fleet", query: { health: part.health }, hash: "workspaces" })} className={`ink-${healthWord(part.health).tone}`}>
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

function Count({ value, alarm, alarmText, tone }: { value: number; alarm: number; alarmText: string; tone: "late" | "bad" }): React.ReactNode {
  return (
    <>
      <span className="fl-n">{value}</span>
      {alarm === 0 ? null : <span className={`fl-alarm ink-${tone}`}>{`${String(alarm)} ${alarmText}`}</span>}
    </>
  );
}

function WorkspaceRow({ workspace, self }: { workspace: FleetWorkspace; self: string }): React.ReactNode {
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
          <PlaceChips places={workspace.places} self={self} links={false} />
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
          <span className="fl-n">{counts.candlesLit}</span>
        </span>
        <span className="fl-c fl-c-last">
          <span className="fl-label">Last activity</span>
          <Time iso={workspace.lastActivity} />
        </span>
      </Link>
    </li>
  );
}

function WorkspaceTable({ workspaces, self }: { workspaces: readonly FleetWorkspace[]; self: string }): React.ReactNode {
  return (
    <div className="fl-table">
      <div className="fl-row fl-thead" aria-hidden="true">
        <span>Health</span>
        <span>Workspace</span>
        <span>Why</span>
        <span>Where</span>
        <span>Djinns</span>
        <span>Vigils</span>
        <span>Candles</span>
        <span>Last activity</span>
      </div>
      <ul className="fl-rows">
        {workspaces.map((workspace) => (
          <WorkspaceRow key={workspace.name} workspace={workspace} self={self} />
        ))}
      </ul>
    </div>
  );
}

/** The least width of a host column of the placement matrix, in px. */
const MATRIX_HOST_MIN = 120;

function Placement({ fleet }: { fleet: FleetWorkspaces }): React.ReactNode {
  return (
    <div className="fl-matrix-wrap">
      <table className="fl-matrix" style={{ minWidth: `calc(11rem + ${String(fleet.hosts.length * MATRIX_HOST_MIN)}px)` }}>
        <thead>
          <tr>
            <th scope="col" className="fl-matrix-first">
              <span className="sr-only">Workspace</span>
            </th>
            {fleet.hosts.map((host) => (
              <th key={host} scope="col">
                <Link to={href({ to: "machine", host })} className="fl-trunc" title={host}>
                  {host}
                </Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {fleet.workspaces.map((workspace) => (
            <tr key={workspace.name}>
              <th scope="row">
                <Link to={href({ to: "overview", ws: workspace.name })} className="fl-trunc" title={workspace.name}>
                  {workspace.name}
                </Link>
              </th>
              {fleet.hosts.map((host) => {
                const place = workspace.places.find((one) => one.host === host);
                return (
                  <td key={host} className={place?.kind === "checkout" ? "is-checkout" : undefined}>
                    {place === undefined ? <span className="sr-only">nothing</span> : place.kind}
                    {place === undefined || place.pinned === 0 ? null : <span className="fl-pins">{` · ${String(place.pinned)} pinned`}</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MirrorFailures({ failures }: { failures: readonly FleetMirrorFailure[] }): React.ReactNode {
  return (
    <Section title="Not mirrored here">
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

export default function FleetPage({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { fleet, hosts, filter } = loaderData;
  const shown = filter === null ? fleet.workspaces : fleet.workspaces.filter((workspace) => workspace.health === filter);
  return (
    <div className="stack">
      <header className="page-head page-head-tight">
        <h1 className="page-title">Fleet</h1>
        <Headline fleet={fleet} hosts={hosts} />
      </header>
      <Section
        title="Workspaces"
        id="workspaces"
        aside={
          filter === null ? undefined : (
            <Link to={href({ to: "host", page: "fleet", hash: "workspaces" })}>{`Only ${healthWord(filter).label}. Show all`}</Link>
          )
        }
      >
        {shown.length === 0 ? <p className="empty">No workspace here.</p> : <WorkspaceTable workspaces={shown} self={fleet.self} />}
      </Section>
      {fleet.mirrorFailures.length === 0 ? null : <MirrorFailures failures={fleet.mirrorFailures} />}
      <Section title="Placement" id="placement">
        <p className="text-muted">Where each workspace lives: a checkout runs its work, a copy only holds the store. Pinned counts the active rituals pinned to that host.</p>
        <Placement fleet={fleet} />
      </Section>
    </div>
  );
}
