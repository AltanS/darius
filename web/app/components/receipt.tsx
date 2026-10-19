/**
 * A row of Done lately for something the operator did or asked (0.90.0): a
 * decision on a result, a follow-up, a check, or a start the command refused.
 * It is one line: the state word, the title, the workspace and the time. The
 * rows are built from data in `lib/home.ts` (`doneLately`), never from client
 * state, so a reload shows the same row. The Activity place has the full
 * sentence of every decision.
 */

import { Link } from "react-router";

import type { DonePending, DoneReceipt } from "../lib/home.ts";
import { railOf } from "../lib/state-words.ts";
import { Row } from "./row.tsx";
import { Time } from "./ui.tsx";

interface ReceiptProps {
  row: DoneReceipt | DonePending;
}

/** One row: the title opens the run (or the ritual). A refused or lost start also names why, with a link to try again. */
export function Receipt({ row }: ReceiptProps): React.ReactNode {
  if (row.kind === "pending") {
    return <Row id={row.id} kind={row.item} manual={row.manual} href={row.href} title={row.title} rail={railOf(row.word)} state={row.word} meta={[row.project]} time={<Time iso={row.at} />} acts={row.retry === null ? undefined : <Link to={row.retry.href}>{row.retry.text}</Link>} note={row.text} />;
  }
  return <Row id={row.id} kind={row.item} manual={row.manual} href={row.href} title={row.title} state={row.word} meta={[row.project]} time={<Time iso={row.at} />} />;
}
