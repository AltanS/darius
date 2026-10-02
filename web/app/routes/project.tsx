import { redirect } from "react-router";

import type { Route } from "./+types/project";
import { href } from "../lib/paths.ts";

/** `/p/<project>` was the project page; a project is now a workspace, and its Overview is `/w/<project>`. Old links keep working. */
export function loader({ params }: Route.LoaderArgs) {
  return redirect(href({ to: "overview", ws: params.project }), 301);
}

export default function Project(): React.ReactNode {
  return null;
}
