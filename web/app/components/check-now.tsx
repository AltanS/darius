/**
 * The "Check now" button of a vigil (0.86.0; `darius vigil sweep <slug>`).
 * One click posts to `/api/vigil/check`. The server starts the sweep detached
 * and answers within 1.5 s, "started" or "pending"; both mean the check is
 * asked and the registry follows it. The page does not wait for a reload:
 *
 * - While the POST has no reply, the button reads "Checking…" with its gem.
 *   After 2 s a text line says "Asking <host> to start the check."
 * - On a 202 reply the button gives way to the checking line, built from the
 *   reply (host, time): "Checking on <host>, 40 s so far. Most checks end
 *   within a minute." It ticks. After 3 minutes it says "Still checking ...".
 *   There is no stalled state and no "Look again": the light poll of
 *   `follow-starts.ts` keeps looking until the check ends or 15 minutes pass.
 * - When the check ends the line reads "Checked 07:24: passed." (or "still
 *   failing"), for the rest of the visit.
 * - Inside the 2 minute cooldown the button is off and says when to check again.
 *
 * The state of an unfinished check also comes from the `pending` prop, which
 * the loader reads from the registry of this host, so a reload of the page
 * shows it too. The button is off for a paused or a closed vigil, with the
 * reason beside it. For the loopback viewer the server would refuse the POST:
 * the detail page says why there is no button, a list row draws nothing.
 */

import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";

import type { PendingStart } from "../../../src/web/api.ts";
import { checkedText, checkingText, cooldownText, lostText, newerAsk, refusedText, type Asked } from "../lib/check-poll.ts";
import { useClock } from "../lib/clock.tsx";
import { seedStart, useFollowStarts } from "../lib/follow-starts.ts";
import { clockTime } from "../lib/format.ts";
import { postJson } from "../lib/post.ts";
import { BusyButton } from "./busy-button.tsx";
import { Gem } from "./nav-icons.tsx";
import { WaitLine } from "./wait-line.tsx";

/** What the loopback viewer reads where the button would be. Avoids the words "Check now", which only a live button carries. */
const NO_WRITE_HINT = "No button here: this page was opened from this host. To run the checks, open the page by its tailnet name, or use darius vigil sweep.";

/** The newest check of the vigil that ended, for the line "Checked 07:24: passed." and for the cooldown. */
export interface LatestCheck {
  /** When the sweep ended, an ISO time. */
  at: string;
  /** The outcome of the sweep (`held`, `failed`, ...); null when the row does not know it. */
  outcome: string | null;
}

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
  /** The newest check that ended; null when the vigil has not been checked or the page does not know. */
  latest?: LatestCheck | null;
}

/** Follows a check that has no button on its row (a vigil that is not flagged): it only follows, and draws nothing. */
export function Follow({ pending }: { pending: PendingStart }): React.ReactNode {
  useFollowStarts(pending.state === "starting" ? [pending.id] : []);
  return null;
}

/** The time in ms that ticks once a second while `active`. Before the first tick, and on the server, it is the page clock, so hydration sees the same text. */
function useTicker(active: boolean): number {
  const { now } = useClock();
  const [tick, setTick] = useState<number | null>(null);
  useEffect(() => {
    if (!active) {
      setTick(null);
      return;
    }
    setTick(Date.now());
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return tick ?? now;
}

interface Cooling {
  lastCheckedAt: string;
  retryAt: string;
}

export function CheckNow({ project, slug, subject, canWrite, blocked, explain, pending, latest = null }: CheckNowProps): React.ReactNode {
  const { revalidate } = useRevalidator();
  const { now: clockNow, offset } = useClock();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState<Asked | null>(null);
  const [cooling, setCooling] = useState<Cooling | null>(null);
  const fromLoader: Asked | null = pending?.state === "starting" ? { id: pending.id, host: pending.host, at: pending.at } : null;
  // The page keeps following a check that the loader showed as `starting`, even after the loader stops listing it.
  const tracked = newerAsk(asked, fromLoader);
  useEffect(() => {
    if (fromLoader !== null && fromLoader.id !== asked?.id && newerAsk(asked, fromLoader) === fromLoader) setAsked(fromLoader);
  }, [fromLoader, asked]);
  const followed = useFollowStarts(tracked === null ? [] : [tracked.id]);
  const entry = tracked === null ? undefined : followed.get(tracked.id);
  // The loader knows the sentence of a refusal, the poll does not: once the loader shows the same start in an end state, it wins.
  const sameLoader = pending !== null && tracked !== null && pending.id === tracked.id ? pending : null;
  const state = sameLoader !== null && sameLoader.state !== "starting" ? sameLoader.state : (entry?.state ?? "starting");
  const checking = tracked !== null && state === "starting";
  const cooldownFrom = cooling?.lastCheckedAt ?? latest?.at ?? null;
  // The clock ticks every second only while a line needs it: a check that runs, or a cooldown that has not ended.
  const now = useTicker(checking || (cooldownFrom !== null && cooldownText(cooldownFrom, clockNow, offset, cooling?.retryAt) !== null));
  if (!canWrite) return explain ? <p className="fu-off">{NO_WRITE_HINT}</p> : null;

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await postJson("/api/vigil/check", { project, slug });
    setBusy(false);
    if (!result.ok) {
      if (result.retryAt !== undefined && result.lastCheckedAt !== undefined) setCooling({ lastCheckedAt: result.lastCheckedAt, retryAt: result.retryAt });
      else setError(result.error);
      return;
    }
    if (result.id !== null && result.at !== null) {
      const host = result.host ?? "the host";
      seedStart({ id: result.id, state: "starting", host, at: result.at, kind: "vigil-check", project, item: slug });
      setAsked({ id: result.id, host, at: result.at });
    }
    // The reply is the news: the line is up. One load in the background brings the rest.
    void revalidate();
  };

  const host = entry !== undefined && entry.state !== "unknown" ? entry.host : (tracked?.host ?? "the host");
  const cooldown = cooldownFrom === null ? null : cooldownText(cooldownFrom, now, offset, cooling?.retryAt);
  if (checking && tracked !== null) {
    const age = Math.max(0, now - Date.parse(tracked.at));
    return (
      <div role="status">
        <p className="gem-line">
          <Gem size={14} busy />
          <span aria-hidden="true">{checkingText(host, age)}</span>
          <span className="sr-only">{`Checking on ${host}.`}</span>
        </p>
      </div>
    );
  }
  const newer = tracked !== null && latest !== null && latest.at > tracked.at;
  const lastLine =
    tracked === null
      ? null
      : state === "started"
        ? checkedText(clockTime(newer ? latest.at : new Date(now).toISOString(), offset), newer ? latest.outcome : null)
        : state === "refused"
          ? refusedText(host, sameLoader?.sentence)
          : state === "lost"
            ? lostText(host, "check")
            : null;
  const failed = state === "refused" || state === "lost";
  return (
    <form className="ack" onSubmit={(event) => void submit(event)}>
      <div className="fu-acts">
        <BusyButton busy={busy} type="submit" className="st-btn st-btn-small" aria-label={cooldown === null ? `Check now: ${subject}` : undefined} disabled={busy || blocked !== null || cooldown !== null}>
          {busy ? "Checking…" : (cooldown ?? "Check now")}
        </BusyButton>
      </div>
      <WaitLine active={busy} what="check" />
      {blocked !== null && explain ? <p className="rail-note">{blocked}</p> : null}
      {lastLine === null ? null : (
        <p className={failed ? "bk-note tone-bad" : "rail-note"} role="status">
          {lastLine}
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
