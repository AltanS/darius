/**
 * The strokes of the three things darius tells about, and of the manual
 * modifier (0.134.0): a lit candle, an eye that keeps watch for a vigil, and
 * two arrows chasing each other for a ritual. The one source of these paths:
 * the app draws them (`KindIcon` in components/kind.tsx, `NavIcon` in
 * components/nav-icons.tsx), and `web/scripts/mail-logo.ts` renders the mail
 * icons from them, so the app and the mail show the same marks.
 *
 * A 16 by 16 grid, no fill, round caps and joins, the stroke below. The
 * colour comes from the place that draws them.
 */

/** The side of the grid. */
export const GLYPH_GRID = 16;
/** The stroke width on that grid. */
export const GLYPH_STROKE = 1.6;

export const GLYPHS = {
  candle: ["M8 1.4C9.2 2.7 9.9 3.6 9.9 4.6A1.9 1.9 0 0 1 6.1 4.6C6.1 3.6 6.8 2.7 8 1.4Z", "M8 6.6V8.2", "M5.2 8.2H10.8V14.6H5.2Z"],
  ritual: ["M3.3 5.8A5.2 5.2 0 0 1 12.7 5.8M13.4 2.9L12.7 5.8L10 4.4", "M12.7 10.2A5.2 5.2 0 0 1 3.3 10.2M2.6 13.1L3.3 10.2L6 11.6"],
  manual: ["M3.2 6.2V10.4C3.2 12.8 5 14.4 7.5 14.4C9.8 14.4 11.3 13.3 12.4 11.6L14.1 8.9A1.1 1.1 0 0 0 12.3 7.7L10.7 9.6", "M5.7 8.2V4M8.2 8.2V2.6M10.7 9.2V4", "M3.2 6.2V7.8"],
  vigil: ["M1.4 8C3 4.9 5.3 3.6 8 3.6C10.7 3.6 13 4.9 14.6 8C13 11.1 10.7 12.4 8 12.4C5.3 12.4 3 11.1 1.4 8Z", "M8 6.1A1.9 1.9 0 1 0 8 9.9A1.9 1.9 0 1 0 8 6.1Z"],
} as const satisfies Record<string, readonly string[]>;

export type GlyphName = keyof typeof GLYPHS;
