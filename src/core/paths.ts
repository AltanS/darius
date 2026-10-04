/**
 * Filesystem locations darius reads and writes, and how a project name is
 * resolved for a command invocation.
 *
 * Every path honours an env override before falling back to its XDG-style
 * default, so `scripts/test.sh` can point a whole test run at a throwaway
 * directory (docs/plan-tonight.md, "Safety rules") without any darius
 * command ever touching the operator's real store.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { DEFAULT_KINDS, type OwnedKind } from "./kinds.ts";
import { linkedDir } from "./links.ts";
import { findMarker, readMarker, type Marker } from "./marker.ts";
import { UsageError } from "./model.ts";
import { errorMessage } from "../runtime.ts";

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
    "no project here: run darius init in the repo root, or pass --project <name>",
  );
}

/** The nearest `.tracker/` directory walked up from `start`, or null. The legacy CLI walks the same way. */
export function findTrackerDir(start: string): string | null {
  let dir = resolve(start);
  for (let depth = 0; depth < 50; depth += 1) {
    const candidate = join(dir, ".tracker");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * True when a store verb has no project to act on and runs in a legacy repo:
 * no `--project`, no `DARIUS_PROJECT`, no `.darius.toml` above `cwd`, but a
 * `.tracker/`. Such a repo must be linked first (`darius init`); without the
 * check the verb would fail with the generic "no project" usage error.
 */
export function isUnlinkedTrackerRepo(flag: string | undefined, cwd: string): boolean {
  if (flag !== undefined && flag.length > 0) return false;
  const fromEnv = process.env.DARIUS_PROJECT;
  if (fromEnv !== undefined && fromEnv.length > 0) return false;
  if (findMarker(cwd) !== null) return false;
  return findTrackerDir(cwd) !== null;
}

/** What `ownedKinds` answers: the owned set and the marker it came from, or the marker's parse error. */
export type OwnedKinds =
  | { ok: true; kinds: ReadonlySet<OwnedKind>; marker: Marker | null }
  | { ok: false; error: string };

/** The `--project P` or `--project=P` value in `argv`, the last one. Undefined when there is none. */
function projectFlag(argv: readonly string[]): string | undefined {
  let found: string | undefined;
  argv.forEach((token, index) => {
    if (token === "--project") found = argv[index + 1];
    else if (token.startsWith("--project=")) found = token.slice("--project=".length);
  });
  return found === undefined || found === "" ? undefined : found;
}

/**
 * The kinds the darius store owns for the command in `argv` run in `cwd`.
 * The project is `--project`, else `DARIUS_PROJECT`; its marker is the one in
 * its linked checkout on this host. With no name, the nearest marker at or
 * above `cwd`. No link, no marker or no `kinds` key: `DEFAULT_KINDS`. A
 * marker that does not parse gives `{ ok: false, error }`. Never throws.
 */
export function ownedKinds(argv: readonly string[], cwd: string): OwnedKinds {
  try {
    const name = projectFlag(argv) ?? envDir("DARIUS_PROJECT");
    let marker: Marker | null;
    if (name === undefined) {
      marker = findMarker(cwd);
    } else {
      const dir = linkedDir(name);
      marker = dir === undefined ? null : readMarker(dir);
    }
    if (marker === null) return { ok: true, kinds: DEFAULT_KINDS, marker: null };
    return { ok: true, kinds: new Set(marker.kinds), marker };
  } catch (cause) {
    return { ok: false, error: errorMessage(cause) };
  }
}
