import { data, Link } from "react-router";

import type { Route } from "./+types/candle";
import { Crumbs } from "../components/crumbs.tsx";
import { CandleActions, SeverityTag, SourceLink } from "../components/candles.tsx";
import { Markdown } from "../components/markdown.tsx";
import { StateWord } from "../components/row.tsx";
import { Empty, Facts, Section, Time, TitleText } from "../components/ui.tsx";
import { useClock } from "../lib/clock.tsx";
import { APP_ONLY_TEXT, canAccept, canAnswer, decisionLines, deliveryText, followUpRun, outText, seenText, statusBadge, stepKey, stepText, stillReportedText } from "../lib/candles.ts";
import { shortRun } from "../lib/format.ts";
import { href } from "../lib/paths.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

/** One candle: its text, what the person can do, where it came from, how its alert went and what happened to it. */
export function loader({ context, params }: Route.LoaderArgs) {
  const detail = context.candle(params.ws, params.key);
  if (detail === null) throw data(`No candle ${params.key} in workspace ${params.ws}.`, { status: 404 });
  return { row: detail.row, blocks: detail.blocks, delivery: detail.delivery, canWrite: context.canWrite };
}

export const meta: Route.MetaFunction = ({ data: loaded, params }) => [{ title: `${loaded?.row.title ?? params.key} · ${params.ws} | darius` }];

export default function Candle({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { row, blocks, delivery, canWrite } = loaderData;
  const { offset } = useClock();
  const badge = statusBadge(row.status);
  const decisions = decisionLines(row, offset);
  const again = stillReportedText(row);
  const out = outText(row);
  const child = followUpRun(row);
  const isOpenToAction = canAnswer(row) || canAccept(row);
  return (
    <article>
      <header className="page-head">
        <Crumbs title={row.title} />
        <h1 className="page-title page-title-sans">
          <TitleText text={row.title} />
        </h1>
        <p className="page-meta meta-flow">
          <span className="rw-chips">
            <SeverityTag row={row} />
          </span>
          <StateWord state={badge} />
          <span>{seenText(row.reports)}</span>
          <span>
            first seen <Time iso={row.firstSeen.at} />
          </span>
        </p>
        {again === null ? null : <p className="page-warn tone-late">{again}</p>}
      </header>

      <div className="board">
        <div className="board-main">
          {isOpenToAction ? (
            <Section title="Decide">
              <div className={row.status === "lit" ? "card card-accent edge-wait" : "card"}>
                <CandleActions row={row} canWrite={canWrite} />
              </div>
            </Section>
          ) : null}

          {decisions.length === 0 && out === null ? null : (
            <Section title="Decision">
              <div className="card">
                {decisions.map((line) => (
                  <p key={line} className="break-words">
                    {line}
                  </p>
                ))}
                {out === null ? null : <p>{out}</p>}
                {child === null ? null : (
                  <p>
                    Follow-up run <Link to={href({ to: "run", ws: row.project, run: child })}>{shortRun(child)}</Link>
                  </p>
                )}
              </div>
            </Section>
          )}

          <Section title="Detail">
            {blocks === null ? (
              <Empty>This candle has no detail text.</Empty>
            ) : (
              <div className="measure">
                <Markdown blocks={blocks} />
              </div>
            )}
          </Section>
        </div>

        <aside className="board-rail">
          <Section title="Where it came from">
            <div className="panel panel-pad">
              <Facts
                facts={[
                  ...(row.target === undefined ? [] : [{ label: "Target", value: <span className="break-words">{row.target}</span> }]),
                  { label: "Source", value: <SourceLink row={row} /> },
                  ...(row.run === undefined ? [] : [{ label: "Newest run", value: <Link to={href({ to: "run", ws: row.project, run: row.run })}>Open the run</Link> }]),
                  { label: "Last seen", value: <Time iso={row.lastSeen.at} /> },
                  { label: "Key", value: <code className="break-all">{row.key}</code> },
                ]}
              />
            </div>
          </Section>

          <Section title="Alert">
            <div className="panel panel-pad">
              {delivery.length === 0 ? (
                <p className="rail-note">{APP_ONLY_TEXT}</p>
              ) : (
                <ul className="candle-delivery">
                  {delivery.map((one) => (
                    <li key={one.channel} className="break-words">
                      {deliveryText(one, offset)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Section>

          <Section title="History">
            <div className="panel panel-pad">
              <ol className="fnd-history" aria-label="History, oldest first">
                {row.history.map((step, index) => (
                  <li key={stepKey(step, index)} className="break-words">
                    {step.run === undefined ? stepText(step, offset) : <Link to={href({ to: "run", ws: row.project, run: step.run })}>{stepText(step, offset)}</Link>}
                  </li>
                ))}
              </ol>
            </div>
          </Section>
        </aside>
      </div>
    </article>
  );
}
