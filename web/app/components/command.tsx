/**
 * A command in a box with a Copy button. `navigator.clipboard` exists only
 * in a secure context, and the page is plain http on the tailnet, so the
 * fallback selects the text for a manual copy. The box selects all on one
 * tap even without JavaScript.
 */

import { useRef, useState } from "react";

interface CommandProps {
  command: string;
}

/**
 * The command as text, with each hyphenated word (a project name, say) kept
 * whole: a narrow box then wraps at the spaces, never inside "demo-shop".
 * The copied text is the plain command.
 */
function wrapSafe(command: string): React.ReactNode {
  return command.split(/(\S*\w-\w\S*)/u).map((part, index) => (index % 2 === 1 ? <span key={`${index}`} className="nowrap">{part}</span> : part));
}

export function Command({ command }: CommandProps): React.ReactNode {
  const box = useRef<HTMLElement>(null);
  const [result, setResult] = useState<"none" | "copied" | "selected">("none");

  function selectBox(): void {
    const element = box.current;
    const selection = window.getSelection();
    if (element === null || selection === null) return;
    selection.selectAllChildren(element);
  }

  async function copy(): Promise<void> {
    if (window.isSecureContext && "clipboard" in navigator) {
      try {
        await navigator.clipboard.writeText(command);
        setResult("copied");
        return;
      } catch {
        // Denied: fall through to the manual copy.
      }
    }
    selectBox();
    setResult("selected");
  }

  return (
    <div className="cmd-wrap">
      <div className="cmd">
        <code ref={box} className="cmd-text">
          {wrapSafe(command)}
        </code>
        <button type="button" className="copy" onClick={() => void copy()}>
          {result === "copied" ? "Copied" : "Copy"}
        </button>
      </div>
      {result === "selected" ? <p className="cmd-note">This page cannot reach the clipboard. The command is selected: copy it now.</p> : null}
    </div>
  );
}
