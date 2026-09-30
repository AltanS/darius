/**
 * The frame around every page. On a desktop: one 48 px bar with the wordmark,
 * the two main tabs (Home, Runs) and a project switcher at the far end. On a
 * phone the bar keeps the wordmark and the current project, and the tabs move
 * to a bar at the bottom, where a thumb reaches them; its Projects tab opens
 * the project list as a sheet above it. One footer line holds the host facts.
 */

import { useEffect } from "react";
import { Link, NavLink, useLocation } from "react-router";

import type { RootData } from "../root.tsx";
import { clockTime, projectPath } from "../lib/format.ts";
import { questionsText } from "../lib/view.ts";

function navClass({ isActive }: { isActive: boolean }): string {
  return isActive ? "nav-link on" : "nav-link";
}

function tabClass({ isActive }: { isActive: boolean }): string {
  return isActive ? "tab on" : "tab";
}

interface CountProps {
  questions: number;
}

/** The number of questions that wait, in the colour of waiting. */
function Count({ questions }: CountProps): React.ReactNode {
  if (questions === 0) return null;
  return (
    <span className="count tone-wait" title={questionsText(questions)}>
      {questions}
    </span>
  );
}

interface ProjectLinksProps {
  projects: RootData["projects"];
}

/** One link per project, with its open questions and a mark when darius could not read it. */
function ProjectLinks({ projects }: ProjectLinksProps): React.ReactNode {
  return projects.map((project) => (
    <NavLink key={project.name} to={projectPath(project.name)} className={({ isActive }) => (isActive ? "on" : undefined)}>
      <span className="menu-name">{project.name}</span>
      {project.error ? <span className="count tone-bad">!</span> : <Count questions={project.questions} />}
    </NavLink>
  ));
}

/** Closes an open menu on a press outside it and on Escape; a link inside closes it by changing the path. */
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

interface ShellProps {
  data: RootData;
  children: React.ReactNode;
}

export function Shell({ data, children }: ShellProps): React.ReactNode {
  const { questions } = data;
  useMenuDismiss();
  const location = useLocation();
  const isHome = location.pathname === "/";
  const current = /^\/p\/([^/]+)/u.exec(location.pathname)?.[1];
  const currentProject = current === undefined ? null : decodeURIComponent(current);
  const inProject = currentProject !== null;
  return (
    <div className="app">
      <header className="bar">
        <div className="bar-in wa">
          <Link to="/" className="brand">
            darius
          </Link>
          <nav aria-label="Main" className="nav">
            <NavLink to="/" end className={navClass} title={questions > 0 ? questionsText(questions) : undefined}>
              Home
              <Count questions={questions} />
            </NavLink>
            <NavLink to="/runs" end className={navClass}>
              Runs
            </NavLink>
          </nav>
          {data.projects.length === 0 ? null : (
            <div className="bar-end">
              {/* Keyed by the path, so the menu closes after each navigation. */}
              <details key={location.pathname} data-menu className="menu">
                <summary>
                  <span className="menu-cap">Project</span>
                  <span className="menu-now">{currentProject ?? "All"}</span>
                </summary>
                <div className="menu-list">
                  <ProjectLinks projects={data.projects} />
                </div>
              </details>
            </div>
          )}
          {inProject ? <span className="bar-ctx">{currentProject}</span> : null}
        </div>
      </header>
      <main className="wa page-main">{children}</main>
      <footer className="wa">
        <div className="foot">
          <div className="foot-left">
            {isHome
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
        <NavLink to="/" end className={tabClass}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 11 12 3l9 8M5 9.5V21h5v-6h4v6h5V9.5" />
          </svg>
          <span>
            Home
            <Count questions={questions} />
          </span>
        </NavLink>
        <NavLink to="/runs" end className={tabClass}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h10" />
          </svg>
          <span>Runs</span>
        </NavLink>
        {data.projects.length === 0 ? null : (
          <details key={location.pathname} data-menu className="tabmenu">
            <summary className={inProject ? "tab on" : "tab"}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 4h7v7H3zM14 4h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />
              </svg>
              <span>Projects</span>
            </summary>
            <div className="tabmenu-list">
              <ProjectLinks projects={data.projects} />
            </div>
          </details>
        )}
      </nav>
    </div>
  );
}
