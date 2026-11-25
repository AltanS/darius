import { redirect } from "react-router";

import type { Route } from "./+types/topology";
import { href } from "../lib/paths.ts";

/** `/topology` (0.139.0) became the placement matrix of Fleet (0.140.0). Old links keep working. */
export function loader(_args: Route.LoaderArgs) {
  return redirect(href({ to: "host", page: "fleet", hash: "placement" }), 301);
}

export default function Topology(): React.ReactNode {
  return null;
}
