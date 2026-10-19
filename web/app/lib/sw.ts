/**
 * The one registration of the service worker (web/public/sw.js). The app
 * registers it at boot from root.tsx, and the push switch (push.tsx) uses
 * the same registration. The address names the darius version,
 * `/sw.js?v=<version>`, and the worker names its caches with it.
 *
 * At boot the page also listens to the worker: "stale" and "fresh" feed the
 * connection store (connection.ts). A page that opened from a saved copy
 * says "hello", and the worker answers "stale" if it served that copy. At
 * boot the page asks the worker to save the files of every route ("warm"),
 * and the page itself when the worker did not serve it.
 *
 * When the root data names another version than the one registered, the
 * page reloads once, so its files match the new build. sessionStorage
 * guards against a loop.
 */

import { useEffect } from "react";

import { connectionNow, markFresh, markStale } from "./connection.ts";

const WORKER_PATH = "/sw.js";
const RELOAD_KEY = "darius-reloaded-for";

export function workerUrl(version: string): string {
  return `${WORKER_PATH}?v=${encodeURIComponent(version)}`;
}

/** A worker needs a secure context (HTTPS, or localhost) and a browser that has one. */
export function canRegister(): boolean {
  return window.isSecureContext && "serviceWorker" in navigator;
}

let registered: { version: string; registration: Promise<ServiceWorkerRegistration> } | null = null;

/** Register the worker of this version once; a later call with the same version gets the same registration. */
export function registerWorker(version: string): Promise<ServiceWorkerRegistration> {
  if (registered !== null && registered.version === version) return registered.registration;
  const registration = navigator.serviceWorker.register(workerUrl(version), { scope: "/", updateViaCache: "none" });
  registered = { version, registration };
  return registration;
}

/** The version this page registered, or null before the first registration. */
export function registeredVersion(): string | null {
  return registered?.version ?? null;
}

export type WorkerMessage = { type: "stale"; savedAt: string | null } | { type: "fresh" } | null;

/** What a message of the worker says; null for anything else. */
export function readWorkerMessage(data: { type?: string; savedAt?: string | null } | null): WorkerMessage {
  const message = new Map(Object.entries(Object(data)));
  const type = message.get("type");
  if (type === "fresh") return { type: "fresh" };
  if (type !== "stale") return null;
  const savedAt = message.get("savedAt");
  return { type: "stale", savedAt: savedAt === undefined || savedAt === null || savedAt === "" ? null : String(savedAt) };
}

/** Whether the page must reload for a new version: once per version, never while the host is away. */
export function needsReload(booted: string | null, version: string, reloadedFor: string | null, lost: boolean): boolean {
  return booted !== null && booted !== version && reloadedFor !== version && !lost;
}

function onWorkerMessage(event: MessageEvent): void {
  const message = readWorkerMessage(event.data);
  if (message === null) return;
  if (message.type === "stale") markStale(message.savedAt);
  else markFresh();
}

interface RouteFiles {
  module: string;
  imports?: string[];
  css?: string[];
}

declare global {
  interface Window {
    /** The route manifest React Router puts in the page; whole, since routeDiscovery is "initial". */
    __reactRouterManifest?: { entry: RouteFiles; routes: { [id: string]: RouteFiles | undefined } };
  }
}

/** React Router's own global name; bracket access, as the name is not ours to change. */
const MANIFEST_KEY = "__reactRouterManifest";

/** Every file of the app's code: the entry and each route's module, imports and styles, so any page opens with no connection. */
function appFiles(): string[] {
  const manifest = window[MANIFEST_KEY];
  if (manifest === undefined) return [];
  const routes = Object.values(manifest.routes).filter((route) => route !== undefined);
  return [manifest.entry, ...routes].flatMap((route) => [route.module].concat(route.imports ?? [], route.css ?? []));
}

/** The same-origin files the page loaded and the files of every route, as full addresses, for the worker to save. */
function filesToSave(): string[] {
  const loaded = performance.getEntriesByType("resource").map((entry) => entry.name);
  const all = [...loaded, ...appFiles()].map((file) => new URL(file, location.origin).href).filter((href) => href.startsWith(`${location.origin}/`));
  return [...new Set(all)];
}

/** Register the worker at boot, listen to it, and reload once when the host runs a new version. */
export function useServiceWorker(version: string): void {
  useEffect(() => {
    if (!canRegister()) return;
    const container = navigator.serviceWorker;
    const controlled = container.controller !== null;
    container.addEventListener("message", onWorkerMessage);
    container.startMessages();
    container.controller?.postMessage({ type: "hello" }, []);
    registerWorker(version).catch(() => undefined);
    // The worker skips files it has. The page itself only when the worker did not serve it.
    const page = controlled ? "" : location.href;
    container.ready.then((registration) => registration.active?.postMessage({ type: "warm", page, files: filesToSave() }, []), () => undefined);
    return () => container.removeEventListener("message", onWorkerMessage);
    // The boot version only: a new version is the effect below.
  }, []);

  useEffect(() => {
    if (!canRegister()) return;
    if (!needsReload(registeredVersion(), version, sessionStorage.getItem(RELOAD_KEY), connectionNow().lost)) return;
    sessionStorage.setItem(RELOAD_KEY, version);
    registerWorker(version)
      .catch(() => undefined)
      .finally(() => location.reload());
  }, [version]);
}
