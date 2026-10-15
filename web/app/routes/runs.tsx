import { data, Link, redirect } from "react-router";

import type { Route } from "./+types/runs";
import { Crumbs } from "../components/crumbs.tsx";
import { ChipRow, chipClass } from "../components/chip-row.tsx";
import { RunList } from "../components/runs.tsx";
import { Section } from "../components/ui.tsx";
import { scopeProjects } from "../lib/home.ts";
import { href, RUN_ACKS, RUN_KINDS, RUN_STARTERS, runsFilterOf, runsQuery, type RunsFilter } from "../lib/paths.ts";
import { filterSentence, runMatches } from "../lib/runs-filter.ts";
import { readSettings } from "../lib/settings.ts";
import { statusOf } from "../lib/status.ts";
import { activity } from "../lib/view.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

const STATES = ["held", "running", "complete", "failed", "abandoned"] as const;

/**
 * The Runs list, for `/runs` (all workspaces) and `/w/:ws/runs` (one). The old
 * `/runs?project=<ws>` redirects to the second; its other parameters stay.
 */
export function loader({ context, request, params: route }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const legacy = params.get("project") ?? "";
  if (route.ws === undefined && legacy !== "") {
    params.delete("project");
    throw redirect(href({ to: "section", ws: legacy, section: "runs", query: Object.fromEntries(params) }), 301);
  }
  const project = route.ws ?? "";
  const filter = runsFilterOf(params);
  const status = statusOf(context);
  if (project !== "" && !status.projects.some((candidate) => candidate.name === project)) throw data(`No workspace named ${project} on this host.`, { status: 404 });
  // The self-test workspace stays out of the list of every project, as in all other lists, unless the settings show it (or the address names it).
  const { showSelftest } = readSettings(request.headers.get("cookie"));
  const projects = project === "" ? scopeProjects(status, { workspace: null, includeSelftest: showSelftest }) : status.projects;
  const runs = activity(
    projects.filter((candidate) => project === "" || candidate.name === project),
    { withImported: filter.imported },
  ).filter((run) => runMatches(run, filter));
  return { runs, project, filter, projects: projects.map((candidate) => candidate.name) };
}

export const meta: Route.MetaFunction = ({ data: loaded }) => [{ title: loaded === undefined || loaded.project === "" ? "Runs | darius" : `Runs · ${loaded.project} | darius` }];

/** The address of the list for a workspace ("" for all) and a filter: the query holds only what narrows it. */
function runsHref(project: string, filter: RunsFilter): string {
  return href({ to: "section", ws: project === "" ? null : project, section: "runs", query: runsQuery(filter) });
}

export default function Runs({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { runs, project, filter, projects } = loaderData;
  const change = (part: Partial<RunsFilter>): string => runsHref(project, { ...filter, ...part });
  return (
    <div>
      <header className="page-head">
        <Crumbs />
        <h1 className="page-title">Runs</h1>
        <p className="page-meta">
          <span>{filterSentence(filter, project)}</span>
        </p>
      </header>
      <div className="board">
        <div className="board-main">
          <div className="panel">
            <RunList runs={runs} showProject={project === ""} empty="No run matches this filter." />
          </div>
        </div>
        <aside className="board-rail rail-first rail-filter">
          <Section title="Filter">
            <nav aria-label="Filter" className="filters panel panel-pad">
              {project !== "" || projects.length < 2 ? null : (
                <ChipRow label="Workspace" current={project}>
                  <Link to={runsHref("", filter)} className={chipClass(project === "")} aria-current={project === "" ? "true" : undefined}>
                    all workspaces
                  </Link>
                  {projects.map((name) => (
                    <Link key={name} to={runsHref(name, filter)} className={chipClass(project === name)} aria-current={project === name ? "true" : undefined}>
                      {name}
                    </Link>
                  ))}
                </ChipRow>
              )}
              <ChipRow label="State" current={filter.state}>
                {["", ...STATES].map((name) => (
                  <Link key={name} to={change({ state: name })} className={chipClass(name === filter.state)} aria-current={name === filter.state ? "true" : undefined}>
                    {name === "" ? "any state" : name}
                  </Link>
                ))}
                <Link to={change({ imported: !filter.imported })} className={chipClass(filter.imported, true)} aria-current={filter.imported ? "true" : undefined}>
                  {filter.imported ? "with imported runs" : "show imported runs"}
                </Link>
              </ChipRow>
              <ChipRow label="Kind" current={filter.kind}>
                {(["", ...RUN_KINDS] as const).map((name) => (
                  <Link key={name} to={change({ kind: name })} className={chipClass(name === filter.kind)} aria-current={name === filter.kind ? "true" : undefined}>
                    {name === "" ? "any kind" : name}
                  </Link>
                ))}
              </ChipRow>
              <ChipRow label="Started by" current={filter.by}>
                {(["", ...RUN_STARTERS] as const).map((name) => (
                  <Link key={name} to={change({ by: name })} className={chipClass(name === filter.by)} aria-current={name === filter.by ? "true" : undefined}>
                    {name === "" ? "anyone" : name}
                  </Link>
                ))}
              </ChipRow>
              <ChipRow label="Questions" current={filter.ack}>
                {(["", ...RUN_ACKS] as const).map((name) => (
                  <Link key={name} to={change({ ack: name })} className={chipClass(name === filter.ack)} aria-current={name === filter.ack ? "true" : undefined}>
                    {name === "" ? "any answer" : name}
                  </Link>
                ))}
              </ChipRow>
            </nav>
          </Section>
        </aside>
      </div>
    </div>
  );
}
