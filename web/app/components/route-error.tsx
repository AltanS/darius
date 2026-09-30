/** The error boundary of every page: a 404 or a failure, inside the frame. */

import { isRouteErrorResponse, Link, useRouteError } from "react-router";

export function RouteError(): React.ReactNode {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) {
    const text = error.data === undefined || error.data === null || error.data === "" ? "No page lives at this address." : String(error.data);
    return (
      <div className="stack">
        <header className="page-head">
          <h1 className="page-title">Nothing here</h1>
          <p className="lede">{text}</p>
        </header>
        <Link to="/">Back home</Link>
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
      <Link to="/">Back home</Link>
    </div>
  );
}
