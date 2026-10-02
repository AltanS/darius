import { data, Link } from "react-router";

import type { Route } from "./+types/milestone";
import { DetailStrip, FileFold, SpecFold, worklogWords } from "../components/milestone-detail.tsx";
import { Markdown } from "../components/markdown.tsx";
import { StateWord } from "../components/row.tsx";
import { Crumbs, Empty, Section, TitleText } from "../components/ui.tsx";
import { href } from "../lib/paths.ts";
import { milestoneDetailView, omittedText } from "../lib/milestones.ts";
import { statusOf } from "../lib/status.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

/**
 * Serves `/w/:ws/milestones/:milestone`: one milestone of the workspace's
 * linked checkout in full, read-only. `:milestone` is the id (`M12`), or the
 * directory name (`M12-cart`) when two open milestones share an id.
 */
export function loader({ context, params }: Route.LoaderArgs) {
  const status = statusOf(context);
  const project = status.projects.find((candidate) => candidate.name === params.ws);
  if (project === undefined) throw data(`No workspace named ${params.ws} on this host.`, { status: 404 });
  const detail = context.milestone(params.ws, params.milestone);
  if (detail === null) throw data(`No open milestone ${params.milestone} in workspace ${params.ws}.`, { status: 404 });
  return { view: milestoneDetailView(detail, project.milestones, status.today) };
}

export const meta: Route.MetaFunction = ({ data: loaded, params }) => [{ title: `${loaded === undefined ? params.milestone : `${loaded.view.head.id} ${loaded.view.head.title}`} · ${params.ws} | darius` }];

/** Read-only: a legacy tracker milestone with its README, spec texts, worklogs and other files. */
export default function Milestone({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { view } = loaderData;
  const { head, project } = view;
  const { target } = head;
  const readmeWhy = view.readme === null ? null : omittedText(view.readme.omitted);
  return (
    <div className="ms-page msd">
      <header className="ms-head">
        <Crumbs>
          <Link to={href({ to: "overview", ws: project })}>{project}</Link>
          <span aria-hidden="true"> / </span>
          <Link to={href({ to: "section", ws: project, section: "milestones" })}>Milestones</Link>
        </Crumbs>
        <h1 className="ms-h1 msd-h1">
          <span className="ms-id msd-id">{head.id}</span>
          <TitleText text={head.title} />
        </h1>
        <p className="ms-meta msd-meta">
          <StateWord state={view.status} />
          <span>{head.started === null ? "not started" : `started ${head.started}`}</span>
          {target === null ? <span>no target</span> : target.past ? <span className="ms-late">{`target ${target.text}, past`}</span> : <span>{`target ${target.text}`}</span>}
          <code className="msd-dir">{`.tracker/${view.dir}/`}</code>
        </p>
        <p className="ms-prog msd-prog">
          <progress className={`ms-bar${head.ticked ? " ms-bar-done" : ""}`} value={head.done} max={Math.max(head.total, 1)} aria-hidden="true" />
          <span className="ms-count">{head.checks}</span>
        </p>
        <p className="ms-sub">Read-only, from the tracker</p>
      </header>

      <DetailStrip counts={view.counts} />

      <Section title="README" id="readme">
        {view.readme === null ? (
          <Empty>This milestone has no README.</Empty>
        ) : view.readme.body === null ? (
          <Empty>{readmeWhy ?? "The README could not be read."}</Empty>
        ) : (
          <div className="msd-card measure">
            <Markdown blocks={view.readme.body} />
          </div>
        )}
      </Section>

      <Section title={`Specs (${view.specs.length})`} id="specs">
        {view.specs.length === 0 ? (
          <Empty>No specs yet.</Empty>
        ) : (
          <ul className="msd-list">
            {view.specs.map((spec) => (
              <SpecFold key={spec.view.slug} spec={spec} />
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Worklogs (${view.worklogs.length})`} id="worklogs">
        {view.worklogs.length === 0 ? (
          <Empty>No worklog belongs to this milestone.</Empty>
        ) : (
          <ul className="msd-list">
            {view.worklogs.map((worklog) => (
              <FileFold key={worklog.path} file={worklog} extra={worklogWords(worklog)} />
            ))}
          </ul>
        )}
      </Section>

      {view.others.length === 0 ? null : (
        <Section title={`Other files (${view.others.length})`} id="files">
          <ul className="msd-list">
            {view.others.map((file) => (
              <FileFold key={file.path} file={file} />
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
