/**
 * The settings page: how this browser shows darius, and the backups of this
 * host. It is a layout: the title, a row of tabs and the tab that is open.
 * The tabs are routes (General, Notifications, Backups, About), so each has
 * an address and loads only its own data.
 */

import { NavLink, Outlet } from "react-router";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

interface TabSpec {
  to: string;
  label: string;
  /** General is `/settings` itself, so it must not stay lit on the tabs under it. */
  end: boolean;
}

const TABS: readonly TabSpec[] = [
  { to: "/settings", label: "General", end: true },
  { to: "/settings/notifications", label: "Notifications", end: false },
  { to: "/settings/backups", label: "Backups", end: false },
  { to: "/settings/about", label: "About", end: false },
];

export default function SettingsLayout(): React.ReactNode {
  return (
    <div className="st">
      <header className="page-head st-head">
        <h1 className="page-title">Settings</h1>
        <p className="lede">How darius looks on this device, and how this host backs up. The look stays in this browser.</p>
      </header>
      <nav aria-label="Settings sections" className="st-tabs">
        {TABS.map(({ to, label, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? "st-tab on" : "st-tab")}>
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
