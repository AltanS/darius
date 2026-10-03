/**
 * The follow-up card of a run page (0.48.0; `darius run follow-up`). When
 * this host can start one, the operator picks the questions to approve,
 * may add a note, and presses "Start follow-up on <host>". A second press
 * on the confirm box, which lists every line the run will be granted, posts
 * to `/api/run/follow-up`. The page sends question numbers only, never a
 * command line. When no question lists commands, or none is picked, the
 * note is the operator's decision and the run is granted no line (0.65.0).
 * When this host cannot start one, the card says why and
 * gives the command for a host that can. When the ritual runs on another
 * host (0.50.0), the card names it and gives the ssh command for it.
 */

import { useState } from "react";
import { useRevalidator } from "react-router";

import type { FollowUpReadiness, ResultQuestion } from "../../../src/web/api.ts";
import { postJson } from "../lib/post.ts";
import { Command } from "./command.tsx";
import { Status } from "./ui.tsx";

interface FollowUpCardProps {
  project: string;
  run: string;
  readiness: FollowUpReadiness;
  questions: readonly ResultQuestion[];
}

interface Note {
  tone: "ok" | "bad";
  text: string;
}

/** The CLI command for the same follow-up, for a host where the button is off. */
function followUpCommand(run: string, project: string, numbers: readonly number[]): string {
  const approve = numbers.length === 0 ? '--note "<decision>"' : numbers.map((n) => `--approve ${n}`).join(" ");
  return `darius run follow-up ${run} ${approve} --project ${project}`;
}

/** The numbers of the questions that list commands, from 1. */
function commandQuestions(questions: readonly ResultQuestion[]): number[] {
  return questions.flatMap((question, index) => ((question.commands ?? []).length > 0 ? [index + 1] : []));
}

/** After the POST the new run appears within seconds: look again twice. */
const RELOAD_AFTER_MS = [1500, 5000];

export function FollowUpCard({ project, run, readiness, questions }: FollowUpCardProps): React.ReactNode {
  const { revalidate } = useRevalidator();
  const offered = readiness.ready ? readiness.questions : [];
  const [picked, setPicked] = useState<ReadonlySet<number>>(() => new Set(offered.length === 1 ? offered.map((question) => question.n) : []));
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Note | null>(null);

  if (!readiness.ready && readiness.rightHost !== undefined && readiness.command !== undefined) {
    return (
      <div className="card fu">
        <p className="fu-off">
          <Status tone="idle" label="off" /> This ritual runs on {readiness.rightHost}. Open this page on {readiness.rightHost}, or run:
        </p>
        <div className="next-cmd">
          <Command command={readiness.command} />
        </div>
      </div>
    );
  }

  if (!readiness.ready) {
    return (
      <div className="card fu">
        <p className="fu-off">
          <Status tone="idle" label="off" /> A follow-up cannot start from this page: {readiness.reason}
        </p>
        <div className="next-cmd">
          <p>On a host with the checkout and herdr, run:</p>
          <Command command={followUpCommand(run, project, commandQuestions(questions))} />
        </div>
      </div>
    );
  }

  const chosen = offered.filter((question) => picked.has(question.n));
  const lines = [...new Set(chosen.flatMap((question) => question.commands))];
  const decision = note.trim();

  const toggle = (n: number): void => {
    const next = new Set(picked);
    if (next.has(n)) next.delete(n);
    else next.add(n);
    setPicked(next);
    setAsking(false);
  };

  const start = async (): Promise<void> => {
    setBusy(true);
    setNotice(null);
    const approve = chosen.map((question) => question.n);
    const result = await postJson("/api/run/follow-up", decision === "" ? { project, run, approve } : { project, run, approve, note: decision });
    setBusy(false);
    setAsking(false);
    if (!result.ok) {
      setNotice({ tone: "bad", text: result.error });
      return;
    }
    setNotice({ tone: "ok", text: `Started on ${readiness.host}. The new run opens in a herdr tab there and shows below in a moment.` });
    for (const delay of RELOAD_AFTER_MS) setTimeout(() => void revalidate(), delay);
  };

  return (
    <div className="card fu">
      {offered.length === 0 ? null : (
        <fieldset className="fu-picks" disabled={busy}>
          <legend className="fu-label">Approve the commands of</legend>
          {offered.map((question) => (
            <label key={question.n} className="fu-pick">
              <input type="checkbox" checked={picked.has(question.n)} onChange={() => toggle(question.n)} />
              Question {question.n} ({question.commands.length === 1 ? "1 line" : `${question.commands.length} lines`})
            </label>
          ))}
        </fieldset>
      )}
      <div>
        <label className="fu-label" htmlFor={`fu-note-${run}`}>
          Operator decision for the follow-up
        </label>
        <input
          id={`fu-note-${run}`}
          className="st-input"
          type="text"
          maxLength={500}
          required={chosen.length === 0}
          value={note}
          disabled={busy}
          onChange={(event) => {
            setNote(event.currentTarget.value);
            setAsking(false);
          }}
        />
      </div>
      {asking ? (
        <div className="fu-ask" role="group" aria-label="Confirm the follow-up">
          {lines.length === 0 ? (
            <p className="fu-ask-q">
              Start a new run on {readiness.host} (profile {readiness.profile}) that carries out this decision within the ritual's policy?
            </p>
          ) : (
            <p className="fu-ask-q">
              Start a new run on {readiness.host} (profile {readiness.profile}) that may run {lines.length === 1 ? "this line" : `these ${lines.length} lines`} as written?
            </p>
          )}
          {lines.length === 0 ? null : (
            <div className="q-cmds">
              <pre>
                <code>{lines.join("\n")}</code>
              </pre>
            </div>
          )}
          {decision === "" ? null : <p>Decision: {decision}</p>}
          <div className="fu-acts">
            <button type="button" className="st-btn st-btn-main" disabled={busy} onClick={() => void start()}>
              {busy ? "Starting…" : "Yes, start it"}
            </button>
            <button type="button" className="st-btn" disabled={busy} onClick={() => setAsking(false)}>
              No
            </button>
          </div>
        </div>
      ) : (
        <div className="fu-acts">
          <button type="button" className="st-btn st-btn-main" disabled={busy || (chosen.length === 0 && decision === "")} onClick={() => setAsking(true)}>
            Start follow-up on {readiness.host}
          </button>
        </div>
      )}
      <p className="fu-off">Anything else the run tries still holds as usual. The run opens in a herdr tab, attended.</p>
      {notice === null ? null : (
        <p className={`bk-note tone-${notice.tone}`} role={notice.tone === "bad" ? "alert" : "status"}>
          {notice.text}
        </p>
      )}
    </div>
  );
}
