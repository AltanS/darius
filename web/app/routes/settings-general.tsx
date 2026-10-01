/**
 * Settings, General: how this browser shows darius. Theme, density, the
 * workspace `/` opens, the self-test workspace and motion live in one cookie
 * (lib/settings.ts) that the root loader reads, so the server renders the
 * right theme with no flash. The page writes the cookie in the browser and
 * asks for the data again; nothing reaches the store.
 */

import { useId, useState } from "react";
import { useRevalidator, useRouteLoaderData } from "react-router";

import type { Route } from "./+types/settings-general";
import type { loader as rootLoader } from "../root.tsx";
import { Choice, SettingRow, SettingsCard, Switch } from "../components/settings-ui.tsx";
import { isSelftest } from "../lib/home.ts";
import { DEFAULT_SETTINGS, SETTINGS_COOKIE, SETTINGS_MAX_AGE, settingsValue, type Density, type Motion, type Settings, type Theme } from "../lib/settings.ts";
import { statusOf } from "../lib/status.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

export function loader({ context }: Route.LoaderArgs) {
  const status = statusOf(context);
  return {
    // The default workspace can name the self-test workspace only while it is shown.
    workspaces: status.projects.map((project) => ({ name: project.name, selftest: isSelftest(project.name) })),
  };
}

export const meta: Route.MetaFunction = () => [{ title: "Settings | darius" }];

const ALL_WORKSPACES = "";

/** The cookie as `document.cookie` takes it: the whole site, a year, and Secure where the page is HTTPS. */
function cookieText(settings: Settings, secure: boolean): string {
  return `${SETTINGS_COOKIE}=${settingsValue(settings)}; path=/; max-age=${SETTINGS_MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** Put the new theme, density and motion on <html> at once; the reload of the data brings the same values. */
function paint(settings: Settings): void {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.dataset.density = settings.density;
  root.dataset.motion = settings.motion;
}

const THEMES: ReadonlyArray<readonly [Theme, string]> = [
  ["dark", "Dark"],
  ["light", "Light"],
  ["system", "System"],
];
const DENSITIES: ReadonlyArray<readonly [Density, string]> = [
  ["comfortable", "Comfortable"],
  ["compact", "Compact"],
];
const MOTIONS: ReadonlyArray<readonly [Motion, string]> = [
  ["system", "System"],
  ["reduce", "Always"],
];

export default function SettingsGeneral({ loaderData }: Route.ComponentProps): React.ReactNode {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const { revalidate } = useRevalidator();
  const ids = useId();
  // This page is the one writer of the cookie, so its own copy stays true after each change.
  const [settings, setSettings] = useState<Settings>(root?.settings ?? DEFAULT_SETTINGS);

  const change = (patch: Partial<Settings>): void => {
    const next = { ...settings, ...patch };
    setSettings(next);
    document.cookie = cookieText(next, location.protocol === "https:");
    paint(next);
    void revalidate();
  };

  // A default workspace that is gone, or hidden self-test, stays in the list so the choice shows as it is saved.
  const listed = loaderData.workspaces.filter((workspace) => settings.showSelftest || !workspace.selftest || workspace.name === settings.defaultWorkspace);
  const saved = settings.defaultWorkspace;
  const names = saved !== null && !listed.some((workspace) => workspace.name === saved) ? [...listed.map((workspace) => workspace.name), saved] : listed.map((workspace) => workspace.name);

  return (
    <div className="st-body">
      <SettingsCard title="Appearance">
        <SettingRow label="Theme" labelId={`${ids}-theme`} help="Dark is the default. System follows your device.">
          <Choice labelledBy={`${ids}-theme`} value={settings.theme} options={THEMES} onPick={(theme) => change({ theme })} />
        </SettingRow>
        <SettingRow label="Density" labelId={`${ids}-density`} help="Compact puts more rows on the screen.">
          <Choice labelledBy={`${ids}-density`} value={settings.density} options={DENSITIES} onPick={(density) => change({ density })} />
        </SettingRow>
      </SettingsCard>
      <SettingsCard title="Workspaces">
        <SettingRow label="Default workspace" htmlFor={`${ids}-workspace`} help="The workspace that the home address opens.">
          <select
            id={`${ids}-workspace`}
            className="st-select"
            value={saved ?? ALL_WORKSPACES}
            onChange={(event) => change({ defaultWorkspace: event.currentTarget.value === ALL_WORKSPACES ? null : event.currentTarget.value })}
          >
            <option value={ALL_WORKSPACES}>All workspaces</option>
            {names.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label="Show the self-test workspace" labelId={`${ids}-selftest`} help="darius-selftest proves an install. It stays hidden unless you turn this on." inline>
          <Switch on={settings.showSelftest} labelledBy={`${ids}-selftest`} onFlip={() => change({ showSelftest: !settings.showSelftest })} />
        </SettingRow>
      </SettingsCard>
      <SettingsCard title="Motion">
        <SettingRow label="Reduce motion" labelId={`${ids}-motion`} help="System follows the setting of your device.">
          <Choice labelledBy={`${ids}-motion`} value={settings.motion} options={MOTIONS} onPick={(motion) => change({ motion })} />
        </SettingRow>
      </SettingsCard>
    </div>
  );
}
