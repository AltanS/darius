/**
 * Machines (0.139.0): every host of the synced store, as equal cards
 * (0.140.0): state, name, version, uptime, load, box check, last seen, what
 * runs there now, the checkouts it holds and the djinns pinned to it. The
 * live facts come from each host's own `darius serve`, the rest from the
 * synced ledgers. A host page, in no workspace. Read-only.
 */

import { Link } from "react-router";

import type { Route } from "./+types/hosts";
import { MachineCard } from "../components/machines.tsx";
import { checkoutsOn, pinnedDjinnsOn } from "../lib/fleet.ts";
import { href } from "../lib/paths.ts";
import { columnsOf, differentVersions, peersOf } from "../lib/peers.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

export async function loader({ context }: Route.LoaderArgs) {
  return { fleet: context.fleet(), peers: await peersOf(context), workspaces: context.workspaces() };
}

export const meta: Route.MetaFunction = () => [{ title: "Machines | darius" }];

export default function HostsPage({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { fleet, peers, workspaces } = loaderData;
  const names = columnsOf(fleet, peers);
  const versions = differentVersions(peers);
  const selfVersion = peers.find((peer) => peer.self)?.version ?? fleet.hosts.find((host) => host.self)?.version ?? null;
  return (
    <div className="stack">
      <header className="page-head page-head-tight">
        <h1 className="page-title">Machines</h1>
        <p className="lede">
          The hosts that share this store. Each one is asked live over its own darius serve; the rest comes from the synced ledgers. <Link to={href({ to: "host", page: "fleet" })}>See the workspaces</Link>.
        </p>
      </header>
      {versions.length === 0 ? null : (
        <p className="page-warn tone-late" role="status">
          The hosts run different darius versions: {versions.join(", ")}. Run darius update --hosts to bring them level.
        </p>
      )}
      <div className="mc-grid">
        {names.map((name) => (
          <MachineCard key={name} name={name} peer={peers.find((peer) => peer.host === name)} host={fleet.hosts.find((host) => host.host === name)} selfVersion={selfVersion} checkouts={checkoutsOn(workspaces, name)} pinnedDjinns={pinnedDjinnsOn(workspaces, name)} />
        ))}
      </div>
    </div>
  );
}
