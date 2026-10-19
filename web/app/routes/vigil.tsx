import { data } from "react-router";

import type { Route } from "./+types/vigil";
import type { VigilSweep } from "../../../src/web/api.ts";
import { Timeline } from "../components/activity.tsx";
import { KindWord } from "../components/chip.tsx";
import { CheckNow } from "../components/check-now.tsx";
import { Crumbs } from "../components/crumbs.tsx";
import { Markdown } from "../components/markdown.tsx";
import { StateWord } from "../components/row.tsx";
import { Empty, Facts, Fold, Section, TitleText } from "../components/ui.tsx";
import { untilShort } from "../lib/activity-place.ts";
import { useClock } from "../lib/clock.tsx";
import { momentText } from "../lib/format.ts";
import { vigilWord } from "../lib/state-words.ts";
import { checkBlocked, failKindText, vigilWaits } from "../lib/view.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

/** `VigilDetail.activity` holds at most this many entries; a list that long says so. */
const ACTIVITY_SHOWN = 100;

export function loader({ context, params }: Route.LoaderArgs) {
  const vigil = context.vigil(params.ws, params.slug);
  if (vigil === null) throw data(`No vigil ${params.slug} in workspace ${params.ws}.`, { status: 404 });
  return { vigil, canWrite: context.canWrite };
}

export const meta: Route.MetaFunction = ({ data: loaded, params }) => [{ title: `${loaded?.vigil.row.title ?? params.slug} · ${params.ws} | darius` }];

/** "1 fail (exit 1), 2 pass": what each check of a sweep said. */
function checksText(sweep: VigilSweep): string {
  return sweep.checks.map((check) => `step ${check.index} ${check.outcome}${check.exit === null || check.exit === 0 ? "" : ` (exit ${check.exit})`}`).join(", ");
}

/** How a sweep ended: its outcome, and why a failure failed. */
function outcomeText(sweep: VigilSweep): string {
  const outcome = sweep.outcome ?? "none";
  return sweep.failKind === null ? outcome : `${outcome}, ${sweep.failKind}`;
}

export default function Vigil({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { vigil, canWrite } = loaderData;
  const { row, failure, sweeps } = vigil;
  const { today, offset } = useClock();
  const when = (at: string): string => momentText(at, today, offset);
  const word = vigilWord(row);
  const waits = vigilWaits(row, today);
  return (
    <div>
      <header className="page-head">
        <Crumbs title={row.title} />
        <h1 className="page-title page-title-sans">
          <TitleText text={row.title} />
        </h1>
        <p className="page-meta meta-flow">
          <span className="rw-chips">
            <KindWord kind="vigil" icon />
          </span>
          {word === null ? null : <StateWord state={word} />}
          {waits.map((part) => (
            <span key={part}>{part}</span>
          ))}
          <code className="text-faint">{row.slug}</code>
        </p>
        {vigil.closedReason === null ? null : <p className="lede lede-tight">Closed because: {vigil.closedReason}</p>}
        {vigil.pausedReason === null || !row.paused ? null : <p className="lede lede-tight">Paused because: {vigil.pausedReason}</p>}
        <CheckNow key={row.slug} project={vigil.project} slug={row.slug} subject={row.title} canWrite={canWrite} blocked={checkBlocked(row)} explain pending={vigil.pending} latest={row.lastCheckedAt === undefined ? null : { at: row.lastCheckedAt, outcome: row.lastOutcome }} />
      </header>

      <div className="board">
        <div className="board-main">
          {failure === null ? null : (
            <Section title="Why flagged">
              <div className="card">
                <Facts
                  facts={[
                    { label: "Step", value: `${failure.index}: ${failure.text}` },
                    ...(failure.command === null ? [] : [{ label: "Command", value: <code className="inline-code">{failure.command}</code> }]),
                    ...(failure.expected === null ? [] : [{ label: "Expected", value: <code className="inline-code">{failure.expected}</code> }]),
                    { label: "Result", value: failure.exit === null ? failure.outcome : `${failure.outcome}, exit ${failure.exit}` },
                    { label: "When", value: when(failure.at) },
                    { label: "Host", value: failure.host },
                    { label: "Kind", value: failKindText(failure.failKind) },
                  ]}
                />
                {failure.source === "body" ? <p className="rail-note">This sweep did not record Command and Expected. They come from the current body, which may have changed since.</p> : null}
                <p className="fu-label">Output, last lines</p>
                {failure.outputTail === null ? <p className="text-muted">The output is not stored on this host.</p> : failure.outputTail === "" ? <p className="text-muted">The check printed nothing.</p> : <pre className="code-block">{failure.outputTail}</pre>}
              </div>
            </Section>
          )}

          <Section title="Last sweeps">
            {sweeps.length === 0 ? (
              <Empty>This vigil has not been swept yet.</Empty>
            ) : (
              <div className="panel table-scroll">
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Result</th>
                      <th scope="col">Checks</th>
                      <th scope="col">By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sweeps.map((sweep) => (
                      <tr key={sweep.at}>
                        <td>{when(sweep.at)}</td>
                        <td>{outcomeText(sweep)}</td>
                        <td>{sweep.reason ?? checksText(sweep)}</td>
                        <td>{sweep.who}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {vigil.activity.length === 0 ? null : (
            <Section title="Activity" id="activity">
              <Timeline entries={vigil.activity} project={vigil.project} olderHref={null} isCapped={vigil.activity.length >= ACTIVITY_SHOWN} sentence={untilShort} />
            </Section>
          )}
        </div>

        <aside className="board-rail">
          <Section title="The check">
            <div className="folds">
              <Fold summary="Checklist" open={failure === null}>
                {vigil.body.length === 0 ? <Empty>No checklist on this host.</Empty> : <Markdown blocks={vigil.body} />}
              </Fold>
            </div>
          </Section>
        </aside>
      </div>
    </div>
  );
}
