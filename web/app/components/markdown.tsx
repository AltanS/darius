/**
 * Findings and instructions as React elements. The blocks come parsed from
 * darius (src/web/markdown.ts); every piece of text lands in a text node,
 * so store text can never become markup.
 */

import type { MdBlock, MdLine } from "../../../src/web/api.ts";

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
    case "list": {
      const items = block.items.map((item, index) => (
        <li key={`${index}`}>
          <Line line={item} />
        </li>
      ));
      return block.ordered ? <ol start={block.start}>{items}</ol> : <ul>{items}</ul>;
    }
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
