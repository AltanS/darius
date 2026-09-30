import type { Route } from "./+types/overview";
import { CardView, LineList, NowList, Pieces, StatusStrip } from "../components/board.tsx";
import { SectHead } from "../components/ui.tsx";
import { homeView } from "../lib/home.ts";
import { statusOf } from "../lib/status.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

export function loader({ context }: Route.LoaderArgs) {
  return homeView(statusOf(context), (project, run) => context.run(project, run));
}

export const meta: Route.MetaFunction = () => [{ title: "darius" }];

/**
 * The command board, across all projects. The verdict and the status strip
 * on top; then, on a phone, Now, Needs you and Last night, and Up next, one
 * health line and the djinns below. On a desktop the wide column holds Needs
 * you, Now and Last night, and the rail holds Up next, the health line and
 * the djinns. Each run shows once.
 */
export default function Overview({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { verdict, tone, sub, strip, now, needs, quiet, lastNight, upNext, health, djinns } = loaderData;
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
        </div>
        <aside className="board-rail">
          <section className="section sec-up" id="upnext">
            <SectHead title="Up next" />
            <LineList label="Up next" lines={upNext.lines} more={upNext.more} empty="Nothing is due. No djinn is scheduled and no manual ritual is late." />
          </section>
          <p className="health sec-health">
            <Pieces pieces={health} />
          </p>
          <section className="section sec-djinns">
            <SectHead title="Djinns" />
            <LineList label="Djinns" lines={djinns} empty="No djinn yet. Give a ritual a repo skill with --skill." />
          </section>
        </aside>
      </div>
    </>
  );
}
