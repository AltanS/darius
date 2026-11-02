/**
 * A vigil that lights a flare (0.110.0, docs/concept.md, "Flares" and
 * "Vigil auto-execution"). The vigil keeps `flare` (a severity) and
 * `flare_deliver` in its header. A sweep that reads `failed` lights the flare
 * `vigil:<slug>`; a held close clears it. The vigil stays armed after a
 * failure, as it always did.
 *
 * Only ledger lines are written here: `flare.lit` and `flare.cleared`. The
 * flare index (src/core/flare-index.ts) derives the flare from them.
 */

import { collectFlares, FLARE_CLEARED, FLARE_LIT } from "./flare-index.ts";
import { appendLine } from "./ledger.ts";
import { UsageError, type Vigil } from "./model.ts";
import { clean, KEY_MAX, normalizeKey, SEVERITIES, TEXT_LIMITS, type Severity } from "./result.ts";
import type { Project } from "./store.ts";

/** The key and the source of a vigil's flare are `vigil:<slug>`. */
const PREFIX = "vigil:";

const CHANNELS: ReadonlySet<string> = new Set(["push", "email"]);

/** The flare key of a vigil. Not checked: see `assertFlareKey`. */
export function vigilFlareKey(slug: string): string {
  return `${PREFIX}${slug}`;
}

/** The slug in a flare source such as `vigil:acme-soak`; undefined for any other source. */
export function vigilOfSource(source: string): string | undefined {
  if (!source.startsWith(PREFIX)) return undefined;
  const slug = source.slice(PREFIX.length);
  return slug === "" ? undefined : slug;
}

/** Refuses a slug whose flare key breaks the key rules of a result item (src/core/result.ts): one line, at most KEY_MAX characters. */
export function assertFlareKey(slug: string): void {
  const key = normalizeKey(vigilFlareKey(slug));
  const length = [...key].length;
  if (length > KEY_MAX) {
    throw new UsageError(`vigil '${slug}' cannot light a flare: its flare key '${key}' is at most ${String(KEY_MAX)} characters, got ${String(length)}; use a shorter slug`);
  }
}

/** `--flare`: a severity. */
export function parseFlareSeverity(raw: string): Severity {
  const severity = SEVERITIES.find((candidate) => candidate === raw.trim());
  if (severity === undefined) throw new UsageError(`--flare takes ${SEVERITIES.join(", ")}, got '${raw}'`);
  return severity;
}

/** `--flare-deliver`: push, email, both with a comma, or none (the app only) as an empty list. */
export function parseFlareDeliver(raw: string): string[] {
  if (raw.trim() === "none") return [];
  const channels = raw.split(",").map((channel) => channel.trim());
  const wrong = channels.find((channel) => !CHANNELS.has(channel));
  if (wrong !== undefined) throw new UsageError(`--flare-deliver takes push, email or none, got '${wrong}'`);
  return [...new Set(channels)];
}

/**
 * Refuses `flare` on a vigil whose sweep can never read `failed`. Only a vigil
 * with a date or a gate command runs its checks to a verdict. An `until`
 * vigil alone ends as a finding or pending, never as a failure.
 */
export function assertFlareCanFire(header: Pick<Vigil, "slug" | "due" | "gate_command">): void {
  assertFlareKey(header.slug);
  if (header.due !== undefined || header.gate_command !== undefined) return;
  throw new UsageError(
    `vigil '${header.slug}' has no date and no gate command, so its checks never fail; ` +
      "a failure is what lights the flare. Give it --due or --in, or a --gate-command, or drop --flare",
  );
}

/** What a failing sweep tells the operator: the kind of failure and the step that failed. */
export interface FlareFailure {
  failKind: string;
  step: { index: number; text: string } | undefined;
}

/** The kind in words: `unknown` only means no rule named the failure, and that is the plain case. */
function kindInWords(failKind: string): string {
  if (failKind === "pending") return "A check is still pending";
  if (failKind === "broken") return "A check could not run";
  return "A check failed";
}

function targetOf(failure: FlareFailure): string {
  const step = failure.step === undefined ? "" : `, step ${String(failure.step.index + 1)}: ${failure.step.text}`;
  return clean(`${kindInWords(failure.failKind)}${step}`, TEXT_LIMITS.target);
}

export interface LightInput {
  header: Vigil;
  failure: FlareFailure;
  who: string;
}

/**
 * Appends `flare.lit` for a vigil that failed. A repeat at the same severity is
 * a report with no notice (the index sends a notice per opening line only).
 * Throws when the vigil names no flare.
 */
export function lightVigilFlare(project: Project, input: LightInput): void {
  const { header, failure, who } = input;
  if (header.flare === undefined) throw new Error(`vigil '${header.slug}' has no flare to light`);
  assertFlareKey(header.slug);
  appendLine(project, {
    who,
    type: FLARE_LIT,
    key: vigilFlareKey(header.slug),
    title: clean(header.title, TEXT_LIMITS.title),
    severity: header.flare,
    source: vigilFlareKey(header.slug),
    deliver: header.flare_deliver,
    target: targetOf(failure),
  });
}

export interface ClearInput {
  slug: string;
  who: string;
  note: string;
}

/**
 * Appends `flare.cleared` for the flare of this vigil, when it is there and not
 * gone and the vigil lit it. Writes nothing otherwise: the index would skip a
 * clear for a flare that does not exist. Returns whether it wrote. Call it
 * inside the lock of the close that asks for it.
 */
export function clearVigilFlare(project: Project, input: ClearInput): boolean {
  const key = vigilFlareKey(input.slug);
  return project.withLock((): boolean => {
    const flare = collectFlares(project).find((candidate) => candidate.key === key);
    if (flare === undefined || flare.status === "gone" || flare.source !== key) return false;
    appendLine(project, { who: input.who, type: FLARE_CLEARED, key, note: input.note });
    return true;
  });
}
