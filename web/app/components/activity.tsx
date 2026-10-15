/**
 * The trail of a ritual page (0.91.0): the "Starting" card for a start the web
 * asked for that shows no run yet, and the "Activity" timeline of every event.
 * Both read data the loader passes (`context.pending`, `context.activity`),
 * never client state. Store text is drawn as text.
 */

import { Link } from "react-router";

import type { ActivityEntry, PendingStart } from "../../../src/web/api.ts";
import { useClock } from "../lib/clock.tsx";
import { clockTime } from "../lib/format.ts";
import { href } from "../lib/paths.ts";
import { pendingText, shortRuns } from "../lib/receipt.ts";
import { timelineDays } from "../lib/ritual-activity.ts";
import { Fold } from "./ui.tsx";

interface StartingProps {
  starts: readonly PendingStart[];
  project: string;
}

/** One card for each start of this ritual that shows no run: who asked, on which host, or why it did not start. */
export function Starting({ starts, project }: StartingProps): React.ReactNode {
  const { offset } = useClock();
  return (
    <>
      {starts.map((start) => {
        const failed = start.state === "refused" || start.state === "lost";
        return (
          <div key={start.id} className={`card card-accent ${failed ? "edge-bad" : "edge-run"}`}>
            <p>{pendingText(start, { offset })}</p>
            {failed && start.parent !== undefined ? (
              <p className="rail-note">
                <Link to={href({ to: "run", ws: project, run: start.parent })}>Try again</Link> from the run page.
              </p>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

interface TimelineProps {
  entries: readonly ActivityEntry[];
  project: string;
  /** Where "Show older" goes; null when there is nothing older to load. */
  olderHref: string | null;
  /** The list holds the most events the page shows: say so, since a longer window would not add any. */
  isCapped: boolean;
}

/** Every event of the ritual, newest first, grouped by day. An entry has its time, its sentence, its detail folded and a link to the run. */
export function Timeline({ entries, project, olderHref, isCapped }: TimelineProps): React.ReactNode {
  const { today, offset } = useClock();
  const days = timelineDays(entries, today, offset);
  return (
    <div className="card">
      {days.map((day) => (
        <div key={day.date} className="mt-3 first:mt-0">
          <p className="fu-label">{day.label}</p>
          <ol className="timeline">
            {day.entries.map((entry, index) => (
              <li key={`${entry.at}-${entry.kind}-${index}`}>
                <p className="break-words">
                  <span className="text-muted">{clockTime(entry.at, offset)}</span> <span className={`ink-${entry.tone}`}>{shortRuns(entry.text)}</span>
                </p>
                {entry.links.run === undefined ? null : (
                  <p className="rail-note">
                    <Link to={href({ to: "run", ws: project, run: entry.links.run })}>Open the run</Link>
                  </p>
                )}
                {entry.detail === undefined || entry.detail.length === 0 ? null : (
                  <Fold summary={entry.detail.length === 1 ? "1 detail" : `${entry.detail.length} details`}>
                    {entry.detail.map((line, at) => (
                      <p key={`${at}`} className="rail-note break-words">
                        {line}
                      </p>
                    ))}
                  </Fold>
                )}
              </li>
            ))}
          </ol>
        </div>
      ))}
      {isCapped ? <p className="rail-note mt-3">This list shows the newest {entries.length} events.</p> : null}
      {olderHref === null ? null : (
        <p className="mt-3">
          <Link to={olderHref} className="st-btn st-btn-small" preventScrollReset>
            Show older
          </Link>
        </p>
      )}
    </div>
  );
}
