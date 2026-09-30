import type { Route } from "./+types/overview";
import { ComingUp, Waiting, WAITING_SHOWN } from "../components/agenda.tsx";
import { CardView, DoneRows, NextUp, NowList, Pieces, StatusStrip } from "../components/board.tsx";
import { SectHead } from "../components/ui.tsx";
import { homeView } from "../lib/home.ts";
import { statusOf } from "../lib/status.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

export function loader({ context }: Route.LoaderArgs) {
  return homeView(statusOf(context), (project, run) => context.run(project, run));
}

export const meta: Route.MetaFunction = () => [{ title: "darius" }];

/**
 * The command board, across all projects. The verdict, the Next line and the
 * status strip on top (the strip only has the segments above zero); then, on a
 * phone, Needs you (only when something needs you), Now (only when something
 * runs), Coming up, Waiting on an event, Last night and one health line. On a desktop the wide
 * column holds Needs you, Now and Coming up, and the rail holds Waiting on an
 * event, Last night and the health line. Each run shows once.
 */
export default function Overview({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { verdict, tone, sub, next, strip, now, needs, lastNight, agenda, health } = loaderData;
  return (
    <>
      <section className="verdict">
        <h1 className={`verdict-h ink-${tone}`}>{verdict}</h1>
        <p className="verdict-sub">{sub}</p>
        {next === null ? null : <NextUp next={next} />}
      </section>
      <StatusStrip segments={strip} />
      <div className="board board-home">
        <div className="board-main">
          {needs.length === 0 ? null : (
            <section className="section sec-needs" id="needs">
              <SectHead title="Needs you" />
              <div className="cards">
                {needs.map((card) => (
                  <CardView key={card.id} card={card} />
                ))}
              </div>
            </section>
          )}
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
              <div className="panel">
                <DoneRows cards={lastNight} />
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
