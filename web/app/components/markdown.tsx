/**
 * Findings and instructions as React elements. The blocks come parsed from
 * darius (src/web/markdown.ts); every piece of text lands in a text node,
 * so store text can never become markup.
 */

import type { MdBlock, MdCheck, MdLine, MdList } from "../../../src/web/api.ts";

interface LineProps {
  line: MdLine;
}

function Line({ line }: LineProps): React.ReactNode {
  return line.map((span, index) => {
    const key = `${index}`;
    if (span.kind === "code") return <code key={key} className="inline-code">{span.text}</code>;
    if (span.kind === "bold") return <strong key={key} className="font-semibold text-parchment">{span.text}</strong>;
    if (span.kind === "italic") return <em key={key}>{span.text}</em>;
    return span.text;
  });
}

interface HeadingProps {
  level: number;
  content: MdLine;
}

/** Markdown levels 1 to 6 sit below the page title and the panel heading. */
function Heading({ level, content }: HeadingProps): React.ReactNode {
  const body = <Line line={content} />;
  if (level <= 1) return <h3 className="md-h1">{body}</h3>;
  if (level === 2) return <h4 className="md-h2">{body}</h4>;
  if (level === 3) return <h5 className="md-h3">{body}</h5>;
  return <h6 className="md-h4">{body}</h6>;
}

const CHECK_WORDS = {
  done: "Done",
  open: "Open",
  doing: "In progress",
  blocked: "Blocked",
  skipped: "Skipped",
} as const satisfies Record<MdCheck, string>;

interface BoxProps {
  check: MdCheck;
}

/** A checklist box: a tick when done, a dash when skipped, a bar when blocked, a dot when in progress, empty when open. */
function Box({ check }: BoxProps): React.ReactNode {
  return (
    <svg className={`md-box md-box-${check}`} width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={CHECK_WORDS[check]}>
      <rect x="1.25" y="1.25" width="11.5" height="11.5" />
      {check === "done" ? <path d="M3.8 7.2L6 9.4L10.2 4.8" /> : null}
      {check === "skipped" ? <path d="M4.2 7H9.8" /> : null}
      {check === "blocked" ? <path d="M7 3.8V7.6M7 9.9V10" /> : null}
      {check === "doing" ? <circle cx="7" cy="7" r="1.6" fill="currentColor" stroke="none" /> : null}
    </svg>
  );
}

interface ListProps {
  block: MdList;
}

function List({ block }: ListProps): React.ReactNode {
  const { checks, nested } = block;
  const items = block.items.map((item, index) => {
    const check = checks?.[index] ?? null;
    const classes = [check === null ? null : "md-check", nested?.[index] === true ? "md-nested" : null].filter((name) => name !== null);
    return (
      <li key={`${index}`} className={classes.length === 0 ? undefined : classes.join(" ")}>
        {check === null ? (
          <Line line={item} />
        ) : (
          <>
            <Box check={check} />
            <span>
              <Line line={item} />
            </span>
          </>
        )}
      </li>
    );
  });
  const className = checks === undefined ? undefined : "md-checks";
  return block.ordered ? (
    <ol start={block.start} className={className}>
      {items}
    </ol>
  ) : (
    <ul className={className}>{items}</ul>
  );
}

interface BlockProps {
  block: MdBlock;
}

function Block({ block }: BlockProps): React.ReactNode {
  switch (block.kind) {
    case "heading":
      return <Heading level={block.level} content={block.content} />;
    case "paragraph":
      return (
        <p>
          {block.lines.map((line, index) => (
            <span key={`${index}`}>
              {index > 0 ? <br /> : null}
              <Line line={line} />
            </span>
          ))}
        </p>
      );
    case "list":
      return <List block={block} />;
    case "table":
      return (
        <div className="table-scroll">
          <table className="grid-table">
            <thead>
              <tr>
                {block.head.map((cell, index) => (
                  <th key={`${index}`} scope="col">
                    <Line line={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={`${rowIndex}`}>
                  {row.map((cell, index) => (
                    <td key={`${index}`}>
                      <Line line={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "code":
      return (
        <pre className="code-block">
          <code>{block.text}</code>
        </pre>
      );
  }
}

interface MarkdownProps {
  blocks: readonly MdBlock[];
}

export function Markdown({ blocks }: MarkdownProps): React.ReactNode {
  return (
    <div className="md">
      {blocks.map((block, index) => (
        <Block key={`${index}`} block={block} />
      ))}
    </div>
  );
}
