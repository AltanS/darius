import { data, Link } from "react-router";

import type { Route } from "./+types/run";
import { KindWord } from "../components/chip.tsx";
import { Crumbs } from "../components/crumbs.tsx";
import { FollowUpCard } from "../components/follow-up.tsx";
import { Markdown } from "../components/markdown.tsx";
import { ResultPanel } from "../components/result.tsx";
import { NextStepCard, Questions } from "../components/runs.tsx";
import { StateWord } from "../components/row.tsx";
import { Empty, Facts, Section, Time, TitleText } from "../components/ui.tsx";
import { duration, shortRun } from "../lib/format.ts";
import { href, itemTarget } from "../lib/paths.ts";
import { itemKind, itemManual } from "../lib/kind.ts";
import { statusOf } from "../lib/status.ts";
import { excerpt, itemLabel, itemSlug, nextStep, runFailure, runState, stuckFor, stuckText } from "../lib/view.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

export async function loader({ context, params }: Route.LoaderArgs) {
  const run = context.run(params.ws, params.run);
  if (run === null) throw data(`No run ${params.run} in workspace ${params.ws}.`, { status: 404 });
  const status = statusOf(context);
  const project = status.projects.find((candidate) => candidate.name === run.project);
  // Against the status time, not the browser clock, so the page hydrates with the same text.
  const failure = runFailure(run.project, run.row, status.utcOffset);
  const next = failure === null ? null : nextStep(failure, { today: status.today, offset: status.utcOffset });
  const ritual = project?.rituals.find((candidate) => `ritual/${candidate.slug}` === run.row.item);
  // Only a run whose questions list commands can have a follow-up from this page; the check runs on the server.
  const hasCommands = (run.result?.questions ?? []).some((question) => (question.commands ?? []).length > 0);
  const followUp = hasCommands ? await context.followUp(run.project, run.row.run) : null;
  return { run, kind: itemKind(run.row.item), slug: itemSlug(run.row.item), manual: itemManual(run.row.item, ritual), label: itemLabel(project, run.row.item), stuck: stuckFor(run.row, status.generatedAt), next, followUp };
}

export const meta: Route.MetaFunction = ({ data: loaded, params }) => [{ title: `${loaded?.label ?? "Run"} · ${params.ws} | darius` }];

export default function Run({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { run, kind, manual, label, stuck, next, followUp } = loaderData;
  const { row, project } = run;
  const state = stuck === null ? runState(row) : { tone: "late" as const, label: "May be stuck" };
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
          <StateWord state={state} />
          <span>
            started <Time iso={row.startedAt} />
          </span>
          {took === null ? null : <span>took {took}</span>}
          <span>{row.who === "timer" ? "by timer" : `by ${row.who}`}</span>
          {run.followUpOf === null ? null : (
            <span>
              follows up <Link to={href({ to: "run", ws: project, run: run.followUpOf })}>run {shortRun(run.followUpOf)}</Link>
            </span>
          )}
        </p>
        {stuck === null ? null : <p className="page-warn tone-late">{stuckText(stuck)}</p>}
      </header>

      <div className="board">
        <div className="board-main">
          {row.phase === "held" ? (
            <Section title="Needs you">
              <div className="card card-accent edge-wait">
                <Questions project={project} run={row} />
              </div>
            </Section>
          ) : null}

          {next === null ? null : (
            <Section title="What happens next">
              <NextStepCard step={next} />
            </Section>
          )}

          {run.result === null ? null : (
            <ResultPanel
              project={project}
              row={row}
              result={run.result}
              afterQuestions={
                followUp === null ? null : (
                  <Section title="Follow-up">
                    <FollowUpCard project={project} run={row.run} readiness={followUp} questions={run.result.questions} />
                  </Section>
                )
              }
            />
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
              {run.events.length === 0 ? null : (
                <ol className="timeline">
                  {run.events.map((event, index) => (
                    <li key={`${index}`}>
                      <p className="flex flex-wrap items-baseline gap-x-3">
                        <code className="text-gold-hi">{event.type}</code>
                        <span className="text-sm text-muted">
                          <Time iso={event.at} />, {event.who}
                        </span>
                      </p>
                      {event.detail === null ? null : <p className="mt-0.5 break-words">{event.detail}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Section>
        </aside>
      </div>
    </article>
  );
}
