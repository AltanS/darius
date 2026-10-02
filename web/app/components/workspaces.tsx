/**
 * The Workspaces list of the all-workspaces Overview: one row per workspace,
 * the ones that need you first. A row is the workspace name (the link to its
 * Overview), one state word ("2 need you", "all clear" or "unreadable") and
 * one quiet line for what comes next. It reuses the row styling; there are no
 * tiles and no big numbers.
 */

import { Link } from "react-router";

import type { WorkspaceRow } from "../lib/home.ts";
import type { Badge } from "../lib/tone.ts";
import { RowList, StateWord } from "./row.tsx";
import { Empty, SectHead } from "./ui.tsx";

/** What a workspace says about itself: the state word and the rail tone, when it needs attention. */
interface WorkspaceState {
  state: Badge;
  rail: "wait" | "bad" | null;
}

function workspaceState(row: WorkspaceRow): WorkspaceState {
  if (row.unreadable) return { state: { tone: "bad", label: "unreadable" }, rail: "bad" };
  if (row.needs === 0) return { state: { tone: "idle", label: "all clear" }, rail: null };
  return { state: { tone: "wait", label: `${row.needs} ${row.needs === 1 ? "needs" : "need"} you` }, rail: "wait" };
}

interface WorkspaceItemProps {
  row: WorkspaceRow;
}

function WorkspaceItem({ row }: WorkspaceItemProps): React.ReactNode {
  const { state, rail } = workspaceState(row);
  return (
    <li className={`rw ws-row${rail === null ? "" : ` rw-rail tone-${rail}`}`}>
      <div className="rw-main">
        <Link to={row.href} className="rw-title">
          {row.name}
        </Link>
        <p className="rw-line">
          <span className="rw-seg">
            <StateWord state={state} />
          </span>
        </p>
        {row.next === null ? null : <p className="ws-next">{`Next: ${row.next.title}, ${row.next.when}`}</p>}
      </div>
    </li>
  );
}

interface WorkspaceListProps {
  rows: readonly WorkspaceRow[];
}

/** The Workspaces section; with no workspace it says how to link one. */
export function WorkspaceList({ rows }: WorkspaceListProps): React.ReactNode {
  return (
    <section id="workspaces" className="section sec-workspaces">
      <SectHead title="Workspaces" />
      {rows.length === 0 ? (
        <Empty>No workspace is linked on this host. Run darius link in a checkout.</Empty>
      ) : (
        <div className="panel">
          <RowList bare>
            {rows.map((row) => (
              <WorkspaceItem key={row.name} row={row} />
            ))}
          </RowList>
        </div>
      )}
    </section>
  );
}
