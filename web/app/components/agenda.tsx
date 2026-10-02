/**
 * Coming up and Waiting on an event: the two lists of `lib/agenda.ts`, drawn
 * the same on the home page and on the project page. Every row is the shared
 * `Row`: one link over its whole width, the icon of its kind, the title in
 * full, and a second line of chips, state word and facts. A rail marks the
 * rows that need attention.
 */

import { useEffect, useState } from "react";

import { isFolded, phoneHidden, type Agenda, type AgendaGroup, type AgendaRow, type WaitingRow } from "../lib/agenda.ts";
import { shortDate } from "../lib/format.ts";
import { vigilAnchor } from "../lib/paths.ts";
import { FLAGGED, railOf } from "../lib/state-words.ts";
import { KindWord } from "./chip.tsx";
import { Row, RowList } from "./row.tsx";
import { Fold, SectHead } from "./ui.tsx";

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

function AgendaItem({ row, group, showProject, anchors, target, extra }: RowProps): React.ReactNode {
  const id = anchors && row.kind === "vigil" ? vigilAnchor(row.slug) : undefined;
  const classes = [extra ? "phone-extra" : "", id !== undefined && target === id ? "target-row is-target" : id === undefined ? "" : "target-row"].filter((part) => part !== "");
  // A row in Later names its date in the place of a state; under a day label the label says it.
  const state = row.state ?? (group.kind === "later" && row.date !== null ? { tone: "idle" as const, label: shortDate(row.date) } : null);
  const meta = [showProject ? row.project : null, ...(row.facts === "" ? [] : row.facts.split(", ")), row.note].filter((part) => part !== null);
  return <Row id={id} kind={row.kind} manual={row.manual} href={row.href} title={row.title} rail={row.rail} chips={<KindWord kind={row.kind} manual={row.manual} />} state={state} meta={meta} detail={row.until === null ? undefined : `waits for: ${row.until}`} className={classes.join(" ")} />;
}

/** The label of a day group: "Overdue · 6", "Today · 2", "Tomorrow · 4", "Later · 5", or the weekday date as it is. */
function groupLabel(group: AgendaGroup): string {
  const counted = group.kind === "overdue" || group.kind === "today" || group.kind === "tomorrow" || group.kind === "later";
  return counted ? `${group.label} · ${group.rows.length}` : group.label;
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
                <h3 className={`ag-day ag-day-${group.kind}`}>{groupLabel(group)}</h3>
                <RowList bare>
                  {group.rows.map((row) => (
                    <AgendaItem key={row.key} row={row} group={group} showProject={agenda.showProject} anchors={anchors} target={target} extra={hidden.has(row.key)} />
                  ))}
                </RowList>
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
  const cls = id === undefined ? "" : target === id ? "target-row is-target" : "target-row";
  const state = row.flagged ? FLAGGED : null;
  return <Row id={id} kind="vigil" href={row.href} title={row.title} rail={railOf(state)} chips={<KindWord kind="vigil" />} state={state} meta={showProject ? [row.project] : []} detail={row.until} className={cls} />;
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
        <RowList bare>
          {head.map((row) => (
            <WaitingItem key={row.key} row={row} showProject={showProject} anchors={anchors} target={target} />
          ))}
        </RowList>
        {rest.length === 0 ? null : (
          <Fold open={pointed} summary={`${rest.length} more waiting`}>
            <RowList bare>
              {rest.map((row) => (
                <WaitingItem key={row.key} row={row} showProject={showProject} anchors={anchors} target={target} />
              ))}
            </RowList>
          </Fold>
        )}
      </div>
    </section>
  );
}
