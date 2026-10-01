/**
 * The item-file frontmatter grammar (docs/plan-tonight.md, "Data formats" >
 * "Item file"): round-tripping a ritual and a vigil header, and every
 * "anything else is a parse error that names the file" case the grammar
 * calls out.
 *
 * `parseDocument`/`serializeDocument` work on the raw, on-disk header:
 * every leaf is a string (docs/plan-tonight.md's frontmatter grammar has no
 * number or boolean scalar type, only "scalar", "list" and "one level of
 * nested map"). Coercing that raw header into the typed `Ritual`/`Vigil`
 * from `src/core/model.ts` is a different module's job.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDocument, serializeDocument } from "../src/core/frontmatter.ts";
import type { FrontmatterHeader } from "../src/core/frontmatter.ts";

const RITUAL_HEADER: FrontmatterHeader = {
  id: "01K5Z8QK5Q9S1N1B5N9S1N1B5N",
  kind: "ritual",
  slug: "heartbeat",
  title: "Heartbeat",
  created: "2026-09-28T03:00:00.000Z",
  updated: "2026-09-28T03:00:00.000Z",
  cadence: "1d",
  anchor: "due",
  agent: "claude",
  owner: "someone@example.com",
  tags: ["selftest", "heartbeat"],
  policy: {
    mode: "report",
    may: ["Bash(darius *)", "Bash(date)"],
    hold: ["git push", "rm -rf"],
    notes: "Read-only against production.",
    model: "haiku",
    max_turns: "6",
  },
};

const VIGIL_HEADER: FrontmatterHeader = {
  id: "01K5Z8QK5Q9S1N1B5N9S1N1B5P",
  kind: "vigil",
  slug: "date-held",
  title: "Date held",
  created: "2026-09-28T03:00:00.000Z",
  updated: "2026-09-28T03:00:00.000Z",
  due: "2026-09-27",
  heavy: "false",
  tags: [],
  imported_from: ".tracker/vigils/date-held.md",
};

const BODY = `
# Heartbeat

Runs \`darius --version\` and \`date\`, then records completion.

- one
- two
`;

test("round-trips a ritual header and body byte for byte", () => {
  const text = serializeDocument(RITUAL_HEADER, BODY);
  const parsed = parseDocument(text, "ritual.md");
  assert.deepEqual(parsed.header, RITUAL_HEADER);
  assert.equal(parsed.body, BODY);
});

test("round-trips a vigil header and body byte for byte", () => {
  const text = serializeDocument(VIGIL_HEADER, BODY);
  const parsed = parseDocument(text, "vigil.md");
  assert.deepEqual(parsed.header, VIGIL_HEADER);
  assert.equal(parsed.body, BODY);
});

test("round-trips a scalar that needs quoting (embeds ': ')", () => {
  const header: FrontmatterHeader = { title: "Bonus surface freshness: refresh" };
  const text = serializeDocument(header, "");
  assert.match(text, /title: "Bonus surface freshness: refresh"/);
  assert.deepEqual(parseDocument(text, "quoted.md").header, header);
});

test("round-trips an empty list as the inline '[]' marker", () => {
  const header: FrontmatterHeader = { tags: [] };
  const text = serializeDocument(header, "");
  assert.match(text, /^tags: \[\]$/m);
  assert.deepEqual(parseDocument(text, "empty-list.md").header, header);
});

test("parses a top-level list under a bare key", () => {
  const text = "---\ntags:\n  - alpha\n  - beta\n---\nbody\n";
  const parsed = parseDocument(text, "list.md");
  assert.deepEqual(parsed.header, { tags: ["alpha", "beta"] });
});

test("parses one level of nested map with mixed scalar and list values", () => {
  const text = [
    "---",
    "policy:",
    "  mode: report",
    "  may:",
    '    - "Bash(darius *)"',
    "  max_turns: 6",
    "---",
    "",
  ].join("\n");
  const parsed = parseDocument(text, "policy.md");
  assert.deepEqual(parsed.header, {
    policy: { mode: "report", may: ["Bash(darius *)"], max_turns: "6" },
  });
});

test("rejects a missing opening delimiter, naming the file", () => {
  assert.throws(() => parseDocument("title: x\n---\nbody\n", "bad-open.md"), /bad-open\.md:1:.*'---'/);
});

test("rejects a missing closing delimiter, naming the file", () => {
  assert.throws(() => parseDocument("---\ntitle: x\nbody\n", "bad-close.md"), /bad-close\.md:.*'---'/);
});

test("rejects a second level of nested map, naming the file", () => {
  const text = ["---", "policy:", "  extra:", "    inner: value", "---", ""].join("\n");
  assert.throws(
    () => parseDocument(text, "too-deep.md"),
    /too-deep\.md:3: 'extra' starts a second level of nested map/,
  );
});

test("rejects a nested list, naming the file", () => {
  const text = ["---", "tags:", "  - alpha", "  - - beta", "---", ""].join("\n");
  assert.throws(() => parseDocument(text, "nested-list.md"), /nested-list\.md:4: nested lists are not supported/);
});

test("rejects a single-quoted string, naming the file", () => {
  const text = ["---", "title: 'no'", "---", ""].join("\n");
  assert.throws(
    () => parseDocument(text, "single-quote.md"),
    /single-quote\.md:2: single-quoted strings are not supported/,
  );
});

test("rejects a blank line inside frontmatter, naming the file", () => {
  const text = ["---", "title: x", "", "slug: y", "---", ""].join("\n");
  assert.throws(() => parseDocument(text, "blank.md"), /blank\.md:3: blank line inside frontmatter/);
});

test("a quoted value with newlines round-trips on one line, and an unknown escape is still an error", () => {
  const header = { title: "one\ntwo\r\n\"three\" \\ four", tags: ["a\nb"] };
  const text = serializeDocument(header, "body\n");
  assert.equal(text.split("\n").length, 7, "the value adds no lines");
  assert.deepEqual(parseDocument(text, "x.md").header, header);
  assert.throws(() => parseDocument('---\ntitle: "a\\qb"\n---\n', "x.md"), /x\.md:2: unsupported escape sequence/u);
});
