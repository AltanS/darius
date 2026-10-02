import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  // `/` is a redirect: to the default workspace, else to all workspaces. `/all` is all workspaces, `/w/:ws` is one.
  index("routes/index.tsx"),
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
  // The runs of one workspace, and the detail pages of a workspace: a ritual, a run, a milestone (README, spec texts, worklogs).
  route("w/:ws/runs", "routes/runs.tsx", { id: "runs-workspace" }),
  route("w/:ws/rituals/:slug", "routes/ritual.tsx"),
  route("w/:ws/runs/:run", "routes/run.tsx"),
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
  route("runs", "routes/runs.tsx", { id: "runs-all" }),
  route("profiles", "routes/profiles.tsx"),
  // Old addresses, kept as 301 redirects: the first status page (0.9.0) and the /p/ project pages.
  route("runs/:project/:run", "routes/legacy-run.tsx", { id: "legacy-run-first" }),
  route("p/:project", "routes/project.tsx"),
  route("p/:project/rituals/:slug", "routes/legacy-ritual.tsx"),
  route("p/:project/runs/:run", "routes/legacy-run.tsx", { id: "legacy-run-project" }),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
