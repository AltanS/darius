/**
 * The read-only view of the legacy tracker's vigils (src/core/legacy-vigils.ts):
 * header fields only, armed and resolved told apart, odd files skipped, and
 * nothing written under `.tracker/`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readLegacyVigils } from "../src/core/legacy-vigils.ts";

function checkout(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "darius-legacy-vigils-"));
  const dir = join(root, ".tracker", "vigils");
  mkdirSync(join(dir, "checks"), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return root;
}

test("armed and resolved vigils, newest resolved first, empty fields as null", () => {
  const root = checkout({
    "armed-one.md": "---\ntype: vigil\nname: Armed one\nslug: armed-one\ndue:\nuntil: the next batch\nresolved:\nverdict:\n---\n\n# body\n",
    "held-one.md": '---\nname: "Held one"\nslug: held-one\ndue: 2026-09-01\nuntil:\nresolved: 2026-09-05\nverdict: held\n---\n',
    "held-two.md": "---\nname: Held two\nresolved: 2026-09-20\nverdict: held\n---\n",
    "notes.txt": "not a vigil",
    "broken.md": "no header at all\n",
  });
  const vigils = readLegacyVigils(root);
  assert.deepEqual(
    vigils.map((vigil) => vigil.slug),
    ["armed-one", "held-two", "held-one"],
    "armed first, then the newest resolved; a file without a header is skipped",
  );
  const armed = vigils.find((vigil) => vigil.slug === "armed-one");
  assert.deepEqual(armed, { slug: "armed-one", title: "Armed one", due: null, until: "the next batch", resolved: null, verdict: null });
  const held = vigils.find((vigil) => vigil.slug === "held-one");
  assert.equal(held?.title, "Held one", "a quoted name loses its quotes");
  assert.equal(held?.verdict, "held");
  const second = vigils.find((vigil) => vigil.slug === "held-two");
  assert.equal(second?.title, "Held two", "the slug falls back to the file name");
});

test("a single-quoted name loses its quotes, and a doubled quote is one apostrophe", () => {
  const root = checkout({ "q.md": "---\nname: 'M1/02: the batch''s tip holds'\nuntil: 'the next batch'\n---\n" });
  const [vigil] = readLegacyVigils(root);
  assert.equal(vigil?.title, "M1/02: the batch's tip holds");
  assert.equal(vigil?.until, "the next batch");
});

test("a checkout without vigils gives none, and reading writes nothing", () => {
  const empty = mkdtempSync(join(tmpdir(), "darius-legacy-vigils-"));
  assert.deepEqual(readLegacyVigils(empty), []);
  const root = checkout({ "a.md": "---\nname: A\n---\n" });
  const before = readdirSync(join(root, ".tracker", "vigils")).toSorted();
  readLegacyVigils(root);
  assert.deepEqual(readdirSync(join(root, ".tracker", "vigils")).toSorted(), before);
});
