/** The delay hook of the shell's busy gem (0.98.0; the rule is in `busy.ts`). */

import { useEffect, useState } from "react";

/** `active`, once it has held for `delay` ms; false again as soon as it ends. */
export function useAfter(active: boolean, delay: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!active) {
      setLate(false);
      return;
    }
    const timer = setTimeout(() => setLate(true), delay);
    return () => clearTimeout(timer);
  }, [active, delay]);
  return active && late;
}
