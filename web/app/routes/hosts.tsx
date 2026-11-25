/**
 * Machines (0.139.0): every host of the synced store, with its live state
 * from its own `darius serve` and its facts from the ledgers here. A host
 * page, in no workspace. Read-only.
 */

import { Link } from "react-router";

import type { Route } from "./+types/hosts";
import { MachineRow } from "../components/machines.tsx";
import { Section } from "../components/ui.tsx";
import { href } from "../lib/paths.ts";
import { columnsOf, differentVersions, peersOf } from "../lib/peers.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

export async function loader({ context }: Route.LoaderArgs) {
  return { fleet: context.fleet(), peers: await peersOf(context) };
}

export const meta: Route.MetaFunction = () => [{ title: "Machines | darius" }];

export default function HostsPage({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { fleet, peers } = loaderData;
  const names = columnsOf(fleet, peers);
  const versions = differentVersions(peers);
  return (
    <div className="stack">
      <header className="page-head page-head-tight">
        <h1 className="page-title">Machines</h1>
        <p className="lede">
          The hosts that share this store. Each one is asked live over its own darius serve; the rest comes from the synced ledgers. <Link to={href({ to: "host", page: "topology" })}>See what runs where</Link>.
        </p>
      </header>
      {versions.length === 0 ? null : (
        <p className="page-warn tone-late" role="status">
          The hosts run different darius versions: {versions.join(", ")}. Run darius update --hosts to bring them level.
        </p>
      )}
      <Section title="Hosts">
        <ul className="sy-list panel">
          {names.map((name) => (
            <MachineRow key={name} name={name} peer={peers.find((peer) => peer.host === name)} host={fleet.hosts.find((host) => host.host === name)} />
          ))}
        </ul>
      </Section>
    </div>
  );
}
