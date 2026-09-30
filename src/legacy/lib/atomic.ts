/**
 * Atomic write helper.
 *
 * Writes content to a temporary file beside the destination, then renames
 * into place. On POSIX systems the rename is atomic — readers never see a
 * partial file. On error the tmp file is cleaned up.
 *
 * Always use this helper for every write in the tracker CLI.
 */

import { writeFileSync, renameSync, unlinkSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

/**
 * Write `content` to `destPath` atomically.
 *
 * 1. Write to `<destPath>.tmp.<pid>.<rand>`
 * 2. `fs.renameSync` to `destPath` (POSIX atomic)
 * 3. On error: attempt to clean up the tmp file
 */
export function atomicWriteFileSync(destPath: string, content: string): void {
  const pid = process.pid;
  const rand = Math.floor(Math.random() * 0xfffffff).toString(16);
  const tmpPath = join(dirname(destPath), `${destPath.split("/").pop()}.tmp.${pid}.${rand}`);

  try {
    writeFileSync(tmpPath, content, "utf-8");
    renameSync(tmpPath, destPath);
  } catch (err) {
    // Best-effort cleanup of the temp file
    if (existsSync(tmpPath)) {
      try {
        unlinkSync(tmpPath);
      } catch {
        // Ignore cleanup errors
      }
    }
    throw err;
  }
}
