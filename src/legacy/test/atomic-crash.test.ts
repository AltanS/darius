/**
 * Atomic write crash test: simulated crash mid-write leaves no partial file.
 *
 * Uses child_process.fork to spawn crash-writer.mts, which:
 * 1. Writes the tmp file
 * 2. Notifies parent via IPC
 * 3. Kills itself before doing the rename
 *
 * The parent then verifies:
 * - The destination file does NOT exist (no rename completed)
 * - The tmp file may or may not exist (OS cleanup behavior varies)
 *
 * pnpm vitest run atomic-crash
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { atomicWriteFileSync } from "../lib/atomic.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("atomic-crash", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-atomic-crash-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("no partial file at destination after crash mid-write", async () => {
    const destPath = join(tmpDir, "target.md");
    const helperPath = resolve(__dirname, "helpers", "crash-writer.mts");

    await new Promise<void>((resolve, reject) => {
      const child = fork(helperPath, [], {
        execArgv: ["--experimental-strip-types", "--no-warnings"],
        env: {
          ...process.env,
          DEST_PATH: destPath,
          CONTENT: "This should not appear at destPath",
        },
        silent: true,
      });

      // The child sends the tmpPath once it has written it, then kills itself
      child.on("message", (_msg) => {
        // Child has written tmp file; it will now kill itself
        // We don't need to do anything — wait for exit
      });

      child.on("exit", () => {
        // After the child dies, verify the destination doesn't exist
        try {
          expect(existsSync(destPath)).toBe(false);
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      child.on("error", reject);

      // Safety timeout
      setTimeout(() => reject(new Error("crash-writer timed out")), 5000);
    });
  });

  it("normal atomicWriteFileSync succeeds (baseline)", () => {
    const destPath = join(tmpDir, "normal.md");
    atomicWriteFileSync(destPath, "hello world\n");
    expect(existsSync(destPath)).toBe(true);
  });

  it("no .tmp files left behind after successful write", () => {
    const destPath = join(tmpDir, "clean.md");
    atomicWriteFileSync(destPath, "content\n");

    const entries = readdirSync(tmpDir);
    const tmpFiles = entries.filter((e) => e.includes(".tmp."));
    expect(tmpFiles).toHaveLength(0);
  });

  it("atomicWriteFileSync is idempotent: second write replaces first", () => {
    const destPath = join(tmpDir, "idempotent.md");
    atomicWriteFileSync(destPath, "first content\n");
    atomicWriteFileSync(destPath, "second content\n");

    const content = readFileSync(destPath, "utf-8");
    expect(content).toBe("second content\n");
  });
});
