/** The head of a section page (Vigils, Rituals): the section mark and name, then the scope it covers and a count. */

/** Pixels of the mark before a section page title. */
export const TITLE_ICON = 24;

interface SectionHeadProps {
  title: string;
  /** The workspace, or null for all workspaces. */
  workspace: string | null;
  /** A quiet count or fact after the scope, such as "11 active rituals". */
  fact: string;
  /** The mark of the section, drawn before the name; decoration, the name carries the meaning. */
  icon?: React.ReactNode;
}

export function SectionPageHead({ title, workspace, fact, icon }: SectionHeadProps): React.ReactNode {
  return (
    <header className="page-head page-head-tight proj-head">
      <h1 className={icon === undefined ? "page-title" : "page-title has-title-icon"}>
        {icon}
        {title}
      </h1>
      <p className="page-meta proj-meta meta-dots">
        <span>{workspace ?? "All workspaces"}</span>
        <span>{fact}</span>
      </p>
    </header>
  );
}
