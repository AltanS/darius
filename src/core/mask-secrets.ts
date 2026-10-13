/**
 * Masks obvious secrets in check output before a person sees it (0.86.4;
 * docs/concept.md, "Failure reason, dispatch, one-vigil check, separate
 * states"). Display only: the stored output blob and `vigil show --json`
 * keep the raw text. The rule for vigil authors stays: a Command must not
 * print a secret. This is a second line, not a guarantee.
 *
 * Masked, each value replaced by MASK:
 *
 *   - well-known key shapes: `sk-...`, `ghp_...` and the other GitHub
 *     prefixes, `github_pat_...`, `glpat-...`, `xox?-...`, `AKIA...`, `ASIA...`
 *     (the prefix stays, so the kind of key is still clear);
 *   - the value of an `Authorization:` header, after its scheme word;
 *   - a `Bearer` token;
 *   - the value after a secret-like name with `=` (`token=`, `api_key=`,
 *     `DB_PASSWORD=`); with `:` only when the value looks like a key (8 or
 *     more key characters with a digit), so `token: expired` stays;
 *   - a long run of key characters (20 or more, with a digit and a letter,
 *     not a path) shortly after a secret-like word.
 *
 * A secret-like name ends in one of SECRET_WORDS, alone or after a `_`, `-`
 * or `.` (`monkey` and `max_tokens` are not secret names).
 */

export const MASK = "[masked]";

const SECRET_WORDS = "token|secret|password|passwd|passphrase|api[_-]?key|apikey|access[_-]?key|private[_-]?key|key|auth|credentials?";
const SECRET_NAME = `(?<![A-Za-z0-9])(?:[A-Za-z0-9]+[_.-])*(?:${SECRET_WORDS})(?![A-Za-z0-9])`;

const KNOWN_KEYS = /\b(sk-|gh[pousr]_|github_pat_|glpat-|xox[abprs]-)[A-Za-z0-9_-]{16,}|\b(AKIA|ASIA)[A-Z0-9]{16}\b/gu;
const AUTHORIZATION = /\b((?:proxy-)?authorization\s*:\s*)(?:(bearer|basic|token|digest)\s+)?([^\s"',;]+)/giu;
const BEARER = /\b(bearer\s+)([A-Za-z0-9._~+/=-]{8,})/giu;
const NAME_EQUALS = new RegExp(`(${SECRET_NAME}["']?\\s*=\\s*["']?)([^\\s"'&;,]+)`, "giu");
const NAME_COLON = new RegExp(`(${SECRET_NAME}["']?\\s*:\\s*["']?)([A-Za-z0-9._~+/=-]{8,})`, "giu");
const WORD_THEN_RUN = new RegExp(`(${SECRET_NAME}[^\\n]{0,20}?)([A-Za-z0-9+/_-]{20,}={0,2})`, "giu");

function hasDigit(text: string): boolean {
  return /\d/u.test(text);
}

function isKeyLike(text: string): boolean {
  return hasDigit(text) && /[A-Za-z]/u.test(text) && !text.startsWith("/");
}

/** `text` with obvious secrets replaced by MASK. Never use the result to store anything. */
export function maskSecrets(text: string): string {
  return text
    .replace(KNOWN_KEYS, (_whole, prefix: string | undefined, aws: string | undefined) => `${prefix ?? aws ?? ""}${MASK}`)
    .replace(AUTHORIZATION, (_whole, head: string, scheme: string | undefined) => `${head}${scheme === undefined ? "" : `${scheme} `}${MASK}`)
    .replace(BEARER, (whole, head: string, value: string) => (hasDigit(value) ? `${head}${MASK}` : whole))
    .replace(NAME_EQUALS, (_whole, head: string) => `${head}${MASK}`)
    .replace(NAME_COLON, (whole, head: string, value: string) => (value === MASK || !hasDigit(value) ? whole : `${head}${MASK}`))
    .replace(WORD_THEN_RUN, (whole, head: string, value: string) => (isKeyLike(value) ? `${head}${MASK}` : whole));
}
