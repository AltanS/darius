/**
 * Loaders see the WebContext that darius serve passes with each request
 * (src/web/api.ts). Type-only: nothing from src/ is bundled.
 */

import type { WebContext } from "../../src/web/api.ts";

declare module "react-router" {
  interface AppLoadContext extends WebContext {}
}
