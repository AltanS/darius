/**
 * One machine (0.139.0): its card, then what runs there now, the djinns
 * that run there and the workspaces it holds (0.140.0). Every list is
 * grouped by workspace and shows at most five rows per group, then "show
 * all" to the section page. Version history and backups are in Details. A
 * host page, in no workspace. Read-only.
 */

import { data, Link } from "react-router";

import type { FleetDjinn, HostOpenRun } from "../../../src/web/api.ts";
import type { Route } from "./+types/host";
import { PlaceChips } from "../components/fleet.tsx";
import { LedgerFacts, LiveFacts, MachineCard } from "../components/machines.tsx";
import { Empty, Fold, Section, Status, Time } from "../components/ui.tsx";
import { checkoutsOn, groupByWorkspace, pinnedDjinnsOn, type Group } from "../lib/fleet.ts";
import { href, itemTarget } from "../lib/paths.ts";
import { peersOf } from "../lib/peers.ts";
import { statusOf } from "../lib/status.ts";
import { outcomeTone } from "../lib/tone.ts";
import { itemSlug } from "../lib/view.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

interface TitledRun extends HostOpenRun {
  title: string;
}

export async function loader({ context, params }: Route.LoaderArgs) {
  const name = params.host;
  const fleet = context.fleet();
  const peers = await peersOf(context);
  const host = fleet.hosts.find((entry) => entry.host === name) ?? null;
  const peer = peers.find((entry) => entry.host === name) ?? null;
  if (host === null && peer === null) throw data(`No host named ${name} in this store.`, { status: 404 });
  const workspaces = context.workspaces();
  const projects = statusOf(context).projects;
  const titleOf = (project: string, item: string): string => {
    const status = projects.find((entry) => entry.name === project);
    const slug = itemSlug(item);
    const found = item.startsWith("ritual/") ? status?.rituals.find((ritual) => ritual.slug === slug) : status?.vigils.find((vigil) => vigil.slug === slug);
    return found?.title ?? slug;
  };
  // Its own word when it answered; else what the ledgers here say.
  const open = peer?.live?.openRuns ?? fleet.openRuns.filter((run) => run.host === name).map(({ host: _host, ...run }) => run);
  const running: TitledRun[] = open.map((run) => Object.assign({ title: titleOf(run.project, run.item) }, run));
  const djinns = workspaces.workspaces.flatMap((workspace) => workspace.djinns.filter((djinn) => djinn.host === name).map((djinn) => Object.assign({ workspace: workspace.name }, djinn)));
  const holds = workspaces.workspaces.flatMap((workspace) => workspace.places.filter((place) => place.host === name).map((place) => ({ workspace: workspace.name, place })));
  const selfVersion = peers.find((entry) => entry.self)?.version ?? fleet.hosts.find((entry) => entry.self)?.version ?? null;
  return {
    name,
    host,
    peer,
    selfVersion,
    running: groupByWorkspace(running, (run) => run.project),
    runningFrom: peer?.live === undefined || peer.live === null ? "ledger" : "live",
    djinns: groupByWorkspace(djinns, (djinn) => djinn.workspace),
    holds,
    checkouts: checkoutsOn(workspaces, name),
    pinnedDjinns: pinnedDjinnsOn(workspaces, name),
  };
}

export const meta: Route.MetaFunction = ({ params }) => [{ title: `${params.host} | Machines | darius` }];

function ShowAll({ group, to }: { group: Group<unknown>; to: string }): React.ReactNode {
  if (group.total <= group.rows.length) return null;
  return (
    <p className="fl-show-all">
      <Link to={to}>{`Show all ${String(group.total)}`}</Link>
    </p>
  );
}

function RunGroups({ groups }: { groups: readonly Group<TitledRun>[] }): React.ReactNode {
  if (groups.length === 0) return <Empty>No run is open here.</Empty>;
  return groups.map((group) => (
    <div key={group.workspace} className="fl-group">
      <h3 className="fl-group-name">
        <Link to={href({ to: "overview", ws: group.workspace })}>{group.workspace}</Link>
      </h3>
      <ul className="sy-list panel">
        {group.rows.map((run) => (
          <li key={run.run} className="sy-item">
            <p className="sy-item-head">
              <Link to={href(itemTarget(run.project, run.item))} className="sy-name">
                {run.title}
              </Link>
              <Status tone={run.phase === "held" ? "wait" : "run"} label={run.phase === "held" ? "Held" : "Running"} />
              <span className="text-muted">
                started <Time iso={run.startedAt} />
              </span>
              <Link to={href({ to: "run", ws: run.project, run: run.run })}>Open the run</Link>
            </p>
          </li>
        ))}
      </ul>
      <ShowAll group={group} to={href({ to: "section", ws: group.workspace, section: "runs", query: { state: "running" } })} />
    </div>
  ));
}

function DjinnGroups({ groups }: { groups: readonly Group<FleetDjinn & { workspace: string }>[] }): React.ReactNode {
  if (groups.length === 0) return <Empty>No djinn runs here.</Empty>;
  return groups.map((group) => (
    <div key={group.workspace} className="fl-group">
      <h3 className="fl-group-name">
        <Link to={href({ to: "overview", ws: group.workspace })}>{group.workspace}</Link>
      </h3>
      <ul className="sy-list panel">
        {group.rows.map((djinn) => (
          <li key={djinn.slug} className="sy-item">
            <p className="sy-item-head">
              <Link to={href({ to: "ritual", ws: group.workspace, slug: djinn.slug })} className="sy-name">
                {djinn.title}
              </Link>
              <span className="text-muted">{djinn.why === "pinned" ? "pinned" : "checkout"}</span>
              {djinn.lastOutcome === null ? (
                <span className="text-muted">no run yet</span>
              ) : (
                <span>
                  <Status tone={outcomeTone(djinn.lastOutcome)} label={djinn.lastOutcome} /> <Time iso={djinn.lastAt} />
                </span>
              )}
            </p>
          </li>
        ))}
      </ul>
      <ShowAll group={group} to={href({ to: "section", ws: group.workspace, section: "rituals" })} />
    </div>
  ));
}

export default function HostPage({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { name, host, peer, selfVersion, running, runningFrom, djinns, holds, checkouts, pinnedDjinns } = loaderData;
  return (
    <div className="stack">
      <header className="page-head page-head-tight">
        <h1 className="page-title">{name}</h1>
        <p className="page-meta">
          <Link to={href({ to: "host", page: "hosts" })}>All machines</Link>
          <Link to={href({ to: "host", page: "fleet", hash: "placement" })}>Placement</Link>
          {host?.retired === true ? <Status tone="idle" label="retired: no line in 30 days" /> : null}
        </p>
      </header>
      <MachineCard name={name} peer={peer ?? undefined} host={host ?? undefined} selfVersion={selfVersion} checkouts={checkouts} pinnedDjinns={pinnedDjinns} linked={false} />
      <Section title={runningFrom === "live" ? "Running now" : "Running now, from the ledgers"} id="running">
        <RunGroups groups={running} />
      </Section>
      <Section title="Djinns that run here" id="djinns">
        <DjinnGroups groups={djinns} />
      </Section>
      <Section title="Workspaces" id="workspaces">
        {holds.length === 0 ? (
          <Empty>This host holds no workspace that this store knows.</Empty>
        ) : (
          <ul className="fl-holds">
            {holds.map(({ workspace, place }) => (
              <li key={workspace}>
                <Link to={href({ to: "overview", ws: workspace })}>{workspace}</Link> <PlaceChips places={[place]} self="" links={false} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Fold summary="Details: live facts, ledgers, versions, backup">
        <div className="stack">
          {peer?.live === undefined || peer.live === null ? <Empty>{peer === null ? "This host was not probed." : `Its darius serve did not answer${peer.reason === null ? "" : `: ${peer.reason}`}.`}</Empty> : <LiveFacts live={peer.live} />}
          {host === null ? <Empty>No ledger line of this host here.</Empty> : <LedgerFacts host={host} />}
          {host === null || host.versions.length === 0 ? (
            <Empty>No host.version line of this host here (before 0.126.0).</Empty>
          ) : (
            <ul className="sy-list panel">
              {host.versions.slice(0, 10).map((step) => (
                <li key={`${step.version}/${step.at}`} className="sy-item">
                  <p className="sy-item-head">
                    <span className="sy-name">{step.version}</span>
                    <Time iso={step.at} />
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Fold>
    </div>
  );
}
