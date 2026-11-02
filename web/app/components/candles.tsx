/**
 * The candles of the Candles place (0.112.0): the list rows, the flame, and the
 * two buttons that settle a lit candle. Every text in a candle comes from a run,
 * a script or a person, so it is drawn as plain text only.
 *
 * "Answer" asks for a note (required) and, when the newest report came from a
 * run, offers "And start a follow-up run". "Accept risk" asks for an optional
 * note; before the tap it says when the candle belongs to a vigil that the
 * accept also closes. Both post to `/api/candle/answer` and
 * `/api/candle/accept`. The reply is the news: the buttons give way to one
 * line at once, and one load in the background brings the new state. Only the
 * button that was tapped shows the busy gem; the wait line after it is text.
 * A refusal shows the server's sentence and leaves the candle, and the note,
 * as they were.
 */

import { useId, useState } from "react";
import { Link, useRevalidator } from "react-router";

import type { CandleRow } from "../../../src/web/api.ts";
import { startNotice, type RunNowNotice } from "../lib/ask.ts";
import { useClock } from "../lib/clock.tsx";
import { acceptBody, acceptWarning, answerBody, cameFromRun, canAccept, canAnswer, firstSeenText, NO_WRITE_TEXT, NOTE_MAX, RECEIPTS, ritualOfSource, seenText, statusBadge, vigilOfSource } from "../lib/candles.ts";
import { href } from "../lib/paths.ts";
import { postJson } from "../lib/post.ts";
import { severityTone } from "../lib/result.ts";
import { BusyButton } from "./busy-button.tsx";
import { Chip } from "./chip.tsx";
import { NavIcon } from "./nav-icons.tsx";
import { Tag } from "./result.tsx";
import { Row, RowList } from "./row.tsx";
import { StartLine } from "./start-line.tsx";
import { Empty } from "./ui.tsx";
import { WaitLine } from "./wait-line.tsx";

interface CandleIconProps {
  size?: number;
  className?: string;
}

/** The mark of a candle, in the orange of the late tone. */
export function CandleIcon({ size = 16, className }: CandleIconProps): React.ReactNode {
  return <NavIcon name="candle" size={size} className={className === undefined ? "candle-ico" : `candle-ico ${className}`} />;
}

/** The severity of a candle as a chip: the same word and tone a finding has. */
export function SeverityTag({ row }: { row: Pick<CandleRow, "severity"> }): React.ReactNode {
  return <Tag tag={{ text: row.severity, tone: severityTone(row.severity) }} />;
}

type Mode = "answer" | "accept";

interface DoneLine {
  text: string;
  /** The status the candle had when it was done: the line stays while the page still shows that status. */
  status: CandleRow["status"];
}

interface CandleActionsProps {
  row: CandleRow;
  /** False for the loopback viewer: the server would refuse every write, so a line says why there are no buttons. */
  canWrite: boolean;
}

/** Answer and Accept risk for a lit candle (Accept risk also for an answered one). Draws nothing for a candle nobody can settle here. */
export function CandleActions({ row, canWrite }: CandleActionsProps): React.ReactNode {
  const { revalidate } = useRevalidator();
  const id = useId();
  const [mode, setMode] = useState<Mode | null>(null);
  const [note, setNote] = useState("");
  const [followUp, setFollowUp] = useState(false);
  const [busy, setBusy] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<DoneLine | null>(null);
  const [notice, setNotice] = useState<RunNowNotice | null>(null);
  const offersAnswer = canAnswer(row);
  const offersAccept = canAccept(row);
  const warning = acceptWarning(row);
  const canFollowUp = cameFromRun(row);
  const isLocked = busy !== null;

  if (done !== null && done.status === row.status) {
    return (
      <div className="candle-acts">
        {notice === null ? (
          <p className="bk-note tone-ok" role="status">
            {done.text}
          </p>
        ) : (
          <StartLine notice={notice} project={row.project} />
        )}
      </div>
    );
  }
  if (!offersAnswer && !offersAccept) return null;
  if (!canWrite) return <p className="fu-off">{NO_WRITE_TEXT}</p>;

  const open = (next: Mode): void => {
    setMode(mode === next ? null : next);
    setError(null);
  };

  const send = async (verb: Mode): Promise<void> => {
    setBusy(verb);
    setError(null);
    const withFollowUp = verb === "answer" && followUp;
    const result = await postJson(`/api/candle/${verb}`, verb === "answer" ? answerBody(row, note, withFollowUp) : acceptBody(row, note));
    setBusy(null);
    if (!result.ok) {
      // The sentence is the server's. A refused follow-up leaves the candle lit and the form open, with the note as typed.
      setError(result.error);
      void revalidate();
      return;
    }
    setMode(null);
    setDone({ text: RECEIPTS[verb], status: row.status });
    if (withFollowUp) setNotice(startNotice(result));
    void revalidate();
  };

  const canSend = mode === "answer" ? note.trim() !== "" : true;
  return (
    <div className="candle-acts">
      <div className="fu-acts">
        {offersAnswer ? (
          <button type="button" className="st-btn st-btn-main" aria-expanded={mode === "answer"} aria-label={`Answer the candle: ${row.title}`} disabled={isLocked} onClick={() => open("answer")}>
            Answer
          </button>
        ) : null}
        {offersAccept ? (
          <button type="button" className="st-btn" aria-expanded={mode === "accept"} aria-label={`Accept the risk of the candle: ${row.title}`} disabled={isLocked} onClick={() => open("accept")}>
            Accept risk
          </button>
        ) : null}
      </div>
      {offersAccept && warning !== null ? <p className="fu-off">{warning}</p> : null}
      {mode === null ? null : (
        <form
          className="candle-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSend && !isLocked) void send(mode);
          }}
        >
          <label className="fu-label" htmlFor={id}>
            {mode === "answer" ? "What did you decide? (required)" : "Note (optional)"}
          </label>
          <input id={id} className="st-input" type="text" maxLength={NOTE_MAX} value={note} disabled={isLocked} onChange={(event) => setNote(event.currentTarget.value)} />
          {mode === "answer" && canFollowUp ? (
            <label className="fu-pick">
              <input type="checkbox" checked={followUp} disabled={isLocked} onChange={(event) => setFollowUp(event.currentTarget.checked)} />
              And start a follow-up run
            </label>
          ) : null}
          <div className="fu-acts">
            <BusyButton busy={busy === mode} type="submit" className={mode === "answer" ? "st-btn st-btn-main" : "st-btn st-btn-danger"} disabled={isLocked || !canSend}>
              {mode === "answer" ? (busy === "answer" ? (followUp ? "Starting…" : "Sending…") : followUp ? "Answer and start follow-up" : "Send answer") : busy === "accept" ? "Accepting…" : "Accept this risk"}
            </BusyButton>
            <button type="button" className="st-btn" disabled={isLocked} onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
          <WaitLine active={busy === "answer" && followUp} what="run" />
        </form>
      )}
      {error === null ? null : (
        <p className="bk-note tone-bad" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

interface CandleRowsProps {
  rows: readonly CandleRow[];
  /** Name the project in each row: the page covers more than one. */
  showProject: boolean;
  /** The line shown when there is no row. */
  empty: string;
}

function CandleItem({ row, showProject }: { row: CandleRow; showProject: boolean }): React.ReactNode {
  const { now, offset } = useClock();
  const badge = statusBadge(row.status);
  const meta = [showProject ? row.project : null, seenText(row.reports), firstSeenText(row, now, offset)].filter((part) => part !== null);
  return (
    <Row
      icon={<CandleIcon className="rw-icon" />}
      title={row.title}
      href={href({ to: "candle", ws: row.project, key: row.key })}
      rail={row.status === "lit" ? "wait" : null}
      chips={
        <>
          <SeverityTag row={row} />
          {row.stillReported ? <Chip color="idle">reported again</Chip> : null}
        </>
      }
      state={badge}
      meta={meta}
      detail={row.target}
    />
  );
}

/** The candles of a list, one row each. A row opens the candle. */
export function CandleRows({ rows, showProject, empty }: CandleRowsProps): React.ReactNode {
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  return (
    <RowList bare className="stagger">
      {rows.map((row) => (
        <CandleItem key={`${row.project}/${row.key}`} row={row} showProject={showProject} />
      ))}
    </RowList>
  );
}

/** Where a candle came from: a vigil or a ritual of its workspace as a link, any other source (a script, a CI job) as plain text. */
export function SourceLink({ row }: { row: Pick<CandleRow, "project" | "source"> }): React.ReactNode {
  const vigil = vigilOfSource(row.source);
  if (vigil !== null) return <Link to={href({ to: "vigil", ws: row.project, slug: vigil })}>{`vigil ${vigil}`}</Link>;
  const ritual = ritualOfSource(row.source);
  if (ritual !== null) return <Link to={href({ to: "ritual", ws: row.project, slug: ritual })}>{`ritual ${ritual}`}</Link>;
  return <span className="break-words">{row.source}</span>;
}
