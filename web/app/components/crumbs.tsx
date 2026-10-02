/** The breadcrumb trail above a detail page title. */

import { Link, useLocation } from "react-router";

import { crumbsOf, litSection, placeOf, type Target } from "../lib/paths.ts";

interface CrumbsProps {
  /** The page's own title: the last step, not a link. */
  title?: string;
  /** The item a run belongs to (its ritual or vigil), a link between the section and the title. */
  parent?: { label: string; target: Target };
  /** The kind of a run's item: the run page is then filed under that section, not under Runs. */
  itemKind?: "ritual" | "vigil";
}

/**
 * `ws / Rituals / ritual / run`. On a phone only the step above the page is
 * shown, as a back link; from 1024 px the whole trail. The scope comes from
 * the address, like the rest of the navigation.
 */
export function Crumbs({ title, parent, itemKind }: CrumbsProps): React.ReactNode {
  const place = placeOf(useLocation().pathname);
  const filed = itemKind === undefined ? place : { ...place, section: litSection(place, itemKind) };
  const trail = crumbsOf(filed, parent, title);
  if (trail.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="crumbs">
      <ol className="crumbs-list">
        {trail.map((crumb, index) => {
          const back = index === trail.length - 2;
          const className = `crumb${back ? " crumb-back" : ""}${crumb.href === null ? " crumb-here" : ""}`;
          return (
            <li key={`${index}`} className={className}>
              {crumb.href === null ? (
                <span aria-current="page">{crumb.label}</span>
              ) : (
                <Link to={crumb.href}>{crumb.label}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
