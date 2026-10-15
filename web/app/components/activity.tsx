/**
 * The trail of a ritual page (0.91.0): the "Starting" card for a start the web
 * asked for that shows no run yet, and the "Activity" timeline of every event.
 * Both read data the loader passes (`context.pending`, `context.activity`),
 * never client state. Store text is drawn as text.
 */

import { Link } from "react-router";

import type { ActivityEntry, PendingStart } from "../../../src/web/api.ts";
import { useClock } from "../lib/clock.tsx";
import { clockTime, momentText } from "../lib/format.ts";
import { href } from "../lib/paths.ts";
import { pendingText, shortRuns } from "../lib/receipt.ts";
import { afterLead, leadOf } from "../lib/activity-place.ts";
import { timelineDays } from "../lib/ritual-activity.ts";
import type { RunSentence, TrailLine } from "../lib/run-origin.ts";
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
  entries: readonly (ActivityEntry & { project?: string })[];
  /** The workspace of an entry that names none: the page's own. */
  project: string;
  /** Where "Show older" goes; null when there is nothing older to load. */
  olderHref: string | null;
  /** The list holds the most events the page shows: say so, since a longer window would not add any. */
  isCapped: boolean;
  /** The Activity place (0.94.0): each entry starts with the kind word and the title of its item, and links to its own workspace. */
  lead?: { workspace: boolean };
  /** Starts the web asked for that show no run yet (Activity place): drawn once, on top, before the days. */
  starting?: readonly (ActivityEntry & { project?: string })[];
  /** Words an entry's sentence the way a page wants it (the vigil page shows "until 20 Oct"). The text of the entry is not changed. */
  sentence?: (text: string) => string;
}

/** The sentence as the entry has it. */
function same(text: string): string {
  return text;
}

interface EntryProps {
  entry: ActivityEntry & { project?: string };
  project: string;
  lead: TimelineProps["lead"];
  sentence: (text: string) => string;
}

/** The lead of an entry: "ritual Fact check" with the title as a link to the item, and the workspace when the page spans several. */
function Lead({ entry, project, workspace }: { entry: ActivityEntry; project: string; workspace: boolean }): React.ReactNode {
  const { word, title } = leadOf(entry);
  const slug = word === "vigil" ? entry.links.vigil : word === "ritual" ? entry.links.ritual : undefined;
  const target = slug === undefined ? null : href(word === "vigil" ? { to: "vigil", ws: project, slug } : { to: "ritual", ws: project, slug });
  return (
    <>
      <span className="text-faint">{word}</span> {target === null ? <span>{title}</span> : <Link to={target}>{title}</Link>}
      {workspace ? <span className="text-faint">{` (${project})`}</span> : null}
      {": "}
    </>
  );
}

/** One event: its time, its sentence, a link to the run, and its detail folded. */
function Entry({ entry, project, lead, sentence }: EntryProps): React.ReactNode {
  const { offset } = useClock();
  const own = entry.project ?? project;
  return (
    <li>
      <p className="break-words">
        <span className="text-muted">{clockTime(entry.at, offset)}</span>{" "}
        {lead === undefined ? null : <Lead entry={entry} project={own} workspace={lead.workspace} />}
        <span className={`ink-${entry.tone}`}>{lead === undefined ? sentence(shortRuns(entry.text)) : afterLead(sentence(shortRuns(entry.text)))}</span>
      </p>
      {entry.links.run === undefined ? null : (
        <p className="rail-note">
          <Link to={href({ to: "run", ws: own, run: entry.links.run })}>Open the run</Link>
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
  );
}

/** Every event, newest first, grouped by day. An entry has its time, its sentence, its detail folded and a link to the run. */
export function Timeline({ entries, project, olderHref, isCapped, lead, starting = [], sentence = same }: TimelineProps): React.ReactNode {
  const { today, offset } = useClock();
  const days = timelineDays(entries, today, offset);
  return (
    <div className="card">
      {starting.length === 0 ? null : (
        <div className="mt-3 first:mt-0">
          <p className="fu-label">Starting</p>
          <ol className="timeline">
            {starting.map((entry, index) => (
              <Entry key={`${entry.at}-${entry.kind}-${index}`} entry={entry} project={project} lead={lead} sentence={sentence} />
            ))}
          </ol>
        </div>
      )}
      {days.map((day) => (
        <div key={day.date} className="mt-3 first:mt-0">
          <p className="fu-label">{day.label}</p>
          <ol className="timeline">
            {day.entries.map((entry, index) => (
              <Entry key={`${entry.at}-${entry.kind}-${index}`} entry={entry} project={project} lead={lead} sentence={sentence} />
            ))}
          </ol>
        </div>
      ))}
      {isCapped ? <p className="rail-note mt-3">This list shows the newest {entries.length + starting.length} events.</p> : null}
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

interface SentenceLineProps {
  sentence: RunSentence;
  project: string;
}

/** A sentence of the run page's header with its run as a link: "Follow-up of <run>, started by web:altan at 09:12." */
export function SentenceLine({ sentence, project }: SentenceLineProps): React.ReactNode {
  return (
    <p className="break-words">
      {sentence.before}
      {sentence.run === null ? null : <Link to={href({ to: "run", ws: project, run: sentence.run })}>{sentence.linkText}</Link>}
      {sentence.after}
    </p>
  );
}

interface RunTrailProps {
  lines: readonly TrailLine[];
}

/** The events of one run, oldest first: the sentence, the answers of an ack in full, and the other detail behind a fold. */
export function RunTrail({ lines }: RunTrailProps): React.ReactNode {
  const { today, offset } = useClock();
  if (lines.length === 0) return null;
  return (
    <ol className="timeline">
      {lines.map((line, index) => (
        <li key={`${line.at}-${index}`}>
          <p className="break-words">
            <span className="text-muted">{momentText(line.at, today, offset)}</span> <span className={`ink-${line.tone}`}>{line.text}</span>
          </p>
          {line.inline.map((text, at) => (
            <p key={`${at}`} className="rail-note break-words">
              {text}
            </p>
          ))}
          {line.folded.length === 0 ? null : (
            <Fold summary={line.folded.length === 1 ? "1 detail" : `${line.folded.length} details`}>
              {line.folded.map((text, at) => (
                <p key={`${at}`} className="rail-note break-words">
                  {text}
                </p>
              ))}
            </Fold>
          )}
        </li>
      ))}
    </ol>
  );
}
