import { Link } from "react-router";

import type { Route } from "./+types/overview";
import { CardView, DoneRows, NextUp, NowList, Pieces, StatusStrip } from "../components/board.tsx";
import { PhoneMore } from "../components/pulse.tsx";
import { RowList } from "../components/row.tsx";
import { ReportRow, RunList } from "../components/runs.tsx";
import { Empty, SectHead, Time } from "../components/ui.tsx";
import { WorkspaceList } from "../components/workspaces.tsx";
import { homeView, workspaceRows } from "../lib/home.ts";
import { href } from "../lib/paths.ts";
import { scopeOfRequest } from "../lib/scope.ts";
import { statusOf } from "../lib/status.ts";
import { workspaceExtras, type WorkspaceExtras } from "../lib/workspace.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

/** Latest-report rows a phone shows before its own button. */
const REPORTS_PHONE = 3;

/** Recent runs a phone shows before its own button. */
const RECENT_PHONE = 3;

/**
 * One loader for two addresses: `/all` (all workspaces) and `/w/:ws` (one
 * workspace). `/` redirects to one of them (routes/index.tsx).
 */
export function loader({ context, request, params }: Route.LoaderArgs) {
  const status = statusOf(context);
  const { scope, projects } = scopeOfRequest(status, request, params.ws);
  const read = (project: string, run: string) => context.run(project, run);
  const only = scope.workspace === null ? undefined : projects[0];
  return {
    workspace: scope.workspace,
    home: homeView(status, read, scope),
    workspaces: scope.workspace === null ? workspaceRows(status, scope) : null,
    extras: only === undefined ? null : workspaceExtras(only, read),
    canWrite: context.canWrite,
  };
}

export const meta: Route.MetaFunction = ({ data }) => [{ title: data?.workspace === null || data === undefined ? "Overview | darius" : `Overview · ${data.workspace} | darius` }];

interface PathTextProps {
  path: string;
}

/** A path that may break after each slash, so a long checkout wraps at a folder. */
function PathText({ path }: PathTextProps): React.ReactNode {
  return path.split("/").map((part, index) => (
    <span key={`${index}`}>
      {index === 0 ? "" : "/"}
      <wbr />
      {part}
    </span>
  ));
}

interface WorkspaceMetaProps {
  extras: WorkspaceExtras;
}

/** The facts of a workspace, at the end of the rail: its limits, its last sync and where its checkout is. */
function WorkspaceMeta({ extras }: WorkspaceMetaProps): React.ReactNode {
  return (
    <section className="section sec-facts">
      <SectHead title="Workspace" />
      <div className="ws-meta">
        <p className="page-meta meta-dots">
          {extras.maxMode === null ? null : <span>at most {extras.maxMode} mode</span>}
          <span>
            synced <Time iso={extras.lastSync} />
          </span>
          {extras.checkout === null ? <span>not linked on this host</span> : null}
        </p>
        {extras.checkout === null ? null : (
          <p className="ws-path">
            <code>
              <PathText path={extras.checkout} />
            </code>
          </p>
        )}
      </div>
    </section>
  );
}

interface ReportsProps {
  extras: WorkspaceExtras;
}

/** The latest report of each djinn of the workspace. */
function LatestReports({ extras }: ReportsProps): React.ReactNode {
  const { djinns } = extras;
  if (djinns.length === 0 && extras.hasUnattendedWithoutDjinn) return null;
  return (
    <section id="reports" className="section sec-reports">
      <SectHead title="Latest reports" />
      {djinns.length === 0 ? (
        <Empty>darius runs no ritual of this workspace yet.</Empty>
      ) : (
        <div className="panel">
          <PhoneMore hidden={djinns.length - REPORTS_PHONE} noun="report">
            <RowList bare className="stagger">
              {djinns.map(({ ritual, last, report }, index) => (
                <ReportRow key={ritual.slug} project={extras.name} ritual={ritual} last={last} report={report} showProject={false} className={index >= REPORTS_PHONE ? "phone-extra" : undefined} />
              ))}
            </RowList>
          </PhoneMore>
        </div>
      )}
    </section>
  );
}

/** The recent runs of the workspace, and the way to all of them. */
function RecentRuns({ extras }: ReportsProps): React.ReactNode {
  const { recent } = extras;
  return (
    <section id="recent" className="section sec-recent">
      <SectHead title="Recent runs" aside={<Link to={href({ to: "section", ws: extras.name, section: "runs" })}>All runs</Link>} />
      <div className="panel">
        <PhoneMore hidden={recent.length - RECENT_PHONE} noun="run">
          <RunList runs={recent} showProject={false} empty="darius has not run anything here yet." phoneShown={RECENT_PHONE} />
        </PhoneMore>
      </div>
    </section>
  );
}

/**
 * The Overview of a scope: the verdict, the Next line and the status strip on
 * top (the strip only has the segments above zero). Then Needs you (only when
 * something needs you), Now (only when something runs) and Last night. A
 * workspace adds its latest reports, its recent runs and where its checkout
 * is, at the end of the rail; all workspaces add the Workspaces list after
 * Needs you and one link to the list of all runs. What is coming up
 * lives in the Rituals and Vigils sections: the Next line and the strip link
 * there. On a phone the sections stack in the order of the day; on a desktop
 * the wide column holds Needs you, Now and the reports, the rail holds Last
 * night and the health line. Each run shows once.
 */
export default function Overview({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { home, extras, workspaces, canWrite } = loaderData;
  const { verdict, tone, sub, next, strip, now, needs, lastNight, health } = home;
  return (
    <div className="proj ov">
      <section className="verdict">
        <h1 className={`verdict-h ink-${tone}`}>{verdict}</h1>
        <p className="verdict-sub">{sub}</p>
        {next === null ? null : <NextUp next={next} />}
      </section>
      <StatusStrip segments={strip} />
      <div className="board board-home">
        <div className="board-main">
          {needs.length === 0 ? null : (
            <section className="section sec-needs" id="needs">
              <SectHead title="Needs you" />
              <div className="cards">
                {needs.map((card) => (
                  <CardView key={card.id} card={card} canWrite={canWrite} />
                ))}
              </div>
            </section>
          )}
          {workspaces === null ? null : <WorkspaceList rows={workspaces} />}
          {now.length === 0 ? null : (
            <section className="section sec-now" id="now">
              <SectHead title="Now" />
              <NowList runs={now} />
            </section>
          )}
          {extras === null ? null : <LatestReports extras={extras} />}
          {extras === null ? null : <RecentRuns extras={extras} />}
        </div>
        <aside className="board-rail">
          {lastNight.length === 0 ? null : (
            <section className="section sec-last">
              <SectHead title="Last night" />
              <div className="panel">
                <DoneRows cards={lastNight} />
              </div>
            </section>
          )}
          <p className="health sec-health">
            <Pieces pieces={health} />
          </p>
          {extras === null ? (
            <p className="rail-note sec-runs">
              <Link to={href({ to: "section", ws: null, section: "runs" })}>All runs</Link>
            </p>
          ) : (
            <WorkspaceMeta extras={extras} />
          )}
        </aside>
      </div>
    </div>
  );
}
