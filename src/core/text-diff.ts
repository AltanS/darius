/**
 * A unified diff of two texts, line by line, with three lines of context:
 * what `darius marker factor` prints. A longest-common-subsequence table,
 * which is fine for a file of a few hundred lines such as `.darius.toml`.
 */

const CONTEXT = 3;

interface Op {
  sign: " " | "-" | "+";
  text: string;
  /** 1-based line in the old text (for " " and "-") or the new text (for "+"). */
  oldLine: number;
  newLine: number;
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** The edit script from `before` to `after`: kept, removed and added lines in order. */
function editScript(before: readonly string[], after: readonly string[]): Op[] {
  const rows = before.length + 1;
  const cols = after.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] =
        before[i] === after[j] ? (table[(i + 1) * cols + j + 1] ?? 0) + 1 : Math.max(table[(i + 1) * cols + j] ?? 0, table[i * cols + j + 1] ?? 0);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      ops.push({ sign: " ", text: before[i] ?? "", oldLine: i + 1, newLine: j + 1 });
      i += 1;
      j += 1;
    } else if (i < before.length && (j >= after.length || (table[(i + 1) * cols + j] ?? 0) >= (table[i * cols + j + 1] ?? 0))) {
      // Removed lines come before added ones, as in GNU diff.
      ops.push({ sign: "-", text: before[i] ?? "", oldLine: i + 1, newLine: j });
      i += 1;
    } else {
      ops.push({ sign: "+", text: after[j] ?? "", oldLine: i, newLine: j + 1 });
      j += 1;
    }
  }
  return ops;
}

function range(start: number, count: number): string {
  return count === 1 ? String(start) : `${String(start)},${String(count)}`;
}

/** One `@@` hunk for `ops[from..to)`. */
function hunk(ops: readonly Op[], from: number, to: number): string[] {
  const slice = ops.slice(from, to);
  const oldCount = slice.filter((op) => op.sign !== "+").length;
  const newCount = slice.filter((op) => op.sign !== "-").length;
  // An empty side names the line before the change, as GNU diff does.
  const oldStart = slice.find((op) => op.sign !== "+")?.oldLine ?? slice[0]?.oldLine ?? 0;
  const newStart = slice.find((op) => op.sign !== "-")?.newLine ?? slice[0]?.newLine ?? 0;
  const header = `@@ -${range(oldStart, oldCount)} +${range(newStart, newCount)} @@`;
  return [header, ...slice.map((op) => `${op.sign}${op.text}`)];
}

/**
 * The unified diff from `before` to `after`, with `---` and `+++` lines that
 * name `a/<name>` and `b/<name>`. Empty when the texts are equal.
 */
export function unifiedDiff(before: string, after: string, name: string): string {
  if (before === after) return "";
  const ops = editScript(splitLines(before), splitLines(after));
  const changed = ops.flatMap((op, index) => (op.sign === " " ? [] : [index]));
  const out = [`--- a/${name}`, `+++ b/${name}`];
  let index = 0;
  while (index < changed.length) {
    const start = Math.max(0, (changed[index] ?? 0) - CONTEXT);
    let last = changed[index] ?? 0;
    index += 1;
    while (index < changed.length && (changed[index] ?? 0) - last <= 2 * CONTEXT) {
      last = changed[index] ?? 0;
      index += 1;
    }
    out.push(...hunk(ops, start, Math.min(ops.length, last + CONTEXT + 1)));
  }
  return `${out.join("\n")}\n`;
}
