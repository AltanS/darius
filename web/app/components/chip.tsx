/**
 * The one chip: a small square-cornered box with a tinted border and ground,
 * a sentence-case word and an optional icon. It is used for kinds (ritual,
 * vigil), the manual modifier, result counts and "imported". The colour is
 * either a kind colour (what the item is) or a state tone (how it is doing),
 * never a mix.
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

interface KindChipsProps {
  kind: Kind;
  /** A ritual done by hand (mode off): a manual chip follows the ritual chip. */
  manual?: boolean;
}

/** The chips of an item: its kind, and for a manual ritual the manual chip after it. */
export function KindChips({ kind, manual = false }: KindChipsProps): React.ReactNode {
  return (
    <>
      <Chip color={kind} glyph={kind}>
        {kindWord(kind)}
      </Chip>
      {manual ? (
        <Chip color="manual" glyph="manual">
          manual
        </Chip>
      ) : null}
    </>
  );
}
