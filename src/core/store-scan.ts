/**
 * Two reads of the store that the snapshot uses (src/core/snapshot.ts): a walk
 * of its regular files, and the scan for names that look like secrets. The
 * config dir holds credentials, keys and push secrets and is never archived;
 * the scan is the second guard, for a secret that someone put in the store.
 */

import { lstatSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** One regular file in the store, relative to the store root with `/` separators. */
export interface StoreFile {
  path: string;
  bytes: number;
}

/** A walk of the store: its regular files, and anything else (a link, a socket) it cannot copy. */
export interface StoreListing {
  files: StoreFile[];
  other: string[];
}

// --- the store walk -----------------------------------------------------------------

function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

function sortedEntries(dir: string): string[] {
  return readdirSync(dir).toSorted();
}

/** Every regular file under `root`, sorted, with its size. Links and other file types go to `other`. */
export function listStore(root: string): StoreListing {
  const listing: StoreListing = { files: [], other: [] };
  const walk = (dir: string): void => {
    for (const name of sortedEntries(dir)) {
      const full = join(dir, name);
      const stat = lstatSync(full);
      const rel = toPosix(relative(root, full));
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile()) listing.files.push({ path: rel, bytes: stat.size });
      else listing.other.push(rel);
    }
  };
  walk(root);
  return listing;
}

// --- the secret scan ----------------------------------------------------------------

const SECRET_NAMES = new Set(["credentials", "keys"]);
const SECRET_SUFFIXES = [".pem", ".key", ".credentials"];

/** True when one path segment looks like a secret: `credentials`, `keys`, `*.pem`, `*.key`, `*.credentials`. */
function isSecretName(segment: string): boolean {
  const lower = segment.toLowerCase();
  return SECRET_NAMES.has(lower) || SECRET_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/** The store paths with a file or directory name that looks like a secret. Blobs and ledgers pass. */
export function findSecretNames(paths: readonly string[]): string[] {
  return paths.filter((path) => path.split("/").some((segment) => isSecretName(segment)));
}
