import { redirect } from "react-router";

import type { Route } from "./+types/legacy-run";
import { runPath } from "../lib/format.ts";

export function loader({ params }: Route.LoaderArgs) {
  return redirect(runPath(params.project, params.run), 301);
}
