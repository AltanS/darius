/**
 * The notification switch in the footer (0.32.0). It registers the service
 * worker (web/public/sw.js), asks the host for its VAPID key, and subscribes
 * this browser with `darius serve`'s push endpoints (src/web/push-api.ts):
 * GET /api/push/key, POST /api/push/subscribe, POST /api/push/unsubscribe.
 *
 * Push needs a secure context (HTTPS, or localhost), a browser with a push
 * service, and on an iPhone a darius icon on the Home Screen. When one is
 * missing, the switch says what to do instead of showing a dead button.
 * Everything happens in the browser: the server render shows nothing.
 */

import { useCallback, useEffect, useState } from "react";

type PushState =
  | { kind: "checking" }
  | { kind: "unavailable"; text: string }
  | { kind: "off"; key: string }
  | { kind: "on" }
  | { kind: "busy"; text: string }
  | { kind: "failed"; text: string };

const WORKER = "/sw.js";

/** The VAPID key arrives as base64url; the push manager wants its bytes. */
function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const base64 = key.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(key.length / 4) * 4, "=");
  const text = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(text.length));
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
  return bytes;
}

/** One field of a JSON reply, as text; null when it is missing or null. */
async function field(response: Response, name: string): Promise<string | null> {
  const reply = new Map(Object.entries(Object(await response.json())));
  const value = reply.get(name);
  return value === null || value === undefined ? null : String(value);
}

/** Why push cannot work in this browser, or null when it can. */
function blocker(): string | null {
  const iPhone = /iPhone|iPad|iPod/u.test(navigator.userAgent);
  const installed = window.matchMedia("(display-mode: standalone)").matches;
  if (iPhone && !installed) return "On an iPhone, add darius to the Home Screen first (Share, then Add to Home Screen), and turn notifications on there.";
  if (!window.isSecureContext) return "Notifications need HTTPS. Open darius by its https address.";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "This browser cannot show push notifications.";
  if (Notification.permission === "denied") return "Notifications are blocked for this site. Allow them in the browser's site settings.";
  return null;
}

/** Where this browser stands: a reason it cannot, or whether it is subscribed. */
async function check(): Promise<PushState> {
  const reason = blocker();
  if (reason !== null) return { kind: "unavailable", text: reason };
  const registration = await navigator.serviceWorker.register(WORKER, { scope: "/" });
  const response = await fetch("/api/push/key", { headers: { accept: "application/json" } });
  if (response.status === 404) return { kind: "unavailable", text: "This server has no notification endpoints. The dev server has none: run darius serve." };
  if (!response.ok) return { kind: "failed", text: `The host answered ${response.status} for its push key.` };
  const key = await field(response, "key");
  if (key === null) return { kind: "unavailable", text: "No push keys on this host yet (darius push keys)." };
  const subscription = await registration.pushManager.getSubscription();
  return subscription === null ? { kind: "off", key } : { kind: "on" };
}

/** What the two POST endpoints take: a subscription, or the endpoint to drop. */
type PushBody = PushSubscriptionJSON | { endpoint: string };

async function post(path: string, body: PushBody): Promise<string | null> {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
  if (response.ok) return null;
  return (await field(response, "error").catch(() => null)) ?? `The host answered ${response.status}.`;
}

async function turnOn(key: string): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { kind: "unavailable", text: "Notifications were not allowed. Allow them in the browser's site settings." };
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  const error = await post("/api/push/subscribe", subscription.toJSON());
  if (error === null) return { kind: "on" };
  await subscription.unsubscribe();
  return { kind: "failed", text: error };
}

async function turnOff(): Promise<PushState> {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription === null) return check();
  const error = await post("/api/push/unsubscribe", { endpoint: subscription.endpoint });
  await subscription.unsubscribe();
  return error === null ? check() : { kind: "failed", text: error };
}

function failure(cause: Error): PushState {
  return { kind: "failed", text: `Notifications failed: ${cause.message}` };
}

export function PushSwitch(): React.ReactNode {
  const [state, setState] = useState<PushState>({ kind: "checking" });
  useEffect(() => {
    check().then(setState, (cause: Error) => setState(failure(cause)));
  }, []);
  const run = useCallback((text: string, action: () => Promise<PushState>) => {
    setState({ kind: "busy", text });
    action().then(setState, (cause: Error) => setState(failure(cause)));
  }, []);

  switch (state.kind) {
    case "checking":
      return null;
    case "unavailable":
      return <p className="push push-note">{state.text}</p>;
    case "busy":
      return <p className="push push-note">{state.text}</p>;
    case "failed":
      return (
        <p className="push push-note ink-bad">
          {state.text}{" "}
          <button type="button" className="push-btn" onClick={() => run("Checking…", check)}>
            Try again
          </button>
        </p>
      );
    case "off":
      return (
        <p className="push">
          <button type="button" className="push-btn" onClick={() => run("Turning notifications on…", () => turnOn(state.key))}>
            Turn on notifications
          </button>
        </p>
      );
    case "on":
      return (
        <p className="push">
          <span className="push-on">
            <span className="status-dot" aria-hidden="true" />
            Notifications on for this device
          </span>
          <button type="button" className="push-btn" onClick={() => run("Turning notifications off…", turnOff)}>
            Turn off
          </button>
        </p>
      );
  }
}
