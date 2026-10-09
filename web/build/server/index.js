import { n as createRequestHandler } from "./assets/chunk-H4DAEOV7-Br-5CKvD.js";
//#region server/load-context.ts
function loadContext(context) {
	return {
		viewer: context.viewer,
		nonce: context.nonce,
		canWrite: context.canWrite,
		status: () => context.status(),
		ritual: (project, slug) => context.ritual(project, slug),
		run: (project, run) => context.run(project, run),
		milestone: (project, milestone) => context.milestone(project, milestone),
		system: () => context.system(),
		backups: () => context.backups(),
		findings: () => context.findings(),
		followUp: (project, run) => context.followUp(project, run)
	};
}
//#endregion
//#region server/app.ts
/**
* The production entry: `darius serve` imports build/server/index.js and
* calls its default export with each request and a WebContext
* (src/web/api.ts). Everything is bundled into the build, so the file loads
* under Node and Bun with no node_modules beside it.
*/
var handle = createRequestHandler(() => import("./assets/server-build-DI6O-XfQ.js"), "production");
var handler = (request, context) => handle(request, loadContext(context));
//#endregion
export { handler as default };
