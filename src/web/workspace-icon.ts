/**
 * The workspace icon (0.70.0): the root `icon` of a project's v3 marker,
 * shown by the web app next to the project name. An emoji is plain text in
 * the status. An image path is served by `GET /api/workspace-icon/<project>`
 * (src/cli/serve.ts), and only after this module has checked the file:
 *
 * - The path comes from the marker only, never from the request, and the
 *   parser has checked it as text (relative, no `..`, an image extension).
 * - The real path (symlinks resolved) must be inside the real checkout, so a
 *   symlink out of the repo is refused.
 * - It must be a regular file of at most 64 KB, opened without following a
 *   last symlink, and checked with fstat on the open file.
 * - The type comes from the first bytes, not the name: a PNG or WebP
 *   signature, or SVG text that starts with `<svg` after an optional BOM, an
 *   XML prolog and comments. The extension must agree with it.
 *
 * Every failure is a reason for the log. The endpoint answers each one with
 * the same plain 404, and the status drops the icon, so a bad icon never
 * breaks the page and never leaks a path.
 */

import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";

import { linkedDir } from "../core/links.ts";
import { iconImageExtension, iconPathProblem, readMarker, type IconImageExtension, type Marker } from "../core/marker.ts";
import { isProjectName, listProjects } from "../core/store.ts";
import { errorMessage } from "../runtime.ts";
import type { WorkspaceIcon } from "./api.ts";

/** The largest icon file served, in bytes. */
export const MAX_ICON_BYTES = 64 * 1024;
/** The path prefix of the icon endpoint; the project name follows it. */
export const WORKSPACE_ICON_PREFIX = "/api/workspace-icon/";

const CONTENT_TYPES = { svg: "image/svg+xml", png: "image/png", webp: "image/webp" } as const satisfies Record<IconImageExtension, string>;
export type IconContentType = (typeof CONTENT_TYPES)[IconImageExtension];

/** A checked icon file: its type from the magic bytes, its bytes, and a strong ETag of the bytes. */
export interface IconFile {
  type: IconContentType;
  bytes: Uint8Array;
  etag: string;
}

export type IconRead = { ok: true; icon: IconFile } | { ok: false; reason: string };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const BOM = "﻿";

function startsWithBytes(bytes: Uint8Array, expected: readonly number[], offset = 0): boolean {
  return expected.every((byte, index) => bytes[offset + index] === byte);
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  return startsWithBytes(bytes, [...text].map((char) => char.charCodeAt(0)), offset);
}

/** The text after leading white space, XML prologs (`<?...?>`) and comments (`<!--...-->`). Undefined when one is not closed. */
function afterProlog(text: string): string | undefined {
  let rest = text.trimStart();
  // Each pass drops one prolog or comment, so the text length bounds the loop.
  for (let pass = 0; pass <= text.length; pass += 1) {
    const close = rest.startsWith("<?") ? "?>" : rest.startsWith("<!--") ? "-->" : null;
    if (close === null) return rest;
    const end = rest.indexOf(close, 2);
    if (end === -1) return undefined;
    rest = rest.slice(end + close.length).trimStart();
  }
  return undefined;
}

/** True when `bytes` are UTF-8 text whose first element, after a BOM, prologs and comments, is `<svg`. */
function isSvg(bytes: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return false;
  }
  const body = afterProlog(text.startsWith(BOM) ? text.slice(BOM.length) : text);
  return body !== undefined && /^<svg[\s>/]/u.test(body);
}

/** The image type of `bytes` by their first bytes, or undefined. */
export function sniffIconType(bytes: Uint8Array): IconImageExtension | undefined {
  if (startsWithBytes(bytes, PNG_SIGNATURE)) return "png";
  if (bytes.length >= 12 && asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")) return "webp";
  if (isSvg(bytes)) return "svg";
  return undefined;
}

/** The real path of `relPath` under `checkout`, when it stays inside the real checkout. */
function realInside(checkout: string, relPath: string): { ok: true; path: string } | { ok: false; reason: string } {
  let root: string;
  let real: string;
  try {
    root = realpathSync(checkout);
  } catch (cause) {
    return { ok: false, reason: `the checkout cannot be read: ${errorMessage(cause)}` };
  }
  try {
    real = realpathSync(join(root, relPath));
  } catch (cause) {
    return { ok: false, reason: `the icon file cannot be found: ${errorMessage(cause)}` };
  }
  if (!real.startsWith(`${root}${sep}`)) return { ok: false, reason: "the icon file resolves to a place outside the checkout" };
  return { ok: true, path: real };
}

/** At most MAX_ICON_BYTES + 1 bytes of the regular file at `path`; a reason when it is not one or is too large. */
function readSmallFile(path: string): { ok: true; bytes: Uint8Array } | { ok: false; reason: string } {
  let fd: number;
  try {
    // The path is already real, so O_NOFOLLOW only refuses a symlink put there since.
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (cause) {
    return { ok: false, reason: `the icon file cannot be opened: ${errorMessage(cause)}` };
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { ok: false, reason: "the icon path is not a regular file" };
    if (stat.size > MAX_ICON_BYTES) return { ok: false, reason: `the icon file is ${String(stat.size)} bytes, more than ${String(MAX_ICON_BYTES)}` };
    const buffer = new Uint8Array(MAX_ICON_BYTES + 1);
    let size = 0;
    // A file that grows after fstat stops at one byte over the limit, which is refused below. Each pass reads at least one byte or stops.
    for (let pass = 0; pass < buffer.length && size < buffer.length; pass += 1) {
      const read = readSync(fd, buffer, size, buffer.length - size, null);
      if (read === 0) break;
      size += read;
    }
    if (size > MAX_ICON_BYTES) return { ok: false, reason: `the icon file is more than ${String(MAX_ICON_BYTES)} bytes` };
    return { ok: true, bytes: buffer.slice(0, size) };
  } catch (cause) {
    return { ok: false, reason: `the icon file cannot be read: ${errorMessage(cause)}` };
  } finally {
    closeSync(fd);
  }
}

/**
 * The icon file `relPath` of the checkout, checked: the path rules of the
 * marker, inside the real checkout, a regular file of at most 64 KB, an image
 * by its first bytes, and an extension that agrees. Never throws.
 */
export function readWorkspaceIcon(checkout: string, relPath: string): IconRead {
  const problem = iconPathProblem(relPath);
  if (problem !== undefined) return { ok: false, reason: `the icon path is not valid: ${problem}` };
  const extension = iconImageExtension(relPath);
  const inside = realInside(checkout, relPath);
  if (!inside.ok) return inside;
  const file = readSmallFile(inside.path);
  if (!file.ok) return file;
  const sniffed = sniffIconType(file.bytes);
  if (sniffed === undefined) return { ok: false, reason: "the icon file is not a PNG, WebP or SVG image" };
  if (sniffed !== extension) return { ok: false, reason: `the icon file is ${sniffed} by its content, but its name ends in .${String(extension)}` };
  const hash = createHash("sha256").update(file.bytes).digest("hex").slice(0, 16);
  return { ok: true, icon: { type: CONTENT_TYPES[sniffed], bytes: file.bytes, etag: `"${hash}"` } };
}

/** The v3 marker of `checkout`, or null: none, an older one, or one that does not parse. */
function v3Marker(checkout: string): Marker | null {
  try {
    const marker = readMarker(checkout);
    return marker !== null && marker.version >= 3 ? marker : null;
  } catch {
    return null;
  }
}

/** The app path of a project's image icon, with the ETag hash as the cache buster. */
export function workspaceIconSrc(project: string, file: IconFile): string {
  return `${WORKSPACE_ICON_PREFIX}${encodeURIComponent(project)}?v=${file.etag.replaceAll('"', "")}`;
}

/** The icon of `project` for the status, from the marker of its checkout; null when it has none or the image is not valid. Never throws. */
export function workspaceIconOf(project: string, checkout: string | null): WorkspaceIcon | null {
  if (checkout === null) return null;
  const icon = v3Marker(checkout)?.icon;
  if (icon === undefined) return null;
  if (icon.kind === "emoji") return { kind: "emoji", text: icon.text };
  const read = readWorkspaceIcon(checkout, icon.path);
  return read.ok ? { kind: "image", src: workspaceIconSrc(project, read.icon) } : null;
}

/** The image icon of the project the endpoint names: a known project with a linked checkout and an image `icon`. */
export function projectIconImage(project: string): IconRead {
  if (!isProjectName(project)) return { ok: false, reason: "not a project name" };
  if (!listProjects().includes(project)) return { ok: false, reason: "no such project in the store" };
  const checkout = linkedDir(project);
  if (checkout === undefined) return { ok: false, reason: "the project has no checkout on this host" };
  const icon = v3Marker(checkout)?.icon;
  if (icon?.kind !== "image") return { ok: false, reason: "the marker names no image icon" };
  return readWorkspaceIcon(checkout, icon.path);
}

/** What the endpoint answers, before serve puts it on the socket. */
export interface IconReply {
  status: 200 | 304 | 404;
  headers: Headers;
  body: Uint8Array | string;
}

/** True when an `If-None-Match` header names `etag` (or is `*`); a weak `W/` form matches too. */
function matchesEtag(header: string | null, etag: string): boolean {
  if (header === null) return false;
  return header.split(",").some((part) => {
    const tag = part.trim();
    return tag === "*" || tag === etag || tag === `W/${etag}`;
  });
}

function notFound(): IconReply {
  const headers = new Headers({ "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'", "x-content-type-options": "nosniff" });
  return { status: 404, headers, body: "not found\n" };
}

/**
 * `GET /api/workspace-icon/<project>`: the project's image icon, or a plain
 * 404 that names no path and no reason. The reason goes to the journal. The
 * caller has passed the access check and refused other methods.
 */
export function workspaceIconReply(pathname: string, ifNoneMatch: string | null): IconReply {
  const project = pathname.slice(WORKSPACE_ICON_PREFIX.length);
  const read = projectIconImage(project);
  if (!read.ok) {
    // Only a valid name goes into the log line: anything else could carry control characters.
    console.error(`darius serve: workspace icon ${isProjectName(project) ? project : "(bad name)"}: ${read.reason}`);
    return notFound();
  }
  const { icon } = read;
  const headers = new Headers({
    "content-type": icon.type,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    "cross-origin-resource-policy": "same-origin",
    "cache-control": "private, max-age=300",
    etag: icon.etag,
  });
  if (matchesEtag(ifNoneMatch, icon.etag)) return { status: 304, headers, body: "" };
  return { status: 200, headers, body: icon.bytes };
}
