/**
 * The Acknowledge button (0.68.0; `darius run ack`). One click marks the run
 * as seen: a failed or abandoned run. There is no confirm step. An empty note
 * is a plain acknowledgement; a note behind the small "Add a note" fold says
 * why the failure is fine. A complete run that asks questions has its own
 * answer form since 0.80.0 (`ask-form.tsx`), not this button. The button
 * posts to `/api/run/ack` and then reloads the page data, so the card moves
 * to Last night as an acknowledged card. A refusal of the server (the run is
 * held, already acknowledged, and so on) shows as its own sentence and the
 * card stays. The button does not draw for a viewer who cannot write: the
 * server would refuse it. A line says why, and the terminal command stays.
 */

import { useId, useState } from "react";
import { useRevalidator } from "react-router";

import { postJson } from "../lib/post.ts";
import { Fold } from "./ui.tsx";

/** What the loopback viewer reads where the button would be: the cause and the two ways on. Avoids the word "Acknowledge", which only a live button carries. */
const NO_WRITE_HINT = "No button here: this page was opened from this host. To dismiss the card, open the page by its tailnet name, or use the command above.";

interface AckButtonProps {
  project: string;
  run: string;
  /** False for the loopback viewer: a short line says why there is no button. */
  canWrite: boolean;
  /** What the run is called, for the button's accessible name. */
  subject: string;
}

export function AckButton({ project, run, canWrite, subject }: AckButtonProps): React.ReactNode {
  const { revalidate } = useRevalidator();
  const id = useId();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [isDone, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!canWrite) return <p className="fu-off">{NO_WRITE_HINT}</p>;

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const trimmed = note.trim();
    const result = await postJson("/api/run/ack", trimmed === "" ? { project, run } : { project, run, note: trimmed });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDone(true);
    await revalidate();
  };

  return (
    <form className="ack" onSubmit={(event) => void submit(event)}>
      <div className="fu-acts">
        <button type="submit" className="st-btn st-btn-small" aria-label={`Acknowledge: ${subject}`} disabled={busy || isDone}>
          {busy ? "Acknowledging…" : isDone ? "Acknowledged" : "Acknowledge"}
        </button>
      </div>
      <Fold summary="Add a note">
        <label className="fu-label" htmlFor={id}>
          Note (optional)
        </label>
        <input id={id} className="st-input" type="text" maxLength={500} value={note} disabled={busy || isDone} onChange={(event) => setNote(event.currentTarget.value)} />
      </Fold>
      {error === null ? null : (
        <p className="bk-note tone-bad" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
