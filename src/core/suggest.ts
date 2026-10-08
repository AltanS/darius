/**
 * "Did you mean" for a mistyped verb: a small edit-distance match over the
 * known names.
 */

/** The Levenshtein distance between two short strings. */
export function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      current.push(Math.min((previous[column] ?? 0) + 1, (current[column - 1] ?? 0) + 1, (previous[column - 1] ?? 0) + cost));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/**
 * The known names closest to `word`: within two edits (one for a word of four
 * letters or fewer), or sharing a three-letter prefix. Best first, at most
 * three, only the best distance.
 */
export function closestNames(word: string, known: Iterable<string>): string[] {
  const limit = word.length <= 4 ? 1 : 2;
  const scored: Array<{ name: string; distance: number }> = [];
  for (const name of known) {
    const distance = editDistance(word, name);
    const prefix = word.length >= 3 && (name.startsWith(word) || word.startsWith(name));
    if (distance <= limit || prefix) scored.push({ name, distance: prefix && distance > limit ? limit : distance });
  }
  if (scored.length === 0) return [];
  const best = Math.min(...scored.map((entry) => entry.distance));
  return scored
    .filter((entry) => entry.distance === best)
    .map((entry) => entry.name)
    .toSorted()
    .slice(0, 3);
}
