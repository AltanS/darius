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
import { maskSecrets } from "./mask-secrets.ts";
import { UsageError, type Vigil } from "./model.ts";
import { clean, KEY_MAX, normalizeKey, SEVERITIES, TEXT_LIMITS, type Severity } from "./result.ts";
import { putBlob, type Project } from "./store.ts";

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

/** The heading a vigil with a candle must have (0.137.0): what the operator does when a check fails. */
export const IF_A_CHECK_FAILS = "If a check fails";

const SECTION_HEADING = /^##[ \t]+if a check fails[ \t]*$/iu;
const ANY_TOP_HEADING = /^#{1,2}[ \t]/u;
const FENCE_LINE = /^[ \t]*```/u;

/**
 * The "## If a check fails" section of a vigil body, verbatim from its heading to
 * the next heading of level 1 or 2 (a `#` inside a fenced block does not end it).
 * Undefined when the heading is missing or the section has no text under it.
 */
export function ifACheckFailsSection(body: string): string | undefined {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => SECTION_HEADING.test(line.trimEnd()));
  if (start === -1) return undefined;
  let inFence = false;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (FENCE_LINE.test(line)) inFence = !inFence;
    if (!inFence && ANY_TOP_HEADING.test(line)) {
      end = index;
      break;
    }
  }
  const section = lines.slice(start, end).join("\n").trimEnd();
  return lines.slice(start + 1, end).some((line) => line.trim() !== "") ? section : undefined;
}

/**
 * Refuses `--candle` on a vigil whose body has no "## If a check fails" section
 * (0.137.0): a candle that says only "a check failed" gives the operator nothing to
 * act on. Called where `--candle` is set; a vigil that already has a candle is not
 * refused when the sweep runs.
 */
export function assertCandleBody(slug: string, body: string): void {
  if (ifACheckFailsSection(body) !== undefined) return;
  throw new UsageError(
    `vigil '${slug}' has no "## ${IF_A_CHECK_FAILS}" section, so its candle would tell the operator nothing to do. ` +
      `Add that section to the vigil body, with the steps to take when a check fails, then use --candle again, or drop --candle`,
  );
}

/** What a failing sweep tells the operator: the kind of failure and the step that failed. */
export interface CandleFailure {
  failKind: string;
  step: { index: number; text: string } | undefined;
  /** The Command and the Expected of the failing check, as it ran. */
  command?: string;
  expected?: string;
  /** `fail` or `timeout`. */
  outcome?: string;
  /** The exit code; null when a signal ended the check. */
  exit?: number | null;
  /** The last lines of the check output, plain text; null or absent when the blob is not on this host. */
  output?: string | null;
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
  /** The vigil body: its "## If a check fails" section goes into the candle body (0.137.0). */
  vigilBody?: string;
}

/** Most characters of one output line and of all the output in a candle body. */
const OUTPUT_LINE_MAX = 400;
const OUTPUT_MAX = 4000;

function kindWords(failKind: string): string {
  if (failKind === "pending") return "pending: the result is the one the Pending clause names";
  if (failKind === "broken") return "broken: the check itself did not work";
  return "unknown: no rule says why it failed";
}

function resultWords(failure: CandleFailure): string {
  const how = failure.outcome === "timeout" ? "timed out" : "failed";
  if (failure.exit === undefined) return how;
  return failure.exit === null ? `${how}, ended by a signal` : `${how}, exit ${String(failure.exit)}`;
}

/** The output as the body shows it: control characters out, secrets masked, lines and total cut, and no fence a line of it could close. */
function outputBlock(output: string | null | undefined): string[] {
  if (output === undefined) return [];
  if (output === null) return ["Output: not stored on this host.", ""];
  const cut = clean(maskSecrets(output), Number.MAX_SAFE_INTEGER, true)
    .split("\n")
    .map((line) => (line.length > OUTPUT_LINE_MAX ? `${line.slice(0, OUTPUT_LINE_MAX - 1)}…` : line))
    .join("\n")
    .replaceAll("```", "'''");
  if (cut === "") return ["Output: none.", ""];
  const text = cut.length > OUTPUT_MAX ? `…${cut.slice(-(OUTPUT_MAX - 1))}` : cut;
  return ["Output, last 20 lines at most, obvious secrets masked:", "", "```", text, "```", ""];
}

/**
 * The body of a vigil's candle (0.137.0): what failed, then what the vigil says
 * to do about it. Markdown in plain sentences. The check text, command, expected
 * and output are masked (the body syncs to other hosts); the "If a check fails"
 * section is the vigil's own text and stays verbatim.
 */
export function vigilCandleBody(failure: CandleFailure, vigilBody: string | undefined): string {
  const { step } = failure;
  const facts = [
    ...(step === undefined ? [] : [`- Step ${String(step.index + 1)}: ${clean(maskSecrets(step.text), TEXT_LIMITS.detail)}`]),
    ...(failure.command === undefined ? [] : [`- Command: ${clean(maskSecrets(failure.command), TEXT_LIMITS.detail)}`]),
    ...(failure.expected === undefined ? [] : [`- Expected: ${clean(maskSecrets(failure.expected), TEXT_LIMITS.detail)}`]),
    `- Result: ${resultWords(failure)}`,
    `- Kind: ${kindWords(failure.failKind)}`,
  ];
  const lines = ["## What failed", "", ...facts, "", ...outputBlock(failure.output)];
  const section = vigilBody === undefined ? undefined : ifACheckFailsSection(vigilBody);
  if (section !== undefined) lines.push(section, "");
  return `${lines.join("\n").trimEnd()}\n`;
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
  const bodySha = putBlob(project, vigilCandleBody(failure, input.vigilBody));
  appendLine(project, {
    who,
    type: CANDLE_LIT,
    key: vigilCandleKey(header.slug),
    title: clean(header.title, TEXT_LIMITS.title),
    severity: header.candle,
    source: vigilCandleKey(header.slug),
    deliver: header.candle_deliver,
    target: targetOf(failure),
    body_sha: bodySha,
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
