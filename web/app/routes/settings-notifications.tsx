/** Settings, Notifications: the switch for push alerts on this device, and a read-only line about email on this host. */

import type { Route } from "./+types/settings-notifications";
import { PushSwitch } from "../components/push.tsx";
import { SettingRow, SettingsCard } from "../components/settings-ui.tsx";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

export function loader({ context }: Route.LoaderArgs) {
  return { emailSetUp: context.emailSetUp() };
}

export const meta: Route.MetaFunction = () => [{ title: "Notifications | Settings | darius" }];

export default function SettingsNotifications({ loaderData }: Route.ComponentProps): React.ReactNode {
  return (
    <div className="st-body">
      <SettingsCard title="Alerts" intro="darius alerts you to held runs, questions and failures. Turn alerts on for each device you use.">
        <PushSwitch />
      </SettingsCard>
      <SettingsCard title="Email" intro="A flare can also send an email. This page only shows whether this host can.">
        <SettingRow label="This host" help="No address is shown.">
          <span className="st-value">{loaderData.emailSetUp ? "Email: set up" : "Email: not set up on this host"}</span>
        </SettingRow>
      </SettingsCard>
    </div>
  );
}
