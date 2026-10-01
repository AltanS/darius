/**
 * Settings, General: how this browser shows darius. Theme, density, the
 * workspace `/` opens, the self-test workspace and motion live in one cookie
 * (lib/settings.ts) that the root loader reads, so the server renders the
 * right theme with no flash. The page writes the cookie in the browser and
 * asks for the data again; nothing reaches the store.
 */

import { useState } from "react";
import { useRevalidator, useRouteLoaderData } from "react-router";

import type { Route } from "./+types/settings-general";
import type { loader as rootLoader } from "../root.tsx";
import { Section } from "../components/ui.tsx";
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

interface ChoiceProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onPick: (value: T) => void;
}

/** One choice of a few words: a row of buttons, one pressed. */
function Choice<T extends string>({ label, value, options, onPick }: ChoiceProps<T>): React.ReactNode {
  return (
    <div className="st-seg" role="radiogroup" aria-label={label}>
      {options.map(([option, text]) => (
        <button key={option} type="button" role="radio" aria-checked={option === value} className={option === value ? "on" : undefined} onClick={() => onPick(option)}>
          {text}
        </button>
      ))}
    </div>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

function Field({ label, hint, children }: FieldProps): React.ReactNode {
  return (
    <div className="st-field">
      <div className="st-label">{label}</div>
      {children}
      {hint === undefined ? null : <p className="st-hint">{hint}</p>}
    </div>
  );
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
    <div className="st-body stack">
      <Section title="Appearance">
        <Field label="Theme" hint="Dark is the default. System follows your device.">
          <Choice label="Theme" value={settings.theme} options={THEMES} onPick={(theme) => change({ theme })} />
        </Field>
        <Field label="Density" hint="Compact puts more rows on the screen.">
          <Choice label="Density" value={settings.density} options={DENSITIES} onPick={(density) => change({ density })} />
        </Field>
      </Section>
      <Section title="Workspaces">
        <Field label="Default workspace" hint="The workspace that the home address opens.">
          <select
            className="st-select"
            aria-label="Default workspace"
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
        </Field>
        <div className="st-toggle">
          <div className="st-toggle-text">
            <span id="st-selftest" className="st-label">
              Show the self-test workspace
            </span>
            <span className="st-hint">darius-selftest, used to prove an install. Hidden unless you turn this on.</span>
          </div>
          <button type="button" role="switch" aria-checked={settings.showSelftest} aria-labelledby="st-selftest" className="st-switch" onClick={() => change({ showSelftest: !settings.showSelftest })} />
        </div>
      </Section>
      <Section title="Motion">
        <Field label="Reduce motion" hint="System follows the setting of your device.">
          <Choice label="Reduce motion" value={settings.motion} options={MOTIONS} onPick={(motion) => change({ motion })} />
        </Field>
      </Section>
    </div>
  );
}
