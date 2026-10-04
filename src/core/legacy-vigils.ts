/**
 * Read-only view of the legacy tracker's vigils (`<checkout>/.tracker/vigils/*.md`).
 * In a project whose marker lacks `vigil` in kinds they stay canonical there
 * (docs/concept.md), so the darius store holds none, and the web page would
 * show a project with no vigils. This reads only the header of each file and
 * never writes to `.tracker/`.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseHeader } from "./legacy-header.ts";

/** What the page needs of one legacy vigil. */
export interface LegacyVigil {
  slug: string;
  title: string;
  due: string | null;
  until: string | null;
  /** The date it was resolved; null while it is armed. */
  resolved: string | null;
  verdict: string | null;
}

function valueOf(header: Map<string, string>, key: string): string | null {
  const value = header.get(key);
  return value === undefined || value === "" ? null : value;
}

/** Legacy vigils of a checkout, the newest resolved first and the armed ones before them. */
export function readLegacyVigils(checkout: string): LegacyVigil[] {
  return readLegacyVigilsAt(join(checkout, ".tracker"));
}

/** The same for a tracker directory: `<checkout>/.tracker`, or the store working copy of an onboarded project. */
export function readLegacyVigilsAt(trackerDir: string): LegacyVigil[] {
  const dir = join(trackerDir, "vigils");
  if (!existsSync(dir)) return [];
  const vigils = readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .flatMap((name): LegacyVigil[] => {
      try {
        const header = parseHeader(readFileSync(join(dir, name), "utf8")).fields;
        if (header.size === 0) return [];
        const slug = valueOf(header, "slug") ?? name.slice(0, -".md".length);
        return [
          {
            slug,
            title: valueOf(header, "name") ?? slug,
            due: valueOf(header, "due"),
            until: valueOf(header, "until"),
            resolved: valueOf(header, "resolved"),
            verdict: valueOf(header, "verdict"),
          },
        ];
      } catch {
        return [];
      }
    });
  return vigils.toSorted((left, right) => (right.resolved ?? "9999").localeCompare(left.resolved ?? "9999") || left.slug.localeCompare(right.slug));
}
