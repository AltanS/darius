import type { Route } from "./+types/overview";
import { ComingUp, Waiting, WAITING_SHOWN } from "../components/agenda.tsx";
import { CardView, NowList, Pieces, StatusStrip } from "../components/board.tsx";
import { SectHead } from "../components/ui.tsx";
import { homeView } from "../lib/home.ts";
import { statusOf } from "../lib/status.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

export function loader({ context }: Route.LoaderArgs) {
  return homeView(statusOf(context), (project, run) => context.run(project, run));
}

export const meta: Route.MetaFunction = () => [{ title: "darius" }];

/**
 * The command board, across all projects. The verdict (with what is next) and
 * the status strip on top; then, on a phone, Needs you, Now, Coming up,
 * Waiting on an event, Last night and one health line. On a desktop the wide
 * column holds Needs you, Now and Coming up, and the rail holds Waiting on an
 * event, Last night and the health line. Each run shows once.
 */
export default function Overview({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { verdict, tone, sub, strip, now, needs, quiet, lastNight, agenda, health } = loaderData;
  return (
    <>
      <section className="verdict">
        <h1 className={`verdict-h ink-${tone}`}>{verdict}</h1>
        <p className="verdict-sub">{sub}</p>
      </section>
      <StatusStrip segments={strip} />
      <div className="board board-home">
        <div className="board-main">
          <section className="section sec-needs" id="needs">
            <SectHead title="Needs you" />
            {needs.length === 0 ? (
              <p className="quiet">{quiet}</p>
            ) : (
              <div className="cards">
                {needs.map((card) => (
                  <CardView key={card.id} card={card} />
                ))}
              </div>
            )}
          </section>
          {now.length === 0 ? null : (
            <section className="section sec-now" id="now">
              <SectHead title="Now" />
              <NowList runs={now} />
            </section>
          )}
          <ComingUp agenda={agenda} anchors={false} target="" />
        </div>
        <aside className="board-rail">
          <Waiting rows={agenda.waiting} shown={WAITING_SHOWN} showProject={agenda.showProject} anchors={false} target="" />
          {lastNight.length === 0 ? null : (
            <section className="section sec-last">
              <SectHead title="Last night" />
              <div className="lastnight">
                {lastNight.map((card) => (
                  <CardView key={card.id} card={card} />
                ))}
              </div>
            </section>
          )}
          <p className="health sec-health">
            <Pieces pieces={health} />
          </p>
        </aside>
      </div>
    </>
  );
}
