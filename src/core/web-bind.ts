/**
 * The `DARIUS_WEB_BIND` list, shared by `darius serve` (what to listen on) and
 * `darius update` (which address to ask after a restart). No I/O, no imports.
 */

/** An address that would listen on every interface. `darius serve` refuses it. */
export const ANY_ADDRESS: ReadonlySet<string> = new Set(["0.0.0.0", "::", "[::]", "*", ""]);

/** The entries of a comma list, trimmed. `auto` is not special here. */
export function splitWebBind(raw: string): string[] {
  return raw.split(",").map((bind) => bind.trim());
}

function isLoopback(address: string): boolean {
  return address === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(address);
}

/**
 * The address a health check should ask, from a bind value (`DARIUS_WEB_BIND`):
 * 127.0.0.1 when the value is empty or `auto`, or lists it; else the first
 * loopback address in the list (127.x.x.x or ::1); else the first address.
 * Entries that mean every interface are skipped: `darius serve` refuses them.
 * An IPv6 address comes back with no brackets; the caller adds them to a URL.
 */
export function healthAddress(raw: string): string {
  const fallback = "127.0.0.1";
  if (raw.trim() === "auto") return fallback;
  const addresses = splitWebBind(raw)
    .filter((bind) => !ANY_ADDRESS.has(bind))
    .map((bind) => bind.replace(/^\[(.*)\]$/u, "$1"));
  if (addresses.includes(fallback)) return fallback;
  return addresses.find(isLoopback) ?? addresses[0] ?? fallback;
}
