/**
 * The resource scope of a boxed run (`[box] slice`, 0.124.0). On the host an
 * agent wrapper may put each harness session in its own systemd user scope in
 * a memory-limited slice. Inside the box there is no session bus, so that
 * wrapper runs the harness bare, and a boxed run would lose its limits. So
 * darius starts bwrap itself in a scope of the slice, outside the box:
 *
 *   systemd-run --user --scope -q --slice=<slice> --unit=darius-run-<run>-<random> --collect -- bwrap ...
 *
 * `--scope` runs the command in the foreground (systemd-run execs it), so the
 * terminal, the exit code and `--die-with-parent` stay as without it.
 * `--collect` unloads the unit when it ends, also when it failed. Each launch
 * (the layout probe, the gate preflight, the harness) gets its own unit name,
 * so one that is still going away cannot block the next.
 *
 * Resource limits are not a security boundary. A scope that cannot start
 * fails open: the run goes on without it and says so in its run.log
 * (src/runner/box-launch.ts). The box itself still fails closed.
 *
 * The pure parts (the name check, the unit name, the argv) are separate from
 * `findSystemdRun`, which looks at the file system.
 */

import { randomBytes } from "node:crypto";
import { accessSync, constants } from "node:fs";
import { userInfo } from "node:os";
import { delimiter, join } from "node:path";

/** A slice name: letters, digits, `:`, `_`, `.` and `-`, not starting with `-` or `.`, ending in `.slice`. */
const SLICE_NAME = /^[A-Za-z0-9:_][A-Za-z0-9:_.-]*\.slice$/u;
/** The longest unit name systemd takes. */
const MAX_UNIT_NAME = 255;
/** The run id part of a unit name: its last characters, enough to find the run. */
const SHORT_RUN = 8;

/** Why `name` is not a slice `[box] slice` may name, or undefined. */
export function sliceProblem(name: string): string | undefined {
  if (name.length > MAX_UNIT_NAME) return `it is longer than ${String(MAX_UNIT_NAME)} characters`;
  if (!SLICE_NAME.test(name)) return "a slice name ends in .slice and holds only letters, digits, ':', '_', '.' and '-', like \"agents.slice\"";
  return undefined;
}

/** A fresh random tag for one unit name: six hex digits. */
export function randomTag(): string {
  return randomBytes(3).toString("hex");
}

/** `darius-run-<last 8 of the run id, lower case>-<tag>`: one unit per launch. */
export function scopeUnit(run: string, tag: string): string {
  const short = run.slice(-SHORT_RUN).toLowerCase().replaceAll(/[^a-z0-9_-]/gu, "");
  return `darius-run-${short === "" ? "run" : short}-${tag}`;
}

/** The argv in front of bwrap: a user scope in `slice`, named `unit`, unloaded when it ends. */
export function scopePrefix(input: { systemdRun: string; slice: string; unit: string }): string[] {
  return [input.systemdRun, "--user", "--scope", "-q", `--slice=${input.slice}`, `--unit=${input.unit}`, "--collect", "--"];
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The systemd-run program of this host: PATH first, then the NixOS profiles,
 * which a systemd unit's PATH may leave out. `$DARIUS_SYSTEMD_RUN` replaces
 * the search; the test suite points it at a missing file or a fake.
 */
export function findSystemdRun(): string | undefined {
  const override = process.env.DARIUS_SYSTEMD_RUN;
  if (override !== undefined && override !== "") return isExecutable(override) ? override : undefined;
  const dirs = (process.env.PATH ?? "").split(delimiter).filter((dir) => dir.startsWith("/"));
  const user = process.env.USER ?? userInfo().username;
  const candidates = [...dirs, `/etc/profiles/per-user/${user}/bin`, "/run/current-system/sw/bin"].map((dir) => join(dir, "systemd-run"));
  return candidates.find((candidate) => isExecutable(candidate));
}
