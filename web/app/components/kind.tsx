/**
 * The kinds (`lib/kind.ts`) as drawn things: an icon and chips. The icon is
 * decoration (two arrows chasing each other for a ritual, an eye for a vigil
 * that keeps watch, an open hand for the manual modifier); the word carries the
 * meaning (the chips are in `chip.tsx`). Where only an icon shows, `titled`
 * gives it a name for screen readers.
 */

import { GLYPH_GRID, GLYPH_STROKE, GLYPHS } from "../lib/glyphs.ts";
import type { Kind } from "../lib/kind.ts";

/** What an icon can draw: a kind, or the manual modifier. */
export type Glyph = Kind | "manual";

/** The strokes of each icon, in a 16 by 16 box: the shared glyphs (`lib/glyphs.ts`). */
const PATHS = { ritual: GLYPHS.ritual, manual: GLYPHS.manual, vigil: GLYPHS.vigil } as const satisfies Record<Glyph, readonly string[]>;

interface KindIconProps {
  kind: Glyph;
  /** Pixels; 16 by default. */
  size?: number;
  /** Name the icon for screen readers: use it where no word sits next to the icon. */
  titled?: boolean;
  className?: string;
}

/** The icon of a kind, in the kind's colour. */
export function KindIcon({ kind, size = 16, titled = false, className }: KindIconProps): React.ReactNode {
  const named = titled ? { role: "img", "aria-label": kind } : { "aria-hidden": true };
  return (
    <svg className={`kind-icon kind-${kind}${className === undefined ? "" : ` ${className}`}`} width={size} height={size} viewBox={`0 0 ${GLYPH_GRID} ${GLYPH_GRID}`} fill="none" stroke="currentColor" strokeWidth={GLYPH_STROKE} strokeLinecap="round" strokeLinejoin="round" focusable="false" {...named}>
      {PATHS[kind].map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}
