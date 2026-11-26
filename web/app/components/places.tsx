/**
 * Places: the one navigation tree of the app (0.141.0). It is the fixed
 * sidebar of a desktop and the drawer of a phone (the shell opens it with a
 * `<details data-menu>`; the drawer is closed by a press outside, Escape or a
 * link). Three primary rows, always in this order at the top: Overview,
 * Machines, Workspaces. Under Overview, while the page is in the
 * all-workspaces scope, its seven places; under Workspaces every workspace
 * on one line (a health dot, the name, what needs you), and the workspace
 * the page is in opens to its eight places. Exactly one row is lit and at
 * most one branch is open: the one the page is in (`navOf` in lib/paths.ts).
 * Profiles, Settings and the host line sit in a foot that stays at the
 * bottom; the tree scrolls between the head and the foot.
 */

import { useEffect } from "react";
import { Link } from "react-router";

import type { RootData } from "../root.tsx";
import { FinderButton, type FinderState } from "./finder.tsx";
import { KindIcon } from "./kind.tsx";
import { Gem, NavIcon, type NavIconName } from "./nav-icons.tsx";
import { WorkspaceGlyph } from "./workspace-icon.tsx";
import { healthWord } from "../lib/fleet.ts";
import { clockTime } from "../lib/format.ts";
import { machinesRowText, stateSplit } from "../lib/machines.ts";
import { href, type Branch, type LitRow, type Section } from "../lib/paths.ts";
import { NO_TABS, type TabCounts, type WorkspaceEntry } from "../lib/scope.ts";

interface SectionSpec {
  section: Section;
  label: string;
  /** The badge counts these: the sentence reads "3 late". */
  badge: (tabs: TabCounts) => { count: number; tone: "wait" | "late"; text: string };
}

const NO_BADGE: SectionSpec["badge"] = () => ({ count: 0, tone: "wait", text: "" });

/** The five sections that are tabs, in order. The badge of Vigils counts those due today or late, the badge of Rituals those late, the badge of Candles those lit. */
export const TAB_SECTIONS: readonly SectionSpec[] = [
  { section: "vigils", label: "Vigils", badge: (tabs) => ({ count: tabs.vigils, tone: "wait", text: "due today or late" }) },
  { section: "rituals", label: "Rituals", badge: (tabs) => ({ count: tabs.rituals, tone: "late", text: "late" }) },
  { section: "findings", label: "Findings", badge: (tabs) => ({ count: tabs.findings, tone: "wait", text: "need you" }) },
  { section: "candles", label: "Candles", badge: (tabs) => ({ count: tabs.candles, tone: "wait", text: "lit" }) },
  { section: "milestones", label: "Milestones", badge: NO_BADGE },
];

/** The places of a scope after its Overview: the five tabs, then Runs and Activity (they are not tabs). */
const PLACES: readonly SectionSpec[] = [...TAB_SECTIONS, { section: "runs", label: "Runs", badge: NO_BADGE }, { section: "activity", label: "Activity", badge: NO_BADGE }];

interface SectionIconProps {
  section: Section;
  size: number;
}

export function SectionIcon({ section, size }: SectionIconProps): React.ReactNode {
  if (section === "milestones") return <NavIcon name="milestone" size={size} className="tab-ico" />;
  if (section === "findings") return <NavIcon name="finding" size={size} className="tab-ico" />;
  if (section === "candles") return <NavIcon name="candle" size={size} className="tab-ico" />;
  if (section === "runs") return <NavIcon name="run" size={size} className="tab-ico" />;
  if (section === "activity") return <NavIcon name="activity" size={size} className="tab-ico" />;
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

interface RowProps {
  to: string;
  label: string;
  icon: React.ReactNode;
  lit: boolean;
  /** What the row counts, after the name. */
  aside?: React.ReactNode;
  className: string;
}

/** One row of the tree: a primary row, a place of the open branch, or a page of the foot. */
function Row({ to, label, icon, lit, aside, className }: RowProps): React.ReactNode {
  return (
    <Link to={to} className={`places-row ${className}${lit ? " lit" : ""}`} aria-current={lit ? "page" : undefined}>
      {icon}
      <span className="places-name">{label}</span>
      {aside}
    </Link>
  );
}

function rowIcon(name: NavIconName): React.ReactNode {
  return <NavIcon name={name} size={18} className="places-ico" />;
}

/** The places of the open branch after its own row: for all workspaces the seven sections, for a workspace its Overview first. */
function BranchPlaces({ scope, tabs, lit, withOverview }: { scope: string | null; tabs: TabCounts; lit: LitRow | null; withOverview: boolean }): React.ReactNode {
  return (
    <ul className="places-sub">
      {withOverview ? (
        <li>
          <Row to={href({ to: "overview", ws: scope })} label="Overview" icon={<NavIcon name="overview" size={18} className="places-ico tab-ico" />} lit={lit === "overview"} className="places-leaf" />
        </li>
      ) : null}
      {PLACES.map(({ section, label, badge }) => (
        <li key={section}>
          <Row to={href({ to: "section", ws: scope, section })} label={label} icon={<SectionIcon section={section} size={18} />} lit={lit === section} aside={<TabBadge {...badge(tabs)} />} className="places-leaf" />
        </li>
      ))}
    </ul>
  );
}

/** One workspace on one line: the health dot (its word for a screen reader and in the title), the icon, the name, and what needs you. */
function WorkspaceRow({ entry, open }: { entry: WorkspaceEntry; open: boolean }): React.ReactNode {
  const word = healthWord(entry.health);
  return (
    <Link to={href({ to: "overview", ws: entry.name })} className={`places-row places-ws${open ? " open" : ""}`} title={`${entry.name}: ${word.label}`}>
      <span className={`places-dot tone-${word.tone}`} aria-hidden="true" />
      <WorkspaceGlyph icon={entry.icon} className="places-ico" fallback={<NavIcon name="workspace" size={18} className="places-ico" />} />
      <span className="places-name">{entry.name}</span>
      <span className="sr-only">{`, ${word.label}`}</span>
      {entry.error ? <span className="places-word tone-bad">unreadable</span> : <TabBadge count={entry.needs} tone="wait" text={entry.needs === 1 ? "needs you" : "need you"} />}
    </Link>
  );
}

interface PlacesProps {
  data: RootData;
  /** The one lit row; null when none is (a 404). */
  lit: LitRow | null;
  /** The one open branch; null when none is. */
  branch: Branch | null;
  /** The page is loading and has taken more than 300 ms: the brand gem blinks. */
  busy: boolean;
  /** The milestone finder of the workspace, for its row under the head (desktop only); null outside a workspace. */
  finder: FinderState | null;
}

/** The server names the loopback viewer "this host" (src/web/auth.ts, and the CLI and the ledgers keep it); the app says "machine". */
export function viewerWord(viewer: string): string {
  return viewer === "this host" ? "this machine" : viewer;
}

/** The host line: where this runs, the version, when the data is from, who looks. The self-test lines follow. */
function HostLine({ data }: { data: RootData }): React.ReactNode {
  return (
    <>
      <p className="places-hostline">
        {data.host}, darius {data.version}, updated <time dateTime={data.generatedAt}>{clockTime(data.generatedAt, data.utcOffset)}</time>, seen by {viewerWord(data.viewer)}.
      </p>
      {data.selftest.map((line) => (
        <Link key={line.href} to={line.href} className="places-selftest">
          {line.text}
        </Link>
      ))}
    </>
  );
}

/** "3" or "3, 1 unreachable": the worst state in words when not every machine is online. */
function MachinesAside({ data }: { data: RootData }): React.ReactNode {
  const split = stateSplit(data.peers.map((peer) => peer.state));
  if (data.peers.length === 0) return null;
  return <span className={split.worst === null ? "places-count" : "places-count ink-late"}>{machinesRowText(split, data.peers.length)}</span>;
}

export function Places({ data, lit, branch, busy, finder }: PlacesProps): React.ReactNode {
  const open = branch?.kind === "workspace" ? branch.ws : null;
  const tabsOf = (name: string | null): TabCounts => (name === null ? data.allTabs : (data.workspaces.find((entry) => entry.name === name)?.tabs ?? NO_TABS));
  const overviewOpen = branch?.kind === "overview";
  // The head (gem, name, machine) and the foot (Profiles, Settings, the host line) are sticky inside the scrolling sidebar.
  return (
    <nav aria-label="Places" className="places" onClick={closeOnLink}>
      <div className="places-head">
        <Link to={href({ to: "overview", ws: null })} className="places-brand" aria-label="darius, the Overview">
          <Gem size={28} busy={busy} />
          <span>darius</span>
        </Link>
        <span className="places-hostname">{data.host}</span>
      </div>
      {finder === null ? null : (
        <div className="places-find">
          <FinderButton finder={finder} className="finder-btn finder-btn-side" label="Find a milestone" />
        </div>
      )}
      <ul className="places-tree">
        <li>
          <Row to={href({ to: "overview", ws: null })} label="Overview" icon={rowIcon("overview")} lit={overviewOpen && lit === "overview"} className="places-primary" aside={data.needs === 0 ? null : <span className="places-need">{`${data.needs} ${data.needs === 1 ? "needs" : "need"} you`}</span>} />
          {overviewOpen ? <BranchPlaces scope={null} tabs={tabsOf(null)} lit={lit} withOverview={false} /> : null}
        </li>
        <li>
          <Row to={href({ to: "host", page: "machines" })} label="Machines" icon={rowIcon("machine")} lit={lit === "machines"} className="places-primary" aside={<MachinesAside data={data} />} />
        </li>
        <li>
          <Row to={href({ to: "host", page: "workspaces" })} label="Workspaces" icon={rowIcon("all")} lit={lit === "workspaces"} className="places-primary" aside={<span className="places-count">{data.workspaces.length}</span>} />
          {data.workspaces.length === 0 ? (
            <p className="places-empty">
              No workspace is linked on this machine. Run <code>darius link</code> in a project folder.
            </p>
          ) : (
            <ul className="places-wss">
              {data.workspaces.map((entry) => (
                <li key={entry.name}>
                  <WorkspaceRow entry={entry} open={open === entry.name} />
                  {open === entry.name ? <BranchPlaces scope={entry.name} tabs={tabsOf(entry.name)} lit={lit} withOverview /> : null}
                </li>
              ))}
            </ul>
          )}
        </li>
      </ul>
      <div className="places-foot">
        <ul className="places-foot-rows">
          <li>
            <Row to={href({ to: "host", page: "profiles" })} label="Profiles" icon={rowIcon("profile")} lit={lit === "profiles"} className="places-leaf" />
          </li>
          <li>
            <Row to={href({ to: "host", page: "settings" })} label="Settings" icon={rowIcon("gear")} lit={lit === "settings"} className="places-leaf" />
          </li>
        </ul>
        <HostLine data={data} />
      </div>
    </nav>
  );
}
