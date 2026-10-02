/**
 * The operator's settings for this browser: theme, density, the default
 * workspace, the self-test workspace, motion. The web app never writes to
 * the store, so they live in one cookie, which the server reads on every
 * request: the page renders in the right theme with no flash. The settings
 * page writes the cookie in the browser; anything unknown in it falls back
 * to the default, so an old or hand-edited cookie never breaks a page.
 */

export type Theme = "dark" | "light" | "system";
export type Density = "comfortable" | "compact";
export type Motion = "system" | "reduce";

export interface Settings {
  theme: Theme;
  density: Density;
  /** The workspace `/` opens; null opens all workspaces. */
  defaultWorkspace: string | null;
  showSelftest: boolean;
  motion: Motion;
}

export const SETTINGS_COOKIE = "darius-settings";

/** A year, in seconds: the cookie outlives a browser restart. */
export const SETTINGS_MAX_AGE = 365 * 24 * 60 * 60;

export const DEFAULT_SETTINGS: Settings = { theme: "dark", density: "comfortable", defaultWorkspace: null, showSelftest: false, motion: "system" };

const THEMES: ReadonlySet<string> = new Set(["dark", "light", "system"]);
const DENSITIES: ReadonlySet<string> = new Set(["comfortable", "compact"]);
const MOTIONS: ReadonlySet<string> = new Set(["system", "reduce"]);

/** The value of one cookie in a `Cookie` header, or null. */
export function cookieValue(header: string | null, name: string): string | null {
  if (header === null) return null;
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at !== -1 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

/** One `key=value` pair of the cookie value, as a map. */
function pairs(value: string): Map<string, string> {
  const found = new Map<string, string>();
  let text = value;
  try {
    text = decodeURIComponent(value);
  } catch {
    return found;
  }
  for (const part of text.split("&")) {
    const at = part.indexOf("=");
    if (at > 0) found.set(part.slice(0, at), part.slice(at + 1));
  }
  return found;
}

function pick<T extends string>(value: string | undefined, allowed: ReadonlySet<string>, fallback: T): T {
  // SAFETY: each caller passes the set of exactly the members of T, so a value found in it is a T.
  return value !== undefined && allowed.has(value) ? (value as T) : fallback;
}

/** The settings in a request's `Cookie` header; the defaults for anything missing or unknown. */
export function readSettings(cookieHeader: string | null): Settings {
  const raw = cookieValue(cookieHeader, SETTINGS_COOKIE);
  if (raw === null) return DEFAULT_SETTINGS;
  const found = pairs(raw);
  const workspace = found.get("ws") ?? "";
  return {
    theme: pick(found.get("theme"), THEMES, DEFAULT_SETTINGS.theme),
    density: pick(found.get("density"), DENSITIES, DEFAULT_SETTINGS.density),
    defaultWorkspace: /^[\w.-]{1,100}$/u.test(workspace) ? workspace : null,
    showSelftest: found.get("selftest") === "1",
    motion: pick(found.get("motion"), MOTIONS, DEFAULT_SETTINGS.motion),
  };
}

/** The cookie value for some settings: `readSettings` reads it back to the same settings. */
export function settingsValue(settings: Settings): string {
  const text = [`theme=${settings.theme}`, `density=${settings.density}`, `ws=${settings.defaultWorkspace ?? ""}`, `selftest=${settings.showSelftest ? "1" : "0"}`, `motion=${settings.motion}`].join("&");
  return encodeURIComponent(text);
}

/** The cookie that remembers the last scope you were in: a workspace name, or `*` for all workspaces. */
export const SCOPE_COOKIE = "darius_scope";

/** The scope cookie as `document.cookie` takes it. */
export function scopeCookieText(scope: string | null): string {
  return `${SCOPE_COOKIE}=${encodeURIComponent(scope ?? "*")}; path=/; max-age=${SETTINGS_MAX_AGE}; SameSite=Lax`;
}

/** What the scope cookie says: `undefined` when it is missing or unreadable, null for all workspaces, else a workspace name. */
export function readScopeCookie(cookieHeader: string | null): string | null | undefined {
  const raw = cookieValue(cookieHeader, SCOPE_COOKIE);
  if (raw === null) return undefined;
  try {
    const value = decodeURIComponent(raw);
    return value === "*" ? null : value === "" ? undefined : value;
  } catch {
    return undefined;
  }
}
