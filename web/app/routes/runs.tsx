import { useEffect, useRef } from "react";
import { Link } from "react-router";

import type { Route } from "./+types/runs";
import { RunList } from "../components/runs.tsx";
import { Section } from "../components/ui.tsx";
import { scopeProjects } from "../lib/home.ts";
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

export function loader({ context, request }: Route.LoaderArgs) {
  const params = new URL(request.url).searchParams;
  const project = params.get("project") ?? "";
  const state = params.get("state") ?? "";
  const withImported = params.get("imported") === "1";
  const status = statusOf(context);
  // The self-test workspace stays out of the list of every project, as in all other lists, unless the settings show it (or the address names it).
  const { showSelftest } = readSettings(request.headers.get("cookie"));
  const projects = project === "" ? scopeProjects(status, { workspace: null, includeSelftest: showSelftest }) : status.projects;
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

function chipClass(isActive: boolean, isToggle = false): string {
  const kind = isToggle ? "fchip fchip-toggle" : "fchip";
  return isActive ? `${kind} fchip-on` : kind;
}

interface ChipRowProps {
  label: string;
  /** The chip that is on; the row scrolls it into view when this changes. */
  current: string;
  children: React.ReactNode;
}

/**
 * One row of filter chips. On a phone the row scrolls sideways instead of
 * wrapping, so the filter stays two lines tall; the chip that is on is
 * scrolled into view, so the row never hides the current filter.
 */
function ChipRow({ label, current, children }: ChipRowProps): React.ReactNode {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = row.current;
    if (element === null) return;
    const on = element.querySelector<HTMLElement>(".fchip-on:not(.fchip-toggle)");
    if (on === null) return;
    element.scrollLeft = Math.max(0, on.offsetLeft - (element.clientWidth - on.offsetWidth) / 2);
  }, [current]);
  return (
    <div ref={row} role="group" aria-label={label} className="fchips">
      {children}
    </div>
  );
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
              {projects.length < 2 ? null : (
                <ChipRow label="Project" current={project}>
                  <Link to={href({ ...query, project: "" })} className={chipClass(project === "")} aria-current={project === "" ? "true" : undefined}>
                    all projects
                  </Link>
                  {projects.map((name) => (
                    <Link key={name} to={href({ ...query, project: name })} className={chipClass(project === name)} aria-current={project === name ? "true" : undefined}>
                      {name}
                    </Link>
                  ))}
                </ChipRow>
              )}
              <ChipRow label="State" current={state}>
                {["", ...STATES].map((name) => (
                  <Link key={name} to={href({ ...query, state: name })} className={chipClass(name === state)} aria-current={name === state ? "true" : undefined}>
                    {name === "" ? "any state" : name}
                  </Link>
                ))}
                <Link to={href({ ...query, withImported: !withImported })} className={chipClass(withImported, true)} aria-current={withImported ? "true" : undefined}>
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
