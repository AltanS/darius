/**
 * The hand-rolled TOML subset (src/core/toml.ts): dotted section headers and
 * one-line string arrays, on top of the flat tables, strings, booleans and
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
  tomlKey,
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
