import { useContext, useEffect, useState } from "react";
import { isRouteErrorResponse, Link, Links, Meta, Outlet, Scripts, ScrollRestoration, useRevalidator, useRouteLoaderData } from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { Shell } from "./components/shell.tsx";
import { ClockProvider } from "./lib/clock.tsx";
import { NonceContext } from "./lib/nonce.ts";
import { statusOf } from "./lib/status.ts";
import { isSelftest, selftestLines } from "./lib/home.ts";
import { isImported, questionCount } from "./lib/view.ts";

export function loader({ context }: Route.LoaderArgs) {
  const status = statusOf(context);
  return {
    // Also on the client, so hydration renders the same nonce attributes.
    nonce: context.nonce,
    viewer: context.viewer,
    host: status.host,
    version: status.version,
    generatedAt: status.generatedAt,
    today: status.today,
    utcOffset: status.utcOffset,
    // Questions, not held runs, over the projects the home page counts.
    questions: questionCount(status.projects.filter((project) => !isSelftest(project.name)).flatMap((project) => project.runs.filter((run) => !isImported(run)))),
    selftest: selftestLines(status),
    projects: status.projects.map((project) => ({
      name: project.name,
      error: project.error !== null,
      // Questions that wait in this project, for the count in the project menu.
      questions: questionCount(project.runs.filter((run) => !isImported(run))),
    })),
  };
}

export type RootData = Awaited<ReturnType<typeof loader>>;

// The top bar counts open questions, so it reloads with every page.
export function shouldRevalidate(): boolean {
  return true;
}

export const meta: Route.MetaFunction = () => [{ title: "darius" }];

export const links: Route.LinksFunction = () => [{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" }];

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps): React.ReactNode {
  const data = useRouteLoaderData<typeof loader>("root");
  // Keep the nonce of the first render; later loads bring new ones that no CSP matches.
  const [nonce] = useState(useContext(NonceContext) ?? data?.nonce);
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="color-scheme" content="dark" />
        <meta name="theme-color" content="#15100b" />
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

/** The last resort, when even the top bar data failed. Pages have their own boundary. */
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
      <Link to="/">Back home</Link>
    </main>
  );
}
