import { data, Link } from "react-router";

import type { Route } from "./+types/ritual";
import type { RitualHandoff } from "../../../src/web/api.ts";
import { Markdown } from "../components/markdown.tsx";
import { Report } from "../components/board.tsx";
import { ResultQuestions, ResultTags } from "../components/result.tsx";
import { NextStepCard, Questions, RunList } from "../components/runs.tsx";
import { Chips, Crumbs, Empty, Facts, Fold, Section } from "../components/ui.tsx";
import { useClock } from "../lib/clock.tsx";
import { projectPath, runPath } from "../lib/format.ts";
import { statusOf } from "../lib/status.ts";
import { asksYou, cadenceText, isImported, isUnattended, nextStep, nextText, reportExcerpt, ritualFailure, runState } from "../lib/view.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

export function loader({ context, params }: Route.LoaderArgs) {
  const ritual = context.ritual(params.project, params.slug);
  if (ritual === null) throw data(`No ritual ${params.slug} in project ${params.project}.`, { status: 404 });
  const finished = ritual.runs.find((run) => run.findingsSha !== null && !isImported(run)) ?? null;
  const held = ritual.row.heldRun === null ? null : (ritual.runs.find((run) => run.run === ritual.row.heldRun) ?? null);
  const status = statusOf(context);
  const failure = ritualFailure(ritual.project, ritual.row, ritual.runs, status.today);
  const next = failure === null ? null : nextStep(failure, { today: status.today, offset: status.utcOffset });
  const detail = finished === null ? null : context.run(ritual.project, finished.run);
  // The latest report asks the operator something nobody answered yet: its questions lead the page.
  const asks = finished !== null && asksYou(finished) ? (detail?.result?.questions ?? []) : [];
  return { ritual, held, finished, next, asks, report: reportExcerpt(detail) };
}

export const meta: Route.MetaFunction = ({ loaderData }) => [{ title: `${loaderData?.ritual.row.title ?? "Ritual"} | darius` }];

interface HandoffCardProps {
  handoff: RitualHandoff;
}

/** What darius puts at the top of the next run's prompt: the run's note and the operator's note on that run. */
function HandoffCard({ handoff }: HandoffCardProps): React.ReactNode {
  const { operator } = handoff;
  return (
    <div className="card">
      {handoff.note === null ? <p className="text-muted">The latest run left no note.</p> : <p>{handoff.note}</p>}
      {operator === null ? null : (
        <p className="rail-note">
          {handoff.questions.length > 0 ? "Your answer" : "Your note"}, {operator.who}: {operator.note}
        </p>
      )}
    </div>
  );
}

function modeText(mode: string): string {
  if (mode === "report") return "read-only, it reports and asks before any change";
  if (mode === "act") return "it may change things within its rules";
  return mode;
}

export default function Ritual({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { ritual, held, finished, next, asks, report } = loaderData;
  const { row, policy, project } = ritual;
  const runs = ritual.runs.map((run) => ({ ...run, project, label: row.title, slug: row.slug }));
  const unattended = isUnattended(row);
  const cadence = cadenceText(row.cadence);
  const model = policy.model ?? "the profile's model";
  const { today } = useClock();
  return (
    <div>
      <header className="page-head">
        <Crumbs>
          <Link to={projectPath(project)}>{project}</Link>
        </Crumbs>
        <h1 className="page-title">{row.title}</h1>
        <p className="page-meta">
          <code className="text-faint">{row.slug}</code>
          {cadence === null ? null : <span>{cadence}</span>}
          <span>{nextText(row, today)}</span>
        </p>
        <p className="lede">
          {unattended
            ? `darius runs this ritual with ${model}, in ${policy.mode} mode: ${modeText(policy.mode)}.`
            : "darius does not run this ritual (mode off). It is done by hand and only tracked here."}
          {row.skill === null ? null : (
            <>
              {" "}
              It follows the repo skill <code className="inline-code">{row.skill}</code>.
            </>
          )}
          {row.host === null ? null : (
            <>
              {" "}
              Runs on <code className="inline-code">{row.host}</code> only; the timer of any other host skips it.
            </>
          )}
        </p>
      </header>

      <div className="board">
        <div className="board-main">
          {held === null ? null : (
            <Section title="Needs you">
              <div className="card card-accent edge-wait">
                <Questions project={project} run={held} />
              </div>
            </Section>
          )}

          {finished === null || asks.length === 0 ? null : (
            <Section title="Needs you" aside={<Link to={runPath(project, finished.run)}>Open the run</Link>}>
              <ResultQuestions project={project} row={finished} questions={asks} />
            </Section>
          )}

          {next === null ? null : (
            <Section title="What happens next">
              <NextStepCard step={next} />
            </Section>
          )}

          {finished === null || report === null ? null : (
            <Section title="Latest report" aside={<Link to={runPath(project, finished.run)}>Read it all</Link>}>
              <div className={`card card-accent edge-${runState(finished).tone}`}>
                <Report report={report} lines={4} fades={false} />
                <ResultTags summary={finished.result} isAnswered={finished.acknowledged !== null} />
              </div>
            </Section>
          )}

          {ritual.handoff === null ? null : (
            <Section title="Note for the next run" aside={<Link to={runPath(project, ritual.handoff.run)}>From this run</Link>}>
              <HandoffCard handoff={ritual.handoff} />
            </Section>
          )}

          <Section title="History">
            <RunList runs={runs} showProject={false} showLabel={false} empty="This ritual has not run yet." />
          </Section>
        </div>

        <aside className="board-rail">
          <Section title="Rules and instructions">
            <div className="folds">
              <Fold summary="Rules: what it may do, and what makes it stop and ask">
                <Facts
                  facts={[
                    { label: "May run", value: <Chips items={policy.may} none="only the read-only defaults" /> },
                    { label: "Stops at", value: <Chips items={policy.hold} none="nothing" /> },
                    { label: "Max turns", value: policy.maxTurns ?? <span className="text-muted">default</span> },
                    { label: "Profile", value: policy.profile === null ? <span className="text-muted">default</span> : <Link to={`/profiles#profile-${policy.profile}`}>{policy.profile}</Link> },
                    ...(policy.notes === null ? [] : [{ label: "Notes", value: policy.notes }]),
                  ]}
                />
              </Fold>
              <Fold summary="Instructions">{ritual.body.length === 0 ? <Empty>No instructions.</Empty> : <Markdown blocks={ritual.body} />}</Fold>
            </div>
          </Section>
        </aside>
      </div>
    </div>
  );
}
