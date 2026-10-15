import { data, Link } from "react-router";

import type { Route } from "./+types/activity";
import { Timeline } from "../components/activity.tsx";
import { ChipRow, chipClass } from "../components/chip-row.tsx";
import { Crumbs } from "../components/crumbs.tsx";
import { Empty, Section } from "../components/ui.tsx";
import { ACTIVITY_CAP, entryMatches, filterSentence, isStarting, KIND_WORDS, kindsOf, olderDays, windowStart } from "../lib/activity-place.ts";
import { ACTIVITY_ACTORS, ACTIVITY_DAYS, activityFilterOf, activityQuery, href, type ActivityFilter } from "../lib/paths.ts";
import { isSelftest } from "../lib/home.ts";
import { readSettings } from "../lib/settings.ts";
import { statusOf } from "../lib/status.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

/**
 * The Activity place (0.94.0), for `/activity` (all workspaces) and
 * `/w/:ws/activity` (one): the events of every ritual, vigil and finding,
 * newest first. The window is 7 days; "Show older" widens it to 30 and 90.
 * All workspaces show at most 500 entries, and the page says so.
 */
export function loader({ context, request, params: route }: Route.LoaderArgs) {
  const project = route.ws ?? "";
  const filter = activityFilterOf(new URL(request.url).searchParams);
  const status = statusOf(context);
  if (project !== "" && !status.projects.some((candidate) => candidate.name === project)) throw data(`No workspace named ${project} on this host.`, { status: 404 });
  // The self-test workspace stays out of the list of every project, as in the other lists, unless the settings show it (or the address names it).
  const { showSelftest } = readSettings(request.headers.get("cookie"));
  const names = new Set(status.projects.filter((candidate) => project === candidate.name || (project === "" && (showSelftest || !isSelftest(candidate.name)))).map((candidate) => candidate.name));
  const all = context.activity(project === "" ? null : project, {}).filter((entry) => names.has(entry.project));
  const since = windowStart(Date.parse(status.generatedAt), filter.days);
  const inWindow = all.filter((entry) => entry.at >= since);
  // The kind chips offer the kinds the window holds, before the kind filter narrows it.
  const kinds = kindsOf(inWindow.filter((entry) => entryMatches(entry, { ...filter, kind: "" })));
  const kept = inWindow.filter((entry) => entryMatches(entry, filter));
  const isCapped = project === "" && kept.length > ACTIVITY_CAP;
  const shown = isCapped ? kept.slice(0, ACTIVITY_CAP) : kept;
  const next = olderDays(filter.days);
  const hasOlder = next !== null && !isCapped && all.some((entry) => entry.at < since && entryMatches(entry, filter));
  return {
    project,
    filter,
    kinds,
    starting: shown.filter((entry) => isStarting(entry)),
    entries: shown.filter((entry) => !isStarting(entry)),
    isCapped,
    older: hasOlder ? next : null,
    projects: [...names],
  };
}

export const meta: Route.MetaFunction = ({ data: loaded }) => [{ title: loaded === undefined || loaded.project === "" ? "Activity | darius" : `Activity · ${loaded.project} | darius` }];

/** The address of the page for a workspace ("" for all) and a filter: the query holds only what differs from the plain list. */
function activityHref(project: string, filter: ActivityFilter): string {
  return href({ to: "section", ws: project === "" ? null : project, section: "activity", query: activityQuery(filter) });
}

export default function Activity({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { project, filter, kinds, starting, entries, isCapped, older, projects } = loaderData;
  const change = (part: Partial<ActivityFilter>): string => activityHref(project, { ...filter, ...part });
  const isEmpty = starting.length === 0 && entries.length === 0;
  return (
    <div>
      <header className="page-head">
        <Crumbs />
        <h1 className="page-title">Activity</h1>
        <p className="page-meta">
          <span>{filterSentence(filter, project)}</span>
        </p>
      </header>
      <div className="board">
        <div className="board-main">
          {isEmpty ? (
            <>
              <Empty>{`Nothing happened in the last ${filter.days} days${filter.kind === "" && filter.by === "" ? "" : " that matches this filter"}.`}</Empty>
              {older === null ? null : (
                <p>
                  <Link to={change({ days: older })} className="st-btn st-btn-small" preventScrollReset>
                    Show older
                  </Link>
                </p>
              )}
            </>
          ) : (
            <Timeline entries={entries} starting={starting} project={project} lead={{ workspace: project === "" }} olderHref={older === null ? null : change({ days: older })} isCapped={isCapped} />
          )}
        </div>
        <aside className="board-rail rail-first rail-filter">
          <Section title="Filter">
            <nav aria-label="Filter" className="filters panel panel-pad">
              {project !== "" || projects.length < 2 ? null : (
                <ChipRow label="Workspace" current={project}>
                  <Link to={activityHref("", filter)} className={chipClass(true)} aria-current="true">
                    all workspaces
                  </Link>
                  {projects.map((name) => (
                    <Link key={name} to={activityHref(name, filter)} className={chipClass(false)}>
                      {name}
                    </Link>
                  ))}
                </ChipRow>
              )}
              <ChipRow label="Window" current={String(filter.days)}>
                {ACTIVITY_DAYS.map((days) => (
                  <Link key={days} to={change({ days })} className={chipClass(days === filter.days)} aria-current={days === filter.days ? "true" : undefined} preventScrollReset>
                    {`${days} days`}
                  </Link>
                ))}
              </ChipRow>
              <ChipRow label="Done by" current={filter.by}>
                {(["", ...ACTIVITY_ACTORS] as const).map((name) => (
                  <Link key={name} to={change({ by: name })} className={chipClass(name === filter.by)} aria-current={name === filter.by ? "true" : undefined} preventScrollReset>
                    {name === "" ? "anyone" : name}
                  </Link>
                ))}
              </ChipRow>
              {kinds.length === 0 && filter.kind === "" ? null : (
                <ChipRow label="Kind" current={filter.kind}>
                  {(["", ...(filter.kind === "" || kinds.includes(filter.kind) ? kinds : [...kinds, filter.kind])] as const).map((name) => (
                    <Link key={name} to={change({ kind: name })} className={chipClass(name === filter.kind)} aria-current={name === filter.kind ? "true" : undefined} preventScrollReset>
                      {name === "" ? "any kind" : KIND_WORDS[name]}
                    </Link>
                  ))}
                </ChipRow>
              )}
            </nav>
          </Section>
        </aside>
      </div>
    </div>
  );
}
