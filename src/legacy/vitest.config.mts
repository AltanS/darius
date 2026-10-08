import { defineConfig } from "vitest/config";

// Vitest 2 on Node 24 fails with "minThreads and maxThreads must not conflict"
// when it derives the fork count itself. Pin the range.
// The store tree the darius router hands the engine (0.78.0, lib/tracker-root.ts).
// A suite run from a darius verb inherits it, and a test that loads the engine
// directly would then act on that real tree. Tests set their own.
delete process.env.DARIUS_TRACKER_ROOT;
delete process.env.DARIUS_CHECKOUT_ROOT;

export default defineConfig({
  test: { pool: "forks", poolOptions: { forks: { minForks: 1, maxForks: 8 } } },
});
