/**
 * The Milestones page, read-only. A milestone is one compact row: its number
 * in mono, its title, a thin bar and "103 of 143 checks done". It opens in
 * place (a details element) and lists its specs: a tick or an open circle, the
 * label, the title, the checks, what it waits for, and Blocked, Waiting or
 * Skipped in words, and a link to the milestone's own page (README, spec
 * texts, worklogs). The data is in `lib/milestones.ts`.
 */

import { Link } from "react-router";

import { href } from "../lib/paths.ts";
import { type MilestoneGroup, type MilestoneView, type SpecView, type WorkspaceMilestones } from "../lib/milestones.ts";
import { StateWord } from "./row.tsx";
import { TitleText } from "./ui.tsx";

interface MarkProps {
  ticked: boolean;
}

/** A tick in a circle when every check is done, an open circle otherwise. */
export function Mark({ ticked }: MarkProps): React.ReactNode {
  return (
    <svg className={`ms-mark ${ticked ? "ms-mark-done" : "ms-mark-open"}`} width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={ticked ? "All checks done" : "Checks open"}>
      <circle cx="9" cy="9" r="7.25" />
      {ticked ? <path d="M5.6 9.3L8 11.6L12.4 6.6" /> : null}
    </svg>
  );
}

interface SpecItemProps {
  spec: SpecView;
}

/** The line under a spec title: Blocked, Waiting or Skipped, the checks, what it waits for. */
export function SpecMeta({ spec }: SpecItemProps): React.ReactNode {
  return (
    <>
      {spec.word === null ? null : <StateWord state={spec.word} />}
      <span>{spec.checks}</span>
      {spec.dependsOn.length === 0 ? null : <span>{`depends on ${spec.dependsOn.join(", ")}`}</span>}
    </>
  );
}

function SpecItem({ spec }: SpecItemProps): React.ReactNode {
  return (
    <li className="ms-spec">
      <Mark ticked={spec.ticked} />
      <div className="ms-spec-main">
        <p className="ms-spec-title">
          <span className="ms-id">{spec.label}</span>
          <TitleText text={spec.title} />
        </p>
        <p className="ms-spec-meta">
          <SpecMeta spec={spec} />
        </p>
      </div>
    </li>
  );
}

interface MilestoneItemProps {
  milestone: MilestoneView;
  workspace: string;
}

function MilestoneItem({ milestone, workspace }: MilestoneItemProps): React.ReactNode {
  const { target } = milestone;
  return (
    <li className="ms-item">
      <details className="ms-row" id={milestone.id}>
        <summary className="ms-sum">
          <span className="ms-top">
            <span className="ms-id">{milestone.id}</span>
            <span className="ms-title">
              <TitleText text={milestone.title} />
            </span>
            <span className="ms-chev" aria-hidden="true" />
          </span>
          <span className="ms-prog">
            <progress className={`ms-bar${milestone.ticked ? " ms-bar-done" : ""}`} value={milestone.done} max={Math.max(milestone.total, 1)} aria-hidden="true" />
            <span className="ms-count">{milestone.checks}</span>
          </span>
          {target === null || !target.past ? null : (
            <span className="ms-late ms-late-sum">{`target ${target.text}, past`}</span>
          )}
        </summary>
        <div className="ms-body">
          <p className="ms-meta">
            {milestone.word === null ? null : <StateWord state={milestone.word} />}
            <span>{milestone.started === null ? "not started" : `started ${milestone.started}`}</span>
            {target === null ? <span>no target</span> : target.past ? <span className="ms-late">{`target ${target.text}, past`}</span> : <span>{`target ${target.text}`}</span>}
          </p>
          <p className="ms-open">
            <Link to={href({ to: "milestone", ws: workspace, ref: milestone.ref })}>{`Open ${milestone.id}: README, spec texts, worklogs`}</Link>
          </p>
          {milestone.specs.length === 0 ? (
            <p className="ms-none">No specs yet.</p>
          ) : (
            <ul className="ms-specs">
              {milestone.specs.map((spec) => (
                <SpecItem key={spec.slug} spec={spec} />
              ))}
            </ul>
          )}
        </div>
      </details>
    </li>
  );
}

interface GroupProps {
  group: MilestoneGroup;
  workspace: string;
}

function Group({ group, workspace }: GroupProps): React.ReactNode {
  return (
    <li className="ms-group-item">
      <h3 className={`ms-group tone-${group.tone}`}>
        {group.title} <span className="ms-group-n">{group.rows.length}</span>
      </h3>
      <ul className="ms-rows">
        {group.rows.map((row) => (
          <MilestoneItem key={row.slug} milestone={row} workspace={workspace} />
        ))}
      </ul>
    </li>
  );
}

interface WorkspaceProps {
  workspace: WorkspaceMilestones;
  /** Name the workspace above its milestones: the all-workspaces page does. */
  named: boolean;
}

/** The milestones of one workspace: its groups in one frame, then "N archived". */
export function Workspace({ workspace, named }: WorkspaceProps): React.ReactNode {
  const empty = workspace.groups.length === 0;
  return (
    <section className="ms-ws" aria-label={named ? undefined : `Milestones of ${workspace.name}`}>
      {named ? (
        <h2 className="ms-ws-name">
          <Link to={href({ to: "section", ws: workspace.name, section: "milestones" })}>{workspace.name}</Link>
        </h2>
      ) : null}
      {workspace.error === null ? null : <p className="ms-error">darius could not read this workspace: {workspace.error}</p>}
      {empty ? (
        <p className="ms-empty">No milestones in this workspace.</p>
      ) : (
        <ul className="ms-groups">
          {workspace.groups.map((group) => (
            <Group key={group.key} group={group} workspace={workspace.name} />
          ))}
        </ul>
      )}
      {workspace.archived === 0 ? null : <p className="ms-archived">{`${workspace.archived} archived`}</p>}
    </section>
  );
}
