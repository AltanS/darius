/**
 * A receipt (0.90.0): the row that takes the place of a card after an action,
 * and the row of a start the web asked for. Both are built from data in
 * `lib/home.ts` (`doneLately`), never from client state, so a reload shows the
 * same row. The sentence says what was done, by whom, when and what comes
 * next; the small links go to the ritual or vigil and to the run.
 */

import { Link } from "react-router";

import type { DonePending, DoneReceipt } from "../lib/home.ts";
import { railOf } from "../lib/state-words.ts";
import { KindWord } from "./chip.tsx";
import { Row } from "./row.tsx";
import { Fold, Time } from "./ui.tsx";

interface ReceiptProps {
  row: DoneReceipt | DonePending;
}

/** One receipt row: the title opens the run (or the ritual), the sentence is under it. */
export function Receipt({ row }: ReceiptProps): React.ReactNode {
  if (row.kind === "pending") {
    return (
      <Row
        id={row.id}
        kind={row.item}
        manual={row.manual}
        href={row.href}
        title={row.title}
        rail={railOf(row.word)}
        busy={row.start.state === "starting"}
        chips={<KindWord kind={row.item} manual={row.manual} />}
        state={row.word}
        meta={[row.project]}
        time={<Time iso={row.at} />}
        acts={row.retry === null ? undefined : <Link to={row.retry.href}>{row.retry.text}</Link>}
        note={row.text}
      />
    );
  }
  const detail = row.entry.detail ?? [];
  return (
    <Row
      id={row.id}
      kind={row.item}
      manual={row.manual}
      href={row.href}
      title={row.title}
      chips={<KindWord kind={row.item} manual={row.manual} />}
      meta={[row.project]}
      time={<Time iso={row.at} />}
      acts={
        row.links.length === 0 ? undefined : (
          <>
            {row.links.map((link) => (
              <Link key={link.text} to={link.href}>
                {link.text}
              </Link>
            ))}
          </>
        )
      }
      note={row.text}
      foot={detail.length === 0 ? undefined : <Fold summary={detail.length === 1 ? "1 detail" : `${detail.length} details`}>{detail.map((line, index) => <p key={`${index}`} className="rail-note">{line}</p>)}</Fold>}
    />
  );
}
