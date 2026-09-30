/**
 * The page clock. The server and the first client render both use the
 * status time from the root loader, so hydration sees the same text. After
 * hydration the clock follows the browser and ticks every 30 seconds.
 */

import { createContext, useContext, useEffect, useState } from "react";

export interface Clock {
  /** Milliseconds, for relative times. */
  now: number;
  /** The host's local date, YYYY-MM-DD, for due dates. */
  today: string;
  /** The host's UTC offset in minutes east, for clock times that read the same on the server and in the browser. */
  offset: number;
}

const ClockContext = createContext<Clock>({ now: 0, today: "1970-01-01", offset: 0 });

export function useClock(): Clock {
  return useContext(ClockContext);
}

const TICK_MS = 30_000;

interface ClockProviderProps {
  generatedAt: string;
  today: string;
  offset: number;
  children: React.ReactNode;
}

export function ClockProvider({ generatedAt, today, offset, children }: ClockProviderProps): React.ReactNode {
  const [browserNow, setBrowserNow] = useState<number | null>(null);
  useEffect(() => {
    setBrowserNow(Date.now());
    const timer = setInterval(() => setBrowserNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  const now = browserNow ?? Date.parse(generatedAt);
  return <ClockContext value={{ now, today, offset }}>{children}</ClockContext>;
}
