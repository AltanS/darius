/** Settings, About: the host, the version, who is looking and the way to the profiles. */

import { Link, useRouteLoaderData } from "react-router";

import type { Route } from "./+types/settings-about";
import type { loader as rootLoader } from "../root.tsx";
import { SettingRow, SettingsCard } from "../components/settings-ui.tsx";
import { href } from "../lib/paths.ts";
import { statusOf } from "../lib/status.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

export function loader({ context }: Route.LoaderArgs) {
  return { profiles: statusOf(context).profiles.length };
}

export const meta: Route.MetaFunction = () => [{ title: "About | Settings | darius" }];

export default function SettingsAbout({ loaderData }: Route.ComponentProps): React.ReactNode {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const profiles = loaderData.profiles;
  return (
    <div className="st-body">
      <SettingsCard title="This host">
        <SettingRow label="Host" help="The machine that serves this page.">
          <span className="st-value">{root?.host}</span>
        </SettingRow>
        <SettingRow label="Version" help="The darius release on this host.">
          <span className="st-value">darius {root?.version}</span>
        </SettingRow>
        <SettingRow label="Seen by" help="Who this host thinks you are.">
          <span className="st-value">{root?.viewer}</span>
        </SettingRow>
        <SettingRow label="Profiles" help="Named presets for starting an agent harness.">
          <Link to={href({ to: "host", page: "profiles" })} className="st-value st-value-link">
            {profiles === 0 ? "None yet" : `${profiles} ${profiles === 1 ? "profile" : "profiles"}`}
          </Link>
        </SettingRow>
      </SettingsCard>
    </div>
  );
}
