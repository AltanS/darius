import type { Config } from "@react-router/dev/config";

// Framework mode with server rendering. The load context stays a plain
// object (the WebContext from darius serve), so middleware stays off.
export default {
  ssr: true,
  appDirectory: "app",
  buildDirectory: "build",
  // The page ships the whole route manifest, so it never asks /__manifest and
  // knows every route's files: the service worker saves them all, and a tap
  // with no connection still finds the code of the page (lib/sw.ts).
  routeDiscovery: { mode: "initial" },
} satisfies Config;
