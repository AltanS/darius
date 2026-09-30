/**
 * Coming up and Waiting on an event: the two lists of `lib/agenda.ts`, drawn
 * the same on the home page and on the project page. Every row is one link
 * over its whole width (44 px tall at least), with a small kind tag, the
 * title, and one line of detail.
 */

import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router";

import { isFolded, phoneHidden, type Agenda, type AgendaGroup, type AgendaKind, type AgendaRow, type WaitingRow } from "../lib/agenda.ts";
import { shortDate, vigilAnchor } from "../lib/format.ts";
import { Fold, SectHead, Word } from "./ui.tsx";

const KIND_LABEL = { djinn: "djinn", hand: "by hand", vigil: "vigil" } as const satisfies Record<AgendaKind, string>;

/** Rows of Waiting on an event before its fold. */
export const WAITING_SHOWN = 5;

interface RowProps {
  row: AgendaRow;
  group: AgendaGroup;
  showProject: boolean;
  /** Give the row the id a `#vigil-...` link points at (the project page). */
  anchors: boolean;
  target: string;
  /** The phone hides this row until "Show more". */
  extra: boolean;
}

/** The date of a row in Later: it is not in the group label. */
function laterDate(row: AgendaRow, group: AgendaGroup): string | null {
  if (group.kind !== "later" || row.date === null) return null;
  return `${row.kind === "vigil" ? "due" : "next"} ${shortDate(row.date)}`;
}

function AgendaItem({ row, group, showProject, anchors, target, extra }: RowProps): React.ReactNode {
  const id = anchors && row.kind === "vigil" ? vigilAnchor(row.slug) : undefined;
  const classes = ["ag-row", `tone-${row.tone}`, extra ? "phone-extra" : "", id !== undefined && target === id ? "target-row is-target" : id === undefined ? "" : "target-row"].filter((part) => part !== "");
  const later = laterDate(row, group);
  // A vigil with an event puts its project in front of the "waits for" line, so the row stays short.
  const lead = row.kind === "vigil" && row.flag === null && row.until !== null;
  const pieces = [showProject && !lead ? row.project : null, ...(row.facts === "" ? [] : row.facts.split(", ")), later].filter((part) => part !== null);
  return (
    <li id={id} className={classes.join(" ")}>
      <span className="djinn-sq" aria-hidden="true" />
      <div className="ag-main">
        <Link to={row.href} className="ag-title">
          {row.title}
        </Link>
        <p className="ag-line">
          {row.state === null ? null : (
            <span className={`ag-word tone-${row.state.tone}`}>
              <Word text={row.state.word} />
            </span>
          )}
          {pieces.map((piece, index) => (
            <Fragment key={piece}>
              {index === 0 ? null : " "}
              <span className="ag-bit">
                {piece}
                {index === pieces.length - 1 ? "" : ","}
              </span>
            </Fragment>
          ))}
          {row.flag === null ? null : <span className="ag-flag ink-bad">{row.flag}</span>}
          {lead ? (
            <span className="ag-until">
              {showProject ? <span className="ag-proj">{row.project}</span> : null}
              {showProject ? " " : null}waits for: {row.until}
            </span>
          ) : null}
        </p>
      </div>
      <span className="ag-kind">{KIND_LABEL[row.kind]}</span>
    </li>
  );
}

interface ComingUpProps {
  agenda: Agenda;
  anchors: boolean;
  /** The hash target of the page, so a link to a hidden vigil opens the list. */
  target: string;
}

/**
 * The time-ordered agenda. A phone shows Overdue, Today and Tomorrow in full,
 * a few more rows, then one button. A desktop shows every day and keeps Later
 * and No schedule in a fold under the list.
 */
export function ComingUp({ agenda, anchors, target }: ComingUpProps): React.ReactNode {
  const hidden = phoneHidden(agenda);
  const folded = agenda.groups.filter((group) => isFolded(group));
  const foldedCount = folded.reduce((sum, group) => sum + group.rows.length, 0);
  const pointed = anchors && agenda.groups.some((group) => group.rows.some((row) => row.kind === "vigil" && vigilAnchor(row.slug) === target && (hidden.has(row.key) || isFolded(group))));
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (pointed) setExpanded(true);
  }, [pointed]);
  const toggle = () => setExpanded(!expanded);
  return (
    <section id="coming-up" className="section sec-coming">
      <SectHead title="Coming up" />
      <div className={`panel ag phone-more${expanded ? " is-open" : ""}`}>
        {agenda.groups.length === 0 ? (
          <p className="panel-empty">Nothing is scheduled.</p>
        ) : (
          agenda.groups.map((group) => {
            const gone = group.rows.every((row) => hidden.has(row.key));
            return (
              <div key={group.key} className={`ag-group${isFolded(group) ? " desk-extra" : ""}${gone ? " phone-extra" : ""}`}>
                <h3 className={`ag-day ag-day-${group.kind}`}>{group.label}</h3>
                <ul className="ag-rows">
                  {group.rows.map((row) => (
                    <AgendaItem key={row.key} row={row} group={group} showProject={agenda.showProject} anchors={anchors} target={target} extra={hidden.has(row.key)} />
                  ))}
                </ul>
              </div>
            );
          })
        )}
        {hidden.size === 0 ? null : (
          <button type="button" className="phone-toggle" aria-expanded={expanded} onClick={toggle}>
            {expanded ? "Show fewer" : `Show ${hidden.size} more`}
          </button>
        )}
        {foldedCount === 0 ? null : (
          <button type="button" className="desk-toggle" aria-expanded={expanded} onClick={toggle}>
            {expanded ? "Show fewer" : `Show ${foldedCount} later or without a schedule`}
          </button>
        )}
      </div>
    </section>
  );
}

interface WaitingItemProps {
  row: WaitingRow;
  showProject: boolean;
  anchors: boolean;
  target: string;
}

function WaitingItem({ row, showProject, anchors, target }: WaitingItemProps): React.ReactNode {
  const id = anchors ? vigilAnchor(row.slug) : undefined;
  const classes = ["ag-row", "ag-row-plain", `tone-${row.flagged ? "bad" : "idle"}`, id === undefined ? "" : target === id ? "target-row is-target" : "target-row"].filter((part) => part !== "");
  return (
    <li id={id} className={classes.join(" ")}>
      <span className="djinn-sq" aria-hidden="true" />
      <div className="ag-main">
        <Link to={row.href} className="ag-title">
          {row.title}
        </Link>
        <p className="ag-line">
          {row.flagged ? <span className="ag-word tone-bad">Flagged</span> : null}
          {row.until === null && !showProject ? null : (
            <span className="ag-until ag-until-2">
              {showProject ? <span className="ag-proj">{row.project}</span> : null}
              {showProject && row.until !== null ? " " : null}
              {row.until}
            </span>
          )}
        </p>
      </div>
    </li>
  );
}

interface WaitingProps {
  rows: readonly WaitingRow[];
  /** Rows before the fold. */
  shown: number;
  showProject: boolean;
  anchors: boolean;
  target: string;
}

/** The armed vigils without a due date: flagged first, a few in view, the rest in a fold. */
export function Waiting({ rows, shown, showProject, anchors, target }: WaitingProps): React.ReactNode {
  if (rows.length === 0) return null;
  const head = rows.slice(0, shown);
  const rest = rows.slice(shown);
  const pointed = anchors && rest.some((row) => vigilAnchor(row.slug) === target);
  return (
    <section id="waiting" className="section sec-waiting">
      <SectHead title="Waiting on an event" />
      <div className="panel ag">
        <ul className="ag-rows">
          {head.map((row) => (
            <WaitingItem key={row.key} row={row} showProject={showProject} anchors={anchors} target={target} />
          ))}
        </ul>
        {rest.length === 0 ? null : (
          <Fold open={pointed} summary={`${rest.length} more waiting`}>
            <ul className="ag-rows">
              {rest.map((row) => (
                <WaitingItem key={row.key} row={row} showProject={showProject} anchors={anchors} target={target} />
              ))}
            </ul>
          </Fold>
        )}
      </div>
    </section>
  );
}
