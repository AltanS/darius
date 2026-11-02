/**
 * A vigil that lights a candle (0.110.0, docs/concept.md, "Candles" and
 * "Vigil auto-execution"). The vigil keeps `candle` (a severity) and
 * `candle_deliver` in its header. A sweep that reads `failed` lights the candle
 * `vigil:<slug>`; a held close blows it out. The vigil stays armed after a
 * failure, as it always did.
 *
 * Only ledger lines are written here: `candle.lit` and `candle.blown-out`. The
 * candle index (src/core/candle-index.ts) derives the candle from them.
 */

import { collectCandles, CANDLE_BLOWN_OUT, CANDLE_LIT } from "./candle-index.ts";
import { appendLine } from "./ledger.ts";
import { UsageError, type Vigil } from "./model.ts";
import { clean, KEY_MAX, normalizeKey, SEVERITIES, TEXT_LIMITS, type Severity } from "./result.ts";
import type { Project } from "./store.ts";

/** The key and the source of a vigil's candle are `vigil:<slug>`. */
const PREFIX = "vigil:";

const CHANNELS: ReadonlySet<string> = new Set(["push", "email"]);

/** The candle key of a vigil. Not checked: see `assertCandleKey`. */
export function vigilCandleKey(slug: string): string {
  return `${PREFIX}${slug}`;
}

/** The slug in a candle source such as `vigil:acme-soak`; undefined for any other source. */
export function vigilOfSource(source: string): string | undefined {
  if (!source.startsWith(PREFIX)) return undefined;
  const slug = source.slice(PREFIX.length);
  return slug === "" ? undefined : slug;
}

/** Refuses a slug whose candle key breaks the key rules of a result item (src/core/result.ts): one line, at most KEY_MAX characters. */
export function assertCandleKey(slug: string): void {
  const key = normalizeKey(vigilCandleKey(slug));
  const length = [...key].length;
  if (length > KEY_MAX) {
    throw new UsageError(`vigil '${slug}' cannot light a candle: its candle key '${key}' is at most ${String(KEY_MAX)} characters, got ${String(length)}; use a shorter slug`);
  }
}

/** `--candle`: a severity. */
export function parseCandleSeverity(raw: string): Severity {
  const severity = SEVERITIES.find((candidate) => candidate === raw.trim());
  if (severity === undefined) throw new UsageError(`--candle takes ${SEVERITIES.join(", ")}, got '${raw}'`);
  return severity;
}

/** `--candle-deliver`: push, email, both with a comma, or none (the app only) as an empty list. */
export function parseCandleDeliver(raw: string): string[] {
  if (raw.trim() === "none") return [];
  const channels = raw.split(",").map((channel) => channel.trim());
  const wrong = channels.find((channel) => !CHANNELS.has(channel));
  if (wrong !== undefined) throw new UsageError(`--candle-deliver takes push, email or none, got '${wrong}'`);
  return [...new Set(channels)];
}

/**
 * Refuses `candle` on a vigil whose sweep can never read `failed`. Only a vigil
 * with a date or a gate command runs its checks to a verdict. An `until`
 * vigil alone ends as a finding or pending, never as a failure.
 */
export function assertCandleCanFire(header: Pick<Vigil, "slug" | "due" | "gate_command">): void {
  assertCandleKey(header.slug);
  if (header.due !== undefined || header.gate_command !== undefined) return;
  throw new UsageError(
    `vigil '${header.slug}' has no date and no gate command, so its checks never fail; ` +
      "a failure is what lights the candle. Give it --due or --in, or a --gate-command, or drop --candle",
  );
}

/** What a failing sweep tells the operator: the kind of failure and the step that failed. */
export interface CandleFailure {
  failKind: string;
  step: { index: number; text: string } | undefined;
}

/** The kind in words: `unknown` only means no rule named the failure, and that is the plain case. */
function kindInWords(failKind: string): string {
  if (failKind === "pending") return "A check is still pending";
  if (failKind === "broken") return "A check could not run";
  return "A check failed";
}

function targetOf(failure: CandleFailure): string {
  const step = failure.step === undefined ? "" : `, step ${String(failure.step.index + 1)}: ${failure.step.text}`;
  return clean(`${kindInWords(failure.failKind)}${step}`, TEXT_LIMITS.target);
}

export interface LightInput {
  header: Vigil;
  failure: CandleFailure;
  who: string;
}

/**
 * Appends `candle.lit` for a vigil that failed. A repeat at the same severity is
 * a report with no notice (the index sends a notice per opening line only).
 * Throws when the vigil names no candle.
 */
export function lightVigilCandle(project: Project, input: LightInput): void {
  const { header, failure, who } = input;
  if (header.candle === undefined) throw new Error(`vigil '${header.slug}' has no candle to light`);
  assertCandleKey(header.slug);
  appendLine(project, {
    who,
    type: CANDLE_LIT,
    key: vigilCandleKey(header.slug),
    title: clean(header.title, TEXT_LIMITS.title),
    severity: header.candle,
    source: vigilCandleKey(header.slug),
    deliver: header.candle_deliver,
    target: targetOf(failure),
  });
}

export interface BlowOutInput {
  slug: string;
  who: string;
  note: string;
}

/**
 * Appends `candle.blown-out` for the candle of this vigil, when it is there and not
 * out and the vigil lit it. Writes nothing otherwise: the index would skip a
 * blow-out for a candle that does not exist. Returns whether it wrote. Call it
 * inside the lock of the close that asks for it.
 */
export function blowOutVigilCandle(project: Project, input: BlowOutInput): boolean {
  const key = vigilCandleKey(input.slug);
  return project.withLock((): boolean => {
    const candle = collectCandles(project).find((candidate) => candidate.key === key);
    if (candle === undefined || candle.status === "out" || candle.source !== key) return false;
    appendLine(project, { who: input.who, type: CANDLE_BLOWN_OUT, key, note: input.note });
    return true;
  });
}
