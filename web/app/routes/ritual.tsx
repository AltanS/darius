import { data, Link } from "react-router";

import type { Route } from "./+types/ritual";
import type { RitualHandoff } from "../../../src/web/api.ts";
import { KindWord } from "../components/chip.tsx";
import { Crumbs } from "../components/crumbs.tsx";
import { Markdown } from "../components/markdown.tsx";
import { Report } from "../components/board.tsx";
import { ResultChips, ResultQuestions } from "../components/result.tsx";
import { StateWord } from "../components/row.tsx";
import { NextStepCard, Questions, RunList } from "../components/runs.tsx";
import { Chips, Empty, Facts, Fold, Section, TitleText } from "../components/ui.tsx";
import { useClock } from "../lib/clock.tsx";
import { momentText } from "../lib/format.ts";
import { href } from "../lib/paths.ts";
import { isManual } from "../lib/kind.ts";
import { ritualWord } from "../lib/state-words.ts";
import { statusOf } from "../lib/status.ts";
import { summaryTags } from "../lib/result.ts";
import { asksYou, atText, cadenceText, isImported, nextRunText, nextStep, reportExcerpt, ritualFailure, runState, sourceText } from "../lib/view.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

export function loader({ context, params }: Route.LoaderArgs) {
  const ritual = context.ritual(params.ws, params.slug);
  if (ritual === null) throw data(`No ritual ${params.slug} in workspace ${params.ws}.`, { status: 404 });
  const finished = ritual.runs.find((run) => run.findingsSha !== null && !isImported(run)) ?? null;
  const held = ritual.row.heldRun === null ? null : (ritual.runs.find((run) => run.run === ritual.row.heldRun) ?? null);
  const status = statusOf(context);
  const failure = ritualFailure(ritual.project, ritual.row, ritual.runs, status.today);
  const next = failure === null ? null : nextStep(failure, { today: status.today, offset: status.utcOffset });
  const detail = finished === null ? null : context.run(ritual.project, finished.run);
  // The latest report asks the operator something nobody answered yet: its questions lead the page.
  const asks = finished !== null && asksYou(finished, ritual.runs) ? (detail?.result?.questions ?? []) : [];
  return { ritual, held, finished, next, asks, report: reportExcerpt(detail), canWrite: context.canWrite, nextRun: nextRunText(ritual.row, { now: Date.parse(status.generatedAt), today: status.today, offset: status.utcOffset }) };
}

export const meta: Route.MetaFunction = ({ data: loaded, params }) => [{ title: `${loaded?.ritual.row.title ?? "Ritual"} · ${params.ws} | darius` }];

interface HandoffCardProps {
  handoff: RitualHandoff;
}

/** What darius puts at the top of the next run's prompt: the run's note and the operator's note on that run. */
function HandoffCard({ handoff }: HandoffCardProps): React.ReactNode {
  const { operator, dismissed } = handoff;
  return (
    <div className="card">
      {handoff.note === null ? <p className="text-muted">The latest run left no note.</p> : <p>{handoff.note}</p>}
      {operator === null ? null : (
        <p className="rail-note">
          {handoff.questions.length > 0 ? "Your answer" : "Your note"}, {operator.who}: {operator.note}
        </p>
      )}
      {dismissed === null ? null : <p className="rail-note">{dismissed.who} saw the questions and chose not to act on them. The next run is told not to act on them or ask them again.</p>}
    </div>
  );
}

function modeText(mode: string): string {
  if (mode === "report") return "read-only, it reports and asks before any change";
  if (mode === "act") return "it may change things within its rules";
  return mode;
}

export default function Ritual({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { ritual, held, finished, next, asks, report, canWrite, nextRun } = loaderData;
  const { row, policy, project } = ritual;
  const manual = isManual(row);
  const runs = ritual.runs.map((run) => ({ ...run, project, label: row.title, slug: row.slug, kind: "ritual" as const, manual }));
  const cadence = cadenceText(row.cadence);
  const model = policy.model ?? "the profile's model";
  const { today, now, offset } = useClock();
  const source = sourceText(row, now);
  const scheduleAt = atText(row);
  const fromGit = row.source === "repo";
  return (
    <div>
      <header className="page-head">
        <Crumbs title={row.title} />
        <h1 className="page-title page-title-sans">
          <TitleText text={row.title} />
        </h1>
        <p className="page-meta meta-flow">
          <span className="rw-chips">
            <KindWord kind="ritual" manual={manual} icon />
          </span>
          <StateWord state={ritualWord(row, today)} />
          {cadence === null ? null : <span>{cadence}</span>}
          <code className="text-faint">{row.slug}</code>
        </p>
        {manual ? (
          <div className="note-box">
            <p>
              {row.mode === "off" ? "darius does not start this ritual (mode off)." : "darius does not start this ritual, because it is not active."} You run it by hand; darius tracks the schedule.{" "}
              {fromGit ? (
                <>
                  To let darius run it, set <code className="inline-code">mode = "report"</code> in <code className="inline-code">.darius.toml</code> and commit.
                </>
              ) : (
                <>
                  To let darius run it, give it a policy with <code className="inline-code">darius ritual set {row.slug} --mode report ...</code>.
                </>
              )}
            </p>
          </div>
        ) : (
          <p className="lede">{`darius runs this ritual with ${model}, in ${policy.mode} mode: ${modeText(policy.mode)}.`}</p>
        )}
        {source === null ? null : <p className="lede lede-tight source-line">{source}</p>}
        {row.warnings.length === 0 ? null : (
          <div className="note-box">
            {row.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        )}
        {row.skill === null && row.host === null ? null : (
          <p className="lede lede-tight">
            {row.skill === null ? null : (
              <>
                It follows the repo skill <code className="inline-code">{row.skill}</code>.
              </>
            )}
            {row.skill === null || row.host === null ? null : " "}
            {row.host === null ? null : (
              <>
                Runs on <code className="inline-code">{row.host}</code> only; the timer of any other host skips it.
              </>
            )}
          </p>
        )}
      </header>

      <div className="board">
        <div className="board-main">
          {held === null ? null : (
            <Section title="Needs you">
              <div className="card card-accent edge-wait">
                <Questions project={project} run={held} canWrite={canWrite} />
              </div>
            </Section>
          )}

          {finished === null || asks.length === 0 ? null : (
            <Section title="Needs you" aside={<Link to={href({ to: "run", ws: project, run: finished.run })}>Open the run</Link>}>
              <ResultQuestions project={project} row={finished} questions={asks} canWrite={canWrite} nextRun={nextRun} canRunNow />
            </Section>
          )}

          {next === null ? null : (
            <Section title="What happens next">
              <NextStepCard step={next} canWrite={canWrite} />
            </Section>
          )}

          {finished === null || report === null ? null : (
            <Section title="Latest report" aside={<Link to={href({ to: "run", ws: project, run: finished.run })}>Read it all</Link>}>
              <div className={`card card-accent edge-${runState(finished, ritual.runs).tone}`}>
                <Report report={report} lines={4} fades={false} />
                {finished.result === null || summaryTags(finished.result, finished.acknowledged !== null).length === 0 ? null : (
                  <div className="rw-chips mt-3">
                    <ResultChips summary={finished.result} isAnswered={finished.acknowledged !== null} />
                  </div>
                )}
              </div>
            </Section>
          )}

          {ritual.handoff === null ? null : (
            <Section title="Note for the next run" aside={<Link to={href({ to: "run", ws: project, run: ritual.handoff.run })}>From this run</Link>}>
              <HandoffCard handoff={ritual.handoff} />
            </Section>
          )}

          <Section title="History">
            <div className="panel">
              <RunList runs={runs} showProject={false} showLabel={false} empty="This ritual has not run yet." />
            </div>
          </Section>
        </div>

        <aside className="board-rail">
          <Section title="Rules and instructions">
            <div className="folds">
              {scheduleAt === null && row.timeout === null && row.args === null && !fromGit ? null : (
                <Fold summary="Schedule" open>
                  <Facts
                    facts={[
                      { label: "Cadence", value: cadence ?? <span className="text-muted">none</span> },
                      ...(scheduleAt === null ? [] : [{ label: "At", value: scheduleAt }]),
                      ...(row.nextDueAt === null ? [] : [{ label: "Next due", value: momentText(row.nextDueAt, today, offset) }]),
                      ...(row.args === null ? [] : [{ label: "Arguments", value: row.args }]),
                      ...(row.timeout === null ? [] : [{ label: "Timeout", value: row.timeout }]),
                    ]}
                  />
                  {fromGit ? (
                    <p className="rail-note">
                      Git owns this definition. To change it, edit <code className="inline-code">.darius.toml</code> and commit. Pause, resume, host and due stay with <code className="inline-code">darius ritual set</code>.
                    </p>
                  ) : null}
                </Fold>
              )}
              <Fold summary="Rules: what it may do, and what makes it stop and ask">
                <Facts
                  facts={[
                    { label: "May run", value: <Chips items={policy.may} none="only the read-only defaults" /> },
                    ...(policy.followUpMay.length === 0 ? [] : [{ label: "A follow-up may also run", value: <Chips items={policy.followUpMay} none="nothing more" /> }]),
                    { label: "Stops at", value: <Chips items={policy.hold} none="nothing" /> },
                    {
                      label: "On a match",
                      value: policy.onHold === "deny" ? "refuses the command; the run goes on and records it for a decision" : "holds the run until someone answers",
                    },
                    { label: "Follow-ups", value: policy.followUp === "headless" ? "run headless, without herdr" : "open a herdr tab, attended" },
                    { label: "Max turns", value: policy.maxTurns ?? <span className="text-muted">default</span> },
                    { label: "Profile", value: policy.profile === null ? <span className="text-muted">default</span> : <Link to={href({ to: "host", page: "profiles", hash: `profile-${policy.profile}` })}>{policy.profile}</Link> },
                    ...(policy.notes === null ? [] : [{ label: "Notes", value: policy.notes }]),
                  ]}
                />
              </Fold>
              <Fold summary="Instructions" open={manual}>{ritual.body.length === 0 ? <Empty>No instructions.</Empty> : <Markdown blocks={ritual.body} />}</Fold>
            </div>
          </Section>
        </aside>
      </div>
    </div>
  );
}
