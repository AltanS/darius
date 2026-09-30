import { data, Link } from "react-router";

import type { Route } from "./+types/project";
import { ComingUp, Waiting } from "../components/agenda.tsx";
import { KindChips } from "../components/chip.tsx";
import { LivePanel, PhoneMore, Pulse } from "../components/pulse.tsx";
import { Row, RowList } from "../components/row.tsx";
import { ReportRow, RunList } from "../components/runs.tsx";
import { Empty, Fold, Section, Time } from "../components/ui.tsx";
import { buildAgenda } from "../lib/agenda.ts";
import { vigilAnchor } from "../lib/format.ts";
import { statusOf } from "../lib/status.ts";
import { useHashTarget } from "../lib/target.ts";
import { vigilWord } from "../lib/state-words.ts";
import { activity, asksYou, isDjinn, isUnattended, reportExcerpt, stuckFor } from "../lib/view.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

const RECENT = 10;

/** Latest-report rows a phone shows before its own button; the rest repeat what Coming up says. */
const REPORTS_PHONE = 3;

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
        <p className="page-meta proj-meta meta-dots">
          {project.maxMode === null ? null : <span>at most {project.maxMode} mode</span>}
          <span>
            synced <Time iso={project.lastSync} />
          </span>
        </p>
        {project.checkout === null ? <p className="page-meta proj-meta meta-dots">not linked on this host</p> : (
          <p className="proj-path">
            <code>
              <PathText path={project.checkout} />
            </code>
          </p>
        )}
      </header>

      {project.error === null ? null : (
        <div className="card card-accent edge-bad mb-10">
          <p className="card-title ink-bad">darius could not read this project</p>
          <pre className="code-block mt-3">{project.error}</pre>
        </div>
      )}

      <Pulse data={{ live, openVigils, overdue: agenda.overdue, dueToday: agenda.dueToday, waiting: agenda.waiting.length, flaggedWaiting: agenda.waiting.filter((row) => row.flagged).length }} />

      <div className="proj-body">
        <div className="band">
          <LivePanel live={live} />
        </div>

        <div className="board">
          <div className="board-main">
            <ComingUp agenda={agenda} anchors target={target} />

            {djinns.length === 0 && unattended > 0 ? null : (
              <Section title="Latest reports" id="reports">
                {djinns.length === 0 ? (
                  <Empty>darius runs no ritual of this project yet.</Empty>
                ) : (
                  <div className="panel">
                    <PhoneMore hidden={djinns.length - REPORTS_PHONE} noun="report">
                      <RowList bare className="stagger">
                        {djinns.map(({ ritual, last, report }, index) => (
                          <ReportRow key={ritual.slug} project={project.name} ritual={ritual} last={last} report={report} showProject={false} className={index >= REPORTS_PHONE ? "phone-extra" : undefined} />
                        ))}
                      </RowList>
                    </PhoneMore>
                  </div>
                )}
              </Section>
            )}

            <Section title="Recent runs" id="recent" aside={<Link to={`/runs?project=${encodeURIComponent(project.name)}`}>All runs</Link>}>
              <div className="panel">
                <PhoneMore hidden={recent.length - RECENT_PHONE} noun="run">
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
                  <RowList bare>
                    {closedVigils.slice(0, CLOSED_SHOWN).map((vigil) => {
                      const state = vigilWord(vigil);
                      const id = vigilAnchor(vigil.slug);
                      return <Row key={vigil.slug} id={id} kind="vigil" title={vigil.title} chips={<KindChips kind="vigil" />} state={state} meta={vigil.lastOutcome === null ? [] : [`last check ${vigil.lastOutcome}`]} className={`target-row${target === id ? " is-target" : ""}`} />;
                    })}
                  </RowList>
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
