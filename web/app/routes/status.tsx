/**
 * The status page of one darius host (0.44.0): the machine and the store, the
 * hosts that sync, the last syncs and, the main part, the backups. The root
 * route reloads every loader each minute, so this page stays current; the
 * backup controls ask for a reload after each write.
 */

import type { Route } from "./+types/status";
import { Backups } from "../components/backups.tsx";
import { Hosts, Machine, Projects, StatusStrip } from "../components/system.tsx";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

export function loader({ context }: Route.LoaderArgs) {
  return { system: context.system(), backups: context.backups() };
}

export const meta: Route.MetaFunction = () => [{ title: "Status | darius" }];

export default function StatusPage({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { system, backups } = loaderData;
  return (
    <div className="stack">
      <header className="page-head page-head-tight">
        <h1 className="page-title">Status</h1>
        <p className="lede">
          {system.host}, darius {system.version}. The machine, the store and the backups of this host.
        </p>
      </header>
      <StatusStrip system={system} backups={backups} />
      <Backups backups={backups} />
      <div className="sy-grid">
        <Machine system={system} />
        <Hosts hosts={system.hosts} />
      </div>
      <Projects system={system} />
    </div>
  );
}
