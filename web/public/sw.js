/*
 * The darius service worker. It only shows Web Push notices and opens their
 * page: no fetch handler, no cache, so the page is always the live one.
 *
 * A push payload is JSON { title, body, url, tag } (src/core/push.ts). `url`
 * is a path on this origin; anything else opens the home page. `tag` replaces
 * an earlier notice with the same tag instead of stacking a second one.
 */

const HOME = "/";

/** A same-origin path, never `//host` or a full URL from the payload. */
function safePath(value) {
  return String(value ?? "").startsWith("/") && !String(value).startsWith("//") ? String(value) : HOME;
}

function readPayload(data) {
  if (data === null) return {};
  try {
    return Object(data.json());
  } catch {
    return { body: data.text() };
  }
}

self.addEventListener("install", () => {
  void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const payload = readPayload(event.data);
  const title = String(payload.title ?? "") || "darius";
  const options = {
    body: String(payload.body ?? ""),
    data: { url: safePath(payload.url) },
    icon: "/icon-192.png",
    badge: "/badge-72.png",
  };
  if (String(payload.tag ?? "") !== "") options.tag = String(payload.tag);
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(safePath(event.notification.data?.url), self.location.origin).href;
  event.waitUntil(openOrFocus(target));
});

/** Focus a darius tab and move it to the notice's page; open one when there is none. */
async function openOrFocus(target) {
  const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const exact = tabs.find((tab) => tab.url === target);
  if (exact !== undefined) return exact.focus();
  const any = tabs.find((tab) => new URL(tab.url).origin === self.location.origin);
  if (any === undefined) return self.clients.openWindow(target);
  const focused = await any.focus();
  return focused.navigate(target);
}
