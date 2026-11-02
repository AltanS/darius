/**
 * The candles as the web reads them (0.111.0): one row per candle, with the
 * project it belongs to. Used by `WebContext` (src/web/context.ts) and by the
 * read endpoints (src/web/action-api.ts). Reads only. Every text in a row is
 * untrusted plain text, and it leaves here as data.
 */

import { candleDelivery } from "../core/alerts.ts";
import { collectCandles, type Candle } from "../core/candle-index.ts";
import { readLedger } from "../core/ledger.ts";
import { getBlobText, listProjects, openProject } from "../core/store.ts";
import type { CandleDetail, CandleRow } from "./api.ts";
import { parseMarkdown } from "./markdown.ts";

function rowOf(project: string, candle: Candle): CandleRow {
  return Object.assign({ project }, candle);
}

/** The candles of one project, or of every project of this host, project by project, worst first. A project that cannot be read adds none. */
export function collectCandleRows(project: string | null = null): CandleRow[] {
  const names = listProjects().filter((name) => project === null || name === project);
  return names.flatMap((name) => {
    try {
      return collectCandles(openProject(name)).map((candle) => rowOf(name, candle));
    } catch {
      return [];
    }
  });
}

/**
 * One candle with its body, the body parsed for the page, and where its newest
 * notice stands per channel (0.112.0). Null when the project or the key is
 * unknown. The ledger is read once.
 */
export function candleDetail(project: string, key: string): CandleDetail | null {
  if (!listProjects().includes(project)) return null;
  const store = openProject(project);
  const ledger = readLedger(store);
  const candle = collectCandles(store, ledger).find((candidate) => candidate.key === key);
  if (candle === undefined) return null;
  const body = candle.bodySha === undefined ? null : getBlobText(store, candle.bodySha);
  return { row: rowOf(project, candle), body, blocks: body === null ? null : parseMarkdown(body), delivery: candleDelivery(store, ledger, key) };
}
