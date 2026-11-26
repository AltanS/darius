/** The run list, the held-question block and the latest-report row, shared by several pages. */

import { Link } from "react-router";

import type { Acknowledgement, RitualRow, RunRow } from "../../../src/web/api.ts";
import { currentHold, heldKey } from "../lib/ask.ts";
import { useClock } from "../lib/clock.tsx";
import { answerCommand, clockTime, duration, hostDate, shortDate, shortRun } from "../lib/format.ts";
import { href } from "../lib/paths.ts";
import { ackKindOf, summaryTags } from "../lib/result.ts";
import { nestRuns } from "../lib/ritual-activity.ts";
import { datePhrase, railOf } from "../lib/state-words.ts";
import type { Badge } from "../lib/tone.ts";
import { ackText, decisionText, runState, type ActivityRun, type Excerpt, type HostClock, type NextStep } from "../lib/view.ts";
import { AckButton } from "./ack.tsx";
import { HeldForm } from "./ask-form.tsx";
import { Command } from "./command.tsx";
import { Chip, KindWord } from "./chip.tsx";
import { Report } from "./board.tsx";
import { ResultChips } from "./result.tsx";
import { Row, RowList } from "./row.tsx";
import { Empty, Fold, Time } from "./ui.tsx";
import { Cell, Dash, ListRow, ListTable, NameCell, StateCell, type Column } from "./list-table.tsx";
import { fullMoment, groupByDay, runClock, runMarks, showsMachines } from "../lib/lists.ts";
import { relativeTime } from "../lib/format.ts";

interface RunListProps {
  runs: readonly ActivityRun[];
  /** Name the project on each row, for lists over several projects; a list that holds one project leaves it out. */
  showProject: boolean;
  /** Name the ritual on each row; off on a ritual's own page, where a row is titled by its date. */
  showLabel?: boolean;
  empty: string;
  /** Rows from this one on carry `phone-extra`, so a phone can hide them behind a button. */
  phoneShown?: number;
  /** Put a follow-up under its parent run, indented (0.91.0). Off for lists that mix rituals. */
  nest?: boolean;
  /** A line under a run by its id: "follow-up by web:altan, approved Q2", "read your answer of 09:12". */
  notes?: ReadonlyMap<string, string>;
}

/** The runs in the order the list shows them: with `nest`, each follow-up right under its parent. */
function listed(runs: readonly ActivityRun[], nest: boolean): Array<{ run: ActivityRun; isChild: boolean }> {
  if (!nest) return runs.map((run) => ({ run, isChild: false }));
  return nestRuns(runs).flatMap(({ row, children }) => {
    const rows = [{ run: row, isChild: false }];
    for (const child of children) rows.push({ run: child, isChild: true });
    return rows;
  });
}

/** Runs as rows: what ran, how it ended, how long it took, who started it, when. Each row opens the run. */
export function RunList({ runs, showProject, showLabel = true, empty, phoneShown = runs.length, nest = false, notes }: RunListProps): React.ReactNode {
  const { offset } = useClock();
  if (runs.length === 0) return <Empty>{empty}</Empty>;
  const named = showProject && new Set(runs.map((run) => run.project)).size > 1;
  return (
    <RowList bare>
      {listed(runs, nest).map(({ run, isChild }, index) => {
        const state = runState(run, runs);
        const took = run.endedAt === null ? null : duration(run.startedAt, run.endedAt);
        const isImport = run.who === "import";
        const meta = [named ? run.project : null, took === null ? null : `took ${took}`, isImport ? null : run.who === "timer" ? "by timer" : `by ${run.who}`].filter((part) => part !== null);
        const counts = run.result === null ? [] : summaryTags(run.result, null);
        const hasChips = showLabel || counts.length > 0 || isImport;
        const chips = hasChips ? (
          <>
            {showLabel ? <KindWord kind={run.kind} manual={run.manual} /> : null}
            {run.result === null || counts.length === 0 ? null : <ResultChips summary={run.result} ack={ackKindOf(run)} />}
            {isImport ? <Chip color="idle">imported</Chip> : null}
          </>
        ) : undefined;
        return (
          <Row
            key={`${run.project}/${run.run}`}
            kind={run.kind}
            manual={run.manual}
            href={href({ to: "run", ws: run.project, run: run.run })}
            title={showLabel ? run.label : shortDate(hostDate(run.startedAt, offset))}
            rail={railOf(state)}
            live={run.phase === "running"}
            chips={chips}
            state={state}
            meta={meta}
            time={showLabel ? <Time iso={run.startedAt} /> : clockTime(run.startedAt, offset)}
            detail={run.followUpOf === null || isChild ? undefined : <>follow-up of <Link to={href({ to: "run", ws: run.project, run: run.followUpOf })}>{shortRun(run.followUpOf)}</Link></>}
            note={notes?.get(run.run)}
            className={[index >= phoneShown ? "phone-extra" : "", isChild ? "rw-nested" : ""].filter((part) => part !== "").join(" ") || undefined}
          />
        );
      })}
    </RowList>
  );
}

interface RunTableProps {
  runs: readonly ActivityRun[];
  /** Name the workspace on each row, for lists over several workspaces (shown only when the list holds more than one). */
  showProject: boolean;
  /** Group the runs by day under a day heading (the Runs page); else one list with the day in the Time cell when it is not today. */
  byDay?: boolean;
  empty: string;
  /** What the table lists, for a screen reader. */
  caption: string;
  /** Rows from this one on carry `phone-extra`, so a phone can hide them behind a button. */
  phoneShown?: number;
  /** An extra class on the table: `lt-capped` caps its width. */
  className?: string;
}

/** The state of a run row: as `runState`, with "Held" for a held run. */
function runRowState(run: ActivityRun, runs: readonly ActivityRun[]): Badge {
  const state = runState(run, runs);
  return run.phase === "held" ? { tone: state.tone, label: "Held" } : state;
}

/** The marks after a run title: what is not the default about it. */
function RunMarks({ run }: { run: ActivityRun }): React.ReactNode {
  const marks = runMarks(run);
  if (marks.length === 0) return null;
  return marks.map((mark, index) => (
    <span key={mark.text} className="lt-mark">
      {index === 0 ? null : ", "}
      {mark.text}
      {mark.run === undefined ? null : (
        <>
          {" "}
          <Link to={href({ to: "run", ws: run.project, run: mark.run })} className="lt-above">
            {shortRun(mark.run)}
          </Link>
        </>
      )}
    </span>
  ));
}

/** A mark up to this many characters sits beside the title; a longer one goes on a line under it. */
const SHORT_MARK = 20;

/** The marks of a run cell: beside the title (`marks`) or on a line under it (`sub`). */
type MarkPlace = Pick<React.ComponentProps<typeof NameCell>, "marks" | "sub">;

/** Where the marks of a run go: beside the title when short, on a second line when long, nowhere when there are none. */
function markPlace(run: ActivityRun): MarkPlace {
  const marks = runMarks(run);
  if (marks.length === 0) return {};
  const text = marks.map((mark) => (mark.run === undefined ? mark.text : `${mark.text} ${shortRun(mark.run)}`)).join(", ");
  return text.length <= SHORT_MARK ? { marks: <RunMarks run={run} /> } : { sub: <RunMarks run={run} /> };
}

interface RunCellsInput {
  run: ActivityRun;
  runs: readonly ActivityRun[];
  named: boolean;
  machines: boolean;
  withDay: boolean;
  clock: { now: number; today: string; offset: number };
}

/** The cells of one run row: Time, State, Run, Workspace, Machine, Took, then the result chips. */
function runCells({ run, runs, named, machines, withDay, clock }: RunCellsInput): React.ReactNode[] {
  const { now, today, offset } = clock;
  const state = runRowState(run, runs);
  const took = run.endedAt === null ? "" : duration(run.startedAt, run.endedAt);
  const counts = run.result === null ? [] : summaryTags(run.result, null);
  const isImport = run.who === "import";
  return [
    <Cell key="time" label="Time" kind="time">
      <time dateTime={run.startedAt} title={`${fullMoment(run.startedAt, offset)}, ${relativeTime(run.startedAt, now)}`}>
        {runClock(run.startedAt, { today, offset }, withDay)}
      </time>
    </Cell>,
    <StateCell key="state" state={state} />,
    <NameCell key="name" title={run.label} to={href({ to: "run", ws: run.project, run: run.run })} {...markPlace(run)} />,
    named ? (
      <Cell key="ws" label="Workspace">
        <span className="lt-muted">{run.project}</span>
      </Cell>
    ) : null,
    machines ? (
      <Cell key="host" label="Machine">
        <span className="lt-muted">{run.host}</span>
      </Cell>
    ) : null,
    <Cell key="took" label="Took" kind="num">
      {took === "" ? <Dash /> : took}
    </Cell>,
    <Cell key="extra" label="Result" kind="extra">
      {counts.length === 0 || run.result === null ? null : <ResultChips summary={run.result} ack={ackKindOf(run)} />}
      {isImport ? <Chip color="idle">imported</Chip> : null}
    </Cell>,
  ];
}

/**
 * Runs as a table (0.142.0): one line per run on a desktop, Time, State,
 * Run, Workspace (lists over several workspaces), Machine (when more than
 * one machine has runs in the list), Took, then the result chips. The kind
 * and the starter show only when they are not the default. Grouped by day
 * on the Runs page; a "Recent runs" list shows the day in the Time cell.
 */
export function RunTable({ runs, showProject, byDay = false, empty, caption, phoneShown = runs.length, className }: RunTableProps): React.ReactNode {
  const clock = useClock();
  const { today, offset } = clock;
  if (runs.length === 0) return <Empty>{empty}</Empty>;
  const named = showProject && new Set(runs.map((run) => run.project)).size > 1;
  const machines = showsMachines(runs);
  const columns: Column[] = [
    { label: "Time", kind: "time" },
    { label: "State", kind: "state" },
    { label: "Run", kind: "name" },
    ...(named ? [{ label: "Workspace", kind: "text" } as const] : []),
    ...(machines ? [{ label: "Machine", kind: "text" } as const] : []),
    { label: "Took", kind: "num" },
    { label: "Result", kind: "extra" },
  ];
  const rowOf = (run: ActivityRun, index: number): React.ReactNode => {
    const state = runRowState(run, runs);
    return (
      <ListRow key={`${run.project}/${run.run}`} rail={railOf(state)} className={[index >= phoneShown ? "phone-extra" : "", run.phase === "running" ? "lt-live" : ""].filter((part) => part !== "").join(" ") || undefined}>
        {runCells({ run, runs, named, machines, withDay: !byDay, clock })}
      </ListRow>
    );
  };
  if (!byDay) {
    return (
      <ListTable caption={caption} columns={columns} className={className === undefined ? "lt-runs" : `lt-runs ${className}`}>
        <tbody>{runs.map(rowOf)}</tbody>
      </ListTable>
    );
  }
  let index = 0;
  return (
    <ListTable caption={caption} columns={columns} className={className === undefined ? "lt-runs" : `lt-runs ${className}`}>
      {groupByDay(runs, { today, offset }).map((group) => (
        <tbody key={group.date}>
          <tr className="lt-day">
            <th scope="colgroup" colSpan={columns.length}>
              {group.label} <span className="lt-order">{group.runs.length === 1 ? "1 run" : `${String(group.runs.length)} runs`}</span>
            </th>
          </tr>
          {group.runs.map((run) => {
            const row = rowOf(run, index);
            index += 1;
            return row;
          })}
        </tbody>
      ))}
    </ListTable>
  );
}

interface QuestionsProps {
  project: string;
  run: RunRow;
  /** False for the loopback viewer: the answer form does not draw, the commands stay. */
  canWrite: boolean;
}

/**
 * The questions of a held run. A viewer who can write gets the answer form
 * for the current hold (0.80.0), with the commands behind a fold; the
 * loopback viewer gets each question with the command that answers it.
 */
export function Questions({ project, run, canWrite }: QuestionsProps): React.ReactNode {
  if (run.questions.length === 0) {
    return <Empty>The run is held without a question. Resume or close it from the command line.</Empty>;
  }
  if (canWrite && run.questions.length > (run.holdFrom ?? 0)) {
    return (
      <>
        <HeldForm key={heldKey(run)} project={project} row={run} />
        <Fold summary="Answer from a terminal">
          <ol className="qs">
            {currentHold(run).map((question) => (
              <li key={question.n}>
                <p>{question.text}</p>
                <Command command={answerCommand(run.run, question.n, project)} />
              </li>
            ))}
          </ol>
        </Fold>
      </>
    );
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
  /** False for the loopback viewer: the Acknowledge button does not draw. */
  canWrite: boolean;
}

/**
 * What happens after a failed or abandoned run: darius does not retry it
 * today, so the card gives the two commands a person has, and the
 * Acknowledge button for the second (0.68.0). Once someone acknowledged the
 * run, it says who, and when.
 */
export function NextStepCard({ step, canWrite }: NextStepCardProps): React.ReactNode {
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
        <AckButton project={step.project} run={step.run} canWrite={canWrite} subject="this failed run" />
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
  const state: Badge = last === null ? { tone: "idle", label: "No run yet" } : runState(last, [last]);
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
  const counts = result === null ? [] : summaryTags(result, null);
  return (
    <Row
      kind="ritual"
      href={last === null ? href({ to: "ritual", ws: project, slug: ritual.slug }) : href({ to: "run", ws: project, run: last.run })}
      title={ritual.title}
      rail={railOf(state)}
      live={state.tone === "run"}
      chips={result === null || counts.length === 0 ? undefined : <ResultChips summary={result} ack={last === null ? null : ackKindOf(last)} />}
      state={state}
      meta={showProject ? [project] : []}
      time={time}
      acts={<Link to={href({ to: "ritual", ws: project, slug: ritual.slug })}>History</Link>}
      note={seen === null ? undefined : seenText(last, seen, { today, offset })}
      excerpt={report === null ? undefined : <Report report={report} lines={3} fades={false} />}
      className={className}
    />
  );
}
