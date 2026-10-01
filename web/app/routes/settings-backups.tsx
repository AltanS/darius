/**
 * Settings, Backups: the backups of this host. The loader reads them on this
 * tab only. The root route reloads every loader each minute, and the controls
 * ask for a reload after each write.
 */

import type { Route } from "./+types/settings-backups";
import { Backups } from "../components/backups.tsx";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

export function loader({ context }: Route.LoaderArgs) {
  return { backups: context.backups() };
}

export const meta: Route.MetaFunction = () => [{ title: "Backups | Settings | darius" }];

export default function SettingsBackups({ loaderData }: Route.ComponentProps): React.ReactNode {
  return <Backups backups={loaderData.backups} />;
}
