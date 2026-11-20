/**
 * darius serve keeps an idle connection open longer than a proxy in front of it. A proxy reuses
 * idle upstream connections for up to 90 s and does not retry a POST, so a server that closed the
 * socket after 5 s made the proxy answer 502 to a POST that never reached darius.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { connect } from "node:net";
import type { AddressInfo } from "node:net";

const { keepIdleConnections, IDLE_KEEP_ALIVE_MS } = await import("../src/cli/serve.ts");

test("the web server keeps idle connections longer than a proxy's 90 s pool", () => {
  const server = createServer();
  keepIdleConnections(server);
  assert.equal(server.keepAliveTimeout, IDLE_KEEP_ALIVE_MS);
  assert.ok(IDLE_KEEP_ALIVE_MS > 90_000, "outlasts Traefik's and Go's default idle time");
  assert.ok(server.headersTimeout > server.keepAliveTimeout);
});

test("a connection idle for 6 s still takes a POST", async () => {
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => response.end("ok"));
  });
  keepIdleConnections(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  // SAFETY: a server listening on a TCP port reports an AddressInfo, never a pipe name or null.
  const port = (server.address() as AddressInfo).port;
  const socket = connect(port, "127.0.0.1");
  let seen = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    seen += chunk;
  });
  const closed = new Promise<void>((resolve) => socket.on("close", () => resolve()));
  const answers = async (count: number): Promise<void> => {
    for (let wait = 0; wait < 100 && (seen.match(/HTTP\/1\.1 200/g) ?? []).length < count; wait++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  try {
    socket.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
    await answers(1);
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    assert.equal(socket.destroyed, false, "the server kept the idle socket open");
    socket.write("POST /api/push/subscribe HTTP/1.1\r\nHost: x\r\nContent-Length: 2\r\n\r\n{}");
    await answers(2);
    assert.equal((seen.match(/HTTP\/1\.1 200/g) ?? []).length, 2, "the reused socket answered the POST");
  } finally {
    socket.destroy();
    await closed;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
