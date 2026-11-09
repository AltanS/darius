/**
 * Text that leaves the process in a ledger line or a warning must not hold an
 * address that works as a secret: the dead-man ping URL, or a full bucket
 * endpoint. These helpers cut an address down to its host name.
 */

const MAX_TEXT = 300;

/** The host name of an endpoint URL, or the text itself when it is not a URL. Never a port, path or user. */
export function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).hostname;
  } catch {
    return endpoint;
  }
}

/** The path of a URL without a trailing slash, or "" for text that is no URL. A path can be the secret part. */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/u, "");
  } catch {
    return "";
  }
}

/**
 * One line of text for a ledger line: a URL in `hide` is cut to its host
 * name and its path is cut, whitespace is collapsed, and the length is capped. A ping URL or a
 * full endpoint must not reach the ledger through an error message.
 */
export function scrubForLedger(text: string, hide: readonly string[] = []): string {
  let out = text;
  for (const url of hide) {
    if (url === "") continue;
    out = out.replaceAll(url, endpointHost(url));
    const bare = url.replace(/\/+$/u, "");
    if (bare !== "") out = out.replaceAll(bare, endpointHost(url));
    const path = pathOf(url);
    if (path.length > 1) out = out.replaceAll(path, "/...");
  }
  out = out.replaceAll(/\s+/gu, " ").trim();
  return out.length > MAX_TEXT ? `${out.slice(0, MAX_TEXT - 3)}...` : out;
}

/**
 * The text with the userinfo of every URL in it removed: `https://user:token@host/x`
 * becomes `https://host/x`. For tool output that may quote a URL with a
 * secret in it, such as git's stderr (0.126.0).
 */
export function stripUrlUserinfo(text: string): string {
  return text.replaceAll(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/giu, "$1");
}
