import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  // The Overview: `/` is the default workspace (else all), `/all` is all workspaces, `/w/:ws` is one.
  index("routes/overview.tsx"),
  route("all", "routes/overview.tsx", { id: "overview-all" }),
  route("w/:ws", "routes/overview.tsx", { id: "overview-workspace" }),
  // The three sections, for all workspaces and for one.
  route("vigils", "routes/vigils.tsx", { id: "vigils-all" }),
  route("w/:ws/vigils", "routes/vigils.tsx", { id: "vigils-workspace" }),
  route("rituals", "routes/rituals.tsx", { id: "rituals-all" }),
  route("w/:ws/rituals", "routes/rituals.tsx", { id: "rituals-workspace" }),
  route("milestones", "routes/milestones.tsx", { id: "milestones-all" }),
  route("w/:ws/milestones", "routes/milestones.tsx", { id: "milestones-workspace" }),
  route("settings", "routes/settings.tsx"),
  route("runs", "routes/runs.tsx"),
  // The URL of the first status page (0.9.0), kept so old links still work.
  route("runs/:project/:run", "routes/legacy-run.tsx"),
  route("profiles", "routes/profiles.tsx"),
  // The project page, now the workspace Overview: a redirect.
  route("p/:project", "routes/project.tsx"),
  route("p/:project/rituals/:slug", "routes/ritual.tsx"),
  route("p/:project/runs/:run", "routes/run.tsx"),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
