import { redirect } from "react-router";

import type { Route } from "./+types/index";
import { href } from "../lib/paths.ts";
import { defaultWorkspaceOf } from "../lib/scope.ts";
import { readSettings } from "../lib/settings.ts";
import { statusOf } from "../lib/status.ts";

/** `/` shows nothing itself: it opens the default workspace when this host has one, else all workspaces. */
export function loader({ context, request }: Route.LoaderArgs) {
  const workspace = defaultWorkspaceOf(statusOf(context), readSettings(request.headers.get("cookie")));
  return redirect(href({ to: "overview", ws: workspace }), 302);
}

export default function Index(): React.ReactNode {
  return null;
}
