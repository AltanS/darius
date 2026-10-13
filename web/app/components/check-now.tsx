/**
 * The "Check now" button of a vigil (0.86.0; `darius vigil sweep <slug>`).
 * One click posts to `/api/vigil/check`. The server starts the sweep detached
 * and answers at once, so the page does not wait for the checks: it says on
 * which host the check started and offers a reload. A refusal of the server
 * (the daily sweep runs, another check runs, the 2 minute wait) shows as its
 * own sentence. The button is off for a paused or a closed vigil, with the
 * reason beside it. For the loopback viewer the server would refuse the POST:
 * the detail page says why there is no button, a list row draws nothing.
 */

import { useState } from "react";
import { useRevalidator } from "react-router";

import { postJson } from "../lib/post.ts";

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
}

export function CheckNow({ project, slug, subject, canWrite, blocked, explain }: CheckNowProps): React.ReactNode {
  const { revalidate, state } = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!canWrite) return explain ? <p className="fu-off">{NO_WRITE_HINT}</p> : null;

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await postJson("/api/vigil/check", { project, slug });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setStarted(result.started ? `Check started on ${result.host ?? "this host"}. Reload to see the result.` : (result.message ?? "Check requested. Reload to see the result."));
  };

  return (
    <form className="ack" onSubmit={(event) => void submit(event)}>
      <div className="fu-acts">
        <button type="submit" className="st-btn st-btn-small" aria-label={`Check now: ${subject}`} disabled={busy || blocked !== null || started !== null}>
          {busy ? "Starting…" : started === null ? "Check now" : "Check started"}
        </button>
        {started === null ? null : (
          <button type="button" className="st-btn st-btn-small" disabled={state === "loading"} onClick={() => void revalidate()}>
            Reload
          </button>
        )}
      </div>
      {blocked !== null && explain ? <p className="rail-note">{blocked}</p> : null}
      {started === null ? null : (
        <p className="rail-note" role="status">
          {started}
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
