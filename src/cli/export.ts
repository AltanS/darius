/**
 * `darius export [--dry-run] [--json]`: mirror this host's store into the
 * backup git repo from config.toml `[backup]`, commit and push
 * (src/core/export.ts does the work; docs/concept.md, "Backup").
 *
 * Exit codes (probe contract): 0 exported, or nothing changed; 1 refused (a
 * foreign clone, a secret-looking name in the store) or failed; 2 no
 * `[backup]` in config.toml; 3 offline: the clone or the push failed, and a
 * new commit stays local for the next run.
 *
 * `--json` prints the ExportResult object.
 */

import { loadConfig } from "../core/config.ts";
import { describeExport, runExport } from "../core/export.ts";
import { configDir, stateDir } from "../core/paths.ts";
import { VERSION } from "../version.ts";
import { UsageError } from "./registry.ts";
import type { Command, ParsedArgs } from "./registry.ts";

export const exportCommand: Command = {
  name: "export",
  summary: "mirror this host's store into the [backup] git repo, commit and push (--dry-run)",
  async run(args: ParsedArgs): Promise<number> {
    const config = loadConfig();
    if (config.backup === undefined) {
      throw new UsageError('backup not configured: add [backup] with repo = "<git url>" to config.toml');
    }
    const result = runExport({ config, stateDir: stateDir(), configDir: configDir(), version: VERSION, dryRun: args.flags["dry-run"] === true });
    if (args.json) {
      console.log(JSON.stringify({ ok: result.code === 0, ...result }));
    } else {
      console.log(describeExport(result));
    }
    for (const warning of result.warnings) console.error(`darius export: ${warning}`);
    return result.code;
  },
};
