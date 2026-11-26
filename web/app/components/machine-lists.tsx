/**
 * The lists of the machine pages (0.142.0, reworked in 0.143.0): what needs
 * a look, the workspaces a machine runs, the copies it keeps, the rituals
 * on schedule there, the words the page uses, and the projects of the store
 * with their sync. The Machines page and a machine page draw the same rows.
 */

import { Link } from "react-router";

import type { SystemProject } from "../../../src/web/api.ts";
import { useClock } from "../lib/clock.tsx";
import { byteSize, clockTime, dayName, zoneName } from "../lib/format.ts";
import { fullMoment, lastRunWord, nextText, type CopyRow, type PlacedRitual, type RunsHereRow } from "../lib/lists.ts";
import { glossedTerms, needParts, reasonParts, type LookItem, type LookKind, type ReasonParts } from "../lib/look.ts";
import { href } from "../lib/paths.ts";
import { definitionPieces, LABELS, MACHINE_PAGE_TERMS, TERMS, type TermKey } from "../lib/terms.ts";
import type { Badge } from "../lib/tone.ts";
import { Cell, Count, Dash, ListRow, ListTable, NameCell, StateCell, When } from "./list-table.tsx";
import { Parts } from "./sentence.tsx";
import { WorkspaceGlyph } from "./workspace-icon.tsx";

// --- what needs a look --------------------------------------------------------------------------

const LOOK_TONES = { waits: "wait", failed: "bad", late: "late", machine: "late" } as const satisfies Record<LookKind, string>;

/** A shape per kind, so two kinds never differ by hue alone: a round question, a clock, a cross, a triangle, a screen. */
function LookIcon({ kind }: { kind: LookKind }): React.ReactNode {
  const glyph = {
    waits: (
      <>
        <circle cx="8" cy="8" r="6.5" />
        <path d="M6 6.2a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6.9v.6" />
        <circle cx="8" cy="11.6" r=".4" />
      </>
    ),
    late: (
      <>
        <circle cx="8" cy="8" r="6.5" />
        <path d="M8 4.2V8l2.6 1.6" />
      </>
    ),
    failed: (
      <>
        <rect x="1.5" y="1.5" width="13" height="13" />
        <path d="M5.2 5.2l5.6 5.6M10.8 5.2l-5.6 5.6" />
      </>
    ),
    machine: (
      <>
        <rect x="1.5" y="2.5" width="13" height="9" />
        <path d="M5 14h6M8 11.5V14" />
      </>
    ),
  }[kind];
  return (
    <svg className="nl-icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" aria-hidden="true">
      {glyph}
    </svg>
  );
}

/** One item: the icon, the lead word in its state colour, the sentence with the cause and the command, then the next step as a small button at the right end. The button covers the whole item. */
function LookEntry({ item }: { item: LookItem }): React.ReactNode {
  return (
    <li id={item.id} className={`nl-item tone-${LOOK_TONES[item.kind]}`}>
      <LookIcon kind={item.kind} />
      <p className="nl-text">
        <strong className="nl-lead">{`${item.lead}: `}</strong>
        <Parts parts={item.parts} linkClass="nl-above" />
        {item.command === null ? null : (
          <>
            {" Run "}
            <code className="nl-above">{item.command}</code>.
          </>
        )}
      </p>
      {item.action === null ? null : (
        <Link to={href(item.action.to)} className="nl-action">
          {item.action.text}
        </Link>
      )}
    </li>
  );
}

/** Definitions in body text, each defined word in semibold so the eye finds it: "A **ritual** is ...". */
export function Definitions({ terms, className }: { terms: readonly TermKey[]; className: string }): React.ReactNode {
  if (terms.length === 0) return null;
  return (
    <p className={className}>
      {terms.map((key, index) => {
        const { lead, word, rest } = definitionPieces(key);
        return (
          <span key={key}>
            {index === 0 ? lead : ` ${lead}`}
            <strong className="def-word">{word}</strong>
            {rest}
          </span>
        );
      })}
    </p>
  );
}

/** The words the items use, explained once before them: "A sandbox check is ...". */
function Gloss({ terms }: { terms: readonly TermKey[] }): React.ReactNode {
  return <Definitions terms={terms} className="def-line nl-help" />;
}

function LookGroup({ title, items }: { title: string; items: readonly LookItem[] }): React.ReactNode {
  if (items.length === 0) return null;
  return (
    <div className="nl-group">
      <h3 className="lt-head nl-head">
        <span className="lt-head-title">{`${title} (${String(items.length)})`}</span>
      </h3>
      <Gloss terms={glossedTerms(items)} />
      <ul className="nl-list">
        {items.map((item) => (
          <LookEntry key={item.id} item={item} />
        ))}
      </ul>
    </div>
  );
}

/**
 * What needs a look on a machine: "Rituals that need a look (n)" and, only
 * when there is something, "This machine (n)". Each count is the number of
 * rows right under it. With nothing, one muted line.
 */
export function LookList({ items }: { items: readonly LookItem[] }): React.ReactNode {
  if (items.length === 0) return <p className="nl-none">{LABELS.nothingHere}</p>;
  return (
    <div className="nl">
      <LookGroup title={LABELS.ritualsLook} items={items.filter((item) => item.kind !== "machine")} />
      <LookGroup title={LABELS.thisMachine} items={items.filter((item) => item.kind === "machine")} />
    </div>
  );
}

// --- the workspaces a machine runs -------------------------------------------------------------

/** A last run: the word and the time, muted; with `colour`, a word other than complete keeps its tone. */
function LastRun({ word, iso, colour }: { word: Badge; iso: string; colour: boolean }): React.ReactNode {
  const quiet = !colour || word.label === "complete";
  return (
    <>
      <span className={quiet ? "lt-word-muted" : `lt-outcome tone-${word.tone}`}>{word.label}</span> <When iso={iso} />
    </>
  );
}

/** What the Why cell of a row says: what its need-you count is made of, or its health reasons when nothing needs you. */
function whyOf(row: RunsHereRow): ReasonParts {
  return row.needs > 0 ? needParts(row.needParts, row.name) : reasonParts(row.reasons, row.name);
}

/**
 * The Why of a workspace. When something needs you: the count of its badge
 * in Places and exactly what it is made of, the parts summing to it, each a
 * link. Else its three worst health reasons, then "and n more", a link to
 * the workspace with every reason in its title.
 */
function WhyText({ row }: { row: RunsHereRow }): React.ReactNode {
  const { parts, more } = whyOf(row);
  return (
    <>
      <Parts parts={parts} linkClass="lt-above lt-why-link" />
      {more === 0 ? null : (
        <>
          {" and "}
          <Link to={href({ to: "overview", ws: row.name })} className="lt-above lt-why-link" title={row.reasons.join(", ")}>{`${String(more)} more`}</Link>
        </>
      )}
    </>
  );
}

/** The words the rows use, explained right under the heading of the table, before the rows: vigil, candle, finding. */
export function TableGloss({ rows }: { rows: readonly RunsHereRow[] }): React.ReactNode {
  const used = new Set(rows.flatMap((row) => whyOf(row).glossed));
  return <Definitions terms={MACHINE_PAGE_TERMS.filter((key) => used.has(key))} className="def-line lt-gloss" />;
}

interface RunsHereProps {
  rows: readonly RunsHereRow[];
  /** Show the Open runs column (a machine page). */
  openRuns?: boolean;
  caption: string;
}

/** The workspaces a machine runs: Health, Workspace, Why, Rituals, (Open runs,) Last run. The health word is the only colour in a row. */
export function RunsHereTable({ rows, openRuns = false, caption }: RunsHereProps): React.ReactNode {
  return (
    <ListTable
      caption={caption}
      className="lt-ws lt-capped"
      columns={[
        { label: LABELS.columnHealth, kind: "state" },
        { label: LABELS.columnWorkspace, kind: "name" },
        { label: LABELS.columnWhy, kind: "text" },
        { label: LABELS.columnRituals, kind: "num" },
        ...(openRuns ? [{ label: LABELS.columnOpenRuns, kind: "num" } as const] : []),
        { label: LABELS.columnLastRun, kind: "time" },
      ]}
    >
      <tbody>
        {rows.map((row) => (
          <ListRow key={row.name}>
            <StateCell state={row.health} />
            <NameCell title={row.name} to={href({ to: "overview", ws: row.name })} lead={<WorkspaceGlyph icon={row.icon} className="fl-icon" />} />
            <Cell label={LABELS.columnWhy} wrap>
              {row.reasons.length === 0 && row.needs === 0 ? null : <WhyText row={row} />}
            </Cell>
            <Cell label={LABELS.columnRituals} kind="num">
              {row.rituals === 0 ? <span className="lt-muted">none</span> : <span className="lt-n">{row.rituals}</span>}
            </Cell>
            {openRuns ? (
              <Cell label={LABELS.columnOpenRuns} kind="num">
                <Count n={row.openRuns} />
              </Cell>
            ) : null}
            <Cell label={LABELS.columnLastRun} kind="time">
              {row.lastRun === null || row.lastWord === null ? <Dash title={LABELS.noRunYet} /> : <LastRun word={row.lastWord} iso={row.lastRun.at} colour={false} />}
            </Cell>
          </ListRow>
        ))}
      </tbody>
    </ListTable>
  );
}

/** The copies a machine keeps: one wrapping line, each the dot, the name as the link, and the health word, small and muted, only when it is not OK. */
export function CopiesLine({ copies }: { copies: readonly CopyRow[] }): React.ReactNode {
  if (copies.length === 0) return <p className="text-muted">{`It keeps no ${TERMS.copy.word}.`}</p>;
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

// --- the rituals on schedule -----------------------------------------------------------------------

interface OnScheduleProps {
  rituals: readonly PlacedRitual[];
  caption: string;
}

/** The rituals on schedule: Ritual, Workspace, Last run, Next. No state column: the ones with a problem are under Needs a look. Titles wrap. */
export function OnScheduleTable({ rituals, caption }: OnScheduleProps): React.ReactNode {
  const clock = useClock();
  return (
    <ListTable
      caption={caption}
      className="lt-rituals lt-capped"
      columns={[
        { label: LABELS.columnRitual, kind: "name" },
        { label: LABELS.columnWorkspace, kind: "text" },
        { label: LABELS.columnLastRun, kind: "time" },
        { label: LABELS.columnNext, kind: "time" },
      ]}
    >
      <tbody>
        {rituals.map((placed) => {
          const { ritual, workspace } = placed;
          const next = nextText(ritual, clock);
          const word = ritual.lastAt === null ? null : lastRunWord(ritual.state === "running" ? null : ritual.lastOutcome, ritual.state === "running" ? "running" : null);
          return (
            <ListRow key={`${workspace}/${ritual.slug}`}>
              <NameCell title={ritual.title} to={href({ to: "ritual", ws: workspace, slug: ritual.slug })} wrap />
              <Cell label={LABELS.columnWorkspace}>
                <span className="lt-ws-name">{workspace}</span>
              </Cell>
              <Cell label={LABELS.columnLastRun} kind="time">
                {ritual.lastAt === null || word === null ? (
                  <Dash title={LABELS.noRunYet} />
                ) : ritual.lastRun === null ? (
                  <LastRun word={word} iso={ritual.lastAt} colour />
                ) : (
                  <Link to={href({ to: "run", ws: workspace, run: ritual.lastRun })} className="lt-above">
                    <LastRun word={word} iso={ritual.lastAt} colour />
                  </Link>
                )}
              </Cell>
              <Cell label={LABELS.columnNext} kind="time">
                {next === null ? (
                  <Dash title="no schedule" />
                ) : (
                  <span className={next.late ? "lt-late" : undefined} title={next.title ?? undefined}>
                    {next.text}
                  </span>
                )}
              </Cell>
            </ListRow>
          );
        })}
      </tbody>
    </ListTable>
  );
}

// --- the words and the clock of the page -------------------------------------------------------------

/** "What do these words mean?": the terms the page uses, closed by default. */
export function TermsHelp({ terms }: { terms: readonly TermKey[] }): React.ReactNode {
  return (
    <details className="terms">
      <summary>{LABELS.termsSummary}</summary>
      <dl className="terms-list">
        {terms.map((key) => (
          <div key={key}>
            <dt>{TERMS[key].word}</dt>
            <dd>{TERMS[key].definition}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** The anchor of every time on the page: its zone and the time now. */
export function TimeNote(): React.ReactNode {
  const { now, offset } = useClock();
  const iso = new Date(now).toISOString();
  const day = dayName(iso, offset).split(" ")[0] ?? "";
  return (
    <p className="time-note">
      {`Times are in ${zoneName(offset)}, the zone of the machine that serves this page; now `}
      <time dateTime={iso} title={fullMoment(iso, offset)}>{`${day} ${clockTime(iso, offset)}`}</time>.
    </p>
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
