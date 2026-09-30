/**
 * The one chip: a small square-cornered box with a tinted border and ground,
 * a sentence-case word and an optional icon. It is used for result counts and
 * "imported", in a state tone. A kind is not a chip: it is a coloured word
 * (`KindWord`), because the row's icon already carries the kind colour and a
 * second box would say the same thing twice.
 */

import { kindWord, type Kind } from "../lib/kind.ts";
import type { Tone } from "../lib/tone.ts";
import { KindIcon, type Glyph } from "./kind.tsx";

export type ChipColor = Tone | Glyph;

interface ChipProps {
  color: ChipColor;
  /** An icon in front of the word: a kind glyph. */
  glyph?: Glyph;
  children: React.ReactNode;
}

/** A chip. `color` picks the tint; `glyph` adds a 12 px icon with a 4 px gap. */
export function Chip({ color, glyph, children }: ChipProps): React.ReactNode {
  return (
    <span className={`chip-x c-${color}`}>
      {glyph === undefined ? null : <KindIcon kind={glyph} size={12} />}
      {children}
    </span>
  );
}

interface KindWordProps {
  kind: Kind;
  /** A ritual done by hand (mode off): the word is "manual ritual", in the manual colour. */
  manual?: boolean;
  /** Draw the kind's icon in front: for a page head, which has no row icon. */
  icon?: boolean;
}

/** What an item is, as one coloured word: "ritual", "manual ritual" or "vigil". */
export function KindWord({ kind, manual = false, icon = false }: KindWordProps): React.ReactNode {
  const glyph: Glyph = kind === "ritual" && manual ? "manual" : kind;
  return (
    <span className={`kind-word c-${glyph}`}>
      {icon ? <KindIcon kind={glyph} size={14} /> : null}
      {glyph === "manual" ? "manual ritual" : kindWord(kind)}
    </span>
  );
}
