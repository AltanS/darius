import { data } from "react-router";

import type { Route } from "./+types/milestones";
import { Workspace } from "../components/milestones.tsx";
import { isSelftest } from "../lib/home.ts";
import { hasMilestones, workspaceMilestones } from "../lib/milestones.ts";
import { readSettings } from "../lib/settings.ts";
import { statusOf } from "../lib/status.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

/**
 * Serves `/w/:ws/milestones` (one workspace) and `/milestones` (all of them,
 * grouped by workspace). The loader hands over only the milestones of the
 * scope, not the status. The all-workspaces page leaves out a workspace with
 * nothing to show, and the self-test workspace unless the settings ask for it.
 */
export function loader({ context, params, request }: Route.LoaderArgs) {
  const status = statusOf(context);
  const wanted = params.ws;
  if (wanted !== undefined) {
    const project = status.projects.find((candidate) => candidate.name === wanted);
    if (project === undefined) throw data(`No workspace named ${wanted} on this host.`, { status: 404 });
    return { scope: wanted, workspaces: [workspaceMilestones(project, status.today)] };
  }
  const { showSelftest } = readSettings(request.headers.get("cookie"));
  const workspaces = status.projects
    .filter((project) => showSelftest || !isSelftest(project.name))
    .map((project) => workspaceMilestones(project, status.today))
    .filter((workspace) => hasMilestones(workspace) || workspace.error !== null);
  return { scope: null, workspaces };
}

export const meta: Route.MetaFunction = ({ data: loaded }) => [{ title: `Milestones${loaded === undefined || loaded.scope === null ? "" : ` · ${loaded.scope}`} | darius` }];

/** Read-only: the legacy tracker's milestones, one row each, opening in place to their specs. */
export default function Milestones({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { scope, workspaces } = loaderData;
  return (
    <div className="ms-page">
      <header className="ms-head">
        <h1 className="ms-h1">Milestones</h1>
        <p className="ms-sub">{scope === null ? "All workspaces, read-only, from the tracker" : "Read-only, from the tracker"}</p>
      </header>
      {workspaces.length === 0 ? <p className="ms-empty">No milestones in any workspace.</p> : workspaces.map((workspace) => <Workspace key={workspace.name} workspace={workspace} named={scope === null} />)}
    </div>
  );
}
