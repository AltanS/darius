/** Settings, Notifications: the switch for push alerts on this device. */

import type { Route } from "./+types/settings-notifications";
import { PushSwitch } from "../components/push.tsx";
import { SettingsCard } from "../components/settings-ui.tsx";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

export const meta: Route.MetaFunction = () => [{ title: "Notifications | Settings | darius" }];

export default function SettingsNotifications(): React.ReactNode {
  return (
    <div className="st-body">
      <SettingsCard title="Alerts" intro="darius alerts you to held runs, questions and failures. Turn alerts on for each device you use.">
        <PushSwitch />
      </SettingsCard>
    </div>
  );
}
