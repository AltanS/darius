import { data, Link, redirect } from "react-router";

import type { Route } from "./+types/runs";
import { ChipRow, chipClass } from "../components/chip-row.tsx";
import { RunList } from "../components/runs.tsx";
import { Section } from "../components/ui.tsx";
import { scopeProjects } from "../lib/home.ts";
import { href } from "../lib/paths.ts";
import { readSettings } from "../lib/settings.ts";
import { statusOf } from "../lib/status.ts";
import { activity, type ActivityRun } from "../lib/view.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

const STATES = ["held", "running", "complete", "failed", "abandoned"] as const;

function matches(run: ActivityRun, state: string): boolean {
  if (state === "") return true;
  if (state === "held" || state === "running") return run.phase === state;
  return run.phase === "closed" && run.outcome === state;
}

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
  const state = params.get("state") ?? "";
  const withImported = params.get("imported") === "1";
  const status = statusOf(context);
  if (project !== "" && !status.projects.some((candidate) => candidate.name === project)) throw data(`No workspace named ${project} on this host.`, { status: 404 });
  // The self-test workspace stays out of the list of every project, as in all other lists, unless the settings show it (or the address names it).
  const { showSelftest } = readSettings(request.headers.get("cookie"));
  const projects = project === "" ? scopeProjects(status, { workspace: null, includeSelftest: showSelftest }) : status.projects;
  const runs = activity(
    projects.filter((candidate) => project === "" || candidate.name === project),
    { withImported },
  ).filter((run) => matches(run, state));
  return { runs, project, state, withImported, projects: projects.map((candidate) => candidate.name) };
}

export const meta: Route.MetaFunction = ({ data: loaded }) => [{ title: loaded === undefined || loaded.project === "" ? "Runs | darius" : `Runs · ${loaded.project} | darius` }];

interface Query {
  project: string;
  state: string;
  withImported: boolean;
}

function runsHref(query: Query): string {
  const extra: Record<string, string> = {};
  if (query.state !== "") extra.state = query.state;
  if (query.withImported) extra.imported = "1";
  return href({ to: "section", ws: query.project === "" ? null : query.project, section: "runs", query: extra });
}

const STATE_WORDS = new Map([
  ["", "All runs"],
  ["held", "Held runs"],
  ["running", "Runs still running"],
  ["complete", "Complete runs"],
  ["failed", "Failed runs"],
  ["abandoned", "Abandoned runs"],
]);

/** The filter in words: "Held runs in acme-web, newest first." */
function filterText(query: Query): string {
  const what = STATE_WORDS.get(query.state) ?? `Runs that ended ${query.state}`;
  const where = query.project === "" ? " of every workspace" : ` in ${query.project}`;
  const imported = query.withImported ? ", imported runs included" : "";
  return `${what}${where}${imported}, newest first.`;
}

export default function Runs({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { runs, project, state, withImported, projects } = loaderData;
  const query: Query = { project, state, withImported };
  return (
    <div>
      <header className="page-head">
        <h1 className="page-title">Runs</h1>
        <p className="page-meta">
          <span>{filterText(query)}</span>
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
                  <Link to={runsHref({ ...query, project: "" })} className={chipClass(project === "")} aria-current={project === "" ? "true" : undefined}>
                    all workspaces
                  </Link>
                  {projects.map((name) => (
                    <Link key={name} to={runsHref({ ...query, project: name })} className={chipClass(project === name)} aria-current={project === name ? "true" : undefined}>
                      {name}
                    </Link>
                  ))}
                </ChipRow>
              )}
              <ChipRow label="State" current={state}>
                {["", ...STATES].map((name) => (
                  <Link key={name} to={runsHref({ ...query, state: name })} className={chipClass(name === state)} aria-current={name === state ? "true" : undefined}>
                    {name === "" ? "any state" : name}
                  </Link>
                ))}
                <Link to={runsHref({ ...query, withImported: !withImported })} className={chipClass(withImported, true)} aria-current={withImported ? "true" : undefined}>
                  {withImported ? "with imported runs" : "show imported runs"}
                </Link>
              </ChipRow>
            </nav>
          </Section>
        </aside>
      </div>
    </div>
  );
}
