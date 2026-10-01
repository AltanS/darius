/**
 * The hand-rolled TOML subset (src/core/toml.ts): dotted section headers and
 * string arrays (one-line and multi-line) and literal strings, on top of the flat tables, strings, booleans and
 * integers it already read and wrote.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../src/core/config.ts";
import { readMarker } from "../src/core/marker.ts";
import {
  parseToml,
  tomlArray,
  tomlArrayMultiline,
  tomlKey,
  tomlLiteral,
  tomlSectionHeader,
  tomlString,
  type TomlDocument,
} from "../src/core/toml.ts";

function withConfigDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "darius-toml-test-"));
  const previous = process.env.DARIUS_CONFIG_DIR;
  process.env.DARIUS_CONFIG_DIR = dir;
  try {
    run(dir);
  } finally {
    if (previous === undefined) delete process.env.DARIUS_CONFIG_DIR;
    else process.env.DARIUS_CONFIG_DIR = previous;
  }
}

// --- dotted section headers --------------------------------------------------------

test("a section header with one dot keys the full dotted name", () => {
  const doc = parseToml('[profiles.opus-skip]\nmode = "act"\n', "x.toml");
  assert.deepEqual(doc.sections["profiles.opus-skip"], { mode: "act" });
  assert.equal(doc.lines["profiles.opus-skip.mode"], 2);
});

test("a plain, undotted section header still works", () => {
  const doc = parseToml('[remote]\nbucket = "darius"\n', "x.toml");
  assert.deepEqual(doc.sections.remote, { bucket: "darius" });
});

test("a section header with more than one dot is an error naming file and line", () => {
  assert.throws(
    () => parseToml('[a.b.c]\nk = "v"\n', "x.toml"),
    /x\.toml:1: a section header allows at most one dot/u,
  );
});

test("a section header with a non-bare part is a malformed-header error naming file and line", () => {
  assert.throws(
    () => parseToml('["a b"]\nk = "v"\n', "x.toml"),
    /x\.toml:1: malformed section header/u,
  );
});

// --- one-line string arrays ---------------------------------------------------------

test("an empty array parses to an empty list", () => {
  const doc = parseToml("args = []\n", "x.toml");
  assert.deepEqual(doc.root.args, []);
});

test("an array of quoted strings, including escapes and an empty element", () => {
  const doc = parseToml('args = ["--foo", "bar baz", "", "line\\nbreak", "a\\"b"]\n', "x.toml");
  assert.deepEqual(doc.root.args, ["--foo", "bar baz", "", "line\nbreak", 'a"b']);
});

test("a trailing comma before the closing bracket is allowed", () => {
  const doc = parseToml('args = ["a", "b",]\n', "x.toml");
  assert.deepEqual(doc.root.args, ["a", "b"]);
});

test("an array may sit next to a comment", () => {
  const doc = parseToml('args = ["a"] # the args\n', "x.toml");
  assert.deepEqual(doc.root.args, ["a"]);
});

test("a number element in an array is an error naming file and line", () => {
  assert.throws(
    () => parseToml("args = [1, 2]\n", "x.toml"),
    /x\.toml:1: array elements must be quoted strings/u,
  );
});

test("an unclosed array is an error naming file and line", () => {
  assert.throws(
    () => parseToml('args = ["a", "b"\n', "x.toml"),
    /x\.toml:1: unterminated array/u,
  );
});

test("a nested array is an error naming file and line", () => {
  assert.throws(
    () => parseToml('args = [["a"]]\n', "x.toml"),
    /x\.toml:1: nested arrays are not supported/u,
  );
});

test("two values without a comma between them is an error naming file and line", () => {
  assert.throws(
    () => parseToml('args = ["a" "b"]\n', "x.toml"),
    /x\.toml:1: expected "," or "\]" in array/u,
  );
});

test("a double comma is an error naming file and line", () => {
  assert.throws(
    () => parseToml('args = ["a",,"b"]\n', "x.toml"),
    /x\.toml:1: array elements must be quoted strings/u,
  );
});

test("trailing content after a closed array is an error naming file and line", () => {
  assert.throws(
    () => parseToml('args = ["a"] garbage\n', "x.toml"),
    /x\.toml:1: trailing content after an array/u,
  );
});

// --- writer: tomlArray, tomlSectionHeader --------------------------------------------

test("tomlArray round-trips through parseToml, including quotes and an empty string", () => {
  const values = ["--foo", 'a "quoted" bit', "", "tab\ttab"];
  const doc = parseToml(`args = ${tomlArray(values)}\n`, "x.toml");
  assert.deepEqual(doc.root.args, values);
});

test("tomlSectionHeader round-trips a dotted name through parseToml", () => {
  const text = `${tomlSectionHeader("profiles.opus-skip")}\n${tomlKey("mode")} = ${tomlString("act")}\n`;
  const doc = parseToml(text, "x.toml");
  assert.deepEqual(doc.sections["profiles.opus-skip"], { mode: "act" });
});

test("tomlSectionHeader refuses more than one dot and a non-bare part", () => {
  assert.throws(() => tomlSectionHeader("a.b.c"), /cannot write/u);
  assert.throws(() => tomlSectionHeader("a b"), /cannot write/u);
});

test("a document mixing a dotted section, an array and plain keys round-trips", () => {
  const text = [
    'host = "host-a"',
    "",
    tomlSectionHeader("profiles.opus-skip"),
    `mode = ${tomlString("act")}`,
    `args = ${tomlArray(["--foo", "bar baz"])}`,
    "",
  ].join("\n");
  const doc: TomlDocument = parseToml(text, "x.toml");
  assert.equal(doc.root.host, "host-a");
  assert.deepEqual(doc.sections["profiles.opus-skip"], {
    mode: "act",
    args: ["--foo", "bar baz"],
  });
});

// --- a scalar-expecting caller rejects an array ---------------------------------------

test("loadConfig refuses notify.webhook given as an array, not silently accepting it", () => {
  withConfigDir((dir) => {
    writeFileSync(
      join(dir, "config.toml"),
      ['host = "host-a"', "[notify]", 'webhook = ["not", "a", "string"]'].join("\n"),
    );
    assert.throws(() => loadConfig(), /notify.*"webhook".*must be a string/su);
  });
});

test("readMarker refuses project given as an array, not silently accepting it", () => {
  const dir = mkdtempSync(join(tmpdir(), "darius-toml-marker-test-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".darius.toml"), 'project = ["a", "b"]\n');
  assert.throws(() => readMarker(dir), /project = "<name>" is required/u);
});

// --- multi-line arrays and literal strings ----------------------------------------------

test("an array may span lines, with comments, blank lines and a trailing comma", () => {
  const text = 'a = 1\nmay = [\n  "x", # first\n\n  # a comment line\n  "y",\n]\nb = "after"\n';
  const doc = parseToml(text, "x.toml");
  assert.deepEqual(doc.root.may, ["x", "y"]);
  assert.equal(doc.root.b, "after");
  assert.equal(doc.lines.b, 8);
});

test("a multi-line array inside a section keeps the following keys and lines", () => {
  const doc = parseToml('[rituals.a]\nmay = [\n"x"\n]\ntitle = "t"\n', "x.toml");
  assert.deepEqual(doc.sections["rituals.a"], { may: ["x"], title: "t" });
  assert.equal(doc.lines["rituals.a.title"], 5);
});

test("an unclosed multi-line array names the line it opened on", () => {
  assert.throws(() => parseToml('\nmay = [\n"x",\n', "x.toml"), /x\.toml:2: unterminated array/u);
});

test("an error inside a multi-line array names the line of the item", () => {
  assert.throws(() => parseToml('may = [\n"x",\n3,\n]\n', "x.toml"), /x\.toml:3: array elements must be quoted strings/u);
});

test("trailing content after a multi-line array's bracket is an error on that line", () => {
  assert.throws(() => parseToml('may = [\n"x"\n] junk\n', "x.toml"), /x\.toml:3: trailing content after an array/u);
});

test("a literal string keeps backslashes: \\b stays two characters", () => {
  const doc = parseToml("hold = '\\bdeploy\\b'\nlist = ['\\bone\\b', \"two\", 'a#b']\n", "x.toml");
  assert.equal(doc.root.hold, "\\bdeploy\\b");
  assert.equal(String(doc.root.hold).length, 10);
  assert.deepEqual(doc.root.list, ["\\bone\\b", "two", "a#b"]);
});

test("an unterminated literal string is an error naming file and line", () => {
  assert.throws(() => parseToml("a = 'oops\n", "x.toml"), /x\.toml:1: unterminated literal string/u);
  assert.throws(() => parseToml("a = ['oops\n]\n", "x.toml"), /x\.toml:1: unterminated literal string/u);
});

test("tomlLiteral writes single quotes, and falls back when it cannot", () => {
  assert.equal(tomlLiteral("\\bdeploy\\b"), "'\\bdeploy\\b'");
  assert.equal(tomlLiteral("it's"), '"it\'s"');
  assert.equal(tomlLiteral("a\nb"), '"a\\nb"');
  for (const value of ["\\bdeploy\\b", "it's", "a\nb", "plain"]) {
    assert.equal(parseToml(`k = ${tomlLiteral(value)}\n`, "x.toml").root.k, value);
  }
});

test("tomlArrayMultiline round-trips through parseToml with either quote form", () => {
  const items = ["\\bdeploy\\b", "--confirm\\b", 'say "hi"'];
  assert.equal(tomlArrayMultiline([]), "[]");
  assert.equal(tomlArrayMultiline(["a"]), '[\n  "a",\n]');
  for (const quote of [undefined, tomlLiteral]) {
    const text = `hold = ${tomlArrayMultiline(items, quote)}\nafter = true\n`;
    const doc = parseToml(text, "x.toml");
    assert.deepEqual(doc.root.hold, items);
    assert.equal(doc.root.after, true);
  }
});
