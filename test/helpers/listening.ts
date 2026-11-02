/** Test helper: wait until a just started server takes connections. */

import { connect } from "node:net";

/** Waits until a just started server takes connections. A fixed wait is too short on a busy machine. */
export async function untilListening(port: number): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = connect({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (open) return;
    if (Date.now() > deadline) throw new Error(`nothing listens on port ${port}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
