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
            <Link key={key} to={href(part.to)}>
              {part.text}
            </Link>
          );
        }
        if (part.kind === "time") return <Time key={key} iso={part.iso} />;
        return <span key={key}>{part.text}</span>;
      })}
    </p>
  );
}
