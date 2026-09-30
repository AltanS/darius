import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// The server build is one self-contained ESM tree: `darius serve` imports
// build/server/index.js under Node or Bun with no node_modules next to it,
// so every package is bundled (noExternal) and only node: builtins stay
// imports. The entry is server/app.ts, which exports the WebHandler. The dev
// server (server/dev.ts) loads packages from node_modules as usual.
export default defineConfig(({ command, isSsrBuild }) => ({
  plugins: [tailwindcss(), reactRouter()],
  build: isSsrBuild ? { target: "node22", rollupOptions: { input: "./server/app.ts" } } : { target: "es2022" },
  ssr: command === "build" ? { noExternal: true, target: "node" } : {},
  // Bundled React picks its production build from this at run time.
  define: isSsrBuild ? { "process.env.NODE_ENV": JSON.stringify("production") } : {},
}));
