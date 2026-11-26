/**
 * A sentence built from variables (0.141.0): plain text, a name that links
 * to its page, and a time that the page shows as "12 min ago" (or an age, "12 min"). The machine
 * page and the workspace page say their status this way. `sentenceText`
 * reads one back as plain text, for the tests and for a title.
 */

import type { Target } from "./paths.ts";

/** A link may carry a `title`: the plain definition of a word in it ("a vigil is ..."), never the only place of a needed meaning. */
export type Part = { kind: "text"; text: string } | { kind: "link"; text: string; to: Target; title?: string } | { kind: "time"; iso: string; age: boolean };

export function plain(value: string): Part {
  return { kind: "text", text: value };
}

export function link(value: string, to: Target, title?: string): Part {
  return title === undefined ? { kind: "link", text: value, to } : { kind: "link", text: value, to, title };
}

export function time(iso: string): Part {
  return { kind: "time", iso, age: false };
}

/** An age with no "ago": "25 min", for "is 25 min old". */
export function age(iso: string): Part {
  return { kind: "time", iso, age: true };
}

/** The sentence as plain text; `timeText` turns a time into words. */
export function sentenceText(parts: readonly Part[], timeText: (iso: string) => string): string {
  return parts.map((part) => (part.kind === "time" ? timeText(part.iso) : part.text)).join("");
}

/** "a", "a and b", "a, b and c". */
export function andList(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;
}

/** The parts of a list of names, each a link: "a, b and c". */
export function linkedList(names: readonly string[], to: (name: string) => Target): Part[] {
  return names.flatMap((name, index) => {
    const glue = index === 0 ? [] : [plain(index === names.length - 1 ? " and " : ", ")];
    return [...glue, link(name, to(name))];
  });
}

/** "1 workspace", "2 workspaces". */
export function counted(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}
