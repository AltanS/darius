import { data, Link } from "react-router";

import type { Route } from "./+types/project";
import { LivePanel, PhoneMore, Pulse, ScheduledPanel, VigilPanel, type ScheduledEntry } from "../components/pulse.tsx";
import { DjinnCard, RunList } from "../components/runs.tsx";
import { DateLabel, Empty, Fold, Section, Status, Time } from "../components/ui.tsx";
import { ritualPath, vigilAnchor } from "../lib/format.ts";
import { statusOf } from "../lib/status.ts";
import { useHashTarget } from "../lib/target.ts";
import { ritualBadge, vigilBadge } from "../lib/tone.ts";
import { activity, asksYou, cadenceText, isDjinn, isUnattended, reportExcerpt, runState, stuckFor } from "../lib/view.ts";
import type { RitualRow, VigilRow } from "../../../src/web/api.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

const RECENT = 10;

/** Manual rituals shown before the fold. */
const MANUAL_SHOWN = 3;

/** Djinn cards a phone shows before its own button; the rest repeat what Scheduled says. */
const DJINNS_PHONE = 1;

/** Recent runs a phone shows before its own button. */
const RECENT_PHONE = 3;

/** Closed vigils shown in their fold; a long-running project has dozens. */
const CLOSED_SHOWN = 10;

/** Manual rituals: the ones to do soon first, then the rest by date, retired and dormant ones last. */
function manualRank(ritual: RitualRow): number {
  if (ritual.lifecycle !== "active") return 3;
  if (ritual.nextDue === null) return 2;
  return ritual.overdueDays > 0 || ritual.isDue ? 0 : 1;
}

function byManualOrder(left: RitualRow, right: RitualRow): number {
  return manualRank(left) - manualRank(right) || right.overdueDays - left.overdueDays || (left.nextDue ?? "").localeCompare(right.nextDue ?? "") || left.title.localeCompare(right.title);
}

/** Armed vigils: flagged first, then late or due today, then dated ones, then the ones that wait for an event. */
function vigilRank(vigil: VigilRow, today: string): number {
  if (vigil.flagged) return 0;
  if (vigil.due !== null && vigil.due <= today) return 1;
  return vigil.due === null ? 3 : 2;
}

export function loader({ context, params, request }: Route.LoaderArgs) {
  const status = statusOf(context);
  const project = status.projects.find((candidate) => candidate.name === params.project);
  if (project === undefined) throw data(`No project named ${params.project} on this host.`, { status: 404 });
  const runs = activity([project], { withImported: false });
  const lastOf = (slug: string) => runs.find((run) => run.slug === slug) ?? null;
  // The same split as the home page: a djinn follows a repo skill, a scheduled check does not.
  const djinns = project.rituals
    .filter((ritual) => isDjinn(ritual))
    .map((ritual) => {
      const finished = runs.find((run) => run.slug === ritual.slug && run.findingsSha !== null) ?? null;
      return { ritual, last: lastOf(ritual.slug), report: finished === null ? null : reportExcerpt(context.run(project.name, finished.run)) };
    });
  const manual = project.rituals.filter((ritual) => !isUnattended(ritual)).toSorted(byManualOrder);
  // Open and scheduled, for the head of the page: what runs or waits now, and what darius runs next.
  const live = runs.filter((run) => run.phase !== "closed" || asksYou(run)).map((run) => ({ run, stuck: stuckFor(run, status.generatedAt) }));
  const scheduled: ScheduledEntry[] = project.rituals
    .filter((ritual) => isUnattended(ritual) && ritual.lifecycle === "active")
    .toSorted((left, right) => (left.nextDue ?? "9999").localeCompare(right.nextDue ?? "9999") || left.title.localeCompare(right.title))
    .map((ritual) => {
      const last = lastOf(ritual.slug);
      return { ritual, badge: last === null ? { tone: "idle", label: "No run yet" } : runState(last) };
    });
  return {
    project,
    djinns,
    live,
    scheduled,
    overdue: manual.filter((ritual) => ritual.lifecycle === "active" && ritual.overdueDays > 0).length,
    manual,
    showManual: new URL(request.url).searchParams.get("show") === "manual",
    openVigils: project.vigils.filter((vigil) => vigil.state !== "closed").toSorted((left, right) => vigilRank(left, status.today) - vigilRank(right, status.today) || (left.due ?? "9999").localeCompare(right.due ?? "9999") || left.title.localeCompare(right.title)),
    closedVigils: project.vigils.filter((vigil) => vigil.state === "closed"),
    recent: runs.slice(0, RECENT),
  };
}

export const meta: Route.MetaFunction = ({ params }) => [{ title: `${params.project} | darius` }];

function rowClass(target: string, id: string, extra = ""): string {
  return `row target-row${extra}${target === id ? " is-target" : ""}`;
}

interface ManualStateProps {
  ritual: RitualRow;
}

/** When a manual ritual is due, in the same words and colours as everywhere else. */
function ManualState({ ritual }: ManualStateProps): React.ReactNode {
  const badge = ritualBadge(ritual);
  if (badge.label === "scheduled") return <DateLabel iso={ritual.nextDue} />;
  // "overdue 9 days", not "overdue 9 d": a lone small-cap d after a number reads badly.
  if (badge.tone === "late" && ritual.overdueDays > 0) return <Status tone={badge.tone} label={`overdue ${ritual.overdueDays} ${ritual.overdueDays === 1 ? "day" : "days"}`} />;
  return <Status tone={badge.tone} label={badge.label === "due" ? "due today" : badge.label} />;
}

interface PathTextProps {
  path: string;
}

/** A path that may break after each slash, so a long checkout wraps at a folder. */
function PathText({ path }: PathTextProps): React.ReactNode {
  return path.split("/").map((part, index) => (
    <span key={`${index}`}>
      {index === 0 ? "" : "/"}
      <wbr />
      {part}
    </span>
  ));
}

/** "Manual rituals (7), 5 overdue. Done by hand, darius does not run them." */
function manualSummary(manual: readonly RitualRow[]): string {
  const overdue = manual.filter((ritual) => ritual.lifecycle === "active" && ritual.overdueDays > 0).length;
  return `Manual rituals (${manual.length})${overdue === 0 ? "" : `, ${overdue} overdue`}. Done by hand, darius does not run them.`;
}

interface ManualRowsProps {
  project: string;
  rituals: readonly RitualRow[];
}

function ManualRows({ project, rituals }: ManualRowsProps): React.ReactNode {
  return (
    <ul className="rows">
      {rituals.map((ritual) => {
        const resting = ritual.lifecycle !== "active" || ritual.nextDue === null;
        return (
          <li key={ritual.slug}>
            <Link to={ritualPath(project, ritual.slug)} className={`row${resting ? " row-dim" : ""}`}>
              <span className="row-main">
                <span className="row-title">{ritual.title}</span>
                <span className="row-sub">{[ritual.slug, cadenceText(ritual.cadence)].filter((part) => part !== null).join(", ")}</span>
              </span>
              <span className="row-time">
                <ManualState ritual={ritual} />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default function Project({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { project, djinns, live, scheduled, overdue, manual, showManual, openVigils, closedVigils, recent } = loaderData;
  const target = useHashTarget();
  const closedTarget = closedVigils.some((vigil) => vigilAnchor(vigil.slug) === target);
  const manualHead = manual.slice(0, MANUAL_SHOWN);
  const manualRest = manual.slice(MANUAL_SHOWN);
  return (
    <div className="proj">
      <header className="page-head page-head-tight proj-head">
        <h1 className="page-title">{project.name}</h1>
        <p className="page-meta">
          {project.checkout === null ? (
            <span>not linked on this host</span>
          ) : (
            <code className="proj-path">
              <PathText path={project.checkout} />
            </code>
          )}
          {project.maxMode === null ? null : <span>at most {project.maxMode} mode</span>}
          <span>
            synced <Time iso={project.lastSync} />
          </span>
        </p>
      </header>

      {project.error === null ? null : (
        <div className="card card-accent edge-bad mb-10">
          <p className="card-title ink-bad">darius could not read this project</p>
          <pre className="code-block mt-3">{project.error}</pre>
        </div>
      )}

      <Pulse data={{ project: project.name, live, scheduled, openVigils, overdue, manual: manual.length }} />

      <div className="proj-body">
        <div className="band">
          <LivePanel live={live} />
          <ScheduledPanel project={project.name} entries={scheduled} />
        </div>

        {openVigils.length === 0 ? null : (
          <div className="band-tail">
            <VigilPanel vigils={openVigils} target={target} />
          </div>
        )}

        <div className="board">
          <div className="board-main">
            {djinns.length === 0 && scheduled.length > 0 ? null : (
              <Section title="Djinns" id="djinns">
                {djinns.length === 0 ? (
                  <Empty>darius runs no ritual of this project yet.</Empty>
                ) : (
                  <PhoneMore hidden={djinns.length - DJINNS_PHONE} noun="djinns">
                    <div className="cards djinn-list stagger">
                      {djinns.map(({ ritual, last, report }, index) => (
                        <div key={ritual.slug} className={index >= DJINNS_PHONE ? "phone-extra" : undefined}>
                          <DjinnCard project={project.name} ritual={ritual} last={last} report={report} showProject={false} />
                        </div>
                      ))}
                    </div>
                  </PhoneMore>
                )}
              </Section>
            )}

            <Section title="Recent runs" id="recent" aside={<Link to={`/runs?project=${encodeURIComponent(project.name)}`}>All runs</Link>}>
              <div className="panel">
                <PhoneMore hidden={recent.length - RECENT_PHONE} noun="runs">
                  <RunList runs={recent} showProject={false} empty="darius has not run anything here yet." phoneShown={RECENT_PHONE} />
                </PhoneMore>
              </div>
            </Section>
          </div>

          <aside className="board-rail">
            {manual.length === 0 ? null : (
              <Section title="By hand" id="manual">
                <div className="panel">
                  <p className="rail-note">{manualSummary(manual)}</p>
                  <ManualRows project={project.name} rituals={manualHead} />
                  {manualRest.length === 0 ? null : (
                    <Fold open={showManual} summary={`${manualRest.length} more`}>
                      <ManualRows project={project.name} rituals={manualRest} />
                    </Fold>
                  )}
                </div>
              </Section>
            )}

            {closedVigils.length === 0 ? null : (
              <div className="folds proj-closed">
                <Fold open={closedTarget} summary={`Closed vigils (${closedVigils.length})`}>
                  <ul className="rows">
                    {closedVigils.slice(0, CLOSED_SHOWN).map((vigil) => {
                      const badge = vigilBadge(vigil);
                      const id = vigilAnchor(vigil.slug);
                      return (
                        <li key={vigil.slug} id={id} className={rowClass(target, id)}>
                          <span className="row-main">
                            <span className="row-title">{vigil.title}</span>
                            {vigil.lastOutcome === null ? null : <span className="row-sub">last check {vigil.lastOutcome}</span>}
                          </span>
                          <Status tone={badge.tone} label={badge.label} />
                        </li>
                      );
                    })}
                  </ul>
                  {closedVigils.length > CLOSED_SHOWN ? <p className="rail-note mt-3">{closedVigils.length - CLOSED_SHOWN} older ones are not shown.</p> : null}
                </Fold>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
