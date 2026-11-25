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
  // Candles (0.112.0): the list for all workspaces and for one, and the detail of one candle (project and key).
  route("candles", "routes/candles.tsx", { id: "candles-all" }),
  route("w/:ws/candles", "routes/candles.tsx", { id: "candles-workspace" }),
  route("milestones", "routes/milestones.tsx", { id: "milestones-all" }),
  route("w/:ws/milestones", "routes/milestones.tsx", { id: "milestones-workspace" }),
  // The seventh place (0.94.0): what happened, for all workspaces and for one. The query holds kind, by and days.
  route("activity", "routes/activity.tsx", { id: "activity-all" }),
  route("w/:ws/activity", "routes/activity.tsx", { id: "activity-workspace" }),
  // The runs of one workspace, and the detail pages of a workspace: a ritual, a vigil, a run, a milestone (README, spec texts, worklogs).
  route("w/:ws/runs", "routes/runs.tsx", { id: "runs-workspace" }),
  route("w/:ws/rituals/:slug", "routes/ritual.tsx"),
  route("w/:ws/vigils/:slug", "routes/vigil.tsx"),
  route("w/:ws/candles/:key", "routes/candle.tsx"),
  route("w/:ws/runs/:run", "routes/run.tsx"),
  route("w/:ws/milestones/:milestone", "routes/milestone.tsx"),
  // Settings is a layout with tabs: General, Notifications, Backups, About.
  route("settings", "routes/settings.tsx", [
    index("routes/settings-general.tsx"),
    route("notifications", "routes/settings-notifications.tsx"),
    route("backups", "routes/settings-backups.tsx"),
    route("about", "routes/settings-about.tsx"),
  ]),
  // The two lists in no workspace (0.141.0): every workspace with its health, every machine of the synced store, and one machine.
  route("workspaces", "routes/workspaces.tsx"),
  route("machines", "routes/machines.tsx"),
  route("machines/:host", "routes/machine.tsx"),
  route("runs", "routes/runs.tsx", { id: "runs-all" }),
  route("profiles", "routes/profiles.tsx"),
  // Old addresses, kept as 301 redirects: the first status page (0.9.0), the /p/ project pages, and the pages 0.141.0 renamed.
  route("fleet", "routes/moved.tsx", { id: "moved-fleet" }),
  route("topology", "routes/moved.tsx", { id: "moved-topology" }),
  route("hosts", "routes/moved.tsx", { id: "moved-hosts" }),
  route("hosts/:host", "routes/moved.tsx", { id: "moved-host" }),
  route("status", "routes/moved.tsx", { id: "moved-status" }),
  route("runs/:project/:run", "routes/legacy-run.tsx", { id: "legacy-run-first" }),
  route("p/:project", "routes/project.tsx"),
  route("p/:project/rituals/:slug", "routes/legacy-ritual.tsx"),
  route("p/:project/runs/:run", "routes/legacy-run.tsx", { id: "legacy-run-project" }),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
