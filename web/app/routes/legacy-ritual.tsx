import { redirect } from "react-router";

import type { Route } from "./+types/legacy-ritual";
import { href } from "../lib/paths.ts";

/** `/p/<project>/rituals/<slug>` was the ritual page; it lives under its workspace now. */
export function loader({ params }: Route.LoaderArgs) {
  return redirect(href({ to: "ritual", ws: params.project, slug: params.slug }), 301);
}

export default function LegacyRitual(): React.ReactNode {
  return null;
}
