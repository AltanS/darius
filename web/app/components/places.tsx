/**
 * Places: the one navigation tree of the app. It is the fixed sidebar of a
 * desktop and the drawer of a phone (the shell opens it with a
 * `<details data-menu>`; the drawer is closed by a press outside, Escape or a
 * link). The tree: All workspaces; each workspace with what needs you there;
 * the scope you are in, expanded to its six places; the host pages; and a
 * small host line at the end. At most one row is lit, and the row of the
 * scope you are in carries a check mark.
 */

import { useEffect } from "react";
import { Link } from "react-router";

import type { RootData } from "../root.tsx";
import { KindIcon } from "./kind.tsx";
import { Gem, NavIcon, type NavIconName } from "./nav-icons.tsx";
import { clockTime } from "../lib/format.ts";
import { href, type Section } from "../lib/paths.ts";
import type { TabCounts } from "../lib/scope.ts";

interface SectionSpec {
  section: Section;
  label: string;
  /** The badge counts these: the sentence reads "3 late". */
  badge: (tabs: TabCounts) => { count: number; tone: "wait" | "late"; text: string };
}

const NO_BADGE: SectionSpec["badge"] = () => ({ count: 0, tone: "wait", text: "" });

/** The four sections that are tabs, in order. The badge of Vigils counts those due today or late, the badge of Rituals those late. */
export const TAB_SECTIONS: readonly SectionSpec[] = [
  { section: "vigils", label: "Vigils", badge: (tabs) => ({ count: tabs.vigils, tone: "wait", text: "due today or late" }) },
  { section: "rituals", label: "Rituals", badge: (tabs) => ({ count: tabs.rituals, tone: "late", text: "late" }) },
  { section: "findings", label: "Findings", badge: (tabs) => ({ count: tabs.findings, tone: "wait", text: "need you" }) },
  { section: "milestones", label: "Milestones", badge: NO_BADGE },
];

/** The six places of a scope: Overview comes first, Runs last (it is not a tab). */
const RUNS: SectionSpec = { section: "runs", label: "Runs", badge: NO_BADGE };

/** The row of a page that is lit in Places: the Overview, a section, or a host page. */
export type LitRow = "overview" | Section | "status" | "profiles" | "settings";

interface SectionIconProps {
  section: Section;
  size: number;
}

export function SectionIcon({ section, size }: SectionIconProps): React.ReactNode {
  if (section === "milestones") return <NavIcon name="milestone" size={size} className="tab-ico" />;
  if (section === "findings") return <NavIcon name="finding" size={size} className="tab-ico" />;
  if (section === "runs") return <NavIcon name="run" size={size} className="tab-ico" />;
  return <KindIcon kind={section === "vigils" ? "vigil" : "ritual"} size={size} className="tab-ico" />;
}

interface BadgeProps {
  count: number;
  tone: "wait" | "late";
  text: string;
}

/** The count on a tab or a row: a small solid square with the number; screen readers hear what it counts. */
export function TabBadge({ count, tone, text }: BadgeProps): React.ReactNode {
  if (count === 0) return null;
  return (
    <span className={`tab-bdg tone-${tone}`} title={`${count} ${text}`}>
      <span aria-hidden="true">{count}</span>
      <span className="sr-only">{`${count} ${text}`}</span>
    </span>
  );
}

/** Shuts every open menu (the phone drawer). */
export function closeMenus(): void {
  for (const menu of document.querySelectorAll<HTMLDetailsElement>("details[data-menu][open]")) menu.open = false;
}

/**
 * Closes open menus on a press outside them and on Escape; a link inside closes one by changing the path.
 * Places sits beside the drawer button in the page, not inside it, so a press in Places counts as inside.
 */
export function useMenuDismiss(): void {
  useEffect(() => {
    const close = (except: EventTarget | null): void => {
      for (const menu of document.querySelectorAll<HTMLDetailsElement>("details[data-menu][open]")) {
        const inside = except instanceof Element && (menu.contains(except) || except.closest(".places") !== null);
        if (!inside) menu.open = false;
      }
    };
    const onPress = (event: Event): void => close(event.target);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      const open = document.querySelector<HTMLDetailsElement>("details[data-menu][open]");
      if (open === null) return;
      open.open = false;
      open.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", onPress);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPress);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
}

/** A press on a link in Places closes the drawer, also when the link is the page you are on. */
function closeOnLink(event: React.MouseEvent<HTMLElement>): void {
  if (event.target instanceof Element && event.target.closest("a") !== null) closeMenus();
}

interface ScopeRowProps {
  to: string;
  name: string;
  icon: NavIconName;
  needs: number;
  unreadable?: boolean;
  current: boolean;
}

/** A scope in the tree: its name and what needs you there. */
function ScopeRow({ to, name, icon, needs, unreadable = false, current }: ScopeRowProps): React.ReactNode {
  return (
    <Link to={to} className={current ? "places-row places-scope on" : "places-row places-scope"} aria-current={current ? "true" : undefined}>
      <NavIcon name={icon} size={18} className="places-ico" />
      <span className="places-text">
        <span className="places-name">{name}</span>
        {unreadable ? <span className="places-need tone-bad">unreadable</span> : needs > 0 ? <span className="places-need">{`${needs} ${needs === 1 ? "needs" : "need"} you`}</span> : <span className="places-clear">all clear</span>}
      </span>
      {current ? <NavIcon name="check" size={18} className="places-check" /> : null}
    </Link>
  );
}

interface LeafProps {
  to: string;
  label: string;
  icon: React.ReactNode;
  lit: boolean;
  badge?: React.ReactNode;
}

/** A place of the scope you are in, or a host page. */
function Leaf({ to, label, icon, lit, badge }: LeafProps): React.ReactNode {
  return (
    <li>
      <Link to={to} className={lit ? "places-row places-leaf lit" : "places-row places-leaf"} aria-current={lit ? "page" : undefined}>
        {icon}
        <span className="places-name">{label}</span>
        {badge}
      </Link>
    </li>
  );
}

interface PlacesProps {
  data: RootData;
  /** The scope the frame shows: a workspace name, or null for all workspaces. */
  scope: string | null;
  /** The row that is lit, or null when none is (an error page). */
  lit: LitRow | null;
}

const HOST_ROWS: readonly { page: "status" | "profiles" | "settings"; label: string; icon: NavIconName }[] = [
  { page: "status", label: "Status", icon: "status" },
  { page: "profiles", label: "Profiles", icon: "profile" },
  { page: "settings", label: "Settings", icon: "gear" },
];

/** The places of one scope, each with its badge. */
function ScopePlaces({ scope, tabs, lit }: { scope: string | null; tabs: TabCounts; lit: LitRow | null }): React.ReactNode {
  return (
    <ul className="places-sub">
      <Leaf to={href({ to: "overview", ws: scope })} label="Overview" icon={<NavIcon name="overview" size={18} className="places-ico tab-ico" />} lit={lit === "overview"} />
      {[...TAB_SECTIONS, RUNS].map(({ section, label, badge }) => (
        <Leaf key={section} to={href({ to: "section", ws: scope, section })} label={label} icon={<SectionIcon section={section} size={18} />} lit={lit === section} badge={<TabBadge {...badge(tabs)} />} />
      ))}
    </ul>
  );
}

/** The host line: where this runs, the version, when the data is from, who looks. The self-test lines follow. */
function HostLine({ data }: { data: RootData }): React.ReactNode {
  return (
    <div className="places-foot">
      <p className="places-hostline">
        {data.host}, darius {data.version}, updated <time dateTime={data.generatedAt}>{clockTime(data.generatedAt, data.utcOffset)}</time>, seen by {data.viewer}.
      </p>
      {data.selftest.map((line) => (
        <Link key={line.href} to={line.href} className="places-selftest">
          {line.text}
        </Link>
      ))}
    </div>
  );
}

export function Places({ data, scope, lit }: PlacesProps): React.ReactNode {
  const known = scope === null || data.workspaces.some((entry) => entry.name === scope);
  // A self-test workspace you opened by its address is not in the list; the list shows it while you are in it.
  const listed = known ? data.workspaces : [...data.workspaces, { name: scope, error: false, needs: 0, tabs: { vigils: 0, rituals: 0, findings: 0 } }];
  const tabsOf = (name: string | null): TabCounts => (name === null ? data.allTabs : (listed.find((entry) => entry.name === name)?.tabs ?? { vigils: 0, rituals: 0, findings: 0 }));
  return (
    <nav aria-label="Places" className="places" onClick={closeOnLink}>
      <div className="places-head">
        <Link to={href({ to: "overview", ws: scope })} className="places-brand" aria-label="darius, the Overview">
          <Gem size={28} />
          <span>darius</span>
        </Link>
        <span className="places-hostname">{data.host}</span>
      </div>
      <p className="places-group">Workspaces</p>
      {data.workspaces.length === 0 ? (
        <p className="places-empty">
          No workspace is linked on this host. Run <code>darius link</code> in a checkout.
        </p>
      ) : null}
      <ul className="places-tree">
        <li>
          <ScopeRow to={href({ to: "overview", ws: null })} name="All workspaces" icon="all" needs={data.needs} current={scope === null} />
          {scope === null ? <ScopePlaces scope={null} tabs={tabsOf(null)} lit={lit} /> : null}
        </li>
        {listed.map((entry) => (
          <li key={entry.name}>
            <ScopeRow to={href({ to: "overview", ws: entry.name })} name={entry.name} icon="workspace" needs={entry.needs} unreadable={entry.error} current={scope === entry.name} />
            {scope === entry.name ? <ScopePlaces scope={entry.name} tabs={tabsOf(entry.name)} lit={lit} /> : null}
          </li>
        ))}
      </ul>
      <p className="places-group">This host</p>
      <ul className="places-tree">
        {HOST_ROWS.map(({ page, label, icon }) => (
          <Leaf key={page} to={href({ to: "host", page })} label={label} icon={<NavIcon name={icon} size={18} className="places-ico" />} lit={lit === page} />
        ))}
      </ul>
      <HostLine data={data} />
    </nav>
  );
}
