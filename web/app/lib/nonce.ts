/**
 * The CSP nonce of this response. entry.server.tsx provides it from the load
 * context; on the client it is undefined, which is fine: hydration never
 * adds an inline script.
 */

import { createContext } from "react";

export const NonceContext = createContext<string | undefined>(undefined);
