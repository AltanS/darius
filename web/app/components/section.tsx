/** The head of a section page (Vigils, Rituals): the section name, then the scope it covers and a count. */

interface SectionHeadProps {
  title: string;
  /** The workspace, or null for all workspaces. */
  workspace: string | null;
  /** A quiet count or fact after the scope, such as "11 active rituals". */
  fact: string;
}

export function SectionPageHead({ title, workspace, fact }: SectionHeadProps): React.ReactNode {
  return (
    <header className="page-head page-head-tight proj-head">
      <h1 className="page-title">{title}</h1>
      <p className="page-meta proj-meta meta-dots">
        <span>{workspace ?? "All workspaces"}</span>
        <span>{fact}</span>
      </p>
    </header>
  );
}
