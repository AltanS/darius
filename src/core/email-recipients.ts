/**
 * Who gets the mail of one project (0.128.0; docs/concept.md, "Mail
 * recipients per project"). The channel (url, token, from, since, html)
 * belongs to the host, in `email.json`. The audience belongs to the
 * workspace, in the project's `.darius.toml`:
 *
 *   [email]
 *   to = ["ops@example.com"]
 *
 * For a mail of project P, on the sending host, at send time:
 *
 *   1. This host has no checkout of P (src/core/workdir.ts, `checkoutDir`),
 *      or the checkout has no marker, or the marker has no `[email] to`: the
 *      host's default `to`.
 *   2. The marker has `[email] to`: that list, whole. `[]` means no mail.
 *   3. The marker does not parse, names another project, or has `[email] to`
 *      and uncommitted changes: a problem, and no mail. The safe side: a
 *      marker that cannot be trusted may be the one that says `to = []`.
 *      Only a committed marker names recipients, as only a committed marker
 *      runs unattended (src/runner/run-due.ts, `marker-dirty`); so a run
 *      outside the box that edits `.darius.toml` cannot pick who gets its
 *      report.
 *
 * `_global` and a plain `darius email test` use the host's default. A problem
 * text names the file and the case, never an address or a path, because it
 * can go into a ledger line. The resolved list is never stored.
 */

import type { EmailSettings } from "./email.ts";
import { readLedger } from "./ledger.ts";
import { MARKER_FILE, readMarker, type Marker } from "./marker.ts";
import { markerDirty } from "./reconcile.ts";
import { GLOBAL_PROJECT, type Project } from "./store.ts";
import type { LedgerLine } from "./model.ts";
import { checkoutDir } from "./workdir.ts";

/** Where a list came from: the host's `email.json` or the project's marker. */
export type RecipientSource = "host" | "marker";

export type Recipients = { to: readonly string[]; source: RecipientSource } | { problem: string };

/** The marker of P's checkout on this host, null without one, or a problem that quotes nothing. */
function checkoutMarker(project: Project, ledger: readonly LedgerLine[]): { marker: Marker | null; dir?: string } | { problem: string } {
  const dir = checkoutDir(project, ledger);
  if (dir === undefined) return { marker: null };
  let marker: Marker | null;
  try {
    marker = readMarker(dir);
  } catch {
    // The parse error can quote a line of the file, and a line can hold an address.
    return { problem: `the project's ${MARKER_FILE} does not parse here` };
  }
  if (marker !== null && marker.project !== project.name) return { problem: `the linked checkout's ${MARKER_FILE} names another project` };
  return { marker, dir };
}

/**
 * The recipients of a mail of `project` on this host, or a problem. Reads the
 * checkout's marker now, so a change is seen by the next send. `ledger` is
 * the project's, for the checkout lookup; it is read when not given.
 */
export function projectRecipients(project: Project, settings: EmailSettings, ledger?: readonly LedgerLine[]): Recipients {
  const fallback: Recipients = { to: settings.to, source: "host" };
  if (project.name === GLOBAL_PROJECT) return fallback;
  const found = checkoutMarker(project, ledger ?? readLedger(project));
  if ("problem" in found) return found;
  const list = found.marker?.emailTo;
  if (list === undefined || found.dir === undefined) return fallback;
  if (markerDirty(found.dir)) return { problem: `the project's ${MARKER_FILE} has uncommitted changes, so its [email] to is not used` };
  return { to: list, source: "marker" };
}

/** Why a resolved list is empty, in words that quote no value. */
export function noRecipientsReason(source: RecipientSource): string {
  return source === "marker" ? `its ${MARKER_FILE} sets [email] to = []` : `email.json has no to, and its ${MARKER_FILE} names no recipients here`;
}
