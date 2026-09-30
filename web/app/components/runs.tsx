/** The run list, the held-question block and the latest-report row, shared by several pages. */

import { Link } from "react-router";

import type { Acknowledgement, RitualRow, RunRow } from "../../../src/web/api.ts";
import { useClock } from "../lib/clock.tsx";
import { answerCommand, clockTime, duration, hostDate, ritualPath, runPath, shortDate } from "../lib/format.ts";
import { summaryTags } from "../lib/result.ts";
import { datePhrase, railOf } from "../lib/state-words.ts";
import type { Badge } from "../lib/tone.ts";
import { ackText, decisionText, runState, type ActivityRun, type Excerpt, type HostClock, type NextStep } from "../lib/view.ts";
import { Command } from "./command.tsx";
import { Chip, KindChips } from "./chip.tsx";
import { Report } from "./board.tsx";
import { ResultChips } from "./result.tsx";
import { Row, RowList } from "./row.tsx";
import { Empty, Time } from "./ui.tsx";

interface RunListProps {
  runs: readonly ActivityRun[];
  /** Name the project on each row, for lists over several projects; a list that holds one project leaves it out. */
  showProject: boolean;
  /** Name the ritual on each row; off on a ritual's own page, where a row is titled by its date. */
  showLabel?: boolean;
  empty: string;
  /** Rows from this one on carry `phone-extra`, so a phone can hide them behind a button. */
  phoneShown?: number;
}

/** Runs as rows: what ran, how it ended, how long it took, who started it, when. Each row opens the run. */
export function RunList({ runs, showProject, showLabel = true, empty, phoneShown = runs.length }: RunListProps): React.ReactNode {
  const { offset } = useClock();
  if (runs.length === 0) return <Empty>{empty}</Empty>;
  const named = showProject && new Set(runs.map((run) => run.project)).size > 1;
  return (
    <RowList bare>
      {runs.map((run, index) => {
        const state = runState(run);
        const took = run.endedAt === null ? null : duration(run.startedAt, run.endedAt);
        const isImport = run.who === "import";
        const meta = [named ? run.project : null, took === null ? null : `took ${took}`, isImport ? null : run.who === "timer" ? "by timer" : `by ${run.who}`].filter((part) => part !== null);
        const counts = run.result === null ? [] : summaryTags(run.result, run.acknowledged !== null);
        const hasChips = showLabel || counts.length > 0 || isImport;
        const chips = hasChips ? (
          <>
            {showLabel ? <KindChips kind={run.kind} manual={run.manual} /> : null}
            {run.result === null || counts.length === 0 ? null : <ResultChips summary={run.result} isAnswered={run.acknowledged !== null} />}
            {isImport ? <Chip color="idle">imported</Chip> : null}
          </>
        ) : undefined;
        return (
          <Row
            key={`${run.project}/${run.run}`}
            kind={run.kind}
            href={runPath(run.project, run.run)}
            title={showLabel ? run.label : shortDate(hostDate(run.startedAt, offset))}
            rail={railOf(state)}
            live={run.phase === "running"}
            chips={chips}
            state={state}
            meta={meta}
            time={showLabel ? <Time iso={run.startedAt} /> : clockTime(run.startedAt, offset)}
            className={index >= phoneShown ? "phone-extra" : undefined}
          />
        );
      })}
    </RowList>
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

interface ReportRowProps {
  project: string;
  ritual: RitualRow;
  last: RunRow | null;
  report: Excerpt | null;
  /** Name the project in the meta line; off on the project's own page. */
  showProject: boolean;
  className?: string;
}

/** Who acknowledged a run: the decision on a result's questions, or who saw a failure. */
function seenText(run: RunRow | null, seen: Acknowledgement, clock: HostClock): string {
  return (run?.result?.questions ?? 0) > 0 ? decisionText(seen, clock) : ackText(seen, clock);
}

/**
 * A ritual darius runs, as a row: its state, when it last ran, when it runs
 * next, and its latest report. The row opens the latest run; "History" opens
 * the ritual. A desktop shows a three-line excerpt of the report under it.
 */
export function ReportRow({ project, ritual, last, report, showProject, className }: ReportRowProps): React.ReactNode {
  const { today, offset } = useClock();
  const state: Badge = last === null ? { tone: "idle", label: "No run yet" } : runState(last);
  const seen = last?.acknowledged ?? null;
  const next = ritual.nextDue === null || ritual.overdueDays > 0 || ritual.heldRun !== null || ritual.openRun !== null ? null : `next ${datePhrase(today, ritual.nextDue)}`;
  const time = last === null && next === null ? undefined : (
    <>
      {last === null ? null : <Time iso={last.startedAt} />}
      {last === null || next === null ? null : ", "}
      {next}
    </>
  );
  const result = last?.result ?? null;
  const counts = result === null ? [] : summaryTags(result, seen !== null);
  return (
    <Row
      kind="ritual"
      href={last === null ? ritualPath(project, ritual.slug) : runPath(project, last.run)}
      title={ritual.title}
      rail={railOf(state)}
      live={state.tone === "run"}
      chips={result === null || counts.length === 0 ? undefined : <ResultChips summary={result} isAnswered={seen !== null} />}
      state={state}
      meta={showProject ? [project] : []}
      time={time}
      acts={<Link to={ritualPath(project, ritual.slug)}>History</Link>}
      note={seen === null ? undefined : seenText(last, seen, { today, offset })}
      excerpt={report === null ? undefined : <Report report={report} lines={3} fades={false} />}
      className={className}
    />
  );
}
