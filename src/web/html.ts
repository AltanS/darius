/**
 * The few answers `darius serve` gives without the web app: the 403 page,
 * and the page for a missing build. Every value passes through escapeHtml.
 */

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (ch) => `&#${String(ch.codePointAt(0))};`);
}

const STYLE =
  "body{margin:0;background:#15100b;color:#e2d3ae;font:16px/1.5 system-ui,sans-serif}" +
  "main{max-width:40rem;margin:4rem auto;padding:1.5rem;border:1px solid #4a3a27;background:#1f1811}" +
  "h1{margin:0 0 1rem;color:#c8a24e;font:600 1.5rem Georgia,serif;letter-spacing:.08em}p{margin:.5rem 0}.meta{color:#a38f6b}";

/** A page with one message, for answers outside the app. */
export function plainPage(title: string, message: string, note: string): string {
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>darius: ${escapeHtml(title)}</title><style>${STYLE}</style></head>`,
    `<body><main><h1>darius</h1><p>${escapeHtml(message)}</p><p class="meta">${escapeHtml(note)}</p></main></body></html>`,
  ].join("");
}

export function renderForbidden(reason: string): string {
  return plainPage("not allowed", `Not allowed: ${reason}.`, "Only devices of the allowed Tailscale logins may see this page.");
}
