/** Test helper: a TCP port on 127.0.0.1 that nothing holds right now. */

import { createServer, type AddressInfo } from "node:net";

/**
 * Binds a server to port 0, reads the port the system gave it, and closes it.
 * A fixed port fails with EADDRINUSE when another process or a parallel run holds it.
 * Another process can still take the port between this call and the listen, but that window is short.
 */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen({ host: "127.0.0.1", port: 0 }, () => {
      // SAFETY: a TCP server that listens has an AddressInfo address.
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}
