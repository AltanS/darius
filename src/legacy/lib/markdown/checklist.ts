/**
 * Hand-rolled line-based checklist parser.
 *
 * Parses markdown checklist items of the form:
 *   - [ ] task text   → pending
 *   - [x] task text   → verified
 *   - [~] task text   → in_progress
 *   - [!] task text   → blocked
 *   - [-] task text   → skipped
 *
 * Also extracts the optional Command:/Expected: DSL that appears on
 * indented lines immediately following a checklist item.
 */

export type ChecklistItemState =
  | "pending"
  | "verified"
  | "in_progress"
  | "skipped"
  | "blocked";

export type ChecklistItem = {
  /** Zero-based index within the checklist block */
  index: number;
  /** Whether the box is ticked (true iff state === 'verified'). Kept for backwards compatibility. */
  checked: boolean;
  /** The item's lifecycle state, parsed from the checkbox marker. */
  state: ChecklistItemState;
  /** The label text after the checkbox marker */
  label: string;
  /** Raw Command: value if present */
  command: string | null;
  /** Raw Expected: value if present */
  expected: string | null;
};

const ITEM_RE = /^(\s*)- \[([ xX~!\-])\] (.*)$/;
const COMMAND_RE = /^\s*- Command:\s*(`+)(.*?)\1\s*$|^\s*- Command:\s*(.+)$/;
const EXPECTED_RE = /^\s*- Expected:\s*(`+)(.*?)\1\s*$|^\s*- Expected:\s*(.+)$/;

function markerToState(marker: string): ChecklistItemState {
  switch (marker) {
    case "x":
    case "X":
      return "verified";
    case "~":
      return "in_progress";
    case "!":
      return "blocked";
    case "-":
      return "skipped";
    default:
      return "pending";
  }
}

function stateToMarker(state: ChecklistItemState): string {
  switch (state) {
    case "verified":
      return "x";
    case "in_progress":
      return "~";
    case "blocked":
      return "!";
    case "skipped":
      return "-";
    case "pending":
      return " ";
  }
}

/**
 * Parse all checklist items from the given markdown body.
 *
 * Items are collected in document order. The DSL sub-keys (Command/Expected)
 * are attached to the item directly above them in the source.
 */
export function parseChecklist(body: string): ChecklistItem[] {
  const lines = body.split("\n");
  const items: ChecklistItem[] = [];
  let currentItem: ChecklistItem | null = null;

  for (const line of lines) {
    const itemMatch = ITEM_RE.exec(line);
    if (itemMatch) {
      if (currentItem !== null) {
        items.push(currentItem);
      }
      const state = markerToState(itemMatch[2] ?? " ");
      currentItem = {
        index: items.length,
        checked: state === "verified",
        state,
        label: itemMatch[3] ?? "",
        command: null,
        expected: null,
      };
      continue;
    }

    if (currentItem !== null) {
      const cmdMatch = COMMAND_RE.exec(line);
      if (cmdMatch) {
        currentItem.command = (cmdMatch[2] ?? cmdMatch[3] ?? "").trim();
        continue;
      }

      const expMatch = EXPECTED_RE.exec(line);
      if (expMatch) {
        currentItem.expected = (expMatch[2] ?? expMatch[3] ?? "").trim();
        continue;
      }

      if (line.startsWith("#") || line.startsWith("---")) {
        items.push(currentItem);
        currentItem = null;
      }
    }
  }

  if (currentItem !== null) {
    items.push(currentItem);
  }

  return items;
}

/**
 * Serialize a list of ChecklistItems back into lines.
 *
 * Each item is written using the marker that corresponds to its state:
 * pending → `[ ]`, verified → `[x]`, in_progress → `[~]`,
 * blocked → `[!]`, skipped → `[-]`.
 */
export function serializeChecklist(items: ChecklistItem[]): string {
  const lines: string[] = [];
  for (const item of items) {
    lines.push(`- [${stateToMarker(item.state)}] ${item.label}`);
    if (item.command !== null) {
      lines.push(`  - Command: \`${item.command}\``);
    }
    if (item.expected !== null) {
      lines.push(`  - Expected: \`${item.expected}\``);
    }
  }
  return lines.join("\n");
}

/**
 * Flip a checklist item between pending and verified.
 *
 * Items in non-binary states (in_progress, blocked, skipped) become verified
 * when flipped — flipping is the canonical "mark this complete" gesture and
 * any non-pending state is closer to "done" than "not started".
 */
export function flipChecklistItem(
  items: ChecklistItem[],
  targetIndex: number,
): ChecklistItem[] {
  return items.map((item) => {
    if (item.index !== targetIndex) return item;
    const nextState: ChecklistItemState = item.checked ? "pending" : "verified";
    return { ...item, state: nextState, checked: nextState === "verified" };
  });
}
