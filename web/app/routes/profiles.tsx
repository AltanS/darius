import type { Route } from "./+types/profiles";
import { Empty, Status } from "../components/ui.tsx";
import { statusOf } from "../lib/status.ts";

const DEFAULT_PROFILE = "default";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

export function loader({ context }: Route.LoaderArgs) {
  return { profiles: statusOf(context).profiles };
}

export const meta: Route.MetaFunction = () => [{ title: "Profiles | darius" }];

export default function Profiles({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { profiles } = loaderData;
  // With no profile named, darius uses the one called `default` (src/harness/profile.ts, DEFAULT_PROFILE).
  const hasDefault = profiles.some((profile) => profile.name === DEFAULT_PROFILE);
  return (
    <div>
      <header className="page-head">
        <h1 className="page-title">Profiles</h1>
        <p className="lede">
          How darius starts a harness for a ritual. A ritual picks a profile by name.{" "}
          {hasDefault
            ? "A ritual that names none uses the profile named default, unless its repo picks another in .darius.toml."
            : "A ritual that names none, in a repo that picks none, runs with the harness defaults: Claude Code, headless, permissions skipped, so the darius gate alone decides."}
        </p>
      </header>
      <div className="board">
        <div className="board-main">
          {profiles.length === 0 ? (
            <Empty>No profile yet. Add one with darius profile add.</Empty>
          ) : (
            <ul className="rows">
              {profiles.map((profile) => (
                <li key={profile.name} id={`profile-${profile.name}`} className="row target-row">
                  <span className="row-main">
                    <span className="row-title font-mono">{profile.name}</span>
                    <span className="row-sub">
                      {[profile.harness, profile.model ?? "default model", profile.effort === null ? null : `${profile.effort} effort`, `${profile.permissions} permissions`, profile.surface]
                        .filter((part) => part !== null)
                        .join(", ")}
                    </span>
                    {profile.name === DEFAULT_PROFILE ? (
                      <span className="mt-1">
                        <Status tone="gold" label="used when a ritual names none" />
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
