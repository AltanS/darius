import { Link } from "react-router";

import type { Route } from "./+types/flares";
import { ChipRow, chipClass } from "../components/chip-row.tsx";
import { FlareRows } from "../components/flares.tsx";
import { Section } from "../components/ui.tsx";
import { emptyText, filterFlares, flaresHref, litCount, readView, viewText, type FlareView } from "../lib/flares.ts";
import { scopeOfRequest } from "../lib/scope.ts";
import { statusOf } from "../lib/status.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

/**
 * The Flares page (0.112.0), for `/flares` (all workspaces) and
 * `/w/:ws/flares` (one workspace). Two views, in the address: the lit flares
 * (the default) and all of them. A flare is a problem that needs you and does
 * not go away by itself; the page lists each with how bad it is, where, and
 * how often it was seen.
 */
export async function loader({ context, request, params }: Route.LoaderArgs) {
  const status = statusOf(context);
  const { projects } = scopeOfRequest(status, request, params.ws);
  const view = readView(new URL(request.url).searchParams);
  const names = new Set(projects.map((project) => project.name));
  const rows = (await context.flares()).filter((row) => names.has(row.project));
  const shown = filterFlares(rows, view);
  return {
    scope: params.ws ?? null,
    view,
    shown,
    litTotal: litCount(rows),
    allTotal: rows.length,
    many: new Set(rows.map((row) => row.project)).size > 1,
    canWrite: context.canWrite,
  };
}

export const meta: Route.MetaFunction = ({ data }) => [{ title: data?.scope === null || data === undefined ? "Flares | darius" : `Flares · ${data.scope} | darius` }];

export default function Flares({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { scope, view, shown, litTotal, allTotal, many } = loaderData;
  const views: readonly { view: FlareView; label: string; count: number }[] = [
    { view: "lit", label: "lit", count: litTotal },
    { view: "all", label: "all", count: allTotal },
  ];
  return (
    <div>
      <header className="page-head">
        <h1 className="page-title">Flares</h1>
        <p className="page-meta">
          <span>{viewText(view, scope)}</span>
        </p>
      </header>
      <div className="board">
        <div className="board-main">
          <div className="panel">
            <FlareRows rows={shown} showProject={scope === null && many} empty={emptyText(view, allTotal > 0)} />
          </div>
        </div>
        <aside className="board-rail rail-first rail-filter">
          <Section title="View">
            <nav aria-label="View" className="filters panel panel-pad">
              <ChipRow label="Show" current={view}>
                {views.map((one) => (
                  <Link key={one.view} to={flaresHref(scope, one.view)} className={chipClass(one.view === view)} aria-current={one.view === view ? "true" : undefined}>
                    {`${one.label} (${one.count})`}
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
