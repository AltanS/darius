/**
 * A workspace icon (0.70.0): the emoji or the image the root `icon` of the
 * workspace's marker names. It sits in a fixed square box the size of a nav
 * icon, so a row with an icon and a row without one line up. It is
 * decorative: the workspace name next to it is what a screen reader hears.
 * An emoji is drawn as text (React escapes it); an image is an `<img>` of the
 * checked endpoint, never markup from the store.
 */

import type { WorkspaceIcon } from "../../../src/web/api.ts";

/** The path of the icon endpoint (WORKSPACE_ICON_PREFIX in src/web/workspace-icon.ts; the app imports `src/` as types only). */
const ICON_PATH = "/api/workspace-icon/";
/** The edge of the square box, in pixels: the size of the nav icons in Places (app.css, `.ws-icon`). */
const ICON_SIZE = 18;

interface WorkspaceGlyphProps {
  /** The workspace's icon; null when it has none. */
  icon: WorkspaceIcon | null;
  className?: string;
  /** What to draw when there is no icon: today's markup, so a workspace without one renders as before. */
  fallback?: React.ReactNode;
}

export function WorkspaceGlyph({ icon, className, fallback = null }: WorkspaceGlyphProps): React.ReactNode {
  const base = className === undefined ? "ws-icon" : `ws-icon ${className}`;
  if (icon === null) return fallback;
  if (icon.kind === "emoji") {
    return (
      <span className={`${base} ws-icon-emoji`} aria-hidden="true">
        {icon.text}
      </span>
    );
  }
  // Only the endpoint's own path: a src from anywhere else is not drawn (the CSP would block another origin anyway).
  if (!icon.src.startsWith(ICON_PATH)) return fallback;
  return <img className={`${base} ws-icon-img`} src={icon.src} alt="" width={ICON_SIZE} height={ICON_SIZE} loading="lazy" decoding="async" />;
}
