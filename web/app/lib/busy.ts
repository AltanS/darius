/**
 * When the frame shows its gem as busy: while the router
 * navigates to another page, and only after that has taken longer than
 * 300 ms, so a fast tap never flashes. A reload of the data that the page
 * asked for itself (the refresh every minute, the poll of a start, the load
 * after an action) is not a navigation: the gem stays still, because it
 * would blink at moments that carry no meaning.
 */

/** A navigation shorter than this shows nothing. */
export const BUSY_AFTER_MS = 300;

/** True while the router moves to another page. The state of the revalidator is not an input on purpose. */
export function isLoading(navigation: "idle" | "loading" | "submitting"): boolean {
  return navigation !== "idle";
}
