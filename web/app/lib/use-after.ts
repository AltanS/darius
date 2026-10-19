/** The delay hook of the busy gem and of the wait line (the rules are in `busy.ts` and `wait-line.tsx`). */

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
