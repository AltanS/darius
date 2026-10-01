/** Settings, About: the host, the version, who is looking and the way to the profiles. */

import { Link, useRouteLoaderData } from "react-router";

import type { Route } from "./+types/settings-about";
import type { loader as rootLoader } from "../root.tsx";
import { Section } from "../components/ui.tsx";
import { statusOf } from "../lib/status.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

export function loader({ context }: Route.LoaderArgs) {
  return { profiles: statusOf(context).profiles.length };
}

export const meta: Route.MetaFunction = () => [{ title: "About | Settings | darius" }];

export default function SettingsAbout({ loaderData }: Route.ComponentProps): React.ReactNode {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  return (
    <div className="st-body stack">
      <Section title="About">
        <dl className="st-about">
          <div>
            <dt>Host</dt>
            <dd>{root?.host}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>darius {root?.version}</dd>
          </div>
          <div>
            <dt>Seen by</dt>
            <dd>{root?.viewer}</dd>
          </div>
          <div>
            <dt>Profiles</dt>
            <dd>
              <Link to="/profiles" className="st-about-link">
                {loaderData.profiles === 0 ? "None yet" : `${loaderData.profiles} ${loaderData.profiles === 1 ? "profile" : "profiles"}`}
              </Link>
            </dd>
          </div>
        </dl>
      </Section>
    </div>
  );
}
