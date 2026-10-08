/**
 * The status page of one darius host (0.44.0): the machine and the store, the
 * hosts that sync and the last syncs. The backups live in the settings
 * (`/settings/backups`); this page keeps the "since backup" pill and a line
 * when they have a problem. The root route reloads every loader each minute,
 * so this page stays current.
 */

import { Link } from "react-router";

import type { BackupsStatus } from "../../../src/web/api.ts";
import type { Route } from "./+types/status";
import { Hosts, Machine, Projects, StatusStrip } from "../components/system.tsx";
import { href } from "../lib/paths.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

export function loader({ context }: Route.LoaderArgs) {
  return { system: context.system(), backups: context.backups() };
}

export const meta: Route.MetaFunction = () => [{ title: "Status | darius" }];

/** What is wrong with the backups, in one short sentence; null when nothing is. */
function backupTrouble(backups: BackupsStatus): string | null {
  if (backups.problems.length > 0) return backups.problems.length === 1 ? "One thing blocks backups." : `${backups.problems.length} things block backups.`;
  if (backups.last !== null && !backups.last.ok) return "The last backup failed.";
  return null;
}

export default function StatusPage({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { system, backups } = loaderData;
  const trouble = backupTrouble(backups);
  return (
    <div className="stack">
      <header className="page-head page-head-tight">
        <h1 className="page-title">Status</h1>
        <p className="lede">
          {system.host}, darius {system.version}. The machine, the store and the sync of this host.
        </p>
      </header>
      <StatusStrip system={system} backups={backups} />
      {trouble === null ? null : (
        <p className="page-warn tone-late" role="status">
          {trouble} <Link to={href({ to: "host", page: "settings/backups" })}>Open the backups</Link>
        </p>
      )}
      <div className="sy-grid">
        <Machine system={system} />
        <Hosts hosts={system.hosts} bucketsDiffer={system.backupBucketsDiffer} />
      </div>
      <Projects system={system} />
    </div>
  );
}
