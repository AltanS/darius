#!/usr/bin/env -S node --experimental-strip-types --no-warnings
/**
 * crash-writer.mts — helper for the atomic-crash test.
 *
 * When forked via child_process.fork, this process:
 * 1. Writes the tmp file to the given destPath
 * 2. Sends a "ready" message to the parent
 * 3. Kills itself before doing the rename
 *
 * The parent verifies no partial file remains at destPath.
 *
 * This is invoked via fork() from the atomic-crash test.
 * We intentionally break out of atomicWriteFileSync to simulate a crash
 * mid-write (after the tmp file is created but before rename).
 */

import { writeFileSync, renameSync, unlinkSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const destPath = process.env["DEST_PATH"];
const content = process.env["CONTENT"] ?? "test content that should not appear";

if (!destPath) {
  process.stderr.write("crash-writer: DEST_PATH env var is required\n");
  process.exit(1);
}

const pid = process.pid;
const rand = Math.floor(Math.random() * 0xfffffff).toString(16);
const tmpPath = join(
  dirname(destPath),
  `${destPath.split("/").pop()}.tmp.${pid}.${rand}`,
);

// Write the tmp file
writeFileSync(tmpPath, content, "utf-8");

// Notify parent that tmp file has been written
if (process.send) {
  process.send({ tmpPath });
}

// Kill ourselves without doing the rename — simulates a crash
process.kill(process.pid, "SIGKILL");
