/**
 * The frame around every page. The top bar has three things: the brand gem
 * (it opens the Overview of the scope you are in), the workspace switcher and
 * the settings gear. The scope is one workspace or all of them. The switcher
 * opens as a sheet under the bar on a phone and as a menu on a desktop; its
 * first entry is the Overview of the current scope, then All workspaces, then
 * each workspace with what needs you. The three sections of the scope, Vigils,
 * Rituals and Milestones, are the tabs: at the bottom of a phone, under the
 * bar on a desktop. One footer line holds the host facts.
 */

import { useEffect } from "react";
import { Link, useLocation } from "react-router";

import type { RootData } from "../root.tsx";
import { KindIcon } from "./kind.tsx";
import { Gem, NavIcon } from "./nav-icons.tsx";
import { clockTime, sectionPath, workspacePath } from "../lib/format.ts";
import { placeOf, type Place, type Section, type TabCounts } from "../lib/scope.ts";

interface SectionSpec {
  section: Section;
  label: string;
  /** The badge counts these: the sentence reads "3 late". */
  badge: (tabs: TabCounts) => { count: number; tone: "wait" | "late"; text: string };
}

/** The tabs, in order. The badge of Vigils counts those due today or late, the badge of Rituals those late. */
const SECTIONS: readonly SectionSpec[] = [
  { section: "vigils", label: "Vigils", badge: (tabs) => ({ count: tabs.vigils, tone: "wait", text: "due today or late" }) },
  { section: "rituals", label: "Rituals", badge: (tabs) => ({ count: tabs.rituals, tone: "late", text: "late" }) },
  { section: "milestones", label: "Milestones", badge: () => ({ count: 0, tone: "wait", text: "" }) },
];

interface SectionIconProps {
  section: Section;
  size: number;
}

function SectionIcon({ section, size }: SectionIconProps): React.ReactNode {
  if (section === "milestones") return <NavIcon name="milestone" size={size} className="tab-ico" />;
  return <KindIcon kind={section === "vigils" ? "vigil" : "ritual"} size={size} className="tab-ico" />;
}

interface BadgeProps {
  count: number;
  tone: "wait" | "late";
  text: string;
}

/** The count on a tab: a small solid square with the number; screen readers hear what it counts. */
function TabBadge({ count, tone, text }: BadgeProps): React.ReactNode {
  if (count === 0) return null;
  return (
    <span className={`tab-bdg tone-${tone}`} title={`${count} ${text}`}>
      <span aria-hidden="true">{count}</span>
      <span className="sr-only">{`${count} ${text}`}</span>
    </span>
  );
}

/** Closes open menus on a press outside them and on Escape; a link inside closes one by changing the path. */
function useMenuDismiss(): void {
  useEffect(() => {
    const close = (except: EventTarget | null): void => {
      for (const menu of document.querySelectorAll<HTMLDetailsElement>("details[data-menu][open]")) {
        if (except === null || !(except instanceof Node) || !menu.contains(except)) menu.open = false;
      }
    };
    const onPress = (event: Event): void => close(event.target);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close(null);
    };
    document.addEventListener("pointerdown", onPress);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPress);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
}

/** The scrim behind the switcher sheet: a press on it shuts the menu it sits in. */
function closeMenu(event: React.MouseEvent<HTMLButtonElement>): void {
  const menu = event.currentTarget.closest<HTMLDetailsElement>("details");
  if (menu === null) return;
  menu.open = false;
  menu.querySelector("summary")?.focus();
}

interface SwitcherProps {
  data: RootData;
  place: Place;
  /** The address of the scope's Overview. */
  overview: string;
  /** Where a click on the scope lands: the same section of it, or its Overview. */
  to: (workspace: string | null) => string;
  pathKey: string;
}

/** A line of the switcher: a name, what it is, and what needs you there. */
interface EntryProps {
  href: string;
  name: string;
  icon: "workspace" | "all" | "overview";
  note: string;
  needs: number;
  unreadable?: boolean;
  current: boolean;
}

function Entry({ href, name, icon, note, needs, unreadable = false, current }: EntryProps): React.ReactNode {
  return (
    <Link to={href} className={current ? "sw-item on" : "sw-item"} aria-current={current ? "true" : undefined}>
      <NavIcon name={icon} size={18} className="sw-ico" />
      <span className="sw-text">
        <span className="sw-name">{name}</span>
        {note === "" ? null : <span className="sw-note">{note}</span>}
      </span>
      {unreadable ? <span className="sw-need tone-bad">unreadable</span> : needs > 0 ? <span className="sw-need">{`${needs} ${needs === 1 ? "needs" : "need"} you`}</span> : icon === "overview" ? null : <span className="sw-clear">all clear</span>}
      {current && icon !== "overview" ? <NavIcon name="check" size={18} className="sw-check" /> : null}
    </Link>
  );
}

/** The workspace switcher: a button with the current scope; its list is a sheet on a phone, a menu on a desktop. */
function Switcher({ data, place, overview, to, pathKey }: SwitcherProps): React.ReactNode {
  const { workspace } = place;
  const known = data.workspaces.some((entry) => entry.name === workspace);
  // A self-test workspace you opened by its address is not in the list; the list shows it while you are in it.
  const listed = workspace === null || known ? data.workspaces : [...data.workspaces, { name: workspace, error: false, needs: 0, tabs: { vigils: 0, rituals: 0 } }];
  const others = workspace !== null && data.workspaces.some((entry) => entry.name !== workspace && entry.needs > 0);
  return (
    // Keyed by the address, so the menu closes after each navigation.
    <details key={pathKey} data-menu className="switcher">
      <summary className="sw-btn">
        <span className="sw-lab">
          <span className="sw-cap">Workspace</span>
          <span className="sw-now">{workspace ?? "All workspaces"}</span>
        </span>
        <NavIcon name="chevron" size={16} className="sw-chev" />
        {others ? (
          <>
            <i className="sw-dot" aria-hidden="true" />
            <span className="sr-only">Another workspace needs you</span>
          </>
        ) : null}
      </summary>
      <button type="button" className="sw-scrim" tabIndex={-1} aria-label="Close the workspace list" onClick={closeMenu} />
      <div className="sw-list">
        <p className="sw-group">{workspace === null ? "All workspaces" : "This workspace"}</p>
        <Entry href={overview} name="Overview" icon="overview" note="Verdict, next, what needs you" needs={0} current={place.overview} />
        <p className="sw-group">Workspaces</p>
        <Entry href={to(null)} name="All workspaces" icon="all" note="Every workspace together" needs={data.needs} current={workspace === null} />
        {listed.map((entry) => (
          <Entry key={entry.name} href={to(entry.name)} name={entry.name} icon="workspace" note="" needs={entry.needs} unreadable={entry.error} current={workspace === entry.name} />
        ))}
      </div>
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
  const place = placeOf(location.pathname, location.search, data.defaultWorkspace);
  const { workspace } = place;
  const tabs = workspace === null ? data.allTabs : (data.workspaces.find((entry) => entry.name === workspace)?.tabs ?? { vigils: 0, rituals: 0 });
  // `/` is the default workspace, so all workspaces need an address of their own when one is set.
  const allOverview = data.defaultWorkspace === null ? "/" : "/all";
  const overviewOf = (name: string | null): string => (name === null ? allOverview : workspacePath(name));
  const overview = overviewOf(workspace);
  const scopeTo = (name: string | null): string => (place.section === null ? overviewOf(name) : sectionPath(name, place.section));
  const selectedTab = (section: Section): boolean => place.section === section;
  return (
    <div className="app">
      <header className="bar">
        <div className="bar-in wa">
          <Link to={overview} className="brand" aria-label="darius, the Overview">
            <Gem size={28} />
            <span className="brand-word">darius</span>
          </Link>
          <Switcher data={data} place={place} overview={overview} to={scopeTo} pathKey={`${location.pathname}${location.search}`} />
          <Link to="/settings" className={location.pathname === "/settings" ? "gear on" : "gear"} aria-label="Settings" aria-current={location.pathname === "/settings" ? "page" : undefined}>
            <NavIcon name="gear" size={22} />
          </Link>
        </div>
        <nav aria-label="Sections" className="dtabs wa">
          {SECTIONS.map(({ section, label, badge }) => (
            <Link key={section} to={sectionPath(workspace, section)} className={selectedTab(section) ? "dt on" : "dt"} aria-current={selectedTab(section) ? "page" : undefined}>
              <SectionIcon section={section} size={20} />
              {label}
              <TabBadge {...badge(tabs)} />
            </Link>
          ))}
        </nav>
      </header>
      <main className="wa page-main">{children}</main>
      <footer className="wa">
        <div className="foot">
          <div className="foot-left">
            {place.overview && workspace === null
              ? data.selftest.map((line) => (
                  <Link key={line.href} to={line.href} className="foot-selftest">
                    {line.text}
                  </Link>
                ))
              : null}
          </div>
          <p className="foot-host">
            {data.host}, darius {data.version}, updated <time dateTime={data.generatedAt}>{clockTime(data.generatedAt, data.utcOffset)}</time>, seen by {data.viewer}. <Link to="/profiles">Profiles</Link>
          </p>
        </div>
      </footer>
      <nav aria-label="Tabs" className="tabbar">
        {SECTIONS.map(({ section, label, badge }) => (
          <Link key={section} to={sectionPath(workspace, section)} className={selectedTab(section) ? "tab on" : "tab"} aria-current={selectedTab(section) ? "page" : undefined}>
            <span className="tab-ico-wrap">
              <SectionIcon section={section} size={22} />
              <TabBadge {...badge(tabs)} />
            </span>
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
