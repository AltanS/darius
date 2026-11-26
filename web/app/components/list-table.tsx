/**
 * The list table (0.142.0): one row grammar for the lists of the machine
 * pages, the Runs page and the "Recent runs" lists. A real table with
 * header cells, so the columns line up down the whole list. The name cell
 * holds the row's link, stretched over the whole row; other links in a row
 * sit above it. On a phone each row stacks into two lines: the state and the
 * name, then the other cells as small labelled values.
 *
 *     State      Name (muted phrase)               Where     When       extras
 *     ■ late     Nightly report  demo-shop          -         2 h ago
 */

import { Link } from "react-router";

import { useClock } from "../lib/clock.tsx";
import { relativeTime } from "../lib/format.ts";
import { fullMoment } from "../lib/lists.ts";
import type { Rail } from "../lib/state-words.ts";
import type { Badge } from "../lib/tone.ts";

/** A column of a list table: its header word and the kind of cell under it. */
export interface Column {
  label: string;
  /** `state` and `name` lead a row on a phone; `num` and `took` align right. */
  kind: "state" | "name" | "text" | "num" | "time" | "extra";
}

interface ListTableProps {
  /** What the table lists, for a screen reader: "Workspaces it runs". */
  caption: string;
  columns: readonly Column[];
  children: React.ReactNode;
  className?: string;
}

/** A table of rows that share their columns. Put `ListRow`s in it, or `tbody`s of them. */
export function ListTable({ caption, columns, children, className }: ListTableProps): React.ReactNode {
  return (
    <table className={`lt${className === undefined ? "" : ` ${className}`}`}>
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.label} scope="col" className={`lt-h lt-${column.kind}`}>
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      {children}
    </table>
  );
}

interface ListRowProps {
  children: React.ReactNode;
  /** A state that needs attention draws a square rail at the left edge. */
  rail?: Rail | null;
  className?: string;
}

/** One row. Its name cell holds the link that covers the row. */
export function ListRow({ children, rail = null, className }: ListRowProps): React.ReactNode {
  const classes = ["lt-row", rail === null ? "" : `lt-rail tone-${rail}`, className ?? ""].filter((part) => part !== "");
  return <tr className={classes.join(" ")}>{children}</tr>;
}

interface StateCellProps {
  state: Badge;
  /** A hollow dot: a state with no verdict yet (no run, not asked). */
  hollow?: boolean;
}

/** The state: the square dot and one word, in its tone. A fixed width, so the names start at one x. */
export function StateCell({ state, hollow = false }: StateCellProps): React.ReactNode {
  return (
    <td className="lt-c lt-state">
      <span className={`lt-word tone-${state.tone}`}>
        <span className={hollow ? "fl-dot is-hollow" : "fl-dot"} aria-hidden="true" />
        {state.label}
      </span>
    </td>
  );
}

interface NameCellProps {
  /** The title, one line; it ends in an ellipsis when too long, with the full title on hover. */
  title: string;
  /** Where the row goes; without it the title is plain text. */
  to?: string;
  /** Something before the title: a workspace icon. */
  lead?: React.ReactNode;
  /** At most one muted phrase: beside the title, or under it with `below`. */
  phrase?: React.ReactNode;
  below?: boolean;
  /** Small muted marks after the title: "manual", "pinned". They keep their width; the title is cut first. */
  marks?: React.ReactNode;
  /** A second muted line under the title, in the same cell: a mark too long to sit beside it. */
  sub?: React.ReactNode;
}

/** The name: the title as the row's link, and at most one muted phrase. */
export function NameCell({ title, to, lead, phrase, below = false, marks, sub }: NameCellProps): React.ReactNode {
  const name = to === undefined ? <span className="lt-title" title={title}>{title}</span> : (
    <Link to={to} className="lt-title lt-link" title={title}>
      {title}
    </Link>
  );
  return (
    <td className={`lt-c lt-name${below ? " lt-below" : ""}`}>
      <div className="lt-namebox">
        {lead}
        {name}
        {marks === undefined || marks === null ? null : <span className="lt-marks">{marks}</span>}
        {phrase === undefined || phrase === null ? null : <span className="lt-phrase">{phrase}</span>}
      </div>
      {sub === undefined || sub === null ? null : (
        <div className="lt-sub">
          <span className="lt-sub-text">{sub}</span>
        </div>
      )}
    </td>
  );
}

interface CellProps {
  /** The column word: a phone shows it before the value. */
  label: string;
  kind?: Column["kind"];
  children: React.ReactNode;
}

/** Any other cell: a value with its column word for the phone. */
export function Cell({ label, kind = "text", children }: CellProps): React.ReactNode {
  return (
    <td className={`lt-c lt-${kind}`} data-label={label}>
      {children}
    </td>
  );
}

/** An empty value or a zero: a muted dash, never "none", never a bright 0. */
export function Dash(): React.ReactNode {
  return <span className="lt-dash">-</span>;
}

/** A count: the number, or a dash for zero. */
export function Count({ n }: { n: number }): React.ReactNode {
  return n === 0 ? <Dash /> : <span className="lt-n">{n}</span>;
}

/** A relative time ("6 h ago", "in 3 h") with the absolute local time in its title. */
export function When({ iso }: { iso: string | null }): React.ReactNode {
  const { now, offset } = useClock();
  if (iso === null) return <Dash />;
  return (
    <time dateTime={iso} title={fullMoment(iso, offset)}>
      {relativeTime(iso, now)}
    </time>
  );
}

interface ListHeadProps {
  title: string;
  /** "newest first". */
  order: string;
  count?: number;
}

/** The heading line of a list inside a block: its name, its count, and its order, small and muted. */
export function ListHead({ title, order, count }: ListHeadProps): React.ReactNode {
  return (
    <h3 className="lt-head">
      <span className="lt-head-title">{count === undefined ? title : `${title} (${String(count)})`}</span>
      <span className="lt-order">{order}</span>
    </h3>
  );
}

/** The order of a list in a section heading line: small and muted. */
export function OrderNote({ children }: { children: string }): React.ReactNode {
  return <span className="lt-order">{children}</span>;
}
