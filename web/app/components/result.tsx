/**
 * A run's result block (0.22.0) on the run page: the status banner, the
 * metric tiles, the questions for the operator, the items by group and the
 * actions. Every text in a result is untrusted plain text: it is rendered
 * as text only, never as markdown, HTML or a link.
 */

import type { ResultAction, ResultItem, ResultMetric, ResultQuestion, RunResult, RunResultSummary, RunRow } from "../../../src/web/api.ts";
import { useClock } from "../lib/clock.tsx";
import { decideCommand } from "../lib/format.ts";
import { actionTag, groupItems, itemStateTag, itemsText, metricTag, resultTone, resultWord, severityTone, summaryTags, type TagSpec } from "../lib/result.ts";
import { decisionText } from "../lib/view.ts";
import { Command } from "./command.tsx";
import { Fold, Section, Status } from "./ui.tsx";

interface TagProps {
  tag: TagSpec;
}

/** A small word in a box, in its tone. The word carries the meaning; the colour only repeats it. */
export function Tag({ tag }: TagProps): React.ReactNode {
  return <span className={tag.tone === null ? "tag" : `tag tone-${tag.tone}`}>{tag.text}</span>;
}

interface ResultTagsProps {
  summary: RunResultSummary | null;
  /** Someone answered the questions (`darius run ack`). */
  isAnswered: boolean;
}

/** The tags of a run row: open critical and high items, and the questions. Nothing when there is nothing to say. */
export function ResultTags({ summary, isAnswered }: ResultTagsProps): React.ReactNode {
  const tags = summary === null ? [] : summaryTags(summary, isAnswered);
  if (tags.length === 0) return null;
  return (
    <span className="tags">
      {tags.map((tag) => (
        <Tag key={tag.text} tag={tag} />
      ))}
    </span>
  );
}

interface QuestionListProps {
  questions: readonly ResultQuestion[];
}

/** The questions of a result, numbered, each with its recommendation. */
export function QuestionList({ questions }: QuestionListProps): React.ReactNode {
  return (
    <ol className="qs">
      {questions.map((question, index) => (
        <li key={`${index}`}>
          <p>{question.text}</p>
          {question.recommendation === undefined ? null : (
            <p className="rec">
              <span className="rec-label">Recommended:</span> {question.recommendation}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

interface ResultQuestionsProps {
  project: string;
  row: RunRow;
  questions: readonly ResultQuestion[];
}

/**
 * The "Questions for you" card. A complete run waits for the operator's
 * decision: the card gives the command that records it. Once someone
 * acknowledged the run, the card says who, when, and what they decided.
 */
export function ResultQuestions({ project, row, questions }: ResultQuestionsProps): React.ReactNode {
  const clock = useClock();
  const seen = row.acknowledged;
  const isWaiting = seen === null && row.phase === "closed" && row.outcome === "complete";
  return (
    <div className={`card card-accent next ${isWaiting ? "edge-wait" : "edge-idle"}`}>
      <QuestionList questions={questions} />
      {seen === null ? null : <p>{decisionText(seen, clock)}</p>}
      {isWaiting ? (
        <div className="next-cmd">
          <p>Record your decision:</p>
          <Command command={decideCommand(row.run, project)} />
        </div>
      ) : null}
    </div>
  );
}

interface TilesProps {
  metrics: readonly ResultMetric[];
}

function Tiles({ metrics }: TilesProps): React.ReactNode {
  return (
    <dl className="tiles">
      {metrics.map((metric, index) => {
        const tone = metric.tone === undefined ? null : metricTag(metric.tone);
        return (
          <div key={`${index}`} className={tone === null ? "tile" : `tile tone-${tone.tone}`}>
            <dt className="tile-l">{metric.label}</dt>
            <dd className="tile-v">
              {String(metric.value)}
              {metric.unit === undefined ? null : <span className="tile-u">{metric.unit}</span>}
            </dd>
            {tone === null ? null : (
              <dd className="tile-t">
                <Status tone={tone.tone} label={tone.word} />
              </dd>
            )}
          </div>
        );
      })}
    </dl>
  );
}

interface ItemRowProps {
  item: ResultItem;
}

function ItemRow({ item }: ItemRowProps): React.ReactNode {
  return (
    <li className={item.state === "fixed" ? "ritem ritem-done" : "ritem"}>
      <span className="ritem-sev">
        <Tag tag={{ text: item.severity, tone: severityTone(item.severity) }} />
      </span>
      <div className="ritem-main">
        <p className="ritem-title">{item.title}</p>
        {item.target === undefined ? null : <p className="ritem-sub">{item.target}</p>}
        {item.detail === undefined ? null : (
          <Fold summary="Detail">
            <p className="ritem-detail">{item.detail}</p>
          </Fold>
        )}
      </div>
      <span className="ritem-state">
        <Tag tag={itemStateTag(item.state)} />
      </span>
    </li>
  );
}

interface ItemsProps {
  items: readonly ResultItem[];
}

/** The items by group, the worst first in each; the items without a group last. */
function Items({ items }: ItemsProps): React.ReactNode {
  const groups = groupItems(items);
  const isNamed = groups.some((group) => group.name !== null);
  return (
    <div className="rgroups">
      {groups.map((group) => (
        <div key={group.name === null ? "loose" : `group-${group.name}`} className="rgroup">
          {isNamed ? <h3 className="rgroup-h">{group.name ?? "Other items"}</h3> : null}
          <ul className="rows">
            {group.items.map((item, index) => (
              <ItemRow key={`${index}`} item={item} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

interface ActionsProps {
  actions: readonly ResultAction[];
}

function Actions({ actions }: ActionsProps): React.ReactNode {
  return (
    <ul className="rows">
      {actions.map((action, index) => (
        <li key={`${index}`} className="ritem ritem-act">
          <div className="ritem-main">
            <p className="ritem-title">{action.text}</p>
            {action.target === undefined ? null : <p className="ritem-sub">{action.target}</p>}
          </div>
          <span className="ritem-state">
            <Tag tag={actionTag(action.state)} />
          </span>
        </li>
      ))}
    </ul>
  );
}

interface ResultPanelProps {
  project: string;
  row: RunRow;
  result: RunResult;
}

/** The top of a run page that handed in a result: the banner and tiles, the questions, the items, the actions. */
export function ResultPanel({ project, row, result }: ResultPanelProps): React.ReactNode {
  const tone = resultTone(result.status);
  return (
    <>
      <Section title="Result">
        <div className={`card card-accent result-banner edge-${tone}`}>
          <Status tone={tone} label={resultWord(result.status)} />
          <p className="result-summary">{result.summary}</p>
          {result.handoff === undefined ? null : <p className="rail-note">Note for the next run: {result.handoff}</p>}
        </div>
        {result.metrics.length === 0 ? null : <Tiles metrics={result.metrics} />}
      </Section>

      {result.questions.length === 0 ? null : (
        <Section title="Questions for you">
          <ResultQuestions project={project} row={row} questions={result.questions} />
        </Section>
      )}

      {result.items.length === 0 ? null : (
        <Section title="What it found" aside={<span className="text-muted">{itemsText(result.items)}</span>}>
          <Items items={result.items} />
        </Section>
      )}

      {result.actions.length === 0 ? null : (
        <Section title="What it changed">
          <Actions actions={result.actions} />
        </Section>
      )}
    </>
  );
}
