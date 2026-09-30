import type { Route } from "./+types/overview";
import { CardView, DjinnList, Gauges } from "../components/board.tsx";
import { SectHead, Status } from "../components/ui.tsx";
import { homeView } from "../lib/home.ts";
import { statusOf } from "../lib/status.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

export function loader({ context }: Route.LoaderArgs) {
  return homeView(statusOf(context), (project, run) => context.run(project, run));
}

export const meta: Route.MetaFunction = () => [{ title: "darius" }];

/**
 * The command board: the verdict on top, what needs the operator in the wide
 * column, the Watch gauges and the djinns in the rail. Each run shows once.
 */
export default function Overview({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { verdict, tone, sub, tally, needs, quiet, lastNight, watch, djinns } = loaderData;
  return (
    <>
      <section className="verdict">
        <div>
          <h1 className={`verdict-h ink-${tone}`}>{verdict}</h1>
          <p className="verdict-sub">{sub}</p>
        </div>
        {tally.length === 0 ? null : (
          <nav className="tally" aria-label="Summary">
            {tally.map((entry) => (
              <a key={entry.word} href={entry.href}>
                <b>{entry.count}</b>
                <Status tone={entry.tone} label={entry.word} />
              </a>
            ))}
          </nav>
        )}
      </section>
      <div className="board">
        <div className="board-main">
          <section className="section" id="needs">
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
          {lastNight.length === 0 ? null : (
            <section className="section">
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
          <section className="section">
            <SectHead title="Watch" />
            <Gauges gauges={watch} />
          </section>
          <section className="section">
            <SectHead title="Djinns" />
            <DjinnList djinns={djinns} />
          </section>
        </aside>
      </div>
    </>
  );
}
