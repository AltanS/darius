import { Link, redirect } from "react-router";

import type { Route } from "./+types/findings";
import { ChipRow, chipClass } from "../components/chip-row.tsx";
import { FindingList } from "../components/findings.tsx";
import { Section } from "../components/ui.tsx";
import { emptyText, facetOptions, filterFindings, filterText, findingsHref, readQuery, viewCount, VIEWS, type FindingQuery } from "../lib/findings.ts";
import { scopeOfRequest } from "../lib/scope.ts";
import { statusOf } from "../lib/status.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

/**
 * The Findings page, for `/findings` (all workspaces) and `/w/:ws/findings`
 * (one workspace). The filters are in the address: view, ritual and severity
 * (lib/findings.ts). The old `/findings?project=<ws>` redirects to the second.
 */
export async function loader({ context, request, params }: Route.LoaderArgs) {
  const status = statusOf(context);
  const { projects } = scopeOfRequest(status, request, params.ws);
  const query = readQuery(new URL(request.url).searchParams);
  if (params.ws === undefined && query.project !== "") throw redirect(findingsHref(query.project, { ...query, project: "" }), 301);
  const names = new Set(projects.map((project) => project.name));
  const scope = params.ws ?? null;
  const rows = (await context.findings()).filter((row) => names.has(row.project));
  // The page is one workspace or all of them; its own `project` filter is moot.
  const effective: FindingQuery = { ...query, project: "" };
  return {
    scope,
    query: effective,
    shown: filterFindings(rows, effective),
    counts: VIEWS.map(({ view }) => viewCount(rows, effective, view)),
    projectOptions: scope === null ? facetOptions(rows, effective, "project") : [],
    ritualOptions: facetOptions(rows, effective, "ritual"),
    severityOptions: facetOptions(rows, effective, "severity"),
    many: new Set(rows.map((row) => row.project)).size > 1,
  };
}

export const meta: Route.MetaFunction = ({ data }) => [{ title: data?.scope === null || data === undefined ? "Findings | darius" : `Findings · ${data.scope} | darius` }];

export default function Findings({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { scope, query, shown, counts, projectOptions, ritualOptions, severityOptions, many } = loaderData;
  const to = (change: Partial<FindingQuery>): string => findingsHref(scope, { ...query, ...change });
  const showProject = scope === null && query.project === "" && many;
  return (
    <div>
      <header className="page-head">
        <h1 className="page-title">Findings</h1>
        <p className="page-meta">
          <span>{filterText(query, scope)}</span>
        </p>
      </header>
      <div className="board">
        <div className="board-main">
          <div className="panel">
            <FindingList rows={shown} showProject={showProject} empty={emptyText(query)} />
          </div>
        </div>
        <aside className="board-rail rail-first rail-filter">
          <Section title="Filter">
            <nav aria-label="Filter" className="filters panel panel-pad">
              <ChipRow label="View" current={query.view}>
                {VIEWS.map(({ view, label }, index) => (
                  <Link key={view} to={to({ view })} className={chipClass(view === query.view)} aria-current={view === query.view ? "true" : undefined}>
                    {`${label} (${counts[index] ?? 0})`}
                  </Link>
                ))}
              </ChipRow>
              {projectOptions.length < 2 ? null : (
                <ChipRow label="Workspace" current="">
                  <Link to={to({})} className={chipClass(true)} aria-current="true">
                    all workspaces
                  </Link>
                  {projectOptions.map((name) => (
                    <Link key={name} to={findingsHref(name, query)} className={chipClass(false)}>
                      {name}
                    </Link>
                  ))}
                </ChipRow>
              )}
              {ritualOptions.length < 2 && query.ritual === "" ? null : (
                <ChipRow label="Ritual" current={query.ritual}>
                  <Link to={to({ ritual: "" })} className={chipClass(query.ritual === "")} aria-current={query.ritual === "" ? "true" : undefined}>
                    any ritual
                  </Link>
                  {ritualOptions.map((name) => (
                    <Link key={name} to={to({ ritual: name })} className={chipClass(query.ritual === name)} aria-current={query.ritual === name ? "true" : undefined}>
                      {name}
                    </Link>
                  ))}
                </ChipRow>
              )}
              {severityOptions.length < 2 && query.severity === "" ? null : (
                <ChipRow label="Severity" current={query.severity}>
                  <Link to={to({ severity: "" })} className={chipClass(query.severity === "")} aria-current={query.severity === "" ? "true" : undefined}>
                    any severity
                  </Link>
                  {severityOptions.map((name) => (
                    <Link key={name} to={to({ severity: name })} className={chipClass(query.severity === name)} aria-current={query.severity === name ? "true" : undefined}>
                      {name}
                    </Link>
                  ))}
                </ChipRow>
              )}
            </nav>
          </Section>
        </aside>
      </div>
    </div>
  );
}
