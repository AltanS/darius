/** Settings, Notifications: the switch for push alerts on this device. */

import type { Route } from "./+types/settings-notifications";
import { PushSwitch } from "../components/push.tsx";
import { Section } from "../components/ui.tsx";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

export const meta: Route.MetaFunction = () => [{ title: "Notifications | Settings | darius" }];

export default function SettingsNotifications(): React.ReactNode {
  return (
    <div className="st-body stack">
      <Section title="Notifications">
        <div className="st-push">
          <PushSwitch />
        </div>
      </Section>
    </div>
  );
}
