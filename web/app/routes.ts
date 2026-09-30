import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/overview.tsx"),
  route("runs", "routes/runs.tsx"),
  // The URL of the first status page (0.9.0), kept so old links still work.
  route("runs/:project/:run", "routes/legacy-run.tsx"),
  route("profiles", "routes/profiles.tsx"),
  route("p/:project", "routes/project.tsx"),
  route("p/:project/rituals/:slug", "routes/ritual.tsx"),
  route("p/:project/runs/:run", "routes/run.tsx"),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
