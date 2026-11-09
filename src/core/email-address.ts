/**
 * The address grammar of the email channel (0.128.0): one rule for `from` and
 * `to` in `email.json` (src/core/email.ts) and for `[email] to` in a
 * project's `.darius.toml` (src/core/marker.ts). A bare `name@host`, or
 * `Display Name <name@host>`. No message here quotes the value.
 */

const BARE_ADDRESS = /^[^\s@<>]+@[^\s@<>]+$/u;
const NAMED_ADDRESS = /^[^<>\r\n]*<[^\s@<>]+@[^\s@<>]+>$/u;

/** True for one address in the channel's grammar. */
export function isEmailAddress(text: string): boolean {
  return BARE_ADDRESS.test(text) || NAMED_ADDRESS.test(text);
}
