/**
 * node:http to a web Request and a web Response back. The dev server uses
 * it; `darius serve` has its own copy in src/.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

export function toRequest(req: IncomingMessage, origin: string): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const one of Array.isArray(value) ? value : [value]) headers.append(name, one);
  }
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  const init: RequestInit & { duplex?: "half" } = { method, headers };
  if (hasBody) {
    // SAFETY: Readable.toWeb returns a web ReadableStream of the request bytes; the DOM lib types it apart from Node's.
    init.body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
    init.duplex = "half";
  }
  return new Request(new URL(req.url ?? "/", origin), init);
}

export async function sendResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  for (const [name, value] of response.headers) {
    if (name === "set-cookie") continue;
    res.setHeader(name, value);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) res.setHeader("set-cookie", cookies);
  if (response.body === null) {
    res.end();
    return;
  }
  for await (const chunk of response.body) res.write(chunk);
  res.end();
}
