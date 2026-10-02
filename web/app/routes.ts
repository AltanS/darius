import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  // The Overview: `/` is the default workspace (else all), `/all` is all workspaces, `/w/:ws` is one.
  index("routes/overview.tsx"),
  route("all", "routes/overview.tsx", { id: "overview-all" }),
  route("w/:ws", "routes/overview.tsx", { id: "overview-workspace" }),
  // The sections, for all workspaces and for one. Findings (0.62.0) filters through its address.
  route("vigils", "routes/vigils.tsx", { id: "vigils-all" }),
  route("w/:ws/vigils", "routes/vigils.tsx", { id: "vigils-workspace" }),
  route("rituals", "routes/rituals.tsx", { id: "rituals-all" }),
  route("w/:ws/rituals", "routes/rituals.tsx", { id: "rituals-workspace" }),
  route("findings", "routes/findings.tsx", { id: "findings-all" }),
  route("w/:ws/findings", "routes/findings.tsx", { id: "findings-workspace" }),
  route("milestones", "routes/milestones.tsx", { id: "milestones-all" }),
  route("w/:ws/milestones", "routes/milestones.tsx", { id: "milestones-workspace" }),
  // One milestone in full: README, spec texts, worklogs (0.42.0).
  route("w/:ws/milestones/:milestone", "routes/milestone.tsx"),
  // Settings is a layout with tabs: General, Notifications, Backups, About.
  route("settings", "routes/settings.tsx", [
    index("routes/settings-general.tsx"),
    route("notifications", "routes/settings-notifications.tsx"),
    route("backups", "routes/settings-backups.tsx"),
    route("about", "routes/settings-about.tsx"),
  ]),
  // The machine, the store and the sync hosts of this host (0.44.0).
  route("status", "routes/status.tsx"),
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
