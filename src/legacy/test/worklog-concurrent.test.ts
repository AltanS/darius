/**
 * Concurrency test for worklog appends.
 *
 * Spawns 5 child processes that each append to the same worklog thread.
 * Asserts exactly 5 new entries are present with no corruption.
 * Runs 10 times to catch race conditions.
 *
 * pnpm vitest run worklog-concurrent
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fork } from "node:child_process";
import { initTracker, addMilestone } from "../lib/tracker-writer.ts";
import { openThread, listThreads } from "../lib/worklog.ts";

// Worker script is a file that imports appendThread using an absolute path
// We'll write it as a .mts file with dynamic content
function buildWorkerScript(cliDir: string): string {
  return `
import { appendThread } from '${cliDir}/lib/worklog.ts';
const [worklogPath, threadId, message] = process.argv.slice(2);
appendThread({
  worklogPath,
  threadId,
  section: 'note',
  message,
});
process.exit(0);
`;
}

describe("worklog-concurrent", () => {
  let tmpDir: string;
  let trackerRoot: string;
  let worklogPath: string;
  let workerScriptPath: string;
  let threadId: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-worklog-concurrent-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    addMilestone({
      trackerRoot,
      name: "Test Milestone",
      slug: "test-milestone",
      owner: "dev@example.com",
    });

    const worklogDir = join(trackerRoot, "worklog");
    worklogPath = join(worklogDir, "concurrent-test.md");

    threadId = openThread({
      worklogPath,
      slug: "concurrent",
    });

    // Write the worker script with absolute path to the CLI lib
    const cliDir = process.cwd();
    workerScriptPath = join(tmpDir, "worker.mts");
    writeFileSync(workerScriptPath, buildWorkerScript(cliDir), "utf-8");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function runConcurrentAppends(count: number): Promise<void> {
    const cliDir = join(process.cwd());

    const promises: Promise<void>[] = [];

    for (let i = 0; i < count; i++) {
      const message = `from-pid-${process.pid}-worker-${i}`;
      promises.push(
        new Promise<void>((resolve, reject) => {
          const child = fork(
            workerScriptPath,
            [worklogPath, threadId, message],
            {
              execArgv: ["--experimental-strip-types", "--no-warnings"],
              cwd: cliDir,
              stdio: "pipe",
            },
          );
          child.on("exit", (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`Worker exited with code ${code}`));
            }
          });
          child.on("error", reject);
        }),
      );
    }

    await Promise.all(promises);
  }

  it(
    "5 concurrent appends produce exactly 5 new entries",
    async () => {
      const WORKER_COUNT = 5;

      await runConcurrentAppends(WORKER_COUNT);

      const threads = listThreads({ trackerRoot });
      const thread = threads.find((t) => t.threadId === threadId);

      expect(thread).toBeDefined();
      // The thread starts with 0 entries (no message on open), so after 5 appends
      // we should have exactly 5 entries
      expect(thread?.entryCount).toBe(WORKER_COUNT);
    },
    30_000, // 30s timeout for forking
  );

  it(
    "runs 10 times without corruption",
    async () => {
      for (let run = 0; run < 10; run++) {
        // Reset: create a fresh thread for each run
        const runWorklogPath = join(
          trackerRoot,
          "worklog",
          `concurrent-run-${run}.md`,
        );
        const runThreadId = openThread({
          worklogPath: runWorklogPath,
          slug: `run-${run}`,
        });

        const WORKER_COUNT = 5;
        const cliDir = join(process.cwd());

        await Promise.all(
          Array.from({ length: WORKER_COUNT }, (_, i) => {
            const message = `run-${run}-worker-${i}`;
            return new Promise<void>((resolve, reject) => {
              const child = fork(
                workerScriptPath,
                [runWorklogPath, runThreadId, message],
                {
                  execArgv: ["--experimental-strip-types", "--no-warnings"],
                  cwd: cliDir,
                  stdio: "pipe",
                },
              );
              child.on("exit", (code) => {
                if (code === 0) resolve();
                else reject(new Error(`Worker exited with code ${code} in run ${run}`));
              });
              child.on("error", reject);
            });
          }),
        );

        const threads = listThreads({ trackerRoot });
        const thread = threads.find((t) => t.threadId === runThreadId);

        expect(thread).toBeDefined();
        expect(thread?.entryCount).toBe(WORKER_COUNT);
      }
    },
    120_000, // 2 min timeout for 10 runs
  );
});
