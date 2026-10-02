/** The error boundary of every page: a 404 or a failure, inside the frame. */

import { isRouteErrorResponse, Link, useRouteError, useRouteLoaderData } from "react-router";

import type { loader as rootLoader } from "../root.tsx";
import { href } from "../lib/paths.ts";

interface BackProps {
  /** The scope to go back to: a workspace name, or null for all workspaces. */
  scope: string | null;
}

/** The way out of an error page: the Overview of the scope you were last in. */
function Back({ scope }: BackProps): React.ReactNode {
  return (
    <Link to={href({ to: "overview", ws: scope })} className="back">
      {`Back to ${scope ?? "All workspaces"}`}
    </Link>
  );
}

export function RouteError(): React.ReactNode {
  const error = useRouteError();
  // A page outside the root loader has no last scope: it goes back to all workspaces.
  const scope = useRouteLoaderData<typeof rootLoader>("root")?.lastScope ?? null;
  if (isRouteErrorResponse(error) && error.status === 404) {
    const text = error.data === undefined || error.data === null || error.data === "" ? "No page lives at this address." : String(error.data);
    return (
      <div className="stack">
        <header className="page-head">
          <h1 className="page-title">Nothing here</h1>
          <p className="lede">{text}</p>
        </header>
        <Back scope={scope} />
      </div>
    );
  }
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : "Unknown error";
  return (
    <div className="stack">
      <header className="page-head">
        <h1 className="page-title ink-bad">This page failed</h1>
      </header>
      <pre className="code-block">{message}</pre>
      <Back scope={scope} />
    </div>
  );
}
