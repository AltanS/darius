/**
 * The one row. Coming up, Waiting on an event, Now, Recent runs, /runs, a
 * ritual's history, Latest reports, Last night and closed vigils all draw it,
 * so the same thing looks the same on every page.
 *
 *     [icon]  Title in full, sans 15px, wraps
 *             chip chip · State word · meta, meta · 4 h ago
 *
 * The icon is the kind's. The title is the stretched link: the whole row is
 * the tap target. The state word, the chips and the time all sit on the second
 * line, so a row never has a lone right-aligned word. A left rail marks only
 * the rows that need attention: late, running, waiting for you, asks you,
 * failed, flagged.
 */

import { Fragment } from "react";
import { Link } from "react-router";

import type { Kind } from "../lib/kind.ts";
import type { Rail } from "../lib/state-words.ts";
import type { Badge } from "../lib/tone.ts";
import { KindIcon } from "./kind.tsx";

interface StateWordProps {
  state: Badge;
}

/** A state word: sans, 13 px, weight 600, sentence case, in its tone. */
export function StateWord({ state }: StateWordProps): React.ReactNode {
  return <span className={`rw-state tone-${state.tone}`}>{state.label}</span>;
}

interface RowProps {
  id?: string;
  kind: Kind;
  /** A ritual done by hand: the row icon is the hand, in the manual colour. */
  manual?: boolean;
  title: React.ReactNode;
  /** Where the row goes; without it the row is not a link. */
  href?: string;
  rail?: Rail | null;
  /** A running item: a light sweeps along the top edge. */
  live?: boolean;
  /** The chips at the start of the second line. */
  chips?: React.ReactNode;
  state?: Badge | null;
  /** The pieces of the meta line: they wrap whole, and a comma follows each but the last. */
  meta?: readonly string[];
  /** The last piece of the meta line, at the end of the second line: "4 h ago". */
  time?: React.ReactNode;
  /** A small link or two at the very end of the second line. */
  acts?: React.ReactNode;
  /** A third line, muted, at most two lines long: what a vigil waits for. */
  detail?: React.ReactNode;
  /** A third line, muted, in full: who acknowledged a run. */
  note?: React.ReactNode;
  /** A desktop-only excerpt under the row; a phone does not show it. */
  excerpt?: React.ReactNode;
  className?: string;
}

/** One row of a list; put it in a `RowList`. */
export function Row({ id, kind, manual = false, title, href, rail = null, live = false, chips, state = null, meta = [], time, acts, detail, note, excerpt, className }: RowProps): React.ReactNode {
  const classes = ["rw", rail === null ? "" : `rw-rail tone-${rail}`, live ? "rw-live" : "", className ?? ""].filter((part) => part !== "");
  const segments: React.ReactNode[] = [];
  if (chips !== undefined && chips !== null) segments.push(<span key="chips" className="rw-seg rw-chips">{chips}</span>);
  if (state !== null) segments.push(<span key="state" className="rw-seg"><StateWord state={state} /></span>);
  const pieces: React.ReactNode[] = [...meta, ...(time === undefined || time === null ? [] : [time])];
  if (pieces.length > 0) {
    segments.push(
      <span key="meta" className="rw-seg rw-meta">
        {pieces.map((piece, index) => (
          <Fragment key={`${index}`}>
            {index === 0 ? null : " "}
            <span className="rw-bit">
              {piece}
              {index === pieces.length - 1 ? "" : ","}
            </span>
          </Fragment>
        ))}
      </span>,
    );
  }
  return (
    <li id={id} className={classes.join(" ")}>
      {live ? <span className="live-bar" aria-hidden="true" /> : null}
      <KindIcon kind={kind === "ritual" && manual ? "manual" : kind} className="rw-icon" />
      <div className="rw-main">
        {href === undefined ? <span className="rw-title">{title}</span> : <Link to={href} className="rw-title">{title}</Link>}
        {segments.length === 0 && acts === undefined ? null : (
          <p className="rw-line">
            {segments}
            {acts === undefined ? null : <span className="rw-acts">{acts}</span>}
          </p>
        )}
        {detail === undefined || detail === null ? null : <p className="rw-detail">{detail}</p>}
        {note === undefined || note === null ? null : <p className="rw-note">{note}</p>}
        {excerpt === undefined || excerpt === null ? null : <div className="rw-excerpt">{excerpt}</div>}
      </div>
    </li>
  );
}

interface RowListProps {
  children: React.ReactNode;
  /** Sit inside a panel: no frame of its own. */
  bare?: boolean;
  className?: string;
}

/** A list of rows in one frame, separated by 1 px lines. */
export function RowList({ children, bare = false, className }: RowListProps): React.ReactNode {
  return <ul className={`rw-list${bare ? " rw-bare" : ""}${className === undefined ? "" : ` ${className}`}`}>{children}</ul>;
}
