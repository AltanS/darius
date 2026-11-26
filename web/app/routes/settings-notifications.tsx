/** Settings, Notifications: the switch for push alerts on this device, and a read-only line about email on this host. */

import type { Route } from "./+types/settings-notifications";
import { PushSwitch } from "../components/push.tsx";
import { SettingRow, SettingsCard } from "../components/settings-ui.tsx";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

export function loader({ context }: Route.LoaderArgs) {
  return { emailSetUp: context.emailSetUp(), emailProblem: context.emailProblem() };
}

/** A broken file reads as a problem with its reason, not as a quiet "not set up". The reason holds no value. */
function emailLine(isSetUp: boolean, problem: string | null): string {
  if (problem !== null) return `Email: not set up on this machine. Problem: ${problem}`;
  return isSetUp ? "Email: set up" : "Email: not set up on this machine";
}

export const meta: Route.MetaFunction = () => [{ title: "Notifications | Settings | darius" }];

export default function SettingsNotifications({ loaderData }: Route.ComponentProps): React.ReactNode {
  return (
    <div className="st-body">
      <SettingsCard title="Alerts" intro="darius alerts you to runs that wait for your answer, and to questions and failures. Turn alerts on for each device you use.">
        <PushSwitch />
      </SettingsCard>
      <SettingsCard title="Email" intro="A candle can also send an email. This page only shows whether this machine can.">
        <SettingRow label="This machine" help="No address is shown.">
          <span className="st-value">{emailLine(loaderData.emailSetUp, loaderData.emailProblem)}</span>
        </SettingRow>
      </SettingsCard>
    </div>
  );
}
