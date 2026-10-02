/**
 * One row of filter chips, as the runs page and the findings page draw it.
 * On a phone the row scrolls sideways instead of wrapping, so the filter
 * stays a few lines tall; the chip that is on is scrolled into view, so the
 * row never hides the current filter.
 */

import { useEffect, useRef } from "react";

/** The class of a chip: `fchip`, lit when on; a toggle has a box in front. */
export function chipClass(isActive: boolean, isToggle = false): string {
  const kind = isToggle ? "fchip fchip-toggle" : "fchip";
  return isActive ? `${kind} fchip-on` : kind;
}

interface ChipRowProps {
  label: string;
  /** The chip that is on; the row scrolls it into view when this changes. */
  current: string;
  children: React.ReactNode;
}

export function ChipRow({ label, current, children }: ChipRowProps): React.ReactNode {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = row.current;
    if (element === null) return;
    const on = element.querySelector<HTMLElement>(".fchip-on:not(.fchip-toggle)");
    if (on === null) return;
    element.scrollLeft = Math.max(0, on.offsetLeft - (element.clientWidth - on.offsetWidth) / 2);
  }, [current]);
  return (
    <div ref={row} role="group" aria-label={label} className="fchips">
      {children}
    </div>
  );
}
