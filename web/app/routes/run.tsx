import { data, Link } from "react-router";

import type { Route } from "./+types/run";
import { RunTrail, SentenceLine } from "../components/activity.tsx";
import { KindWord } from "../components/chip.tsx";
import { Crumbs } from "../components/crumbs.tsx";
import { FollowUpSection } from "../components/follow-up.tsx";
import { Markdown } from "../components/markdown.tsx";
import { Actions, Items, ResultPanel } from "../components/result.tsx";
import { NextStepCard, Questions } from "../components/runs.tsx";
import { StateWord } from "../components/row.tsx";
import { Empty, Facts, Fold, Section, Status, Time, TitleText } from "../components/ui.tsx";
import { duration, shortRun } from "../lib/format.ts";
import { href, itemTarget } from "../lib/paths.ts";
import { itemKind, itemManual } from "../lib/kind.ts";
import { originView, thenLines, trailLines } from "../lib/run-origin.ts";
import { statusOf } from "../lib/status.ts";
import { resultTone, resultWord } from "../lib/result.ts";
import { excerpt, itemLabel, itemSlug, nextRunText, nextStep, runFailure, runState, stuckFor, stuckText } from "../lib/view.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

/** The most events of one run the page reads: a run has a handful, so this is only a bound. */
const TRAIL_MAX = 200;

export async function loader({ context, params }: Route.LoaderArgs) {
  const run = context.run(params.ws, params.run);
  if (run === null) throw data(`No run ${params.run} in workspace ${params.ws}.`, { status: 404 });
  const status = statusOf(context);
  const project = status.projects.find((candidate) => candidate.name === run.project);
  // Against the status time, not the browser clock, so the page hydrates with the same text.
  const failure = runFailure(run.project, run.row, status.utcOffset);
  const next = failure === null ? null : nextStep(failure, { today: status.today, offset: status.utcOffset });
  const ritual = project?.rituals.find((candidate) => `ritual/${candidate.slug}` === run.row.item);
  // A closed, complete ritual run with a result can have a follow-up from this page (0.65.0: with no command
  // question it carries a decision note). Whether it can start is a check that takes seconds over ssh, so since
  // 0.98.0 the loader does not run it: the card asks `GET /api/run/follow-up/ready` after the page shows. The
  // loader says only whether a card is certain: a run with a command question or a proposal (0.69.0: a
  // needs-decision item with a key) shows it either way, with the reason when it is off. A plain followable run
  // shows the card only when the check passes.
  const hasCommands = (run.result?.questions ?? []).some((question) => (question.commands ?? []).length > 0);
  const hasProposals = (run.result?.items ?? []).some((item) => item.state === "needs-decision" && item.key !== undefined);
  const isFollowable = run.result !== null && run.row.item.startsWith("ritual/") && run.row.phase === "closed" && run.row.outcome === "complete";
  const followUp = hasCommands || isFollowable ? { host: ritual?.host ?? status.host, certain: hasCommands || (hasProposals && isFollowable) } : null;
  // Each follow-up with its state word against the runs of the project (0.69.0).
  const children = run.children.map((child) => ({ ...child, state: runState(child.row, project?.runs ?? []) }));
  // Where the run came from, what came of it, and its own events (0.92.0), from the ledger and the activity model.
  const clock = { today: status.today, offset: status.utcOffset };
  const trail = trailLines(context.activity(run.project, { run: run.row.run, limit: TRAIL_MAX }).filter((entry) => entry.run === run.row.run));
  return { run, origin: originView(run.origin, run.row.startedAt, clock), came: thenLines(children, run.readBy, clock), trail, kind: itemKind(run.row.item), slug: itemSlug(run.row.item), manual: itemManual(run.row.item, ritual), label: itemLabel(project, run.row.item), stuck: stuckFor(run.row, status.generatedAt), state: runState(run.row, project?.runs ?? []), next, followUp, children, canWrite: context.canWrite, nextRun: nextRunText(ritual, { now: Date.parse(status.generatedAt), today: status.today, offset: status.utcOffset }), canRunNow: run.row.item.startsWith("ritual/") };
}

export const meta: Route.MetaFunction = ({ data: loaded, params }) => [{ title: `${loaded?.label ?? "Run"} · ${params.ws} | darius` }];

export default function Run({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { run, origin, came, trail, kind, manual, label, stuck, state, next, followUp, children, canWrite, nextRun, canRunNow } = loaderData;
  const { row, project } = run;
  const badge = stuck === null ? state : { tone: "late" as const, label: "May be stuck" };
  // A complete report names itself: its first heading is the page title, so it is not shown twice.
  // Any other run (failed, abandoned, running, held) is titled by its ritual.
  const complete = row.phase === "closed" && row.outcome === "complete";
  const headline = complete ? (excerpt(run.findings)?.headline ?? null) : null;
  const body = headline === null || run.findings === null ? run.findings : run.findings.slice(1);
  const title = headline ?? label;
  const took = row.endedAt === null ? null : duration(row.startedAt, row.endedAt);
  return (
    <article>
      <header className="page-head">
        <Crumbs itemKind={kind} title={title} parent={title === label ? undefined : { label, target: itemTarget(project, row.item) }} />
        <h1 className="page-title page-title-run">
          {title === label ? (
            <Link to={href(itemTarget(project, row.item))} className="title-link">
              <TitleText text={label} />
            </Link>
          ) : (
            <TitleText text={title} />
          )}
        </h1>
        <p className="page-meta meta-flow">
          <span className="rw-chips">
            <KindWord kind={kind} manual={manual} icon />
          </span>
          <StateWord state={badge} />
          <span>
            started <Time iso={row.startedAt} />
          </span>
          {took === null ? null : <span>took {took}</span>}
          <span>{row.who === "timer" ? "by timer" : `by ${row.who}`}</span>
        </p>
        {origin.leads.length === 0 && origin.approved === null && origin.grants.length === 0 && origin.note === null && came.length === 0 ? null : (
          <div className="origin">
            {origin.leads.map((lead) => (
              <SentenceLine key={`${lead.before}${lead.run ?? ""}`} sentence={lead} project={project} />
            ))}
            {origin.approved === null ? null : <p>Approved: {origin.approved}.</p>}
            {origin.grants.length === 0 ? null : (
              <Fold summary={origin.grants.length === 1 ? "Granted line" : `Granted lines (${origin.grants.length})`}>
                {origin.grants.map((grant, index) => (
                  <p key={`${index}`}>
                    <code className="break-all">{grant}</code>
                  </p>
                ))}
              </Fold>
            )}
            {origin.note === null ? null : <p className="break-words">Note: {origin.note}</p>}
            {came.map((sentence) => (
              <SentenceLine key={`${sentence.before}${sentence.run ?? ""}`} sentence={sentence} project={project} />
            ))}
          </div>
        )}
        {stuck === null ? null : <p className="page-warn tone-late">{stuckText(stuck)}</p>}
      </header>

      <div className="board">
        <div className="board-main">
          {row.phase === "held" ? (
            <Section title="Needs you">
              <div className="card card-accent edge-wait">
                <Questions project={project} run={row} canWrite={canWrite} />
              </div>
            </Section>
          ) : null}

          {next === null ? null : (
            <Section title="What happens next">
              <NextStepCard step={next} canWrite={canWrite} />
            </Section>
          )}

          {run.result === null ? null : (
            <ResultPanel
              project={project}
              row={row}
              result={run.result}
              canWrite={canWrite}
              nextRun={nextRun}
              canRunNow={canRunNow}
              afterQuestions={
                followUp === null ? null : (
                  <FollowUpSection key={row.run} project={project} run={row.run} plan={followUp} questions={run.result.questions} items={run.result.items} />
                )
              }
            />
          )}

          {children.length === 0 ? null : (
            <Section title={children.length === 1 ? "Its follow-up" : "Its follow-ups"}>
              <ol className="fu-kids">
                {children.map((child) => (
                  <li key={child.row.run} className="card fu-kid">
                    <p className="fu-kid-head">
                      <Link to={href({ to: "run", ws: project, run: child.row.run })}>
                        <code>{shortRun(child.row.run)}</code>
                      </Link>
                      <StateWord state={child.state} />
                      <span className="text-muted">
                        started <Time iso={child.row.startedAt} />, by {child.row.who}
                      </span>
                    </p>
                    {child.approved.length === 0 && child.items.length === 0 ? null : (
                      <p className="ritem-key">
                        approved {[...child.approved.map((n) => `question ${n}`), ...child.items.map((key) => `item ${key}`)].join(", ")}
                      </p>
                    )}
                    {child.result === null ? (
                      <p className="text-muted">{child.row.phase === "closed" ? "It handed in no result." : "No result yet."}</p>
                    ) : (
                      <>
                        <p>
                          <Status tone={resultTone(child.result.status)} label={resultWord(child.result.status)} /> {child.result.summary}
                        </p>
                        {child.result.actions.length === 0 ? null : (
                          <div>
                            <p className="fu-label">What it changed</p>
                            <Actions actions={child.result.actions} />
                          </div>
                        )}
                        {child.result.items.length === 0 ? null : (
                          <div>
                            <p className="fu-label">What it reported</p>
                            <Items items={child.result.items} />
                          </div>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {body !== null ? (
            <Section title="Report">
              <div className="measure">
                <Markdown blocks={body} />
              </div>
            </Section>
          ) : row.phase === "closed" ? (
            <Section title="Report">
              <Empty>This run left no report.</Empty>
            </Section>
          ) : null}
        </div>

        <aside className="board-rail">
          <Section title="Run details">
            <div className="panel panel-pad">
              <Facts
                facts={[
                  { label: "Run", value: <code className="break-all">{row.run}</code> },
                  { label: "Item", value: <code>{row.item}</code> },
                  { label: "Ended", value: row.endedAt === null ? <span className="text-muted">not yet</span> : <Time iso={row.endedAt} /> },
                  ...(run.skillHash === null ? [] : [{ label: "Skill hash", value: <code title={run.skillHash}>{run.skillHash.slice(0, 12)}</code> }]),
                  ...(run.followUpOf === null ? [] : [{ label: "Follows up", value: <Link to={href({ to: "run", ws: project, run: run.followUpOf })}><code>{shortRun(run.followUpOf)}</code></Link> }]),
                  ...(run.followUps.length === 0
                    ? []
                    : [
                        {
                          label: "Follow-ups",
                          value: (
                            <span className="fu-links">
                              {run.followUps.map((child) => (
                                <Link key={child} to={href({ to: "run", ws: project, run: child })}>
                                  <code>{shortRun(child)}</code>
                                </Link>
                              ))}
                            </span>
                          ),
                        },
                      ]),
                ]}
              />
              <RunTrail lines={trail} />
            </div>
          </Section>
        </aside>
      </div>
    </article>
  );
}
