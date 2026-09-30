/**
 * Writes build/build-info.json after `react-router build`: the hash of every
 * build input (source-hash.ts), so a test can tell a stale committed build.
 * No timestamp, so the same source gives the same file.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { sourceHash } from "../source-hash.ts";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const info = { sourceHash: sourceHash(join(web, "..")) };
writeFileSync(join(web, "build", "build-info.json"), `${JSON.stringify(info, null, 2)}\n`);
console.log(`build-info.json: ${info.sourceHash}`);
