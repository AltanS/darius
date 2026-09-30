/**
 * The read-only view of the legacy tracker's milestones
 * (src/core/legacy-milestones.ts): counts and states that follow the tracker
 * CLI, quoted headers and depends_on lists, files the tracker refuses skipped,
 * the archive counted, and nothing written under `.tracker/`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseHeader } from "../src/core/legacy-header.ts";
import { readLegacyMilestones } from "../src/core/legacy-milestones.ts";

/** A checkout with `.tracker/`; `files` maps a path below `.tracker/` to its text. */
function checkout(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "darius-legacy-milestones-"));
  for (const [name, text] of Object.entries(files)) {
    const path = join(root, ".tracker", name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}

/** Every path under a directory with its size, to prove a read changed nothing. */
function snapshot(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .toSorted()
    .map((name) => `${name}:${statSync(join(dir, name)).isFile() ? readFileSync(join(dir, name), "utf8").length : "dir"}`);
}

const README = '---\nname: "The cart: it\'s saved"\nslug: cart\nstarted: 2026-09-01\ntarget: TBD\nowner: someone@example.com\n# Optional: a comment\n---\n\n# The cart\n\n## Goal\n\n- [x] a checklist item in the README is not a spec item\n';

const FIXTURE = {
  "M12-cart/00-README.md": README,
  "M12-cart/01-keeps-items.md":
    "---\nupdated: 2026-09-03\ndepends_on: []\nagent: unassigned\nverification_passed: 2026-09-03T08:47:33.993Z\nverification_method: executed\n---\n\n# Cart keeps items\n\n## Goal\n\n- [x] one\n- [X] two\n  - Command: `true`\n- [-] three is skipped\n",
  "M12-cart/02-totals.md":
    "---\ndepends_on:\n  - 01-keeps-items.md\n  - .tracker/M9-mail/01-sender.md\n  - 'M12-cart/03-bar.md'\nagent: 'it''s quoted'\n---\n\n# Totals\n\n- [x] a\n- [ ] b\n- [~] c\n",
  "M12-cart/03-bar.md": "---\ndepends_on:\n---\n\n# Free shipping bar\n\n- [ ] a\n- [ ] b\n",
  "M12-cart/04-blocked.md": "# No header at all\n\n- [!] stuck\n- [x] done\n",
  "M12-cart/.worklog.md": "- [ ] not a spec\n",
  "M12-cart/notes.txt": "- [ ] not markdown\n",
  "M9-mail/00-README.md": "---\nname: Mail\nstarted: 2026-08-01\ntarget: 2026-09-01\n---\n",
  "M9-mail/01-sender.md": "---\nupdated: 2026-08-02\n---\n\n# One sender\n\n- [x] a\n- [x] b\n",
  "M14-search/00-README.md": "---\nname: Search\nstatus: Deferred\n---\n",
  "M14-search/01-typos.md": "---\nagent: x\n---\n\n# Typos\n\n- [ ] a\n",
  "M20-refused/00-README.md": "---\nname: Refused\n---\n",
  "M20-refused/01-inline.md": "---\ndepends_on: [M12]\n---\n\n# Inline list\n\n- [x] a\n",
  "M21-empty/00-README.md": "---\nname: Empty\n---\n",
  "00-INDEX.md": "# index\n",
  "vigils/soak.md": "---\nname: Soak\n---\n",
  "backlog/B1-x.md": "---\nname: B\n---\n",
  "archive/M1-old.md": "# old\n",
  "archive/DJ2-older/00-README.md": "# older\n",
  "archive/M3-old.md": "# old\n",
  "archive/assets/logo.png": "x",
  "archive/_note.md": "x",
} satisfies Record<string, string>;

test("milestones: ids, headers, counts over the specs' checklist items, states", () => {
  const { milestones, archived } = readLegacyMilestones(checkout(FIXTURE));
  assert.deepEqual(
    milestones.map((milestone) => milestone.id),
    ["M9", "M12", "M14", "M20", "M21"],
    "open milestones, the lowest number first; folders that are not M<n>- are not milestones",
  );
  assert.equal(archived, 3, "two archive files and one archive folder, not the assets, a dot file or an underscore file");

  const cart = milestones.find((milestone) => milestone.id === "M12");
  assert.equal(cart?.slug, "cart");
  assert.equal(cart?.title, "The cart: it's saved", "a quoted name loses its quotes");
  assert.equal(cart?.started, "2026-09-01");
  assert.equal(cart?.target, "TBD");
  assert.deepEqual([cart?.done, cart?.total], [4, 10], "items of the specs only: the README, .worklog.md and notes.txt are not counted");
  assert.equal(cart?.status, "In Progress");

  assert.equal(milestones.find((milestone) => milestone.id === "M9")?.status, "Complete");
  assert.equal(milestones.find((milestone) => milestone.id === "M9")?.title, "Mail");
  const deferred = milestones.find((milestone) => milestone.id === "M14");
  assert.equal(deferred?.status, "Deferred", "a README status that closes the milestone wins over the specs");
  assert.equal(milestones.find((milestone) => milestone.id === "M21")?.status, "Not Started", "no specs");
  assert.equal(milestones.find((milestone) => milestone.id === "M21")?.title, "Empty");
});

test("specs: slug, label, title, counts, verification, depends_on as slugs, Waiting", () => {
  const cart = readLegacyMilestones(checkout(FIXTURE)).milestones.find((milestone) => milestone.id === "M12");
  assert.deepEqual(
    cart?.specs.map((spec) => spec.slug),
    ["m12-01-keeps-items", "m12-02-totals", "m12-03-bar", "m12-04-blocked"],
  );
  const [keeps, totals, bar, blocked] = cart?.specs ?? [];
  assert.deepEqual(keeps, {
    slug: "m12-01-keeps-items",
    label: "M12/01",
    number: 1,
    title: "Cart keeps items",
    status: "Complete",
    done: 2,
    total: 3,
    verified: true,
    verifiedAt: "2026-09-03T08:47:33.993Z",
    dependsOn: [],
  });
  assert.deepEqual([totals?.done, totals?.total, totals?.verified, totals?.verifiedAt], [1, 3, false, null]);
  assert.deepEqual(totals?.dependsOn, ["m12-01-keeps-items", "m9-01-sender", "m12-03-bar"], "a file name, a .tracker path and a milestone path all become spec slugs");
  assert.equal(totals?.status, "Waiting", "it depends on a spec that is not Complete");
  assert.equal(bar?.title, "Free shipping bar");
  assert.equal(bar?.status, "Not Started");
  assert.deepEqual(bar?.dependsOn, [], "an empty depends_on is no dependency");
  assert.equal(blocked?.title, "No header at all", "a spec without a header still counts");
  assert.equal(blocked?.status, "Blocked");
  assert.deepEqual([blocked?.done, blocked?.total], [1, 2]);
});

test("a spec the tracker CLI refuses is skipped and the milestone is never Complete", () => {
  const refused = readLegacyMilestones(checkout(FIXTURE)).milestones.find((milestone) => milestone.id === "M20");
  assert.deepEqual(refused?.specs, [], "an inline depends_on list is left out");
  assert.equal(refused?.status, "In Progress");
  assert.deepEqual([refused?.done, refused?.total], [0, 0]);
});

test("older trackers: S<n>- spec names and a README-less milestone", () => {
  const root = checkout({ "M5-old/S1-first.md": "# First\n\n- [x] a\n", "M5-old/S2-second.md": "# Second\n\n- [x] a\n" });
  const [milestone] = readLegacyMilestones(root).milestones;
  assert.equal(milestone?.title, "old", "the folder name when there is no README");
  assert.deepEqual(milestone?.specs.map((spec) => [spec.label, spec.number]), [["M5/1", 1], ["M5/2", 2]]);
  assert.equal(milestone?.status, "Complete");
});

test("a checkout without .tracker gives none, an unreadable folder is skipped, and reading writes nothing", () => {
  assert.deepEqual(readLegacyMilestones(mkdtempSync(join(tmpdir(), "darius-legacy-milestones-"))), { milestones: [], archived: 0 });
  assert.deepEqual(readLegacyMilestones(checkout({ "00-INDEX.md": "x" })), { milestones: [], archived: 0 });
  const root = checkout(FIXTURE);
  const before = snapshot(join(root, ".tracker"));
  readLegacyMilestones(root);
  assert.deepEqual(snapshot(join(root, ".tracker")), before);
});

test("the shared header parser: quotes, doubled quotes, block and inline lists, an unclosed header", () => {
  const parsed = parseHeader("---\na: \"x\"\nb: 'it''s'\nc:\n  - one\n  - 'two, too'\nd: [p, 'q, r']\ne: []\n# comment\nf: plain: value\n---\nbody\n");
  assert.equal(parsed.fields.get("a"), "x");
  assert.equal(parsed.fields.get("b"), "it's");
  assert.deepEqual(parsed.lists.get("c"), ["one", "two, too"]);
  assert.deepEqual(parsed.lists.get("d"), ["p", "q, r"]);
  assert.deepEqual(parsed.lists.get("e"), []);
  assert.equal(parsed.fields.get("f"), "plain: value");
  assert.equal(parsed.inline, true);
  assert.equal(parsed.body, "body\n");
  const open = parseHeader("---\na: 1\nno closing line\n");
  assert.equal(open.closed, false);
  assert.equal(open.fields.get("a"), "1");
  assert.equal(parseHeader("no header\n").fields.size, 0);
});
