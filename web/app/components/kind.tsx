/**
 * The kinds (`lib/kind.ts`) as drawn things: an icon and chips. The icon is
 * decoration (two arrows chasing each other for a ritual, an eye for a vigil
 * that keeps watch, an open hand for the manual modifier); the word carries the
 * meaning (the chips are in `chip.tsx`). Where only an icon shows, `titled`
 * gives it a name for screen readers.
 */

import type { Kind } from "../lib/kind.ts";

/** What an icon can draw: a kind, or the manual modifier. */
export type Glyph = Kind | "manual";

/** The strokes of each icon, in a 16 by 16 box. */
const PATHS = {
  ritual: ["M3.3 5.8A5.2 5.2 0 0 1 12.7 5.8M13.4 2.9L12.7 5.8L10 4.4", "M12.7 10.2A5.2 5.2 0 0 1 3.3 10.2M2.6 13.1L3.3 10.2L6 11.6"],
  manual: ["M3.2 6.2V10.4C3.2 12.8 5 14.4 7.5 14.4C9.8 14.4 11.3 13.3 12.4 11.6L14.1 8.9A1.1 1.1 0 0 0 12.3 7.7L10.7 9.6", "M5.7 8.2V4M8.2 8.2V2.6M10.7 9.2V4", "M3.2 6.2V7.8"],
  vigil: ["M1.4 8C3 4.9 5.3 3.6 8 3.6C10.7 3.6 13 4.9 14.6 8C13 11.1 10.7 12.4 8 12.4C5.3 12.4 3 11.1 1.4 8Z", "M8 6.1A1.9 1.9 0 1 0 8 9.9A1.9 1.9 0 1 0 8 6.1Z"],
} as const satisfies Record<Glyph, readonly string[]>;

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
    <svg className={`kind-icon kind-${kind}${className === undefined ? "" : ` ${className}`}`} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" focusable="false" {...named}>
      {PATHS[kind].map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}
