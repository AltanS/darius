/** The run list, the held-question block and the djinn card, shared by several pages. */

import { Link } from "react-router";

import type { Acknowledgement, RitualRow, RunRow } from "../../../src/web/api.ts";
import { useClock } from "../lib/clock.tsx";
import { answerCommand, duration, ritualPath, runPath } from "../lib/format.ts";
import { ritualKind } from "../lib/kind.ts";
import type { Badge } from "../lib/tone.ts";
import { ackText, cadenceText, decisionText, nextText, runState, type ActivityRun, type Excerpt, type HostClock, type NextStep } from "../lib/view.ts";
import { Command } from "./command.tsx";
import { KindIcon } from "./kind.tsx";
import { Report } from "./board.tsx";
import { ResultTags } from "./result.tsx";
import { Empty, Status, Time } from "./ui.tsx";

interface RunListProps {
  runs: readonly ActivityRun[];
  /** Name the project on each row, for lists over several projects. */
  showProject: boolean;
  /** Name the ritual on each row; off on a ritual's own page. */
  showLabel?: boolean;
  empty: string;
  /** Rows from this one on carry `phone-extra`, so a phone can hide them behind a button. */
  phoneShown?: number;
}

/** Runs as rows: what ran, how it ended, when. Each row opens the run. */
export function RunList({ runs, showProject, showLabel = true, empty, phoneShown = runs.length }: RunListProps): React.ReactNode {
  if (runs.length === 0) return <Empty>{empty}</Empty>;
  return (
    <ul className="rows">
      {runs.map((run, index) => {
        const state = runState(run);
        const took = run.endedAt === null ? null : duration(run.startedAt, run.endedAt);
        const sub = [showProject ? run.project : null, took === null ? null : `took ${took}`, run.who === "timer" ? "by timer" : `by ${run.who}`].filter((part) => part !== null);
        return (
          <li key={`${run.project}/${run.run}`} className={index >= phoneShown ? "phone-extra" : undefined}>
            <Link to={runPath(run.project, run.run)} className={state.tone === "run" ? "row row-live" : "row"}>
              {state.tone === "run" ? <span className="live-bar" aria-hidden="true" /> : null}
              <span className="row-main">
                {showLabel ? (
                  <span className="row-title has-kind">
                    <KindIcon kind={run.kind} titled className="kind-lead" />
                    {run.label}
                  </span>
                ) : (
                  <span className="row-title">
                    <Time iso={run.startedAt} />
                  </span>
                )}
                {sub.length === 0 ? null : <span className="row-sub">{sub.join(", ")}</span>}
                <ResultTags summary={run.result} isAnswered={run.acknowledged !== null} />
              </span>
              <Status tone={state.tone} label={state.label} />
              {showLabel ? (
                <span className="row-time">
                  <Time iso={run.startedAt} />
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

interface QuestionsProps {
  project: string;
  run: RunRow;
}

/** The questions of a held run, each with the command that answers it. */
export function Questions({ project, run }: QuestionsProps): React.ReactNode {
  if (run.questions.length === 0) {
    return <Empty>The run is held without a question. Resume or close it from the command line.</Empty>;
  }
  return (
    <ol className="qs">
      {run.questions.map((question, index) => (
        <li key={`${index}`}>
          <p>{question}</p>
          <Command command={answerCommand(run.run, index + 1, project)} />
        </li>
      ))}
    </ol>
  );
}

interface NextStepCardProps {
  step: NextStep;
}

/**
 * What happens after a failed or abandoned run: darius does not retry it
 * today, so the card gives the two commands a person has. Once someone
 * acknowledged the run, it says who, and when.
 */
export function NextStepCard({ step }: NextStepCardProps): React.ReactNode {
  if (step.kind === "seen") {
    return (
      <div className="card next">
        <p>{step.text}</p>
      </div>
    );
  }
  return (
    <div className={`card card-accent edge-${step.tone} next`}>
      <p>{step.text}</p>
      <div className="next-cmd">
        <p>Run it now:</p>
        <Command command={step.runNow} />
      </div>
      <div className="next-cmd">
        <p>Seen it:</p>
        <Command command={step.ack} />
      </div>
    </div>
  );
}

interface DjinnCardProps {
  project: string;
  ritual: RitualRow;
  last: RunRow | null;
  report: Excerpt | null;
  /** Name the project in the meta line; off on the project's own page. */
  showProject: boolean;
}

/** Who acknowledged a run: the decision on a result's questions, or who saw a failure. */
function seenText(run: RunRow | null, seen: Acknowledgement, clock: HostClock): string {
  return (run?.result?.questions ?? 0) > 0 ? decisionText(seen, clock) : ackText(seen, clock);
}

/** A ritual darius runs: its state, its latest report, and the way to both. An acknowledged failure is grey, with who saw it. */
export function DjinnCard({ project, ritual, last, report, showProject }: DjinnCardProps): React.ReactNode {
  const { today, offset } = useClock();
  const state: Badge = last === null ? { tone: "idle", label: "No run yet" } : runState(last);
  const meta = [showProject ? project : null, cadenceText(ritual.cadence), nextText(ritual, today)].filter((part) => part !== null);
  const seen = last?.acknowledged ?? null;
  return (
    <article className={`card card-grid card-accent card-link edge-${state.tone}${state.tone === "run" ? " is-live" : ""}`}>
      {state.tone === "run" ? <span className="live-bar" aria-hidden="true" /> : null}
      <div className="card-main">
        <h3 className="card-title has-kind-flex">
          <KindIcon kind={ritualKind(ritual)} titled />
          <Link to={ritualPath(project, ritual.slug)}>{ritual.title}</Link>
        </h3>
        <p className="card-meta">{meta.join(", ")}</p>
        {seen === null ? null : <p className="card-meta">{seenText(last, seen, { today, offset })}</p>}
        {last === null ? null : <ResultTags summary={last.result} isAnswered={seen !== null} />}
      </div>
      <div className="card-side">
        <Status tone={state.tone} label={state.label} />
        {last === null ? null : (
          <span className="card-when">
            <Time iso={last.startedAt} />
          </span>
        )}
      </div>
      {report === null ? null : (
        <div className="card-body">
          <Report report={report} lines={4} fades={false} />
        </div>
      )}
      {last === null ? null : (
        <div className="card-acts">
          <Link to={runPath(project, last.run)}>{last.findingsSha === null ? "Open the run" : "Read the report"}</Link>
          <Link to={ritualPath(project, ritual.slug)}>History and rules</Link>
        </div>
      )}
    </article>
  );
}
