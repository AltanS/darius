/**
 * The "Check now" button of a vigil (0.86.0; `darius vigil sweep <slug>`).
 * One click posts to `/api/vigil/check`. The server starts the sweep detached
 * and answers at once. Since 0.95.0 the page does not ask the person to
 * reload: the button turns into the running light with "Checking on <host>,
 * asked 09:12", and the page loads its data again (1.5 s, 5 s, then every
 * 5 s, for 3 minutes) until the pending start of the check is no longer
 * `starting`. The new sweep then shows in the list without a reload. The
 * in-flight state comes from the `pending` prop, which the loader reads from
 * the registry of this host, so a reload of the page shows it too. A refusal
 * of the server (the daily sweep runs, another check runs, the 2 minute
 * wait) shows as its own sentence. The button is off for a paused or a
 * closed vigil, with the reason beside it. For the loopback viewer the server
 * would refuse the POST: the detail page says why there is no button, a list
 * row draws nothing.
 */

import { useEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";

import type { PendingStart } from "../../../src/web/api.ts";
import { checkPhase, lookAt } from "../lib/check-poll.ts";
import { useClock } from "../lib/clock.tsx";
import { clockTime } from "../lib/format.ts";
import { postJson } from "../lib/post.ts";
import { pendingText } from "../lib/receipt.ts";

/** What the loopback viewer reads where the button would be. Avoids the words "Check now", which only a live button carries. */
const NO_WRITE_HINT = "No button here: this page was opened from this host. To run the checks, open the page by its tailnet name, or use darius vigil sweep.";

interface CheckNowProps {
  project: string;
  slug: string;
  /** What the vigil is called, for the button's accessible name. */
  subject: string;
  /** False for the loopback viewer. */
  canWrite: boolean;
  /** Why the vigil cannot be checked (paused, closed); null when it can. */
  blocked: string | null;
  /** The detail page says why there is no button; a list row stays quiet. */
  explain: boolean;
  /** The check of this vigil that the web asked for and that shows no result yet, from the loader; null when there is none. */
  pending: PendingStart | null;
}

/** Looks again at 1.5 s, 5 s and every 5 s while `pending` is `starting`, until it is not or its window has passed. A new pending start (its id) begins a new round; unmounting ends it. */
export function useFollow(pending: PendingStart | null): void {
  const { revalidate } = useRevalidator();
  const again = useRef(revalidate);
  again.current = revalidate;
  const id = pending?.state === "starting" ? pending.id : null;
  const asked = pending?.at ?? null;
  useEffect(() => {
    if (id === null || asked === null) return;
    let step = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = (): void => {
      if (checkPhase({ state: "starting", at: asked }, Date.now()) !== "checking") return;
      void again.current();
      step += 1;
      timer = setTimeout(look, lookAt(step) - lookAt(step - 1));
    };
    timer = setTimeout(look, lookAt(0));
    return () => clearTimeout(timer);
  }, [id, asked]);
}

/** Follows a check that has no button on its row (a vigil that is not flagged): it only looks again, and draws nothing. */
export function Follow({ pending }: { pending: PendingStart }): React.ReactNode {
  useFollow(pending);
  return null;
}

export function CheckNow({ project, slug, subject, canWrite, blocked, explain, pending }: CheckNowProps): React.ReactNode {
  const { revalidate, state } = useRevalidator();
  const { now, offset } = useClock();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useFollow(pending);
  const phase = checkPhase(pending, now);
  // The sentence of a 202 that did not report in time is for the moment before the check shows; once it shows, it is stale.
  useEffect(() => {
    if (phase === "checking") setMessage(null);
  }, [phase]);
  if (!canWrite) return explain ? <p className="fu-off">{NO_WRITE_HINT}</p> : null;

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await postJson("/api/vigil/check", { project, slug });
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    // The request is in the registry by now: one look shows it as the pending start, and the follow-up takes over.
    await revalidate();
    setBusy(false);
    if (!result.started) setMessage(result.message ?? "Check requested.");
  };

  if (phase === "checking" && pending !== null) {
    return (
      <div className="check-live rw-live relative px-3 py-2" role="status">
        <span className="live-bar" aria-hidden="true" />
        <p className="rail-note">{`Checking on ${pending.host}, asked ${clockTime(pending.at, offset)}`}</p>
      </div>
    );
  }
  return (
    <form className="ack" onSubmit={(event) => void submit(event)}>
      <div className="fu-acts">
        <button type="submit" className="st-btn st-btn-small" aria-label={`Check now: ${subject}`} disabled={busy || blocked !== null}>
          {busy ? "Starting…" : "Check now"}
        </button>
        {phase === "stalled" ? (
          <button type="button" className="st-btn st-btn-small" disabled={state === "loading"} onClick={() => void revalidate()}>
            Look again
          </button>
        ) : null}
      </div>
      {blocked !== null && explain ? <p className="rail-note">{blocked}</p> : null}
      {phase === "stalled" && pending !== null ? (
        <p className="rail-note" role="status">
          {`No result yet after 3 minutes on ${pending.host}. The check may still finish.`}
        </p>
      ) : null}
      {(phase === "refused" || phase === "lost") && pending !== null ? (
        <p className="bk-note tone-bad" role="status">
          {pendingText(pending, { offset })}
        </p>
      ) : null}
      {message === null ? null : (
        <p className="rail-note" role="status">
          {message}
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
