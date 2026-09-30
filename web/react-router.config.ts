import type { Config } from "@react-router/dev/config";

// Framework mode with server rendering. The load context stays a plain
// object (the WebContext from darius serve), so middleware stays off.
export default {
  ssr: true,
  appDirectory: "app",
  buildDirectory: "build",
} satisfies Config;
