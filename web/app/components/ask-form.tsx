/**
 * The answer form of an "Asks you" card (0.80.0; `darius run ack --answer`).
 * Each question has its own one-line box, and a small "Use recommendation"
 * button when the run gave a recommendation. Under the questions a line says
 * when the answer takes effect: it applies to the next run only. Three
 * actions: "Send answer" (the next run reads it), "Send and run now" (the
 * server writes the answer, then starts the ritual) and "Dismiss, no action"
 * (a bare acknowledgement, as before). Nothing is sent with every box empty.
 *
 * The answer is saved before a run starts. If the run cannot start, the card
 * says so and keeps the answer as sent; it goes to the next run. A refusal of
 * the server (the run was answered meanwhile, say) shows as its own sentence.
 *
 * Older open asks of the same ritual fold under the card (`EarlierAsks`), each
 * with its own form, and one confirm dismisses them all. That grouping is view
 * state only: nothing is written to the ledger to close an old card.
 */

import { useState } from "react";
import { Link, useRevalidator } from "react-router";

import type { ResultQuestion, RunRow } from "../../../src/web/api.ts";
import { ANSWERS_TOO_LONG, answersOf, askBody, currentHold, earlierBody, heldBody, isTooLong, recommendedText, resumeNotice, runNowNotice, withText, type RunNowNotice } from "../lib/ask.ts";
import { href } from "../lib/paths.ts";
import { postJson } from "../lib/post.ts";
import { dismissAllText, earlierText } from "../lib/view.ts";
import { QuestionList } from "./questions.tsx";
import { Fold } from "./ui.tsx";

/** What the loopback viewer reads where the form would be. */
const NO_WRITE_HINT = "No form here: this page was opened from this host. To answer, open the page by its tailnet name, or use the command below.";

/** After a run starts it shows within seconds: look again after this long. */
const RELOAD_AFTER_RUN_MS = 6000;

interface AskFormProps {
  project: string;
  run: string;
  questions: readonly ResultQuestion[];
  /** False for the loopback viewer: the server would refuse every write. */
  canWrite: boolean;
  /** What the form is for, for the accessible names. */
  subject: string;
  /** When an answer takes effect, in words. */
  nextRun: string;
  /** The run is a ritual run: "Send and run now" is offered. */
  canRunNow: boolean;
  /** An earlier ask: no "run now", and a line that says a newer run exists. */
  isEarlier?: boolean;
}

export function AskForm({ project, run, questions, canWrite, subject, nextRun, canRunNow, isEarlier = false }: AskFormProps): React.ReactNode {
  const { revalidate } = useRevalidator();
  const [texts, setTexts] = useState<readonly string[]>(() => questions.map(() => ""));
  const [busy, setBusy] = useState<"send" | "now" | "dismiss" | null>(null);
  const [isDone, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<RunNowNotice | null>(null);
  if (!canWrite) {
    return (
      <>
        <QuestionList questions={questions} />
        <p className="fu-off">{NO_WRITE_HINT}</p>
      </>
    );
  }

  const answers = answersOf(texts);
  const isLocked = busy !== null || isDone;
  // Ten answers of 500 characters do not fit one request: say so before the press, not after a 413.
  const isTooBig = isTooLong(askBody("now", { project, run }, texts));
  const setText = (index: number, text: string): void => setTexts(withText(texts, index, text));

  const send = async (runNow: boolean): Promise<void> => {
    setBusy(runNow ? "now" : "send");
    setError(null);
    const result = await postJson("/api/run/ack", askBody(runNow ? "now" : "send", { project, run }, texts));
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      // A refusal (answered meanwhile, already dismissed) means the list is stale: load it again.
      await revalidate();
      return;
    }
    setDone(true);
    if (!runNow) {
      await revalidate();
      return;
    }
    const told = runNowNotice(result);
    setNotice(told);
    // A run that started shows within seconds; a refusal stays on the card, where it is read.
    if (told.child !== undefined) setTimeout(() => void revalidate(), RELOAD_AFTER_RUN_MS);
  };

  const dismiss = async (): Promise<void> => {
    setBusy("dismiss");
    setError(null);
    const result = await postJson("/api/run/ack", askBody("dismiss", { project, run }, texts));
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      await revalidate();
      return;
    }
    setDone(true);
    await revalidate();
  };

  return (
    <form
      className="ask"
      onSubmit={(event) => {
        event.preventDefault();
        if (answers.length > 0 && !isLocked && !isTooBig) void send(false);
      }}
    >
      <QuestionList
        questions={questions}
        after={(index) => {
          const question = questions[index];
          const fill = question === undefined ? "" : recommendedText(question);
          const id = `ask-${run}-${index + 1}`;
          return (
            <div className="ask-answer">
              <label className="fu-label" htmlFor={id}>
                Your answer{questions.length === 1 ? "" : ` to question ${index + 1}`}
              </label>
              <div className="ask-row">
                <input id={id} className="st-input" type="text" maxLength={500} value={texts[index] ?? ""} disabled={isLocked} onChange={(event) => setText(index, event.currentTarget.value)} />
                {fill === "" ? null : (
                  <button type="button" className="st-btn st-btn-small" aria-label={`Use recommendation, question ${index + 1}`} disabled={isLocked} onClick={() => setText(index, fill)}>
                    Use recommendation
                  </button>
                )}
              </div>
            </div>
          );
        }}
      />
      {isEarlier ? <p className="fu-off">A newer run exists. Your answer goes to the next run with its question.</p> : null}
      <p className="fu-off">Applies to the next run only. Next run: {nextRun}</p>
      {isTooBig ? (
        <p className="bk-note tone-bad" role="alert">
          {ANSWERS_TOO_LONG}
        </p>
      ) : null}
      <div className="fu-acts">
        {questions.length === 0 ? null : (
          <button type="submit" className="st-btn st-btn-main" aria-label={`Send answer: ${subject}`} disabled={isLocked || isTooBig || answers.length === 0}>
            {busy === "send" ? "Sending…" : "Send answer"}
          </button>
        )}
        {isEarlier || !canRunNow || questions.length === 0 ? null : (
          <button type="button" className="st-btn" aria-label={`Send and run now: ${subject}`} disabled={isLocked || isTooBig || answers.length === 0} onClick={() => void send(true)}>
            {busy === "now" ? "Sending…" : "Send and run now"}
          </button>
        )}
        <button type="button" className="st-link" aria-label={`Dismiss, no action: ${subject}`} disabled={isLocked} onClick={() => void dismiss()}>
          {busy === "dismiss" ? "Dismissing…" : "Dismiss, no action"}
        </button>
      </div>
      {notice === null ? null : (
        <p className={`bk-note tone-${notice.tone}`} role={notice.tone === "bad" ? "alert" : "status"}>
          {notice.text}
          {notice.child === undefined ? null : (
            <>
              {" "}
              <Link to={href({ to: "run", ws: project, run: notice.child })}>Open the run</Link>
            </>
          )}
        </p>
      )}
      {error === null ? null : (
        <p className="bk-note tone-bad" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/** One earlier ask, to show under the main card. */
export interface EarlierAsk {
  run: string;
  /** When it ran, in words. */
  when: string;
  summary: string | null;
  questions: readonly ResultQuestion[];
}

interface EarlierAsksProps {
  project: string;
  /** The newest open ask: the run the bulk dismissal is anchored to. */
  run: string;
  asks: readonly EarlierAsk[];
  canWrite: boolean;
  nextRun: string;
}

/**
 * "N earlier asks" folded under the main card. Each entry is answerable. The
 * "Dismiss all earlier asks" fold asks first, with the real count, and posts
 * the ids of the asks shown, never more.
 */
export function EarlierAsks({ project, run, asks, canWrite, nextRun }: EarlierAsksProps): React.ReactNode {
  const { revalidate } = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [isDone, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (asks.length === 0) return null;

  const dismissAll = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const result = await postJson("/api/run/ack-earlier", earlierBody({ project, run }, asks.map((ask) => ask.run)));
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      await revalidate();
      return;
    }
    setDone(true);
    await revalidate();
  };

  return (
    <Fold summary={earlierText(asks.length)}>
      <ul className="ask-earlier">
        {asks.map((ask) => (
          <li key={ask.run} className="ask-earlier-item">
            <p className="card-meta">
              <Link to={href({ to: "run", ws: project, run: ask.run })}>{ask.when}</Link>
              {ask.summary === null ? null : `, ${ask.summary}`}
            </p>
            <AskForm key={ask.run} project={project} run={ask.run} questions={ask.questions} canWrite={canWrite} subject={`the earlier ask of ${ask.when}`} nextRun={nextRun} canRunNow={false} isEarlier />
          </li>
        ))}
      </ul>
      {canWrite ? (
        <Fold summary="Dismiss all earlier asks">
          <p className="fu-ask-q">{dismissAllText(asks.length)}</p>
          <div className="fu-acts">
            <button type="button" className="st-btn st-btn-danger" disabled={busy || isDone} onClick={() => void dismissAll()}>
              {busy ? "Dismissing…" : isDone ? "Dismissed" : `Yes, dismiss ${asks.length}`}
            </button>
          </div>
          {error === null ? null : (
            <p className="bk-note tone-bad" role="alert">
              {error}
            </p>
          )}
        </Fold>
      ) : null}
    </Fold>
  );
}

interface HeldFormProps {
  project: string;
  row: RunRow;
}

/**
 * The answer form of a held run (0.80.0; `darius run answer --answer`, then
 * `darius run resume`). One box for each question of the current hold, no
 * recommendation (a held question has none), one button, "Answer and
 * resume". The server writes the answers, then resumes the run. If the
 * resume is refused, the answers stay saved and the card says why. A box may
 * stay empty, but at least one must be filled.
 */
export function HeldForm({ project, row }: HeldFormProps): React.ReactNode {
  const { revalidate } = useRevalidator();
  const hold = currentHold(row);
  const [texts, setTexts] = useState<readonly string[]>(() => hold.map(() => ""));
  const [busy, setBusy] = useState(false);
  const [isDone, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<RunNowNotice | null>(null);
  const isLocked = busy || isDone;
  const filled = texts.some((text) => text.trim() !== "");
  const isTooBig = isTooLong(heldBody({ project, run: row.run }, hold, texts));

  const send = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const result = await postJson("/api/run/answer", heldBody({ project, run: row.run }, hold, texts));
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      // A refusal (the run was answered or went on meanwhile) means the card is stale: load it again.
      await revalidate();
      return;
    }
    const told = resumeNotice(result);
    setNotice(told);
    // A refused resume keeps the answers saved and the form open: the operator can retry (the server takes answers again while the run is held).
    if (told.tone === "bad") return;
    setDone(true);
    // A run that went on leaves Needs you within seconds.
    setTimeout(() => void revalidate(), RELOAD_AFTER_RUN_MS);
  };

  return (
    <form
      className="ask"
      onSubmit={(event) => {
        event.preventDefault();
        if (filled && !isLocked && !isTooBig) void send();
      }}
    >
      <QuestionList
        questions={hold.map((question) => ({ text: question.text }))}
        after={(index) => {
          const id = `held-${row.run}-${hold[index]?.n ?? index + 1}`;
          return (
            <div className="ask-answer">
              <label className="fu-label" htmlFor={id}>
                Your answer{hold.length === 1 ? "" : ` to question ${index + 1}`}
              </label>
              <div className="ask-row">
                <input id={id} className="st-input" type="text" maxLength={500} value={texts[index] ?? ""} disabled={isLocked} onChange={(event) => setTexts(withText(texts, index, event.currentTarget.value))} />
              </div>
            </div>
          );
        }}
      />
      {isTooBig ? (
        <p className="bk-note tone-bad" role="alert">
          {ANSWERS_TOO_LONG}
        </p>
      ) : null}
      <div className="fu-acts">
        <button type="submit" className="st-btn st-btn-main" aria-label="Answer and resume: this held run" disabled={isLocked || isTooBig || !filled}>
          {busy ? "Sending…" : "Answer and resume"}
        </button>
      </div>
      {notice === null ? null : (
        <p className={`bk-note tone-${notice.tone}`} role={notice.tone === "bad" ? "alert" : "status"}>
          {notice.text}
          {notice.child === undefined ? null : (
            <>
              {" "}
              <Link to={href({ to: "run", ws: project, run: notice.child })}>Open the run</Link>
            </>
          )}
        </p>
      )}
      {error === null ? null : (
        <p className="bk-note tone-bad" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
