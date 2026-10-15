/**
 * When the frame shows its gem as busy (0.98.0): while the router navigates
 * or loads data again, but only after it has taken longer than 300 ms, so a
 * fast load never flashes. The refresh every minute counts as loading.
 */

/** A load shorter than this shows nothing. */
export const BUSY_AFTER_MS = 300;

/** True while the router works on a page. */
export function isLoading(navigation: "idle" | "loading" | "submitting", revalidation: "idle" | "loading"): boolean {
  return navigation !== "idle" || revalidation !== "idle";
}
