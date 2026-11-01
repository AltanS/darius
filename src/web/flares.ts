/**
 * The flares as the web reads them (0.111.0): one row per flare, with the
 * project it belongs to. Used by `WebContext` (src/web/context.ts) and by the
 * read endpoints (src/web/action-api.ts). Reads only. Every text in a row is
 * untrusted plain text, and it leaves here as data.
 */

import { flareDelivery } from "../core/alerts.ts";
import { collectFlares, type Flare } from "../core/flare-index.ts";
import { readLedger } from "../core/ledger.ts";
import { getBlobText, listProjects, openProject } from "../core/store.ts";
import type { FlareDetail, FlareRow } from "./api.ts";
import { parseMarkdown } from "./markdown.ts";

function rowOf(project: string, flare: Flare): FlareRow {
  return Object.assign({ project }, flare);
}

/** The flares of one project, or of every project of this host, project by project, worst first. A project that cannot be read adds none. */
export function collectFlareRows(project: string | null = null): FlareRow[] {
  const names = listProjects().filter((name) => project === null || name === project);
  return names.flatMap((name) => {
    try {
      return collectFlares(openProject(name)).map((flare) => rowOf(name, flare));
    } catch {
      return [];
    }
  });
}

/**
 * One flare with its body, the body parsed for the page, and where its newest
 * notice stands per channel (0.112.0). Null when the project or the key is
 * unknown. The ledger is read once.
 */
export function flareDetail(project: string, key: string): FlareDetail | null {
  if (!listProjects().includes(project)) return null;
  const store = openProject(project);
  const ledger = readLedger(store);
  const flare = collectFlares(store, ledger).find((candidate) => candidate.key === key);
  if (flare === undefined) return null;
  const body = flare.bodySha === undefined ? null : getBlobText(store, flare.bodySha);
  return { row: rowOf(project, flare), body, blocks: body === null ? null : parseMarkdown(body), delivery: flareDelivery(store, ledger, key) };
}
