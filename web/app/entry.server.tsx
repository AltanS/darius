/**
 * Server rendering with the CSP nonce from the load context on every inline
 * script React Router writes. Web streams, so the same bundle runs under
 * Node and Bun. The page waits for all data before it answers: the store
 * reads are local and quick, and one complete document is simpler to check.
 */

import { renderToReadableStream } from "react-dom/server";
import { ServerRouter, type AppLoadContext, type EntryContext } from "react-router";

import { NonceContext } from "./lib/nonce.ts";

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext: AppLoadContext,
): Promise<Response> {
  const { nonce } = loadContext;
  let status = responseStatusCode;
  const body = await renderToReadableStream(
    <NonceContext value={nonce}>
      <ServerRouter context={routerContext} url={request.url} nonce={nonce} />
    </NonceContext>,
    {
      nonce,
      signal: request.signal,
      onError(error) {
        status = 500;
        console.error(error);
      },
    },
  );
  await body.allReady;
  responseHeaders.set("Content-Type", "text/html; charset=utf-8");
  return new Response(body, { headers: responseHeaders, status });
}
