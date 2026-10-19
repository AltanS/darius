/**
 * The follow-up card of a run page (0.48.0; `darius run follow-up`). When a
 * follow-up can start, the operator picks the questions whose command lines
 * to approve and, since 0.69.0, the proposals of needs-decision items, may
 * add a note, and presses one button. The page sends question numbers and
 * item keys only, never a command line. When nothing is picked, the note is
 * the operator's decision and the run is granted no line (0.65.0).
 *
 * A press posts at once, unless the run would be granted command lines:
 * then a confirm box lists every line first (0.48.0). The POST waits up to
 * 2.5 s for the CLI. The line under the button then names the new run with a
 * link, says that the host has not confirmed the start yet (the page follows
 * it and swaps the line when the run starts), or says why it did not start
 * (0.69.0). The button stays off after a start: no second press.
 *
 * The card does not come with the page (0.98.0): `FollowUpSection` asks
 * `GET /api/run/follow-up/ready` after it mounts, because the check can take
 * seconds over ssh. `FollowUpCard` below draws the answer.
 *
 * The follow-up may start on another host, the ritual's (0.69.0): the
 * server forwards it over ssh, and the card names that host. When a
 * follow-up cannot start, the card says why. For a reason on this host it
 * gives the command for a host that can; for a reason on the ritual's host
 * it gives the reason only.
 */

import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";

import type { FollowUpReadiness, ResultItem, ResultQuestion } from "../../../src/web/api.ts";
import { refusedStartText, startNotice, type RunNowNotice } from "../lib/ask.ts";
import { cardView, checkingText, fetchReadiness, type FollowUpPlan, type Loaded } from "../lib/follow-up-load.ts";
import { postJson } from "../lib/post.ts";
import { BusyButton } from "./busy-button.tsx";
import { Command } from "./command.tsx";
import { ProposalView } from "./result.tsx";
import { StartLine } from "./start-line.tsx";
import { Fold, Section, Status } from "./ui.tsx";
import { GemLine, WaitLine } from "./wait-line.tsx";

interface FollowUpSectionProps {
  project: string;
  run: string;
  /** What the loader knows without the check (src/web/api.ts, `GET /api/run/follow-up/ready`). */
  plan: FollowUpPlan;
  questions: readonly ResultQuestion[];
  items: readonly ResultItem[];
}

/**
 * The "Follow-up" section of a run page (0.98.0). The page renders without the
 * readiness check, which can take seconds over ssh. This asks for it after it
 * mounts: a run that lists commands or proposes changes holds the place of the
 * card with the busy gem and one line; any other followable run draws nothing
 * until the check passes, so an empty section never shows.
 */
export function FollowUpSection({ project, run, plan, questions, items }: FollowUpSectionProps): React.ReactNode {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  useEffect(() => {
    const abort = new AbortController();
    const ask = async (): Promise<void> => {
      const answer = await fetchReadiness(project, run, abort.signal);
      if (!abort.signal.aborted) setLoaded(answer);
    };
    void ask();
    return () => abort.abort();
  }, [project, run]);
  const view = cardView(plan, loaded);
  if (view.view === "none") return null;
  return (
    <Section title="Follow-up">
      {view.view === "waiting" ? (
        <div className="card fu">
          <GemLine text={checkingText(plan.host)} />
        </div>
      ) : (
        <FollowUpCard project={project} run={run} readiness={view.readiness} questions={questions} items={items} />
      )}
    </Section>
  );
}

interface FollowUpCardProps {
  project: string;
  run: string;
  readiness: FollowUpReadiness;
  questions: readonly ResultQuestion[];
  /** The parent's items: the card shows the proposal of each approvable one (0.69.0). */
  items: readonly ResultItem[];
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

/** The body of `POST /api/run/follow-up` (src/web/action-api.ts): question numbers, item keys, a note. */
type FollowUpPost = { project: string; run: string; approve: readonly number[]; items?: readonly string[]; note?: string };

function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function FollowUpCard({ project, run, readiness, questions, items }: FollowUpCardProps): React.ReactNode {
  const { revalidate } = useRevalidator();
  const offered = readiness.ready ? readiness.questions : [];
  const proposals = readiness.ready ? readiness.items : [];
  const [picked, setPicked] = useState<ReadonlySet<number>>(() => new Set(offered.length === 1 && proposals.length === 0 ? offered.map((question) => question.n) : []));
  const [keys, setKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<RunNowNotice | null>(null);
  // After a start the button stays off: the card is read once, so a second press would start a second run.
  const [isDone, setDone] = useState(false);

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

  if (!readiness.ready && readiness.rightHost !== undefined) {
    return (
      <div className="card fu">
        <p className="fu-off">
          <Status tone="idle" label="off" /> This ritual runs on {readiness.rightHost}, and a follow-up cannot start there now: {readiness.reason}
        </p>
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
  const chosenKeys = proposals.filter((proposal) => keys.has(proposal.key)).map((proposal) => proposal.key);
  const lines = [...new Set(chosen.flatMap((question) => question.commands))];
  const decision = note.trim();
  const approved = chosen.length + chosenKeys.length;
  const isAllPicked = proposals.length > 0 && chosenKeys.length === proposals.length;
  const where = readiness.via === undefined ? readiness.host : `${readiness.host}, forwarded from ${readiness.via}`;
  const how = readiness.surface === "headless" ? `The run is headless on ${readiness.host}.` : `The run opens in a herdr tab on ${readiness.host}, attended.`;

  const start = async (): Promise<void> => {
    setBusy(true);
    setNotice(null);
    const approve = chosen.map((question) => question.n);
    const body: FollowUpPost = { project, run, approve };
    if (chosenKeys.length > 0) body.items = chosenKeys;
    if (decision !== "") body.note = decision;
    const result = await postJson("/api/run/follow-up", body);
    setBusy(false);
    setAsking(false);
    if (!result.ok) {
      setNotice({ tone: "bad", text: refusedStartText(result.error, readiness.host, result.status) });
      return;
    }
    setDone(true);
    setNotice(startNotice(result));
    // The run starts as the reply says; one load brings "Its follow-ups" in the background. A start that is not confirmed yet loads the page again when it settles.
    void revalidate();
  };

  const press = (): void => {
    if (lines.length > 0) setAsking(true);
    else void start();
  };

  return (
    <div className="card fu">
      {proposals.length === 0 ? null : (
        <fieldset className="fu-picks" disabled={busy || isDone}>
          <legend className="fu-label">Approve the proposals</legend>
          <label className="fu-pick fu-all">
            <input
              type="checkbox"
              checked={isAllPicked}
              onChange={() => {
                setKeys(isAllPicked ? new Set() : new Set(proposals.map((proposal) => proposal.key)));
              }}
            />
            Select all proposals ({proposals.length})
          </label>
          <ul className="fu-props">
            {proposals.map((proposal) => {
              const item = items.find((candidate) => candidate.key === proposal.key);
              return (
                <li key={proposal.key} className="fu-prop">
                  <label className="fu-pick">
                    <input type="checkbox" checked={keys.has(proposal.key)} onChange={() => setKeys(toggled(keys, proposal.key))} />
                    <span className="fu-prop-title">{proposal.title}</span>
                  </label>
                  <p className="ritem-key">
                    {item?.target === undefined ? null : `${item.target} · `}
                    {`key ${proposal.key}`}
                  </p>
                  {item?.proposal === undefined ? null : (
                    <Fold summary="Proposal">
                      <ProposalView proposal={item.proposal} />
                    </Fold>
                  )}
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}
      {offered.length === 0 ? null : (
        <fieldset className="fu-picks" disabled={busy || isDone}>
          <legend className="fu-label">Approve the commands of</legend>
          {offered.map((question) => (
            <label key={question.n} className="fu-pick">
              <input
                type="checkbox"
                checked={picked.has(question.n)}
                onChange={() => {
                  setPicked(toggled(picked, question.n));
                  setAsking(false);
                }}
              />
              Question {question.n} ({question.commands.length === 1 ? "1 line" : `${question.commands.length} lines`})
            </label>
          ))}
        </fieldset>
      )}
      <div>
        <label className="fu-label" htmlFor={`fu-note-${run}`}>
          {approved === 0 ? "Operator decision for the follow-up" : "Note for the follow-up (optional)"}
        </label>
        <input
          id={`fu-note-${run}`}
          className="st-input"
          type="text"
          maxLength={500}
          required={approved === 0}
          value={note}
          disabled={busy || isDone}
          onChange={(event) => {
            setNote(event.currentTarget.value);
            setAsking(false);
          }}
        />
      </div>
      {asking ? (
        <div className="fu-ask" role="group" aria-label="Confirm the follow-up">
          <p className="fu-ask-q">
            Start a new run on {where} (profile {readiness.profile}) that may run {lines.length === 1 ? "this line" : `these ${lines.length} lines`} as written
            {chosenKeys.length === 0 ? "?" : ` and carry out ${chosenKeys.length === 1 ? "1 approved proposal" : `${chosenKeys.length} approved proposals`}?`}
          </p>
          <div className="q-cmds">
            <pre>
              <code>{lines.join("\n")}</code>
            </pre>
          </div>
          {decision === "" ? null : <p>Note: {decision}</p>}
          <div className="fu-acts">
            <BusyButton busy={busy} className="st-btn st-btn-main" disabled={busy || isDone} onClick={() => void start()}>
              {busy ? "Starting…" : "Yes, start it"}
            </BusyButton>
            <button type="button" className="st-btn" disabled={busy} onClick={() => setAsking(false)}>
              No
            </button>
          </div>
        </div>
      ) : (
        <div className="fu-acts">
          <BusyButton busy={busy} className="st-btn st-btn-main" disabled={busy || isDone || (approved === 0 && decision === "")} onClick={press}>
            {busy ? "Starting…" : approved === 0 ? `Start follow-up on ${readiness.host}` : `Start follow-up with ${approved} approved`}
          </BusyButton>
        </div>
      )}
      <WaitLine active={busy} host={readiness.host} what="run" />
      <p className="fu-off">
        It runs on {where} and carries out only what you approve, within the ritual's policy. Anything else the run tries still holds as usual. {how}
      </p>
      {notice === null ? null : <StartLine notice={notice} project={project} />}
    </div>
  );
}
