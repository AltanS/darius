/**
 * `ulid()`/`ulidTime()`: the sortable id ledger lines key on
 * (docs/plan-tonight.md, "Ledger line" and "ULID").
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ulid, ulidTime } from "../src/core/ulid.ts";

test("ulid() returns a 26-character string", () => {
  assert.equal(ulid().length, 26);
});

test("ulidTime recovers the millisecond ulid() was given", () => {
  const now = Date.UTC(2026, 8, 28, 3, 14, 15, 0);
  const id = ulid(now);
  assert.equal(ulidTime(id), now);
});

test("two ulids for the same millisecond still sort ascending", () => {
  const now = Date.UTC(2026, 8, 28, 3, 14, 15, 0);
  const first = ulid(now);
  const second = ulid(now);
  assert.notEqual(first, second);
  assert.ok(first < second, `expected '${first}' < '${second}'`);
  // Same millisecond: the time part must be identical, only the random
  // suffix may differ.
  assert.equal(first.slice(0, 10), second.slice(0, 10));
});

test("10000 ULIDs from one process sort strictly ascending", () => {
  const ids: string[] = [];
  for (let index = 0; index < 10_000; index += 1) {
    ids.push(ulid());
  }
  for (let index = 1; index < ids.length; index += 1) {
    const previous = ids[index - 1];
    const current = ids[index];
    assert.ok(
      previous !== undefined && current !== undefined && previous < current,
      `id ${index - 1} ('${previous}') must sort strictly before id ${index} ('${current}')`,
    );
  }
});

test("ulidTime rejects a string that is not 26 characters", () => {
  assert.throws(() => ulidTime("too-short"), /not 26 characters/);
});

test("ulidTime rejects a character outside the Crockford base32 alphabet", () => {
  // "I" is excluded from Crockford base32 (confusable with "1"); the rest
  // pads out to the required 26 characters.
  assert.throws(() => ulidTime(`I${"0".repeat(25)}`), /not a valid ULID/);
});
