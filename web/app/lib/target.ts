/**
 * The element a URL hash points at. The server never sees the hash, so the
 * first render has no target and hydration matches; the target arrives
 * after mount. A client navigation does not update the CSS `:target`, so
 * pages mark the row themselves and scroll to it once it can be seen, for
 * example after a fold opened for it.
 */

import { useEffect, useState } from "react";
import { useLocation } from "react-router";

function decoded(hash: string): string {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function useHashTarget(): string {
  const { hash } = useLocation();
  const [target, setTarget] = useState("");
  useEffect(() => {
    setTarget(decoded(hash));
  }, [hash]);
  useEffect(() => {
    if (target === "") return;
    document.getElementById(target)?.scrollIntoView({ block: "center" });
  }, [target]);
  return target;
}
