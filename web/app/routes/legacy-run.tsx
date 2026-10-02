import { redirect } from "react-router";

import type { Route } from "./+types/legacy-run";
import { href } from "../lib/paths.ts";

export function loader({ params }: Route.LoaderArgs) {
  return redirect(href({ to: "run", ws: params.project, run: params.run }), 301);
}
