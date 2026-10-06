/**
 * `src/core/ssh.ts`: a word sent over ssh reads back as the same word in the
 * host's login shell (0.69.0). ssh joins the words with spaces and hands the
 * line to that shell, so the quoting is the only thing between operator text
 * (a note, an item key) and code on the other host.
 *
 * SAFETY: the shells only run `printf`; nothing reaches a host.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { shellLine, shellWord, sshArgv } from "../src/core/ssh.ts";

/** Words an operator or a model could hand in: quotes, $(), backticks, newlines, backslashes, globs, fish syntax. */
const HOSTILE: readonly string[] = [
  `it's "done"`,
  "$(touch /tmp/pwned)",
  "`touch /tmp/pwned`",
  "line one\nline two; rm -rf ~",
  "ends in a backslash \\",
  "\\",
  "\\'",
  "a\\'; touch /tmp/pwned; echo '",
  "'",
  "''",
  "*",
  "~ {a,b} [x] $HOME ${HOME} %s \\n",
  "--grant=rm -rf /",
  "(fish) $(echo hi) {$HOME}",
  "tab\there",
  "",
];

/** A shell by name on PATH, or undefined. */
function shellOnPath(name: string): string | undefined {
  return (process.env.PATH ?? "")
    .split(":")
    .map((dir) => join(dir, name))
    .find((candidate) => candidate.startsWith("/") && existsSync(candidate));
}

/** What `shell -c "printf '%s\0' <line>"` prints, split on NUL. */
function readBack(shell: string, words: readonly string[]): string[] {
  const line = `printf '%s\\0' ${shellLine(words)}`;
  const ran = spawnSync(shell, ["-c", line], { encoding: "utf8", env: { PATH: process.env.PATH ?? "" } });
  assert.equal(ran.status, 0, `${shell}: ${ran.stderr}`);
  return ran.stdout.split("\0").slice(0, -1);
}

/**
 * How fish reads one line of words, for a host without fish: single quotes
 * hold everything literally except `\'` and `\\`; outside quotes a backslash
 * escapes the next character; a space ends a word, and a `;` outside quotes
 * is a word of its own, the end of a command. Only what shellWord emits is
 * modelled. An unterminated quote throws, as fish refuses the line.
 */
function fishWords(line: string): string[] {
  const words: string[] = [];
  let word: string | null = null;
  let index = 0;
  while (index < line.length) {
    const char = line[index] ?? "";
    if (char === " " || char === ";") {
      if (word !== null) words.push(word);
      if (char === ";") words.push(";");
      word = null;
      index += 1;
      continue;
    }
    word ??= "";
    if (char === "\\") {
      word += line[index + 1] ?? "";
      index += 2;
      continue;
    }
    if (char !== "'") {
      word += char;
      index += 1;
      continue;
    }
    index += 1;
    for (;;) {
      if (index >= line.length) throw new Error("unterminated quote");
      const inner = line[index] ?? "";
      const next = line[index + 1] ?? "";
      if (inner === "\\" && (next === "'" || next === "\\")) {
        word += next;
        index += 2;
      } else if (inner === "'") {
        index += 1;
        break;
      } else {
        word += inner;
        index += 1;
      }
    }
  }
  if (word !== null) words.push(word);
  return words;
}

test("shellWord leaves a safe word as it is and quotes every other", () => {
  assert.equal(shellWord("--project"), "--project");
  assert.equal(shellWord("web:op@host-a"), "web:op@host-a");
  assert.equal(shellWord("it's"), `'it'\\''s'`);
  assert.equal(shellWord("a\\b"), `'a'\\\\'b'`);
  assert.equal(shellWord(""), "''");
});

for (const name of ["sh", "bash", "dash", "zsh", "fish"]) {
  const shell = shellOnPath(name);
  test(`every hostile word reads back unchanged in ${name}`, { skip: shell === undefined ? `${name} is not on PATH` : false }, () => {
    assert.deepEqual(readBack(shell ?? "", HOSTILE), [...HOSTILE]);
  });
}

/** shellWord before 0.69.0: POSIX single quotes only. */
function posixOnly(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

test("fish reads every hostile word back unchanged; the old POSIX-only quoting left a quote open there", () => {
  assert.deepEqual(fishWords(shellLine(HOSTILE)), [...HOSTILE]);
  // The quoting before 0.69.0: in fish, `'x\'` does not end the word, so the next quoted word ran as code.
  // Two words that end in a backslash, a note and an item key, put the payload between them outside any quote.
  const old = ["--note", "a\\", "--item", "; touch /tmp/pwned; echo ", "--item", "b\\"].map(posixOnly).join(" ");
  const words = fishWords(old);
  assert.deepEqual(words.slice(0, 7), ["--note", "a' --item ", ";", "touch", "/tmp/pwned", ";", "echo"], "touch runs as a command of its own");
  assert.deepEqual(fishWords(shellLine(["--note", "a\\", "--item", "; touch /tmp/pwned; echo ", "--item", "b\\"])), ["--note", "a\\", "--item", "; touch /tmp/pwned; echo ", "--item", "b\\"]);
});

test("sshArgv quotes the remote words and leaves the options and the host alone", () => {
  assert.deepEqual(sshArgv("host-b", ["darius", "run", "x y"]), ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "host-b", "darius", "run", "'x y'"]);
});
