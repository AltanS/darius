/** A sentence built from variables (lib/sentence.ts): text, linked names and relative times. */

import { Link } from "react-router";

import { href } from "../lib/paths.ts";
import type { Part } from "../lib/sentence.ts";
import { Time } from "./ui.tsx";

interface SentenceProps {
  parts: readonly Part[];
  className?: string;
}

export function Sentence({ parts, className }: SentenceProps): React.ReactNode {
  return (
    <p className={className}>
      {parts.map((part, index) => {
        const key = `${String(index)}`;
        if (part.kind === "link") {
          return (
            <Link key={key} to={href(part.to)} title={part.title}>
              {part.text}
            </Link>
          );
        }
        if (part.kind === "time") return <Time key={key} iso={part.iso} age={part.age} />;
        return <span key={key}>{part.text}</span>;
      })}
    </p>
  );
}

interface PartsProps {
  parts: readonly Part[];
  /** A class for every link: `lt-above` lifts it over a link that covers its row. */
  linkClass?: string;
}

/** The parts of a sentence inline, with no paragraph around them. */
export function Parts({ parts, linkClass }: PartsProps): React.ReactNode {
  return parts.map((part, index) => {
    const key = `${String(index)}`;
    if (part.kind === "link") {
      return (
        <Link key={key} to={href(part.to)} title={part.title} className={linkClass}>
          {part.text}
        </Link>
      );
    }
    if (part.kind === "time") return <Time key={key} iso={part.iso} age={part.age} />;
    return <span key={key}>{part.text}</span>;
  });
}
