/**
 * The line a run start leaves under its button ("Send and run now", "Answer
 * and resume", the follow-up card). The reply of the server sets it:
 * "Run 8SXQ2ABC started on <host>." with the link "Open the run", or the
 * server's sentence "<host> has not confirmed the start yet. It shows in Now
 * when it starts." For the second case the line follows the start with the
 * light poll, and swaps to the first sentence when the run starts. No timer
 * clears it.
 */

import { Link } from "react-router";

import { followedNotice, type RunNowNotice } from "../lib/ask.ts";
import { useFollowStarts } from "../lib/follow-starts.ts";
import { href } from "../lib/paths.ts";

interface StartLineProps {
  notice: RunNowNotice;
  /** The workspace of the run, for the link. */
  project: string;
  /** What the sentence is for, so a test and a screen reader can tell lines apart. */
  className?: string;
}

export function StartLine({ notice, project, className }: StartLineProps): React.ReactNode {
  const followed = useFollowStarts(notice.follow === undefined ? [] : [notice.follow]);
  const shown = followedNotice(notice, notice.follow === undefined ? undefined : followed.get(notice.follow));
  return (
    <p className={`bk-note tone-${shown.tone}${className === undefined ? "" : ` ${className}`}`} role={shown.tone === "bad" ? "alert" : "status"}>
      {shown.text}
      {shown.child === undefined ? null : (
        <>
          {" "}
          <Link to={href({ to: "run", ws: project, run: shown.child })}>Open the run</Link>
        </>
      )}
    </p>
  );
}
