import { useContext, useEffect, useState } from "react";
import { isRouteErrorResponse, Link, Links, Meta, Outlet, Scripts, ScrollRestoration, useRevalidator, useRouteLoaderData } from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { Shell } from "./components/shell.tsx";
import { ClockProvider } from "./lib/clock.tsx";
import { NonceContext } from "./lib/nonce.ts";
import { href } from "./lib/paths.ts";
import { DEFAULT_SETTINGS, readSettings, type Theme } from "./lib/settings.ts";
import { statusOf } from "./lib/status.ts";
import { shellData } from "./lib/scope.ts";

export function loader({ context, request }: Route.LoaderArgs) {
  // --- settings block (theme, density, motion): read from the cookie, put on <html> by Layout ---
  const settings = readSettings(request.headers.get("cookie"));
  // --- end settings block ---
  const status = statusOf(context);
  return {
    // Also on the client, so hydration renders the same nonce attributes.
    nonce: context.nonce,
    settings,
    viewer: context.viewer,
    host: status.host,
    version: status.version,
    generatedAt: status.generatedAt,
    today: status.today,
    utcOffset: status.utcOffset,
    // The workspaces, the tab badges, the last scope and the host line: what Places and the tabs show (lib/scope.ts).
    ...shellData(status, request),
  };
}

export type RootData = Awaited<ReturnType<typeof loader>>;

// Places and the tab badges count what needs the operator, so they reload with every page.
export function shouldRevalidate(): boolean {
  return true;
}

export const meta: Route.MetaFunction = () => [{ title: "darius" }];

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "manifest", href: "/manifest.webmanifest" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
];

// --- settings block: the browser chrome follows the theme (the paper ground of the light theme, the night of the dark) ---
const COLOR_SCHEMES = { dark: "dark", light: "light", system: "dark light" } satisfies Record<Theme, string>;
const NIGHT = "#15100b";
const PAPYRUS = "#f0e6c9";

interface ThemeColorProps {
  theme: Theme;
}

function ThemeColor({ theme }: ThemeColorProps): React.ReactNode {
  if (theme === "dark") return <meta name="theme-color" content={NIGHT} />;
  if (theme === "light") return <meta name="theme-color" content={PAPYRUS} />;
  return (
    <>
      <meta name="theme-color" content={PAPYRUS} media="(prefers-color-scheme: light)" />
      <meta name="theme-color" content={NIGHT} media="(prefers-color-scheme: dark)" />
    </>
  );
}
// --- end settings block ---

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps): React.ReactNode {
  const data = useRouteLoaderData<typeof loader>("root");
  // Keep the nonce of the first render; later loads bring new ones that no CSP matches.
  const [nonce] = useState(useContext(NonceContext) ?? data?.nonce);
  // --- settings block: the attributes the themes in app.css key on ---
  const settings = data?.settings ?? DEFAULT_SETTINGS;
  return (
    <html lang="en" data-theme={settings.theme} data-density={settings.density} data-motion={settings.motion}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="color-scheme" content={COLOR_SCHEMES[settings.theme]} />
        <ThemeColor theme={settings.theme} />
        {/* --- end settings block --- */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="darius" />
        <Meta />
        <Links nonce={nonce} />
      </head>
      <body>
        {children}
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

const REFRESH_MS = 60_000;

/** Reload the data every minute while the tab is visible, and on return to a stale tab. */
function useRefresh(generatedAt: string): void {
  const revalidator = useRevalidator();
  const { revalidate } = revalidator;
  useEffect(() => {
    const stale = (): boolean => Date.now() - Date.parse(generatedAt) >= REFRESH_MS;
    const refresh = (): void => {
      if (document.visibilityState === "visible" && stale()) void revalidate();
    };
    const timer = setInterval(refresh, REFRESH_MS / 4);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [generatedAt, revalidate]);
}

export default function App({ loaderData }: Route.ComponentProps): React.ReactNode {
  useRefresh(loaderData.generatedAt);
  return (
    <ClockProvider generatedAt={loaderData.generatedAt} today={loaderData.today} offset={loaderData.utcOffset}>
      <Shell data={loaderData}>
        <Outlet />
      </Shell>
    </ClockProvider>
  );
}

/** The last resort, when even the frame data failed. Pages have their own boundary. */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps): React.ReactNode {
  const data = useRouteLoaderData<typeof loader>("root");
  const title = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : "darius could not show this page";
  const detail = isRouteErrorResponse(error) ? String(error.data ?? "") : error instanceof Error ? error.message : "";
  return (
    <main className="wa page-main reading stack">
      <p className="brand">darius</p>
      <h1 className="page-title ink-bad">{title}</h1>
      {detail === "" ? null : <pre className="code-block">{detail}</pre>}
      <p className="text-muted">{data === undefined ? "The status read failed." : `Host ${data.host}.`}</p>
      <Link to={href({ to: "overview", ws: data?.lastScope ?? null })}>{`Back to ${data?.lastScope ?? "All workspaces"}`}</Link>
    </main>
  );
}
