import { data, Link } from "react-router";

import type { Route } from "./+types/project";
import { ComingUp, Waiting } from "../components/agenda.tsx";
import { KindIcon } from "../components/kind.tsx";
import { LivePanel, PhoneMore, Pulse } from "../components/pulse.tsx";
import { DjinnCard, RunList } from "../components/runs.tsx";
import { Empty, Fold, Section, Status, Time } from "../components/ui.tsx";
import { buildAgenda } from "../lib/agenda.ts";
import { vigilAnchor } from "../lib/format.ts";
import { statusOf } from "../lib/status.ts";
import { useHashTarget } from "../lib/target.ts";
import { vigilBadge } from "../lib/tone.ts";
import { activity, asksYou, isDjinn, isUnattended, reportExcerpt, stuckFor } from "../lib/view.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

const RECENT = 10;

/** Djinn cards a phone shows before its own button; the rest repeat what Coming up says. */
const DJINNS_PHONE = 1;

/** Recent runs a phone shows before its own button. */
const RECENT_PHONE = 3;

/** Rows of Waiting on an event before its fold: a project page has more to show than the home page. */
const WAITING_PROJECT = 3;

/** Closed vigils shown in their fold; a long-running project has dozens. */
const CLOSED_SHOWN = 10;

export function loader({ context, params }: Route.LoaderArgs) {
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
  // Open, for the head of the page: what runs or waits now.
  const live = runs.filter((run) => run.phase !== "closed" || asksYou(run)).map((run) => ({ run, stuck: stuckFor(run, status.generatedAt) }));
  const agenda = buildAgenda({ projects: [project], today: status.today });
  return {
    project,
    djinns,
    live,
    agenda,
    /** Rituals darius runs: a project with some but no djinn hides the Djinns section. */
    unattended: project.rituals.filter((ritual) => isUnattended(ritual)).length,
    openVigils: project.vigils.filter((vigil) => vigil.state !== "closed"),
    closedVigils: project.vigils.filter((vigil) => vigil.state === "closed"),
    recent: runs.slice(0, RECENT),
  };
}

export const meta: Route.MetaFunction = ({ params }) => [{ title: `${params.project} | darius` }];

function rowClass(target: string, id: string, extra = ""): string {
  return `row target-row${extra}${target === id ? " is-target" : ""}`;
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

export default function Project({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { project, djinns, live, agenda, unattended, openVigils, closedVigils, recent } = loaderData;
  const target = useHashTarget();
  const closedTarget = closedVigils.some((vigil) => vigilAnchor(vigil.slug) === target);
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

      <Pulse data={{ project: project.name, live, openVigils, overdue: agenda.overdue, waiting: agenda.waiting.length }} />

      <div className="proj-body">
        <div className="band">
          <LivePanel live={live} />
        </div>

        <div className="board">
          <div className="board-main">
            <ComingUp agenda={agenda} anchors target={target} />

            {djinns.length === 0 && unattended > 0 ? null : (
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
            <Waiting rows={agenda.waiting} shown={WAITING_PROJECT} showProject={false} anchors target={target} />

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
                            <span className="row-title has-kind">
                              <KindIcon kind="vigil" titled className="kind-lead" />
                              {vigil.title}
                            </span>
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
