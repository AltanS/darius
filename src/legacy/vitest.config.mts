import { defineConfig } from "vitest/config";

// Vitest 2 on Node 24 fails with "minThreads and maxThreads must not conflict"
// when it derives the fork count itself. Pin the range.
export default defineConfig({
  test: { pool: "forks", poolOptions: { forks: { minForks: 1, maxForks: 8 } } },
});
