/**
 * One machine (0.139.0): its live facts from its own `darius serve`, its
 * open runs, the rituals pinned to it, the rituals that last ran there,
 * the vigils last swept there, the projects it holds, its backup and its
 * darius versions. A host page, in no workspace. Read-only.
 */

import { data, Link } from "react-router";

import type { FleetLast, HostOpenRun, ProjectStatus } from "../../../src/web/api.ts";
import type { Route } from "./+types/host";
import { boxWord, HostState, LedgerFacts, LiveFacts } from "../components/machines.tsx";
import { Empty, Section, Status, Time } from "../components/ui.tsx";
import { href, itemTarget } from "../lib/paths.ts";
import { peersOf } from "../lib/peers.ts";
import { scopeOfRequest } from "../lib/scope.ts";
import { statusOf } from "../lib/status.ts";
import { outcomeTone } from "../lib/tone.ts";
import { isDjinn, itemSlug } from "../lib/view.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

export async function loader({ context, params, request }: Route.LoaderArgs) {
  const name = params.host;
  const fleet = context.fleet();
  const peers = await peersOf(context);
  const host = fleet.hosts.find((entry) => entry.host === name) ?? null;
  const peer = peers.find((entry) => entry.host === name) ?? null;
  if (host === null && peer === null) throw data(`No host named ${name} in this store.`, { status: 404 });
  // All workspaces, as the settings show them: the self-test workspace only when the operator shows it.
  const projects = scopeOfRequest(statusOf(context), request, undefined).projects;
  const own = (entries: readonly FleetLast[]): FleetLast[] => entries.filter((entry) => entry.host === name).toSorted((left, right) => right.at.localeCompare(left.at));
  return {
    name,
    host,
    peer,
    // Its own word when it answered; else what the ledgers here say.
    openRuns: peer?.live?.openRuns ?? fleet.openRuns.filter((run) => run.host === name),
    openFrom: peer?.live === undefined || peer.live === null ? "ledger" : "live",
    pinned: projects.flatMap((project) => project.rituals.filter((ritual) => ritual.host === name).map((ritual) => ({ project: project.name, ritual }))),
    lastRuns: own(fleet.lastRuns),
    lastSweeps: own(fleet.lastSweeps),
    checkouts: host?.self === true ? projects.filter((project) => project.checkout !== null).map((project) => project.name) : [],
    titles: titlesOf(projects),
  };
}

/** The title of each ritual and vigil of this store, by project and item. */
interface ItemTitle {
  project: string;
  item: string;
  title: string;
}

function titlesOf(projects: readonly ProjectStatus[]): ItemTitle[] {
  return projects.flatMap((project) => [
    ...project.rituals.map((ritual) => ({ project: project.name, item: `ritual/${ritual.slug}`, title: ritual.title })),
    ...project.vigils.map((vigil) => ({ project: project.name, item: `vigil/${vigil.slug}`, title: vigil.title })),
  ]);
}

export const meta: Route.MetaFunction = ({ params }) => [{ title: `${params.host} | Machines | darius` }];

interface ItemLinkProps {
  project: string;
  item: string;
  titles: readonly ItemTitle[];
}

function ItemLink({ project, item, titles }: ItemLinkProps): React.ReactNode {
  return (
    <Link to={href(itemTarget(project, item))} className="sy-name">
      {titles.find((entry) => entry.project === project && entry.item === item)?.title ?? itemSlug(item)}
    </Link>
  );
}

function OpenRuns({ runs, titles }: { runs: readonly HostOpenRun[]; titles: readonly ItemTitle[] }): React.ReactNode {
  if (runs.length === 0) return <Empty>No run is open here.</Empty>;
  return (
    <ul className="sy-list panel">
      {runs.map((run) => (
        <li key={run.run} className="sy-item">
          <p className="sy-item-head">
            <ItemLink project={run.project} item={run.item} titles={titles} />
            <Status tone={run.phase === "held" ? "wait" : "run"} label={run.phase === "held" ? "Held" : "Running"} />
          </p>
          <p className="sy-meta">
            <span>{run.project}</span>
            <span>
              started <Time iso={run.startedAt} />
            </span>
            <Link to={href({ to: "run", ws: run.project, run: run.run })}>Open the run</Link>
          </p>
        </li>
      ))}
    </ul>
  );
}

function LastList({ entries, titles, none }: { entries: readonly FleetLast[]; titles: readonly ItemTitle[]; none: string }): React.ReactNode {
  if (entries.length === 0) return <Empty>{none}</Empty>;
  return (
    <ul className="sy-list panel">
      {entries.map((entry) => (
        <li key={`${entry.project}/${entry.item}`} className="sy-item">
          <p className="sy-item-head">
            <ItemLink project={entry.project} item={entry.item} titles={titles} />
            <Status tone={entry.outcome === null ? "run" : outcomeTone(entry.outcome)} label={entry.outcome ?? "open"} />
          </p>
          <p className="sy-meta">
            <span>{entry.project}</span>
            <Time iso={entry.at} />
          </p>
        </li>
      ))}
    </ul>
  );
}

export default function HostPage({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { name, host, peer, openRuns, openFrom, pinned, lastRuns, lastSweeps, checkouts, titles } = loaderData;
  const box = boxWord(peer?.live?.boxCheck ?? host?.boxCheck ?? null);
  return (
    <div className="stack">
      <header className="page-head page-head-tight">
        <h1 className="page-title">{name}</h1>
        <p className="lede mh-lede">
          {host?.self === true ? <span className="bk-mark tone-ok">this host</span> : null}
          <HostState peer={peer ?? undefined} />
          {host?.retired === true ? <Status tone="idle" label="retired: no line in 30 days" /> : null}
          <Status tone={box.tone} label={box.label} />
        </p>
        <p className="page-meta">
          <Link to={href({ to: "host", page: "hosts" })}>All machines</Link>
          <Link to={href({ to: "host", page: "topology" })}>Topology</Link>
        </p>
      </header>
      <div className="sy-grid">
        <Section title="Live">
          {peer?.live === undefined || peer.live === null ? <Empty>{peer === null ? "This host was not probed." : `Its darius serve did not answer${peer.reason === null ? "" : `: ${peer.reason}`}.`}</Empty> : <LiveFacts live={peer.live} />}
        </Section>
        <Section title="In the ledgers">
          {host === null ? (
            <Empty>No ledger line of this host here.</Empty>
          ) : (
            <div className="panel panel-pad">
              <LedgerFacts host={host} />
            </div>
          )}
        </Section>
      </div>
      <Section title={openFrom === "live" ? "Open runs" : "Open runs, from the ledgers"}>
        <OpenRuns runs={openRuns} titles={titles} />
      </Section>
      <Section title="Pinned here">
        {pinned.length === 0 ? (
          <Empty>No ritual is pinned to this host.</Empty>
        ) : (
          <ul className="sy-list panel">
            {pinned.map(({ project, ritual }) => (
              <li key={`${project}/${ritual.slug}`} className="sy-item">
                <p className="sy-item-head">
                  <Link to={href({ to: "ritual", ws: project, slug: ritual.slug })} className="sy-name">
                    {ritual.title}
                  </Link>
                  <span className="text-muted">{isDjinn(ritual) ? "djinn" : "ritual"}</span>
                  <Status tone={ritual.lifecycle === "active" ? "ok" : "idle"} label={ritual.lifecycle} />
                </p>
                <p className="sy-meta">
                  <span>{project}</span>
                  {ritual.nextDueAt === null ? <span className="ink-idle">no schedule</span> : <span>next due {ritual.nextDue ?? ritual.nextDueAt}</span>}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Rituals that last ran here">
        <LastList entries={lastRuns} titles={titles} none="No ritual ran here last." />
      </Section>
      <Section title="Vigils last swept here">
        <LastList entries={lastSweeps} titles={titles} none="No vigil was swept here last." />
      </Section>
      <Section title="Projects">
        {host === null || host.projects.length === 0 ? (
          <Empty>This host wrote into no project here.</Empty>
        ) : (
          <ul className="sy-list panel">
            {host.projects.map((project) => (
              <li key={project} className="sy-item">
                <p className="sy-item-head">
                  <span className="sy-name">{project}</span>
                  {checkouts.includes(project) ? <span className="text-muted">checkout here</span> : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="darius versions">
        {host === null || host.versions.length === 0 ? (
          <Empty>No host.version line of this host here (before 0.126.0).</Empty>
        ) : (
          <ul className="sy-list panel">
            {host.versions.map((step) => (
              <li key={`${step.version}/${step.at}`} className="sy-item">
                <p className="sy-item-head">
                  <span className="sy-name">{step.version}</span>
                  <Time iso={step.at} />
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
