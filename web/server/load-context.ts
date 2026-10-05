/**
 * The WebContext as React Router's load context. AppLoadContext carries a
 * string index signature, which an interface does not satisfy, so this
 * copies the members into a plain object with the methods bound.
 */

import type { AppLoadContext } from "react-router";

import type { WebContext } from "../../src/web/api.ts";

export function loadContext(context: WebContext): AppLoadContext {
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
    followUp: (project, run) => context.followUp(project, run),
  };
}
