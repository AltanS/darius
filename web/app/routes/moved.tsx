/**
 * The addresses 0.141.0 renamed, kept as 301 redirects: `/fleet` and
 * `/topology` go to Workspaces, `/hosts` to Machines, `/hosts/<name>` to
 * `/machines/<name>`, and `/status` to the page of this machine.
 */

import { data, redirect } from "react-router";

import type { Route } from "./+types/moved";
import { movedTo } from "../lib/paths.ts";
import { statusOf } from "../lib/status.ts";

export function loader({ context, request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const target = movedTo(url.pathname, url.search, statusOf(context).host);
  if (target === null) throw data("This address moved, and darius does not know where.", { status: 404 });
  return redirect(target, 301);
}

export default function Moved(): React.ReactNode {
  return null;
}
