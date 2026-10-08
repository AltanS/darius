/**
 * Read-only view of the legacy tracker's milestones (`<checkout>/.tracker/M<n>-<slug>/`).
 * Until a later migration phase they stay canonical there (docs/concept.md), so
 * the darius store holds none. This reads each milestone's `00-README.md` header
 * and each spec file, and never writes to `.tracker/`.
 *
 * The numbers follow the tracker CLI, so darius and `00-INDEX.md` agree: a
 * spec's checks are its checklist items (`- [x]` done, any other marker open),
 * and a milestone's `done` and `total` are the sums over its specs. The spec
 * and milestone states are the tracker's own rules (plugins/tracker/cli/lib:
 * `deriveStatus`, `deriveMilestoneStatus`, `resolveDependencies`).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseHeader } from "./legacy-header.ts";
import { trackerDirOfCheckout } from "./tracker-root.ts";

/** One spec file of a legacy milestone. */
export interface LegacySpec {
  /** `m316-01-gate-events-append-only-table`: the milestone id, lower case, and the file name. */
  slug: string;
  /** `M316/01` */
  label: string;
  number: number;
  title: string;
  /** Not Started, In Progress, Complete, Blocked, Skipped, or Waiting (a dependency is not Complete). */
  status: string;
  /** Checklist items that are done (`[x]`). */
  done: number;
  /** All checklist items. */
  total: number;
  /** The spec has a `verification_passed` time. */
  verified: boolean;
  verifiedAt: string | null;
  /** The specs it waits for, as spec slugs. */
  dependsOn: string[];
}

/** One open milestone of a legacy tracker. */
export interface LegacyMilestone {
  /** `M316` */
  id: string;
  number: number;
  /** The directory name after `M316-`. */
  slug: string;
  title: string;
  started: string | null;
  target: string | null;
  /** Not Started, In Progress, Complete, Skipped, Deferred or Closed. */
  status: string;
  done: number;
  total: number;
  specs: LegacySpec[];
}

export interface LegacyMilestones {
  /** Open milestones, the lowest number first. */
  milestones: LegacyMilestone[];
  /** Archived milestones: `archive/*.md` files and milestone folders. */
  archived: number;
}

type SpecState = "Not Started" | "In Progress" | "Complete" | "Blocked" | "Skipped";

const ITEM = /^\s*- \[([ xX~!-])\] (.*)$/u;
const MILESTONE_DIR = /^(M(\d+))-(.+)$/u;
/** A spec file: `01-name.md`, or `S1-name.md` in older trackers. Its leading number is the spec number. */
const SPEC_NUMBER = /^[A-Za-z]?(\d+)-/u;
/** README `status:` values that close a milestone whatever its specs say. */
const TERMINAL = new Set(["Complete", "Skipped", "Deferred", "Closed"]);

/** The tracker reads every markdown file of a milestone as a spec, except the README. */
function isSpecFile(file: string): boolean {
  return file.endsWith(".md") && file !== "00-README.md" && !file.startsWith(".") && !file.startsWith("_");
}

function valueOf(map: Map<string, string>, key: string): string | null {
  const value = map.get(key);
  return value === undefined || value === "" ? null : value;
}

interface Counts {
  done: number;
  total: number;
  open: number;
  blocked: number;
  inProgress: number;
  skipped: number;
}

function countItems(body: string): Counts {
  const counts: Counts = { done: 0, total: 0, open: 0, blocked: 0, inProgress: 0, skipped: 0 };
  for (const line of body.split("\n")) {
    const marker = ITEM.exec(line)?.[1];
    if (marker === undefined) continue;
    counts.total += 1;
    if (marker === "x" || marker === "X") counts.done += 1;
    else if (marker === "~") counts.inProgress += 1;
    else if (marker === "!") counts.blocked += 1;
    else if (marker === "-") counts.skipped += 1;
    else counts.open += 1;
  }
  return counts;
}

/** The tracker's `deriveStatus`: a spec's state comes from its checklist alone. */
function specState(counts: Counts): SpecState {
  if (counts.total === 0) return "Not Started";
  if (counts.open === 0 && counts.inProgress === 0 && counts.blocked === 0) return counts.done === 0 ? "Skipped" : "Complete";
  if (counts.blocked > 0) return "Blocked";
  return counts.done > 0 || counts.inProgress > 0 ? "In Progress" : "Not Started";
}

/** The first `# Title` line of a body. */
function titleOf(body: string): string | null {
  for (const line of body.split("\n")) {
    const match = /^#\s+(.+)$/u.exec(line.trim());
    if (match?.[1] !== undefined) return match[1].trim();
  }
  return null;
}

interface SpecDraft {
  spec: LegacySpec;
  counts: Counts;
  state: SpecState;
  /** `M316-slug/01-name.md` and the two shorter forms the tracker accepts. */
  keys: string[];
  deps: string[];
}

/** What reading one spec file gave: a spec, or `broken` for a file the tracker CLI refuses. */
type SpecRead = SpecDraft | "broken";

function readSpec(dir: string, milestone: string, id: string, file: string): SpecRead | null {
  try {
    const parsed = parseHeader(readFileSync(join(dir, file), "utf8"));
    if (parsed.inline) return "broken";
    const body = parsed.body;
    const counts = countItems(body);
    const state = specState(counts);
    const name = file.slice(0, -".md".length);
    const numberText = SPEC_NUMBER.exec(file)?.[1];
    const number = Number.parseInt(numberText ?? "0", 10);
    const verifiedAt = valueOf(parsed.fields, "verification_passed");
    const slug = `${id.toLowerCase()}-${name}`;
    const spec: LegacySpec = {
      slug,
      label: `${id}/${numberText ?? name}`,
      number,
      title: titleOf(body) ?? name.replace(SPEC_NUMBER, ""),
      status: state,
      done: counts.done,
      total: counts.total,
      verified: verifiedAt !== null,
      verifiedAt,
      dependsOn: [],
    };
    return { spec, counts, state, keys: [`.tracker/${milestone}/${file}`, `${milestone}/${file}`, file], deps: parsed.lists.get("depends_on") ?? [] };
  } catch {
    return null;
  }
}

/** A `depends_on` entry as a spec slug: a path of any of the shapes the tracker writes. */
function depSlug(entry: string, ownId: string): string {
  const parts = entry.replace(/^\.\//u, "").split("/");
  const file = (parts.at(-1) ?? entry).replace(/\.md$/u, "");
  const owner = MILESTONE_DIR.exec(parts.at(-2) ?? "")?.[1] ?? ownId;
  return `${owner.toLowerCase()}-${file}`;
}

function readMilestone(root: string, dirName: string): { milestone: LegacyMilestone; drafts: SpecDraft[] } | null {
  const match = MILESTONE_DIR.exec(dirName);
  if (match === null) return null;
  const id = match[1] ?? "";
  const dir = join(root, dirName);
  try {
    let header = new Map<string, string>();
    try {
      header = parseHeader(readFileSync(join(dir, "00-README.md"), "utf8")).fields;
    } catch {
      // A milestone without a readable README keeps its folder name.
    }
    const reads = readdirSync(dir)
      .filter(isSpecFile)
      .toSorted((left, right) => left.localeCompare(right))
      .map((file) => readSpec(dir, dirName, id, file));
    // The tracker counts a spec it cannot read as unknown work: it is left out, and the milestone is never Complete.
    const broken = reads.includes("broken");
    const drafts = reads.filter((read): read is SpecDraft => read !== null && read !== "broken");
    const override = valueOf(header, "status");
    const milestone: LegacyMilestone = {
      id,
      number: Number.parseInt(match[2] ?? "0", 10),
      slug: match[3] ?? dirName,
      title: valueOf(header, "name") ?? match[3] ?? dirName,
      started: valueOf(header, "started"),
      target: valueOf(header, "target"),
      status: override !== null && TERMINAL.has(override) ? override : milestoneState(drafts, broken),
      done: drafts.reduce((sum, draft) => sum + draft.counts.done, 0),
      total: drafts.reduce((sum, draft) => sum + draft.counts.total, 0),
      specs: drafts.map((draft) => draft.spec),
    };
    return { milestone, drafts };
  } catch {
    return null;
  }
}

function isTerminal(draft: SpecDraft): boolean {
  return draft.state === "Complete" || draft.state === "Skipped";
}

/** The tracker's `deriveMilestoneStatus`, without an override. */
function milestoneState(drafts: readonly SpecDraft[], broken: boolean): string {
  if (drafts.length === 0 && !broken) return "Not Started";
  if (broken) return "In Progress";
  if (drafts.every(isTerminal)) return drafts.some((draft) => draft.state === "Complete") ? "Complete" : "Skipped";
  const started = drafts.some((draft) => draft.state === "In Progress" || draft.state === "Blocked" || draft.counts.done > 0);
  return started ? "In Progress" : "Not Started";
}

/** `archive/` holds one markdown file or one folder per archived milestone. */
function countArchived(root: string): number {
  const dir = join(root, "archive");
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((entry) => {
      if (entry.isDirectory()) return /^[A-Za-z]+\d+-/u.test(entry.name);
      return entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith(".") && !entry.name.startsWith("_");
    }).length;
  } catch {
    return 0;
  }
}

/** The open milestones of a checkout, and how many are archived. */
export function readLegacyMilestones(checkout: string): LegacyMilestones {
  return readLegacyMilestonesAt(trackerDirOfCheckout(checkout));
}

/** The same for a tracker directory: `<checkout>/.tracker`, or the store working copy of an onboarded project. */
export function readLegacyMilestonesAt(root: string): LegacyMilestones {
  if (!existsSync(root)) return { milestones: [], archived: 0 };
  let names: string[] = [];
  try {
    names = readdirSync(root);
  } catch {
    return { milestones: [], archived: 0 };
  }
  const read = names.flatMap((name) => {
    const one = readMilestone(root, name);
    return one === null ? [] : [one];
  });

  // A spec is Waiting while a spec it depends on is not Complete; an unknown one is not Complete.
  const states = new Map<string, SpecState>();
  for (const { drafts } of read) for (const draft of drafts) for (const key of draft.keys) states.set(key, draft.state);
  for (const { milestone, drafts } of read) {
    for (const draft of drafts) {
      if (draft.deps.length === 0) continue;
      draft.spec.dependsOn = draft.deps.map((entry) => depSlug(entry, milestone.id));
      const unmet = draft.deps.some((entry) => {
        const normal = entry.replace(/^\.\//u, "");
        const state = states.get(normal) ?? states.get(normal.split("/").at(-1) ?? normal);
        return state !== "Complete";
      });
      if (unmet) draft.spec.status = "Waiting";
    }
  }
  const milestones = read.map((one) => one.milestone).toSorted((left, right) => left.number - right.number || left.slug.localeCompare(right.slug));
  return { milestones, archived: countArchived(root) };
}
