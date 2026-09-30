/** The pieces of the command board: the Next line, the status strip, the Now rows, the Needs you card and the Last night rows. */

import { Link } from "react-router";

import type { MdBlock } from "../../../src/web/api.ts";
import type { NextLine } from "../lib/agenda.ts";
import type { Card, NowRun, Piece, Segment } from "../lib/home.ts";
import { RUNNING } from "../lib/state-words.ts";
import type { Excerpt } from "../lib/view.ts";
import { KindChips } from "./chip.tsx";
import { Command } from "./command.tsx";
import { KindIcon } from "./kind.tsx";
import { Markdown } from "./markdown.tsx";
import { QuestionList } from "./result.tsx";
import { Elapsed, Pill } from "./pulse.tsx";
import { Row, RowList } from "./row.tsx";
import { Fold, Status } from "./ui.tsx";

interface PiecesProps {
  pieces: readonly Piece[];
}

/** Text in parts, each part in its own colour. */
export function Pieces({ pieces }: PiecesProps): React.ReactNode {
  return pieces.map((piece, index) => (
    <span key={`${index}`} className={piece.ink === "plain" ? undefined : `ink-${piece.ink}`}>
      {piece.text}
    </span>
  ));
}

interface ReportProps {
  report: Excerpt;
  /** How many lines of the paragraph show. */
  lines: 2 | 3 | 4;
  fades: boolean;
}

/** A paragraph as one flowing line: an excerpt drops the line breaks of its source. */
function flowing(block: MdBlock): MdBlock {
  if (block.kind !== "paragraph") return block;
  const line = block.lines.flatMap((spans, index) => (index === 0 ? spans : [{ kind: "text" as const, text: " " }, ...spans]));
  return { kind: "paragraph", lines: [line] };
}

/** The first heading of a report in bold, then the start of its first paragraph. */
export function Report({ report, lines, fades }: ReportProps): React.ReactNode {
  return (
    <div className="rep">
      {report.headline === null ? null : <p className="rep-h">{report.headline}</p>}
      {report.blocks.length === 0 ? null : (
        <div className={`rep-p clamp-${lines}${fades ? " fades" : ""}`}>
          <Markdown blocks={report.blocks.map((block) => flowing(block))} />
        </div>
      )}
    </div>
  );
}

interface StatusStripProps {
  segments: readonly Segment[];
}

/** The status strip: the `Pill` segments of the project page, over all projects. Each segment is a link to what it counts. */
export function StatusStrip({ segments }: StatusStripProps): React.ReactNode {
  if (segments.length === 0) return null;
  return (
    <nav className="pulse pulse-home" aria-label="Summary">
      {segments.map((segment) => (
        <Pill key={segment.key} label={segment.label} value={segment.count} tone={segment.tone} href={segment.href} live={segment.live} kind={segment.kind} />
      ))}
    </nav>
  );
}

interface NowListProps {
  runs: readonly NowRun[];
}

/** One row per run that runs now, with its project, how long it has run and the sweeping light. */
export function NowList({ runs }: NowListProps): React.ReactNode {
  return (
    <RowList>
      {runs.map((run) => (
        <Row
          key={run.id}
          kind={run.kind}
          href={run.href}
          title={run.title}
          rail="run"
          live
          chips={<KindChips kind={run.kind} manual={run.manual} />}
          state={RUNNING}
          meta={[run.project, run.who === "timer" ? "by timer" : `by ${run.who}`]}
          time={
            <>
              for <Elapsed since={run.startedAt} />
            </>
          }
        />
      ))}
    </RowList>
  );
}

interface NextUpProps {
  next: NextLine;
}

/** "Next ⟳ Daily site report · tomorrow": one link under the verdict to the first item that is not late. */
export function NextUp({ next }: NextUpProps): React.ReactNode {
  return (
    <Link to={next.href} className="nextup">
      <span className="nextup-l">Next</span>
      <KindIcon kind={next.kind} className="nextup-icon" />
      <span className="nextup-t">{next.title}</span>
      <span className={next.isToday ? "nextup-w is-today" : "nextup-w"}>{next.when}</span>
    </Link>
  );
}

interface DoneRowsProps {
  cards: readonly Card[];
}

/** The Last night rows: what finished, as rows. The row opens the report; a desktop shows an excerpt under it. */
export function DoneRows({ cards }: DoneRowsProps): React.ReactNode {
  return (
    <RowList>
      {cards.map((card) => (
        <Row
          key={card.id}
          id={card.id}
          kind={card.item ?? "ritual"}
          href={card.href}
          title={card.title}
          chips={card.item === null ? undefined : <KindChips kind={card.item} manual={card.manual} />}
          state={card.word.ink === "plain" || card.word.ink === "mute" ? null : { tone: card.word.ink, label: card.word.text }}
          meta={card.meta}
          time={card.side === null ? undefined : card.side.text}
          acts={card.actions[0] === undefined ? undefined : <Link to={card.actions[0].href}>{card.actions[0].text}</Link>}
          note={card.meta2}
          excerpt={card.report === null ? undefined : <Report report={card.report} lines={2} fades={false} />}
        />
      ))}
    </RowList>
  );
}

interface CommandsProps {
  card: Card;
}

/** The commands of a card, closed under one line: a phone reads the question first and types the answer at a terminal. */
function Commands({ card }: CommandsProps): React.ReactNode {
  if (card.ask !== null) {
    return (
      <Fold summary="Answer from a terminal">
        <p className="hc-cmd-label">Record your decision:</p>
        <Command command={card.ask.command} />
      </Fold>
    );
  }
  if (card.questions.length === 0) return null;
  return (
    <Fold summary="Answer from a terminal">
      {card.questions.map((question, index) => (
        <div key={`${index}`} className="hc-cmd">
          {card.questions.length === 1 ? null : <p className="hc-cmd-label">Question {index + 1}</p>}
          <Command command={question.command} />
        </div>
      ))}
    </Fold>
  );
}

interface CardViewProps {
  card: Card;
}

/**
 * A Needs you card, or a plain Last night card when it has no edge. The head
 * (the status word, the age, the title and the meta line) is one tap target
 * to the run; the questions stay plain text and the commands wait in a
 * closed disclosure.
 */
export function CardView({ card }: CardViewProps): React.ReactNode {
  const edge = card.edge === null ? "card-plain" : `card-accent edge-${card.edge}`;
  const hasBody = card.questions.length > 0 || card.ask !== null || card.report !== null || card.error !== null || card.kind === "held";
  return (
    <article id={card.id} className={`card hcard ${edge}`}>
      <div className="hc-head">
        <div className="hc-main">
          <h3 className={card.item === null ? "card-title" : "card-title has-kind-flex"}>
            {card.item === null ? null : <KindIcon kind={card.item} titled />}
            <Link to={card.href}>{card.title}</Link>
          </h3>
          <p className="card-meta rw-line">
            {card.item === null ? null : (
              <span className="rw-seg rw-chips">
                <KindChips kind={card.item} manual={card.manual} />
              </span>
            )}
            <span className="rw-seg rw-meta">{card.meta.join(", ")}</span>
          </p>
          {card.meta2 === null ? null : <p className="card-meta">{card.meta2}</p>}
        </div>
        <div className="hc-side">
          {card.word.ink === "plain" || card.word.ink === "mute" ? null : <Status tone={card.word.ink} label={card.word.text} />}
          {card.side === null ? null : <span className={`card-when${card.side.ink === "plain" ? "" : ` ink-${card.side.ink}`}`}>{card.side.text}</span>}
        </div>
      </div>
      {hasBody ? (
        <div className="hc-body">
          {card.kind === "held" && card.questions.length === 0 ? <p className="empty">The run is held without a question. Resume or close it from the command line.</p> : null}
          {card.questions.length === 0 ? null : (
            <ol className="qs">
              {card.questions.map((question, index) => (
                <li key={`${index}`}>
                  <p>{question.text}</p>
                </li>
              ))}
            </ol>
          )}
          {card.ask === null ? null : card.ask.questions.length === 0 ? <p className="empty">Open the run to read its questions.</p> : <QuestionList questions={card.ask.questions} />}
          <Commands card={card} />
          {card.report === null ? null : <Report report={card.report} lines={card.edge === null ? 3 : 4} fades={card.fades} />}
          {card.error === null ? null : <pre className="code-block">{card.error}</pre>}
        </div>
      ) : null}
      <div className="hc-acts">
        {card.actions.map((action) => (
          <Link key={action.text} to={action.href}>
            {action.text}
          </Link>
        ))}
      </div>
    </article>
  );
}
