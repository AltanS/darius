import { Link } from "react-router";

import type { Route } from "./+types/runs";
import { RunList } from "../components/runs.tsx";
import { Section } from "../components/ui.tsx";
import { statusOf } from "../lib/status.ts";
import { activity, type ActivityRun } from "../lib/view.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

const STATES = ["held", "running", "complete", "failed", "abandoned"] as const;

function matches(run: ActivityRun, state: string): boolean {
  if (state === "") return true;
  if (state === "held" || state === "running") return run.phase === state;
  return run.phase === "closed" && run.outcome === state;
}

export function loader({ context, request }: Route.LoaderArgs) {
  const params = new URL(request.url).searchParams;
  const project = params.get("project") ?? "";
  const state = params.get("state") ?? "";
  const withImported = params.get("imported") === "1";
  const { projects } = statusOf(context);
  const runs = activity(
    projects.filter((candidate) => project === "" || candidate.name === project),
    { withImported },
  ).filter((run) => matches(run, state));
  return { runs, project, state, withImported, projects: projects.map((candidate) => candidate.name) };
}

export const meta: Route.MetaFunction = () => [{ title: "Runs | darius" }];

interface Query {
  project: string;
  state: string;
  withImported: boolean;
}

function href(query: Query): string {
  const params = new URLSearchParams();
  if (query.project !== "") params.set("project", query.project);
  if (query.state !== "") params.set("state", query.state);
  if (query.withImported) params.set("imported", "1");
  const text = params.toString();
  return text === "" ? "/runs" : `/runs?${text}`;
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
  const where = query.project === "" ? " of every project" : ` in ${query.project}`;
  const imported = query.withImported ? ", imported runs included" : "";
  return `${what}${where}${imported}, newest first.`;
}

function pillClass(isActive: boolean): string {
  return isActive ? "pill pill-active" : "pill";
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
          <RunList runs={runs} showProject={project === ""} empty="No run matches this filter." />
        </div>
        <aside className="board-rail rail-first">
          <Section title="Filter">
            <nav aria-label="Filter" className="filters panel panel-pad">
              {projects.length < 2 ? null : (
                <p className="pills">
                  <Link to={href({ ...query, project: "" })} className={pillClass(project === "")}>
                    all projects
                  </Link>
                  {projects.map((name) => (
                    <Link key={name} to={href({ ...query, project: name })} className={pillClass(project === name)}>
                      {name}
                    </Link>
                  ))}
                </p>
              )}
              <p className="pills">
                {["", ...STATES].map((name) => (
                  <Link key={name} to={href({ ...query, state: name })} className={pillClass(name === state)}>
                    {name === "" ? "any state" : name}
                  </Link>
                ))}
                <Link to={href({ ...query, withImported: !withImported })} className={pillClass(withImported)}>
                  {withImported ? "with imported runs" : "show imported runs"}
                </Link>
              </p>
            </nav>
          </Section>
        </aside>
      </div>
    </div>
  );
}
