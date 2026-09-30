/**
 * Filesystem locations darius reads and writes, and how a project name is
 * resolved for a command invocation.
 *
 * Every path honours an env override before falling back to its XDG-style
 * default, so `scripts/test.sh` can point a whole test run at a throwaway
 * directory (docs/plan-tonight.md, "Safety rules") without any darius
 * command ever touching the operator's real store.
 */

import { homedir } from "node:os";
import { join } from "node:path";

import { findMarker } from "./marker.ts";
import { UsageError } from "./model.ts";

/** `~/.config/darius`, or `DARIUS_CONFIG_DIR` when set. */
/** An env override, where an empty string counts as unset (systemd `Environment=X=` sets ""). */
function envDir(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

export function configDir(): string {
  return envDir("DARIUS_CONFIG_DIR") ?? join(homedir(), ".config", "darius");
}

/** `~/.local/share/darius`, or `DARIUS_STATE_DIR` when set. */
export function stateDir(): string {
  return envDir("DARIUS_STATE_DIR") ?? join(homedir(), ".local", "share", "darius");
}

/**
 * `~/.local/opt/darius`, or `DARIUS_APP_DIR` when set: the versioned app
 * install (`versions/`, `current`, `update.json`). src/core/app.ts owns the
 * layout.
 */
export function appDir(): string {
  return envDir("DARIUS_APP_DIR") ?? join(homedir(), ".local", "opt", "darius");
}

/**
 * Claude Code's user config dir: `CLAUDE_CONFIG_DIR` when set, else
 * `<home>/.claude`. `darius skill install` writes `skills/darius/SKILL.md`
 * under it.
 */
export function claudeDir(home: string = homedir()): string {
  return envDir("CLAUDE_CONFIG_DIR") ?? join(home, ".claude");
}

/** `<stateDir>/<project>`, the one directory a project's store lives under. */
export function projectDir(project: string): string {
  return join(stateDir(), project);
}

/**
 * The project a command runs against: `--project`, else `DARIUS_PROJECT`,
 * else a `.darius.toml` marker walked up from `cwd`. Refuses with a
 * `UsageError` (exit 2, the probe contract's "usage") when none resolves.
 */
export function resolveProject(flag?: string, cwd?: string): string {
  if (flag !== undefined && flag.length > 0) return flag;
  const fromEnv = process.env.DARIUS_PROJECT;
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  const marker = findMarker(cwd ?? process.cwd());
  if (marker !== null) return marker.project;
  throw new UsageError(
    "no project: pass --project, set DARIUS_PROJECT, or run inside a repo with a .darius.toml marker",
  );
}
