/**
 * Tree conflicts that lost a version (0.75.0).
 *
 * When apply keeps one of two concurrent versions of a tree file and no
 * merge can join them (src/core/tree.ts), it writes one ledger line:
 *
 *   tree.conflict  { path, winner_sha, loser_sha, winner_host, loser_host }
 *
 * `winner_sha` is null when the winner removed the file. Both `_sha` keys
 * name blobs, so sync carries the lost version with the line. The line's own
 * `host` is the host that saw the conflict. A pair (path, winner, loser) is
 * recorded once, whichever host sees it first.
 *
 * A conflict stays open until one of these later lines closes it:
 *
 *   tree.put       of the path with the loser's blob: the lost version is back
 *                  (`darius tree restore <path> --at <loser_sha> --force`)
 *   tree.removed   of the path: the file is gone on purpose
 *   tree.resolved  { path }: the operator keeps the current version
 *                  (`darius tree resolve <path>`); closes every conflict of
 *                  the path recorded before it
 *
 * `darius doctor` lists the open ones with the two commands, and `darius due`
 * counts them in one line. A concurrent edit that a merge joined loses
 * nothing and writes no line.
 */

import type { JsonValue, LedgerLine } from "./model.ts";

export const TREE_CONFLICT = "tree.conflict";
export const TREE_RESOLVED = "tree.resolved";

/** One recorded conflict. */
export interface TreeConflict {
  id: string;
  at: string;
  /** The host that saw the conflict. */
  host: string;
  path: string;
  winnerSha: string | null;
  loserSha: string;
  winnerHost: string;
  loserHost: string;
}

/** The key that makes a conflict unique: path, winner and loser. */
export function conflictKey(path: string, winnerSha: string | null, loserSha: string): string {
  return `${path}\u0000${winnerSha ?? "-"}\u0000${loserSha}`;
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function text(line: LedgerLine, key: string): string | null {
  const value = line[key];
  return isText(value) ? value : null;
}

function decode(line: LedgerLine): TreeConflict | null {
  const path = text(line, "path");
  const loserSha = text(line, "loser_sha");
  if (path === null || loserSha === null) return null;
  return {
    id: line.id,
    at: line.at,
    host: line.host,
    path,
    winnerSha: text(line, "winner_sha"),
    loserSha,
    winnerHost: text(line, "winner_host") ?? "?",
    loserHost: text(line, "loser_host") ?? "?",
  };
}

/** What the ledger says about tree conflicts. */
export interface TreeConflicts {
  /** Every recorded conflict, keyed by `conflictKey`. */
  all: ReadonlySet<string>;
  /** The open ones, oldest first. */
  open: TreeConflict[];
}

/** The recorded and the open conflicts. `lines` in id order. */
export function readTreeConflicts(lines: readonly LedgerLine[]): TreeConflicts {
  const all = new Set<string>();
  const open = new Map<string, TreeConflict>();
  for (const line of lines) {
    if (line.type === TREE_CONFLICT) {
      const conflict = decode(line);
      if (conflict === null) continue;
      const key = conflictKey(conflict.path, conflict.winnerSha, conflict.loserSha);
      if (all.has(key)) continue;
      all.add(key);
      open.set(key, conflict);
      continue;
    }
    const path = text(line, "path");
    if (path === null || open.size === 0) continue;
    if (line.type !== "tree.put" && line.type !== "tree.removed" && line.type !== TREE_RESOLVED) continue;
    const body = text(line, "body_sha");
    for (const [key, conflict] of open) {
      if (conflict.path !== path) continue;
      if (line.type === "tree.put" && body !== conflict.loserSha) continue;
      open.delete(key);
    }
  }
  return { all, open: [...open.values()] };
}

/** The lines that tell the operator what was lost and the two ways out. */
export function conflictAdvice(conflict: TreeConflict): string[] {
  const target = `.tracker/${conflict.path}`;
  const kept = conflict.winnerSha === null ? `the removal by ${conflict.winnerHost}` : `the version of ${conflict.winnerHost}`;
  return [
    `concurrent edit of ${target} (${conflict.at}): kept ${kept}, the version of ${conflict.loserHost} is blob ${conflict.loserSha}`,
    `  get it back (replaces the current file): darius tree restore ${target} --at ${conflict.loserSha} --force`,
    `  keep the current file: darius tree resolve ${target}`,
  ];
}
