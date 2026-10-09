/**
 * A run's result block (0.22.0) on the run page: the status banner, the
 * metric tiles, the questions for the operator, the items by group and the
 * actions. Every text in a result is untrusted plain text: it is rendered
 * as text only, never as markdown, HTML or a link.
 */

import type { ResultAction, ResultItem, ResultMetric, ResultProposal, ResultQuestion, RunResult, RunResultSummary, RunRow } from "../../../src/web/api.ts";
import { useClock } from "../lib/clock.tsx";
import { decideCommand } from "../lib/format.ts";
import { actionTag, groupItems, itemStateTag, itemsText, metricTag, resultTone, resultWord, severityTone, summaryTags, type TagSpec } from "../lib/result.ts";
import { decisionText } from "../lib/view.ts";
import { AskForm } from "./ask-form.tsx";
import { Chip } from "./chip.tsx";
import { Command } from "./command.tsx";
import { QuestionList } from "./questions.tsx";
import { Fold, Section, Status } from "./ui.tsx";

interface TagProps {
  tag: TagSpec;
}

/** A small word in a chip, in its tone. The word carries the meaning; the colour only repeats it. */
export function Tag({ tag }: TagProps): React.ReactNode {
  return <Chip color={tag.tone ?? "idle"}>{tag.text}</Chip>;
}

interface ResultChipsProps {
  summary: RunResultSummary;
  /** Someone answered the questions (`darius run ack`). */
  isAnswered: boolean;
}

/** The chips of a run row: open critical and high items, and the questions. */
export function ResultChips({ summary, isAnswered }: ResultChipsProps): React.ReactNode {
  return summaryTags(summary, isAnswered).map((tag) => <Tag key={tag.text} tag={tag} />);
}

interface ResultQuestionsProps {
  project: string;
  row: RunRow;
  questions: readonly ResultQuestion[];
  /** False for the loopback viewer: the answer form does not draw. */
  canWrite: boolean;
  /** When an answer takes effect, in words (`nextRunText`). */
  nextRun: string;
  /** The run is a ritual run, so "Send and run now" can start the ritual. */
  canRunNow: boolean;
}

/**
 * The "Questions for you" card. A complete run waits for the operator's
 * answer: one box per question, "Send answer", "Send and run now" and
 * "Dismiss, no action" (0.80.0, `AskForm`), and the command that records
 * the same answer from a terminal. Once someone acknowledged the run, the
 * card says who, when, and what they decided.
 */
export function ResultQuestions({ project, row, questions, canWrite, nextRun, canRunNow }: ResultQuestionsProps): React.ReactNode {
  const clock = useClock();
  const seen = row.acknowledged;
  const isWaiting = seen === null && row.phase === "closed" && row.outcome === "complete";
  return (
    <div className={`card card-accent next ${isWaiting ? "edge-wait" : "edge-idle"}`}>
      {isWaiting ? <AskForm key={row.run} project={project} run={row.run} questions={questions} canWrite={canWrite} nextRun={nextRun} canRunNow={canRunNow} subject="the questions of this run" /> : <QuestionList questions={questions} />}
      {seen === null ? null : <p>{decisionText(seen, clock)}</p>}
      {isWaiting ? (
        <div className="next-cmd">
          <p>{canWrite ? "Or answer from a terminal:" : "Record your answer:"}</p>
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

interface ProposalViewProps {
  proposal: ResultProposal;
}

/**
 * The change a needs-decision item proposes (0.69.0): the current text and
 * the proposed text as two labelled blocks, side by side on a wide screen
 * and one under the other on a phone, then why and the expected effect.
 * Plain text: newlines stay, nothing becomes markup.
 */
export function ProposalView({ proposal }: ProposalViewProps): React.ReactNode {
  return (
    <div className="proposal">
      <div className={proposal.current === undefined ? "proposal-pair proposal-one" : "proposal-pair"}>
        {proposal.current === undefined ? null : (
          <div className="proposal-block">
            <p className="proposal-label">Current</p>
            <p className="proposal-text">{proposal.current}</p>
          </div>
        )}
        <div className="proposal-block">
          <p className="proposal-label">Proposed</p>
          <p className="proposal-text proposal-new">{proposal.proposed}</p>
        </div>
      </div>
      {proposal.why === undefined ? null : (
        <p className="proposal-note">
          <span className="rec-label">Why:</span> {proposal.why}
        </p>
      )}
      {proposal.effect === undefined ? null : (
        <p className="proposal-note">
          <span className="rec-label">Expected effect:</span> {proposal.effect}
        </p>
      )}
    </div>
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
        {item.key === undefined ? null : <p className="ritem-key">{`key ${item.key}`}</p>}
        {item.detail === undefined ? null : (
          <Fold summary="Detail">
            <p className="ritem-detail">{item.detail}</p>
          </Fold>
        )}
        {item.proposal === undefined ? null : (
          <Fold summary="Proposal">
            <ProposalView proposal={item.proposal} />
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
export function Items({ items }: ItemsProps): React.ReactNode {
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

export function Actions({ actions }: ActionsProps): React.ReactNode {
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
  /** False for the loopback viewer: the answer form does not draw. */
  canWrite: boolean;
  /** When an answer takes effect, in words (`nextRunText`). */
  nextRun: string;
  /** The run is a ritual run, so "Send and run now" can start the ritual. */
  canRunNow: boolean;
  /** Drawn right after the questions, or after the banner when there are none (0.69.0): the follow-up card of the run page (0.48.0). */
  afterQuestions?: React.ReactNode;
}

/** The top of a run page that handed in a result: the banner, the questions, the metric tiles, the items, the actions. A result that asks puts its questions before the tiles, so the decision is the first thing after the banner. */
export function ResultPanel({ project, row, result, canWrite, nextRun, canRunNow, afterQuestions = null }: ResultPanelProps): React.ReactNode {
  const tone = resultTone(result.status);
  const hasQuestions = result.questions.length > 0;
  const tiles = result.metrics.length === 0 ? null : <Tiles metrics={result.metrics} />;
  return (
    <>
      <Section title="Result">
        <div className={`card card-accent result-banner edge-${tone}`}>
          <Status tone={tone} label={resultWord(result.status)} />
          <p className="result-summary">{result.summary}</p>
          {result.handoff === undefined ? null : <p className="rail-note">Note for the next run: {result.handoff}</p>}
        </div>
        {hasQuestions ? null : tiles}
      </Section>

      {/* 0.69.0: a run that proposes changes and asks nothing still gets its follow-up card. */}
      {hasQuestions ? null : afterQuestions}

      {hasQuestions ? (
        <>
          <Section title="Questions for you">
            <ResultQuestions project={project} row={row} questions={result.questions} canWrite={canWrite} nextRun={nextRun} canRunNow={canRunNow} />
          </Section>
          {afterQuestions}
          {tiles === null ? null : <Section title="Numbers">{tiles}</Section>}
        </>
      ) : null}

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
