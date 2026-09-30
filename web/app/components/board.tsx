/** The pieces of the command board: the Needs you card, the Watch gauges and the djinn list. */

import { Link } from "react-router";

import type { MdBlock } from "../../../src/web/api.ts";
import type { Card, DjinnLine, Gauge, Piece } from "../lib/home.ts";
import type { Excerpt } from "../lib/view.ts";
import { Command } from "./command.tsx";
import { Markdown } from "./markdown.tsx";
import { QuestionList } from "./result.tsx";
import { Status, Word } from "./ui.tsx";

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

interface CardViewProps {
  card: Card;
}

/** A Needs you card, or a plain Last night card when it has no edge. */
export function CardView({ card }: CardViewProps): React.ReactNode {
  const edge = card.edge === null ? "card-plain" : `card-accent edge-${card.edge}`;
  const hasBody = card.questions.length > 0 || card.ask !== null || card.report !== null || card.error !== null || card.kind === "held";
  return (
    <article id={card.id} className={`card card-grid ${edge}`}>
      <div className="card-main">
        <h3 className="card-title">
          <Link to={card.href}>{card.title}</Link>
        </h3>
        <p className="card-meta">{card.meta}</p>
        {card.meta2 === null ? null : <p className="card-meta">{card.meta2}</p>}
      </div>
      <div className="card-side">
        {card.word.ink === "plain" || card.word.ink === "mute" ? null : <Status tone={card.word.ink} label={card.word.text} />}
        {card.side === null ? null : (
          <span className={`card-when${card.side.ink === "plain" ? "" : ` ink-${card.side.ink}`}`}>{card.side.text}</span>
        )}
      </div>
      {hasBody ? (
        <div className="card-body">
          {card.kind === "held" && card.questions.length === 0 ? <p className="empty">The run is held without a question. Resume or close it from the command line.</p> : null}
          {card.questions.length === 0 ? null : (
            <ol className="qs">
              {card.questions.map((question, index) => (
                <li key={`${index}`}>
                  <p>{question.text}</p>
                  <Command command={question.command} />
                </li>
              ))}
            </ol>
          )}
          {card.ask === null ? null : (
            <div className="next">
              {card.ask.questions.length === 0 ? <p className="empty">Open the run to read its questions.</p> : <QuestionList questions={card.ask.questions} />}
              <div className="next-cmd">
                <p>Record your decision:</p>
                <Command command={card.ask.command} />
              </div>
            </div>
          )}
          {card.report === null ? null : <Report report={card.report} lines={card.edge === null ? 3 : 4} fades={card.fades} />}
          {card.error === null ? null : <pre className="code-block">{card.error}</pre>}
        </div>
      ) : null}
      <div className="card-acts">
        {card.actions.map((action) => (
          <Link key={action.text} to={action.href}>
            {action.text}
          </Link>
        ))}
      </div>
    </article>
  );
}

interface GaugesProps {
  gauges: readonly Gauge[];
}

/** The Watch panel: five small gauges, one row each; a 2 by 3 grid on a phone. */
export function Gauges({ gauges }: GaugesProps): React.ReactNode {
  return (
    <section className="panel" aria-label="Watch">
      <dl className="gauges">
        {gauges.map((gauge) => (
          <div key={gauge.label} className="gauge">
            <dt className="label">{gauge.label}</dt>
            <dd className="gauge-v">
              {gauge.href === undefined ? (
                <Pieces pieces={gauge.value} />
              ) : gauge.href.startsWith("#") ? (
                <a href={gauge.href} className="gauge-link">
                  <Pieces pieces={gauge.value} />
                </a>
              ) : (
                <Link to={gauge.href} className="gauge-link">
                  <Pieces pieces={gauge.value} />
                </Link>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

interface DjinnListProps {
  djinns: readonly DjinnLine[];
}

/** One row per djinn: a square in its state colour, its title, and its state in one line. */
export function DjinnList({ djinns }: DjinnListProps): React.ReactNode {
  return (
    <section className="panel" aria-label="Djinns">
      {djinns.length === 0 ? (
        <p className="panel-empty">No djinn yet. Give a ritual a repo skill with --skill.</p>
      ) : (
        <ul className="djinns">
          {djinns.map((djinn) => (
            <li key={djinn.key} className={`djinn tone-${djinn.tone}`}>
              <span className="djinn-sq" aria-hidden="true" />
              <div className="min-w-0">
                <Link to={djinn.href} className="djinn-title">
                  {djinn.title}
                </Link>
                <p className="djinn-line">
                  <span className="djinn-word">
                    <Word text={djinn.word} />
                  </span>
                  {djinn.detail.length === 0 ? null : (
                    <span>
                      <Pieces pieces={djinn.detail} />
                    </span>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
