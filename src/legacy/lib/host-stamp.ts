/**
 * Where a record was written: the git HEAD of the checkout and the host name.
 * Shared by worklog stage stamps and verification ledger lines (0.72.0).
 */

import { execFileSync } from "node:child_process";
import { hostname } from "node:os";

/** The head value recorded outside a git checkout. */
export const NO_GIT_HEAD = "none";

/** Run git in `cwd`; null on any failure. */
export function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/** The full sha of HEAD, or {@link NO_GIT_HEAD} outside git or before the first commit. */
export function gitHead(cwd: string): string {
  const out = git(cwd, ["rev-parse", "--verify", "-q", "HEAD"]);
  const sha = out?.trim() ?? "";
  return sha === "" ? NO_GIT_HEAD : sha;
}

/** This host's name, or `unknown`. */
export function hostName(): string {
  try {
    const name = hostname().trim();
    return name === "" ? "unknown" : name;
  } catch {
    return "unknown";
  }
}

