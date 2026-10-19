/**
 * The error boundary of every page: a 404 or a failure, inside the frame, under a still gem (0.98.0).
 * A read that got no answer is no failure of the page: it says "No connection." with a Retry
 * that loads the data again, never "Failed to fetch". The root boundary uses the same block.
 */

import { isRouteErrorResponse, Link, useRevalidator, useRouteError, useRouteLoaderData } from "react-router";

import type { loader as rootLoader } from "../root.tsx";
import { isNetworkError } from "../lib/connection.ts";
import { href } from "../lib/paths.ts";
import { Gem } from "./nav-icons.tsx";

/** "No connection." and a Retry that loads the data of this page again. */
export function NoConnection(): React.ReactNode {
  const revalidator = useRevalidator();
  return (
    <div className="stack">
      <header className="page-head">
        <Gem size={32} />
        <h1 className="page-title">No connection.</h1>
      </header>
      <p>
        <button type="button" className="st-btn st-btn-main" onClick={() => void revalidator.revalidate()} disabled={revalidator.state !== "idle"} aria-busy={revalidator.state !== "idle"}>
          Retry
        </button>
      </p>
    </div>
  );
}

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
  if (isNetworkError(error)) return <NoConnection />;
  if (isRouteErrorResponse(error) && error.status === 404) {
    const text = error.data === undefined || error.data === null || error.data === "" ? "No page lives at this address." : String(error.data);
    return (
      <div className="stack">
        <header className="page-head">
          <Gem size={32} />
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
        <Gem size={32} />
        <h1 className="page-title ink-bad">This page failed</h1>
      </header>
      <pre className="code-block">{message}</pre>
      <Back scope={scope} />
    </div>
  );
}
