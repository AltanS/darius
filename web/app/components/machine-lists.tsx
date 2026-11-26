/**
 * The lists of the machine pages (0.142.0), in the row grammar of
 * `list-table.tsx`: the workspaces a machine runs, the copies it shows, the
 * djinns that live there, and the projects of the store with their sync.
 * The Machines page and a machine page draw the same rows.
 */

import { Link } from "react-router";

import type { SystemProject } from "../../../src/web/api.ts";
import { useClock } from "../lib/clock.tsx";
import { byteSize } from "../lib/format.ts";
import { djinnStateWord, lastRunWord, nextText, type CopyRow, type PlacedDjinn, type RunsHereRow } from "../lib/lists.ts";
import { href } from "../lib/paths.ts";
import { railOf } from "../lib/state-words.ts";
import { Cell, Count, Dash, ListRow, ListTable, NameCell, StateCell, When } from "./list-table.tsx";
import { WorkspaceGlyph } from "./workspace-icon.tsx";

interface RunsHereProps {
  rows: readonly RunsHereRow[];
  /** Show the Open runs column (a machine page). */
  openRuns?: boolean;
  caption: string;
}

/** The workspaces a machine runs: State, Workspace with its first reason, Djinns here, (Open runs,) Last run here. */
export function RunsHereTable({ rows, openRuns = false, caption }: RunsHereProps): React.ReactNode {
  return (
    <ListTable
      caption={caption}
      className="lt-ws lt-capped"
      columns={[
        { label: "State", kind: "state" },
        { label: "Workspace", kind: "name" },
        { label: "Djinns here", kind: "num" },
        ...(openRuns ? [{ label: "Open runs", kind: "num" } as const] : []),
        { label: "Last run here", kind: "time" },
      ]}
    >
      <tbody>
        {rows.map((row) => {
          const last = row.lastRun === null ? null : lastRunWord(row.lastRun.outcome);
          return (
            <ListRow key={row.name}>
              <StateCell state={row.health} />
              <NameCell title={row.name} to={href({ to: "overview", ws: row.name })} lead={<WorkspaceGlyph icon={row.icon} className="fl-icon" />} phrase={row.reason ?? undefined} />
              <Cell label="Djinns here" kind="num">
                <Count n={row.djinns} />
                {row.djinnsLate === 0 ? null : <span className="lt-late">{` ${String(row.djinnsLate)} late`}</span>}
              </Cell>
              {openRuns ? (
                <Cell label="Open runs" kind="num">
                  <Count n={row.openRuns} />
                </Cell>
              ) : null}
              <Cell label="Last run here" kind="time">
                {row.lastRun === null || last === null ? (
                  <Dash />
                ) : (
                  <>
                    <span className={`lt-outcome tone-${last.tone}`}>{last.label}</span> <When iso={row.lastRun.at} />
                  </>
                )}
              </Cell>
            </ListRow>
          );
        })}
      </tbody>
    </ListTable>
  );
}

/** The copies a machine shows: one wrapping line, each the dot, the name as the link, and the health word, small and muted, only when it is not OK. */
export function CopiesLine({ copies }: { copies: readonly CopyRow[] }): React.ReactNode {
  if (copies.length === 0) return <p className="text-muted">It shows no copy.</p>;
  return (
    <ul className="lt-copies">
      {copies.map((copy) => (
        <li key={copy.name} className={`tone-${copy.health.tone}`}>
          <span className="fl-dot" aria-hidden="true" />
          <Link to={href({ to: "overview", ws: copy.name })}>{copy.name}</Link>
          {copy.health.label === "OK" ? <span className="sr-only">, OK</span> : <span className="lt-copy-word">{copy.health.label}</span>}
        </li>
      ))}
    </ul>
  );
}

interface DjinnTableProps {
  djinns: readonly PlacedDjinn[];
  caption: string;
  /** The workspace sits under the title (a machine page) instead of beside it (a block of the Machines page). */
  below?: boolean;
}

/** The djinns that live on a machine: State, Djinn with its workspace, Last run, Next. In the order the caller gives (`sortDjinns`). */
export function DjinnTable({ djinns, caption, below = false }: DjinnTableProps): React.ReactNode {
  const clock = useClock();
  return (
    <ListTable
      caption={caption}
      className="lt-djinns lt-capped"
      columns={[
        { label: "State", kind: "state" },
        { label: "Djinn", kind: "name" },
        { label: "Last run", kind: "time" },
        { label: "Next", kind: "time" },
      ]}
    >
      <tbody>
        {djinns.map((placed) => {
          const { djinn, workspace } = placed;
          const state = djinnStateWord(placed);
          const next = nextText(djinn, clock);
          const last = djinn.lastAt === null ? null : lastRunWord(djinn.lastOutcome);
          const phrase = (
            <>
              {workspace}
              {djinn.why === "pinned" ? <span className="lt-mark"> pinned</span> : null}
            </>
          );
          return (
            <ListRow key={`${workspace}/${djinn.slug}`} rail={railOf(state)}>
              <StateCell state={state} hollow={state.label === "ok"} />
              <NameCell title={djinn.title} to={href({ to: "ritual", ws: workspace, slug: djinn.slug })} phrase={phrase} below={below} />
              <Cell label="Last run" kind="time">
                {djinn.lastAt === null || last === null ? (
                  <Dash />
                ) : djinn.lastRun === null ? (
                  <>
                    <span className={`lt-outcome tone-${last.tone}`}>{last.label}</span> <When iso={djinn.lastAt} />
                  </>
                ) : (
                  <Link to={href({ to: "run", ws: workspace, run: djinn.lastRun })} className="lt-above">
                    <span className={`lt-outcome tone-${last.tone}`}>{last.label}</span> <When iso={djinn.lastAt} />
                  </Link>
                )}
              </Cell>
              <Cell label="Next" kind="time">
                {next === null ? <Dash /> : <span className={next.late ? "lt-late" : undefined} title={djinn.nextDueAt ?? djinn.nextDue ?? undefined}>{next.text}</span>}
              </Cell>
            </ListRow>
          );
        })}
      </tbody>
    </ListTable>
  );
}

/** The projects of the store, the largest first: Workspace, Size, Rituals, Vigils, Runs, Synced. */
export function ProjectsTable({ projects }: { projects: readonly SystemProject[] }): React.ReactNode {
  const sorted = projects.toSorted((left, right) => right.bytes - left.bytes || left.project.localeCompare(right.project));
  return (
    <ListTable
      caption="Projects and syncs, the largest first"
      className="lt-projects lt-capped"
      columns={[
        { label: "Workspace", kind: "name" },
        { label: "Size", kind: "num" },
        { label: "Rituals", kind: "num" },
        { label: "Vigils", kind: "num" },
        { label: "Runs", kind: "num" },
        { label: "Synced", kind: "time" },
      ]}
    >
      <tbody>
        {sorted.map((project) => (
          <ListRow key={project.project}>
            <NameCell title={project.project} to={href({ to: "overview", ws: project.project })} />
            <Cell label="Size" kind="num">
              {byteSize(project.bytes)}
            </Cell>
            <Cell label="Rituals" kind="num">
              <Count n={project.rituals} />
            </Cell>
            <Cell label="Vigils" kind="num">
              <Count n={project.vigils} />
            </Cell>
            <Cell label="Runs" kind="num">
              <Count n={project.runs} />
            </Cell>
            <Cell label="Synced" kind="time">
              {project.lastSync === null ? <span className="lt-muted">never</span> : <When iso={project.lastSync} />}
            </Cell>
          </ListRow>
        ))}
      </tbody>
    </ListTable>
  );
}
