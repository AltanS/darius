/** The pieces of the command board: the status strip, the Now rows, the Needs you card and the djinn and Up next lists. */

import { Link } from "react-router";

import type { MdBlock } from "../../../src/web/api.ts";
import type { Card, DjinnLine, MoreLink, NowRun, Piece, Segment } from "../lib/home.ts";
import type { Excerpt } from "../lib/view.ts";
import { Command } from "./command.tsx";
import { Markdown } from "./markdown.tsx";
import { QuestionList } from "./result.tsx";
import { Elapsed, Pill } from "./pulse.tsx";
import { Fold, Status, Word } from "./ui.tsx";

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
  lines: 3 | 4;
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
  return (
    <nav className="pulse pulse-home" aria-label="Summary">
      {segments.map((segment) => (
        <Pill key={segment.key} label={segment.label} value={segment.count} tone={segment.tone} href={segment.href} live={segment.live} />
      ))}
    </nav>
  );
}

interface NowListProps {
  runs: readonly NowRun[];
}

/** One compact row per run that runs now, with its project, how long it has run and the sweeping light. */
export function NowList({ runs }: NowListProps): React.ReactNode {
  return (
    <ul className="rows now-rows">
      {runs.map((run) => (
        <li key={run.id}>
          <Link to={run.href} className="row row-live now-row">
            <span className="live-bar" aria-hidden="true" />
            <span className="row-main">
              <span className="row-title">{run.title}</span>
              <span className="row-sub">
                {run.project}, <Elapsed since={run.startedAt} />, {run.who === "timer" ? "by timer" : `by ${run.who}`}
              </span>
            </span>
            <Status tone="run" label="Running" />
          </Link>
        </li>
      ))}
    </ul>
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
          <h3 className="card-title">
            <Link to={card.href}>{card.title}</Link>
          </h3>
          <p className="card-meta">{card.meta}</p>
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

interface LineListProps {
  label: string;
  lines: readonly DjinnLine[];
  empty: string;
  more?: readonly MoreLink[];
}

/** One row per line: a square in its state colour, its title, and its state in one line. Each row is a 44 px link. */
export function LineList({ label, lines, empty, more = [] }: LineListProps): React.ReactNode {
  return (
    <section className="panel" aria-label={label}>
      {lines.length === 0 ? (
        <p className="panel-empty">{empty}</p>
      ) : (
        <ul className="djinns">
          {lines.map((line) => (
            <li key={line.key} className={`djinn tone-${line.tone}`}>
              <span className="djinn-sq" aria-hidden="true" />
              <div className="min-w-0">
                <Link to={line.href} className="djinn-title">
                  {line.title}
                </Link>
                <p className="djinn-line">
                  <span className="djinn-word">
                    <Word text={line.word} />
                  </span>
                  {line.detail.length === 0 ? null : (
                    <span>
                      <Pieces pieces={line.detail} />
                    </span>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {more.length === 0 ? null : (
        <div className="more">
          {more.map((entry) => (
            <Link key={entry.project} to={entry.href}>
              {entry.count} more in {entry.project}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
