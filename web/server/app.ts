/**
 * The production entry: `darius serve` imports build/server/index.js and
 * calls its default export with each request and a WebContext
 * (src/web/api.ts). Everything is bundled into the build, so the file loads
 * under Node and Bun with no node_modules beside it.
 */

import { createRequestHandler } from "react-router";

import type { WebHandler } from "../../src/web/api.ts";
import { loadContext } from "./load-context.ts";

const handle = createRequestHandler(() => import("virtual:react-router/server-build"), "production");

const handler: WebHandler = (request, context) => handle(request, loadContext(context));

export default handler;
