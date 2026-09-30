/**
 * The generic flag parser every command's `run(args)` relies on. Pure and
 * synchronous (see src/cli/args.ts's top comment for why `readStdin` is kept
 * separate), so these are ordinary in-process assertions -- no spawning.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseArgs } from "../src/cli/args.ts";

test("positional arguments are collected in order", () => {
  const args = parseArgs(["add", "my-slug"]);
  assert.deepEqual(args.positional, ["add", "my-slug"]);
  assert.deepEqual(args.flags, {});
});

test("--flag value consumes the next token as the value", () => {
  const args = parseArgs(["--title", "My Title"]);
  assert.equal(args.flags.title, "My Title");
  assert.deepEqual(args.positional, []);
});

test("--flag=value is always a value, even if it looks like a flag", () => {
  const args = parseArgs(["--title=--not-a-flag"]);
  assert.equal(args.flags.title, "--not-a-flag");
});

test("--bool with nothing after it, or another flag after it, is true", () => {
  const trailing = parseArgs(["--dry-run"]);
  assert.equal(trailing.flags["dry-run"], true);

  const followedByFlag = parseArgs(["--dry-run", "--json"]);
  assert.equal(followedByFlag.flags["dry-run"], true);
  assert.equal(followedByFlag.flags.json, true);
});

test("a known boolean flag never swallows the positional after it", () => {
  // `darius import --json /path/.tracker` must keep the path. Before the
  // BOOLEAN_FLAGS list, the path became the value of --json and vanished.
  const args = parseArgs(["--json", "/path/.tracker", "--dry-run", "some-project"]);
  assert.equal(args.flags.json, true);
  assert.equal(args.flags["dry-run"], true);
  assert.deepEqual(args.positional, ["/path/.tracker", "some-project"]);
});

test("an unknown flag followed by a bare word takes it as its value", () => {
  const args = parseArgs(["--title", "Heartbeat"]);
  assert.equal(args.flags.title, "Heartbeat");
  assert.deepEqual(args.positional, []);
});

test("a flag given twice keeps its last value in flags, and every value in repeated", () => {
  const args = parseArgs(["--question", "a", "--question", "b", "--question", "c"]);
  assert.equal(args.flags.question, "c");
  assert.deepEqual(args.repeated.question, ["a", "b", "c"]);
});

test("a flag given once still appears in repeated, with one entry", () => {
  const args = parseArgs(["--title", "solo"]);
  assert.deepEqual(args.repeated.title, ["solo"]);
});

test("boolean flags are not collected into repeated", () => {
  const args = parseArgs(["--dry-run", "--dry-run"]);
  assert.equal(args.repeated["dry-run"], undefined);
});

test("-- ends flag parsing; everything after it is positional, flag-shaped or not", () => {
  const args = parseArgs(["add", "--", "--title", "literally positional"]);
  assert.deepEqual(args.positional, ["add", "--title", "literally positional"]);
  assert.deepEqual(args.flags, {});
});

test("flags and positionals can interleave", () => {
  const args = parseArgs(["add", "--title", "Foo", "second-positional"]);
  assert.deepEqual(args.positional, ["add", "second-positional"]);
  assert.equal(args.flags.title, "Foo");
});

test("--json sets the dedicated json field, and still appears in flags", () => {
  const withJson = parseArgs(["--json"]);
  assert.equal(withJson.json, true);
  assert.equal(withJson.flags.json, true);

  const withoutJson = parseArgs(["due"]);
  assert.equal(withoutJson.json, false);
});

test("stdin is left unset by parseArgs -- reading it is a separate, explicit step", () => {
  const args = parseArgs(["--stdin"]);
  assert.equal(args.flags.stdin, true);
  assert.equal(args.stdin, undefined);
});

test("an empty argv parses to empty positional and flags", () => {
  const args = parseArgs([]);
  assert.deepEqual(args.positional, []);
  assert.deepEqual(args.flags, {});
  assert.deepEqual(args.repeated, {});
  assert.equal(args.json, false);
});
