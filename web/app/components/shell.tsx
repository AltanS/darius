/**
 * The frame around every page. It has four parts. A phone has a top bar that
 * is also the button of the drawer (the caption and the name of the scope, a
 * chevron, a dot when another scope needs you), and a bar of five tabs at the
 * bottom: Overview, Vigils, Rituals, Findings, Milestones. A desktop (1024 px
 * and wider) has neither: a fixed sidebar takes their place. Both are in the
 * page always; CSS decides which one shows. The third part is Places (the
 * tree, `places.tsx`), the fourth is `<main>`.
 *
 * The scope is one workspace or all of them. A host page (Status, Profiles,
 * Settings) is in no scope, so the tabs and Places point at the last scope you
 * were in: it is kept in the cookie `darius_scope`, written here.
 */

import { useEffect } from "react";
import { Link, useLocation, useRouteLoaderData } from "react-router";

import type { RootData } from "../root.tsx";
import type { loader as runLoader } from "../routes/run.tsx";
import { Gem, NavIcon } from "./nav-icons.tsx";
import { Places, SectionIcon, TAB_SECTIONS, TabBadge, useMenuDismiss, type LitRow } from "./places.tsx";
import type { Kind } from "../lib/kind.ts";
import { href, placeOf, type Place, type Section } from "../lib/paths.ts";
import { effectiveScope, type TabCounts } from "../lib/scope.ts";
import { scopeCookieText } from "../lib/settings.ts";

/** The section a page belongs to, for the lit state: a ritual page is in Rituals, a run page in the section of its item. */
function sectionOf(place: Place, runKind: Kind | undefined): Section | null {
  if (place.kind === "overview" || place.kind === "host" || place.kind === "unknown") return null;
  if (place.kind === "detail" && place.section === "runs") return runKind === undefined ? null : runKind === "ritual" ? "rituals" : "vigils";
  return place.section;
}

/** The host page of a path, for the lit row of Places. */
function hostRowOf(pathname: string): LitRow | null {
  if (pathname === "/status") return "status";
  if (pathname === "/profiles") return "profiles";
  if (pathname === "/settings" || pathname.startsWith("/settings/")) return "settings";
  return null;
}

interface TopBarProps {
  data: RootData;
  scope: string | null;
  host: boolean;
  /** Keyed by the address, so the drawer closes after each navigation. */
  pathKey: string;
}

/** A press on the scrim shuts the drawer it sits in. */
function closeDrawer(event: React.MouseEvent<HTMLButtonElement>): void {
  const menu = event.currentTarget.closest<HTMLDetailsElement>("details");
  if (menu === null) return;
  menu.open = false;
  menu.querySelector("summary")?.focus();
}

/** The phone top bar: one button that opens Places as a drawer. A desktop does not show it. */
function TopBar({ data, scope, host, pathKey }: TopBarProps): React.ReactNode {
  // A dot when a scope other than this one needs you: another workspace, or on a host page any workspace. All workspaces already holds them all.
  const others = (host || scope !== null) && data.workspaces.some((entry) => entry.needs > 0 && (host || entry.name !== scope));
  return (
    <details key={pathKey} data-menu className="drawer">
      <summary className="topbar">
        <Gem size={28} />
        <span className="topbar-lab">
          <span className="topbar-cap">{host ? "Host" : "Workspace"}</span>
          <span className="topbar-now">{host ? data.host : (scope ?? "All workspaces")}</span>
        </span>
        <NavIcon name="chevron" size={16} className="topbar-chev" />
        {others ? (
          <>
            <i className="topbar-dot" aria-hidden="true" />
            <span className="sr-only">Another workspace needs you</span>
          </>
        ) : null}
      </summary>
      <button type="button" className="drawer-scrim" tabIndex={-1} aria-label="Close Places" onClick={closeDrawer} />
    </details>
  );
}

interface ShellProps {
  data: RootData;
  children: React.ReactNode;
}

export function Shell({ data, children }: ShellProps): React.ReactNode {
  useMenuDismiss();
  const location = useLocation();
  // The run page lights the section of its item (a ritual run: Rituals; a vigil run: Vigils); its loader knows the kind.
  const runKind = useRouteLoaderData<typeof runLoader>("routes/run")?.kind;
  const place = placeOf(location.pathname);
  const scope = effectiveScope(place, data.lastScope);
  const host = place.kind === "host";
  const section = sectionOf(place, runKind);
  const tabLit = section === "runs" ? null : section;
  const lit: LitRow | null = host ? hostRowOf(location.pathname) : place.kind === "overview" ? "overview" : section;
  const tabs: TabCounts = scope === null ? data.allTabs : (data.workspaces.find((entry) => entry.name === scope)?.tabs ?? { vigils: 0, rituals: 0, findings: 0 });
  // Remember the scope you are in, for the host pages and the error pages. A path with no scope (a 404) says nothing.
  const remembered = host || (place.kind === "unknown" && place.scope === null) ? undefined : place.scope;
  useEffect(() => {
    if (remembered !== undefined) document.cookie = scopeCookieText(remembered);
  }, [remembered]);
  return (
    <div className="app">
      <TopBar data={data} scope={scope} host={host} pathKey={`${location.pathname}${location.search}`} />
      <Places data={data} scope={scope} lit={lit} />
      <main className="wa page-main">{children}</main>
      <nav aria-label="Tabs" className="tabbar">
        <Link to={href({ to: "overview", ws: scope })} className={lit === "overview" ? "tab on" : "tab"} aria-current={lit === "overview" ? "page" : undefined}>
          <span className="tab-ico-wrap">
            <NavIcon name="overview" size={22} className="tab-ico" />
          </span>
          <span>Overview</span>
        </Link>
        {TAB_SECTIONS.map(({ section: tab, label, badge }) => (
          <Link key={tab} to={href({ to: "section", ws: scope, section: tab })} className={tabLit === tab ? "tab on" : "tab"} aria-current={tabLit === tab ? "page" : undefined}>
            <span className="tab-ico-wrap">
              <SectionIcon section={tab} size={22} />
              <TabBadge {...badge(tabs)} />
            </span>
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
