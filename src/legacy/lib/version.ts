/**
 * Single source of truth for the on-disk schema version.
 *
 * - v1 = flat structure (spec files at .tracker/ root)
 * - v2 = current milestone-folders shape (M{N}-{slug}/ directories)
 *
 * Increment this integer ONLY for intentional format breaks.
 * Patch/minor plugin releases do NOT touch this constant.
 */

export const CURRENT_SCHEMA_VERSION = 2 as const;
