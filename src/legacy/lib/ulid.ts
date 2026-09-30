/**
 * ULID generator — Crockford base32, sortable by time prefix, 80 bits randomness.
 *
 * Used for worklog thread IDs: e.g. "01KQA00MJ5725V29Q1AF-auth-refactor"
 */

import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(ms: number): string {
  let temp = BigInt(ms);
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = (ALPHABET[Number(temp % 32n)] ?? "0") + out;
    temp = temp / 32n;
  }
  return out;
}

function encodeRandom(): string {
  const bytes = randomBytes(10);
  let out = "";
  for (let i = 0; i < 10; i++) {
    out += ALPHABET[(bytes[i] ?? 0) % 32] ?? "0";
  }
  return out;
}

/**
 * Generate a ULID string (26 characters, Crockford base32).
 */
export function generateULID(): string {
  return encodeTime(Date.now()) + encodeRandom();
}

/**
 * Sanitize a slug for use in thread IDs.
 * Lowercases, replaces non-alphanumeric with hyphen, trims, truncates to 40 chars.
 */
export function sanitizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Generate a ULID-prefixed thread ID with an optional slug suffix.
 * e.g. "01KQA00MJ5725V29Q1AF-auth-refactor"
 */
export function generateThreadId(slug?: string): string {
  const ulid = generateULID();
  if (slug && slug.trim()) {
    return `${ulid}-${sanitizeSlug(slug)}`;
  }
  return ulid;
}
