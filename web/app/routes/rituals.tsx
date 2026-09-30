import { Link } from "react-router";

import type { Route } from "./+types/rituals";
import { ComingUp } from "../components/agenda.tsx";
import { PhoneMore } from "../components/pulse.tsx";
import { RunList } from "../components/runs.tsx";
import { SectionPageHead } from "../components/section.tsx";
import { SectHead } from "../components/ui.tsx";
import { buildAgenda } from "../lib/agenda.ts";
import { scopeOfRequest } from "../lib/scope.ts";
import { statusOf } from "../lib/status.ts";
import { activity } from "../lib/view.ts";
import { RECENT } from "../lib/workspace.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

/** Recent runs a phone shows before its own button. */
const RECENT_PHONE = 3;

/** The Rituals section, for `/rituals` (all workspaces) and `/w/:ws/rituals`. */
export function loader({ context, request, params }: Route.LoaderArgs) {
  const status = statusOf(context);
  const { scope, projects } = scopeOfRequest(status, request, params.ws);
  const agenda = buildAgenda({ projects, today: status.today, only: "ritual" });
  return {
    workspace: scope.workspace,
    agenda,
    active: agenda.groups.reduce((sum, group) => sum + group.rows.length, 0),
    recent: activity(projects, { withImported: false })
      .filter((run) => run.kind === "ritual")
      .slice(0, RECENT),
  };
}

export const meta: Route.MetaFunction = ({ data }) => [{ title: data?.workspace === null || data === undefined ? "Rituals | darius" : `Rituals · ${data.workspace} | darius` }];

/** Rituals by day, the late ones first, then the recent runs and the way to all of them. */
export default function Rituals({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { workspace, agenda, active, recent } = loaderData;
  const runsPath = workspace === null ? "/runs" : `/runs?project=${encodeURIComponent(workspace)}`;
  return (
    <div className="proj">
      <SectionPageHead title="Rituals" workspace={workspace} fact={`${active} active, ${agenda.overdue} late`} />
      <div className="proj-body">
        <div className="board">
          <div className="board-main">
            <ComingUp agenda={agenda} anchors={false} target="" />
            <section id="recent" className="section">
              <SectHead title="Recent runs" aside={<Link to={runsPath}>All runs</Link>} />
              <div className="panel">
                <PhoneMore hidden={recent.length - RECENT_PHONE} noun="run">
                  <RunList runs={recent} showProject={workspace === null} empty="darius has not run anything here yet." phoneShown={RECENT_PHONE} />
                </PhoneMore>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
