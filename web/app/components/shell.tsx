/**
 * The frame around every page. It has four parts. A phone has a top bar that
 * is also the button of the drawer (the caption and the name of the scope, a
 * chevron, a dot when another scope needs you), and a bar of six tabs at the
 * bottom: Overview, Vigils, Rituals, Findings, Candles, Milestones. A desktop (1024 px
 * and wider) has neither: a fixed sidebar takes their place. Both are in the
 * page always; CSS decides which one shows. The third part is Places (the
 * tree, `places.tsx`), the fourth is `<main>`. Over them floats the connection
 * strip (`connection-strip.tsx`) when the host is away. On a page of a
 * workspace, the milestone finder (`finder.tsx`) has a button in the phone top
 * bar and a row in the desktop sidebar.
 *
 * The machine bar (`host-strip.tsx`, 0.139.0) heads `<main>` on every page:
 * the label "Machines", then one chip per machine of the synced store, live,
 * each a link to its machine page. Since 0.140.0 it is a sticky one-line bar
 * (under the phone top bar on a phone), and the Places head is sticky in the
 * sidebar. While a navigation takes over 300 ms, the gem blinks and a text
 * names the page it opens ("Opening Workspaces…"), in a polite live region:
 * in the phone top bar next to the gem, on a desktop at the right of the
 * machine bar (the sidebar head keeps the name and the machine name).
 *
 * The scope is one workspace or all of them. A page in no workspace
 * (Machines, Workspaces, Profiles, Settings) is in no scope: Places lights
 * its own row and opens no branch (0.141.0), and the phone tabs point at the
 * last scope you were in, kept in the cookie `darius_scope`, written here.
 */

import { useEffect } from "react";
import { Link, useLocation, useNavigation, useRouteLoaderData } from "react-router";

import type { RootData } from "../root.tsx";
import type { loader as runLoader } from "../routes/run.tsx";
import { ConnectionStrip } from "./connection-strip.tsx";
import { HostStrip } from "./host-strip.tsx";
import { FinderButton, FinderDialog, useFinder } from "./finder.tsx";
import { Gem, NavIcon } from "./nav-icons.tsx";
import { Places, SectionIcon, TAB_SECTIONS, TabBadge, useMenuDismiss } from "./places.tsx";
import { WorkspaceGlyph } from "./workspace-icon.tsx";
import { BUSY_AFTER_MS, isLoading } from "../lib/busy.ts";
import { href, navOf, pageLabel, placeOf } from "../lib/paths.ts";
import { effectiveScope, NO_TABS, type TabCounts } from "../lib/scope.ts";
import { scopeCookieText } from "../lib/settings.ts";
import { useAfter } from "../lib/use-after.ts";

interface TopBarProps {
  data: RootData;
  scope: string | null;
  /** The page is in no workspace: its caption and name come from `pageLabel`. */
  host: boolean;
  /** The label of the page on screen ("Machines", "machine host-b"), for a page in no workspace. */
  label: string;
  /** Keyed by the address, so the drawer closes after each navigation. */
  pathKey: string;
  /** The router has navigated for more than 300 ms: the gem blinks. A reload of the data in place does not count. */
  busy: boolean;
  /** "Opening Workspaces…" while busy, else empty. */
  loading: string;
}

/** A press on the scrim shuts the drawer it sits in. */
function closeDrawer(event: React.MouseEvent<HTMLButtonElement>): void {
  const menu = event.currentTarget.closest<HTMLDetailsElement>("details");
  if (menu === null) return;
  menu.open = false;
  menu.querySelector("summary")?.focus();
}

/** The phone top bar: one button that opens Places as a drawer. A desktop does not show it. */
function TopBar({ data, scope, host, label, pathKey, busy, loading }: TopBarProps): React.ReactNode {
  // A dot when a scope other than this one needs you: another workspace, or on a host page any workspace. All workspaces already holds them all.
  const others = (host || scope !== null) && data.workspaces.some((entry) => entry.needs > 0 && (host || entry.name !== scope));
  const icon = host || scope === null ? null : (data.workspaces.find((entry) => entry.name === scope)?.icon ?? null);
  return (
    <details key={pathKey} data-menu className="drawer">
      <summary className="topbar">
        <Gem size={28} busy={busy} />
        <span className="topbar-lab">
          <span className="topbar-cap" hidden={loading !== ""}>
            {host ? "darius" : scope === null ? "All workspaces" : "Workspace"}
          </span>
          <span className="topbar-now">
            <WorkspaceGlyph icon={icon} className="topbar-icon" />
            {host ? label : (scope ?? "Overview")}
          </span>
          <span className="busy-text topbar-busy" aria-live="polite">
            {loading}
          </span>
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
  // The milestone finder (0.125.0): on every page of a workspace, from a button, `/` or Ctrl+K.
  const finder = useFinder(data.finder !== null);
  // The gems of the bar and of Places blink while the router navigates for over 300 ms. The minute refresh, the poll of a start and the load after an action do not count.
  const navigation = useNavigation();
  const busy = useAfter(isLoading(navigation.state), BUSY_AFTER_MS);
  const location = useLocation();
  // The words next to the busy gem: what the tap opens, from its address (0.140.0).
  const target = busy && navigation.location !== undefined ? pageLabel(navigation.location.pathname) : null;
  const loading = target === null ? (busy ? "Loading…" : "") : `Opening ${target}…`;
  // The tab and the Places row light from the page the tap goes to, not from the page that is on screen: the tap shows at once, before the loader answers.
  const shown = navigation.location ?? location;
  // The run page lights the section of its item (a ritual run: Rituals; a vigil run: Vigils); its loader knows the kind, but only for the run on screen.
  const runKind = useRouteLoaderData<typeof runLoader>("routes/run")?.kind;
  const nav = navOf(shown.pathname, shown.pathname === location.pathname ? runKind : undefined);
  // The scope, the cookie and the top bar follow the page on screen, so a tap that is cancelled leaves nothing behind.
  const place = placeOf(location.pathname);
  const scope = effectiveScope(place, data.lastScope);
  const host = place.kind === "host";
  // Runs and Activity are places, not tabs: they light a Places row and no tab. A page in no workspace lights no tab.
  const lit = nav.branch === null ? null : nav.lit;
  const tabLit = lit === "runs" || lit === "activity" ? null : lit;
  const tabs: TabCounts = scope === null ? data.allTabs : (data.workspaces.find((entry) => entry.name === scope)?.tabs ?? NO_TABS);
  // Remember the scope you are in, for the host pages and the error pages. A path with no scope (a 404) says nothing.
  const remembered = host || (place.kind === "unknown" && place.scope === null) ? undefined : place.scope;
  useEffect(() => {
    if (remembered !== undefined) document.cookie = scopeCookieText(remembered);
  }, [remembered]);
  return (
    <div className={data.finder === null ? "app" : "app has-finder"}>
      <TopBar data={data} scope={scope} host={host} label={pageLabel(location.pathname) ?? data.host} pathKey={`${location.pathname}${location.search}`} busy={busy} loading={loading} />
      {data.finder === null ? null : <FinderButton finder={finder} className="finder-btn finder-btn-bar" />}
      <ConnectionStrip generatedAt={data.generatedAt} />
      <Places data={data} lit={nav.lit} branch={nav.branch} busy={busy} finder={data.finder === null ? null : finder} />
      <main className="wa page-main">
        <HostStrip peers={data.peers} loading={loading} />
        {children}
      </main>
      <nav aria-label="Tabs" className="tabbar">
        <Link to={href({ to: "overview", ws: scope })} className={tabLit === "overview" ? "tab on" : "tab"} aria-current={tabLit === "overview" ? "page" : undefined}>
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
      {finder.open && data.finder !== null ? <FinderDialog ws={data.finder.ws} rows={data.finder.rows} onClose={finder.hide} /> : null}
    </div>
  );
}
