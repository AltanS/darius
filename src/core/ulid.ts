/**
 * ULID: 48 bits of millisecond time then 80 bits of randomness, Crockford
 * base32 encoded, 26 characters, lexicographically sortable.
 *
 * Ledger lines sort by `id` (docs/plan-tonight.md, "Ledger line"), and a
 * line's `id` time part must equal its own `at` field, so `ulid(now)`
 * encodes exactly the `now` it is given rather than reading the clock
 * itself. Two ULIDs minted in the same millisecond, in this process, still
 * need to sort strictly ascending: the random half is not re-rolled for a
 * repeated millisecond, it is incremented as an 80-bit big-endian counter.
 *
 * `crypto.getRandomValues` is the Web Crypto API, a global in both Bun and
 * Node >= 19 — no `node:crypto` import and no `src/runtime.ts` split needed.
 */

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_CHARS = 10; // 48 bits of time fit in 10 base32 characters (50 bits of room)
const RANDOM_CHARS = 16; // 80 bits of randomness, exactly 16 base32 characters
const RANDOM_BYTES = 10; // 80 bits
const ULID_LENGTH = TIME_CHARS + RANDOM_CHARS;

function encodeTime(ms: number): string {
  if (!Number.isInteger(ms) || ms < 0) {
    throw new Error(`ulid: time must be a non-negative integer millisecond count, got ${ms}`);
  }
  let remaining = ms;
  let result = "";
  for (let index = 0; index < TIME_CHARS; index += 1) {
    result = (ENCODING[remaining % 32] ?? "0") + result;
    remaining = Math.floor(remaining / 32);
  }
  if (remaining > 0) throw new Error(`ulid: time ${ms} does not fit in 48 bits`);
  return result;
}

function decodeTime(id: string): number {
  let ms = 0;
  for (let index = 0; index < TIME_CHARS; index += 1) {
    const digit = ENCODING.indexOf(id[index] ?? "");
    if (digit === -1) throw new Error(`ulidTime: '${id}' is not a valid ULID`);
    ms = ms * 32 + digit;
  }
  return ms;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** The 80-bit counter, plus one, as a fresh array. Throws on total overflow. */
function incrementRandom(bytes: Uint8Array): Uint8Array {
  const next = new Uint8Array(bytes);
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const byte = next[index] ?? 0;
    if (byte !== 255) {
      next[index] = byte + 1;
      return next;
    }
    next[index] = 0;
  }
  throw new Error("ulid: random component overflowed within one millisecond");
}

function encodeRandom(bytes: Uint8Array): string {
  let bits = 0n;
  for (const byte of bytes) bits = (bits << 8n) | BigInt(byte);
  let result = "";
  for (let index = 0; index < RANDOM_CHARS; index += 1) {
    result = (ENCODING[Number(bits & 31n)] ?? "0") + result;
    bits >>= 5n;
  }
  return result;
}

let lastTime = -1;
let lastRandom: Uint8Array | null = null;

/**
 * A ULID whose time part is exactly `now` (default `Date.now()`). Calling
 * this repeatedly for the same millisecond, in this process, still yields
 * strictly ascending strings.
 */
export function ulid(now: number = Date.now()): string {
  const random =
    now === lastTime && lastRandom !== null ? incrementRandom(lastRandom) : randomBytes(RANDOM_BYTES);
  lastTime = now;
  lastRandom = random;
  return encodeTime(now) + encodeRandom(random);
}

/** The millisecond time `ulid()` encoded into `id`. Throws on a malformed id. */
export function ulidTime(id: string): number {
  if (id.length !== ULID_LENGTH) {
    throw new Error(`ulidTime: '${id}' is not ${ULID_LENGTH} characters`);
  }
  return decodeTime(id);
}
