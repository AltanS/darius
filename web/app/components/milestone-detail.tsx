/**
 * The milestone detail page, read-only: the head (id, title, state, dates,
 * the bar and "103 of 143 checks done"), a status strip of spec counts, the
 * README, every spec with its full text, the worklogs and any other file of
 * the milestone directory. Specs with a long text, worklogs and files start
 * folded (a details element); each summary is a status line. All text comes
 * parsed from darius and renders through `Markdown`, never as HTML.
 */

import type { MilestoneFile, MilestoneWorklog } from "../../../src/web/api.ts";
import { omittedText, sizeText, type DetailCounts, type SpecDetailView } from "../lib/milestones.ts";
import { Markdown } from "./markdown.tsx";
import { Mark, SpecMeta } from "./milestones.tsx";
import { Pill } from "./pulse.tsx";
import { Time, TitleText } from "./ui.tsx";

interface CountsProps {
  counts: DetailCounts;
}

/** The status strip: specs done and open, waiting and blocked when there are any, and the worklogs. */
export function DetailStrip({ counts }: CountsProps): React.ReactNode {
  return (
    <nav className="pulse pulse-home msd-strip" aria-label="Summary">
      <Pill label={counts.done === 1 ? "spec done" : "specs done"} value={counts.done} tone="ok" href="#specs" />
      <Pill label="open" value={counts.open} tone="gold" href="#specs" />
      {counts.waiting === 0 ? null : <Pill label="waiting" value={counts.waiting} tone="wait" href="#specs" />}
      {counts.blocked === 0 ? null : <Pill label="blocked" value={counts.blocked} tone="bad" href="#specs" />}
      <Pill label={counts.worklogs === 1 ? "worklog" : "worklogs"} value={counts.worklogs} tone="gold" href={counts.worklogs === 0 ? null : "#worklogs"} />
    </nav>
  );
}

interface BodyProps {
  file: MilestoneFile;
}

/** A file's text, or why it is not shown. */
function FileBody({ file }: BodyProps): React.ReactNode {
  const why = omittedText(file.omitted);
  if (file.body === null) return <p className="msd-none">{why ?? "No text."}</p>;
  if (file.body.length === 0) return <p className="msd-none">The file is empty.</p>;
  return <Markdown blocks={file.body} />;
}

interface SpecProps {
  spec: SpecDetailView;
}

/** A spec: the summary is its list row, and the fold holds its full text. */
export function SpecFold({ spec }: SpecProps): React.ReactNode {
  const { view } = spec;
  return (
    <li className="msd-item">
      <details className="msd-fold" id={view.slug} open={spec.open}>
        <summary className="msd-sum msd-sum-spec">
          <Mark ticked={view.ticked} />
          <span className="ms-spec-main">
            <span className="ms-spec-title">
              <span className="ms-id">{view.label}</span>
              <TitleText text={view.title} />
            </span>
            <span className="ms-spec-meta">
              <SpecMeta spec={view} />
              {spec.verifiedAt === null ? null : <span>{`verified ${spec.verifiedAt}`}</span>}
            </span>
          </span>
          <span className="ms-chev" aria-hidden="true" />
        </summary>
        <div className="msd-body">
          <p className="msd-path">
            <code>{spec.file.path}</code>
          </p>
          <FileBody file={spec.file} />
        </div>
      </details>
    </li>
  );
}

interface FileProps {
  file: MilestoneFile;
  /** Words after the size and the time: how a worklog is linked, distilled. */
  extra?: readonly string[];
}

/** A worklog or another file: name, size and last change; the text folded below. */
export function FileFold({ file, extra = [] }: FileProps): React.ReactNode {
  const why = omittedText(file.omitted);
  const meta = (
    <span className="ms-spec-meta">
      <span>{sizeText(file.size)}</span>
      <span>
        changed <Time iso={file.modifiedAt} />
      </span>
      {extra.map((word) => (
        <span key={word}>{word}</span>
      ))}
      {why === null ? null : <span>{why}</span>}
    </span>
  );
  if (file.body === null) {
    return (
      <li className="msd-item">
        <div className="msd-sum msd-sum-file">
          <span className="ms-spec-main">
            <span className="msd-name">{file.path}</span>
            {meta}
          </span>
        </div>
      </li>
    );
  }
  return (
    <li className="msd-item">
      <details className="msd-fold">
        <summary className="msd-sum msd-sum-file">
          <span className="ms-spec-main">
            <span className="msd-name">{file.path}</span>
            {meta}
          </span>
          <span className="ms-chev" aria-hidden="true" />
        </summary>
        <div className="msd-body">
          <FileBody file={file} />
        </div>
      </details>
    </li>
  );
}

/** The words after a worklog's size: how the tracker ties it to the milestone, and a distilled stub. */
export function worklogWords(worklog: MilestoneWorklog): string[] {
  const words = worklog.link === "spec" ? ["a thread names a spec here"] : [];
  if (worklog.distilledAt !== null) words.push(`distilled ${worklog.distilledAt.slice(0, 10)}`);
  return words;
}
