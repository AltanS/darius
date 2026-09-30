import type { Route } from "./+types/vigils";
import { ComingUp, Waiting } from "../components/agenda.tsx";
import { KindWord } from "../components/chip.tsx";
import { Row, RowList } from "../components/row.tsx";
import { SectionPageHead } from "../components/section.tsx";
import { Fold } from "../components/ui.tsx";
import { buildAgenda } from "../lib/agenda.ts";
import { vigilAnchor } from "../lib/format.ts";
import { scopeOfRequest } from "../lib/scope.ts";
import { vigilWord } from "../lib/state-words.ts";
import { statusOf } from "../lib/status.ts";
import { useHashTarget } from "../lib/target.ts";
import { closedVigils } from "../lib/workspace.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

/** Rows of Waiting on an event before its fold. */
const WAITING_SHOWN = 3;

/** Closed vigils shown in their fold; a long-running workspace has dozens. */
const CLOSED_SHOWN = 10;

/** The Vigils section, for `/vigils` (all workspaces) and `/w/:ws/vigils`. */
export function loader({ context, request, params }: Route.LoaderArgs) {
  const status = statusOf(context);
  const { scope, projects } = scopeOfRequest(status, request, params.ws);
  const closed = closedVigils(projects);
  return {
    workspace: scope.workspace,
    agenda: buildAgenda({ projects, today: status.today, only: "vigil" }),
    closed: closed.slice(0, CLOSED_SHOWN),
    closedCount: closed.length,
    showProject: projects.length > 1,
  };
}

export const meta: Route.MetaFunction = ({ data }) => [{ title: data?.workspace === null || data === undefined ? "Vigils | darius" : `Vigils · ${data.workspace} | darius` }];

/** Vigils by day (the dated ones, with the late first), the ones that wait for an event, and the closed ones in a fold. */
export default function Vigils({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { workspace, agenda, closed, closedCount, showProject } = loaderData;
  const target = useHashTarget();
  const closedTarget = closed.some(({ vigil }) => vigilAnchor(vigil.slug) === target);
  return (
    <div className="proj">
      <SectionPageHead title="Vigils" workspace={workspace} fact={`${agenda.armed} armed, ${closedCount} closed`} />
      <div className="proj-body">
        <div className="board">
          <div className="board-main">
            <ComingUp agenda={agenda} anchors target={target} />
          </div>
          <aside className="board-rail">
            <Waiting rows={agenda.waiting} shown={WAITING_SHOWN} showProject={showProject} anchors target={target} />
            {closed.length === 0 ? null : (
              <div className="folds proj-closed">
                <Fold open={closedTarget} summary={`Closed vigils (${closedCount})`}>
                  <RowList bare>
                    {closed.map(({ project, vigil }) => {
                      const id = vigilAnchor(vigil.slug);
                      return <Row key={`${project}/${vigil.slug}`} id={id} kind="vigil" title={vigil.title} chips={<KindWord kind="vigil" />} state={vigilWord(vigil)} meta={[showProject ? project : null, vigil.lastOutcome === null ? null : `last check ${vigil.lastOutcome}`].filter((part) => part !== null)} className={`target-row${target === id ? " is-target" : ""}`} />;
                    })}
                  </RowList>
                  {closedCount > CLOSED_SHOWN ? <p className="rail-note mt-3">{closedCount - CLOSED_SHOWN} older ones are not shown.</p> : null}
                </Fold>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
