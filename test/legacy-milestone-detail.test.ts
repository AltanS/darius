/**
 * The read-only detail of one legacy tracker milestone
 * (src/core/legacy-milestone-detail.ts): README, spec texts in order, the
 * other files of the directory, the worklogs tied to the milestone the way
 * the tracker ties them (file name, or a thread's spec marker), the path
 * guard (no `..`, no symlink out of `.tracker/`), and nothing written.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MAX_TEXT_BYTES, pickMilestone, readLegacyMilestoneDetail, specPointsInto, worklogMilestone } from "../src/core/legacy-milestone-detail.ts";
import { readLegacyMilestones } from "../src/core/legacy-milestones.ts";

/** A checkout with `.tracker/`; `files` maps a path below `.tracker/` to its text. */
function checkout(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "darius-milestone-detail-"));
  for (const [name, text] of Object.entries(files)) {
    const path = join(root, ".tracker", name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}

function snapshot(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .toSorted()
    .map((name) => `${name}:${statSync(join(dir, name)).isFile() ? readFileSync(join(dir, name), "utf8").length : "dir"}`);
}

const STAMP = `<!-- distilled: 2026-09-15T08:00:00Z source-sha256: ${"a".repeat(64)} raw: archive/worklog-raw/M12-cart.md -->`;

const FIXTURE = {
  "M12-cart/00-README.md": "---\nname: Cart\nstarted: 2026-09-01\n---\n\n# The cart\n\n## Goal\n\nKeep it.\n",
  "M12-cart/02-totals.md": "---\ndepends_on:\n  - 01-keeps.md\n---\n\n# Totals\n\n- [ ] a\n",
  "M12-cart/01-keeps.md": "---\nupdated: 2026-09-03\n---\n\n# Keeps\n\n- [x] one\n  - Command: `true`\n- [ ] two\n",
  "M12-cart/10-later.md": "# Later\n\n- [ ] x\n",
  "M12-cart/05-refused.md": "---\ndepends_on: [M9]\n---\n\n# Refused\n",
  "M12-cart/_audit.md": "# Audit\n",
  "M12-cart/_counsel/01-keeps.md": "counsel on 01\n",
  "M12-cart/notes.txt": "plain notes\n",
  "M12-cart/.hidden.md": "hidden\n",
  "M12-cart/.objects/x.md": "object\n",
  "M12-cart/art/sketch.png": "\u0089PNG",
  "M9-mail/00-README.md": "---\nname: Mail\n---\n",
  "M9-mail/01-sender.md": "# Sender\n\n- [x] a\n",
  "M13-bare/01-only.md": "# Only\n\n- [ ] a\n",
  "worklog/M12-cart.md": `${STAMP}\n\n# Cart (distilled)\n\nShort.\n`,
  "worklog/m12-tax-spike.md": "## Tax\n\n<!-- opened: 2026-09-20T10:00:00Z -->\n\n- rounding\n",
  "worklog/M012-padded.md": "zero padded number\n",
  "worklog/M120-other.md": "another milestone\n",
  "worklog/M1-cart.md": "M1, not M12\n",
  "worklog/2026-09-02-spike.md": "## Spike\n\n<!-- opened: 2026-09-02T10:00:00Z -->\n<!-- spec: .tracker/M12-cart/01-keeps.md -->\n\n- note\n",
  "worklog/2026-09-03-other.md": "## Other\n\n<!-- spec: .tracker/M120-cart/01-x.md -->\n",
  "worklog/2026-09-04-elsewhere.md": "## Elsewhere\n\n<!-- spec: /somewhere/else/.tracker/M12-cart/01-keeps.md -->\n",
  "worklog/00-INDEX.md": "| M12-cart.md | M12 |\n",
  "worklog/M12-nested/inside.md": "a folder is no worklog\n",
} satisfies Record<string, string>;

test("a milestone in full: README without its header, specs in order with their text, the other files", () => {
  const detail = readLegacyMilestoneDetail(checkout(FIXTURE), "M12");
  assert.ok(detail !== null);
  assert.equal(detail.dir, "M12-cart");
  assert.equal(detail.milestone.id, "M12");
  assert.equal(detail.readme?.text, "\n# The cart\n\n## Goal\n\nKeep it.\n", "the README body, header cut off");
  assert.equal(detail.readme?.markdown, true);
  assert.deepEqual(
    detail.specs.map(({ spec, file }) => [spec.label, file.path]),
    [["M12/01", "01-keeps.md"], ["M12/02", "02-totals.md"], ["M12/10", "10-later.md"]],
    "by spec number; a spec the tracker refuses is not a spec",
  );
  assert.equal(detail.specs[0]?.file.text, "\n# Keeps\n\n- [x] one\n  - Command: `true`\n- [ ] two\n");
  assert.equal(detail.specs[1]?.spec.status, "Waiting", "the spec row is the one the list shows");
  assert.deepEqual(
    detail.others.map((file) => [file.path, file.omitted]),
    [
      ["05-refused.md", null],
      ["_audit.md", null],
      ["_counsel/01-keeps.md", null],
      ["art/sketch.png", "binary"],
      ["notes.txt", null],
    ],
    "every other file by path; dot files and folders are skipped",
  );
  const notes = detail.others.find((file) => file.path === "notes.txt");
  assert.deepEqual([notes?.markdown, notes?.text, notes?.size], [false, "plain notes\n", 12]);
  assert.match(notes?.modifiedAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
});

test("worklogs: named after the milestone (any case, the number compared) or tied by a thread's spec marker", () => {
  const root = checkout(FIXTURE);
  writeFileSync(join(root, ".tracker", "worklog", "2026-09-05-absolute.md"), `## Abs\n\n<!-- spec: ${join(root, ".tracker", "M12-cart", "02-totals.md")} -->\n`);
  const detail = readLegacyMilestoneDetail(root, "M12");
  const links = new Map(detail?.worklogs.map((worklog) => [worklog.path, worklog.link]));
  assert.deepEqual(
    [...links.entries()].toSorted(([left], [right]) => left.localeCompare(right)),
    [
      ["2026-09-02-spike.md", "spec"],
      ["2026-09-05-absolute.md", "spec"],
      ["M012-padded.md", "name"],
      ["M12-cart.md", "name"],
      ["m12-tax-spike.md", "name"],
    ],
    "not M120, not M1, not a spec marker into another milestone or another checkout, not the 00- index, not a folder",
  );
  const stub = detail?.worklogs.find((worklog) => worklog.path === "M12-cart.md");
  assert.equal(stub?.distilledAt, "2026-09-15T08:00:00Z", "a distilled stub is marked");
  assert.ok(stub?.text?.startsWith("<!-- distilled:"), "and shown as it is");
  assert.equal(detail?.worklogs.find((worklog) => worklog.path === "m12-tax-spike.md")?.distilledAt, null);
  assert.equal(readLegacyMilestoneDetail(root, "M9")?.worklogs.length, 0);
});

test("the tracker's link rules, one by one", () => {
  assert.equal(worklogMilestone("M7-x.md"), 7);
  assert.equal(worklogMilestone("m07-x.md"), 7);
  assert.equal(worklogMilestone("2026-09-01-m7.md"), null, "only a leading code names a milestone");
  assert.equal(worklogMilestone("M7.md"), null);
  const roots = ["/home/u/p/.tracker"];
  assert.equal(specPointsInto(".tracker/M7-cart/01-a.md", "M7-cart", roots), true);
  assert.equal(specPointsInto("./.tracker/m7-cart/01-a.md", "M7-cart", roots), true, "any case, a leading ./");
  assert.equal(specPointsInto("M7-cart/01-a.md", "M7-cart", roots), true);
  assert.equal(specPointsInto("/home/u/p/.tracker/M7-cart/01-a.md", "M7-cart", roots), true);
  assert.equal(specPointsInto("/home/u/other/.tracker/M7-cart/01-a.md", "M7-cart", roots), false, "another checkout");
  assert.equal(specPointsInto(".tracker/M7-cart", "M7-cart", roots), false, "the folder itself is no spec");
  assert.equal(specPointsInto(".tracker/M70-cart/01-a.md", "M7-cart", roots), false);
});

test("a milestone without a README has none; one that does not exist gives null", () => {
  const root = checkout(FIXTURE);
  const bare = readLegacyMilestoneDetail(root, "M13");
  assert.equal(bare?.readme, null);
  assert.deepEqual(bare?.specs.map(({ file }) => file.path), ["01-only.md"]);
  assert.equal(readLegacyMilestoneDetail(root, "M99"), null);
  assert.equal(readLegacyMilestoneDetail(mkdtempSync(join(tmpdir(), "darius-milestone-detail-")), "M12"), null, "no .tracker");
});

test("the URL names a milestone by id or directory; anything else, `..` included, finds nothing", () => {
  const root = checkout({ ...FIXTURE, "M5-a/01-x.md": "# x\n", "M5-b/01-y.md": "# y\n" });
  const { milestones } = readLegacyMilestones(root);
  assert.equal(pickMilestone(milestones, "m12")?.slug, "cart");
  assert.equal(pickMilestone(milestones, "M12-cart")?.slug, "cart");
  assert.equal(pickMilestone(milestones, "M5"), null, "two open milestones share M5");
  assert.equal(pickMilestone(milestones, "M5-b")?.slug, "b");
  for (const ref of ["..", "../M12-cart", "M12/..", "M12-cart/01-keeps.md", "M12-..", "worklog", "", "M12-cart/../M9-mail"]) {
    assert.equal(readLegacyMilestoneDetail(root, ref), null, ref);
  }
});

test("path guard: a symlink out of .tracker is left out; one inside it is followed", () => {
  const root = checkout(FIXTURE);
  const outside = mkdtempSync(join(tmpdir(), "darius-milestone-outside-"));
  writeFileSync(join(outside, "secret.md"), "# secret\n");
  mkdirSync(join(outside, "M14-away"));
  writeFileSync(join(outside, "M14-away", "01-x.md"), "# away\n");
  const tracker = join(root, ".tracker");
  symlinkSync(join(outside, "secret.md"), join(tracker, "M12-cart", "_leak.md"));
  symlinkSync(join(tracker, "M12-cart", ".objects", "x.md"), join(tracker, "M12-cart", "_counsel", "02-object.md"));
  symlinkSync(outside, join(tracker, "M12-cart", "_linked-dir"));
  symlinkSync(join(outside, "secret.md"), join(tracker, "worklog", "M12-leak.md"));
  symlinkSync(join(outside, "M14-away"), join(tracker, "M14-away"));

  const detail = readLegacyMilestoneDetail(root, "M12");
  const paths = detail?.others.map((file) => file.path) ?? [];
  assert.equal(paths.includes("_leak.md"), false, "a file link out of .tracker");
  assert.equal(paths.some((path) => path.startsWith("_linked-dir")), false, "a folder link is not followed");
  assert.equal(detail?.others.find((file) => file.path === "_counsel/02-object.md")?.text, "object\n", "a link inside .tracker is read");
  assert.equal(detail?.worklogs.some((worklog) => worklog.path === "M12-leak.md"), false, "a worklog link out of .tracker");
  assert.equal(JSON.stringify(detail).includes("secret"), false);
  assert.equal(readLegacyMilestoneDetail(root, "M14"), null, "a milestone folder that links out of .tracker");
});

test("a file over the size limit is listed, not read; reading writes nothing", () => {
  const root = checkout({ ...FIXTURE, "M12-cart/_big.md": "x".repeat(MAX_TEXT_BYTES + 1) });
  const before = snapshot(join(root, ".tracker"));
  const big = readLegacyMilestoneDetail(root, "M12")?.others.find((file) => file.path === "_big.md");
  assert.deepEqual([big?.text, big?.omitted, big?.size], [null, "too-large", MAX_TEXT_BYTES + 1]);
  assert.deepEqual(snapshot(join(root, ".tracker")), before);
});
