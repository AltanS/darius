/**
 * The questions of a result, numbered, each with its recommendation and the
 * command lines a yes runs (0.48.0). Every text is untrusted plain text. A
 * caller may add a block under one question (`after`): the answer box of the
 * ask form (0.80.0).
 */

import type { ResultQuestion } from "../../../src/web/api.ts";

interface QuestionListProps {
  questions: readonly ResultQuestion[];
  /** Drawn under question `index` (from 0), inside its list item. */
  after?: (index: number) => React.ReactNode;
}

export function QuestionList({ questions, after }: QuestionListProps): React.ReactNode {
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
          {(question.commands ?? []).length === 0 ? null : (
            <div className="q-cmds">
              <p className="q-cmds-label">A yes runs, as written:</p>
              <pre>
                <code>{(question.commands ?? []).join("\n")}</code>
              </pre>
            </div>
          )}
          {after === undefined ? null : after(index)}
        </li>
      ))}
    </ol>
  );
}
