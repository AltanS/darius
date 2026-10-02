/**
 * The findings of the findings page (0.62.0): one row per finding, drawn with
 * the shared `Row`. Every text in a finding comes from a run, so it is
 * rendered as plain text only. A row says how bad it is, where it is, which
 * ritual reported it and since when; under it a fold holds the detail, the
 * key and the short history. A finding that waits can be closed with the
 * "Close" button and an optional note, which posts to `/api/finding/close`
 * and then reloads the page data.
 */

import { useId, useState } from "react";
import { Link, useRevalidator } from "react-router";

import type { FindingRow, FindingStep } from "../../../src/web/api.ts";
import { useClock } from "../lib/clock.tsx";
import { hostDate, shortDate } from "../lib/format.ts";
import { href } from "../lib/paths.ts";
import { postJson } from "../lib/post.ts";
import { itemStateTag, severityTone } from "../lib/result.ts";
import type { Badge } from "../lib/tone.ts";
import { Chip } from "./chip.tsx";
import { Tag } from "./result.tsx";
import { Row, RowList } from "./row.tsx";
import { Empty, Fold } from "./ui.tsx";

/** The state word of a finding: its own state, unless the operator closed it. */
function stateOf(row: FindingRow): Badge {
  if (row.status === "closed") return { tone: "idle", label: "closed" };
  const tag = itemStateTag(row.state);
  return { tone: tag.tone ?? "idle", label: tag.text };
}

function stepText(step: FindingStep, offset: number): string {
  return `${shortDate(hostDate(step.at, offset))}, ${step.severity}, ${itemStateTag(step.state).text}`;
}

interface DetailsProps {
  row: FindingRow;
}

/** The fold under a row: the detail, the key, why it is marked, who closed it, and the history with a link to each run. */
function Details({ row }: DetailsProps): React.ReactNode {
  const { offset } = useClock();
  return (
    <Fold summary="Detail and history">
      {row.detail === undefined ? null : <p className="ritem-detail">{row.detail}</p>}
      <p className="ritem-key">{`key ${row.key}${row.auto ? " (darius made this key: the run gave none)" : ""}`}</p>
      {row.stale ? <p className="ritem-key">Stale: the newest run of this ritual did not report it.</p> : null}
      {row.reopened ? <p className="ritem-key">Reopened: it came back after it was fixed or closed.</p> : null}
      {row.closed === undefined ? null : (
        <p className="ritem-key">{`Closed by ${row.closed.who} on ${shortDate(hostDate(row.closed.at, offset))}${row.closed.note === undefined ? "" : `: ${row.closed.note}`}`}</p>
      )}
      <ol className="fnd-history" aria-label="History, oldest first">
        {row.history.map((step) => (
          <li key={`${step.run}-${step.at}`}>
            <Link to={href({ to: "run", ws: row.project, run: step.run })}>{stepText(step, offset)}</Link>
          </li>
        ))}
      </ol>
    </Fold>
  );
}

interface CloseFormProps {
  row: FindingRow;
  onDone: () => void;
}

/** The note field and the two buttons that close a finding. */
function CloseForm({ row, onDone }: CloseFormProps): React.ReactNode {
  const { revalidate } = useRevalidator();
  const id = useId();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const trimmed = note.trim();
    const base = { project: row.project, ritual: row.ritual, key: row.key };
    const result = await postJson("/api/finding/close", trimmed === "" ? base : { ...base, note: trimmed });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onDone();
    await revalidate();
  };

  return (
    <form className="fnd-close-form" onSubmit={(event) => void submit(event)}>
      <label className="fu-label" htmlFor={id}>
        Note (optional)
      </label>
      <input id={id} className="st-input" type="text" maxLength={500} value={note} disabled={busy} onChange={(event) => setNote(event.currentTarget.value)} />
      <div className="fu-acts">
        <button type="submit" className="st-btn st-btn-main" disabled={busy}>
          {busy ? "Closing…" : "Close finding"}
        </button>
        <button type="button" className="st-btn" disabled={busy} onClick={onDone}>
          Cancel
        </button>
      </div>
      {error === null ? null : (
        <p className="bk-note tone-bad" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

interface FindingItemProps {
  row: FindingRow;
  showProject: boolean;
}

function FindingItem({ row, showProject }: FindingItemProps): React.ReactNode {
  const { offset } = useClock();
  const [asking, setAsking] = useState(false);
  const canClose = row.status === "needs-you" || row.status === "open";
  const where = [row.group, row.target].filter((part) => part !== undefined).join(" · ");
  const state = stateOf(row);
  const meta = [showProject ? row.project : null, `since ${shortDate(hostDate(row.firstSeen.at, offset))}`].filter((part) => part !== null);
  return (
    <Row
      kind="ritual"
      title={row.title}
      rail={row.status === "needs-you" ? "wait" : null}
      chips={
        <>
          <Tag tag={{ text: row.severity, tone: severityTone(row.severity) }} />
          <span className="kind-word c-ritual">{row.ritual}</span>
          {row.stale ? <Chip color="idle">stale</Chip> : null}
          {row.reopened ? <Chip color="late">reopened</Chip> : null}
        </>
      }
      state={state}
      meta={meta}
      detail={where === "" ? undefined : where}
      foot={
        <>
          {asking ? <CloseForm row={row} onDone={() => setAsking(false)} /> : null}
          <div className="fnd-foot">
            <span className="fnd-acts">
              <Link to={href({ to: "run", ws: row.project, run: row.lastSeen.run })}>last report</Link>
              {canClose ? (
                <button type="button" className="st-btn st-btn-small" aria-expanded={asking} aria-label={`Close the finding: ${row.title}`} onClick={() => setAsking(!asking)}>
                  Close
                </button>
              ) : null}
            </span>
            <Details row={row} />
          </div>
        </>
      }
    />
  );
}

interface FindingListProps {
  rows: readonly FindingRow[];
  /** Name the project in each row: the page covers more than one. */
  showProject: boolean;
  /** The line shown when there is no row. */
  empty: string;
}

export function FindingList({ rows, showProject, empty }: FindingListProps): React.ReactNode {
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  return (
    <RowList bare className="stagger">
      {rows.map((row) => (
        <FindingItem key={`${row.project}/${row.ritual}/${row.key}`} row={row} showProject={showProject} />
      ))}
    </RowList>
  );
}
